// Captures d'écran optionnelles des e2e (desktop 1440 et mobile 390), seulement si `CAPTURE_DIR` est défini.

import { join } from "node:path";
import type { Page } from "@playwright/test";

const VIEWPORTS = [
  { suffix: "desktop", width: 1440, height: 900 },
  { suffix: "mobile", width: 390, height: 844 },
] as const;

export async function capture(page: Page, name: string): Promise<void> {
  const dir = process.env.CAPTURE_DIR;
  if (dir === undefined) return;
  const initial = page.viewportSize();
  for (const { suffix, width, height } of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: join(dir, `${name}-${suffix}.png`), fullPage: true, animations: "disabled" });
  }
  if (initial !== null) await page.setViewportSize(initial);
}
