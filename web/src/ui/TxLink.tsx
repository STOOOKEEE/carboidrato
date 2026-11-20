// Lien vers la page d'une transaction, hash tronqué.
import { shortHash } from "../format";

interface TxLinkProps {
  hash: string;
}

export function TxLink({ hash }: TxLinkProps) {
  return (
    <a className="link mono" href={`#/tx/${hash}`} title={hash}>
      {shortHash(hash, 4)}
    </a>
  );
}
