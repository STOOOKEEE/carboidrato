// Moteur de rendu « dither » : une forme est échantillonnée en niveaux de gris sur une grille de cellules,
// puis seuillée par une matrice de Bayer 4×4. Les points carrés obtenus ondulent, réagissent au pointeur,
// peuvent être balayés par une ligne de scan, et passent d'une forme à l'autre en se dissolvant.

/** Dessine une forme blanche sur fond noir dans un carré de côté `size` (le gris donne la densité de points). */
export type ShapeDrawer = (ctx: CanvasRenderingContext2D, size: number) => void;

export interface DitherOptions {
  /** Pas de la grille, en pixels CSS. */
  cell: number;
  /** Côté d'un point rapporté au pas de la grille. */
  dotRatio: number;
  color: string;
  accent: string;
  /** Les points s'allument autour du pointeur. */
  interactive: boolean;
}

const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER_SIZE = 4;
const BAYER_LEVELS = 16;

/** Ondulation du seuil : amplitude et vitesses (rad/ms et rad/cellule). */
const WAVE_AMPLITUDE = 0.08;
const WAVE_TIME_SPEED = 0.0016;
const WAVE_X_FREQUENCY = 0.18;
const WAVE_Y_FREQUENCY = 0.11;
/** Au-delà de 1/PRESENCE_GAIN de luminance, une cellule ondule pleinement. */
const PRESENCE_GAIN = 4;

/** Dissolution entre deux formes : vitesse minimale et dispersion par cellule (fraction par image). */
const MORPH_MIN_SPEED = 0.03;
const MORPH_SPEED_SPREAD = 0.12;

const POINTER_RADIUS_CELLS = 9;
const POINTER_BOOST = 0.55;

const SCAN_BAND_CELLS = 6;
const SCAN_CELLS_PER_MS = 0.03;
const SCAN_BOOST = 0.6;

/** Les seuils de Bayer, centrés dans chaque niveau. */
const thresholds = BAYER_4X4.map((level) => (level + 0.5) / BAYER_LEVELS);

/** Pseudo-aléa stable par cellule (dissolution non uniforme). */
function cellNoise(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function sampleShape(drawer: ShapeDrawer, cols: number, rows: number): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Canvas 2D indisponible");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cols, rows);
  const size = Math.min(cols, rows);
  ctx.translate((cols - size) / 2, (rows - size) / 2);
  drawer(ctx, size);
  const { data } = ctx.getImageData(0, 0, cols, rows);
  const luminance = new Float32Array(cols * rows);
  for (let i = 0; i < luminance.length; i++) luminance[i] = data[i * 4] / 255;
  return luminance;
}

export class DitherEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private cols = 0;
  private rows = 0;
  private current: Float32Array = new Float32Array(0);
  private target: Float32Array = new Float32Array(0);
  private speeds: Float32Array = new Float32Array(0);
  private pointer: { x: number; y: number } | undefined;
  private frameId: number | undefined;
  private scanStartedAt: number | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private drawer: ShapeDrawer,
    private readonly options: DitherOptions,
  ) {
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("Canvas 2D indisponible");
    this.ctx = ctx;
    if (options.interactive) {
      canvas.addEventListener("pointermove", this.onPointerMove);
      canvas.addEventListener("pointerleave", this.onPointerLeave);
    }
  }

  setShape(drawer: ShapeDrawer): void {
    this.drawer = drawer;
    if (this.cols > 0) this.target = sampleShape(drawer, this.cols, this.rows);
    if (this.reducedMotion) this.current = this.target.slice();
  }

  setScanning(scanning: boolean): void {
    this.scanStartedAt = scanning ? performance.now() : undefined;
  }

  /** Recalcule la grille pour la taille CSS du canvas (la forme en cours est rééchantillonnée). */
  resize(width: number, height: number): void {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.cols = Math.max(1, Math.floor(width / this.options.cell));
    this.rows = Math.max(1, Math.floor(height / this.options.cell));
    this.target = sampleShape(this.drawer, this.cols, this.rows);
    this.current = this.reducedMotion ? this.target.slice() : new Float32Array(this.target.length);
    this.speeds = Float32Array.from(this.target, (_, i) => MORPH_MIN_SPEED + cellNoise(i) * MORPH_SPEED_SPREAD);
  }

  start(): void {
    this.frameId ??= requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.frameId !== undefined) cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
  }

  destroy(): void {
    this.stop();
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer = {
      x: (event.clientX - bounds.left) / this.options.cell,
      y: (event.clientY - bounds.top) / this.options.cell,
    };
  };

  private readonly onPointerLeave = () => {
    this.pointer = undefined;
  };

  private readonly tick = (now: number) => {
    this.render(now);
    this.frameId = requestAnimationFrame(this.tick);
  };

  private scanRow(now: number): number | undefined {
    if (this.scanStartedAt === undefined) return undefined;
    const travel = this.rows + SCAN_BAND_CELLS * 2;
    return (((now - this.scanStartedAt) * SCAN_CELLS_PER_MS) % travel) - SCAN_BAND_CELLS;
  }

  private render(now: number): void {
    const { cell, dotRatio, color, accent } = this.options;
    const { cols, rows, current, target, speeds } = this;
    const dot = cell * dotRatio;
    const offset = (cell - dot) / 2;
    const wave = this.reducedMotion ? 0 : WAVE_AMPLITUDE;
    const scanRow = this.scanRow(now);
    const accentCells: number[] = [];

    this.ctx.clearRect(0, 0, cols * cell, rows * cell);
    this.ctx.fillStyle = color;
    for (let y = 0; y < rows; y++) {
      const scanBoost = scanRow === undefined ? 0 : Math.max(0, 1 - Math.abs(y - scanRow) / SCAN_BAND_CELLS) * SCAN_BOOST;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        current[i] += (target[i] - current[i]) * speeds[i];
        // L'ondulation ne touche que la forme : le fond reste vide.
        const presence = Math.min(1, current[i] * PRESENCE_GAIN);
        let value =
          current[i] + presence * wave * Math.sin(now * WAVE_TIME_SPEED + x * WAVE_X_FREQUENCY + y * WAVE_Y_FREQUENCY);
        if (this.pointer !== undefined) {
          const distance = Math.hypot(x - this.pointer.x, y - this.pointer.y);
          value += Math.max(0, 1 - distance / POINTER_RADIUS_CELLS) * POINTER_BOOST * (current[i] > 0.05 ? 1 : 0.5);
        }
        const threshold = thresholds[(y % BAYER_SIZE) * BAYER_SIZE + (x % BAYER_SIZE)];
        if (value + scanBoost * current[i] <= threshold) continue;
        if (scanBoost > 0 && current[i] > 0.05) {
          accentCells.push(i);
        } else {
          this.ctx.fillRect(x * cell + offset, y * cell + offset, dot, dot);
        }
      }
    }
    this.ctx.fillStyle = accent;
    for (const i of accentCells) {
      this.ctx.fillRect((i % cols) * cell + offset, Math.floor(i / cols) * cell + offset, dot, dot);
    }
  }
}
