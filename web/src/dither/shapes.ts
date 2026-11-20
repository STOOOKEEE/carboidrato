// Formes du dither, dessinées en blanc sur noir dans un carré unité : le dégradé vertical donne
// l'ombrage en densité de points (comme la baleine de la DA).

import type { ShapeDrawer } from "./engine";

export type ShapeName = "invoice" | "euro" | "check" | "cross" | "shield" | "upload";

function shade(ctx: CanvasRenderingContext2D, top: number, bottom: number, darkest = "#7a7a7a"): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(1, darkest);
  return gradient;
}

const invoice: ShapeDrawer = (ctx, s) => {
  const w = s * 0.6;
  const h = s * 0.8;
  const x = (s - w) / 2;
  const y = (s - h) / 2;
  const fold = w * 0.24;
  ctx.fillStyle = shade(ctx, y, y + h);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - fold, y);
  ctx.lineTo(x + w, y + fold);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#5a5a5a";
  ctx.beginPath();
  ctx.moveTo(x + w - fold, y);
  ctx.lineTo(x + w - fold, y + fold);
  ctx.lineTo(x + w, y + fold);
  ctx.closePath();
  ctx.fill();
  // Lignes de texte et total : des creux noirs dans la feuille.
  ctx.fillStyle = "#000";
  ctx.fillRect(x + w * 0.12, y + h * 0.1, w * 0.36, h * 0.07);
  for (let line = 0; line < 5; line++) {
    ctx.fillRect(x + w * 0.12, y + h * (0.3 + line * 0.085), w * (line % 2 === 0 ? 0.76 : 0.58), h * 0.035);
  }
  ctx.fillRect(x + w * 0.5, y + h * 0.8, w * 0.38, h * 0.08);
};

const euro: ShapeDrawer = (ctx, s) => {
  const gradient = shade(ctx, s * 0.15, s * 0.85);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = s * 0.12;
  ctx.beginPath();
  ctx.arc(s * 0.6, s * 0.5, s * 0.27, Math.PI * 0.27, Math.PI * 1.73);
  ctx.stroke();
  // Les deux barres dépassent nettement à gauche de l'arc, sinon elles s'y fondent en points.
  ctx.fillStyle = gradient;
  ctx.fillRect(s * 0.06, s * 0.35, s * 0.52, s * 0.08);
  ctx.fillRect(s * 0.06, s * 0.57, s * 0.48, s * 0.08);
};

function ring(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.strokeStyle = shade(ctx, s * 0.1, s * 0.9, "#9a9a9a");
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.38, 0, Math.PI * 2);
  ctx.stroke();
}

const check: ShapeDrawer = (ctx, s) => {
  ring(ctx, s);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = s * 0.1;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(s * 0.33, s * 0.51);
  ctx.lineTo(s * 0.45, s * 0.63);
  ctx.lineTo(s * 0.68, s * 0.38);
  ctx.stroke();
};

const cross: ShapeDrawer = (ctx, s) => {
  ring(ctx, s);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = s * 0.1;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(s * 0.37, s * 0.37);
  ctx.lineTo(s * 0.63, s * 0.63);
  ctx.moveTo(s * 0.63, s * 0.37);
  ctx.lineTo(s * 0.37, s * 0.63);
  ctx.stroke();
};

const shield: ShapeDrawer = (ctx, s) => {
  ctx.fillStyle = shade(ctx, s * 0.1, s * 0.9);
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.1);
  ctx.lineTo(s * 0.82, s * 0.22);
  ctx.quadraticCurveTo(s * 0.82, s * 0.72, s * 0.5, s * 0.9);
  ctx.quadraticCurveTo(s * 0.18, s * 0.72, s * 0.18, s * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = s * 0.08;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(s * 0.37, s * 0.5);
  ctx.lineTo(s * 0.47, s * 0.6);
  ctx.lineTo(s * 0.64, s * 0.4);
  ctx.stroke();
};

const upload: ShapeDrawer = (ctx, s) => {
  ctx.strokeStyle = shade(ctx, s * 0.15, s * 0.85, "#8a8a8a");
  ctx.lineWidth = s * 0.06;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.18);
  ctx.lineTo(s * 0.5, s * 0.6);
  ctx.moveTo(s * 0.33, s * 0.44);
  ctx.lineTo(s * 0.5, s * 0.61);
  ctx.lineTo(s * 0.67, s * 0.44);
  ctx.moveTo(s * 0.2, s * 0.62);
  ctx.lineTo(s * 0.2, s * 0.8);
  ctx.lineTo(s * 0.8, s * 0.8);
  ctx.lineTo(s * 0.8, s * 0.62);
  ctx.stroke();
};

export const SHAPES: Record<ShapeName, ShapeDrawer> = { invoice, euro, check, cross, shield, upload };
