// Carte de la facture signée : fichier `.bari.json` à envoyer au fournisseur, téléchargé depuis la page.
import type { AttestedInvoiceFile, BusinessLookup } from "../../../../src/api/contract";
import { formatDate, formatEur } from "../../format";
import { Button } from "../../ui/Button";
import { Facts } from "../../ui/Facts";

const CENTS_PER_EUR = 100;
const MS_PER_SECOND = 1_000;
/** L'échéance signée est minuit UTC ; affichée à midi UTC, elle tombe le même jour dans tous les fuseaux. */
const NOON_MS = 12 * 3_600_000;

/** Enregistre le fichier signé par un lien de téléchargement éphémère : rien ne transite par le serveur. */
export function saveSignedFile(file: AttestedInvoiceFile, fileName: string): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Le navigateur lit l'URL au clic ; elle est libérée juste après.
  setTimeout(() => URL.revokeObjectURL(url));
}

interface SignedCardProps {
  file: AttestedInvoiceFile;
  fileName: string;
  supplier: BusinessLookup;
  onAnother: () => void;
}

export function SignedCard({ file, fileName, supplier, onAnother }: SignedCardProps) {
  const { attestation } = file;
  return (
    <section className="step" data-testid="signed-invoice">
      <h2>Signed. Send this file to your supplier</h2>
      <p className="muted">
        <span className="mono">{fileName}</span> is in your downloads. {supplier.company} drops it in their Bari space to
        get paid now: it carries your signature, and the invoice stays between you and them.
      </p>
      <Facts
        facts={[
          { label: "Supplier", value: `${supplier.company} · ${supplier.vatNumber}` },
          { label: "Invoice number", value: file.invoice.number },
          { label: "Total", value: formatEur(Number(attestation.amountCents) / CENTS_PER_EUR) },
          { label: "Due date", value: formatDate(new Date(Number(attestation.dueDate) * MS_PER_SECOND + NOON_MS).toISOString()) },
        ]}
      />
      <div className="result-actions">
        <Button primary onClick={() => saveSignedFile(file, fileName)}>
          Download again
        </Button>
        <Button variant="ghost" onClick={onAnother}>
          Confirm another invoice
        </Button>
      </div>
    </section>
  );
}
