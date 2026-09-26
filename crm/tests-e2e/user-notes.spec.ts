import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { stripFlightRowRefs } from "./rsc-flight";

/**
 * User 360 notes (Phase 1B4-B) E2E + screenshot suite — the first mutating
 * surface in the CRM, driven in a real browser.
 *
 * The existing suites are untouched: smoke (5), users-screenshots (5),
 * users-sticky-action (3), user-360 (13), provider-privacy (4) and today (11)
 * still run alongside these.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Set PHASE_1B4B_PASS=first to write into the first-pass folder.
 */
const PASS = process.env.PHASE_1B4B_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1b4-b-add-note/${PASS}`;
mkdirSync(OUT, { recursive: true });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";
const OVERLAY_KEY = "ata-crm.mutation-overlay.v1";

/** Nina Chmiel — the canonical high-priority persona used by the 1C suite. */
const USER = "usr_mock_026";
const FULL_EMAIL = "nina.chmiel@example.test";
const FIXTURE_NOTE = /Синтетическая заметка: демонстрационная запись/;

/**
 * Every test starts from a clean overlay, so none depends on another's writes.
 * Only the overlay key is removed: the role key is this suite's own setup, and
 * every other key belongs to a feature tested elsewhere.
 *
 * The clear is fired once per tab rather than on every navigation, because an
 * init script re-runs on reload — clearing there would wipe the note whose
 * survival across a reload is the whole point of one of these tests. The guard
 * lives in sessionStorage so it survives the reload the same way the overlay
 * does.
 */
async function resetOverlay(page: Page) {
  await page.addInitScript((key) => {
    try {
      if (window.sessionStorage.getItem("__ata_overlay_cleared")) return;
      window.localStorage.removeItem(key);
      window.sessionStorage.setItem("__ata_overlay_cleared", "1");
    } catch {
      /* storage unavailable — the app already treats that as an empty overlay */
    }
  }, OVERLAY_KEY);
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

/**
 * The notes composer form. Since Phase 1B4-C the User 360 renders a second form —
 * the owner picker in "Ответственный и работа" — so a bare `form` locator is
 * ambiguous. The notes form is the only one with a textarea; scoping to it keeps
 * every assertion below exactly as it was.
 */
const notesForm = (page: Page) => page.locator("form").filter({ has: page.locator("textarea") });
const composer = (page: Page) => notesForm(page).locator("textarea");
const submit = (page: Page) => notesForm(page).locator('button[type="submit"]');

/**
 * The composer's own alert. Scoped to the notes form because Next.js keeps a
 * permanent empty `role="alert"` route announcer in the document, and the owner
 * form has an alert of its own.
 */
const formAlert = (page: Page) => notesForm(page).getByRole("alert");

const notesHeading = (page: Page) => page.getByRole("heading", { level: 2, name: "Заметки" });
const notesSection = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Заметки" }) });

async function openNotes(page: Page, role?: string) {
  await resetOverlay(page);
  if (role) await seedRole(page, role);
  await page.goto(`/users/${USER}`);
  await expect(notesHeading(page)).toBeVisible();
  // Wait for the list itself, not just the section frame: the section renders
  // immediately with a skeleton, so measuring or photographing here without this
  // captures the loading state.
  await expect(page.getByText(FIXTURE_NOTE)).toBeVisible();
}

/**
 * Notes live below the fold by design — the profile answers "why is this user
 * open" first (docs/USER_360.md §Information architecture). Screenshots of the
 * section therefore have to scroll to it; a bare viewport shot documents the
 * header instead of the thing under review.
 */
async function shoot(page: Page, name: string) {
  await notesSection(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}` });
}

/**
 * Add a note through the real controls, and wait until the re-read has landed —
 * not merely until the confirmation appears. There is a real window between the
 * two (the provider re-reads with the dev delay), and stopping at the
 * confirmation photographs a list that has not caught up yet.
 */
async function addNote(page: Page, body: string) {
  await composer(page).fill(body);
  await submit(page).click();
  await expect(page.getByText("Заметка добавлена")).toBeVisible();
  await expect(page.getByText(body.trim())).toBeVisible();
}

/* --------------------------------------------------------- allowed roles */

test("crm_admin sees the notes section and the composer", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  await expect(page.getByText(FIXTURE_NOTE)).toBeVisible();
  await expect(composer(page)).toBeVisible();
  await expect(submit(page)).toHaveText("Добавить заметку");
  await expect(page.getByText("Ваша роль не может добавлять заметки")).toHaveCount(0);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await shoot(page, "notes-admin-empty-1440x900.png");
  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

test("admin drafts a note — the draft is visible beside the existing list", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  await composer(page).fill("Созвонились по блокеру: пользователь ждёт ответа поддержки до конца дня.");
  await expect(page.getByText(FIXTURE_NOTE)).toBeVisible();

  await shoot(page, "notes-admin-draft-1440x900.png");
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("admin adds a note and it appears without a page reload", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  const body = "Созвонились по блокеру: пользователь ждёт ответа поддержки до конца дня.";
  await addNote(page, body);

  // No navigation happened — the list was re-read through the provider.
  await expect(page.getByText(body)).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await shoot(page, "notes-admin-success-1440x900.png");
  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

test("a reload keeps the note — it really went through the overlay", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  const body = "Заметка переживает перезагрузку страницы.";
  await addNote(page, body);

  await page.reload();
  await expect(notesHeading(page)).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();
});

test("a duplicate submit does not create a duplicate note", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  const body = "Ровно одна заметка, сколько бы раз ни нажали.";
  await composer(page).fill(body);
  // Two clicks as fast as the driver allows; the button disables on the first.
  await submit(page).click();
  await submit(page).click({ force: true, timeout: 2000 }).catch(() => {
    /* already disabled — that is the guard doing its job */
  });
  await expect(page.getByText("Заметка добавлена")).toBeVisible();

  await expect(page.getByText(body)).toHaveCount(1);
});

test("support may add a note and still gets no exact financials or full email", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page, "support");

  await addNote(page, "Support: обновил статус обращения.");
  await expect(page.getByText("Support: обновил статус обращения.")).toBeVisible();

  // Writing a note does not widen what support may read.
  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain("$90");
  expect(html).not.toContain(FULL_EMAIL);
  expect(html).toContain("$50–99");

  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* ------------------------------------------------------- forbidden roles */

for (const role of ["read_only", "analyst"] as const) {
  test(`${role} gets no form controls, only a calm explanation`, async ({ page }) => {
    const errors = trackConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNotes(page, role);

    await expect(page.getByText("Ваша роль не может добавлять заметки")).toBeVisible();
    await expect(composer(page)).toHaveCount(0);
    await expect(submit(page)).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
    // The list itself is still readable — reading notes is not the same right.
    await expect(page.getByText(FIXTURE_NOTE)).toBeVisible();

    if (role === "read_only") {
      await shoot(page, "notes-read-only-role-1440x900.png");
    }
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
}

/* ----------------------------------------------------------- validation */

test("an empty body is refused inline, with no provider round trip", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  await submit(page).click();
  await expect(formAlert(page)).toHaveText("Введите текст заметки.");
  await expect(page.getByText("Заметка добавлена")).toHaveCount(0);

  await shoot(page, "notes-validation-error-1440x900.png");

  // The message retires quietly once the draft changes — no timer, no alarm.
  await composer(page).fill("Теперь есть текст");
  await expect(formAlert(page)).toHaveCount(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("an over-limit body is refused inline", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  // `maxlength` already stops a person typing past the bound, so this drives the
  // defensive branch the way only code can: set the value and fire input, which
  // is exactly what maxlength does not constrain.
  await page.evaluate((over) => {
    const el = document.querySelector("form textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(el, over);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, "я".repeat(2001));

  await submit(page).click();
  await expect(formAlert(page)).toHaveText(/Заметка длиннее 2000 символов/);
  await expect(page.getByText("Заметка добавлена")).toHaveCount(0);
});

/* ---------------------------------------------------- failure is honest */

test("a storage failure says so in Russian and leaks no diagnostics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetOverlay(page);
  await breakOverlayWrites(page);
  await page.goto(`/users/${USER}`);
  await expect(page.getByRole("heading", { level: 2, name: "Заметки" })).toBeVisible();

  await composer(page).fill("Эта заметка не сохранится.");
  await submit(page).click();

  await expect(formAlert(page)).toHaveText("Локальное сохранение недоступно. Попробуйте ещё раз");

  const html = stripFlightRowRefs(await page.content());
  // The provider's own English diagnostic never reaches the document.
  expect(html).not.toContain("Mock overlay could not be persisted");
  expect(html).not.toContain("QuotaExceededError");
  expect(html).not.toContain(OVERLAY_KEY);
  // Nothing pretends the note exists.
  await expect(page.getByText("Заметка добавлена")).toHaveCount(0);
});

test("no raw provider diagnostic appears anywhere in a healthy document", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Обычная рабочая заметка.");

  const html = stripFlightRowRefs(await page.content());
  for (const diagnostic of [
    "Mock overlay could not be persisted",
    "Note body is empty",
    "Idempotency key is required",
    "Role may not edit notes",
    "User not found",
    OVERLAY_KEY,
    "emp_mock_admin",
    "note_mock_",
    "audit_mock_",
  ]) {
    expect(html, `leaked: ${diagnostic}`).not.toContain(diagnostic);
  }
});

/* ------------------------------------------------------------ keyboard */

test("the note can be submitted from the keyboard and focus comes back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  await composer(page).focus();
  await page.keyboard.type("Отправлено с клавиатуры.");
  // Tab reaches the submit control (the counter between them is not focusable).
  await page.keyboard.press("Tab");
  await expect(submit(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Заметка добавлена")).toBeVisible();
  await expect(page.getByText("Отправлено с клавиатуры.")).toBeVisible();
  // Focus returns to the field, ready for the next note.
  await expect(composer(page)).toBeFocused();
});

/* ---------------------------------------------------------- responsive */

test("mobile 390x844 — composer starts collapsed and does not eat the screen", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openNotes(page);

  const toggle = page.getByRole("button", { name: "Добавить заметку", expanded: false });
  await expect(toggle).toBeVisible();
  await expect(composer(page)).toBeHidden();

  // 44px touch target.
  const box = await toggle.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await shoot(page, "notes-mobile-390x844.png");

  await toggle.click();
  await expect(composer(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Свернуть", expanded: true })).toBeVisible();
  await addNote(page, "С телефона.");
  await expect(page.getByText("С телефона.")).toBeVisible();

  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

test("mobile 320x720 — the narrowest supported width still fits", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openNotes(page);

  await page.getByRole("button", { name: "Добавить заметку", expanded: false }).click();
  await expect(composer(page)).toBeVisible();
  await composer(page).fill("Очень-длинное-слово-без-пробелов-которое-не-должно-ломать-раскладку-страницы-никогда");

  await shoot(page, "notes-mobile-320x720.png");
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
});

test("tablet 1024x768 — the section stays inside the main column", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await openNotes(page);

  await expect(composer(page)).toBeVisible();
  await addNote(page, "С планшета.");

  await shoot(page, "notes-tablet-1024x768.png");
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("200% zoom — the composer reflows instead of scrolling sideways", async ({ page }) => {
  // Browser zoom = a smaller CSS viewport, the same trick the 1C suite uses.
  await page.setViewportSize({ width: 720, height: 450 });
  await openNotes(page);

  await shoot(page, "notes-zoom-200.png");
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
});

/* ------------------------------------------------------- long content */

test("a long note wraps instead of breaking the layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  // Trimmed here because the provider trims before storing: an untrimmed body
  // is not the string that comes back.
  await addNote(page, "Длинная заметка. ".repeat(80).trim());
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
});
