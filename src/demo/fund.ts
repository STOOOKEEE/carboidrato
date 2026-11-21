// `npm run demo:fund` : fonds durable, deux prêts historiques et comptes du pitch, repris par l'API ; factures du pitch libres.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, isoTimeToRippleTime, rippleTimeToISOTime, unixTimeToRippleTime } from "xrpl";
import { loadActors, type Actors } from "../accounts/actors.js";
import { makeFunder } from "../accounts/funding.js";
import { UserStore, type UserRecord } from "../accounts/userStore.js";
import { loadApiConfig } from "../api/fund/config.js";
import { FundStateStore, loanState, type LoanStatus } from "../api/fund/stateStore.js";
import { loadCohortTiming } from "../config/cohort.js";
import { BARI_EURC_RESERVE_EUR, BARI_SHARE_STOCK_EUR } from "../config/finance.js";
import { loadNetworkConfig, type NetworkConfig } from "../config/network.js";
import type { Fund } from "../fund/fund.js";
import { DEMO_DEBTOR, VERIFIED_DEBTORS } from "../invoice/debtors.js";
import { buildDemoInvoice } from "../invoice/invoice.js";
import { makeProvisioner } from "../kyb/onboarding.js";
import { loanTerms } from "../lending/loanTerms.js";
import { repayLoan } from "../lending/repayment.js";
import { eurToUnits, formatEur } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { xrplLedger } from "../xrpl/ledger.js";
import { sendMpt } from "../xrpl/mpt.js";
import { ledgerTime } from "../xrpl/ledgerTime.js";
import { clientSubmitter } from "../xrpl/submit.js";
import { computeInvoiceUuid, deriveDebtor, invoiceNullifier, releaseZkResources, toHex32 } from "../zk/index.js";
import { financeInvoice, openFund, type FinancedInvoice } from "./financing.js";
import { isReusable, mairieTopUp } from "./fundReuse.js";
import {
  generatePassword,
  parsePitchCredentials,
  PITCH_ACCOUNTS,
  planPitchAccount,
  renderPitchCredentials,
  shortAddress,
  type PitchCredential,
} from "./pitchAccounts.js";
import { PITCH_INVOICES } from "./sampleInvoices.js";

/** Seul endroit où vivent les mots de passe des comptes du pitch (exclu de git). */
const PITCH_CREDENTIALS_FILE = fileURLToPath(new URL("../../.hack/pitch-accounts.md", import.meta.url));
/** Rachat du fonds durable : la phase d'investissement couvre le pitch et les e2e jusque-là. */
const DURABLE_REDEMPTION_DATE = isoTimeToRippleTime("2027-03-31T00:00:00Z");
const HISTORICAL_LOAN_INDEXES = [1, 2];
/** Pas la Comune di Bari : sa facture en direct (9 % du fonds) doit passer sous la limite de concentration de 20 %. */
const HISTORICAL_DEBTOR = VERIFIED_DEBTORS[1];

async function createFund(client: Client, store: FundStateStore): Promise<void> {
  const { actors, fund } = await openFund(
    client,
    { subscriptionWindowS: loadCohortTiming().subscriptionWindowS, redemptionDate: DURABLE_REDEMPTION_DATE },
    { shareStock: eurToUnits(BARI_SHARE_STOCK_EUR), reserve: eurToUnits(BARI_EURC_RESERVE_EUR) },
  );

  // Même débiteur pour les deux factures : même pseudonyme, la concentration ressort à l'audit.
  const runId = Date.now().toString(36);
  const financed: FinancedInvoice[] = [];
  for (const index of HISTORICAL_LOAN_INDEXES) {
    financed.push(await financeInvoice(client, actors, fund, buildDemoInvoice(HISTORICAL_DEBTOR, runId, index), index));
  }

  // Le premier prêt est déjà soldé : l'historique montre un remboursement et un prêt en cours.
  const [repaid] = financed;
  log.step("Prêt 1 · remboursement (mairie → PME, LoanPay, retour du MPT facture)");
  const demoParties = { mairie: actors.mairie, borrower: actors.sme, bari: actors.bari };
  await repayLoan(clientSubmitter(client), xrplLedger(client), demoParties, fund, repaid.loan);

  // Persisté une fois le fonds complet : une exécution interrompue laisse l'état précédent intact.
  const now = new Date().toISOString();
  store.reset(fund);
  store.update((state) => {
    state.deposited = true;
    for (const entry of financed) {
      const status: LoanStatus = entry === repaid ? "repaid" : "active";
      const { tokenId, certificate } = entry.issued;
      state.invoices.push({ tokenId, certificate, issuedAt: now, owner: actors.sme.address });
      state.loans.push(loanState(entry.loan, actors.sme.address, status, now));
    }
  });
  log.step(`Fonds de démo prêt en ${log.elapsedSeconds()} s`);
  log.info(`Vault ${fund.cohort.vaultId}, rachat dès ${rippleTimeToISOTime(fund.cohort.redemptionDate)}`);
}

/** Le remboursement d'un prêt passe par un paiement de la mairie : sa réserve est remise au plancher à chaque lancement. */
async function topUpMairie(client: Client, actors: Actors, fund: Fund): Promise<void> {
  const balance = await xrplLedger(client).mptBalance(fund.assetId, actors.mairie.address);
  const missing = mairieTopUp(balance, loanTerms().invoice);
  if (missing === 0n) return;
  const label = `Payment EURc → mairie (${formatEur(missing, 2)})`;
  await sendMpt(client, fund.assetId, actors.stable_issuer, actors.mairie.address, missing, label);
}

/** Crée les comptes du pitch absents par le chemin de l'inscription ; renvoie les comptes prêts et les conflits. */
async function ensurePitchAccounts(
  client: Client,
  network: NetworkConfig,
  actors: Actors,
  fund: Fund,
  users: UserStore,
): Promise<{ ready: UserRecord[]; conflicts: string[] }> {
  const passwords = existsSync(PITCH_CREDENTIALS_FILE)
    ? parsePitchCredentials(readFileSync(PITCH_CREDENTIALS_FILE, "utf8"))
    : new Map<string, string>();
  const provisionAccount = makeProvisioner({
    submit: clientSubmitter(client),
    fundAccount: makeFunder(client, network),
    kycIssuer: actors.kyb_issuer,
    fund: () => ({ assetId: fund.assetId, shareMptId: fund.cohort.shareMptId }),
    now: () => unixTimeToRippleTime(Date.now()),
  });
  const saveCredentials = () => {
    const entries: PitchCredential[] = PITCH_ACCOUNTS.flatMap(({ email, role }) => {
      const password = passwords.get(email);
      return password === undefined ? [] : [{ email, role, password }];
    });
    writeFileSync(PITCH_CREDENTIALS_FILE, renderPitchCredentials(entries), { mode: 0o600 });
  };

  const ready: UserRecord[] = [];
  const conflicts: string[] = [];
  for (const account of PITCH_ACCOUNTS) {
    const plan = planPitchAccount(account, users);
    if (plan.action === "conflict") {
      conflicts.push(plan.reason);
      continue;
    }
    if (plan.action === "reuse") {
      log.info(`compte du pitch réutilisé : ${account.email} (${account.role})`);
      if (!passwords.has(account.email)) log.warn(`mot de passe de ${account.email} absent de ${PITCH_CREDENTIALS_FILE}`);
      ready.push(plan.user);
      continue;
    }
    log.step(`Compte du pitch : ${account.email} (${account.role})`);
    const password = generatePassword();
    const managed = await provisionAccount(account);
    ready.push(await users.create({ ...account, password }, managed));
    passwords.set(account.email, password);
    saveCredentials();
  }
  saveCredentials();
  return { ready, conflicts };
}

/** N de chaque facture du pitch, calculé comme à l'attestation (clé HMAC de la Comune di Bari), cherché dans le registre. */
async function registeredPitchInvoices(client: Client, fund: Fund): Promise<string[]> {
  const debtor = await deriveDebtor(DEMO_DEBTOR.name);
  const credentials = await xrplLedger(client).accountObjects(fund.manifest.registry, "credential");
  const registeredTypes = new Set(
    credentials.flatMap((entry) => (entry.LedgerEntryType === "Credential" ? [entry.CredentialType.toUpperCase()] : [])),
  );
  const registered: string[] = [];
  for (const { number } of PITCH_INVOICES) {
    const nullifier = toHex32(await invoiceNullifier(computeInvoiceUuid(debtor.hmacKey, number)));
    const isRegistered = registeredTypes.has(nullifier);
    log.info(`${number} · N=${nullifier.slice(0, 12)}… · ${isRegistered ? "ENREGISTRÉE" : "non enregistrée"}`);
    if (isRegistered) registered.push(number);
  }
  return registered;
}

async function main(): Promise<void> {
  const network = loadNetworkConfig();
  const apiConfig = loadApiConfig(network);
  const store = new FundStateStore(apiConfig.stateFile);
  const client = new Client(network.wsUrl);
  await client.connect();
  try {
    const current = store.current;
    if (current !== undefined && isReusable(current, await ledgerTime(client))) {
      log.info(
        `fonds réutilisé : Vault ${current.fund.cohort.vaultId} en phase d'investissement jusqu'à ${rippleTimeToISOTime(current.fund.cohort.redemptionDate)}`,
      );
    } else {
      await createFund(client, store);
    }
    const { fund } = store.current ?? {};
    if (fund === undefined) throw new Error("fonds absent de l'état après sa création");
    const actors = loadActors(network);
    await topUpMairie(client, actors, fund);

    const { ready, conflicts } = await ensurePitchAccounts(client, network, actors, fund, new UserStore(apiConfig.usersFile));
    log.step("Comptes du pitch prêts");
    for (const user of ready) {
      const where = user.account === undefined ? "pas de compte XRPL" : shortAddress(user.account.address);
      log.info(`${user.email} · ${user.role} · ${where}`);
    }
    log.info(`mots de passe : ${PITCH_CREDENTIALS_FILE}`);
    for (const conflict of conflicts) log.warn(`compte du pitch non créé : ${conflict}`);

    log.step("Factures du pitch (registre anti double-financement)");
    const registered = await registeredPitchInvoices(client, fund);
    const problems = [
      ...conflicts,
      ...(registered.length === 0 ? [] : [`factures du pitch déjà enregistrées : ${registered.join(", ")}`]),
    ];
    if (problems.length > 0) throw new Error(problems.join("\n"));
  } finally {
    await client.disconnect();
    await releaseZkResources();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
