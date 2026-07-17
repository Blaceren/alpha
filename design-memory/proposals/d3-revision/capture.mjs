/**
 * D3-C-A — revision concept screenshot capture (prototype tooling, NOT a
 * production test).
 *
 * Deliberately NOT placed in e2e/ (DD-257 precedent, same as the D3-A capture):
 * it photographs static low-fidelity proposals, not the application. Run by hand:
 *
 *   node design-memory/proposals/d3-revision/capture.mjs
 *
 * Writes ONLY into design-memory/screenshots/d3-revision/concepts/ — the
 * historical d3-report evidence directories are never touched.
 *
 * Exact viewports, no deviceScaleFactor scaling, no fullPage. Besides the
 * captures it runs the behavioral geometry checks the mobile acceptance
 * demands (DD-281 applied to prototypes): horizontal overflow must be 0, and
 * the resubmit CTA must clear the bottom navigation by ≥ 12px when scrolled
 * into view at 390×844, 320×720 and 720×450 (200% zoom).
 */

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../screenshots/d3-revision/concepts");
mkdirSync(outDir, { recursive: true });

const CONCEPTS = [
  ["a", "concept-a"],
  ["b", "concept-b"],
  ["c", "concept-c"],
];

/** [suffix, width, height, state, scrollTo] */
const FRAMES = [
  ["revision-desktop-1440x900", 1440, 900, "revision", "top"],
  ["revision-mobile-390x844", 390, 844, "revision", "top"],
  ["editing-desktop-1440x900", 1440, 900, "editing", "entry"],
  ["ready-desktop-1440x900", 1440, 900, "ready", "end"],
];

const browser = await chromium.launch();
let worstOverflow = 0;
const failures = [];

for (const [key, dir] of CONCEPTS) {
  const base = pathToFileURL(resolve(here, dir, "index.html")).href;

  for (const [suffix, width, height, state, scrollTo] of FRAMES) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`${base}?state=${state}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    if (scrollTo === "entry") {
      await page.evaluate(() => {
        document.querySelector(".rl-open")?.scrollIntoView({ block: "center" });
      });
    } else if (scrollTo === "end") {
      await page.evaluate(() => {
        document.querySelector(".rl-end")?.scrollIntoView({ block: "center" });
      });
    }
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `${outDir}/concept-${key}-${suffix}.png`,
      clip: { x: 0, y: 0, width, height },
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    worstOverflow = Math.max(worstOverflow, overflow);
    if (overflow > 0) failures.push(`concept-${key} ${suffix}: h-overflow ${overflow}px`);
    console.log(`concept-${key} ${suffix} — h-overflow: ${overflow}px`);
    await page.close();
  }

  // ---- geometry checks (no artifact output; results go to the self-review) ----
  for (const [width, height, label] of [
    [390, 844, "390x844"],
    [320, 720, "320x720"],
    [720, 450, "720x450 (200% zoom)"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`${base}?state=ready`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const btn = document.querySelector(".rl-btn");
      btn.scrollIntoView({ block: "center" });
      const nav = document.querySelector(".bottomnav");
      const b = btn.getBoundingClientRect();
      const navVisible = nav && getComputedStyle(nav).display !== "none";
      const navTop = navVisible ? nav.getBoundingClientRect().top : window.innerHeight;
      return {
        gap: Math.round(navTop - b.bottom),
        navVisible,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const ok = result.overflow === 0 && (!result.navVisible || result.gap >= 12);
    if (!ok) failures.push(`concept-${key} ${label}: gap ${result.gap}px, overflow ${result.overflow}px`);
    console.log(
      `concept-${key} ${label} — CTA↔nav gap: ${result.gap}px (nav ${result.navVisible ? "visible" : "hidden"}), h-overflow: ${result.overflow}px`,
    );
    await page.close();
  }
}

// ---- comparison board ----
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(here, "comparison-board.html")).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${outDir}/comparison-board-1920x1080.png`,
    clip: { x: 0, y: 0, width: 1920, height: 1080 },
  });
  console.log("comparison-board-1920x1080.png — captured");
  await page.close();
}

await browser.close();
console.log(`\nworst horizontal overflow across all frames: ${worstOverflow}px`);
if (failures.length) {
  console.log("CHECK FAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log("all geometry checks passed");
}
