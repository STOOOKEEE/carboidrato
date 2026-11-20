// Libellés des contrôles de la simulation : ce qui est vérifié, et ce que veut dire un échec.

import type { CheckId, CheckResult } from "../../src/api/contract";

interface CheckCopy {
  label: string;
  ok: string;
  fail: string;
  /** Titre du verdict quand ce contrôle est le premier à échouer. */
  rejection: string;
}

export const CHECK_COPY: Record<CheckId, CheckCopy> = {
  signature: {
    label: "Debtor signature",
    ok: "Signed by your client, untouched since",
    fail: "Content changed after your client signed it",
    rejection: "Forged invoice",
  },
  debtor: {
    label: "Verified debtor",
    ok: "On Bari's list of verified public bodies",
    fail: "Not on Bari's list of verified public bodies",
    rejection: "Unverified debtor",
  },
  network: {
    label: "Issued for Bari",
    ok: "Bound to Bari's registry on this ledger",
    fail: "Issued for another ledger or registry",
    rejection: "Wrong network",
  },
  amount: {
    label: "Invoice value",
    ok: "Worth at least the amount the proof will show",
    fail: "Below the minimum invoice value this fund finances",
    rejection: "Invoice too small",
  },
  dueDate: {
    label: "Due date",
    ok: "Not yet due",
    fail: "Already past its due date",
    rejection: "Invoice expired",
  },
  unique: {
    label: "Never financed",
    ok: "Fingerprint absent from the XRPL registry",
    fail: "Fingerprint already in the XRPL registry",
    rejection: "Already financed",
  },
};

export function firstFailure(checks: CheckResult[]): CheckCopy | undefined {
  const failed = checks.find((check) => !check.ok);
  return failed === undefined ? undefined : CHECK_COPY[failed.id];
}
