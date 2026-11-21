// Carte du compte dans un espace : identité déclarée, niveau de vérification, credential et compte XRPL (géré ou wallet).
import type { AccountView } from "../../../../src/api/contract";
import { Details } from "../../ui/Details";
import { Facts, type Fact } from "../../ui/Facts";

/** Credential émis par Bari à l'ouverture d'un compte géré ; un compte ouvert par wallet n'en a pas encore. */
const CREDENTIALS = { lender: "KYC_INVESTOR, valid 1 year", business: "KYB_PME, valid 1 year" } as const;

function profileFacts(user: AccountView): Fact[] {
  switch (user.role) {
    case "lender":
      return [
        { label: "Name", value: user.profile.name },
        { label: "Country", value: user.profile.country },
      ];
    case "business":
      return [
        { label: "Company", value: user.profile.company },
        { label: "VAT number", value: user.profile.vatNumber },
      ];
    case "public_body":
      return [
        { label: "Public body", value: user.profile.name },
        { label: "IPA code", value: user.profile.ipaCode },
      ];
  }
}

function identityFacts(user: AccountView): Fact[] {
  const credential =
    user.custody === "managed" && user.role !== "public_body" ? [{ label: "Credential", value: CREDENTIALS[user.role] }] : [];
  const email = user.email === undefined ? [] : [{ label: "Email", value: user.email }];
  return [...email, ...profileFacts(user), ...credential, { label: "Verification", value: user.verification }];
}

export function AccountCard({ user }: { user: AccountView }) {
  return (
    <section className="step" data-testid="account-card">
      <h2>Your account</h2>
      <Facts facts={identityFacts(user)} />
      {user.address !== undefined && (
        <Details summary={user.custody === "wallet" ? "your XRPL wallet, connected with Otsu" : "your XRPL account, managed by Bari"}>
          <p className="mono">{user.address}</p>
        </Details>
      )}
    </section>
  );
}
