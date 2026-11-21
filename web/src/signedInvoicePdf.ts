// Facture signée en PDF : une page lisible pour le fournisseur, et la facture attestée embarquée dans les métadonnées,
// relue par l'espace entreprise dans la page. Le PDF va de l'organisme au fournisseur sans passer par le serveur de Bari.

import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { AttestedInvoiceFile, BusinessLookup } from "../../src/api/contract";
import { formatDate, formatUsd } from "./format";

/** Facture attestée (JSON) dans le dictionnaire d'informations du PDF. */
const ATTESTATION_KEY = PDFName.of("BariAttestation");
const PDF_MAGIC = "%PDF-";
const CENTS_PER_USD = 100;
const MS_PER_SECOND = 1_000;
/** L'échéance signée est minuit UTC ; affichée à midi UTC, elle tombe le même jour dans tous les fuseaux. */
const NOON_MS = 12 * 3_600_000;
/** A4 en points. */
const PAGE_SIZE: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const TITLE_SIZE = 24;
const TEXT_SIZE = 11;
const LINE_GAP = 20;
const LABEL_WIDTH = 130;

export function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) === PDF_MAGIC;
}

/** Les polices standard du PDF n'encodent que WinAnsi : tout autre caractère devient « ? ». */
const winAnsi = (text: string) => text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function writeLines(page: PDFPage, lines: readonly [string, string][], top: number, fonts: { regular: PDFFont; bold: PDFFont }): number {
  let y = top;
  for (const [label, value] of lines) {
    page.drawText(winAnsi(label), { x: MARGIN, y, size: TEXT_SIZE, font: fonts.bold });
    page.drawText(winAnsi(value), { x: MARGIN + LABEL_WIDTH, y, size: TEXT_SIZE, font: fonts.regular });
    y -= LINE_GAP;
  }
  return y;
}

/** PDF d'une page : la facture en clair pour le fournisseur, la facture attestée embarquée pour Bari. */
export async function signedInvoicePdf(file: AttestedInvoiceFile, supplier: Pick<BusinessLookup, "company" | "vatNumber">): Promise<Uint8Array> {
  const { invoice, attestation } = file;
  const document = await PDFDocument.create();
  document.setTitle(`Signed invoice ${invoice.number}`);
  document.setSubject(`Confirmed by ${invoice.debtorName} on Atlas`);
  document.setProducer("Atlas");
  // Le dictionnaire d'informations existe dès le titre posé.
  document.context.lookup(document.context.trailerInfo.Info, PDFDict).set(ATTESTATION_KEY, PDFHexString.fromText(JSON.stringify(file)));

  const fonts = { regular: await document.embedFont(StandardFonts.Helvetica), bold: await document.embedFont(StandardFonts.HelveticaBold) };
  const page = document.addPage(PAGE_SIZE);
  const [, height] = PAGE_SIZE;
  page.drawText("Signed invoice", { x: MARGIN, y: height - MARGIN - TITLE_SIZE, size: TITLE_SIZE, font: fonts.bold });
  const dueDate = new Date(Number(attestation.dueDate) * MS_PER_SECOND + NOON_MS).toISOString();
  const bottom = writeLines(
    page,
    [
      ["Invoice number", invoice.number],
      ["Supplier", `${supplier.company} · ${supplier.vatNumber}`],
      ["Public body", invoice.debtorName],
      ["Description", invoice.description],
      ["Issue date", formatDate(invoice.issueDate)],
      ["Total", formatUsd(Number(attestation.amountCents) / CENTS_PER_USD)],
      ["Due date", formatDate(dueDate)],
    ],
    height - MARGIN - TITLE_SIZE - 2 * LINE_GAP,
    fonts,
  );
  const notes = [
    `Confirmed by ${invoice.debtorName} on Atlas. This file carries its signature.`,
    "Drop it in your Atlas space to get paid now: it is checked in your browser and never uploaded.",
  ];
  notes.forEach((note, index) => {
    page.drawText(winAnsi(note), { x: MARGIN, y: bottom - LINE_GAP * (index + 1), size: TEXT_SIZE, font: fonts.regular });
  });
  return document.save();
}

/**
 * Texte de la facture attestée déposée : celui embarqué dans un PDF signé (undefined si le PDF n'en porte pas ou est
 * illisible), ou le fichier lui-même (un `.bari.json`).
 */
export async function signedInvoiceText(bytes: Uint8Array): Promise<string | undefined> {
  if (!isPdf(bytes)) return new TextDecoder().decode(bytes);
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const info = document.context.trailerInfo.Info;
    const value = info === undefined ? undefined : document.context.lookup(info, PDFDict).lookup(ATTESTATION_KEY);
    return value instanceof PDFHexString || value instanceof PDFString ? value.decodeText() : undefined;
  } catch {
    return undefined;
  }
}
