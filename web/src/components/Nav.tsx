import { APP_ROUTE, LANDING_ROUTE } from "../routes";

export function Nav({ inApp = false }: { inApp?: boolean }) {
  return (
    <header className="nav">
      <a className="logo" href={LANDING_ROUTE}>
        <span className="logo-mark" aria-hidden="true" />
        bari
      </a>
      <nav className="nav-links">
        {!inApp && (
          <>
            <a href="#simulate">Simulate</a>
            <a href="#how">How it works</a>
          </>
        )}
        {inApp ? (
          <a className="button button-ghost" href={LANDING_ROUTE}>
            Back to site
          </a>
        ) : (
          <a className="button" href={APP_ROUTE}>
            Open app
          </a>
        )}
      </nav>
    </header>
  );
}
