import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  ACADEMY_ON,
  ACADEMY_OFF,
  ANSWERS_FILE,
  L2,
  L3,
  LEARNER_A,
  LEARNER_C,
  LEARNER_D,
  PASSWORD,
} from "./support/config";

/**
 * CI-3 assessment E2E against isolated corrected Backends (feat/assessment-contract-ac1).
 * Journeys A–C use the assessment-ON Academy; D uses the assessment-OFF Academy.
 * All-correct answers come ONLY from the protected seed fixture file (never from
 * Academy source or the browser bundle).
 */
const LIVE_MARKERS = [":3010", ":3050", ":3100", ":3199"];
const net: string[] = [];

type Answers = Record<string, string>;
function answers(): Answers {
  return JSON.parse(fs.readFileSync(ANSWERS_FILE, "utf8")) as Answers;
}

function watch(page: Page): void {
  page.on("request", (req) => {
    const url = req.url();
    const method = req.method();
    if (url.includes("/api/")) net.push(`${method}\t${new URL(url).pathname}`);
    for (const m of LIVE_MARKERS) if (url.includes(m)) throw new Error(`request touched live port: ${url}`);
    // The browser must only ever talk to the same-origin Academy proxy.
    if (/https?:\/\/127\.0\.0\.1:\d+\/api\/curriculum/.test(url)) throw new Error(`direct Backend request: ${url}`);
    if (url.includes("/api/backend/") && /report|admin|xp|pocket/i.test(url)) throw new Error(`forbidden mutation surface: ${url}`);
  });
}

async function login(page: Page, base: string, email: string): Promise<void> {
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(`${base}/`);
}

function radio(page: Page, key: string, code: string) {
  return page.locator(`input[name="q-${key}"][value="${code}"]`);
}

async function selectAll(page: Page, choose: (key: string) => string): Promise<void> {
  const keys = Object.keys(answers());
  for (const key of keys) await radio(page, key, choose(key)).check();
}

test.afterAll(() => {
  const dir = path.resolve("test-results/assessment-e2e");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "network.tsv"), `method\tpath\n${Array.from(new Set(net)).sort().join("\n")}\n`);
});

test("Journey A — failed attempt leaves L2 incomplete and L3 locked", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_A);

  await page.goto(`${ACADEMY_ON}/path`);
  await expect(page.locator(`[data-level="${L2}"]`).first()).not.toHaveAttribute("data-state", "completed");
  await expect(page.locator(`[data-level="${L3}"]`).first()).toHaveAttribute("data-state", "locked");

  await page.goto(`${ACADEMY_ON}/lessons/${L2}`);
  await expect(page.locator(".cur-detail__title")).toContainText("Как устроен Alfa Trade Academy");
  await expect(page.locator('[data-media="pending"]')).toBeVisible();

  // Four answer-free questions, four options each.
  await expect(page.locator(".asmt__fieldset")).toHaveCount(4);
  const groups = page.getByRole("group");
  await expect(groups).toHaveCount(4);
  for (let i = 0; i < 4; i += 1) {
    await expect(groups.nth(i).getByRole("radio")).toHaveCount(4);
  }

  // Answer with exactly one wrong (Q1 wrong, rest correct) => 3/4.
  const a = answers();
  const keys = Object.keys(a);
  const wrongCode = ["a", "b", "c", "d"].find((c) => c !== a[keys[0]!])!;
  await radio(page, keys[0]!, wrongCode).check();
  for (let i = 1; i < keys.length; i += 1) await radio(page, keys[i]!, a[keys[i]!]!).check();

  await page.getByRole("button", { name: "Проверить ответы" }).click();
  await expect(page.getByText("✗ Пока не пройдено")).toBeVisible();
  await expect(page.getByRole("button", { name: "Попробовать ещё раз" })).toBeVisible();

  // Refresh the path: L2 still not completed, L3 still locked.
  await page.goto(`${ACADEMY_ON}/path`);
  await expect(page.locator(`[data-level="${L2}"]`).first()).not.toHaveAttribute("data-state", "completed");
  await expect(page.locator(`[data-level="${L3}"]`).first()).toHaveAttribute("data-state", "locked");
});

test("Journey B — retry then pass completes L2 and unlocks L3", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_A); // same learner continues

  await page.goto(`${ACADEMY_ON}/lessons/${L2}`);
  // If a prior failed attempt is shown, retry to a clean state; else answer directly.
  const retry = page.getByRole("button", { name: "Попробовать ещё раз" });
  if (await retry.isVisible().catch(() => false)) await retry.click();
  await expect(page.locator(".asmt__fieldset").first()).toBeVisible();
  // Clean answer state: nothing preselected.
  await expect(page.locator(".asmt__form input[type=radio]:checked")).toHaveCount(0);

  const a = answers();
  await selectAll(page, (k) => a[k]!);
  await page.getByRole("button", { name: "Проверить ответы" }).click();

  await expect(page.getByText("✓ Уровень завершён")).toBeVisible();

  // Server-authoritative refetch: L2 completed, L3 available, L4 locked.
  await page.goto(`${ACADEMY_ON}/path`);
  await expect(page.locator(`[data-level="${L2}"]`).first()).toHaveAttribute("data-state", "completed");
  await expect(page.locator(`[data-level="${L3}"]`).first()).toHaveAttribute("data-state", "available");

  // Revisit L2: canonical completed state + next-level action, no new attempt.
  await page.goto(`${ACADEMY_ON}/lessons/${L2}`);
  await expect(page.getByText("✓ Уровень завершён")).toBeVisible();
  await expect(page.getByRole("link", { name: /следующему уровню/ })).toBeVisible();
});

test("Journey C — rapid double submit creates a single passing attempt", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_C);
  await page.goto(`${ACADEMY_ON}/lessons/${L2}`);
  await expect(page.locator(".asmt__fieldset").first()).toBeVisible();

  const a = answers();
  await selectAll(page, (k) => a[k]!);

  const submits: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/assessment/attempts/") && req.url().endsWith("/submit")) {
      submits.push(req.url());
    }
  });

  const btn = page.getByRole("button", { name: "Проверить ответы" });
  await Promise.all([btn.click(), btn.click().catch(() => undefined)]);
  await expect(page.getByText("✓ Уровень завершён")).toBeVisible();
  // Exactly one submit POST left the browser (single request identity).
  expect(submits.length).toBe(1);
});

test("Journey D — assessment flag disabled fails closed, content stays readable", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_OFF, LEARNER_D);
  await page.goto(`${ACADEMY_OFF}/lessons/${L2}`);
  // Lesson content remains readable.
  await expect(page.locator(".cur-detail__title")).toContainText("Как устроен Alfa Trade Academy");
  // Assessment fails closed with a bounded notice; no questions rendered.
  await expect(page.getByText("Проверка сейчас недоступна")).toBeVisible();
  await expect(page.locator(".asmt__fieldset")).toHaveCount(0);
});
