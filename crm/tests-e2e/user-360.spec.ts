import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { stripFlightRowRefs } from "./rsc-flight";

/**
 * User 360 (Phase 1C) E2E + screenshot suite. Real-browser render of the
 * read-only `/users/[id]` workspace. Each scenario keeps its own console /
 * viewport / permission assertions.
 *
 * The existing suites are untouched: smoke.spec.ts (5), users-screenshots.spec.ts
 * (5) and users-sticky-action.spec.ts (3) still run alongside these.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Set PHASE_1C_PASS=first to write into the first-pass folder.
 */
const PASS = process.env.PHASE_1C_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1c-user-360/${PASS}`;
mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: "serial" });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";

/** Canonical fixture users — real personas already visible in Users workspace. */
const HIGH_PRIORITY = "usr_mock_026"; // Nina Chmiel — support blocked, SLA breached
const CALM = "usr_mock_005"; // Lena Mazur — active funded learner, no signals
const ONBOARDING = "usr_mock_001"; // Nadia Novak — registered, Pocket incomplete
const UNKNOWN = "usr_mock_does_not_exist";

/** The full synthetic email of the high-priority user (permission probe). */
const FULL_EMAIL = "nina.chmiel@example.test";

async function seedRole(page: Page, roleCode: string) {
  await page.addInitScript(
    ([key, role]) => window.localStorage.setItem(key, role),
    [ROLE_STORAGE_KEY, roleCode] as const,
  );
}

function trackConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** Hydration problems surface as warnings, not errors — track them separately. */
function trackHydration(page: Page) {
  const warnings: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/hydrat|did not match|Extra attributes/i.test(t)) warnings.push(t);
  });
  return warnings;
}

async function waitFor360(page: Page, name: RegExp) {
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function pageOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("admin desktop 1440x900 — full operational profile", async ({ page }) => {
  const errors = trackConsole(page);
  const hydration = trackHydration(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/${HIGH_PRIORITY}`);
  await waitFor360(page, /Nina Chmiel/);

  // Exactly one h1.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  // Why the user is open, and what to do — both above the fold.
  await expect(page.getByText("Критический support-блокер")).toBeVisible();
  await expect(page.getByText("Follow-up поддержки")).toBeVisible();
  // The five state axes are rendered independently.
  await expect(page.getByText("Фондирован")).toBeVisible();
  await expect(page.getByText("В зоне риска")).toBeVisible();
  // Admin may see the exact amount.
  await expect(page.getByText("$90").first()).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: `${OUT}/user-360-admin-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(hydration, hydration.join("\n")).toHaveLength(0);
});

test("support desktop 1440x900 — permission-safe, no exact amount anywhere", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "support");
  await page.goto(`/users/${HIGH_PRIORITY}`);
  await waitFor360(page, /Nina Chmiel/);

  // Bucket representation is shown…
  await expect(page.getByText("$50–99").first()).toBeVisible();

  const html = stripFlightRowRefs(await page.content());
  // …and the exact amount is absent from the whole serialized document —
  // including props, title/aria attributes and Next's serialized payload.
  expect(html).not.toContain("$90");
  expect(html).not.toContain(FULL_EMAIL);
  // Identity is masked, not hidden.
  expect(html).toContain("***");
  // The checkpoint grid amount is withheld: grid + delta% would reveal $90.
  expect(html).not.toContain("$100");
  expect(html).not.toContain("осталось 10%");

  await page.screenshot({ path: `${OUT}/user-360-support-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("high-priority user 1440x900 — attention is unmistakable", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/${HIGH_PRIORITY}`);
  await waitFor360(page, /Nina Chmiel/);

  // Priority is text, never colour alone.
  await expect(page.getByText("Критический").first()).toBeVisible();
  // The signal that drove the priority is linked, not repeated as a bare badge.
  await expect(page.getByText("Основание приоритета")).toBeVisible();
  // A breached SLA is visible in the operational context.
  await expect(page.getByText("Нарушен")).toBeVisible();

  await page.screenshot({ path: `${OUT}/user-360-high-priority-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("calm user 1440x900 — screen does not invent urgency", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/${CALM}`);
  await waitFor360(page, /Lena Mazur/);

  await expect(page.getByText("Активных причин для внимания нет")).toBeVisible();
  await expect(page.getByText("Действие не требуется")).toBeVisible();
  await expect(page.getByText("Активных блокеров нет.")).toBeVisible();
  await expect(page.getByText("Активных сигналов нет.")).toBeVisible();

  await page.screenshot({ path: `${OUT}/user-360-calm-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("onboarding user — Pocket registration axis is honest", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/${ONBOARDING}`);
  await waitFor360(page, /Nadia Novak/);

  // Pocket registration and funding are independent axes (D-23/D-27).
  await expect(page.getByText("Не зарегистрирован")).toBeVisible();
  await expect(page.getByText("Недоступно").first()).toBeVisible();
  // No balance exists → says so honestly; not a fake zero, and NOT a false
  // "no permission" message (this role may see exact financials).
  await expect(page.getByText("Нет данных").first()).toBeVisible();
  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain("Недоступно для роли");

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("tablet 1024x768 — deliberate compact hierarchy", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`/users/${HIGH_PRIORITY}`);
  await waitFor360(page, /Nina Chmiel/);

  // Critical attention stays at the top on tablet.
  await expect(page.getByText("Критический support-блокер")).toBeInViewport();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: `${OUT}/user-360-tablet-1024x768.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("mobile 390x844 — operational order, no horizontal overflow", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/users/${HIGH_PRIORITY}`);
  await waitFor360(page, /Nina Chmiel/);

  // Required mobile order: back+user → priority/reason → recommendation →
  // states → blockers/signals → learning → activity → owner/context.
  const order = await page.evaluate(() => {
    const y = (t: string) => {
      const el = [...document.querySelectorAll("h1,h2")].find((n) =>
        (n.textContent ?? "").trim().toLowerCase().startsWith(t.toLowerCase()),
      );
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1;
    };
    return {
      attention: y("Почему требует внимания"),
      states: y("Состояния"),
      blockers: y("Активные блокеры"),
      signals: y("Системные сигналы"),
      learning: y("Обучение"),
      activity: y("Недавние события"),
      financial: y("Финансы"),
      owner: y("Ответственный и работа"),
    };
  });
  expect(order.attention).toBeGreaterThan(0);
  expect(order.states).toBeGreaterThan(order.attention);
  expect(order.blockers).toBeGreaterThan(order.states);
  expect(order.signals).toBeGreaterThan(order.blockers);
  expect(order.learning).toBeGreaterThan(order.signals);
  expect(order.activity).toBeGreaterThan(order.learning);
  expect(order.owner).toBeGreaterThan(order.activity);

  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  // The last block is fully reachable.
  await page.getByRole("heading", { name: "Ответственный и работа" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "Ответственный и работа" })).toBeInViewport();

  // Capture the operational top of the screen, not wherever the scroll ended up.
  await page.evaluate(() => document.querySelector("#crm-content")?.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/user-360-mobile-390x844.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("200% zoom — content reflows, no 2D scrolling", async ({ page }) => {
  const errors = trackConsole(page);
  // Browser zoom shrinks the CSS viewport: 200% on a 1440x900 screen gives a
  // 720x450 CSS viewport. (Setting `body.zoom` would NOT do this — media queries
  // would still see 1440, the layout could not reflow, and the test would pass
  // while real users got a clipped, horizontally-scrolling page.)
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(`/users/${HIGH_PRIORITY}`);
  await waitFor360(page, /Nina Chmiel/);

  await expect(page.getByText("Критический support-блокер")).toBeVisible();
  // Reflow: no horizontal scrolling of the page or of the content region.
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  const mainOverflow = await page.evaluate(() => {
    const m = document.querySelector("#crm-content");
    return m ? m.scrollWidth - m.clientWidth : 0;
  });
  expect(mainOverflow).toBeLessThanOrEqual(1);

  await page.screenshot({ path: `${OUT}/user-360-zoom-200.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("unknown user id — real not-found, no fabricated profile", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/${UNKNOWN}`);

  // The state is the whole page, so it carries the page's single h1.
  await expect(page.getByRole("heading", { level: 1, name: "Пользователь не найден" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  // A way back, and no invented data.
  await expect(page.getByRole("link", { name: "Пользователи" }).last()).toBeVisible();
  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain("Баланс");

  await page.screenshot({ path: `${OUT}/user-360-not-found-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("navigation: /users → profile → back", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();

  // Open the first profile from the register via the row action.
  await page.getByRole("link", { name: /Открыть профиль/ }).first().click();
  await expect(page).toHaveURL(/\/users\/usr_mock_/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // The back link returns to the register.
  await page.getByRole("link", { name: "Пользователи" }).last().click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("table")).toBeVisible();

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("keyboard: back link is focusable with a visible focus ring", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/${CALM}`);
  await waitFor360(page, /Lena Mazur/);

  const back = page.getByRole("link", { name: "Пользователи" }).last();
  await back.focus();
  await expect(back).toBeFocused();
  const ring = await back.evaluate((el) => getComputedStyle(el).getPropertyValue("--tw-ring-color"));
  expect(ring.length).toBeGreaterThan(0);

  await back.press("Enter");
  await expect(page).toHaveURL(/\/users$/);
});

test("analyst — pseudonymous identity, no name and no exact amount", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "analyst");
  await page.goto(`/users/${HIGH_PRIORITY}`);

  // Analyst gets an opaque id instead of the display name.
  await expect(page.getByRole("heading", { level: 1, name: /anon_/ })).toBeVisible();
  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain("Nina Chmiel");
  expect(html).not.toContain(FULL_EMAIL);
  expect(html).not.toContain("$90");

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("read_only — financials hidden, profile still readable", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "read_only");
  await page.goto(`/users/${HIGH_PRIORITY}`);
  await waitFor360(page, /Nina Chmiel/);

  await expect(page.getByText("Недоступно для роли").first()).toBeVisible();
  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain("$90");
  expect(html).not.toContain("$50–99");

  expect(errors, errors.join("\n")).toHaveLength(0);
});
