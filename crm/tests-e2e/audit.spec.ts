import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Global Audit Workspace (`/audit`, Phase 1B5-B) E2E + screenshot suite, driven in
 * a real browser. The existing suites (smoke, users, user-360, owner assignment,
 * notes, note-pin, note-body-edit, today, provider-privacy) are untouched and run
 * alongside these.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Set PHASE_1B5B_PASS=first to write into the first-pass folder.
 */
const PASS = process.env.PHASE_1B5B_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1b5-b-audit-workspace/${PASS}`;
mkdirSync(OUT, { recursive: true });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";
const STATE_STORAGE_KEY = "ata-crm.mock-state.v1";
const OVERLAY_KEY = "ata-crm.mutation-overlay.v1";

/** Nina Chmiel — the persona the notes/pin suites drive. */
const USER = "usr_mock_026";
const ACTOR_NAME = "Demo Operator"; // the production mock session actor.

/* ------------------------------------------------------------- seeding */

/** A valid overlay, built to pass the production parser (contract §9). */
function overlayJson(records: unknown[]): string {
  return JSON.stringify({
    version: 1,
    sequence: records.length,
    notes: [],
    auditRecords: records,
    idempotencyReceipts: [],
  });
}

const base = (seq: number, at: string, targetUserId: string, entityId: string) => ({
  id: `audit_mock_${String(seq).padStart(4, "0")}`,
  actorEmployeeId: "emp_mock_admin",
  actorRole: "crm_admin",
  targetUserId,
  entityId,
  at,
  mock: true as const,
});

/** Six records: all four actions, both pin directions, owner assigned + unassigned. */
const DEMO_RECORDS = [
  { ...base(1, "2026-07-13T05:00:00.000Z", "usr_mock_026", "note_mock_0001"), action: "note_added", entityType: "note", reasonCode: "note_added_by_employee" },
  { ...base(2, "2026-07-13T06:00:00.000Z", "usr_mock_012", "usr_mock_012"), action: "primary_owner_changed", entityType: "user", reasonCode: "primary_owner_changed_by_employee", previousOwnerId: null, nextOwnerId: "emp_ret1" },
  { ...base(3, "2026-07-13T07:00:00.000Z", "usr_mock_012", "usr_mock_012"), action: "primary_owner_changed", entityType: "user", reasonCode: "primary_owner_changed_by_employee", previousOwnerId: "emp_ret1", nextOwnerId: null },
  { ...base(4, "2026-07-13T08:00:00.000Z", "usr_mock_026", "note_mock_0001"), action: "note_pin_changed", entityType: "note", reasonCode: "note_pin_changed_by_employee", previousPinned: false, nextPinned: true },
  { ...base(5, "2026-07-13T08:30:00.000Z", "usr_mock_026", "note_mock_0001"), action: "note_pin_changed", entityType: "note", reasonCode: "note_pin_changed_by_employee", previousPinned: true, nextPinned: false },
  { ...base(6, "2026-07-13T08:45:00.000Z", "usr_mock_026", "note_mock_0001"), action: "note_body_changed", entityType: "note", reasonCode: "note_body_changed_by_employee" },
];

/** 25 note_added records for the pagination surface. */
const BIG_RECORDS = Array.from({ length: 25 }, (_, i) => ({
  ...base(i + 1, `2026-07-1${(i % 3) + 0}T0${i % 9}:00:00.000Z`, `usr_mock_0${String((i % 30) + 1).padStart(2, "0")}`, `note_mock_${String(i + 1).padStart(4, "0")}`),
  action: "note_added",
  entityType: "note",
  reasonCode: "note_added_by_employee",
}));

async function seedOverlay(page: Page, records: unknown[]) {
  await page.addInitScript(
    ([key, json]) => window.localStorage.setItem(key, json),
    [OVERLAY_KEY, overlayJson(records)] as const,
  );
}

async function clearOverlay(page: Page) {
  // Fired once per tab (guarded in sessionStorage): a later navigation must not
  // wipe a record the test just created through the real composer — the same
  // pattern the notes/pin suites use.
  await page.addInitScript((key) => {
    try {
      if (window.sessionStorage.getItem("__ata_audit_overlay_cleared")) return;
      window.localStorage.removeItem(key);
      window.sessionStorage.setItem("__ata_audit_overlay_cleared", "1");
    } catch {
      /* storage unavailable — the app already treats that as an empty overlay */
    }
  }, OVERLAY_KEY);
}

async function seedRole(page: Page, role: string) {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [ROLE_STORAGE_KEY, role] as const);
}

async function seedState(page: Page, state: string) {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [STATE_STORAGE_KEY, state] as const);
}

/* --------------------------------------------------------------- probes */

function trackConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

function trackHydration(page: Page) {
  const warnings: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/hydrat|did not match|Extra attributes/i.test(t)) warnings.push(t);
  });
  return warnings;
}

async function pageOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const heading = (page: Page) => page.getByRole("heading", { level: 1, name: "Audit" });
const ledger = (page: Page) => page.getByRole("list", { name: "Журнал действий" });

async function openAudit(page: Page) {
  await page.goto("/audit");
  await expect(heading(page)).toBeVisible();
}

/** No raw internal id must be visible anywhere on the page. */
async function expectNoRawIds(page: Page) {
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/emp_[a-z0-9_]+/i);
  expect(body).not.toMatch(/note_mock_/i);
  expect(body).not.toMatch(/audit_mock_/i);
  expect(body).not.toMatch(/usr_mock_/i);
}

/* ========================================================= behaviour */

test("admin sees a record created through a real note mutation, and it survives reload", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await clearOverlay(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Create the record through the REAL composer on User 360 (production path).
  await page.goto(`/users/${USER}`);
  const form = page.locator("form").filter({ has: page.locator("textarea") });
  await form.locator("textarea").fill("Заметка для проверки журнала аудита");
  await form.locator('button[type="submit"]').click();
  await expect(page.getByText("Заметка добавлена")).toBeVisible();

  await openAudit(page);
  await expect(page.getByText(new RegExp(`${ACTOR_NAME} добавил заметку для`))).toBeVisible();

  // Reload keeps the journal — it really went through the overlay.
  await page.reload();
  await expect(heading(page)).toBeVisible();
  await expect(page.getByText(new RegExp(`${ACTOR_NAME} добавил заметку для`))).toBeVisible();

  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

test("all four actions render correctly, newest first, with the browser-local demo note", async ({ page }) => {
  const errors = trackConsole(page);
  await seedOverlay(page, DEMO_RECORDS);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAudit(page);

  await expect(page.getByText(/добавил заметку для/)).toBeVisible();
  await expect(page.getByText(/изменил ответственного у/).first()).toBeVisible();
  await expect(page.getByText(/закрепил заметку у/)).toBeVisible();
  await expect(page.getByText(/открепил заметку у/)).toBeVisible();
  await expect(page.getByText(/изменил текст заметки у/)).toBeVisible();

  // Browser-local demo explanation is present, but does not dominate.
  await expect(page.getByText("Локальный demo-журнал. Серверная история пока не подключена.")).toBeVisible();

  // Newest first: the body change (08:45) leads, the note_added (05:00) trails.
  const rows = ledger(page).getByRole("listitem");
  await expect(rows.first()).toContainText("изменил текст заметки у");
  await expect(rows.last()).toContainText("добавил заметку для");

  await expectNoRawIds(page);
  expect(await pageOverflow(page)).toBe(0);
  await page.screenshot({ path: `${OUT}/audit-populated-desktop-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("manager receives data too", async ({ page }) => {
  await seedOverlay(page, DEMO_RECORDS);
  await seedRole(page, "crm_manager");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAudit(page);
  await expect(page.getByText(/добавил заметку для/)).toBeVisible();
});

test("support sees the restricted state, not records — distinct from empty", async ({ page }) => {
  const errors = trackConsole(page);
  await seedOverlay(page, DEMO_RECORDS);
  await seedRole(page, "support");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAudit(page);

  await expect(page.getByRole("heading", { name: "Глобальный журнал недоступен" })).toBeVisible();
  await expect(page.getByText("Ваша роль не может просматривать глобальный журнал действий.")).toBeVisible();
  // Restricted is NOT empty, and shows no records.
  await expect(page.getByText("Действий ещё не было")).toHaveCount(0);
  await expect(page.getByText(/добавил заметку для/)).toHaveCount(0);

  await page.screenshot({ path: `${OUT}/audit-restricted-desktop-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("content_manager sees no Audit nav item, and a direct /audit reveals no data", async ({ page }) => {
  await seedOverlay(page, DEMO_RECORDS);
  await seedRole(page, "content_manager");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/today");

  // No Audit item in the sidebar navigation.
  await expect(page.getByRole("navigation").getByRole("link", { name: "Audit" })).toHaveCount(0);

  // A direct visit still refuses data (defensive restricted state).
  await openAudit(page);
  await expect(page.getByRole("heading", { name: "Глобальный журнал недоступен" })).toBeVisible();
  await expect(page.getByText(/добавил заметку для/)).toHaveCount(0);
});

test("empty state for an admin with no records — distinct from restricted", async ({ page }) => {
  await clearOverlay(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAudit(page);

  await expect(page.getByRole("heading", { name: "Действий ещё не было" })).toBeVisible();
  await expect(
    page.getByText("Изменения заметок и ответственного, выполненные в этом браузере, появятся здесь."),
  ).toBeVisible();
  await expect(page.getByText("Глобальный журнал недоступен")).toHaveCount(0);

  await page.screenshot({ path: `${OUT}/audit-empty-desktop-1440x900.png` });
});

test("a corrupt overlay renders no garbage and does not break the page", async ({ page }) => {
  const errors = trackConsole(page);
  await page.addInitScript(
    ([key, json]) => window.localStorage.setItem(key, json),
    [OVERLAY_KEY, "{ this is : not valid json"] as const,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAudit(page);

  // Fail-closed: the honest empty-state, never a partial or reconstructed row.
  await expect(page.getByRole("heading", { name: "Действий ещё не было" })).toBeVisible();
  await expect(ledger(page)).toHaveCount(0);
  await expectNoRawIds(page);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("a storage read failure shows a localized error with retry and no diagnostics", async ({ page }) => {
  await seedOverlay(page, DEMO_RECORDS);
  await seedState(page, "error");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAudit(page);

  await expect(page.getByRole("heading", { name: "Не удалось загрузить журнал" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();

  const html = await page.content();
  expect(html).not.toContain("Mock error mode.");
  expect(html).not.toContain("upstream_unavailable");
  expect(html).not.toContain(OVERLAY_KEY);

  await page.screenshot({ path: `${OUT}/audit-storage-error-desktop-1440x900.png` });
});

test("no note body used to create a record ever appears in the audit HTML", async ({ page }) => {
  const SECRET = "СЕКРЕТНОЕ_ТЕЛО_ЗАМЕТКИ_12345";
  await clearOverlay(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`/users/${USER}`);
  const form = page.locator("form").filter({ has: page.locator("textarea") });
  await form.locator("textarea").fill(SECRET);
  await form.locator('button[type="submit"]').click();
  await expect(page.getByText("Заметка добавлена")).toBeVisible();

  await openAudit(page);
  await expect(page.getByText(/добавил заметку для/)).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(SECRET);
});

/* ========================================================= pagination */

test("pagination appears past one page and moves between pages", async ({ page }) => {
  await seedOverlay(page, BIG_RECORDS);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAudit(page);

  await expect(page.getByText("Всего записей: 25")).toBeVisible();
  await expect(ledger(page).getByRole("listitem")).toHaveCount(20);

  const next = page.getByRole("button", { name: "Следующая страница" });
  await expect(next).toBeVisible();
  // Bring the pagination control into frame — 20 rows push it below the fold, and
  // the whole point of this shot is to show the control.
  await next.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/audit-pagination-desktop-1440x900.png` });

  await next.click();
  await expect(ledger(page).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Предыдущая страница" })).toBeEnabled();

  // Pagination is reachable and operable from the keyboard.
  await page.getByRole("button", { name: "Предыдущая страница" }).focus();
  await page.keyboard.press("Enter");
  await expect(ledger(page).getByRole("listitem")).toHaveCount(20);
});

/* ========================================================= responsive */

test("mobile 390x844 — single column, no horizontal overflow", async ({ page }) => {
  await seedOverlay(page, DEMO_RECORDS);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAudit(page);

  await expect(page.getByText(/изменил текст заметки у/)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${OUT}/audit-mobile-390x844.png` });
});

test("mobile 320x720 — the narrowest supported width still fits", async ({ page }) => {
  const errors = trackConsole(page);
  await seedOverlay(page, DEMO_RECORDS);
  await page.setViewportSize({ width: 320, height: 720 });
  await openAudit(page);

  await expect(page.getByText(/добавил заметку для/)).toBeVisible();
  // The owner before→after detail must not force a horizontal scroll.
  await expect(page.getByText(/изменил ответственного у/).first()).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${OUT}/audit-mobile-320x720.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("tablet 1024x768 — no overflow", async ({ page }) => {
  await seedOverlay(page, DEMO_RECORDS);
  await page.setViewportSize({ width: 1024, height: 768 });
  await openAudit(page);
  await expect(page.getByText(/изменил текст заметки у/)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${OUT}/audit-tablet-1024x768.png` });
});

/**
 * 200% zoom modelled as a REAL reflow (720×450), not documentElement.style.zoom:
 * CSS zoom leaves media queries seeing the desktop width, so the layout never
 * reflows and the check is a lie. At 720×450 the shell genuinely reflows to one
 * column.
 */
test("200% zoom (720x450) reflows: no overflow, ledger readable", async ({ page }) => {
  const errors = trackConsole(page);
  await seedOverlay(page, DEMO_RECORDS);
  await page.setViewportSize({ width: 720, height: 450 });
  await openAudit(page);

  await expect(page.getByText(/изменил текст заметки у/)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${OUT}/audit-zoom-200-720x450.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
