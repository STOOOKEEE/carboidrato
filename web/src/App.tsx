import { useEffect, useState } from "react";
import { AppPage } from "./app/AppPage";
import { TxPage } from "./features/tx/TxPage";
import { Landing } from "./landing/Landing";
import { APP_ROUTE, txHashFromRoute } from "./routes";

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const inApp = hash === APP_ROUTE;
  const txHash = txHashFromRoute(hash);
  const onPage = inApp || txHash !== undefined;
  useEffect(() => {
    if (onPage) window.scrollTo(0, 0);
  }, [onPage, hash]);
  if (txHash !== undefined) return <TxPage hash={txHash} />;
  return inApp ? <AppPage /> : <Landing />;
}
