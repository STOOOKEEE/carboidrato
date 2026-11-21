// Coquille de l'app : route lue dans le hash, garde des espaces selon la session, page affichée.
import { useEffect, useState, type ReactNode } from "react";
import type { AccountView, UserRole } from "../../src/api/contract";
import { Layout } from "./app/Layout";
import { WrongRole } from "./app/WrongRole";
import { SigninPage } from "./features/account/SigninPage";
import { SignupPage } from "./features/account/SignupPage";
import { BusinessPage } from "./features/business/BusinessPage";
import { LendPage } from "./features/lend/LendPage";
import { PublicBodyPage } from "./features/public-body/PublicBodyPage";
import { TransparencyPage } from "./features/transparency/TransparencyPage";
import { TxPage } from "./features/tx/TxPage";
import { Landing } from "./landing/Landing";
import { guardRoute, parseRoute, type Route } from "./routes";
import { loadSession, useSession } from "./session";
import { Notice } from "./ui/Notice";

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

const SPACES: Record<UserRole, (props: { user: AccountView }) => ReactNode> = {
  lender: LendPage,
  business: BusinessPage,
  public_body: PublicBodyPage,
};

function page(route: Route, user: AccountView | undefined): ReactNode {
  switch (route.page) {
    case "landing":
      return <Landing />;
    case "signin":
      return <SigninPage />;
    case "signup":
      return <SignupPage key={route.role} role={route.role} />;
    case "transparency":
      return <TransparencyPage />;
    case "tx":
      return <TxPage hash={route.hash} />;
    case "space": {
      const Space = SPACES[route.role];
      return user === undefined ? null : <Space user={user} />;
    }
  }
}

export function App() {
  const hash = useHash();
  const session = useSession();
  const route = parseRoute(hash);
  const guard = guardRoute(route, session);

  useEffect(loadSession, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [hash]);
  const redirectTo = guard.kind === "redirect" ? guard.to : undefined;
  useEffect(() => {
    if (redirectTo !== undefined) window.location.replace(redirectTo);
  }, [redirectTo]);

  let content: ReactNode;
  switch (guard.kind) {
    case "show":
      content = page(route, session.status === "signedIn" ? session.user : undefined);
      break;
    case "loading":
    case "redirect":
      content = (
        <main className="app">
          <Notice kind="info">Opening your space…</Notice>
        </main>
      );
      break;
    case "signin":
      content = <SigninPage key={guard.role} role={guard.role} />;
      break;
    case "wrongRole":
      content = <WrongRole required={guard.required} user={guard.user} />;
      break;
  }
  return <Layout>{content}</Layout>;
}
