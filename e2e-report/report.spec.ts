import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  ACADEMY_ON,
  ACADEMY_OFF,
  L3,
  PASSWORD,
  VALUES_FILE,
  LEARNER_DRAFT,
  LEARNER_SUBMIT,
  LEARNER_REVISION,
  LEARNER_APPROVE,
  LEARNER_STALE,
  LEARNER_DOUBLE,
  LEARNER_OFF,
} from "./support/config";
import { approve, backendState, requestRevision } from "./support/backend-actor";

/**
 * CI-4 report E2E against the isolated RR-1 Backend (feat/report-zero-reward-receipt-rr1)
 * with the REAL approved rev3 L3 report definition. Journeys A–E, G use the
 * REPORT-ON Academy; F uses the REPORT-OFF Academy. Draft/submit/approval are
 * server-authoritative; the mentor review/approve run as the protected Backend
 * fixture actor (never the learner UI).
 */
const LIVE_MARKERS = [":3010", ":3050", ":3100", ":3199"];
const net: string[] = [];

type Values = { values: Record<string, unknown>; planKeys: string[]; noteKeys: string[]; noteSample: string };
function fixture(): Values {
  return JSON.parse(fs.readFileSync(VALUES_FILE, "utf8")) as Values;
}

function watch(page: Page): void {
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/")) net.push(`${req.method()}\t${new URL(url).pathname}`);
    for (const m of LIVE_MARKERS) if (url.includes(m)) throw new Error(`request touched live port: ${url}`);
    // The browser must only ever talk to the same-origin Academy proxy.
    if (/https?:\/\/127\.0\.0\.1:\d+\/api\/curriculum/.test(url)) throw new Error(`direct Backend request: ${url}`);
    // Report is now a sanctioned learner surface; reviewer/admin/xp/pocket/attachments are NOT.
    if (url.includes("/api/backend/") && /admin|xp|pocket|attachment|report-submissions|report-reviews/i.test(url)) {
      throw new Error(`forbidden surface from learner UI: ${url}`);
    }
  });
}

async function login(page: Page, base: string, email: string): Promise<void> {
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(`${base}/`);
}

async function fillField(page: Page, key: string, value: unknown): Promise<void> {
  const root = page.locator(`[data-field="${key}"]`);
  const type = await root.getAttribute("data-type");
  if (type === "boolean") {
    await page.locator(`input[name="rf-${key}"][value="${value === true ? "true" : "false"}"]`).check();
  } else if (type === "single_choice") {
    await page.locator(`input[name="rf-${key}"][value="${String(value)}"]`).check();
  } else {
    await page.locator(`[id="rf-${key}"]`).fill(String(value));
  }
}

async function fillAll(page: Page): Promise<void> {
  const { values } = fixture();
  for (const [key, value] of Object.entries(values)) await fillField(page, key, value);
}

async function openL3(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/lessons/${L3}`);
  await expect(page.locator(".rpt")).toBeVisible();
}

test.afterAll(() => {
  const dir = path.resolve("test-results/report-e2e");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "network.tsv"), `method\tpath\n${Array.from(new Set(net)).sort().join("\n")}\n`);
});

test("Journey A — draft save + refresh recovery (43 fields, 5 groups)", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_DRAFT);
  await openL3(page, ACADEMY_ON);

  // Definition renders the full 43-field form across five trade groups + summary.
  await expect(page.locator("[data-field]")).toHaveCount(43);
  await expect(page.locator(".rpt-group[data-group]")).toHaveCount(6);
  await expect(page.locator('[data-group="trade-1"]')).toBeVisible();

  const { values } = fixture();
  const key = "trade1-asset";
  await fillField(page, key, values[key]);
  await fillField(page, "trade1-direction", values["trade1-direction"]);
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(page.getByText("Черновик сохранён на сервере.")).toBeVisible();

  // Refresh: the server draft is restored (client never persisted it).
  await openL3(page, ACADEMY_ON);
  await expect(page.locator(`[id="rf-${key}"]`)).toHaveValue(String(values[key]));
});

test("Journey B — conditional validation blocks submit until the deviation note is supplied", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_DRAFT); // continues the draft from A
  await openL3(page, ACADEMY_ON);

  await fillAll(page);
  // Set trade1 plan NOT followed and leave the note empty.
  await fillField(page, "trade1-plan-followed", false);
  await page.getByRole("button", { name: /Отправить на проверку/ }).click();
  await expect(page.getByText("Проверьте отчёт перед отправкой")).toBeVisible();
  await expect(page.locator('[data-field="trade1-deviation-note"][data-invalid="true"]')).toBeVisible();

  // Supply the note, then the submit succeeds → pending review.
  await fillField(page, "trade1-deviation-note", fixture().noteSample);
  await page.getByRole("button", { name: /Отправить на проверку/ }).click();
  await expect(page.getByText(/ожидает проверки наставника/)).toBeVisible();
});

test("Journey C — valid submit → pending review; one immutable revision; L3 incomplete, L4 locked", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_SUBMIT);
  await openL3(page, ACADEMY_ON);

  await fillAll(page);
  await page.getByRole("button", { name: /Отправить на проверку/ }).click();
  await expect(page.getByText(/ожидает проверки наставника/)).toBeVisible();
  // Submitted report is read-only (no editable form).
  await expect(page.locator(".rpt__form")).toHaveCount(0);
  await expect(page.locator(".rpt-readonly")).toBeVisible();

  const state = backendState(LEARNER_SUBMIT);
  expect(state.reportStatus).toBe("pending_review");
  expect(state.submittedRevisions).toBe(1);
  expect(state.l3Status).not.toBe("completed"); // L3 incomplete (progress = pending_review)
  expect(state.currentLevel).toBe(3); // L4 still locked
  expect(state.xpTransactions).toBe(0);
});

test("Journey D — revision requested → correct → resubmit", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_REVISION);
  await openL3(page, ACADEMY_ON);
  await fillAll(page);
  await page.getByRole("button", { name: /Отправить на проверку/ }).click();
  await expect(page.getByText(/ожидает проверки наставника/)).toBeVisible();

  // Protected Backend fixture actor requests a revision.
  const rev = requestRevision(LEARNER_REVISION);
  expect(rev.ok).toBe(true);

  await openL3(page, ACADEMY_ON);
  await expect(page.locator(".rpt-feedback__title")).toContainText("Наставник запросил доработку");
  await expect(page.getByText(/Опишите точку входа/)).toBeVisible();

  await page.getByRole("button", { name: "Создать исправленную версию" }).click();
  // make a genuine, valid correction: mark trade 1 as a plan deviation + add the note
  await fillField(page, "trade1-plan-followed", false);
  await fillField(page, "trade1-deviation-note", fixture().noteSample);
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(page.getByText("Черновик сохранён на сервере.")).toBeVisible();
  await page.getByRole("button", { name: /Отправить исправление/ }).click();
  await expect(page.getByText(/ожидает проверки наставника/)).toBeVisible();

  const state = backendState(LEARNER_REVISION);
  expect(state.reportStatus).toBe("pending_review");
  expect(state.submittedRevisions).toBe(2); // prior revision preserved + the new one
});

test("Journey E — approval completes L3, unlocks L4, awards zero XP", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_APPROVE);
  await openL3(page, ACADEMY_ON);
  await fillAll(page);
  await page.getByRole("button", { name: /Отправить на проверку/ }).click();
  await expect(page.getByText(/ожидает проверки наставника/)).toBeVisible();

  // Protected Backend fixture actor approves the latest revision.
  const result = approve(LEARNER_APPROVE);
  expect(result.ok).toBe(true);
  expect(result.xpAwarded).toBe(0);
  expect(result.xpTransactionId).toBeNull();
  expect(result.nextLevelNumber).toBe(4);

  // Learner refreshes and sees the server-authoritative completion.
  await openL3(page, ACADEMY_ON);
  await expect(page.getByText("✓ Отчёт принят — уровень завершён")).toBeVisible();
  await expect(page.locator(".rpt__form")).toHaveCount(0); // read-only

  const state = backendState(LEARNER_APPROVE);
  expect(state.l3Status).toBe("completed");
  expect(state.currentLevel).toBe(4); // L4 available
  expect(state.xpTransactions).toBe(0);
});

test("Journey F — REPORT disabled: content readable, report fails closed, no write", async ({ page }) => {
  // Track THIS page's own writes (the module-level `net` accumulates across tests).
  const ownWrites: string[] = [];
  page.on("request", (req) => {
    if (/PUT|POST/.test(req.method()) && /\/report(\/|$)/.test(new URL(req.url()).pathname)) ownWrites.push(req.url());
  });
  watch(page);
  await login(page, ACADEMY_OFF, LEARNER_OFF);
  await page.goto(`${ACADEMY_OFF}/lessons/${L3}`);
  // Curriculum content stays readable.
  await expect(page.locator(".cur-detail__title")).toBeVisible();
  // Report fails closed with a bounded notice; no form.
  await expect(page.getByText("Отправка отчёта сейчас недоступна", { exact: false })).toBeVisible();
  await expect(page.locator(".rpt__form")).toHaveCount(0);
  // No report write ever leaves the browser on the flag-disabled backend.
  expect(ownWrites).toEqual([]);
});

test("Journey G1 — rapid double submit is one canonical request", async ({ page }) => {
  watch(page);
  await login(page, ACADEMY_ON, LEARNER_DOUBLE);
  await openL3(page, ACADEMY_ON);
  await fillAll(page);

  const submits: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/report\/submit$/.test(new URL(req.url()).pathname)) submits.push(req.url());
  });
  // Rapid double click: the second fires in the same tick; it is guarded by the
  // in-flight latch (short timeout so it fails fast once the button is gone).
  const btn = page.getByRole("button", { name: /Отправить на проверку/ });
  await Promise.all([btn.click(), btn.click({ timeout: 1500 }).catch(() => undefined)]);

  // Wait for the (single) submit to complete on the SAME page — do not navigate
  // away, which would abort the in-flight request.
  await expect(page.getByText(/ожидает проверки наставника/)).toBeVisible();

  // Exactly ONE canonical submission and one submit request.
  expect(submits.length).toBe(1);
  const state = backendState(LEARNER_DOUBLE);
  expect(state.reportStatus).toBe("pending_review");
  expect(state.submittedRevisions).toBe(1);
});

test("Journey G2 — stale revision is rejected with a bounded conflict", async ({ browser }) => {
  const { values } = fixture();
  // Two contexts for the SAME fresh learner both load an editable draft at rev 0.
  const c1 = await browser.newContext();
  const p1 = await c1.newPage();
  watch(p1);
  await login(p1, ACADEMY_ON, LEARNER_STALE);
  await openL3(p1, ACADEMY_ON);
  await expect(p1.locator(".rpt__form")).toBeVisible();

  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  watch(p2);
  await login(p2, ACADEMY_ON, LEARNER_STALE);
  await openL3(p2, ACADEMY_ON);

  // p2 saves first → server workflowVersion advances past p1's expected revision.
  await fillField(p2, "trade1-asset", values["trade1-asset"]);
  await p2.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(p2.getByText("Черновик сохранён на сервере.")).toBeVisible();

  // p1 still holds the stale expected revision; its save must be rejected.
  // Same-length, valid, but different value so the CAS conflict — not field
  // validation or a no-change guard — is what the save hits.
  const asset = String(values["trade1-asset"]);
  const p1val = asset.slice(0, -1) + (asset.endsWith("X") ? "Y" : "X");
  await fillField(p1, "trade1-asset", p1val);
  await p1.getByRole("button", { name: "Сохранить черновик" }).click();
  // The stale banner offers a bounded "refresh the form" recovery action.
  await expect(p1.getByRole("button", { name: "Обновить форму" })).toBeVisible();

  await c1.close();
  await c2.close();
});
