// Fleur de cerisier (sakura) : cinq pétales échancrés, cœur rose soutenu, étamines. Couleurs dans styles.css.

/** Un pétale échancré pointant vers le haut, de longueur 1 depuis le centre (0, 0). */
export const PETAL_PATH = "M0 0C-.42-.18-.56-.72-.3-1L0-.86L.3-1C.56-.72.42-.18 0 0Z";

const PETAL_ANGLES = [0, 72, 144, 216, 288];
const STAMEN_ANGLES = [18, 54, 90, 126, 162, 198, 234, 270, 306, 342];
const STAMEN_LENGTH = 0.36;

/** Fleur à placer dans un SVG : centrée en (0, 0), de rayon 1 (à mettre à l'échelle par le parent). */
export function BlossomGlyph() {
  return (
    <g className="blossom">
      {PETAL_ANGLES.map((angle) => (
        <path key={angle} className="blossom-petal" d={PETAL_PATH} transform={`rotate(${angle})`} />
      ))}
      <g transform="scale(0.42)">
        {PETAL_ANGLES.map((angle) => (
          <path key={angle} className="blossom-heart" d={PETAL_PATH} transform={`rotate(${angle + 36})`} />
        ))}
      </g>
      {STAMEN_ANGLES.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * STAMEN_LENGTH;
        const y = Math.sin(rad) * STAMEN_LENGTH;
        return (
          <g key={angle}>
            <line className="blossom-stamen" x1="0" y1="0" x2={x} y2={y} />
            <circle className="blossom-anther" cx={x} cy={y} r="0.045" />
          </g>
        );
      })}
    </g>
  );
}

/** Fleur autonome (logo, puces). */
export function Blossom({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="-1.05 -1.05 2.1 2.1" aria-hidden="true">
      <BlossomGlyph />
    </svg>
  );
}
