import { test, expect, type Page } from "@playwright/test";

/**
 * D2C-B — the lessons library (/lessons) behavioral suite.
 *
 * Named *-smoke.spec.ts so the standard `npm run test:e2e` gate picks it up
 * automatically (DD-257). It writes nothing to disk — screenshots live in
 * lessons-library-screenshots.spec.ts, which the gate deliberately excludes.
 *
 * Progression here is driven the REAL way: actually watching to the real 50%
 * gate (the media clock is fast-forwarded, so the production tick path runs) and
 * actually answering, then reading the library. No scenario query, no seeded
 * model, no stubbed storage.
 */

const LIB = "/lessons";
const L18 = "/lessons/level.018";
const L19 = "/lessons/level.019";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
/** 200% zoom halves the CSS layout viewport of a 1440x900 window (real reflow). */
const ZOOM_200 = { width: 720, height: 450 };

/** The correct option of each question of level 18, in fixture order. */
const CORRECT = [
  "Область графика, где цена ранее неоднократно встречала спрос и переставала снижаться.",
  "Реакции происходят в диапазоне цен, а точные касания одного и того же значения встречаются редко.",
  "О том, что область заметна многим участникам, поэтому вывод опирается не на один случай.",
  "Это наблюдение, которому нужно подтверждение реакцией цены; сам подход к области ничего не решает.",
];

/** §14/§15 — console errors and hydration warnings are collected on every page. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (msg.type() === "error") errors.push(t);
    if (/hydrat/i.test(t)) errors.push(`HYDRATION: ${t}`);
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

/** Finish level 18 for real, leaving this browser session marked. */
async function completeLevel18(page: Page) {
  await page.clock.install();
  await page.goto(L18, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Смотреть" }).click();
  await page.clock.runFor(245_000);
  await page.getByRole("button", { name: "Пауза" }).click();
  await expect
    .poll(async () => Number(await page.getByRole("progressbar").getAttribute("aria-valuenow")))
    .toBeGreaterThanOrEqual(50);

  await page.getByRole("button", { name: /Начать проверку/ }).click();
  for (let i = 0; i < CORRECT.length; i += 1) {
    await page.getByRole("radio", { name: CORRECT[i]! }).check();
    await page.getByRole("button", { name: "Ответить" }).click();
    if (i < CORRECT.length - 1) {
      await page.getByRole("button", { name: /Следующий вопрос/ }).click();
    }
  }
  await expect(page.getByRole("heading", { name: /Урок завершён/ })).toBeVisible();
}

/* ------------------------------------------------------------------ *
 * 1. Desktop default library
 * ------------------------------------------------------------------ */

test("desktop: /lessons is the library, not a redirect to the lesson", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(LIB, { waitUntil: "networkidle" });

  // it stayed on /lessons — the D2B redirect is gone
  expect(page.url()).toContain(LIB);
  expect(page.url()).not.toContain("level.018");

  await expect(page.locator("h1")).toHaveText("Уроки");
  await expect(page.locator("h1")).toHaveCount(1);

  // the contents index: all 20 modules
  await expect(page.locator(".lib-toc .lib-ir")).toHaveCount(20);
  await expect(page.locator(".lib-toc").getByText("Первое знакомство")).toBeVisible();
  await expect(page.locator(".lib-toc").getByText("Самостоятельная система")).toBeVisible();

  // module 04 selected by default, from the shared marker
  await expect(page.locator(".lib-ir.is-selected .lib-ir-t")).toHaveText("Чтение графика");
  await expect(page.locator(".lib-open-h")).toHaveText("Чтение графика");

  // its five levels
  await expect(page.locator(".lib-row")).toHaveCount(5);
  await expect(page.locator(".lib-row.is-current .lib-row-t")).toHaveText("Поддержка и сопротивление");

  // the one dominant action
  const cta = page.locator(".lib-cont").getByRole("link", { name: /Продолжить урок/ });
  await expect(cta).toHaveAttribute("href", L18);

  // the checkpoint states its target and what it opens — and is not clickable
  const cp = page.locator(".lib-row.is-checkpoint");
  await expect(cp).toContainText("Баланс Pocket от $200");
  await expect(cp).toContainText("Chart Markup Tool");
  await expect(cp).toContainText("ранг Наблюдатель IV");
  await expect(cp).toContainText("канал Разбор графиков");
  await expect(cp.locator("a")).toHaveCount(0);

  // Financial privacy: nothing beyond the target. innerText, not textContent —
  // textContent also returns the contents of <script> tags (the RSC payload),
  // which is not what the user reads and would make this assert the wrong thing.
  const visible = await page.locator("body").innerText();
  expect(visible).not.toMatch(/осталось|остаток|ваш баланс|депозит|вывод|XP/i);
  for (const href of await page.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
    expect(href).not.toMatch(/pocket/i);
  }

  // navigation: Уроки is a real, current link with no «Скоро»
  const nav = page.locator(".appbar .rnav");
  await expect(nav.getByRole("link", { name: "Уроки" })).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('[aria-disabled="true"]', { hasText: "Уроки" })).toHaveCount(0);

  // no horizontal overflow
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * 2/3. Module selection, URL state, Back/Forward
 * ------------------------------------------------------------------ */

test("desktop: selecting a module is shareable URL state, and Back/Forward work", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(LIB, { waitUntil: "networkidle" });

  await page.locator(".lib-toc").getByRole("link", { name: /Первая стратегия/ }).click();
  await page.waitForURL(/module=module\.09/);
  await expect(page.locator(".lib-open-h")).toHaveText("Первая стратегия");
  await expect(page.locator(".lib-ir.is-selected .lib-ir-t")).toHaveText("Первая стратегия");
  // selecting a module never moves progression
  await expect(page.locator(".lib-cont").getByRole("link", { name: /Продолжить урок/ })).toHaveAttribute(
    "href",
    L18,
  );

  // a shared link opens the same module
  await page.goto(`${LIB}?module=module.09`, { waitUntil: "networkidle" });
  await expect(page.locator(".lib-open-h")).toHaveText("Первая стратегия");

  // reload keeps it
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".lib-open-h")).toHaveText("Первая стратегия");

  // Back / Forward
  await page.goto(LIB, { waitUntil: "networkidle" });
  await page.locator(".lib-toc").getByRole("link", { name: /Индикаторы/ }).click();
  await page.waitForURL(/module=module\.05/);
  await expect(page.locator(".lib-open-h")).toHaveText("Индикаторы");

  await page.goBack();
  await expect(page.locator(".lib-open-h")).toHaveText("Чтение графика");
  await page.goForward();
  await expect(page.locator(".lib-open-h")).toHaveText("Индикаторы");

  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * 4. Invalid module fallback
 * ------------------------------------------------------------------ */

test("an invalid module code falls back to the current module without crashing", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(DESKTOP);

  for (const bad of ["module.99", "garbage", "module.4", "%3Cscript%3E", "module.04&module.09"]) {
    await page.goto(`${LIB}?module=${bad}`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toHaveText("Уроки");
    await expect(page.locator(".lib-open-h")).toHaveText("Чтение графика");
    await expect(page.locator(".lib-row")).toHaveCount(5);
  }

  // a module far ahead is legal but has no reachable action — said honestly
  await page.goto(`${LIB}?module=module.18`, { waitUntil: "networkidle" });
  await expect(page.locator(".lib-open-h")).toHaveText("Аналитика результатов");
  await expect(page.getByText(/Уровни этого модуля пока закрыты последовательностью/)).toBeVisible();
  await expect(page.locator(".lib-open .lib-row a")).toHaveCount(0);

  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * 5/6. Opening lessons from the library
 * ------------------------------------------------------------------ */

test("a completed lesson can be reopened, and the current lesson continued", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(LIB, { waitUntil: "networkidle" });

  // 5. completed level 16 → open it
  await page.locator(".lib-row").filter({ hasText: "Свечи" }).locator("a").click();
  await page.waitForURL(/level\.016/);
  expect(page.url()).not.toContain("scenario");

  // 6. back to the library, continue the current lesson
  await page.goto(LIB, { waitUntil: "networkidle" });
  await page.locator(".lib-cont").getByRole("link", { name: /Продолжить урок/ }).click();
  await page.waitForURL(/level\.018/);
  expect(page.url()).toContain(L18);
  expect(page.url()).not.toContain("?");
  await expect(page.locator("h1")).toHaveText("Поддержка и сопротивление");

  // a locked level offers no link at all
  await page.goto(LIB, { waitUntil: "networkidle" });
  await expect(page.locator(".lib-row.is-locked a")).toHaveCount(0);
  await expect(page.locator(".lib-row.is-locked")).toContainText("Откроется после уровня 18");

  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * 7/8/9. Session progression
 * ------------------------------------------------------------------ */

test("finishing level 18 moves the library's current step to 19, with a clean URL", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(DESKTOP);

  // before: 18 current, 19 locked, 2 of 5
  await page.goto(LIB, { waitUntil: "networkidle" });
  await expect(page.locator(".lib-row.is-current .lib-row-t")).toHaveText("Поддержка и сопротивление");
  await expect(page.locator(".lib-open-head")).toContainText("пройдено 2 из 5");

  await completeLevel18(page);

  // 7. the library reflects it
  await page.goto(LIB, { waitUntil: "networkidle" });
  await expect(page.locator(".lib-row.is-current .lib-row-t")).toHaveText("Разметка графика");
  await expect(page.locator(".lib-row").filter({ hasText: "Поддержка и сопротивление" })).toContainText(
    "Завершён",
  );
  await expect(page.locator(".lib-open-head")).toContainText("пройдено 3 из 5");

  // 8. the dominant CTA now points at 19 — clean URL
  const cta = page.locator(".lib-cont").getByRole("link", { name: /Перейти к заданию/ });
  await expect(cta).toHaveAttribute("href", L19);
  expect(await cta.getAttribute("href")).not.toContain("scenario");

  // no href on the page carries a scenario
  const hrefs = await page.locator(".lib-page a").evaluateAll((as) =>
    as.map((a) => a.getAttribute("href") ?? ""),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(href).not.toContain("scenario");

  // it actually opens
  await cta.click();
  await page.waitForURL(/level\.019/);
  expect(page.url()).not.toContain("?");
  await expect(page.getByText(/Сначала нужно завершить уровень 18/)).toHaveCount(0);

  // hard reload of the library in the same session keeps the state
  await page.goto(LIB, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".lib-row.is-current .lib-row-t")).toHaveText("Разметка графика");

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("a fresh browser context shows the initial library state", async ({ browser }) => {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(LIB, { waitUntil: "networkidle" });
  await expect(page.locator(".lib-row.is-current .lib-row-t")).toHaveText("Поддержка и сопротивление");
  await expect(page.locator(".lib-open-head")).toContainText("пройдено 2 из 5");
  await expect(page.locator(".lib-cont").getByRole("link", { name: /Продолжить урок/ })).toHaveAttribute(
    "href",
    L18,
  );

  expect(errors, errors.join("\n")).toHaveLength(0);
  await context.close();
});

/* ------------------------------------------------------------------ *
 * 10. Mobile module picker
 * ------------------------------------------------------------------ */

test("mobile: the module switcher replaces the index and opens the full contents", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(MOBILE);
  await page.goto(LIB, { waitUntil: "networkidle" });

  // the desktop index is not merely invisible — it is out of the tree
  await expect(page.locator(".lib-toc")).toBeHidden();
  await expect(page.locator(".lib-switch")).toBeVisible();
  await expect(page.locator(".lib-step-now")).toContainText("Модуль 04 из 20");
  await expect(page.locator(".lib-step-now")).toContainText("Чтение графика");

  // stepping to a neighbour is ordinary navigation
  await page.getByRole("link", { name: /Следующий модуль — Индикаторы/ }).click();
  await page.waitForURL(/module=module\.05/);
  await expect(page.locator(".lib-step-now")).toContainText("Модуль 05 из 20");
  await page.getByRole("link", { name: /Предыдущий модуль — Чтение графика/ }).click();
  await page.waitForURL(/module=module\.04/);

  // the sheet
  const trigger = page.getByRole("button", { name: /Открыть список всех модулей/ });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.locator(".lib-ir")).toHaveCount(20);
  await expect(dialog.locator(".lib-ir.is-selected")).toContainText("Чтение графика");

  // Escape closes and focus returns to the trigger
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // choosing a module from the sheet navigates
  await trigger.click();
  await page.getByRole("dialog").getByRole("link", { name: /Новости/ }).click();
  await page.waitForURL(/module=module\.06/);
  await expect(page.locator(".lib-step-now")).toContainText("Модуль 06 из 20");

  // the CTA is reachable and the fixed bottom nav covers nothing
  await page.goto(LIB, { waitUntil: "networkidle" });
  const cta = page.locator(".lib-cont").getByRole("link", { name: /Продолжить урок/ });
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toBeVisible();
  const ctaBox = (await cta.boundingBox())!;
  const navBox = (await page.locator(".bottomnav").boundingBox())!;
  expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(navBox.y + 1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * 11. Keyboard
 * ------------------------------------------------------------------ */

test("keyboard: the library is fully operable and the sheet traps nothing it should not", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(LIB, { waitUntil: "networkidle" });

  // the module index is reachable by keyboard and activates with Enter
  await page.locator(".lib-toc").getByRole("link", { name: /Индикаторы/ }).focus();
  await expect(page.locator(".lib-toc").getByRole("link", { name: /Индикаторы/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForURL(/module=module\.05/);
  await expect(page.locator(".lib-open-h")).toHaveText("Индикаторы");

  // focus is visible (a real outline, not colour alone)
  const outline = await page
    .locator(".lib-toc .lib-ir a")
    .first()
    .evaluate((el) => {
      el.focus();
      return getComputedStyle(el).outlineStyle;
    });
  expect(outline).not.toBe("none");

  // mobile sheet: keyboard open → Escape → focus restored
  await page.setViewportSize(MOBILE);
  await page.goto(LIB, { waitUntil: "networkidle" });
  const trigger = page.getByRole("button", { name: /Открыть список всех модулей/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();

  expect(errors, errors.join("\n")).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * 12/13. 320px and 200% zoom
 * ------------------------------------------------------------------ */

test("320px: everything stays usable and nothing overflows", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(MOBILE_320);
  await page.goto(LIB, { waitUntil: "networkidle" });

  await expect(page.locator("h1")).toHaveText("Уроки");
  const cta = page.locator(".lib-cont").getByRole("link", { name: /Продолжить урок/ });
  await expect(cta).toBeVisible();

  // touch targets ≥44px
  for (const sel of [".lib-step-now", ".lib-step-arrow", ".lib-cont .cta"]) {
    const box = (await page.locator(sel).first().boundingBox())!;
    expect(box.height, sel).toBeGreaterThanOrEqual(44);
  }

  // long titles are not truncated with an ellipsis
  const clipped = await page.locator(".lib-row-t").evaluateAll((els) =>
    els.filter((el) => getComputedStyle(el).textOverflow === "ellipsis").length,
  );
  expect(clipped).toBe(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("200% zoom: the library reflows and keeps its functions", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(ZOOM_200);
  await page.goto(LIB, { waitUntil: "networkidle" });

  await expect(page.locator("h1")).toHaveText("Уроки");
  await expect(page.locator(".lib-cont").getByRole("link", { name: /Продолжить урок/ })).toBeVisible();
  // at 720px CSS width the layout is the compact one: the switcher, not the index
  await expect(page.locator(".lib-switch")).toBeVisible();
  await expect(page.locator(".lib-toc")).toBeHidden();
  await expect(page.locator(".lib-row")).toHaveCount(5);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  expect(errors, errors.join("\n")).toHaveLength(0);
});
