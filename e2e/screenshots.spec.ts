import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "design-memory/screenshots/d1a-art-directions");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// deviceScaleFactor: 1 → screenshot pixel dimensions equal CSS dimensions.
test.use({ deviceScaleFactor: 1 });

const TARGETS = [
  { file: "product-portal", url: "/concepts/product-portal" },
  { file: "market-atlas", url: "/concepts/market-atlas" },
  { file: "editorial-academy", url: "/concepts/editorial-academy" },
] as const;

async function capture(
  page: Page,
  url: string,
  size: { width: number; height: number },
  file: string,
) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle" });
  // Ensure webfonts are loaded before capture (no FOUT in screenshots).
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(500); // settle any soft entrance transition
  await page.screenshot({
    path: path.join(OUT, file),
    clip: { x: 0, y: 0, ...size },
  });
}

for (const t of TARGETS) {
  test(`${t.file} desktop 1440x900`, async ({ page }) => {
    await capture(page, t.url, DESKTOP, `${t.file}-desktop.png`);
  });
  test(`${t.file} mobile 390x844`, async ({ page }) => {
    await capture(page, t.url, MOBILE, `${t.file}-mobile.png`);
  });
}

test("concepts board desktop 1440x900", async ({ page }) => {
  await capture(page, "/concepts", DESKTOP, "concepts-board-desktop.png");
});
