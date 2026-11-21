// Navigation : logo, les trois espaces, Transparency, puis la connexion ou le menu du compte.
import { ROLE_COPY } from "../features/account/roles";
import { LANDING_ROUTE, SIGNIN_ROUTE, spaceRoute, TRANSPARENCY_ROUTE } from "../routes";
import { useSession } from "../session";
import { SpiralMark } from "../ui/SpiralMark";
import { AccountMenu } from "./AccountMenu";

const LINKS = [
  { href: spaceRoute("lender"), label: "Lend" },
  { href: spaceRoute("public_body"), label: ROLE_COPY.public_body.space },
  { href: spaceRoute("business"), label: ROLE_COPY.business.space },
  { href: TRANSPARENCY_ROUTE, label: "Transparency" },
];

export function Nav() {
  const session = useSession();
  return (
    <header className="nav">
      <a className="logo" href={LANDING_ROUTE}>
        <SpiralMark size={34} className="logo-mark" />
        atlas
        <span className="logo-dot" aria-hidden="true">
          .
        </span>
      </a>
      <nav className="nav-links" aria-label="Main">
        {LINKS.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
        {session.status === "signedIn" && <AccountMenu user={session.user} />}
        {session.status === "signedOut" && (
          <a className="button button-ghost" href={SIGNIN_ROUTE}>
            Sign in
          </a>
        )}
      </nav>
    </header>
  );
}
