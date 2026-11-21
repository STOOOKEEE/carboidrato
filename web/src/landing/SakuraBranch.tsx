// Branche de cerisier façon estampe japonaise (illustration détourée), qui entre par un bord de la fenêtre :
// par la droite en haut de la landing, par la gauche (en miroir) à la fin. Image fixe.
import branchUrl from "../assets/sakura-branch.webp";

export type BranchVariant = "hanging" | "rising";

/** Dimensions de l'image, pour réserver sa place avant le chargement. */
const WIDTH = 1353;
const HEIGHT = 906;

export function SakuraBranch({ variant, className }: { variant: BranchVariant; className?: string }) {
  return (
    <img
      className={`sakura sakura-${variant} ${className ?? ""}`}
      src={branchUrl}
      width={WIDTH}
      height={HEIGHT}
      alt=""
      decoding="async"
    />
  );
}
