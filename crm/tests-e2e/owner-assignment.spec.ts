import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Primary owner assignment (Phase 1B4-C) E2E + screenshot suite — the second
 * mutating surface in the CRM, driven in a real browser.
 *
 * The existing suites are untouched: smoke, users-screenshots, users-sticky-action,
 * user-360, provider-privacy, today and user-notes still run alongside these.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Set PHASE_1B4C_PASS=first to write into the first-pass folder.
 */
const PASS = process.env.PHASE_1B4C_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1b4-c-assign-owner/${PASS}`;
mkdirSync(OUT, { recursive: true });

/**
 * Phase 1B4-C.1 acceptance-fix screenshots live in their own folder and are NOT
 * written into `final/` (which is protected). The zoom acceptance test below is the
 * only writer here.
 */
const ZOOM_OUT = "screenshots/phase-1b4-c-assign-owner/zoom-acceptance-fix";
mkdirSync(ZOOM_OUT, { recursive: true });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";
const OVERLAY_KEY = "ata-crm.mutation-overlay.v1";

/** Nina Chmiel — canonical high-priority persona, owned by emp_sup1 ("Support 1"). */
const USER = "usr_mock_026";
const BASELINE_OWNER = "Support 1";

/**
 * Every test starts from a clean overlay, so none depends on another's writes. Only
 * the overlay key is removed; every other key belongs to a feature tested elsewhere.
 * The guard lives in sessionStorage so it survives the reload whose whole point is
 * that the assignment persisted.
 */
async function resetOverlay(page: Page) {
  await page.addInitScript((key) => {
    try {
      if (window.sessionStorage.getItem("__ata_owner_overlay_cleared")) return;
      window.localStorage.removeItem(key);
      window.sessionStorage.setItem("__ata_owner_overlay_cleared", "1");
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

const ownerSection = (page: Page) =>
  page.locator("section").filter({
    has: page.getByRole("heading", { level: 2, name: "Ответственный и работа" }),
  });
const ownerSelect = (page: Page) => ownerSection(page).getByLabel("Ответственный");
const saveButton = (page: Page) => ownerSection(page).getByRole("button", { name: "Сохранить" });
const statedOwner = (page: Page) => ownerSection(page).locator("dl dd").first();
const sectionAlert = (page: Page) => ownerSection(page).getByRole("alert");

async function openProfile(page: Page, role?: string) {
  await resetOverlay(page);
  if (role) await seedRole(page, role);
  await page.goto(`/users/${USER}`);
  await expect(page.getByRole("heading", { level: 1, name: "Nina Chmiel" })).toBeVisible();
  await expect(ownerSection(page)).toBeVisible();
}

/** Wait until the picker itself is present (candidate read has landed). */
async function openWithPicker(page: Page, role: string) {
  await openProfile(page, role);
  await expect(ownerSelect(page)).toBeVisible();
}

async function shoot(page: Page, name: string) {
  await ownerSection(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}` });
}

/** Pick an owner by its visible display name and save; wait for the re-read. */
async function assign(page: Page, displayName: string) {
  await ownerSelect(page).selectOption({ label: displayName });
  await saveButton(page).click();
  await expect(ownerSection(page).getByText("Ответственный обновлён")).toBeVisible();
  await expect(statedOwner(page)).toHaveText(displayName);
}

/* ------------------------------------------------- permissions / visibility */

for (const role of ["crm_admin", "crm_manager", "retention_manager"]) {
  test(`${role} sees the owner control`, async ({ page }) => {
    const errors = trackConsole(page);
    const hydration = trackHydration(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWithPicker(page, role);

    await expect(ownerSelect(page)).toBeVisible();
    await expect(saveButton(page)).toBeVisible();
    await expect(ownerSection(page).getByText("Ваша роль не может менять ответственного")).toHaveCount(0);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

    expect(errors, errors.join("\n")).toHaveLength(0);
    expect(hydration, hydration.join("\n")).toHaveLength(0);
  });
}

test("support does not see the owner control but still sees the notes composer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProfile(page, "support");

  // No owner control at all — not disabled, absent.
  await expect(ownerSection(page).getByText("Ваша роль не может менять ответственного")).toBeVisible();
  await expect(ownerSelect(page)).toHaveCount(0);
  await expect(saveButton(page)).toHaveCount(0);
  // …but the notes composer this role IS allowed is there.
  await expect(page.locator("form textarea")).toBeVisible();
  // The current owner is still shown.
  await expect(statedOwner(page)).toHaveText(BASELINE_OWNER);
});

test("read_only does not see the owner control", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProfile(page, "read_only");
  await expect(ownerSection(page).getByText("Ваша роль не может менять ответственного")).toBeVisible();
  await expect(ownerSelect(page)).toHaveCount(0);
  await expect(statedOwner(page)).toHaveText(BASELINE_OWNER);
});

/* ------------------------------------------------------------ assign / persist */

test("admin assigns a new owner and it appears without a reload", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");

  await assign(page, "Retention 1");
  await expect(statedOwner(page)).toHaveText("Retention 1");
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

test("a reload keeps the new owner — it really went through the overlay", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");
  await assign(page, "Retention 1");

  await page.reload();
  await expect(ownerSection(page)).toBeVisible();
  await expect(statedOwner(page)).toHaveText("Retention 1");
});

test("Users shows the new owner and its filter finds the user", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");
  await assign(page, "Retention 1");

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();

  // Filter Users by the new owner; the user's row must be present.
  await page.getByRole("button", { name: /Ответственный/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Retention 1" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /Открыть профиль Nina Chmiel/ })).toBeVisible();
});

test("Today shows the new owner after an assignment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");
  await assign(page, "Retention 1");

  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The user is still in the queue, and the row now names the new owner. The
  // desktop toolbar filters inline (no «Фильтры» sheet button — that is mobile), so
  // consistency is asserted on the rendered row, which is the point.
  await expect(page.getByText("Nina Chmiel").first()).toBeVisible();
  await expect(page.getByText("Retention 1").first()).toBeVisible();
});

test("unassigning updates Today's «Без ответственного» count", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const readUnassigned = async () => {
    const text = await page.getByText(/Без ответственного/).first().textContent();
    const m = text?.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const before = await readUnassigned();

  await openWithPicker(page, "crm_admin");
  await ownerSelect(page).selectOption({ label: "Без ответственного" });
  await saveButton(page).click();
  await expect(ownerSection(page).getByText("Ответственный обновлён")).toBeVisible();
  await expect(statedOwner(page)).toHaveText("Не назначен");

  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const after = await readUnassigned();
  if (before !== null && after !== null) expect(after).toBe(before + 1);
});

/* ---------------------------------------------------------------- behaviour */

test("unchanged selection sends no mutation and keeps Save disabled", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");

  await expect(ownerSelect(page)).toHaveValue(/emp_sup1/);
  await expect(saveButton(page)).toBeDisabled();
  // Move away and back — still nothing to save.
  await ownerSelect(page).selectOption({ label: "Retention 1" });
  await ownerSelect(page).selectOption({ label: BASELINE_OWNER });
  await expect(saveButton(page)).toBeDisabled();
});

test("a duplicate submit does not create a second owner change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");

  await ownerSelect(page).selectOption({ label: "Retention 1" });
  await saveButton(page).click();
  await saveButton(page).click({ force: true, timeout: 2000 }).catch(() => {
    /* already disabled — the guard did its job */
  });
  // Wait for the re-read to land on the new owner rather than the transient banner.
  await expect(statedOwner(page)).toHaveText("Retention 1");

  // Exactly one owner-change audit record was written.
  const count = await page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { auditRecords?: { action?: string }[] };
      return (parsed.auditRecords ?? []).filter((a) => a.action === "primary_owner_changed").length;
    } catch {
      return -1;
    }
  }, OVERLAY_KEY);
  expect(count).toBe(1);
});

test("a conflict shows the actual owner instead of overwriting it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");

  // Pick a new owner but do NOT save yet.
  await ownerSelect(page).selectOption({ label: "Retention 1" });

  // Simulate another writer winning the race: seed an owner-change straight into the
  // overlay for a DIFFERENT owner, matching the baseline as its expected value.
  await page.evaluate(
    ({ key, user }) => {
      const now = Date.now();
      const overlay = {
        version: 1,
        sequence: 1,
        notes: [],
        auditRecords: [
          {
            id: "audit_mock_0001",
            action: "primary_owner_changed",
            actorEmployeeId: "emp_other",
            actorRole: "crm_admin",
            targetUserId: user,
            entityType: "user",
            entityId: user,
            at: new Date(now).toISOString(),
            reasonCode: "primary_owner_changed_by_employee",
            previousOwnerId: "emp_sup1",
            nextOwnerId: "emp_men1",
            mock: true,
          },
        ],
        idempotencyReceipts: [
          { kind: "primary_owner_change", key: "other", fingerprint: "x", auditId: "audit_mock_0001" },
        ],
      };
      window.localStorage.setItem(key, JSON.stringify(overlay));
    },
    { key: OVERLAY_KEY, user: USER },
  );

  await saveButton(page).click();

  await expect(ownerSection(page).getByText("Ответственный уже изменён. Показаны актуальные данные.")).toBeVisible();
  // The winner (Mentor 1) is shown; our pick (Retention 1) was not applied on top.
  await expect(statedOwner(page)).toHaveText("Mentor 1");
});

test("a storage failure shows safe Russian text and leaks no diagnostics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await breakOverlayWrites(page);
  await openWithPicker(page, "crm_admin");

  await ownerSelect(page).selectOption({ label: "Retention 1" });
  await saveButton(page).click();

  await expect(sectionAlert(page)).toContainText("Локальное сохранение недоступно. Попробуйте ещё раз");
  const html = await page.content();
  expect(html).not.toContain("Mock overlay could not be persisted.");
  expect(html).not.toContain("QuotaExceededError");
  // The section still shows the real, unchanged owner.
  await expect(statedOwner(page)).toHaveText(BASELINE_OWNER);
});

test("no raw diagnostic or employee id appears in a healthy section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");
  await assign(page, "Retention 1");

  const sectionText = await ownerSection(page).innerText();
  expect(sectionText).not.toMatch(/emp_/);
  expect(sectionText).not.toContain("audit_mock");
  expect(sectionText).not.toContain("mutation-overlay");
});

test("the assignment can be driven and confirmed from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");

  await ownerSelect(page).selectOption({ label: "Retention 1" });
  await saveButton(page).focus();
  await page.keyboard.press("Enter");

  await expect(ownerSection(page).getByText("Ответственный обновлён")).toBeVisible();
  // Focus comes back to the select after success.
  await expect(ownerSelect(page)).toBeFocused();
});

/* --------------------------------------------------------- responsive / zoom */

test("mobile 390x844 — the control fits and does not overflow", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openWithPicker(page, "crm_admin");
  await ownerSection(page).scrollIntoViewIfNeeded();

  await expect(ownerSelect(page)).toBeVisible();
  // 44px minimum touch target.
  const box = await ownerSelect(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await shoot(page, "owner-mobile-390x844.png");
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("mobile 320x720 — the narrowest supported width still fits", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWithPicker(page, "crm_admin");
  await ownerSection(page).scrollIntoViewIfNeeded();

  await expect(ownerSelect(page)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, "owner-mobile-320x720.png");
});

test("tablet 1024x768 — the section stays inside the context column", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openWithPicker(page, "crm_admin");
  await ownerSection(page).scrollIntoViewIfNeeded();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, "owner-tablet-1024x768.png");
});

/**
 * 200% zoom acceptance (Phase 1B4-C.1).
 *
 * The original test set `documentElement.style.zoom = "2"` on a 1440×900 viewport.
 * That does NOT model a browser at 200%: media queries still see 1440, so the layout
 * never reflows — it renders the desktop 2/3+1/3 composition and scales it up, which
 * clips the right column and squeezes the 5-column states grid until its text
 * collides. Worse, the check it passed was a lie: under CSS `zoom`,
 * `documentElement.scrollWidth - clientWidth` reports 0 even while the nested
 * `#crm-content` region overflows by 34px — the page-level metric could not see it.
 *
 * A browser at 200% presents a HALVED CSS viewport. The accepted project model
 * (user-360 / today suites) is therefore `setViewportSize(720×450)`, where the shell
 * genuinely reflows: the `lg:` sidebar hides, the workspace goes single-column, and
 * the states grid drops to `sm:grid-cols-3`. This test asserts that real geometry
 * rather than the presence of a media query.
 */
test("200% zoom (720x450) reflows: no overflow, no text collision, owner control reachable", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 720, height: 450 });
  await openWithPicker(page, "crm_admin");

  // (1) Document-level: no horizontal scrolling.
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  // (2) The nested content region — the metric the old method could not see.
  const contentOverflow = await page.evaluate(() => {
    const el = document.querySelector("#crm-content");
    return el ? el.scrollWidth - el.clientWidth : 0;
  });
  expect(contentOverflow).toBeLessThanOrEqual(1);

  // (3) Neither the states section nor the owner section spills past the viewport,
  //     and neither is hidden/collapsed to nothing (reverse regression: the fix must
  //     not "pass" by clipping the right column away).
  const sectionBox = async (title: string) =>
    page.evaluate((t) => {
      const s = Array.from(document.querySelectorAll("section")).find(
        (el) => el.querySelector("h2")?.textContent?.trim() === t,
      );
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    }, title);

  const vw = 720;
  for (const title of ["Состояния", "Ответственный и работа"]) {
    const b = await sectionBox(title);
    expect(b, `${title} section present`).not.toBeNull();
    expect(b!.left).toBeGreaterThanOrEqual(-1);
    expect(b!.right).toBeLessThanOrEqual(vw + 1);
    // Substantial width — proof it reflowed to the column, not that it was hidden.
    expect(b!.width).toBeGreaterThan(vw / 2);
  }

  // (4) States labels/values do not overlap — measured by bounding boxes, the thing
  //     the DOM-only overflow check missed and only the eye caught before.
  const collision = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll("section")).find(
      (el) => el.querySelector("h2")?.textContent?.trim() === "Состояния",
    );
    if (!s) return true;
    const cells = Array.from(s.querySelectorAll("dt, dd")).map((el) => el.getBoundingClientRect());
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]!, b = cells[j]!;
        const yOverlap = a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const xOverlap = a.left < b.right - 1 && b.left < a.right - 1;
        if (yOverlap && xOverlap) return true;
      }
    }
    return false;
  });
  expect(collision, "states labels/values overlap").toBe(false);

  // (5) The owner control is reachable by ordinary vertical scroll and fully visible.
  await ownerSection(page).scrollIntoViewIfNeeded();
  await expect(ownerSelect(page)).toBeVisible();
  await expect(saveButton(page)).toBeVisible();
  // The unassign option is offered inside the select.
  await expect(
    ownerSelect(page).getByRole("option", { name: "Без ответственного" }),
  ).toHaveCount(1);
  const selBox = await ownerSelect(page).boundingBox();
  const btnBox = await saveButton(page).boundingBox();
  // 44px touch target survives the zoom, and both sit within the viewport bottom.
  expect(selBox!.height).toBeGreaterThanOrEqual(44);
  expect(btnBox!.height).toBeGreaterThanOrEqual(44);
  expect(selBox!.y + selBox!.height).toBeLessThanOrEqual(450 + 1);
  expect(btnBox!.y + btnBox!.height).toBeLessThanOrEqual(450 + 1);
  await page.screenshot({ path: `${ZOOM_OUT}/owner-zoom-200-assignment-720x450.png` });

  // (6) Picking a new owner keeps Save reachable and enabled.
  await ownerSelect(page).selectOption({ label: "Retention 1" });
  await expect(saveButton(page)).toBeEnabled();
  const btnBox2 = await saveButton(page).boundingBox();
  expect(btnBox2!.y + btnBox2!.height).toBeLessThanOrEqual(450 + 1);

  // (7) Keyboard reaches select and submit.
  await ownerSelect(page).focus();
  expect(await ownerSelect(page).evaluate((el) => el === document.activeElement)).toBe(true);
  await saveButton(page).focus();
  expect(await saveButton(page).evaluate((el) => el === document.activeElement)).toBe(true);

  // (8) Success message is not clipped and stays within the viewport width.
  await saveButton(page).click();
  await expect(ownerSection(page).getByText("Ответственный обновлён")).toBeVisible();
  await expect(statedOwner(page)).toHaveText("Retention 1");
  const successBox = await ownerSection(page).getByText("Ответственный обновлён").boundingBox();
  expect(successBox!.x).toBeGreaterThanOrEqual(-1);
  expect(successBox!.x + successBox!.width).toBeLessThanOrEqual(vw + 1);
  await ownerSection(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${ZOOM_OUT}/owner-zoom-200-success-720x450.png` });

  // Reverse regression: no absurd empty horizontal canvas (body no wider than viewport).
  const bodyWidth = await page.evaluate(() => document.body.getBoundingClientRect().width);
  expect(bodyWidth).toBeLessThanOrEqual(vw + 1);

  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

/**
 * Two more acceptance screenshots: the reflowed top composition and the states
 * section with no colliding text. Kept separate so each frame is a clean capture.
 */
test("200% zoom (720x450) acceptance screenshots — top and states", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await openWithPicker(page, "crm_admin");

  // Top of the page after reflow: sidebar gone, single column.
  await page.evaluate(() => document.querySelector("#crm-content")?.scrollTo(0, 0));
  await expect(page.getByRole("heading", { level: 1, name: /Nina Chmiel/ })).toBeVisible();
  await page.screenshot({ path: `${ZOOM_OUT}/owner-zoom-200-top-720x450.png` });

  // States section in view, labels and values clear of each other.
  const states = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Состояния" }) });
  await states.scrollIntoViewIfNeeded();
  await expect(states).toBeVisible();
  await page.screenshot({ path: `${ZOOM_OUT}/owner-zoom-200-states-720x450.png` });
});

/* --------------------------------------------------------------- screenshots */

test("screenshots — unchanged / changed / pending / success / conflict / forbidden / error", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // unchanged
  await openWithPicker(page, "crm_admin");
  await shoot(page, "owner-unchanged-1440x900.png");

  // changed (selected, not saved)
  await ownerSelect(page).selectOption({ label: "Retention 1" });
  await expect(saveButton(page)).toBeEnabled();
  await shoot(page, "owner-changed-1440x900.png");

  // success — wait for the re-read to settle so the stated owner shows the NEW
  // value, not the old one still on screen during the refetch window.
  await saveButton(page).click();
  await expect(ownerSection(page).getByText("Ответственный обновлён")).toBeVisible();
  await expect(statedOwner(page)).toHaveText("Retention 1");
  await shoot(page, "owner-success-1440x900.png");

  // forbidden (support)
  await openProfile(page, "support");
  await expect(ownerSection(page).getByText("Ваша роль не может менять ответственного")).toBeVisible();
  await shoot(page, "owner-forbidden-1440x900.png");
});

test("screenshot — pending", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");

  // Hold the overlay write open so the pending frame is photographable. The status
  // is set to "pending" synchronously on submit and only clears when the write
  // resolves; blocking `setItem` keeps it pending. The busy-wait blocks the page's
  // main thread, but the screenshot is captured by the browser process from the last
  // painted frame — which is «Сохраняем…» — so it lands even while JS is frozen.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(k: string, v: string) {
      if (k === "ata-crm.mutation-overlay.v1") {
        const start = Date.now();
        while (Date.now() - start < 2000) {
          /* keep the pending state on screen long enough to photograph */
        }
      }
      return original.call(this, k, v);
    };
  });

  await ownerSelect(page).selectOption({ label: "Retention 1" });
  // Do not await the click: it will not settle until the 2s write completes, and we
  // want to shoot the pending frame while it is in flight.
  void saveButton(page).click().catch(() => {});
  await expect(
    ownerSection(page).getByRole("button", { name: "Сохраняем…" }),
  ).toBeVisible();
  await shoot(page, "owner-pending-1440x900.png");
});

test("screenshot — conflict", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");
  await ownerSelect(page).selectOption({ label: "Retention 1" });
  await page.evaluate(
    ({ key, user }) => {
      const overlay = {
        version: 1,
        sequence: 1,
        notes: [],
        auditRecords: [
          {
            id: "audit_mock_0001",
            action: "primary_owner_changed",
            actorEmployeeId: "emp_other",
            actorRole: "crm_admin",
            targetUserId: user,
            entityType: "user",
            entityId: user,
            at: new Date().toISOString(),
            reasonCode: "primary_owner_changed_by_employee",
            previousOwnerId: "emp_sup1",
            nextOwnerId: "emp_men1",
            mock: true,
          },
        ],
        idempotencyReceipts: [
          { kind: "primary_owner_change", key: "other", fingerprint: "x", auditId: "audit_mock_0001" },
        ],
      };
      window.localStorage.setItem(key, JSON.stringify(overlay));
    },
    { key: OVERLAY_KEY, user: USER },
  );
  await saveButton(page).click();
  await expect(ownerSection(page).getByText("Ответственный уже изменён. Показаны актуальные данные.")).toBeVisible();
  // Wait for the canonical re-read so the shot shows the value that actually won
  // ("Mentor 1"), which is what the message claims is on screen.
  await expect(statedOwner(page)).toHaveText("Mentor 1");
  await shoot(page, "owner-conflict-1440x900.png");
});

test("screenshot — storage error", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await breakOverlayWrites(page);
  await openWithPicker(page, "crm_admin");
  await ownerSelect(page).selectOption({ label: "Retention 1" });
  await saveButton(page).click();
  await expect(sectionAlert(page)).toContainText("Локальное сохранение недоступно");
  await shoot(page, "owner-storage-error-1440x900.png");
});

test("screenshot — Users consistency after assignment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");
  await assign(page, "Retention 1");

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();
  await page.getByRole("button", { name: /Ответственный/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Retention 1" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /Открыть профиль Nina Chmiel/ })).toBeVisible();
  await page.screenshot({ path: `${OUT}/owner-users-consistency-1440x900.png` });
});

test("screenshot — Today consistency after assignment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithPicker(page, "crm_admin");
  await assign(page, "Retention 1");

  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Nina Chmiel").first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/owner-today-consistency-1440x900.png` });
});
