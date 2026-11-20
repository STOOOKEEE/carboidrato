// API ZK de Bari (IDEE §7.3) : attestation simulée du débiteur, liste des débiteurs vérifiés,
// preuve Groth16, vérification, encodage pour MPTokenMetadata.

export { DOMAIN_N, DOMAIN_P, MERKLE_DEPTH } from "./constants.js";
export {
  attestInvoice,
  computeAttestedMessage,
  computeInvoiceUuid,
  deriveDebtor,
  invoiceNullifier,
  verifyAttestation,
  type DebtorAttestation,
  type DebtorIdentity,
  type DebtorPublicKey,
  type EdDSASignature,
  type InvoiceClaim,
} from "./debtor.js";
export { accountToField, fieldToAccount, fromHex, toHex32 } from "./field.js";
export { releaseZkResources } from "./lifecycle.js";
export { buildDebtorList, debtorLeaf, merklePath, type DebtorList, type MerklePath } from "./merkle.js";
export {
  decodeProofFromMetadata,
  encodeProofForMetadata,
  ENCODED_PROOF_BYTES,
  MPT_METADATA_MAX_BYTES,
} from "./metadata.js";
export { prove, type CommitmentOpening, type ProveInput, type ProvenInvoice } from "./prover.js";
export {
  parsePublicSignals,
  PUBLIC_SIGNAL_ORDER,
  statementHex,
  type InvoiceProof,
  type InvoiceStatement,
  type PublicSignalName,
  type StatementHex,
} from "./statement.js";
export { verify, type ExpectedPublicInputs, type VerificationResult } from "./verifier.js";
