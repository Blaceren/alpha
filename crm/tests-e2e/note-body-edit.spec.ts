import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * User 360 note body edit (Phase 1B4-E) E2E + screenshot suite — driven in a real
 * browser. The existing suites (smoke, users, user-360, owner assignment, notes,
 * note pin, today, provider-privacy) are untouched and still run alongside these.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Set PHASE_1B4E_PASS=first to write into the first-pass folder.
 */
const PASS = process.env.PHASE_1B4E_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1b4-e-note-body-edit/${PASS}`;
mkdirSync(OUT, { recursive: true });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";
const OVERLAY_KEY = "ata-crm.mutation-overlay.v1";

/** Nina Chmiel — the canonical high-priority persona the notes/1C suites use. */
const USER = "usr_mock_026";
const FIXTURE_NOTE = /Синтетическая заметка: демонстрационная запись/;
const EDIT = "Изменить заметку";
const SAVE = "Сохранить";
const CANCEL = "Отменить";
const SAVED = "Заметка обновлена";
const CONFLICT = "Заметка уже изменена. Показан актуальный текст.";
const EDIT_LABEL = "Новый текст заметки";

/**
 * Every test starts from a clean overlay, so none depends on another's writes.
 * Fired once per tab (guarded in sessionStorage) so a reload does not wipe the edit
 * whose survival is the point of one of these tests — the same pattern the notes
 * and pin suites use.
 */
async function resetOverlay(page: Page) {
  await page.addInitScript((key) => {
    try {
      if (window.sessionStorage.getItem("__ata_edit_overlay_cleared")) return;
      window.localStorage.removeItem(key);
      window.sessionStorage.setItem("__ata_edit_overlay_cleared", "1");
    } catch {
      /* storage unavailable — the app already treats that as an empty overlay */
    }
  }, OVERLAY_KEY);
}

/** Seed a raw overlay once per tab (survives reloads), for foreign-author cases. */
async function seedOverlay(page: Page, overlay: unknown) {
  await page.addInitScript(
    ([key, json]) => {
      try {
        if (window.sessionStorage.getItem("__ata_edit_seeded")) return;
        window.localStorage.setItem(key, json);
        window.sessionStorage.setItem("__ata_edit_seeded", "1");
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

/** Make persisting the overlay fail, the way a disabled or full storage does. */
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

async function bodyAuditCount(page: Page) {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { auditRecords?: { action?: string }[] };
      return (parsed.auditRecords ?? []).filter((a) => a.action === "note_body_changed").length;
    } catch {
      return -1;
    }
  }, OVERLAY_KEY);
}

const notesHeading = (page: Page) => page.getByRole("heading", { level: 2, name: "Заметки" });
const notesSection = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Заметки" }) });
const notesForm = (page: Page) => notesSection(page).locator("form").filter({ has: page.locator("textarea") }).first();
const noteItems = (page: Page) => notesSection(page).locator("ol > li");
const rowWith = (page: Page, text: string | RegExp) => noteItems(page).filter({ hasText: text });
const editorTextarea = (page: Page) => page.getByLabel(EDIT_LABEL);
// Save/Cancel/pending are scoped to the notes section — the owner-assign form on the
// same page also has a «Сохранить» control.
const saveBtn = (page: Page) => notesSection(page).getByRole("button", { name: SAVE });
const cancelBtn = (page: Page) => notesSection(page).getByRole("button", { name: CANCEL });
const pendingBtn = (page: Page) => notesSection(page).getByRole("button", { name: "Сохраняем…" });

async function openNotes(page: Page, opts: { role?: string; seed?: unknown } = {}) {
  if (opts.seed) await seedOverlay(page, opts.seed);
  else await resetOverlay(page);
  if (opts.role) await seedRole(page, opts.role);
  await page.goto(`/users/${USER}`);
  await expect(notesHeading(page)).toBeVisible();
  await expect(page.getByText(FIXTURE_NOTE)).toBeVisible();
}

/** Notes sit below the fold — scroll the section into frame before shooting. */
async function shoot(page: Page, name: string) {
  await notesSection(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}` });
}

/** Add a note through the real composer and wait for the re-read to land. */
async function addNote(page: Page, body: string) {
  // On mobile the composer starts collapsed behind a disclosure — expand it first.
  const toggle = notesSection(page).getByRole("button", { name: "Добавить заметку", expanded: false });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();

  await notesForm(page).locator("textarea").fill(body);
  await notesForm(page).locator('button[type="submit"]').click();
  await expect(page.getByText("Заметка добавлена")).toBeVisible();
  await expect(rowWith(page, body.trim())).toBeVisible();
}

/* ------------------------------------------------ create → edit → reload */

test("create a note, edit its body, reload — the edited body persists", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Первоначальный текст заметки о работе с пользователем.");

  await shoot(page, "note-edit-idle-desktop-1440x900.png");

  const row = rowWith(page, "Первоначальный текст");
  await row.getByRole("button", { name: EDIT }).click();
  await expect(editorTextarea(page)).toHaveValue("Первоначальный текст заметки о работе с пользователем.");
  await shoot(page, "note-edit-editing-desktop-1440x900.png");

  await editorTextarea(page).fill("Отредактированный текст: пользователь перезвонит завтра.");
  await saveBtn(page).click();

  await expect(page.getByText(SAVED)).toBeVisible();
  await expect(rowWith(page, "Отредактированный текст: пользователь перезвонит завтра.")).toBeVisible();
  await expect(page.getByText("Первоначальный текст заметки")).toHaveCount(0);
  expect(await bodyAuditCount(page)).toBe(1);
  await shoot(page, "note-edit-success-desktop-1440x900.png");

  // It really went through the overlay: a reload still shows the new body.
  await page.reload();
  await expect(notesHeading(page)).toBeVisible();
  await expect(rowWith(page, "Отредактированный текст: пользователь перезвонит завтра.")).toBeVisible();

  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

/* ------------------------------------------------ no control where forbidden */

test("the fixture note has no edit control, only the authored one does", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Авторская заметка, которую можно править.");

  await expect(rowWith(page, "Авторская заметка").getByRole("button", { name: EDIT })).toBeVisible();
  await expect(rowWith(page, FIXTURE_NOTE).getByRole("button", { name: EDIT })).toHaveCount(0);
});

test("a note authored by someone else has no edit control", async ({ page }) => {
  const foreign = {
    version: 1,
    sequence: 1,
    notes: [
      {
        id: "note_mock_0001",
        userId: USER,
        caseId: null,
        authorEmployeeId: "emp_someone_else",
        body: "Заметка другого сотрудника — только для чтения.",
        visibility: "team",
        pinned: false,
        createdAt: "2026-07-10T09:00:00.000Z",
        updatedAt: "2026-07-10T09:00:00.000Z",
        mock: true,
      },
    ],
    auditRecords: [],
    idempotencyReceipts: [],
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page, { seed: foreign });

  // The foreign note is visible (team) but carries no edit control.
  await expect(rowWith(page, "Заметка другого сотрудника")).toBeVisible();
  await expect(rowWith(page, "Заметка другого сотрудника").getByRole("button", { name: EDIT })).toHaveCount(0);
});

for (const role of ["read_only", "analyst"] as const) {
  test(`${role} gets no edit control — absent, not disabled`, async ({ page }) => {
    const errors = trackConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNotes(page, { role });

    await expect(page.getByText(FIXTURE_NOTE)).toBeVisible();
    await expect(notesSection(page).getByRole("button", { name: EDIT })).toHaveCount(0);

    if (role === "read_only") await shoot(page, "note-edit-forbidden-desktop-1440x900.png");
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
}

/* ------------------------------------------------ validation / unchanged */

test("Save is disabled for an unchanged or emptied body", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Текст, который будем проверять на валидацию.");

  await rowWith(page, "валидацию").getByRole("button", { name: EDIT }).click();
  // Prefilled → unchanged → disabled.
  await expect(saveBtn(page)).toBeDisabled();

  await editorTextarea(page).fill("   ");
  await expect(saveBtn(page)).toBeDisabled();
  await shoot(page, "note-edit-validation-desktop-1440x900.png");

  await editorTextarea(page).fill("Настоящее изменение");
  await expect(saveBtn(page)).toBeEnabled();
});

/* ------------------------------------------------ cancel / keyboard / focus */

test("cancel discards the draft and restores focus to the edit control", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка для отмены правки.");

  await rowWith(page, "отмены").getByRole("button", { name: EDIT }).click();
  await editorTextarea(page).fill("Черновик, который выбросим");
  await cancelBtn(page).click();

  await expect(editorTextarea(page)).toHaveCount(0);
  await expect(page.getByText("Заметка для отмены правки.")).toBeVisible();
  await expect(page.getByText("Черновик, который выбросим")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    .toBe(EDIT);
});

test("Escape cancels editing and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка для клавиши Escape.");

  await rowWith(page, "Escape").getByRole("button", { name: EDIT }).click();
  await editorTextarea(page).fill("изменение перед Escape");
  await editorTextarea(page).press("Escape");

  await expect(editorTextarea(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    .toBe(EDIT);
});

test("save from the keyboard works and focus returns to the control", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка, сохраняемая с клавиатуры.");

  await rowWith(page, "клавиатуры").getByRole("button", { name: EDIT }).click();
  await editorTextarea(page).fill("Сохранено нажатием Enter в поле");
  // Enter in the textarea inserts a newline; submit via the Save button focus+Enter.
  await saveBtn(page).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByText(SAVED)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    .toBe(EDIT);
});

/* ------------------------------------------------ pending frame */

test("pending is stated in words while the write is in flight", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка для кадра ожидания.");

  await rowWith(page, "ожидания").getByRole("button", { name: EDIT }).click();
  await editorTextarea(page).fill("Текст, сохранение которого мы поймаем в полёте");
  await saveBtn(page).click();

  // The dev provider adds a 150ms gate delay — long enough to catch the pending state.
  const pending = pendingBtn(page);
  await expect(pending).toBeVisible();
  await expect(pending).toBeDisabled();
  await shoot(page, "note-edit-pending-desktop-1440x900.png");

  await expect(page.getByText(SAVED)).toBeVisible();
});

/* ------------------------------------------------ conflict (concurrent writer) */

test("a stale updatedAt conflicts: the list re-reads and shows the stored text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Совместно редактируемая заметка.");

  // Open the editor — it now holds the note's current updatedAt.
  await rowWith(page, "Совместно").getByRole("button", { name: EDIT }).click();

  // Simulate ANOTHER writer persisting a newer version straight to the overlay,
  // exactly as a second provider/tab would. The open editor's precondition is now
  // stale.
  await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)!;
    const o = JSON.parse(raw) as {
      notes: { id: string; body: string; updatedAt: string }[];
    };
    const n = o.notes.find((x) => x.id.startsWith("note_mock_"))!;
    n.body = "Версия, сохранённая другим сотрудником.";
    n.updatedAt = new Date(Date.parse(n.updatedAt) + 60_000).toISOString();
    window.localStorage.setItem(key, JSON.stringify(o));
  }, OVERLAY_KEY);

  await editorTextarea(page).fill("Моя версия, которая проиграет гонку");
  await saveBtn(page).click();

  // The calm conflict line, the editor closed, and the ACTUAL stored text shown.
  await expect(page.getByText(CONFLICT)).toBeVisible();
  await expect(editorTextarea(page)).toHaveCount(0);
  await expect(rowWith(page, "Версия, сохранённая другим сотрудником.")).toBeVisible();
  await expect(page.getByText("Моя версия, которая проиграет гонку")).toHaveCount(0);
  await shoot(page, "note-edit-conflict-desktop-1440x900.png");
});

/* ------------------------------------------------ storage failure + retry */

test("a storage failure keeps the draft, shows the safe error, and hides diagnostics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Seed an authored note directly, then break writes so the edit cannot persist.
  const seed = {
    version: 1,
    sequence: 1,
    notes: [
      {
        id: "note_mock_0001",
        userId: USER,
        caseId: null,
        authorEmployeeId: "emp_mock_admin",
        body: "Заметка, правка которой не сохранится.",
        visibility: "team",
        pinned: false,
        createdAt: "2026-07-10T09:00:00.000Z",
        updatedAt: "2026-07-10T09:00:00.000Z",
        mock: true,
      },
    ],
    auditRecords: [],
    idempotencyReceipts: [],
  };
  await seedOverlay(page, seed);
  await breakOverlayWrites(page);
  await page.goto(`/users/${USER}`);
  await expect(notesHeading(page)).toBeVisible();
  await expect(page.getByText("не сохранится")).toBeVisible();

  await rowWith(page, "не сохранится").getByRole("button", { name: EDIT }).click();
  await editorTextarea(page).fill("Изменение, которое не запишется");
  await saveBtn(page).click();

  await expect(page.getByText("Локальное сохранение недоступно. Попробуйте ещё раз")).toBeVisible();
  // The editor stays open with the draft intact for a retry.
  await expect(editorTextarea(page)).toHaveValue("Изменение, которое не запишется");

  const html = await page.content();
  expect(html).not.toContain("Mock overlay could not be persisted");
  expect(html).not.toContain("QuotaExceededError");
  expect(html).not.toContain(OVERLAY_KEY);
});

/* ------------------------------------------------ pin coexistence */

test("pin state survives a body edit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка, которую закрепим и затем отредактируем.");

  // Pin the authored note.
  await rowWith(page, "закрепим").getByRole("button", { name: "Закрепить заметку" }).click();
  await expect(page.getByText("Заметка закреплена")).toBeVisible();
  await expect(rowWith(page, "закрепим").getByText("Закреплено")).toBeVisible();

  // Edit its body.
  await rowWith(page, "закрепим").getByRole("button", { name: EDIT }).click();
  await editorTextarea(page).fill("Отредактированный текст, приоритет сохраняется.");
  await saveBtn(page).click();
  await expect(page.getByText(SAVED)).toBeVisible();

  // Still pinned, now with the new body.
  const editedRow = rowWith(page, "Отредактированный текст, приоритет сохраняется.");
  await expect(editedRow).toBeVisible();
  await expect(editedRow.getByText("Закреплено", { exact: true })).toBeVisible();
});

/* ------------------------------------------------ responsive / zoom */

test("mobile 390x844 — the editor fits inside the row with 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNotes(page);
  await addNote(page, "Мобильная заметка для правки.");

  await rowWith(page, "Мобильная").getByRole("button", { name: EDIT }).click();
  await expect(editorTextarea(page)).toBeVisible();
  const save = saveBtn(page);
  const box = await save.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, "note-edit-mobile-390x844.png");
});

test("mobile 320x720 — the narrowest supported width still fits the editor", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openNotes(page);
  await addNote(page, "Узкая мобильная заметка.");

  await rowWith(page, "Узкая").getByRole("button", { name: EDIT }).click();
  await expect(editorTextarea(page)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, "note-edit-mobile-320x720.png");
});

/**
 * 200% zoom modelled as a real reflow (720×450), NOT `documentElement.style.zoom`
 * (Phase 1B4-C.1): CSS zoom leaves media queries seeing the desktop width, so the
 * layout never reflows and the check is a lie. At 720×450 the shell genuinely
 * reflows to a single column.
 */
test("200% zoom (720x450) reflows: no overflow, the editor is usable", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 720, height: 450 });
  await openNotes(page);
  await addNote(page, "Заметка для проверки реального reflow при 200%.");

  const control = rowWith(page, "reflow").getByRole("button", { name: EDIT });
  await control.scrollIntoViewIfNeeded();
  await control.click();
  await expect(editorTextarea(page)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await editorTextarea(page).fill("Изменено при 200% масштаба без горизонтальной прокрутки.");
  await saveBtn(page).click();
  await expect(page.getByText(SAVED)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await notesSection(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/note-edit-zoom-200-720x450.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
