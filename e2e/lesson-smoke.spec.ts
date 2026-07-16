import { test, expect, type Page } from "@playwright/test";

/**
 * Lesson E2E (§30 D2B): real browser render of /lessons/[levelCode] across
 * viewports and scenarios — the 50% gate, one question at a time, feedback,
 * completion, the next-lesson gate, Home/Путь integration, keyboard, reduced
 * motion; no horizontal overflow; clean console; no hydration warnings.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
  mobile320: { width: 320, height: 720 },
  landscape: { width: 844, height: 390 },
  zoom200: { width: 720, height: 450 },
} as const;

const L18 = "/lessons/level.018";
const L19 = "/lessons/level.019";

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

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal page overflow").toBeLessThanOrEqual(1);
}

async function open(page: Page, url: string, size = VIEWPORTS.desktop) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

/** The correct option of the currently shown question, by its known text. */
const CORRECT = [
  "Область графика, где цена ранее неоднократно встречала спрос и переставала снижаться.",
  "Реакции происходят в диапазоне цен, а точные касания одного и того же значения встречаются редко.",
  "О том, что область заметна многим участникам, поэтому вывод опирается не на один случай.",
  "Это наблюдение, которому нужно подтверждение реакцией цены; сам подход к области ничего не решает.",
];

/* ------------------------------------------------------------------ *
 * Render across every viewport
 * ------------------------------------------------------------------ */

for (const [name, size] of Object.entries(VIEWPORTS)) {
  test(`lesson @ ${name}: renders, video before test, no overflow, clean console`, async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, `${L18}?scenario=initial`, size);

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Поддержка и сопротивление");
    await expect(page.getByRole("region", { name: /Видеоурок/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Проверка понимания" })).toBeVisible();

    // the video precedes the assessment in document order, at every size
    const order = await page.evaluate(() => {
      const media = document.querySelector(".lvs")!;
      const test = document.querySelector(".la")!;
      return media.compareDocumentPosition(test) & Node.DOCUMENT_POSITION_FOLLOWING ? "ok" : "bad";
    });
    expect(order).toBe("ok");

    await noHorizontalOverflow(page);
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
}

/* ------------------------------------------------------------------ *
 * The 50% gate
 * ------------------------------------------------------------------ */

test("initial: nothing watched, test locked and explained", async ({ page }) => {
  await open(page, `${L18}?scenario=initial`);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.locator(".la-state")).toHaveText("Закрыта");
  await expect(page.getByText(/Откроется после 50% просмотра/)).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
});

test("watching: playback advances the verified progress", async ({ page }) => {
  await open(page, `${L18}?scenario=watching`);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");

  await page.getByRole("button", { name: "Смотреть" }).click();
  await expect(page.getByRole("button", { name: "Пауза" })).toBeVisible();
  await expect
    .poll(async () => Number(await page.getByRole("progressbar").getAttribute("aria-valuenow")))
    .toBeGreaterThan(25);
});

test("threshold 49: the test is still locked", async ({ page }) => {
  await open(page, `${L18}?scenario=threshold-49`);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "49");
  await expect(page.locator(".la-state")).toHaveText("Закрыта");
  await expect(page.getByRole("button", { name: /Начать проверку/ })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  // the gate is explained, and a full watch is never demanded
  await expect(page.locator(".la-locked")).toContainText("Смотреть видео полностью не требуется");
  await expect(page.locator(".la-locked")).toContainText("Неправильный ответ ничего не отнимает");
});

test("threshold 50: the test is open, the lesson is not complete", async ({ page }) => {
  await open(page, `${L18}?scenario=threshold-50`);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.locator(".la-state")).toHaveText("Открыта");
  await expect(page.getByRole("button", { name: /Начать проверку/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Урок завершён/ })).toHaveCount(0);
});

test("seeking to the end does not unlock the test", async ({ page }) => {
  await open(page, `${L18}?scenario=initial`);
  const seek = page.getByRole("slider", { name: "Позиция видео" });
  await seek.fill("480");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.locator(".la-state")).toHaveText("Закрыта");
});

/* ------------------------------------------------------------------ *
 * The question flow
 * ------------------------------------------------------------------ */

test("one question at a time, and it cannot be skipped", async ({ page }) => {
  await open(page, `${L18}?scenario=testing`);
  await expect(page.getByText("Вопрос 1 из 4")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /Следующий вопрос/ })).toHaveCount(0);

  // submitting nothing does not fail silently
  await page.getByRole("button", { name: "Ответить" }).click();
  await expect(page.getByText("Выбери один из вариантов, чтобы ответить.")).toBeVisible();
  await expect(page.getByText("Вопрос 1 из 4")).toBeVisible();
});

test("incorrect: calm explanation, retry, next stays shut", async ({ page }) => {
  await open(page, `${L18}?scenario=incorrect`);
  await expect(page.getByText("Пока не тот ответ")).toBeVisible();
  await expect(page.locator(".lao-verdict.wrong")).toHaveText(/не тот ответ/);
  await expect(page.getByRole("button", { name: "Ответить снова" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Следующий вопрос/ })).toHaveCount(0);
  await expect(page.getByText("Вопрос 1 из 4")).toBeVisible();
  // the correct option is not revealed while the question stays open
  await expect(page.locator(".lao-verdict.correct")).toHaveCount(0);

  await page.getByRole("button", { name: "Ответить снова" }).click();
  await expect(page.getByRole("button", { name: "Ответить" })).toBeVisible();
});

test("correct: confirmation, explanation, next question", async ({ page }) => {
  await open(page, `${L18}?scenario=testing`);
  await page.getByRole("radio", { name: CORRECT[0] }).check();
  await page.getByRole("button", { name: "Ответить" }).click();

  await expect(page.locator(".lfb.ok")).toBeVisible();
  await expect(page.locator(".lao-verdict.correct")).toHaveText(/верный ответ/);
  await page.getByRole("button", { name: /Следующий вопрос/ }).click();
  await expect(page.getByText("Вопрос 2 из 4")).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Completion and the next-lesson gate
 * ------------------------------------------------------------------ */

test("full flow: 50% then every question completes the lesson", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, `${L18}?scenario=threshold-50`);
  await page.getByRole("button", { name: /Начать проверку/ }).click();

  for (let i = 0; i < CORRECT.length; i += 1) {
    await expect(page.getByRole("heading", { name: /Урок завершён/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Перейти к уровню 19/ })).toHaveCount(0);
    await page.getByRole("radio", { name: CORRECT[i]! }).check();
    await page.getByRole("button", { name: "Ответить" }).click();
    if (i < CORRECT.length - 1) await page.getByRole("button", { name: /Следующий вопрос/ }).click();
  }

  await expect(page.getByRole("heading", { name: /Урок завершён/ })).toBeVisible();
  await expect(page.locator(".la-state")).toHaveText("Пройдена");
  await expect(page.getByRole("link", { name: /Перейти к уровню 19/ })).toBeVisible();
  await expect(page.getByText(/сервер прогресса ещё не подключён/)).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("completed: both exits work, no invented XP", async ({ page }) => {
  await open(page, `${L18}?scenario=completed`);
  await expect(page.getByRole("heading", { name: /Урок завершён/ })).toBeVisible();
  await expect(page.locator(".lesson-page")).not.toContainText("XP");

  await page.getByRole("link", { name: /Вернуться в Путь/ }).click();
  await expect(page).toHaveURL(/\/path$/);
});

test("locked level 19: sequence explainer, no 404, no fake unlock", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, `${L19}?scenario=locked`);

  await expect(page.locator("h1")).toHaveText("Разметка графика");
  await expect(page.getByText(/Сначала нужно завершить уровень 18/)).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  // sequence lock — never a financial condition
  await expect(page.locator(".lesson-page")).not.toContainText("Pocket");

  await page.getByRole("link", { name: /Перейти к текущему уроку — уровень 18/ }).click();
  await expect(page).toHaveURL(/level\.018/);
  await expect(page.locator("h1")).toHaveText("Поддержка и сопротивление");
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("unknown lesson address resolves instead of 404-ing", async ({ page }) => {
  await open(page, "/lessons/level.999");
  await expect(page.locator("h1")).toHaveText("Урок не найден");
  await expect(page.getByRole("link", { name: /Вернуться в Путь/ })).toBeVisible();
});

test("unknown scenario falls back to the initial state", async ({ page }) => {
  await open(page, `${L18}?scenario=definitely-not-a-scenario`);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.locator(".la-state")).toHaveText("Закрыта");
});

/* ------------------------------------------------------------------ *
 * Home / Путь integration
 * ------------------------------------------------------------------ */

test("Home → lesson", async ({ page }) => {
  await open(page, "/?scenario=active");
  await page.getByRole("link", { name: /Продолжить урок/ }).click();
  await expect(page).toHaveURL(/\/lessons\/level\.018$/);
  await expect(page.locator("h1")).toHaveText("Поддержка и сопротивление");
});

test("Путь → lesson → Путь", async ({ page }) => {
  await open(page, "/path?scenario=active");
  await page.locator('.pnode[data-level="18"]').click();
  await page.getByRole("link", { name: "Продолжить урок" }).click();
  await expect(page).toHaveURL(/\/lessons\/level\.018$/);

  await page.getByRole("link", { name: /Вернуться в Путь/ }).click();
  await expect(page).toHaveURL(/\/path$/);
  await expect(page.locator("h1")).toHaveText("Путь");
});

test("/lessons is the library, and it reaches the current lesson", async ({ page }) => {
  // Until D2C-B this route redirected to the current lesson: D2B built the lesson
  // EXPERIENCE, not the library, so /lessons resolved to its documented default
  // instead of the 404 the navigation used to hit. The library now owns the route
  // and that default became its dominant action (DD-258) — the destination the
  // user reaches is unchanged, so this test still guards the same guarantee.
  await open(page, "/lessons");
  await expect(page).toHaveURL(/\/lessons$/);
  await expect(page.locator("h1")).toHaveText("Уроки");

  await page.locator(".lib-cont").getByRole("link", { name: /Продолжить урок/ }).click();
  await expect(page).toHaveURL(/\/lessons\/level\.018$/);
  await expect(page.locator("h1")).toHaveText("Поддержка и сопротивление");
});

/* ------------------------------------------------------------------ *
 * Keyboard, motion, layout
 * ------------------------------------------------------------------ */

test("keyboard: play toggles, arrows move between options, submit works", async ({ page }) => {
  await open(page, `${L18}?scenario=threshold-50`);

  await page.getByRole("button", { name: "Смотреть" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Пауза" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Смотреть" })).toBeFocused();

  await page.getByRole("button", { name: /Начать проверку/ }).click();
  // native radio semantics: arrows move and select within the group
  await page.getByRole("radio").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio").nth(1)).toBeChecked();
  await page.keyboard.press("Enter");
  await expect(page.locator(".lfb")).toBeVisible();
});

test("focus is managed after submit and lands on the explanation", async ({ page }) => {
  await open(page, `${L18}?scenario=testing`);
  await page.getByRole("radio", { name: CORRECT[0]! }).check();
  await page.getByRole("button", { name: "Ответить" }).click();
  await expect(page.locator(".lfb")).toBeFocused();
});

test("skip link reaches main", async ({ page }) => {
  await open(page, `${L18}?scenario=initial`);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержимому" })).toBeFocused();
});

test("reduced motion: the lesson still works and states still change", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = collectErrors(page);
  await open(page, `${L18}?scenario=testing`);

  await page.getByRole("radio", { name: CORRECT[0]! }).check();
  await page.getByRole("button", { name: "Ответить" }).click();
  await expect(page.locator(".lfb.ok")).toBeVisible();
  await noHorizontalOverflow(page);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("mobile: the bottom navigation covers nothing at the end of the flow", async ({ page }) => {
  await open(page, `${L18}?scenario=completed`, VIEWPORTS.mobile);
  const cta = page.getByRole("link", { name: /Перейти к уровню 19/ });
  await cta.scrollIntoViewIfNeeded();

  const box = (await cta.boundingBox())!;
  const navTop = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".mbnav, nav[class*='mobile']");
    return nav ? nav.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
  });
  expect(box.y + box.height, "CTA sits above the bottom navigation").toBeLessThanOrEqual(navTop + 1);
  expect(box.height, "touch target is at least 44px").toBeGreaterThanOrEqual(44);
});
