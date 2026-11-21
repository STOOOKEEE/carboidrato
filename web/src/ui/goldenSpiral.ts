// Géométrie du nombre d'or : un rectangle d'or découpé en carrés (gauche, haut, droite, bas, puis on recommence),
// un quart de cercle par carré. Le tracé part du grand arc extérieur et s'enroule vers le centre.

export const PHI = (1 + Math.sqrt(5)) / 2;

export interface GoldenSpiral {
  /** Tracé SVG de la spirale. */
  path: string;
  /** Lignes de construction : bords du rectangle puis chaque coupe, [x1, y1, x2, y2]. */
  lines: [number, number, number, number][];
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Spirale dans le rectangle d'or [0, 0, height × φ, height], sur `turns` carrés. */
export function goldenSpiral(height: number, turns: number): GoldenSpiral {
  let x = 0;
  let y = 0;
  let w = height * PHI;
  let h = height;
  const lines: GoldenSpiral["lines"] = [
    [0, 0, w, 0],
    [w, 0, w, h],
    [w, h, 0, h],
    [0, h, 0, 0],
  ];
  let path = `M0 ${round(h)}`;
  const arc = (radius: number, toX: number, toY: number) => {
    path += `A${round(radius)} ${round(radius)} 0 0 1 ${round(toX)} ${round(toY)}`;
  };

  for (let i = 0; i < turns; i++) {
    switch (i % 4) {
      case 0: {
        // Carré à gauche.
        const s = h;
        arc(s, x + s, y);
        lines.push([x + s, y, x + s, y + h]);
        x += s;
        w -= s;
        break;
      }
      case 1: {
        // Carré en haut.
        const s = w;
        arc(s, x + w, y + s);
        lines.push([x, y + s, x + w, y + s]);
        y += s;
        h -= s;
        break;
      }
      case 2: {
        // Carré à droite.
        const s = h;
        arc(s, x + w - s, y + h);
        lines.push([x + w - s, y, x + w - s, y + h]);
        w -= s;
        break;
      }
      case 3: {
        // Carré en bas.
        const s = w;
        arc(s, x, y + h - s);
        lines.push([x, y + h - s, x + w, y + h - s]);
        h -= s;
        break;
      }
    }
  }
  return { path, lines: lines.map((line) => line.map(round) as [number, number, number, number]) };
}
