import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * User 360 note deletion (Phase 1B6) E2E + screenshot suite — driven in a real
 * browser. The existing suites are untouched and run alongside these.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Set PHASE_1B6_PASS=first to write into the first-pass folder.
 *
 * IDENTITY NOTE: the mock session hands every role the same `emp_mock_admin`, so a
 * role switch is NOT an employee switch. AUTHOR flows delete `emp_mock_admin`'s own
 * notes through the real UI; the FOREIGN rule is proven with an overlay fixture whose
 * `authorEmployeeId` is a DIFFERENT employee — never by pretending a role change swaps
 * identity.
 */
const PASS = process.env.PHASE_1B6_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1b6-note-delete/${PASS}`;
mkdirSync(OUT, { recursive: true });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";
const OVERLAY_KEY = "ata-crm.mutation-overlay.v1";

const USER = "usr_mock_026";
const ACTOR = "emp_mock_admin"; // the production mock session actor («Demo Operator»)

const DELETE = "Удалить заметку";
const CONFIRM_TITLE = "Удалить заметку?";
const CONFIRM = "Удалить";
const CANCEL = "Отменить";
const DELETED = "Заметка удалена";
const CONFLICT = "Заметка уже изменена. Показаны актуальные данные.";

async function resetOverlay(page: Page) {
  await page.addInitScript((key) => {
    try {
      if (window.sessionStorage.getItem("__ata_del_overlay_cleared")) return;
      window.localStorage.removeItem(key);
      window.sessionStorage.setItem("__ata_del_overlay_cleared", "1");
    } catch {
      /* storage unavailable */
    }
  }, OVERLAY_KEY);
}

async function seedOverlay(page: Page, overlay: unknown) {
  await page.addInitScript(
    ([key, json]) => {
      try {
        if (window.sessionStorage.getItem("__ata_del_seeded")) return;
        window.localStorage.setItem(key, json);
        window.sessionStorage.setItem("__ata_del_seeded", "1");
      } catch {
        /* storage unavailable */
      }
    },
    [OVERLAY_KEY, JSON.stringify(overlay)] as const,
  );
}

async function seedRole(page: Page, roleCode: string) {
  await page.addInitScript(
    ([key, role]) => window.localStorage.setItem(key, role),
    [ROLE_STORAGE_KEY, roleCode] as const,
  );
}

async function breakOverlayWrites(page: Page) {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(k: string, v: string) {
      if (k === key) throw new Error("QuotaExceededError");
      return original.call(this, k, v);
    };
  }, OVERLAY_KEY);
}

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

function overlayWithNote(opts: {
  authorEmployeeId: string;
  visibility: "team" | "private";
  body: string;
  id?: string;
}) {
  return {
    version: 1,
    sequence: 1,
    notes: [
      {
        id: opts.id ?? "note_mock_0001",
        userId: USER,
        caseId: null,
        authorEmployeeId: opts.authorEmployeeId,
        body: opts.body,
        visibility: opts.visibility,
        pinned: false,
        createdAt: "2026-07-10T09:00:00.000Z",
        updatedAt: "2026-07-10T09:00:00.000Z",
        mock: true,
      },
    ],
    auditRecords: [],
    idempotencyReceipts: [],
  };
}

const notesHeading = (page: Page) => page.getByRole("heading", { level: 2, name: "Заметки" });
const notesSection = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Заметки" }) });
const notesForm = (page: Page) =>
  notesSection(page).locator("form").filter({ has: page.locator("textarea") }).first();
const noteItems = (page: Page) => notesSection(page).locator("ol > li");
const rowWith = (page: Page, text: string | RegExp) => noteItems(page).filter({ hasText: text });
const deleteBtn = (page: Page, row: string | RegExp) => rowWith(page, row).getByRole("button", { name: DELETE });
const confirmBtn = (page: Page) => notesSection(page).getByRole("button", { name: CONFIRM, exact: true });
const cancelBtn = (page: Page) => notesSection(page).getByRole("button", { name: CANCEL });

async function openNotes(page: Page, opts: { role?: string; seed?: unknown } = {}) {
  if (opts.seed) await seedOverlay(page, opts.seed);
  else await resetOverlay(page);
  if (opts.role) await seedRole(page, opts.role);
  await page.goto(`/users/${USER}`);
  await expect(notesHeading(page)).toBeVisible();
}

async function shoot(page: Page, name: string) {
  await notesSection(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}` });
}

async function addNote(page: Page, body: string) {
  const toggle = notesSection(page).getByRole("button", { name: "Добавить заметку", expanded: false });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await notesForm(page).locator("textarea").fill(body);
  await notesForm(page).locator('button[type="submit"]').click();
  await expect(page.getByText("Заметка добавлена")).toBeVisible();
  await expect(rowWith(page, body.trim())).toBeVisible();
}

async function deleteAuditCount(page: Page) {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { auditRecords?: { action?: string }[] };
      return (parsed.auditRecords ?? []).filter((a) => a.action === "note_deleted").length;
    } catch {
      return -1;
    }
  }, OVERLAY_KEY);
}

/* ------------------------------------------ create → delete → reload */

test("author deletes an own note; the row goes, the count drops, and a reload keeps it gone", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Первая, которая останется.");
  await addNote(page, "Вторая, которую удалим.");

  const countBefore = await noteItems(page).count();
  await expect(deleteBtn(page, "которую удалим")).toBeVisible();
  await shoot(page, "note-delete-control-desktop-1440x900.png");

  // Open the inline confirm — destructive tone appears only here.
  await deleteBtn(page, "которую удалим").click();
  await expect(page.getByText(CONFIRM_TITLE)).toBeVisible();
  await expect(page.getByText("Действие нельзя отменить. История изменения останется в Audit.")).toBeVisible();
  await shoot(page, "note-delete-confirm-desktop-1440x900.png");

  await confirmBtn(page).click();

  // The row disappears, the count drops by one, and the calm section message shows.
  await expect(rowWith(page, "которую удалим")).toHaveCount(0);
  await expect(page.getByText(DELETED)).toBeVisible();
  await expect(noteItems(page)).toHaveCount(countBefore - 1);
  // The other note is untouched.
  await expect(rowWith(page, "которая останется")).toBeVisible();
  expect(await deleteAuditCount(page)).toBe(1);
  await shoot(page, "note-delete-success-desktop-1440x900.png");

  // Reload: it really went through the overlay — the note stays gone.
  await page.reload();
  await expect(notesHeading(page)).toBeVisible();
  await expect(rowWith(page, "которую удалим")).toHaveCount(0);
  await expect(rowWith(page, "которая останется")).toBeVisible();

  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

/* ------------------------------------------ private note deletion */

test("author deletes an own PRIVATE note by the same flow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page, {
    seed: overlayWithNote({ authorEmployeeId: ACTOR, visibility: "private", body: "Приватная, но удаляемая." }),
  });
  await expect(page.getByText("Приватная, но удаляемая.")).toBeVisible();
  await expect(rowWith(page, "удаляемая").getByText("Приватная заметка", { exact: true })).toBeVisible();

  await deleteBtn(page, "удаляемая").click();
  await confirmBtn(page).click();

  await expect(rowWith(page, "удаляемая")).toHaveCount(0);
  await expect(page.getByText(DELETED)).toBeVisible();
});

/* ------------------------------------------ re-add does not resurrect */

test("adding a new note after a delete does not bring the deleted one back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Обречённая заметка.");
  await deleteBtn(page, "Обречённая").click();
  await confirmBtn(page).click();
  await expect(rowWith(page, "Обречённая")).toHaveCount(0);

  // A fresh note is a NEW note — the deleted one never reappears.
  await addNote(page, "Совершенно новая заметка.");
  await expect(rowWith(page, "Совершенно новая")).toBeVisible();
  await expect(rowWith(page, "Обречённая")).toHaveCount(0);
  // Exactly one deletion recorded; no resurrection.
  expect(await deleteAuditCount(page)).toBe(1);
});

/* ------------------------------------------ foreign note: no control */

test("a foreign-authored note is visible but has no delete control", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page, {
    seed: overlayWithNote({ authorEmployeeId: "emp_foreign_9", visibility: "team", body: "Чужая командная заметка." }),
  });
  await expect(page.getByText("Чужая командная заметка.")).toBeVisible();
  await expect(rowWith(page, "Чужая").getByRole("button", { name: DELETE })).toHaveCount(0);
});

/* ------------------------------------------ forbidden role: no control */

test("a role without edit rights sees the note but gets no delete control", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page, {
    role: "read_only",
    seed: overlayWithNote({ authorEmployeeId: ACTOR, visibility: "team", body: "Заметка, которую read_only не удалит." }),
  });
  await expect(page.getByText("Заметка, которую read_only не удалит.")).toBeVisible();
  await expect(rowWith(page, "read_only").getByRole("button", { name: DELETE })).toHaveCount(0);
  await shoot(page, "note-delete-forbidden-desktop-1440x900.png");
});

/* ------------------------------------------ conflict refetches */

test("a stale precondition conflicts: the confirm closes and the stored state shows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Совместно управляемая заметка.");

  await deleteBtn(page, "Совместно").click();
  await expect(page.getByText(CONFIRM_TITLE)).toBeVisible();

  // Another writer touches the note, advancing `updatedAt`. The open confirm's
  // `expectedUpdatedAt` is now stale, so the delete loses the race.
  await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)!;
    const o = JSON.parse(raw) as { notes: { id: string; updatedAt: string }[] };
    const n = o.notes.find((x) => x.id.startsWith("note_mock_"))!;
    n.updatedAt = new Date(Date.parse(n.updatedAt) + 60_000).toISOString();
    window.localStorage.setItem(key, JSON.stringify(o));
  }, OVERLAY_KEY);

  await confirmBtn(page).click();

  await expect(page.getByText(CONFLICT)).toBeVisible();
  await expect(page.getByText(CONFIRM_TITLE)).toHaveCount(0);
  // The note is still there — the delete did not take.
  await expect(rowWith(page, "Совместно")).toBeVisible();
  await shoot(page, "note-delete-conflict-desktop-1440x900.png");
});

/* ------------------------------------------ storage failure + retry */

test("a storage failure keeps the note and the confirm, shows a safe error, hides diagnostics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedOverlay(page, overlayWithNote({ authorEmployeeId: ACTOR, visibility: "team", body: "Заметка, чьё удаление не сохранится." }));
  await breakOverlayWrites(page);
  await page.goto(`/users/${USER}`);
  await expect(notesHeading(page)).toBeVisible();
  await expect(page.getByText("не сохранится")).toBeVisible();

  await deleteBtn(page, "не сохранится").click();
  await confirmBtn(page).click();

  await expect(page.getByText("Локальное сохранение недоступно. Попробуйте ещё раз")).toBeVisible();
  // The confirm stays open and the note is still there for a retry under the same key.
  await expect(page.getByText(CONFIRM_TITLE)).toBeVisible();
  await expect(rowWith(page, "не сохранится")).toBeVisible();

  const html = await page.content();
  expect(html).not.toContain("Mock overlay could not be persisted");
  expect(html).not.toContain("QuotaExceededError");
  expect(html).not.toContain(OVERLAY_KEY);
  await shoot(page, "note-delete-storage-error-desktop-1440x900.png");
});

/* ------------------------------------------ one active surface per row */

test("opening the delete confirm hides the other controls of the row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка с единственным активным режимом.");

  const row = rowWith(page, "единственным активным");
  await row.getByRole("button", { name: DELETE }).click();
  await expect(page.getByText(CONFIRM_TITLE)).toBeVisible();
  await expect(row.getByRole("button", { name: "Изменить заметку" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Изменить доступ к заметке" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Закрепить заметку" })).toHaveCount(0);

  // Escape closes the confirm without deleting.
  await page.keyboard.press("Escape");
  await expect(page.getByText(CONFIRM_TITLE)).toHaveCount(0);
  await expect(row).toBeVisible();
});

/* ------------------------------------------ global /audit integration */

test("global /audit shows the delete as a neutral fact, never the body or id", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка, которую удалим для журнала.");
  await deleteBtn(page, "для журнала").click();
  await confirmBtn(page).click();
  await expect(rowWith(page, "для журнала")).toHaveCount(0);

  await page.goto("/audit");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/удалил заметку у/).first()).toBeVisible();

  const html = await page.content();
  expect(html).not.toContain("Заметка, которую удалим для журнала.");
  expect(html).not.toContain("note_mock_");
  expect(html).not.toContain("audit_mock_");
  await page.screenshot({ path: `${OUT}/audit-note-deleted-desktop-1440x900.png` });
});

/* ------------------------------------------ responsive / zoom */

test("mobile 390x844 — the confirm fits with no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNotes(page, {
    seed: overlayWithNote({ authorEmployeeId: ACTOR, visibility: "team", body: "Мобильная заметка для удаления." }),
  });
  await deleteBtn(page, "Мобильная").click();
  await expect(page.getByText(CONFIRM_TITLE)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  await shoot(page, "note-delete-mobile-390x844.png");
});

test("mobile 320x720 — the narrowest supported width still fits the confirm", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openNotes(page, {
    seed: overlayWithNote({ authorEmployeeId: ACTOR, visibility: "team", body: "Узкая заметка для удаления." }),
  });
  await deleteBtn(page, "Узкая").click();
  await expect(page.getByText(CONFIRM_TITLE)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  await shoot(page, "note-delete-mobile-320x720.png");
});

test("tablet 1024x768 — the confirm stays inside the column", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openNotes(page, {
    seed: overlayWithNote({ authorEmployeeId: ACTOR, visibility: "team", body: "Планшетная заметка для удаления." }),
  });
  await deleteBtn(page, "Планшетная").click();
  await expect(page.getByText(CONFIRM_TITLE)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  await shoot(page, "note-delete-tablet-1024x768.png");
});

/**
 * 200% zoom modelled as a real reflow (720×450), NOT documentElement.style.zoom:
 * at 720×450 the shell genuinely reflows to one column.
 */
test("200% zoom (720x450) reflows: no overflow, the confirm is usable", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await openNotes(page, {
    seed: overlayWithNote({ authorEmployeeId: ACTOR, visibility: "team", body: "Заметка для реального reflow при 200%." }),
  });
  await deleteBtn(page, "reflow").click();
  await expect(page.getByText(CONFIRM_TITLE)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  await confirmBtn(page).click();
  await expect(page.getByText(DELETED)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${OUT}/note-delete-zoom-200-720x450.png` });
});
