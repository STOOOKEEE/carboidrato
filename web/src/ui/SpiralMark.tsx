// Marque de Bari : un rectangle d'or à l'encre et sa spirale en vert.
import { goldenSpiral, PHI } from "./goldenSpiral";

const HEIGHT = 100;
const MARK = goldenSpiral(HEIGHT, 9);

export function SpiralMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size / PHI}
      viewBox={`-2 -2 ${HEIGHT * PHI + 4} ${HEIGHT + 4}`}
      aria-hidden="true"
    >
      {MARK.lines.map(([x1, y1, x2, y2], index) => (
        <line key={index} className="mark-guide" x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
      <path className="mark-spiral" d={MARK.path} />
    </svg>
  );
}
