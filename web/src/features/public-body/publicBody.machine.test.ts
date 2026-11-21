// Parcours de l'organisme public, pur : fichier lu, champs (formulaire si besoin), fournisseur retrouvé, signature.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AttestedInvoiceFile, BusinessLookup } from "../../../../src/api/contract";
import type { FatturaReading } from "./fatturaPA";
import {
  downloadName,
  EMPTY_FORM,
  initialState,
  isEditable,
  pendingSupplierVat,
  publicBodyTransition,
  signBlocker,
  validateForm,
  type PublicBodyEvent,
  type PublicBodyState,
} from "./publicBody.machine";

const VAT = "IT07543210725";
const SUPPLIER: BusinessLookup = { company: "Fornitore S.r.l.", vatNumber: VAT, address: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe" };

const READ: FatturaReading = {
  ok: true,
  invoice: {
    vatNumber: VAT,
    number: "FT-2026-0901",
    issueDate: "2026-11-20",
    amountCents: 1_034_000n,
    dueDate: "2027-02-18",
    description: "Manutenzione strade",
  },
};

const VALID_FORM = { vatNumber: VAT, number: "FT-2026-0901", issueDate: "2026-11-20", amount: "10340.00", dueDate: "2027-02-18" };

const run = (events: PublicBodyEvent[], from: PublicBodyState = initialState) => events.reduce(publicBodyTransition, from);

const FILE_READ: PublicBodyEvent = { type: "FILE_READ", fileName: "FT-2026-0901.xml", reading: READ };
const FOUND: PublicBodyEvent[] = [
  { type: "LOOKUP_STARTED", vat: VAT },
  { type: "LOOKUP_DONE", vat: VAT, business: SUPPLIER },
];

function review(state: PublicBodyState) {
  assert.equal(state.status, "review");
  return state as Extract<PublicBodyState, { status: "review" }>;
}

describe("fichier déposé", () => {
  test("une FatturaPA complète remplit les champs, en lecture seule", () => {
    const state = review(run([FILE_READ]));
    assert.equal(state.source, "fatturapa");
    assert.deepEqual(state.form, VALID_FORM);
    assert.equal(state.description, "Manutenzione strade");
    assert.equal(isEditable(state), false);
    assert.equal(pendingSupplierVat(state), VAT);
    assert.equal(signBlocker(state), "Looking up the supplier…");
  });

  test("une FatturaPA incomplète ouvre le formulaire avec les champs lus", () => {
    const reading: FatturaReading = {
      ok: false,
      reason: "missing",
      missing: ["amount", "dueDate"],
      found: { vatNumber: VAT, number: "FT-2026-0901", issueDate: "2026-11-20" },
    };
    const state = review(run([{ type: "FILE_READ", fileName: "f.xml", reading }]));
    assert.equal(state.source, "partial");
    assert.deepEqual(state.form, { ...VALID_FORM, amount: "", dueDate: "" });
    assert.equal(isEditable(state), true);
  });

  test("un autre fichier ouvre le formulaire vide", () => {
    const state = review(run([{ type: "FILE_READ", fileName: "scan.pdf", reading: { ok: false, reason: "not-fatturapa" } }]));
    assert.equal(state.source, "other");
    assert.deepEqual(state.form, EMPTY_FORM);
    assert.equal(pendingSupplierVat(state), undefined);
    assert.equal(signBlocker(state), "Enter the supplier's VAT number");
  });

  test("une facture dans une autre devise est refusée, sans formulaire", () => {
    const state = run([{ type: "FILE_READ", fileName: "f.xml", reading: { ok: false, reason: "currency", currency: "JPY" } }]);
    assert.deepEqual(state, { status: "empty", refusal: "This invoice is in JPY. Bari finances invoices in US dollars (USD) only." });
  });
});

describe("fournisseur retrouvé par son n° de TVA", () => {
  test("trouvé : la signature est possible", () => {
    const state = review(run([FILE_READ, ...FOUND]));
    assert.deepEqual(state.supplier, { status: "found", vat: VAT, business: SUPPLIER });
    assert.equal(pendingSupplierVat(state), undefined);
    assert.equal(signBlocker(state), undefined);
  });

  test("pendant la recherche, puis inconnu de Bari : la signature attend", () => {
    const looking = run([FILE_READ, { type: "LOOKUP_STARTED", vat: VAT }]);
    assert.equal(signBlocker(looking), "Looking up the supplier…");
    const unknown = run([{ type: "LOOKUP_DONE", vat: VAT, business: undefined }], looking);
    assert.deepEqual(review(unknown).supplier, { status: "unknown", vat: VAT });
    assert.equal(signBlocker(unknown), "The supplier needs a Bari account first");
  });

  test("une recherche en échec donne sa cause", () => {
    const state = review(run([FILE_READ, { type: "LOOKUP_STARTED", vat: VAT }, { type: "LOOKUP_FAILED", vat: VAT, message: "HTTP 500" }]));
    assert.deepEqual(state.supplier, { status: "failed", vat: VAT, message: "HTTP 500" });
    assert.equal(signBlocker(state), "The supplier could not be looked up");
  });

  test("une réponse pour un autre n° de TVA est ignorée", () => {
    const state = run([
      FILE_READ,
      { type: "LOOKUP_STARTED", vat: VAT },
      { type: "LOOKUP_DONE", vat: "IT00000000000", business: SUPPLIER },
    ]);
    assert.deepEqual(review(state).supplier, { status: "looking", vat: VAT });
  });

  test("changer le n° de TVA relance la recherche, sous forme normalisée", () => {
    const state = run([FILE_READ, ...FOUND, { type: "EDIT", field: "vatNumber", value: " it 0123 4567 890 " }]);
    assert.deepEqual(review(state).supplier, { status: "none" });
    assert.equal(pendingSupplierVat(state), "IT01234567890");
  });

  test("un nouveau fichier du même fournisseur relance la recherche", () => {
    const state = run([FILE_READ, ...FOUND, FILE_READ]);
    assert.equal(pendingSupplierVat(state), VAT);
  });
});

describe("validation des champs", () => {
  test("un formulaire valide donne la facture à signer, montant exact en centimes", () => {
    const validation = validateForm({ ...VALID_FORM, vatNumber: "it 0754 3210 725", number: "  FT-2026-0901 ", amount: "10340,5" }, "");
    assert.deepEqual(validation, {
      ok: true,
      draft: {
        vatNumber: VAT,
        number: "FT-2026-0901",
        issueDate: "2026-11-20",
        amountCents: 1_034_050n,
        dueDate: "2027-02-18",
        description: "Invoice FT-2026-0901",
      },
    });
  });

  test("chaque champ invalide a son message", () => {
    const validation = validateForm({ vatNumber: "0754", number: " ", issueDate: "2026-02-30", amount: "10.340,00", dueDate: "" }, "");
    assert.deepEqual(validation, {
      ok: false,
      errors: {
        vatNumber: "Enter the supplier's VAT number with its country code, e.g. IT01234567890",
        number: "Enter the invoice number",
        issueDate: "Enter the issue date",
        amount: "Enter the total in US dollars, e.g. 10340.00",
        dueDate: "Enter the due date",
      },
    });
  });

  test("l'échéance doit suivre l'émission, le montant être positif", () => {
    const validation = validateForm({ ...VALID_FORM, amount: "0", dueDate: "2026-11-20" }, "x");
    assert.deepEqual(validation, {
      ok: false,
      errors: { amount: "Enter the total in US dollars, e.g. 10340.00", dueDate: "The due date must come after the issue date" },
    });
  });
});

describe("signature", () => {
  const signed: AttestedInvoiceFile = {
    format: "bari.attested-invoice.v1",
    invoice: { number: "FT-2026/0901", debtorName: "Regione Puglia", description: "d", issueDate: "2026-11-20T00:00:00.000Z" },
    attestation: {
      account: SUPPLIER.address,
      amountCents: "1034000",
      dueDate: "1802649600",
      networkId: 1000,
      registry: SUPPLIER.address,
      uuid: "00",
      debtorPublicKey: { ax: "1", ay: "2" },
      signature: { r8x: "3", r8y: "4", s: "5" },
    },
  };

  test("des champs invalides bloquent la signature et rouvrent le formulaire", () => {
    const state = review(
      run([FILE_READ, ...FOUND, { type: "SIGN", validation: { ok: false, errors: { dueDate: "The due date must come after the issue date" } } }]),
    );
    assert.equal(isEditable(state), true);
    const edited = review(run([{ type: "EDIT", field: "dueDate", value: "2027-03-01" }], state));
    assert.deepEqual(edited.errors, {});
  });

  test("signée dans la page, le fichier est prêt à télécharger", () => {
    const signing = run([FILE_READ, ...FOUND, { type: "SIGN", validation: { ok: true } }]);
    assert.equal(signing.status, "signing");
    assert.equal(signBlocker(signing), "Signing in your browser…");
    const done = run([{ type: "SIGNED", file: signed }], signing);
    assert.deepEqual(done, { status: "signed", file: signed, fileName: "FT-2026-0901.bari.json", supplier: SUPPLIER });
  });

  test("un échec de signature revient aux champs avec sa cause", () => {
    const state = review(run([FILE_READ, ...FOUND, { type: "SIGN", validation: { ok: true } }, { type: "SIGN_FAILED", message: "HTTP 403" }]));
    assert.equal(state.signError, "HTTP 403");
    assert.equal(signBlocker(state), undefined);
  });

  test("sans fournisseur retrouvé, la demande de signature est ignorée", () => {
    const state = run([FILE_READ, { type: "SIGN", validation: { ok: true } }]);
    assert.equal(state.status, "review");
  });

  test("« Confirm another invoice » repart de zéro", () => {
    assert.deepEqual(run([FILE_READ, ...FOUND, { type: "SIGN", validation: { ok: true } }, { type: "SIGNED", file: signed }, { type: "RESET" }]), initialState);
  });

  test("le nom du fichier téléchargé suit le numéro, sans caractère interdit", () => {
    assert.equal(downloadName("FT-2026-0815"), "FT-2026-0815.bari.json");
    assert.equal(downloadName(" FT 2026/0815 "), "FT-2026-0815.bari.json");
  });
});
