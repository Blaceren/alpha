import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";
import fs from "node:fs";
import path from "node:path";

/**
 * D2B.1 artifact capture — only the two frames that changed visibly:
 * the completion CTA's clean link, and level 19 opened by the browser session.
 * Historical D1/D2 evidence is never touched by this spec.
 *
 * NOT named *-smoke.spec.ts on purpose: the standard `npm run test:e2e` gate
 * must not write PNGs into the working tree.
 */
const OUT = screenshotDir("d2b-1-acceptance-fix");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const L18 = "/lessons/level.018";

const CORRECT = [
  "Область графика, где цена ранее неоднократно встречала спрос и переставала снижаться.",
  "Реакции происходят в диапазоне цен, а точные касания одного и того же значения встречаются редко.",
  "О том, что область заметна многим участникам, поэтому вывод опирается не на один случай.",
  "Это наблюдение, которому нужно подтверждение реакцией цены; сам подход к области ничего не решает.",
];

test.use({ deviceScaleFactor: 1 });

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
}

test("D2B.1 — clean next link and session-unlocked level 19", async ({ page }) => {
  await page.setViewportSize(DESKTOP);

  // Reach completion the real way, so the captured session is a real one.
  await page.clock.install();
  await page.goto(L18, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Смотреть" }).click();
  await page.clock.runFor(245_000);
  await page.getByRole("button", { name: "Пауза" }).click();
  await page.getByRole("button", { name: /Начать проверку/ }).click();

  for (let i = 0; i < CORRECT.length; i += 1) {
    await page.getByRole("radio", { name: CORRECT[i]! }).check();
    await page.getByRole("button", { name: "Ответить" }).click();
    if (i < CORRECT.length - 1) await page.getByRole("button", { name: /Следующий вопрос/ }).click();
  }

  await page.getByRole("link", { name: /Перейти к уровню 19/ }).scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({
    path: path.join(OUT, "lesson-completed-clean-next-link.png"),
    clip: { x: 0, y: 0, ...DESKTOP },
  });

  await page.getByRole("link", { name: /Перейти к уровню 19/ }).click();
  await page.waitForURL(/level\.019/);
  await settle(page);
  await page.screenshot({
    path: path.join(OUT, "lesson-level-19-session-unlocked.png"),
    clip: { x: 0, y: 0, ...DESKTOP },
  });
});
