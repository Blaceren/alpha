import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * User 360 note visibility change (Phase 1B5-C) E2E + screenshot suite — driven in a
 * real browser. The existing suites are untouched and run alongside these.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Set PHASE_1B5C_PASS=first to write into the first-pass folder.
 *
 * IDENTITY NOTE: the mock session hands every role the same `emp_mock_admin`, so a
 * role switch is NOT an employee switch. The AUTHOR flows use `emp_mock_admin`'s own
 * notes through the real UI; the FOREIGN-visibility rule is proven with overlay
 * fixtures whose `authorEmployeeId` is a DIFFERENT employee — never by pretending a
 * role change swaps identity.
 */
const PASS = process.env.PHASE_1B5C_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1b5-c-note-visibility/${PASS}`;
mkdirSync(OUT, { recursive: true });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";
const OVERLAY_KEY = "ata-crm.mutation-overlay.v1";

/** Nina Chmiel — the canonical persona the notes suites use. */
const USER = "usr_mock_026";
const FIXTURE_NOTE = /Синтетическая заметка: демонстрационная запись/;
const ACTOR = "emp_mock_admin"; // the production mock session actor («Demo Operator»)

const VIS = "Изменить доступ к заметке";
const SAVE = "Сохранить";
const CANCEL = "Отменить";
const SAVED = "Доступ к заметке обновлён";
const CONFLICT = "Доступ к заметке уже изменён. Показаны актуальные данные.";
const FIELD = "Доступ к заметке";
const PRIVATE_BADGE = "Приватная заметка";
const TEAM_BADGE = "Командная заметка";

async function resetOverlay(page: Page) {
  await page.addInitScript((key) => {
    try {
      if (window.sessionStorage.getItem("__ata_vis_overlay_cleared")) return;
      window.localStorage.removeItem(key);
      window.sessionStorage.setItem("__ata_vis_overlay_cleared", "1");
    } catch {
      /* storage unavailable — the app already treats that as an empty overlay */
    }
  }, OVERLAY_KEY);
}

async function seedOverlay(page: Page, overlay: unknown) {
  await page.addInitScript(
    ([key, json]) => {
      try {
        if (window.sessionStorage.getItem("__ata_vis_seeded")) return;
        window.localStorage.setItem(key, json);
        window.sessionStorage.setItem("__ata_vis_seeded", "1");
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

/** A single authored note in an overlay fixture, with a chosen author + visibility. */
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
// Exact match: getByLabel substring-matches, and the control button's aria-label
// «Изменить доступ к заметке» contains «Доступ к заметке».
const visSelect = (page: Page) => page.getByLabel(FIELD, { exact: true });
const badge = (page: Page, row: string, text: string) => rowWith(page, row).getByText(text, { exact: true });
const saveBtn = (page: Page) => notesSection(page).getByRole("button", { name: SAVE });
const cancelBtn = (page: Page) => notesSection(page).getByRole("button", { name: CANCEL });
const pendingBtn = (page: Page) => notesSection(page).getByRole("button", { name: "Сохраняем…" });

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

async function visAuditCount(page: Page) {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { auditRecords?: { action?: string }[] };
      return (parsed.auditRecords ?? []).filter((a) => a.action === "note_visibility_changed").length;
    } catch {
      return -1;
    }
  }, OVERLAY_KEY);
}

/* ------------------------------------------ create → private → reload */

test("author changes an own note team → private, reload keeps it, body preserved", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка, доступ к которой мы ограничим.");

  const row = rowWith(page, "ограничим");
  await expect(row.getByText(TEAM_BADGE, { exact: true })).toBeVisible();
  await shoot(page, "note-visibility-team-desktop-1440x900.png");

  await row.getByRole("button", { name: VIS }).click();
  await expect(visSelect(page)).toBeVisible();
  await shoot(page, "note-visibility-editing-desktop-1440x900.png");

  await visSelect(page).selectOption("private");
  await saveBtn(page).click();

  await expect(page.getByText(SAVED)).toBeVisible();
  await expect(badge(page, "ограничим", PRIVATE_BADGE)).toBeVisible();
  await expect(rowWith(page, "ограничим").getByText("Заметка, доступ к которой мы ограничим.")).toBeVisible();
  expect(await visAuditCount(page)).toBe(1);
  await shoot(page, "note-visibility-private-success-desktop-1440x900.png");

  // Reload: it really went through the overlay — the private badge and body persist.
  await page.reload();
  await expect(notesHeading(page)).toBeVisible();
  await expect(badge(page, "ограничим", PRIVATE_BADGE)).toBeVisible();
  await expect(rowWith(page, "ограничим").getByText("Заметка, доступ к которой мы ограничим.")).toBeVisible();

  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

/* ------------------------------------------ private → team round-trip */

test("author changes an own note private → team", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Seed an OWN private note (author = the session actor), so it is visible and changeable.
  await openNotes(page, {
    seed: overlayWithNote({ authorEmployeeId: ACTOR, visibility: "private", body: "Приватная авторская заметка." }),
  });

  const row = rowWith(page, "Приватная авторская");
  await expect(row.getByText(PRIVATE_BADGE, { exact: true })).toBeVisible();

  await row.getByRole("button", { name: VIS }).click();
  await visSelect(page).selectOption("team");
  await saveBtn(page).click();

  await expect(page.getByText(SAVED)).toBeVisible();
  await expect(badge(page, "Приватная авторская", TEAM_BADGE)).toBeVisible();
  await shoot(page, "note-visibility-team-success-desktop-1440x900.png");
});

/* ------------------------------------------ foreign visibility rule */

test("a foreign actor sees a team note but NOT a private one (identity, not role)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Two foreign-authored notes in one overlay: one team (visible), one private (hidden).
  await openNotes(page, {
    seed: {
      version: 1,
      sequence: 2,
      notes: [
        {
          id: "note_mock_0001",
          userId: USER,
          caseId: null,
          authorEmployeeId: "emp_foreign_1",
          body: "Командная заметка другого сотрудника — видна всем.",
          visibility: "team",
          pinned: false,
          createdAt: "2026-07-10T09:00:00.001Z",
          updatedAt: "2026-07-10T09:00:00.001Z",
          mock: true,
        },
        {
          id: "note_mock_0002",
          userId: USER,
          caseId: null,
          authorEmployeeId: "emp_foreign_1",
          body: "СЕКРЕТ_ПРИВАТНОЙ_ЗАМЕТКИ_другого_сотрудника",
          visibility: "private",
          pinned: false,
          createdAt: "2026-07-10T09:00:00.002Z",
          updatedAt: "2026-07-10T09:00:00.002Z",
          mock: true,
        },
      ],
      auditRecords: [],
      idempotencyReceipts: [],
    },
  });

  // The foreign TEAM note is visible; the foreign PRIVATE note is not — and its body
  // never reaches the DOM (a hidden note is removed, not masked).
  await expect(rowWith(page, "видна всем")).toBeVisible();
  await expect(page.getByText("СЕКРЕТ_ПРИВАТНОЙ_ЗАМЕТКИ")).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain("СЕКРЕТ_ПРИВАТНОЙ_ЗАМЕТКИ");
  // No visibility control on a foreign note either.
  await expect(rowWith(page, "видна всем").getByRole("button", { name: VIS })).toHaveCount(0);
});

/* ------------------------------------------ forbidden role, own private note */

test("a role without edit rights still sees its OWN private note but gets no control", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Own private note (author = session actor), viewed under read_only (SAME actorId).
  await openNotes(page, {
    role: "read_only",
    seed: overlayWithNote({ authorEmployeeId: ACTOR, visibility: "private", body: "Моя приватная заметка, только для меня." }),
  });

  // Same actorId ⇒ still the author ⇒ still sees it, with the private badge…
  await expect(rowWith(page, "только для меня")).toBeVisible();
  await expect(badge(page, "только для меня", PRIVATE_BADGE)).toBeVisible();
  // …but read_only has no edit right ⇒ no visibility control at all (absent, not disabled).
  await expect(notesSection(page).getByRole("button", { name: VIS })).toHaveCount(0);

  await shoot(page, "note-visibility-forbidden-desktop-1440x900.png");
  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* ------------------------------------------ global /audit integration */

test("global /audit shows the fact, never the direction or the body", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "СЕКРЕТ_ТЕЛА_для_проверки_аудита заметки.");

  // Turn it private through the real UI.
  await rowWith(page, "проверки_аудита").getByRole("button", { name: VIS }).click();
  await visSelect(page).selectOption("private");
  await saveBtn(page).click();
  await expect(page.getByText(SAVED)).toBeVisible();

  // Admin opens the global journal.
  await page.goto("/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Audit" })).toBeVisible();
  await expect(page.getByText("Demo Operator изменил доступ к заметке у")).toBeVisible();

  const html = await page.content();
  // Never the direction, never the body, never a raw id.
  expect(html).not.toContain("СЕКРЕТ_ТЕЛА");
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/приватн/i);
  expect(body).not.toMatch(/командн/i);
  expect(body).not.toMatch(/note_mock_/i);
  expect(body).not.toMatch(/emp_/i);

  await page.screenshot({ path: `${OUT}/audit-note-visibility-desktop-1440x900.png` });
});

/* ------------------------------------------ conflict */

test("a stale precondition conflicts: editor closes and the stored visibility shows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Совместно управляемая заметка.");

  await rowWith(page, "Совместно").getByRole("button", { name: VIS }).click();

  // Another writer touches the note (e.g. a body edit) — advancing `updatedAt` but
  // leaving the visibility `team`. The open editor's `expectedUpdatedAt` is now
  // stale, so my desired change (→ private) loses the race. Bumping updatedAt WITHOUT
  // moving visibility to my target avoids the no-op branch and forces a real conflict.
  await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)!;
    const o = JSON.parse(raw) as { notes: { id: string; visibility: string; updatedAt: string }[] };
    const n = o.notes.find((x) => x.id.startsWith("note_mock_"))!;
    n.updatedAt = new Date(Date.parse(n.updatedAt) + 60_000).toISOString();
    window.localStorage.setItem(key, JSON.stringify(o));
  }, OVERLAY_KEY);

  await visSelect(page).selectOption("private");
  await saveBtn(page).click();

  await expect(page.getByText(CONFLICT)).toBeVisible();
  await expect(visSelect(page)).toHaveCount(0);
  // The list re-read and shows the actually-stored (still team) state — my private
  // change did not take.
  await expect(badge(page, "Совместно", TEAM_BADGE)).toBeVisible();
  await shoot(page, "note-visibility-conflict-desktop-1440x900.png");
});

/* ------------------------------------------ storage failure + retry */

test("a storage failure keeps the editor and draft, shows the safe error, hides diagnostics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedOverlay(page, overlayWithNote({ authorEmployeeId: ACTOR, visibility: "team", body: "Заметка, доступ к которой не сохранится." }));
  await breakOverlayWrites(page);
  await page.goto(`/users/${USER}`);
  await expect(notesHeading(page)).toBeVisible();
  await expect(page.getByText("не сохранится")).toBeVisible();

  await rowWith(page, "не сохранится").getByRole("button", { name: VIS }).click();
  await visSelect(page).selectOption("private");
  await saveBtn(page).click();

  await expect(page.getByText("Локальное сохранение недоступно. Попробуйте ещё раз")).toBeVisible();
  // The editor stays open with the draft intact for a retry under the same key.
  await expect(visSelect(page)).toHaveValue("private");

  const html = await page.content();
  expect(html).not.toContain("Mock overlay could not be persisted");
  expect(html).not.toContain("QuotaExceededError");
  expect(html).not.toContain(OVERLAY_KEY);
  await shoot(page, "note-visibility-storage-error-desktop-1440x900.png");
});

/* ------------------------------------------ one editor per row */

test("opening the visibility editor hides the body-edit and pin controls of the row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка с единственным редактором за раз.");

  const row = rowWith(page, "единственным редактором");
  await row.getByRole("button", { name: VIS }).click();
  await expect(visSelect(page)).toBeVisible();
  // No second editor can be opened over this one — the other controls are gone.
  await expect(row.getByRole("button", { name: "Изменить заметку" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Закрепить заметку" })).toHaveCount(0);

  await cancelBtn(page).click();
  await expect(visSelect(page)).toHaveCount(0);
});

/* ------------------------------------------ double click / one record */

test("a double save creates exactly one visibility audit record", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotes(page);
  await addNote(page, "Заметка для проверки идемпотентности.");

  await rowWith(page, "идемпотентности").getByRole("button", { name: VIS }).click();
  await visSelect(page).selectOption("private");
  const save = saveBtn(page);
  await save.click();
  await save.click({ force: true, timeout: 1200 }).catch(() => {
    /* editor already closed — the guard did its job */
  });
  await expect(page.getByText(SAVED)).toBeVisible();
  expect(await visAuditCount(page)).toBe(1);
});

/* ------------------------------------------ responsive / zoom */

test("mobile 390x844 — the editor fits with 44px targets, no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNotes(page);
  await addNote(page, "Мобильная заметка для смены доступа.");

  const control = rowWith(page, "Мобильная").getByRole("button", { name: VIS });
  const box = await control.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await control.click();
  await expect(visSelect(page)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, "note-visibility-mobile-390x844.png");
});

test("mobile 320x720 — the narrowest supported width still fits the editor", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openNotes(page);
  await addNote(page, "Узкая заметка для смены доступа.");

  await rowWith(page, "Узкая").getByRole("button", { name: VIS }).click();
  await expect(visSelect(page)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, "note-visibility-mobile-320x720.png");
});

test("tablet 1024x768 — the editor stays inside the column", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openNotes(page);
  await addNote(page, "Планшетная заметка для смены доступа.");

  await rowWith(page, "Планшетная").getByRole("button", { name: VIS }).click();
  await expect(visSelect(page)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, "note-visibility-tablet-1024x768.png");
});

/**
 * 200% zoom modelled as a real reflow (720×450), NOT documentElement.style.zoom:
 * CSS zoom leaves media queries seeing the desktop width, so the layout never
 * reflows. At 720×450 the shell genuinely reflows to one column.
 */
test("200% zoom (720x450) reflows: no overflow, the editor is usable", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 720, height: 450 });
  await openNotes(page);
  await addNote(page, "Заметка для реального reflow при 200%.");

  const control = rowWith(page, "reflow").getByRole("button", { name: VIS });
  await control.scrollIntoViewIfNeeded();
  await control.click();
  await expect(visSelect(page)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await visSelect(page).selectOption("private");
  await saveBtn(page).click();
  await expect(page.getByText(SAVED)).toBeVisible();
  // Wait for the re-read to settle so the shot shows the private badge, not the
  // transient frame where the success line is up but the list has not refreshed yet.
  await expect(badge(page, "reflow", PRIVATE_BADGE)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await notesSection(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/note-visibility-zoom-200-720x450.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
