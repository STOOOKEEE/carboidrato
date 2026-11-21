// Carte de la facture signée : PDF à envoyer au fournisseur, généré et téléchargé dans la page.
import type { AttestedInvoiceFile, BusinessLookup } from "../../../../src/api/contract";
import { formatDate, formatUsd } from "../../format";
import { signedInvoicePdf } from "../../signedInvoicePdf";
import { Button } from "../../ui/Button";
import { Facts } from "../../ui/Facts";

const CENTS_PER_USD = 100;
const MS_PER_SECOND = 1_000;
/** L'échéance signée est minuit UTC ; affichée à midi UTC, elle tombe le même jour dans tous les fuseaux. */
const NOON_MS = 12 * 3_600_000;

/** Enregistre le PDF signé par un lien de téléchargement éphémère : rien ne transite par le serveur. */
export async function saveSignedPdf(file: AttestedInvoiceFile, supplier: BusinessLookup, fileName: string): Promise<void> {
  // pdf-lib enregistre dans un ArrayBuffer neuf, jamais partagé : c'est ce qu'attend Blob.
  const pdf = (await signedInvoicePdf(file, supplier)) as Uint8Array<ArrayBuffer>;
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
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
      <h2>Signed. Send this PDF to your supplier</h2>
      <p className="muted">
        <span className="mono">{fileName}</span> is in your downloads. {supplier.company} drops it in their Atlas space to
        get paid now: it carries your signature, and the invoice stays between you and them.
      </p>
      <Facts
        facts={[
          { label: "Supplier", value: `${supplier.company} · ${supplier.vatNumber}` },
          { label: "Invoice number", value: file.invoice.number },
          { label: "Total", value: formatUsd(Number(attestation.amountCents) / CENTS_PER_USD) },
          { label: "Due date", value: formatDate(new Date(Number(attestation.dueDate) * MS_PER_SECOND + NOON_MS).toISOString()) },
        ]}
      />
      <div className="result-actions">
        <Button primary onClick={() => void saveSignedPdf(file, supplier, fileName)}>
          Download again
        </Button>
        <Button variant="ghost" onClick={onAnother}>
          Confirm another invoice
        </Button>
      </div>
    </section>
  );
}
