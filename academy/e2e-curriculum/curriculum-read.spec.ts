import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ACADEMY_BASE_URL, LEARNER_EMAIL, LEARNER_PASSWORD, LEVELS } from "./support/config";

/**
 * API-mode curriculum read E2E against the isolated Backend. Verifies that
 * server-authoritative curriculum/progression renders, that browser storage
 * cannot unlock/complete a level, that no write request is sent, and that no
 * request touches the live DEV ports.
 */

const DEV_MARKERS = [":3100", ":3010"];
const netEvidence: string[] = [];

function watch(page: Page): void {
  page.on("request", (request) => {
    const url = request.url();
    const method = request.method();
    if (url.includes("/api/")) netEvidence.push(`${method}\t${new URL(url).pathname}`);
    for (const marker of DEV_MARKERS) {
      if (url.includes(marker)) throw new Error(`request touched live DEV port: ${url}`);
    }
    if (url.includes("/api/backend/curriculum") && method !== "GET") {
      throw new Error(`curriculum mutation attempted: ${method} ${url}`);
    }
  });
}

async function login(page: Page): Promise<void> {
  await page.goto(`${ACADEMY_BASE_URL}/login`);
  await page.getByLabel("Email").fill(LEARNER_EMAIL);
  await page.getByLabel("Пароль").fill(LEARNER_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  // Wait for the post-login redirect to the authenticated home before navigating.
  await page.waitForURL(`${ACADEMY_BASE_URL}/`);
}

function levelState(page: Page, code: string) {
  return page.locator(`[data-level="${code}"]`).first();
}

test.afterAll(() => {
  const dir = path.resolve("test-results/curriculum-e2e");
  fs.mkdirSync(dir, { recursive: true });
  const unique = Array.from(new Set(netEvidence)).sort();
  fs.writeFileSync(path.join(dir, "network.tsv"), `method\tpath\n${unique.join("\n")}\n`);
});

test("unauthenticated protected route redirects to login", async ({ page }) => {
  watch(page);
  await page.goto(`${ACADEMY_BASE_URL}/path`);
  await expect(page).toHaveURL(/\/login\?next=%2Fpath$/);
});

test("home + path render server-authoritative curriculum and states", async ({ page }) => {
  watch(page);
  await login(page);
  await page.goto(`${ACADEMY_BASE_URL}/`);

  // Active curriculum + current level from Backend.
  await expect(page.locator(".cur-home__meta")).toContainText("версия 1");
  await expect(page.locator(".cur-home__current")).toContainText("Уровень 2");

  await page.goto(`${ACADEMY_BASE_URL}/path`);
  // Levels in Backend order with server states.
  await expect(levelState(page, LEVELS.l1)).toHaveAttribute("data-state", "completed");
  await expect(levelState(page, LEVELS.l2)).toHaveAttribute("data-state", "available");
  await expect(levelState(page, LEVELS.l3)).toHaveAttribute("data-state", "locked");
  await expect(levelState(page, LEVELS.l4)).toHaveAttribute("data-state", "locked");

  const order = await page.locator("[data-level]").evaluateAll((els) => els.map((e) => e.getAttribute("data-level")));
  expect(order.slice(0, 4)).toEqual([LEVELS.l1, LEVELS.l2, LEVELS.l3, LEVELS.l4]);
});

test("level detail is read-only: available lesson, locked report, checkpoint", async ({ page }) => {
  watch(page);
  await login(page);

  // L2 available lesson detail — Backend content metadata, no write CTA.
  await page.goto(`${ACADEMY_BASE_URL}/lessons/${LEVELS.l2}`);
  await expect(page.locator(".cur-detail__title")).toHaveText("Как устроен Alfa Trade Academy");
  await expect(page.locator(".cur-detail")).toHaveAttribute("data-state", "available");
  await expect(page.locator(".cur-detail__readonly")).toBeVisible();
  await expect(page.getByRole("button", { name: /Завершить|Отправить|Пройти/ })).toHaveCount(0);
  // Backend content metadata for the available level actually renders (not the
  // "not configured" fallback), and carries no answers.
  await expect(page.locator(".cur-content__title")).toHaveText("Урок 2 — знакомство с путём");
  await expect(page.locator(".cur-content__facts")).toContainText("Локаль: ru");
  await expect(page.locator(".cur-content__none")).toHaveCount(0);

  // L3 locked report detail — read-only, report type shown.
  await page.goto(`${ACADEMY_BASE_URL}/lessons/${LEVELS.l3}`);
  await expect(page.locator(".cur-detail")).toHaveAttribute("data-state", "locked");
  await expect(page.locator(".cur-detail__eyebrow")).toContainText("Отчёт");

  // L4 checkpoint locked — cannot be locally unlocked.
  await page.goto(`${ACADEMY_BASE_URL}/lessons/${LEVELS.l4}`);
  await expect(page.locator(".cur-detail")).toHaveAttribute("data-state", "locked");
  await expect(page.locator(".cur-detail__eyebrow")).toContainText("Контрольная точка");
});

test("browser storage cannot unlock, complete, or grant XP; server wins", async ({ page }) => {
  watch(page);
  await login(page);
  await page.goto(`${ACADEMY_BASE_URL}/path`);

  // Forge every kind of local progress/unlock/XP/verdict, targeting the REAL
  // server-locked level codes so the forgery is actually addressed at them.
  await page.evaluate(({ l3, l4 }: { l3: string; l4: string }) => {
    localStorage.setItem("ata.lesson-progress.v1", JSON.stringify({ [l3]: "completed", [l4]: "completed" }));
    localStorage.setItem("ata.curriculum.unlocks", JSON.stringify([l3, l4]));
    localStorage.setItem("ata.curriculum.xp", "999999");
    localStorage.setItem("ata.report-workspace.v3", JSON.stringify({ verdict: "approved", status: "completed" }));
    sessionStorage.setItem("ata.lesson-progress.v1", JSON.stringify({ [l4]: "completed" }));
  }, { l3: LEVELS.l3 as string, l4: LEVELS.l4 as string });

  await page.reload();
  // States are unchanged — the server is authority.
  await expect(levelState(page, LEVELS.l3)).toHaveAttribute("data-state", "locked");
  await expect(levelState(page, LEVELS.l4)).toHaveAttribute("data-state", "locked");
  await expect(levelState(page, LEVELS.l1)).toHaveAttribute("data-state", "completed");
  await expect(levelState(page, LEVELS.l2)).toHaveAttribute("data-state", "available");

  // A forged unlock deep-link still shows locked, never grants progression.
  await page.goto(`${ACADEMY_BASE_URL}/lessons/${LEVELS.l4}`);
  await expect(page.locator(".cur-detail")).toHaveAttribute("data-state", "locked");
});

test("refresh preserves server states; unknown level is not found; no answers leak", async ({ page }) => {
  watch(page);
  await login(page);
  await page.goto(`${ACADEMY_BASE_URL}/path`);
  await page.reload();
  await expect(levelState(page, LEVELS.l2)).toHaveAttribute("data-state", "available");

  // Unknown level code -> bounded not-found (not a crash, not fabricated).
  await page.goto(`${ACADEMY_BASE_URL}/lessons/does.not.exist`);
  await expect(page.locator(".cur-state__title")).toHaveText("Уровень не найден");

  // No correct-answer material anywhere in the rendered content.
  await page.goto(`${ACADEMY_BASE_URL}/lessons/${LEVELS.l2}`);
  const body = (await page.content()).toLowerCase();
  expect(body).not.toContain("correctanswer");
  expect(body).not.toContain("iscorrect");
  expect(body).not.toContain("answerkey");
});

test("a context with no session cannot read learner progression", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  watch(page);
  const response = await page.request.get(`${ACADEMY_BASE_URL}/api/backend/curriculum/current`);
  expect(response.status()).toBe(401);
  await context.close();
});

test("no curriculum mutation request was recorded during the journey", () => {
  const writes = netEvidence.filter((line) => {
    const [method, p] = line.split("\t");
    return p?.includes("/curriculum") && method !== "GET";
  });
  expect(writes).toEqual([]);
});
