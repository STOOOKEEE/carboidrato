// Faux `Ledger` en mémoire pour les tests : on y dépose les objets et transactions, il répond comme le nœud.

import type { AccountObjectType, LedgerEntry } from "xrpl";
import type { Ledger, LedgerTransaction } from "./ledger.js";

const HEX = /^[0-9A-F]+$/i;

/** Les identifiants hex sont insensibles à la casse, comme pour rippled ; les adresses ne le sont pas. */
const key = (...parts: string[]) => parts.map((part) => (HEX.test(part) ? part.toUpperCase() : part)).join("/");

export class FakeLedger implements Ledger {
  private readonly credentials = new Map<string, LedgerEntry.Credential>();
  private readonly issuances = new Map<string, LedgerEntry.MPTokenIssuance>();
  private readonly balances = new Map<string, bigint>();
  private readonly vaults = new Map<string, LedgerEntry.Vault>();
  private readonly brokers = new Map<string, LedgerEntry.LoanBroker>();
  private readonly objects = new Map<string, LedgerEntry.LedgerEntry[]>();
  private readonly transactions = new Map<string, LedgerTransaction>();
  private time = 0;

  constructor(private readonly id: number | undefined) {}

  putCredential(credential: LedgerEntry.Credential): void {
    this.credentials.set(key(credential.Subject, credential.Issuer, credential.CredentialType), credential);
  }

  putMptIssuance(id: string, issuance: LedgerEntry.MPTokenIssuance): void {
    this.issuances.set(key(id), issuance);
  }

  putMptBalance(id: string, holder: string, amount: bigint): void {
    this.balances.set(key(id, holder), amount);
  }

  putVault(vault: LedgerEntry.Vault): void {
    this.vaults.set(key(vault.index), vault);
  }

  /** Le LoanBroker est aussi listé parmi les objets de son propriétaire. */
  putLoanBroker(broker: LedgerEntry.LoanBroker): void {
    this.brokers.set(key(broker.index), broker);
    this.putAccountObject(broker.Owner, "loan_broker", broker);
  }

  putAccountObject(account: string, type: AccountObjectType, entry: LedgerEntry.LedgerEntry): void {
    const entries = this.objects.get(key(account, type)) ?? [];
    this.objects.set(key(account, type), [...entries, entry]);
  }

  putTransaction(transaction: LedgerTransaction): void {
    this.transactions.set(key(transaction.hash), transaction);
  }

  /** Heure de clôture du ledger validé (secondes depuis l'époque Ripple), 0 par défaut. */
  setCloseTime(time: number): void {
    this.time = time;
  }

  networkId(): number | undefined {
    return this.id;
  }

  async credential(subject: string, issuer: string, typeHex: string): Promise<LedgerEntry.Credential | undefined> {
    return this.credentials.get(key(subject, issuer, typeHex));
  }

  async mptIssuance(id: string): Promise<LedgerEntry.MPTokenIssuance | undefined> {
    return this.issuances.get(key(id));
  }

  async mptBalance(id: string, holder: string): Promise<bigint> {
    return this.balances.get(key(id, holder)) ?? 0n;
  }

  async vault(id: string): Promise<LedgerEntry.Vault> {
    const vault = this.vaults.get(key(id));
    if (vault === undefined) throw new Error(`Vault introuvable : ${id}`);
    return vault;
  }

  async loanBroker(id: string): Promise<LedgerEntry.LoanBroker> {
    const broker = this.brokers.get(key(id));
    if (broker === undefined) throw new Error(`LoanBroker introuvable : ${id}`);
    return broker;
  }

  async accountObjects(account: string, type: AccountObjectType): Promise<LedgerEntry.LedgerEntry[]> {
    return this.objects.get(key(account, type)) ?? [];
  }

  async transaction(hash: string): Promise<LedgerTransaction | undefined> {
    return this.transactions.get(key(hash));
  }

  async closeTime(): Promise<number> {
    return this.time;
  }
}
