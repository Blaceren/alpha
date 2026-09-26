/**
 * D3-A — report concept screenshot capture (prototype tooling, NOT a production test).
 *
 * Deliberately NOT placed in e2e/: per DD-257 that directory is split into
 * `*smoke.spec.ts` (behavioral gate) and `*screenshots.spec.ts` (artifact
 * capture), and this script belongs to neither — it photographs static
 * low-fidelity proposals, not the application. It is run by hand:
 *
 *   node design-memory/proposals/d3-report/capture.mjs
 *
 * Exact viewports (no deviceScaleFactor scaling, no fullPage): the review
 * protocol requires the stated pixel sizes.
 */

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../screenshots/d3-report/concepts");

const CONCEPTS = [
  ["a", "concept-a"],
  ["b", "concept-b"],
  ["c", "concept-c"],
];

const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
];

const browser = await chromium.launch();
let worstOverflow = 0;

for (const [key, dir] of CONCEPTS) {
  const url = pathToFileURL(resolve(here, dir, "index.html")).href;
  for (const [name, width, height] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "load" });
    // Variable fonts must be resolved before the shutter, or the type rhythm in
    // the evidence is not the type rhythm of the proposal.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `${outDir}/concept-${key}-${name}-${width}x${height}.png`,
      clip: { x: 0, y: 0, width, height },
    });
    // Horizontal overflow — reported, never silently tolerated.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    worstOverflow = Math.max(worstOverflow, overflow);
    console.log(`concept-${key} ${name} ${width}x${height} — h-overflow: ${overflow}px`);
    await page.close();
  }
}

// ---- boards ----
const BOARDS = [
  ["comparison-board.html", "comparison-board-1920x1080.png"],
  ["lifecycle-board.html", "lifecycle-comparison-1920x1080.png"],
];

for (const [file, out] of BOARDS) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(here, file)).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // the lifecycle board renders the three pending states in live iframes; give
  // their fonts and layout a beat before the shutter
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${out}`, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  console.log(`${out} 1920x1080 — captured`);
  await page.close();
}

await browser.close();
console.log(`\nworst horizontal overflow across all concept frames: ${worstOverflow}px`);
