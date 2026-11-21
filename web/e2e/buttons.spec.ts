// Chaque bouton et chaque lien de chaque écran : une liste attendue par écran, chaque effet vérifié au clic ; un contrôle
// visible hors liste, un bouton désactivé sans raison affichée ou un texte factice fait échouer le test.

import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { AccountView, FundAudit, LoanResponse, ProofParams, SignupResponse, TxDetail, UserRole } from "../../src/api/contract";
import { fatturaPaXml, PITCH_SUPPLIER, REGIONE_PUGLIA } from "../../src/demo/sampleInvoices";
import { signedInvoiceText } from "../src/signedInvoicePdf";
import { OTSU_REPO_URL } from "../src/wallet/network";
import { E2E_PUBLIC_BODY, signInPublicBody } from "./publicBodySession";
import { signedInvoice } from "./signedInvoice";

const PASSWORD = "correct horse battery";
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const MS_PER_DAY = 86_400_000;
const TERM_DAYS = 90;
const INVOICE_CENTS = 1_034_000n;
const MINUTE_MS = 60_000;
/** Ouverture d'un compte géré : 4 à 5 transactions validées, un ledger toutes les 3 s sur l'AlphaNet. */
const SIGNUP_TIMEOUT_MS = 120_000;
/** Un ordre du prêteur : Payment, VaultDeposit ou Batch, puis la relecture de la position. */
const TX_TIMEOUT_MS = 90_000;
/** Preuve, certificat (Batch) puis LoanSet co-signé, avec les contrôles de Bari. */
const FUNDING_TIMEOUT_MS = 180_000;
/** Audit du fonds relu sur le ledger, puis chaque preuve vérifiée dans le navigateur. */
const AUDIT_TIMEOUT_MS = 120_000;
/** Page lue par l'API sur le nœud : détail d'une transaction, position du prêteur. */
const PAGE_TIMEOUT_MS = 30_000;

const FORBIDDEN_TEXT = [/\bdemo\b/i, /coming soon/i, /next iteration/i];
const CONTROLS = "button, a[href], summary";
const TX_LINK = "tx link";
const ACCOUNT_MENU = "account menu";
const TX_URL = /#\/tx\/[0-9A-F]{64}$/;
const TX_TITLE = /^\w+ (succeeded|failed|not validated yet)/;
const ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const VERIFIED = /\d+\/\d+ proofs verified in your browser/;
const LANDING_TITLE = /^Your invoice is worth cash\./;
const TRANSPARENCY_TITLE = "Every loan, in the open.";
const SIGNIN_TITLE = "Welcome back.";

const ROLES: UserRole[] = ["lender", "business", "public_body"];
const SPACE_ROUTES: Record<UserRole, string> = { lender: "#/lend", business: "#/business", public_body: "#/public" };
const SPACE_TITLES: Record<UserRole, string> = {
  lender: "Your position.",
  business: "Get paid now.",
  public_body: "Confirm your suppliers' invoices.",
};
const DOOR_TITLES: Record<UserRole, string> = {
  lender: "Sign in to lend.",
  business: "Sign in to get paid.",
  public_body: "Sign in to confirm invoices.",
};
const AUDIENCES: Record<UserRole, string> = { lender: "lenders", business: "businesses", public_body: "public bodies" };
const SIGNUP_TITLES: Record<UserRole, string> = {
  lender: "Open your lender account.",
  business: "Open your business account.",
  public_body: "Confirm invoices for your suppliers.",
};
const ROLE_NAMES: Record<UserRole, string> = { lender: "Lender", business: "Business", public_body: "Public body" };
const SIGNUP_LINKS: Record<UserRole, string> = {
  lender: "Open a lender account",
  business: "Open a business account",
  public_body: "Register your public body",
};
const SAMPLES = ["FT-2026-0815", "FT-2026-0816", "FT-2026-0817"];

interface Viewer {
  role: UserRole;
  email: string;
  password: string;
}

interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

type Effect = (control: Locator, screen: Screen) => Promise<void>;
/** Clé du contrôle, effet vérifié au clic et, s'il est replié, ce qu'il faut ouvrir pour l'atteindre. */
type Control = [key: string | RegExp, effect: Effect, reveal?: Locator];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const routeUrl = (route: string) => new RegExp(`${escapeRegExp(route)}$`);
const signupRoute = (role: UserRole) => `#/signup/${role}`;
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

function spaceTitle(space: UserRole, viewer: UserRole | undefined): string {
  if (viewer === undefined) return DOOR_TITLES[space];
  return viewer === space ? SPACE_TITLES[space] : `This space is for ${AUDIENCES[space]}.`;
}

/** Clés des contrôles visibles et actifs : un bouton désactivé relève de la règle de la raison affichée. */
function controlKeys(page: Page): Promise<string[]> {
  return page
    .locator(CONTROLS)
    .filter({ visible: true })
    .evaluateAll((elements: HTMLElement[]) =>
      elements
        .filter((element) => !(element instanceof HTMLButtonElement && element.disabled))
        .map((element) => {
          if (element.matches('a[href^="#/tx/"]')) return "tx link";
          if (element.matches('[data-testid="account-menu"] > summary')) return "account menu";
          // Le nom accessible : le texte tel qu'écrit (sans la casse imposée par le style), sans les ornements aria-hidden.
          const label = element.cloneNode(true) as HTMLElement;
          label.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
          const name = (element.getAttribute("aria-label") ?? label.textContent ?? "").replace(/\s+/g, " ").trim();
          return `${element.localName === "a" ? "link" : element.localName} "${name}"`;
        }),
    );
}

/**
 * Règle de l'interface (composant Button) : un bouton désactivé est expliqué par une note visible reliée par
 * `aria-describedby`, ou par son propre libellé, alors repris tel quel dans `title` (« Verifying… »).
 */
function unexplainedDisabled(page: Page): Promise<string[]> {
  return page
    .locator("button[disabled]")
    .filter({ visible: true })
    .evaluateAll((buttons: HTMLButtonElement[]) =>
      buttons
        .filter((button) => {
          // textContent : le libellé tel qu'écrit, sans la casse imposée par le style (légende de la zone de dépôt).
          const label = (button.textContent ?? "").replace(/\s+/g, " ").trim();
          const labelled = button.title !== "" && label === button.title.trim();
          const described = (button.getAttribute("aria-describedby") ?? "")
            .split(/\s+/)
            .filter((id) => id !== "")
            .some((id) => {
              const note = document.getElementById(id);
              return note !== null && note.checkVisibility() && note.innerText.trim() !== "";
            });
          return !labelled && !described;
        })
        .map((button) => button.getAttribute("aria-label") ?? button.innerText.trim()),
    );
}

function locate(page: Page, key: string): Locator {
  if (key === TX_LINK) return page.locator('a[href^="#/tx/"]').filter({ visible: true });
  if (key === ACCOUNT_MENU) return page.getByTestId("account-menu").locator("summary");
  const [, kind = "", name = ""] = /^(\w+) "(.*)"$/.exec(key) ?? [];
  const found =
    kind === "link" || kind === "button"
      ? page.getByRole(kind, { name, exact: true })
      : page.locator(kind).filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) });
  return found.filter({ visible: true });
}

/** Un écran dans un état donné : ses contrôles attendus, chacun cliqué une fois avec son effet. */
class Screen {
  private readonly clicked = new Set<string>();
  private ended = false;

  constructor(
    private readonly page: Page,
    private readonly name: string,
    private readonly controls: Control[],
  ) {}

  /** Aucun texte factice, aucun bouton désactivé sans raison, aucun contrôle visible absent de la liste. */
  async audit(): Promise<void> {
    const text = await this.page.locator("body").innerText();
    for (const pattern of FORBIDDEN_TEXT) expect(text, `${this.name} shows ${pattern}`).not.toMatch(pattern);
    expect(await unexplainedDisabled(this.page), `${this.name}: disabled buttons without a shown reason`).toEqual([]);
    const untested = (await controlKeys(this.page)).filter(
      (key) => !this.controls.some(([expected]) => (typeof expected === "string" ? expected === key : expected.test(key))),
    );
    expect(untested, `${this.name}: visible controls missing from the expected list`).toEqual([]);
  }

  async click(key: string | RegExp): Promise<void> {
    const control = this.controls.find(([expected]) => String(expected) === String(key));
    if (control === undefined) throw new Error(`${this.name}: ${String(key)} is not in the expected list`);
    const [, effect, reveal] = control;
    if (reveal !== undefined && (await this.visibleKey(key)) === undefined) await reveal.click();
    await expect
      .poll(() => this.visibleKey(key), { message: `${this.name}: ${String(key)} shows`, timeout: AUDIT_TIMEOUT_MS })
      .toBeDefined();
    const concrete = (await this.visibleKey(key)) ?? String(key);
    const matches = locate(this.page, concrete);
    if (concrete.startsWith("link ")) {
      const hrefs = await matches.evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href")))]);
      expect(hrefs, `${this.name}: every ${concrete} leads to the same place`).toHaveLength(1);
    }
    await test.step(`${this.name}: ${concrete}`, () => effect(matches.first(), this));
    this.clicked.add(String(key));
    if (!this.ended) await this.audit();
  }

  /** L'effet en cours mène à un autre écran (compte créé) : celui-ci n'est plus relu. */
  end(): void {
    this.ended = true;
  }

  /** Relit l'écran puis clique, dans l'ordre de la liste, chaque contrôle pas encore cliqué. */
  async cover(): Promise<void> {
    await this.audit();
    for (const [key] of this.controls) {
      if (!this.clicked.has(String(key))) await this.click(key);
    }
  }

  private async visibleKey(key: string | RegExp): Promise<string | undefined> {
    const keys = await controlKeys(this.page);
    return keys.find((visible) => (typeof key === "string" ? visible === key : key.test(visible)));
  }
}

/** Navigation : nouvelle route et son titre, puis retour à l'écran de départ s'il a changé. */
function goesTo(page: Page, route: string | RegExp, title: string | RegExp): Effect {
  return async (control) => {
    const before = page.url();
    await control.click();
    await expect(page).toHaveURL(typeof route === "string" ? routeUrl(route) : route);
    await expect(heading(page)).toHaveText(title, { timeout: PAGE_TIMEOUT_MS });
    if (page.url() === before) return;
    await page.goBack();
    await expect(page).toHaveURL(before);
  };
}

/** Ancre de la page : la section visée défile à l'écran, sans changer de route. */
function scrollsTo(page: Page, selector: string): Effect {
  return async (control) => {
    const before = page.url();
    await page.evaluate(() => window.scrollTo(0, 0));
    await control.click();
    await expect(page.locator(selector)).toBeInViewport();
    expect(page.url()).toBe(before);
  };
}

/** Résumé d'un `<details>` : il ouvre puis referme son contenu. */
function opensDetails(content: RegExp): Effect {
  return async (summary) => {
    const panel = summary.locator("xpath=following-sibling::*[1]");
    const wasOpen = await panel.isVisible();
    await summary.click();
    await expect(panel).toBeVisible({ visible: !wasOpen });
    await expect(panel).toContainText(content);
    await summary.click();
    await expect(panel).toBeVisible({ visible: wasOpen });
  };
}

function downloads(page: Page, fileName: string, content: RegExp): Effect {
  return async (control) => {
    const download = page.waitForEvent("download");
    await control.click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe(fileName);
    // Un PDF signé est relu comme le fait l'espace entreprise : par la facture attestée qu'il embarque.
    expect(await signedInvoiceText(await readFile(await saved.path()))).toMatch(content);
  };
}

async function chooseFile(page: Page, control: Locator, file: FilePayload): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await control.click();
  await (await chooser).setFiles(file);
}

function posted(page: Page, path: string, timeout: number) {
  return page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === path,
    { timeout },
  );
}

async function signInByApi(page: Page, viewer: Viewer): Promise<void> {
  const response = await page.request.post("/api/auth/signin", { data: { email: viewer.email, password: viewer.password } });
  expect(response.status(), await response.text()).toBe(HTTP_OK);
}

async function signOutByApi(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/signout");
  expect(response.ok(), await response.text()).toBe(true);
}

async function currentUser(page: Page): Promise<AccountView> {
  const response = await page.request.get("/api/me");
  expect(response.status(), await response.text()).toBe(HTTP_OK);
  return (await response.json()) as AccountView;
}

/** Menu du compte : « Sign out » ramène à la landing déconnecté ; la session est rouverte pour la suite de l'écran. */
function signsOut(page: Page, viewer: Viewer): Effect {
  return async (control) => {
    const before = page.url();
    const signedOut = posted(page, "/api/auth/signout", PAGE_TIMEOUT_MS);
    await control.click();
    expect((await signedOut).ok()).toBe(true);
    await expect(page).toHaveURL(routeUrl("#/"));
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(before);
    await signInByApi(page, viewer);
    await page.reload();
    await expect(page.getByTestId("account-menu")).toBeVisible();
  };
}

/** Connexion par Otsu sans l'extension : l'écran explique quoi installer, et le lien ouvre le dépôt d'Otsu. */
function walletControls(page: Page): Control[] {
  const connect = page.getByRole("button", { name: "Connect Otsu wallet" });
  return [
    [
      'button "Connect Otsu wallet"',
      async (control) => {
        await control.click();
        await expect(page.getByRole("alert")).toContainText("Otsu wallet is not installed in this browser.");
      },
    ],
    [
      'link "Get Otsu wallet"',
      async (control) => {
        await page.context().route(`${OTSU_REPO_URL}**`, (route) => route.fulfill({ status: HTTP_OK, body: "Otsu" }));
        const popup = page.waitForEvent("popup");
        await control.click();
        const opened = await popup;
        await expect(opened).toHaveURL(OTSU_REPO_URL);
        await opened.close();
      },
      connect,
    ],
  ];
}

/** Connexion par le formulaire : 200 puis l'écran du rôle ; la session est refermée pour la suite de l'écran. */
function signsIn(page: Page, viewer: Viewer, title: string): Effect {
  return async (control) => {
    const before = page.url();
    await page.getByLabel("Email").fill(viewer.email);
    await page.getByLabel("Password").fill(viewer.password);
    const signedIn = posted(page, "/api/auth/signin", PAGE_TIMEOUT_MS);
    await control.click();
    expect((await signedIn).status()).toBe(HTTP_OK);
    await expect(heading(page)).toHaveText(title);
    await signOutByApi(page);
    await page.goto(before);
    await page.reload();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  };
}

/** Navigation, pied de page et, avec une session, le menu du compte. */
function navControls(page: Page, viewer?: Viewer): Control[] {
  const role = viewer?.role;
  const common: Control[] = [
    ['link "atlas"', goesTo(page, "#/", LANDING_TITLE)],
    ['link "Lend"', goesTo(page, SPACE_ROUTES.lender, spaceTitle("lender", role))],
    ['link "Declare invoice"', goesTo(page, SPACE_ROUTES.public_body, spaceTitle("public_body", role))],
    ['link "Tokenize invoice"', goesTo(page, SPACE_ROUTES.business, spaceTitle("business", role))],
    ['link "Transparency"', goesTo(page, "#/transparency", TRANSPARENCY_TITLE)],
    ['link "Every loan, re-verifiable →"', goesTo(page, "#/transparency", TRANSPARENCY_TITLE)],
  ];
  if (viewer === undefined) return [...common, ['link "Sign in"', goesTo(page, "#/signin", SIGNIN_TITLE)]];
  const menu = page.getByTestId("account-menu");
  const toMySpace = goesTo(page, SPACE_ROUTES[viewer.role], SPACE_TITLES[viewer.role]);
  return [
    ...common,
    [ACCOUNT_MENU, opensDetails(/Sign out/)],
    [
      'link "Open my space"',
      async (control, screen) => {
        await toMySpace(control, screen);
        if ((await menu.getAttribute("open")) !== null) await menu.locator("summary").click();
      },
      menu.locator("summary"),
    ],
    ['button "Sign out"', signsOut(page, viewer), menu.locator("summary")],
  ];
}

function accountCardControls(user: AccountView): Control[] {
  return user.address === undefined ? [] : [['summary "your XRPL account, managed by Atlas"', opensDetails(ADDRESS)]];
}

function roleSwitchLinks(page: Page, role: UserRole): Control[] {
  return ROLES.filter((other) => other !== role).map((other): Control => [
    `link "${ROLE_NAMES[other]}"`,
    goesTo(page, signupRoute(other), SIGNUP_TITLES[other]),
  ]);
}

/** Page d'une transaction : JSON brut, transactions internes d'un Batch, lien explorer sur devnet seulement. */
async function coverTxScreen(page: Page, viewer: Viewer | undefined): Promise<void> {
  const hash = TX_URL.exec(page.url())?.[0].slice("#/tx/".length) ?? "";
  const response = await page.request.get(`/api/tx/${hash}`, { timeout: PAGE_TIMEOUT_MS });
  expect(response.status(), await response.text()).toBe(HTTP_OK);
  const detail = (await response.json()) as TxDetail;
  await expect(heading(page)).toHaveText(TX_TITLE, { timeout: PAGE_TIMEOUT_MS });
  const controls: Control[] = [['summary "raw transaction"', opensDetails(/"TransactionType"/)]];
  if (detail.innerTransactions.length > 0) controls.push([TX_LINK, goesTo(page, TX_URL, TX_TITLE)]);
  const { explorerUrl } = detail;
  if (explorerUrl !== undefined) {
    controls.push([
      'link "Open in the XRPL explorer"',
      async (control) => {
        const popup = page.waitForEvent("popup");
        await control.click();
        const opened = await popup;
        await expect(opened).toHaveURL(explorerUrl);
        await opened.close();
      },
    ]);
  }
  await new Screen(page, `transaction ${detail.type}`, [...controls, ...navControls(page, viewer)]).cover();
}

/**
 * Inscription par l'interface : formulaire (liens, puis « Create my account » vide puis rempli), écran « Your account
 * is ready. » avec ses transactions. La session reste ouverte.
 */
async function coverSignup(page: Page, viewer: Viewer, missing: string, fillProfile: () => Promise<void>): Promise<void> {
  const { role } = viewer;
  await page.goto(`/${signupRoute(role)}`);
  await expect(heading(page)).toHaveText(SIGNUP_TITLES[role]);
  await new Screen(page, `sign-up ${role}`, [
    ...roleSwitchLinks(page, role),
    ...navControls(page),
    [
      'button "Create my account"',
      async (control, screen) => {
        await control.click();
        await expect(page.getByText(missing, { exact: true })).toBeVisible();
        await page.getByLabel("Email").fill(viewer.email);
        await page.getByLabel("Password").fill(viewer.password);
        await fillProfile();
        const created = posted(page, "/api/auth/signup", SIGNUP_TIMEOUT_MS);
        await control.click();
        await expect(page.getByRole("heading", { name: "Verifying…" })).toBeVisible();
        await screen.audit();
        const response = await created;
        expect(response.status(), await response.text()).toBe(HTTP_CREATED);
        await expect(page.getByRole("heading", { name: "Your account is ready." })).toBeVisible();
        screen.end();
      },
    ],
  ]).cover();
  await new Screen(page, `sign-up ${role}, account ready`, [
    ['summary "your XRPL account"', opensDetails(ADDRESS)],
    [TX_LINK, goesTo(page, TX_URL, TX_TITLE)],
    ...navControls(page, viewer),
  ]).cover();
}

test("the landing, signed out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("fund-facts")).toHaveAttribute("aria-busy", "false");
  await new Screen(page, "landing", [
    ['link "Start lending"', goesTo(page, SPACE_ROUTES.lender, DOOR_TITLES.lender)],
    ['link "Confirm an invoice"', goesTo(page, SPACE_ROUTES.public_body, DOOR_TITLES.public_body)],
    ['link "Get paid now"', goesTo(page, SPACE_ROUTES.business, DOOR_TITLES.business)],
    ['link "Open Transparency →"', goesTo(page, "#/transparency", TRANSPARENCY_TITLE)],
    ['link "Verify every loan"', goesTo(page, "#/transparency", TRANSPARENCY_TITLE)],
    ['link "Explore"', scrollsTo(page, "#doors")],
    ...navControls(page),
  ]).cover();
});

test("sign in, the three space doors and the public-body sign-up form, signed out", async ({ page }) => {
  // Le compte de l'organisme e2e existe (créé au premier passage) ; la connexion se fait ensuite par le formulaire.
  await signInPublicBody(page);
  await signOutByApi(page);
  const publicBody: Viewer = { role: "public_body", email: E2E_PUBLIC_BODY.email, password: E2E_PUBLIC_BODY.password };
  const signupLink = (role: UserRole): Control => [`link "${SIGNUP_LINKS[role]}"`, goesTo(page, signupRoute(role), SIGNUP_TITLES[role])];

  await page.goto("/#/signin");
  await expect(heading(page)).toHaveText(SIGNIN_TITLE);
  await new Screen(page, "sign in", [
    ...walletControls(page),
    ...ROLES.map(signupLink),
    ...navControls(page),
    ['button "Sign in"', signsIn(page, publicBody, SPACE_TITLES.public_body)],
  ]).cover();

  for (const space of ROLES) {
    await page.goto(`/${SPACE_ROUTES[space]}`);
    await expect(heading(page)).toHaveText(DOOR_TITLES[space]);
    await new Screen(page, `${space} door`, [
      ...(space === "public_body" ? [] : walletControls(page)),
      signupLink(space),
      ...navControls(page),
      ['button "Sign in"', signsIn(page, publicBody, spaceTitle(space, "public_body"))],
    ]).cover();
  }

  await page.goto(`/${signupRoute("public_body")}`);
  await expect(page.getByLabel("Public body")).toContainText(E2E_PUBLIC_BODY.name);
  await new Screen(page, "sign-up public_body", [
    ...roleSwitchLinks(page, "public_body"),
    ...navControls(page),
    [
      'button "Create my account"',
      async (control) => {
        await control.click();
        await expect(page.getByText("Choose your public body", { exact: true })).toBeVisible();
      },
    ],
  ]).cover();
});

test("transparency, signed out", async ({ page }) => {
  const status = page.getByTestId("transparency-verification");
  const howChecked = page.locator("summary", { hasText: "how this is checked" });
  await page.goto("/#/transparency");
  await expect(status).toHaveText(VERIFIED, { timeout: AUDIT_TIMEOUT_MS });
  await new Screen(page, "transparency", [
    [
      'button "Re-verify in my browser"',
      async (control) => {
        await expect(status).toHaveText(VERIFIED, { timeout: AUDIT_TIMEOUT_MS });
        const round = Number(await status.getAttribute("data-round"));
        await control.click();
        await expect(status).toHaveAttribute("data-round", String(round + 1), { timeout: AUDIT_TIMEOUT_MS });
        await expect(status).toHaveText(VERIFIED, { timeout: AUDIT_TIMEOUT_MS });
      },
    ],
    ['summary "how this is checked"', opensDetails(/verification_key\.json/)],
    [
      'link "verification_key.json"',
      async (control) => {
        const key = page
          .context()
          .waitForEvent("response", (response) => response.request().isNavigationRequest() && response.url().endsWith("/verification_key.json"));
        await control.click();
        const response = await key;
        expect(response.status()).toBe(HTTP_OK);
        expect(await response.json()).toMatchObject({ protocol: "groth16" });
        await response.frame().page().close();
      },
      howChecked,
    ],
    [TX_LINK, goesTo(page, TX_URL, TX_TITLE)],
    ...navControls(page),
  ]).cover();
});

test("a loan's transaction page, signed out", async ({ page }) => {
  const response = await page.request.get("/api/audit", { timeout: AUDIT_TIMEOUT_MS });
  expect(response.status(), await response.text()).toBe(HTTP_OK);
  const [loan] = ((await response.json()) as FundAudit).loanAudits;
  expect(loan, "the fund has at least one loan").toBeDefined();
  await page.goto(`/#/tx/${loan?.loanSetHash ?? ""}`);
  await coverTxScreen(page, undefined);
});

test("a lender signs up, adds test RLUSD, deposits, withdraws and follows every link", async ({ page }) => {
  test.setTimeout(10 * MINUTE_MS);
  const viewer: Viewer = { role: "lender", email: `buttons-lender-${Date.now()}@e2e.example`, password: PASSWORD };
  await coverSignup(page, viewer, "Tick this box to lend through Atlas", async () => {
    await page.getByLabel("Full name").fill("Ada Lovelace");
    await page.getByLabel("Country of residence").selectOption({ label: "Italy" });
    await page.getByLabel("I understand my capital is at risk.").check();
  });

  const deposit = page.getByTestId("lend-deposit");
  const withdraw = page.getByTestId("lend-withdraw");
  /** Ordre du prêteur : bouton occupé, écran relu en cours d'ordre (raisons des boutons désactivés), réponse 2xx. */
  const order =
    (path: string, busyLabel: string, done: string, doneText: string): Effect =>
    async (control, screen) => {
      const response = posted(page, path, TX_TIMEOUT_MS);
      await control.click();
      await expect(page.getByRole("button", { name: busyLabel })).toBeDisabled();
      await screen.audit();
      const answer = await response;
      expect(answer.ok(), await answer.text()).toBe(true);
      await expect(page.getByTestId(done)).toContainText(doneText, { timeout: TX_TIMEOUT_MS });
    };
  const placeDeposit = order("/api/lender/deposit", "Depositing…", "lend-done-deposit", "Deposited 100.00 RLUSD");

  await page.goto(`/${SPACE_ROUTES.lender}`);
  await expect(page.getByTestId("lend-balance")).toHaveText("0.00 RLUSD", { timeout: PAGE_TIMEOUT_MS });
  await new Screen(page, "lend", [
    ...accountCardControls(await currentUser(page)),
    ['button "Add test RLUSD"', order("/api/lender/faucet", "Adding test RLUSD…", "lend-done-faucet", "Received 10,000.00 RLUSD of test funds")],
    [
      'button "Deposit"',
      async (control, screen) => {
        await deposit.getByLabel("Amount in RLUSD").fill("100");
        await expect(deposit).toContainText("You receive");
        await placeDeposit(control, screen);
      },
    ],
    [/^summary "all \d+ transactions"$/, opensDetails(/\S/)],
    [
      'button "All my shares"',
      async (control) => {
        const shares = withdraw.getByLabel("Shares to sell");
        await expect(shares).toHaveValue("");
        await control.click();
        await expect(shares).not.toHaveValue("");
        await expect(withdraw).toContainText("You receive");
      },
    ],
    ['button "Withdraw"', order("/api/lender/withdraw", "Withdrawing…", "lend-done-withdraw", "Sold")],
    [TX_LINK, goesTo(page, TX_URL, TX_TITLE)],
    ['link "Check every loan and its proof"', goesTo(page, "#/transparency", TRANSPARENCY_TITLE)],
    ...navControls(page, viewer),
  ]).cover();
});

// « Get paid now » est couvert jusqu'au prêt (201) avec une facture unique sur la Regione Puglia, remboursé dans le
// finally : la concentration du débiteur reste stable d'une exécution à l'autre.
test("a business signs up, gets paid for a signed invoice, follows every link and visits another space", async ({ page }) => {
  test.setTimeout(14 * MINUTE_MS);
  const id = `${Date.now()}`;
  const viewer: Viewer = { role: "business", email: `buttons-business-${id}@e2e.example`, password: PASSWORD };
  await coverSignup(page, viewer, "Enter your company name", async () => {
    await page.getByLabel("Company name").fill(`E2E Buttons ${id} S.r.l.`);
    await page.getByLabel("VAT number").fill(`IT5${id.slice(-10)}`);
  });
  const user = await currentUser(page);
  const params = (await (await page.request.get("/api/proof/params")).json()) as ProofParams;
  const signed = await signedInvoice(
    {
      number: `BTN-${id}`,
      debtorName: REGIONE_PUGLIA.name,
      supplierAccount: user.address ?? "",
      amountUsd: Number(INVOICE_CENTS) / 100,
      dueDate: new Date(Date.now() + TERM_DAYS * MS_PER_DAY),
    },
    params,
  );
  const file: FilePayload = {
    name: `${signed.invoice.number}.bari.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(signed)),
  };
  const dropKey = 'button "Choose the signed invoice (PDF)"';
  let loanId: string | undefined;

  try {
    await page.goto(`/${SPACE_ROUTES.business}`);
    await expect(page.getByTestId("business-next-step")).toBeVisible();
    const business = new Screen(page, "business", [
      ...accountCardControls(user),
      [
        dropKey,
        async (control) => {
          await chooseFile(page, control, file);
          await expect(page.getByTestId("invoice-checks").locator(".check")).toHaveCount(7, { timeout: PAGE_TIMEOUT_MS });
          await expect(page.getByTestId("invoice-checks").locator(".check.fail")).toHaveCount(0);
          await expect(page.getByText("The exact amount stays private.")).toBeVisible();
        },
      ],
      [
        'button "Get paid now"',
        async (control, screen) => {
          const loan = posted(page, "/api/sme/loan", FUNDING_TIMEOUT_MS);
          await control.click();
          await expect(page.getByTestId("funding-steps")).toBeVisible();
          await screen.audit();
          const response = await loan;
          expect(response.status(), await response.text()).toBe(HTTP_CREATED);
          loanId = ((await response.json()) as LoanResponse).loanId;
          await expect(page.getByTestId("business-funded")).toBeVisible();
          await expect(page.getByTestId("my-invoices").locator("tbody tr").first()).toContainText("Financed");
        },
      ],
      [
        TX_LINK,
        async () => {
          const before = page.url();
          await page.getByTestId("funding-steps").locator('li[data-step="certificate"] a').click();
          await expect(page).toHaveURL(TX_URL);
          await expect(page.getByRole("heading", { name: "Invoice certificate" })).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
          await coverTxScreen(page, viewer);
          await page.goBack();
          await expect(page).toHaveURL(before);
        },
      ],
      ...navControls(page, viewer),
    ]);
    await business.audit();
    for (const key of [...accountCardControls(user).map(([summary]) => summary), dropKey, 'button "Get paid now"', TX_LINK]) {
      await business.click(key);
    }
    await test.step("the same file again: Already financed, with its registration link", async () => {
      await chooseFile(page, locate(page, dropKey).first(), file);
      const duplicate = page.getByTestId("business-duplicate");
      await expect(duplicate.getByRole("heading", { name: "Already financed" })).toBeVisible({ timeout: TX_TIMEOUT_MS });
      await expect(page.getByRole("button", { name: "Get paid now" })).toHaveCount(0);
      await business.audit();
    });
    await business.cover();
  } finally {
    // Remboursé à la fin : les exécutions répétées ne s'accumulent pas sous la limite de concentration par débiteur.
    if (loanId !== undefined) {
      const repaid = await page.request.post(`/api/loans/${loanId}/repay`, { timeout: FUNDING_TIMEOUT_MS });
      expect(repaid.status(), await repaid.text()).toBe(HTTP_OK);
    }
  }

  await page.goto(`/${SPACE_ROUTES.lender}`);
  await expect(heading(page)).toHaveText(spaceTitle("lender", "business"));
  await new Screen(page, "lend space seen by a business", [
    [
      'button "Sign out to use another account"',
      async (control) => {
        const signedOut = posted(page, "/api/auth/signout", PAGE_TIMEOUT_MS);
        await control.click();
        expect((await signedOut).ok()).toBe(true);
        await expect(heading(page)).toHaveText(DOOR_TITLES.lender);
        await signInByApi(page, viewer);
        await page.reload();
        await expect(heading(page)).toHaveText(spaceTitle("lender", "business"));
      },
    ],
    ...navControls(page, viewer),
  ]).cover();
});

test("a public body opens its space from the sign-up page, downloads samples and signs a FatturaPA", async ({ page, request }) => {
  test.setTimeout(6 * MINUTE_MS);
  // Fournisseur unique inscrit dans un autre contexte : la session de la page reste celle de l'organisme public.
  const id = `${Date.now()}`;
  const company = `E2E Buttons Supplier ${id} S.r.l.`;
  const vatNumber = `IT4${id.slice(-10)}`;
  const signup = await request.post("/api/auth/signup", {
    data: { email: `buttons-supplier-${id}@e2e.example`, password: PASSWORD, role: "business", profile: { company, vatNumber } },
    timeout: SIGNUP_TIMEOUT_MS,
  });
  expect(signup.status(), await signup.text()).toBe(HTTP_CREATED);
  expect(((await signup.json()) as SignupResponse).user.address).toMatch(ADDRESS);

  await signInPublicBody(page);
  const viewer: Viewer = { role: "public_body", email: E2E_PUBLIC_BODY.email, password: E2E_PUBLIC_BODY.password };
  await page.goto(`/${signupRoute("public_body")}`);
  await expect(page.getByRole("link", { name: "Open my space", exact: true })).toBeVisible();
  await new Screen(page, "sign-up public_body, signed in", navControls(page, viewer)).cover();

  const number = `FT-BTN-${Date.now().toString(36).toUpperCase()}`;
  const issueDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const fattura: FilePayload = {
    name: `${number}.xml`,
    mimeType: "application/xml",
    buffer: Buffer.from(
      fatturaPaXml({
        supplier: { ...PITCH_SUPPLIER, name: company, vatNumber },
        customer: REGIONE_PUGLIA,
        number,
        issueDate,
        dueDate: new Date(issueDate.getTime() + TERM_DAYS * MS_PER_DAY),
        totalCents: INVOICE_CENTS,
        description: "Manutenzione impianti, sede di via Gentile",
      }),
    ),
  };
  const dropKey = 'button "Choose an invoice file"';
  const signedName = `${number}.signed.pdf`;
  const signedCard = page.getByTestId("signed-invoice");

  await page.goto(`/${SPACE_ROUTES.public_body}`);
  await expect(page.getByRole("heading", { name: "Drop the FatturaPA of an invoice addressed to you." })).toBeVisible();
  const space = new Screen(page, "public body", [
    ...SAMPLES.map((sample): Control => [`link "${sample}"`, downloads(page, `${sample}.xml`, /FatturaElettronica/)]),
    ...accountCardControls(await currentUser(page)),
    [
      dropKey,
      async (control) => {
        // Un fichier qui n'est pas une FatturaPA ouvre le formulaire ; la signature attend le n° de TVA, raison affichée.
        await chooseFile(page, control, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Invoice notes") });
        await expect(page.getByText("This file is not a FatturaPA. Type the fields from the invoice.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Confirm and sign" })).toBeDisabled();
        await expect(page.getByText("Enter the supplier's VAT number", { exact: true })).toBeVisible();
      },
    ],
    ['summary "supplier\'s XRPL account, bound by your signature"', opensDetails(ADDRESS)],
    [
      'button "Confirm and sign"',
      async (control, screen) => {
        await downloads(page, signedName, /"attestation"/)(control, screen);
        await expect(signedCard.getByRole("heading", { name: "Signed. Send this PDF to your supplier" })).toBeVisible();
      },
    ],
    ['button "Download again"', downloads(page, signedName, /"attestation"/)],
    [
      'button "Confirm another invoice"',
      async (control) => {
        await control.click();
        await expect(signedCard).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Drop the FatturaPA of an invoice addressed to you." })).toBeVisible();
      },
    ],
    ...navControls(page, viewer),
  ]);
  await space.audit();
  for (const sample of SAMPLES) await space.click(`link "${sample}"`);
  await space.click(dropKey);
  await test.step("the FatturaPA is read in the page and its supplier found", async () => {
    await chooseFile(page, locate(page, dropKey).first(), fattura);
    await expect(page.getByText(company, { exact: true })).toBeVisible();
    await expect(page.getByText(number, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm and sign" })).toBeEnabled();
    await space.audit();
  });
  await space.cover();
});
