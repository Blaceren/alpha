import { test, expect, type Page } from "@playwright/test";

/**
 * D2B.1 — progression without the development scenario (§8).
 *
 * The user's route to level 19 must be a clean URL backed by THIS browser
 * session. These tests drive the real thing: real playback to the real 50% gate
 * (the media clock is fast-forwarded, not stubbed — the production tick path
 * runs), real answers, real sessionStorage, real navigation.
 *
 * Named *-smoke.spec.ts so the standard `npm run test:e2e` gate picks it up.
 */

const L18 = "/lessons/level.018";
const L19 = "/lessons/level.019";
const STORAGE_KEY = "ata.lesson-progress.v1";

/** The correct option of each question, in fixture order. */
const CORRECT = [
  "Область графика, где цена ранее неоднократно встречала спрос и переставала снижаться.",
  "Реакции происходят в диапазоне цен, а точные касания одного и того же значения встречаются редко.",
  "О том, что область заметна многим участникам, поэтому вывод опирается не на один случай.",
  "Это наблюдение, которому нужно подтверждение реакцией цены; сам подход к области ничего не решает.",
];

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

/** Answer every question correctly on an already-open assessment. */
async function answerAll(page: Page) {
  for (let i = 0; i < CORRECT.length; i += 1) {
    await page.getByRole("radio", { name: CORRECT[i]! }).check();
    await page.getByRole("button", { name: "Ответить" }).click();
    if (i < CORRECT.length - 1) {
      await page.getByRole("button", { name: /Следующий вопрос/ }).click();
    }
  }
}

test("full progression: real 50% watch → answers → clean link → session unlock", async ({ page }) => {
  const errors = collectErrors(page);

  // 1. level 18 in its initial state — no scenario query anywhere.
  await page.clock.install();
  await page.goto(L18, { waitUntil: "networkidle" });
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.locator(".la-state")).toHaveText("Закрыта");

  // 2. actually watch past the gate — the real playback path, fast-forwarded.
  await page.getByRole("button", { name: "Смотреть" }).click();
  await page.clock.runFor(245_000);
  await page.getByRole("button", { name: "Пауза" }).click();

  await expect
    .poll(async () => Number(await page.getByRole("progressbar").getAttribute("aria-valuenow")))
    .toBeGreaterThanOrEqual(50);
  await expect(page.locator(".la-state")).toHaveText("Открыта");

  // 3. answer every question correctly.
  await page.getByRole("button", { name: /Начать проверку/ }).click();
  await answerAll(page);

  // 4. completion.
  await expect(page.getByRole("heading", { name: /Урок завершён/ })).toBeVisible();
  await expect(page.getByText(/Отметка хранится только в текущей сессии браузера/)).toBeVisible();

  // 5. the CTA is a clean canonical URL.
  const cta = page.getByRole("link", { name: /Перейти к уровню 19 «Разметка графика»/ });
  await expect(cta).toHaveAttribute("href", L19);
  expect(await cta.getAttribute("href")).not.toContain("scenario");

  // the session recorded it
  const stored = await page.evaluate((k) => window.sessionStorage.getItem(k), STORAGE_KEY);
  expect(JSON.parse(stored!)).toEqual({
    version: 1,
    completed: ["level.018"],
    unlocked: ["level.019"],
  });

  // 6. click it.
  await cta.click();
  await page.waitForURL(/level\.019/);

  // 7. level 19 is open, with no scenario in the URL and no locked message.
  expect(page.url()).toContain(L19);
  expect(page.url()).not.toContain("scenario");
  expect(page.url()).not.toContain("?");
  await expect(page.locator("h1")).toHaveText("Разметка графика");
  await expect(page.getByText(/Этот уровень ещё не построен/)).toBeVisible();
  await expect(page.getByText(/Уровень открыт по последовательности/)).toBeVisible();
  await expect(page.getByText(/Сначала нужно завершить уровень 18/)).toHaveCount(0);
  // an honest placeholder — not a fake practical assignment, not a fake completion
  await expect(page.getByText(/Практические уровни появятся на следующем этапе/)).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);

  // 8. hard reload in the same tab keeps it unlocked.
  await page.reload({ waitUntil: "networkidle" });
  expect(page.url()).not.toContain("scenario");
  await expect(page.getByText(/Этот уровень ещё не построен/)).toBeVisible();
  await expect(page.getByText(/Сначала нужно завершить уровень 18/)).toHaveCount(0);

  // 11/12. clean console, no hydration warnings.
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("a fresh browser context has no session marker, so level 19 stays locked", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(L19, { waitUntil: "networkidle" });

  await expect(page.locator("h1")).toHaveText("Разметка графика");
  await expect(page.getByText(/Сначала нужно завершить уровень 18/)).toBeVisible();
  await expect(page.getByText(/Этот уровень ещё не построен/)).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  // the way back to the current lesson is a clean link
  await expect(page.getByRole("link", { name: /Перейти к текущему уроку — уровень 18/ })).toHaveAttribute(
    "href",
    L18,
  );

  expect(errors, errors.join("\n")).toHaveLength(0);
  await context.close();
});

test("a corrupt session marker never breaks the route and never unlocks", async ({ page }) => {
  const errors = collectErrors(page);

  for (const poison of [
    "{not json",
    "[]",
    '{"version":99,"completed":["level.018"],"unlocked":["level.019"]}',
    '{"version":1,"completed":"everything","unlocked":"everything"}',
  ]) {
    await page.goto(L18, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ([k, v]) => window.sessionStorage.setItem(k!, v!),
      [STORAGE_KEY, poison] as const,
    );

    await page.goto(L19, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toHaveText("Разметка графика");
    await expect(page.getByText(/Сначала нужно завершить уровень 18/)).toBeVisible();
    await expect(page.getByText(/Этот уровень ещё не построен/)).toHaveCount(0);
  }

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("the dev scenario still works, but no user-facing link produces one", async ({ page }) => {
  // It remains available for development and tests…
  await page.goto(`${L19}?scenario=unlocked`, { waitUntil: "networkidle" });
  await expect(page.getByText(/Этот уровень ещё не построен/)).toBeVisible();

  // …but nothing the user can click carries it.
  await page.goto(`${L18}?scenario=completed`, { waitUntil: "networkidle" });
  const hrefs = await page.locator(".lesson-page a").evaluateAll((as) =>
    as.map((a) => a.getAttribute("href") ?? ""),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(href).not.toContain("scenario");

  // The `?scenario=completed` visit above persisted a real L18 completion into
  // this tab's sessionStorage. Since D3-D the Path folds that session progress in
  // (effectiveProgress), so the clean active-scenario assertions below must start
  // from a clean session — otherwise L18 correctly reads as «пройден», not the
  // current step. Remove ONLY the ATA-owned lesson-progress key (targeted, not a
  // blanket clear); the subsequent active visits do not write it back.
  await page.evaluate((k) => window.sessionStorage.removeItem(k), STORAGE_KEY);

  // Home and Путь link into the lesson cleanly too.
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: /Продолжить урок/ })).toHaveAttribute("href", L18);

  await page.goto("/path?scenario=active", { waitUntil: "networkidle" });
  await page.locator('.pnode[data-level="18"]').click();
  await expect(page.getByRole("link", { name: "Продолжить урок" })).toHaveAttribute("href", L18);
});
