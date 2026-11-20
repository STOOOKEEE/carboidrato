import { useEffect, useRef } from "react";
import { DitherEngine } from "./engine";
import { SHAPES, type ShapeName } from "./shapes";

interface DitherCanvasProps {
  shape: ShapeName;
  scanning?: boolean;
  interactive?: boolean;
  /** Pas de la grille en pixels CSS. */
  cell?: number;
  tone?: "light" | "danger";
  className?: string;
}

const DEFAULT_CELL = 7;
const DOT_RATIO = 0.62;
const COLORS = { light: "#f2f2f2", danger: "#ff6b5e" } as const;
const ACCENT = "#3d82f6";

export function DitherCanvas({
  shape,
  scanning = false,
  interactive = false,
  cell = DEFAULT_CELL,
  tone = "light",
  className,
}: DitherCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DitherEngine | undefined>(undefined);
  // Dernières valeurs, relues quand le moteur est recréé (changement de pas, de ton…).
  const shapeRef = useRef(shape);
  const scanningRef = useRef(scanning);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const engine = new DitherEngine(canvas, SHAPES[shapeRef.current], {
      cell,
      dotRatio: DOT_RATIO,
      color: COLORS[tone],
      accent: ACCENT,
      interactive,
    });
    engine.setScanning(scanningRef.current);
    engineRef.current = engine;

    const resizeObserver = new ResizeObserver(([entry]) => {
      engine.resize(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(canvas);
    // Pas d'animation hors écran.
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) engine.start();
      else engine.stop();
    });
    visibilityObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      engine.destroy();
      engineRef.current = undefined;
    };
  }, [cell, interactive, tone]);

  useEffect(() => {
    shapeRef.current = shape;
    engineRef.current?.setShape(SHAPES[shape]);
  }, [shape]);

  useEffect(() => {
    scanningRef.current = scanning;
    engineRef.current?.setScanning(scanning);
  }, [scanning]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
