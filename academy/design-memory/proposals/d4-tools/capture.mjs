/**
 * D4-A — Tools + Trading Journal concept screenshot capture (prototype tooling,
 * NOT a production test).
 *
 * Deliberately NOT placed in e2e/: per DD-257 that directory is split into
 * `*smoke.spec.ts` (behavioral gate) and `*screenshots.spec.ts` (artifact
 * capture), and this script belongs to neither — it photographs static
 * low-fidelity proposals, not the application. Run by hand:
 *
 *   node design-memory/proposals/d4-tools/capture.mjs
 *
 * Produces EXACTLY 6 PNG (2 surfaces × 3 directions) at exactly 1440×900,
 * no deviceScaleFactor scaling, no fullPage: the review protocol requires the
 * stated pixel sizes. Horizontal overflow is reported, never silently tolerated.
 */

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../screenshots/d4-tools-art-direction/proposals");

const CONCEPTS = [
  ["a", "concept-a"],
  ["b", "concept-b"],
  ["c", "concept-c"],
];

const SURFACES = [
  ["tools-hub", "tools-hub.html"],
  ["trading-journal", "trading-journal.html"],
];

const WIDTH = 1440;
const HEIGHT = 900;

const browser = await chromium.launch();
let worstOverflow = 0;

for (const [key, dir] of CONCEPTS) {
  for (const [surfaceName, file] of SURFACES) {
    const url = pathToFileURL(resolve(here, dir, file)).href;
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.goto(url, { waitUntil: "load" });
    // Variable fonts must resolve before the shutter, or the type rhythm in the
    // evidence is not the type rhythm of the proposal.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `${outDir}/direction-${key}-${surfaceName}-${WIDTH}x${HEIGHT}.png`,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    worstOverflow = Math.max(worstOverflow, overflow);
    console.log(`direction-${key} ${surfaceName} ${WIDTH}x${HEIGHT} — h-overflow: ${overflow}px`);
    await page.close();
  }
}

await browser.close();
console.log(`\nworst horizontal overflow across all 6 frames: ${worstOverflow}px`);
