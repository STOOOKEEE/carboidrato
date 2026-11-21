// Carte du compte dans un espace : identité déclarée, niveau de vérification, credential et compte XRPL géré.
import type { AccountView } from "../../../../src/api/contract";
import { Details } from "../../ui/Details";
import { Facts, type Fact } from "../../ui/Facts";

function profileFacts(user: AccountView): Fact[] {
  switch (user.role) {
    case "lender":
      return [
        { label: "Name", value: user.profile.name },
        { label: "Country", value: user.profile.country },
        { label: "Credential", value: "KYC_INVESTOR, valid 1 year" },
      ];
    case "business":
      return [
        { label: "Company", value: user.profile.company },
        { label: "VAT number", value: user.profile.vatNumber },
        { label: "Credential", value: "KYB_PME, valid 1 year" },
      ];
    case "public_body":
      return [
        { label: "Public body", value: user.profile.name },
        { label: "IPA code", value: user.profile.ipaCode },
      ];
  }
}

export function AccountCard({ user }: { user: AccountView }) {
  return (
    <section className="step" data-testid="account-card">
      <h2>Your account</h2>
      <Facts facts={[{ label: "Email", value: user.email }, ...profileFacts(user), { label: "Verification", value: user.verification }]} />
      {user.address !== undefined && (
        <Details summary="your XRPL account, managed by Bari">
          <p className="mono">{user.address}</p>
        </Details>
      )}
    </section>
  );
}
