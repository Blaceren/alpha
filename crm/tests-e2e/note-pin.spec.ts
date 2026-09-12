import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * User 360 note pin/unpin (Phase 1B4-D) E2E + screenshot suite — driven in a real
 * browser. The existing suites (smoke, users, user-360, owner assignment, notes,
 * today, provider-privacy) are untouched and still run alongside these.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Set PHASE_1B4D_PASS=first to write into the first-pass folder.
 */
const PASS = process.env.PHASE_1B4D_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1b4-d-note-pin/${PASS}`;
mkdirSync(OUT, { recursive: true });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";
const OVERLAY_KEY = "ata-crm.mutation-overlay.v1";

/** Nina Chmiel — the canonical high-priority persona used by the notes/1C suites. */
const USER = "usr_mock_026";
const FIXTURE_NOTE = /Синтетическая заметка: демонстрационная запись/;
const PIN = "Закрепить заметку";
const UNPIN = "Открепить заметку";

/**
 * Every test starts from a clean overlay, so none depends on another's writes.
 * Fired once per tab (guarded in sessionStorage) so a reload does not wipe the pin
 * whose survival is the point of one of these tests — the same pattern the notes
 * suite uses.
 */
async function resetOverlay(page: Page) {
  await page.addInitScript((key) => {
    try {
      if (window.sessionStorage.getItem("__ata_pin_overlay_cleared")) return;
      window.localStorage.removeItem(key);
      window.sessionStorage.setItem("__ata_pin_overlay_cleared", "1");
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

async function pinAuditCount(page: Page) {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { auditRecords?: { action?: string }[] };
      return (parsed.auditRecords ?? []).filter((a) => a.action === "note_pin_changed").length;
    } catch {
      return -1;
    }
  }, OVERLAY_KEY);
}

const notesForm = (page: Page) => page.locator("form").filter({ has: page.locator("textarea") });
const notesHeading = (page: Page) => page.getByRole("heading", { level: 2, name: "Заметки" });
const notesSection = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Заметки" }) });
const noteItems = (page: Page) => notesSection(page).locator("ol > li");

async function openNotes(page: Page, role?: string) {
  await resetOverlay(page);
  if (role) await seedRole(page, role);
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
  await notesForm(page).locator("textarea").fill(body);
  await notesForm(page).locator('button[type="submit"]').click();
  await expect(page.getByText("Заметка добавлена")).toBeVisible();
  await expect(page.getByText(body.trim())).toBeVisible();
}

/* --------------------------------------------------------- pin / order */

test("admin pins the seeded fixture note; it gains the pinned badge", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  await shoot(page, "note-pin-default-desktop-1440x900.png");
  await notesSection(page).getByRole("button", { name: PIN }).click();

  await expect(notesSection(page).getByRole("button", { name: UNPIN })).toBeVisible();
  await expect(notesSection(page).getByText("Закреплено")).toBeVisible();
  await expect(page.getByText("Заметка закреплена")).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await shoot(page, "note-pin-fixture-success-desktop-1440x900.png");
  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

test("pinning the older note moves it to the top after the canonical re-read", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Более новая авторская заметка о работе с пользователем.");

  // Newest first: the authored note leads, the fixture note trails.
  await expect(noteItems(page).first()).toContainText("Более новая авторская заметка");
  await expect(noteItems(page).last()).toContainText("Синтетическая заметка");

  // Pin the OLDER fixture note — its control is the last one.
  await notesSection(page).getByRole("button", { name: PIN }).last().click();
  await expect(page.getByText("Заметка закреплена")).toBeVisible();

  // It has jumped to the top.
  await expect(noteItems(page).first()).toContainText("Синтетическая заметка");
  await shoot(page, "note-pin-authored-success-desktop-1440x900.png");
});

test("a reload keeps the pin — it really went through the overlay", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  await notesSection(page).getByRole("button", { name: PIN }).click();
  await expect(notesSection(page).getByText("Закреплено")).toBeVisible();

  await page.reload();
  await expect(notesHeading(page)).toBeVisible();
  await expect(notesSection(page).getByText("Закреплено")).toBeVisible();
  await expect(notesSection(page).getByRole("button", { name: UNPIN })).toBeVisible();
});

test("unpinning returns the note to the normal order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Более новая авторская заметка для проверки порядка.");

  await notesSection(page).getByRole("button", { name: PIN }).last().click();
  await expect(noteItems(page).first()).toContainText("Синтетическая заметка");

  await notesSection(page).getByRole("button", { name: UNPIN }).click();
  await expect(page.getByText("Заметка откреплена")).toBeVisible();
  // Newest-first order is back: the authored note leads again.
  await expect(noteItems(page).first()).toContainText("Более новая авторская заметка");
  await shoot(page, "note-unpin-success-desktop-1440x900.png");
});

test("support may pin", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page, "support");

  await notesSection(page).getByRole("button", { name: PIN }).click();
  await expect(notesSection(page).getByText("Закреплено")).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* --------------------------------------------------------- forbidden roles */

for (const role of ["read_only", "analyst"] as const) {
  test(`${role} gets no pin control — the control is absent, not disabled`, async ({ page }) => {
    const errors = trackConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNotes(page, role);

    // The fixture note is visible, but there is no pin control at all.
    await expect(page.getByText(FIXTURE_NOTE)).toBeVisible();
    await expect(notesSection(page).getByRole("button", { name: PIN })).toHaveCount(0);
    await expect(notesSection(page).getByRole("button", { name: UNPIN })).toHaveCount(0);
    // Not merely disabled: no such button exists in the DOM.
    expect(
      await notesSection(page).locator('button[aria-pressed]').count(),
    ).toBe(0);

    if (role === "read_only") await shoot(page, "note-pin-forbidden-desktop-1440x900.png");
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
}

/* --------------------------------------------------------- error surface */

test("a storage failure shows the Russian inline error with no diagnostics", async ({ page }) => {
  await breakOverlayWrites(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  await notesSection(page).getByRole("button", { name: PIN }).click();
  await expect(page.getByText("Локальное сохранение недоступно. Попробуйте ещё раз")).toBeVisible();

  const html = await page.content();
  expect(html).not.toContain("Mock overlay could not be persisted");
  expect(html).not.toContain("QuotaExceededError");
  expect(html).not.toContain(OVERLAY_KEY);
  // The note is not shown pinned — nothing was written.
  await expect(notesSection(page).getByText("Закреплено")).toHaveCount(0);

  await shoot(page, "note-pin-storage-error-desktop-1440x900.png");
});

test("a double click creates exactly one pin audit record", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  const btn = notesSection(page).getByRole("button", { name: PIN });
  await btn.click();
  await btn.click({ force: true, timeout: 1500 }).catch(() => {
    /* already unpin/disabled — the guard did its job */
  });
  await expect(notesSection(page).getByText("Закреплено")).toBeVisible();

  expect(await pinAuditCount(page)).toBe(1);
});

/* --------------------------------------------------------- keyboard / focus */

test("pin and unpin work from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);

  const pin = notesSection(page).getByRole("button", { name: PIN });
  await pin.focus();
  await page.keyboard.press("Enter");
  await expect(notesSection(page).getByText("Закреплено")).toBeVisible();

  const unpin = notesSection(page).getByRole("button", { name: UNPIN });
  await unpin.focus();
  await page.keyboard.press(" ");
  await expect(notesSection(page).getByText("Закреплено")).toHaveCount(0);
});

test("focus returns to the acted note's control after it reorders", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Более новая авторская заметка, чтобы вызвать переупорядочивание.");

  // Pin the older fixture note; it jumps to the top and its control must keep focus.
  await notesSection(page).getByRole("button", { name: PIN }).last().click();
  await expect(page.getByText("Заметка закреплена")).toBeVisible();
  // Wait for the re-read to settle (the note moved to the top)…
  await expect(noteItems(page).first()).toContainText("Синтетическая заметка");

  // …then the focused control is the acted note's, now offering "unpin".
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    .toBe(UNPIN);
});

/* --------------------------------------------------------- responsive / zoom */

test("mobile 390x844 — the control fits and does not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNotes(page);

  const btn = notesSection(page).getByRole("button", { name: PIN });
  const box = await btn.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await shoot(page, "note-pin-mobile-390x844.png");
});

test("mobile 320x720 — the narrowest supported width still fits", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openNotes(page);

  await expect(notesSection(page).getByRole("button", { name: PIN })).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await shoot(page, "note-pin-mobile-320x720.png");
});

/**
 * 200% zoom modelled as a real reflow (720×450), NOT `documentElement.style.zoom`
 * (Phase 1B4-C.1): CSS zoom leaves media queries seeing the desktop width, so the
 * layout never reflows and the check is a lie. At 720×450 the shell genuinely
 * reflows to a single column.
 */
test("200% zoom (720x450) reflows: no overflow, pin control reachable", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 720, height: 450 });
  await openNotes(page);

  const btn = notesSection(page).getByRole("button", { name: PIN });
  await btn.scrollIntoViewIfNeeded();
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  // The control still works after the reflow.
  await btn.click();
  await expect(notesSection(page).getByText("Закреплено")).toBeVisible();

  await notesSection(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/note-pin-zoom-200-720x450.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
