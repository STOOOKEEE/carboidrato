// Gravure d'Atlas portant le globe, avec sa légende.
import atlasUrl from "../assets/atlas.webp";

/** Dimensions de la gravure, pour réserver sa place avant le chargement. */
const WIDTH = 866;
const HEIGHT = 1507;

export function AtlasFigure() {
  return (
    <figure className="hero-figure">
      <div className="atlas">
        <img src={atlasUrl} width={WIDTH} height={HEIGHT} alt="" decoding="async" />
      </div>
      <figcaption>Atlas · φ = 1.618</figcaption>
    </figure>
  );
}
