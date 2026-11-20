import { useEffect, useState } from "react";
import { AppPage } from "./app/AppPage";
import { Landing } from "./landing/Landing";
import { APP_ROUTE } from "./routes";

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
  useEffect(() => {
    if (inApp) window.scrollTo(0, 0);
  }, [inApp]);
  return inApp ? <AppPage /> : <Landing />;
}
