import { test, expect, type Page, type BrowserContext, type Locator } from "@playwright/test";

/**
 * D3-B — the report level (/lessons/level.003) behavioral suite.
 *
 * Named *-smoke.spec.ts so the standard `npm run test:e2e` gate picks it up
 * automatically (DD-257). It writes nothing to disk — screenshots live in
 * report-level-screenshots.spec.ts, which the gate deliberately excludes.
 *
 * `?scenario=report` is the DEVELOPMENT AND TEST marker adapter (DD-271): it
 * puts the user ON level 3, the only marker under which the report story is
 * coherent. It is used HERE, in tests, and never in a user-facing link — a
 * dedicated case below asserts that no rendered href carries it.
 */

const REPORT = "/lessons/level.003?scenario=report";
const REPORT_CANONICAL = "/lessons/level.003";
const LIB = "/lessons?scenario=report";
const PATH = "/path?scenario=report";

// Since D3-D the store writes the v3 key (DD-296); the v1/v2 keys are legacy,
// read-only migration sources that are never written or deleted.
const STORAGE_KEY = "ata.report-workspace.v3";
const SAVE_SETTLE = 900; // debounce (600ms) + margin

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
/** 200% zoom halves the CSS layout viewport of a 1440x900 window (real reflow). */
const ZOOM_200 = { width: 720, height: 450 };

/** §20/§21 — console errors and hydration warnings are collected on every page. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (msg.type() === "error") errors.push(t);
    if (/hydrat/i.test(t)) errors.push(`HYDRATION: ${t}`);
  });
  page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));
  return errors;
}

const openRow = (page: Page, ordinal: number) =>
  page.getByRole("button", { name: new RegExp(`^Запись ${ordinal}:`) });

const noticedField = (page: Page) => page.getByLabel(/Что заметил после сделки/);
const summaryField = (page: Page) => page.getByRole("textbox", { name: "Итоговое наблюдение" });
const submitButton = (page: Page) => page.getByRole("button", { name: "Отправить на проверку" });

/**
 * Entry navigation, whichever viewport we are on.
 *
 * Desktop exposes a collapsed row per entry; mobile hides them (they leave the
 * a11y tree entirely) and navigates with «Предыдущая/Следующая запись». A helper
 * that only knew about rows silently filled entry 1 five times on mobile and
 * produced evidence claiming more was filled than actually was.
 */

/** Which entry is currently open, read from the page rather than assumed. */
async function currentOpenOrdinal(page: Page): Promise<number | null> {
  for (let i = 1; i <= 5; i += 1) {
    if ((await page.getByRole("heading", { level: 3, name: `Запись ${i}` }).count()) > 0) return i;
  }
  return null;
}

async function openEntry(page: Page, ordinal: number) {
  const row = openRow(page, ordinal);
  if ((await row.count()) > 0) {
    await row.click();
    return;
  }
  // Mobile: step TOWARDS the wanted entry. A forward-only walk cannot come back
  // from entry 2 to entry 1, and silently ran into the disabled end button.
  for (let guard = 0; guard < 8; guard += 1) {
    const current = await currentOpenOrdinal(page);
    if (current === null || current === ordinal) return;
    const label = current < ordinal ? /Следующая запись/ : /Предыдущая запись/;
    await page.getByRole("button", { name: label }).click();
  }
}

/** Fill one evidence entry through the real UI, on any viewport. */
async function fillEntry(page: Page, ordinal: number, text: string) {
  await openEntry(page, ordinal);
  await noticedField(page).fill(text);
}

/** Fill everything the readiness rule asks for. */
async function makeReady(page: Page) {
  for (let i = 1; i <= 5; i += 1) {
    await fillEntry(page, i, `наблюдение по сделке ${i}`);
  }
  await summaryField(page).fill("итог по всем пяти записям");
  await page.waitForTimeout(SAVE_SETTLE);
}

async function readStorage(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The minimum breathing room a control must be able to claim above the bar. */
const NAV_CLEARANCE_PX = 12;

/**
 * Assert a control can be scrolled ENTIRELY above the fixed bottom navigation.
 *
 * Measured from real bounding boxes, not from the presence of a `padding-bottom`
 * rule: D3-B had the padding and still buried its CTA, because a `flex-basis`
 * meant for the desktop row layout reserved 280px of HEIGHT in the mobile column
 * one. Only geometry tells the truth here.
 */
async function assertClearsBottomNav(page: Page, target: Locator, label: string) {
  await target.scrollIntoViewIfNeeded();
  // Push to the very end of the document: "can it clear the bar" means at the
  // furthest the page can actually scroll, not wherever it happens to rest.
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(120);

  const box = await target.boundingBox();
  const nav = await page.locator(".bottomnav").boundingBox();
  expect(box, `${label}: no bounding box`).not.toBeNull();
  expect(nav, "bottom navigation missing").not.toBeNull();

  const gap = nav!.y - (box!.y + box!.height);
  expect(
    gap,
    `${label} must clear the bottom navigation by ≥${NAV_CLEARANCE_PX}px, got ${Math.round(gap)}px`,
  ).toBeGreaterThanOrEqual(NAV_CLEARANCE_PX);
}

/* ------------------------------------------------------------------ *
 * 1–2 — empty and partial draft
 * ------------------------------------------------------------------ */

test.describe("report level — draft", () => {
  test("1. empty report shows five entries and nothing to submit", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Первые пять demo-сделок");
    await expect(page.getByText("Отчёт по 5 demo-сделкам").first()).toBeVisible();
    await expect(page.getByText("Заполнено 0 из 5 записей").first()).toBeVisible();

    // Four collapsed rows + one open panel = the five the artifact asks for.
    await expect(page.getByRole("button", { expanded: false })).toHaveCount(4);
    await expect(page.getByRole("heading", { level: 3, name: "Запись 1" })).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
  });

  test("2. partial draft counts in words, never in percent", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await fillEntry(page, 1, "дождался условия и вошёл");
    await fillEntry(page, 2, "отказался от входа");

    await expect(page.getByText("Заполнено 2 из 5 записей").first()).toBeVisible();
    await expect(
      page.getByText("Осталось заполнить 3 записи и итоговое наблюдение").first(),
    ).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/\d+\s*%/);
    expect(body).not.toMatch(/балл|оценка|score/);
  });
});

/* ------------------------------------------------------------------ *
 * 3–4 — persistence
 * ------------------------------------------------------------------ */

test.describe("report level — browser-local persistence", () => {
  test("3. autosave survives a reload", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await fillEntry(page, 1, "переживёт перезагрузку");
    await page.waitForTimeout(SAVE_SETTLE);
    expect(await readStorage(page)).toContain("переживёт перезагрузку");

    await page.reload();
    await expect(noticedField(page)).toHaveValue("переживёт перезагрузку");
    await expect(page.getByText("Заполнено 1 из 5 записей").first()).toBeVisible();
  });

  test("4. a new page in the same storage context still has the draft", async ({ context }) => {
    // localStorage is per-origin and outlives the tab — this is the whole reason
    // the report store diverges from the lesson store's sessionStorage (DD-266).
    const first = await context.newPage();
    await first.goto(REPORT);
    await fillEntry(first, 1, "переживёт закрытие вкладки");
    await first.waitForTimeout(SAVE_SETTLE);
    await first.close();

    const second = await context.newPage();
    await second.goto(REPORT);
    await expect(noticedField(second)).toHaveValue("переживёт закрытие вкладки");
    await second.close();
  });

  test("says the draft is local and never claims a server", async ({ page }) => {
    await page.goto(REPORT);
    await expect(page.getByText(/Черновик сохранён в этом браузере/).first()).toBeVisible();

    const body = await page.locator("body").innerText();
    for (const lie of [
      "Отправлено наставнику",
      "Сохранено на сервере",
      "Синхронизировано",
      "Наставник получил отчёт",
    ]) {
      expect(body).not.toContain(lie);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 5–6 — navigation and readiness
 * ------------------------------------------------------------------ */

test.describe("report level — the ledger", () => {
  test("5. moves between the five entries, keeping one open and losing no text", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await fillEntry(page, 1, "первая запись");
    await fillEntry(page, 3, "третья запись");

    await expect(page.getByRole("heading", { level: 3, name: "Запись 3" })).toBeVisible();
    await expect(page.getByRole("button", { expanded: false })).toHaveCount(4);

    await openRow(page, 1).click();
    await expect(noticedField(page)).toHaveValue("первая запись");
    await openRow(page, 3).click();
    await expect(noticedField(page)).toHaveValue("третья запись");
  });

  test("6. ready state enables the single primary action", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await makeReady(page);

    await expect(page.getByText("Можно отправить на проверку").first()).toBeVisible();
    await expect(submitButton(page)).toBeEnabled();
  });
});

/* ------------------------------------------------------------------ *
 * 7–9 — submit and pending
 * ------------------------------------------------------------------ */

test.describe("report level — submit and pending review", () => {
  test("7. submit requires confirmation and explains what it really does", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await makeReady(page);

    await submitButton(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const text = await dialog.innerText();
    expect(text).toMatch(/редактирование будет заблокировано/i);
    expect(text).toMatch(/только в этом браузере/i);
    expect(text).toMatch(/Автоматического одобрения нет/i);
    expect(text).toMatch(/Уровень 4 «Контрольная точка \$50» откроется после одобрения отчёта/);
    await expect(page.getByRole("button", { name: /Отправить наставнику/ })).toHaveCount(0);

    // Cancel leaves it a draft.
    await page.getByRole("button", { name: "Продолжить редактирование" }).click();
    await expect(dialog).toBeHidden();
    expect(await readStorage(page)).toContain('"status":"draft"');

    // Escape closes it too.
    await submitButton(page).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("8. confirming produces a local pending-review, read-only and honest", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await makeReady(page);

    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();

    await expect(page.getByText("На проверке")).toBeVisible();
    await expect(page.getByText("Обычно проверка занимает до одного дня.")).toBeVisible();
    await expect(
      page.getByText(/Отчёт отмечен как отправленный только в этом браузере/),
    ).toBeVisible();

    await expect(submitButton(page)).toHaveCount(0);
    await expect(noticedField(page)).toHaveAttribute("readonly", "");
    await expect(summaryField(page)).toHaveAttribute("readonly", "");

    // No countdown, no avatar, no named reviewer, no automatic verdict.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/осталось.*(час|минут)/i);
    expect(body).not.toContain("Alex Curie");
    expect(body).not.toContain("Одобрен");
    expect(body).not.toContain("Отклонён");
    await expect(page.locator(".rl-page img")).toHaveCount(0);

    expect(await readStorage(page)).toContain('"status":"pending-review"');
  });

  test("9. pending survives a reload and offers honest exits", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();

    await page.reload();
    await expect(page.getByText("На проверке")).toBeVisible();
    await expect(submitButton(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /К списку уроков/ })).toHaveAttribute(
      "href",
      "/lessons",
    );
    await expect(page.getByRole("link", { name: /Посмотреть Путь/ })).toHaveAttribute(
      "href",
      "/path",
    );
  });
});

/* ------------------------------------------------------------------ *
 * 10 — progression
 * ------------------------------------------------------------------ */

test.describe("report level — progression", () => {
  test("10. level 4 stays locked before and after submit", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await expect(
      page.getByText("Уровень 4 «Контрольная точка $50» откроется после одобрения отчёта.").first(),
    ).toBeVisible();

    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();

    // Pending is not completion: the sentence is still true after submitting.
    await expect(
      page.getByText("Уровень 4 «Контрольная точка $50» откроется после одобрения отчёта."),
    ).toBeVisible();

    // The library agrees: level 3 is still the step, level 4 has no route.
    await page.goto(LIB);
    await expect(page.getByText("На проверке").first()).toBeVisible();
    await expect(page.locator('a[href="/lessons/level.004"]')).toHaveCount(0);
  });

  test("a pending report never writes lesson completion", async ({ page }) => {
    await page.goto(REPORT);
    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();

    // level.003 must not appear in the lesson progress record — pending is not done.
    const lesson = await page.evaluate(() =>
      window.sessionStorage.getItem("ata.lesson-progress.v1"),
    );
    expect(lesson ?? "").not.toContain("level.003");
  });

  test("the report store holds no balance, XP or financial value", async ({ page }) => {
    await page.goto(REPORT);
    await makeReady(page);
    const raw = (await readStorage(page)) ?? "";
    for (const forbidden of ["xp", "XP", "balance", "deposit", "Pocket", "$"]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 11–12 — integrations
 * ------------------------------------------------------------------ */

test.describe("report level — integrations", () => {
  test("11. the lessons library shows the report lifecycle", async ({ page }) => {
    await page.setViewportSize(DESKTOP);

    await page.goto(REPORT);
    await fillEntry(page, 1, "черновик");
    await page.waitForTimeout(SAVE_SETTLE);

    await page.goto(LIB);
    await expect(page.getByText("Черновик").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Перейти к отчёту/ }).first()).toHaveAttribute(
      "href",
      "/lessons/level.003",
    );

    await page.goto(REPORT);
    await makeReady(page);
    await page.goto(LIB);
    await expect(page.getByText("Готов к отправке").first()).toBeVisible();
  });

  test("12. the path shows the report lifecycle and keeps level 4 shut", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();

    await page.goto(PATH);
    await page.getByRole("button", { name: /Уровень 3/ }).first().click();

    const detail = page.getByRole("complementary", { name: /Уровень 3 — детали/ });
    await expect(detail.getByText("Отчёт: На проверке")).toBeVisible();
    await expect(detail.getByText(/в этом прототипе не подключена/)).toBeVisible();

    // Financial privacy on the path is unchanged.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/осталось \$/i);
    expect(body).not.toMatch(/ваш баланс|твой баланс/i);
    await expect(page.locator('a[href*="pocket"]')).toHaveCount(0);
  });

  test("no user-facing link ever carries the scenario adapter", async ({ page }) => {
    await page.goto(REPORT);
    const hrefs = await page.locator("a").evaluateAll((els) =>
      els.map((el) => el.getAttribute("href") ?? ""),
    );
    for (const href of hrefs) expect(href).not.toContain("scenario");
  });

  test("the canonical profile is not polluted by a report written under the adapter", async ({
    page,
  }) => {
    await page.goto(REPORT);
    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();

    // Артём is on level 18: level 3 is behind him and stays «Завершён».
    await page.goto("/lessons?module=module.01");
    await expect(page.getByText("Завершён").first()).toBeVisible();
    await expect(page.getByText("На проверке")).toHaveCount(0);

    // And the report route itself makes no claim about level 4 for him.
    await page.goto(REPORT_CANONICAL);
    await expect(page.getByText(/Уровень 3 уже пройден в текущем профиле/)).toBeVisible();
    await expect(page.getByText(/откроется после одобрения отчёта/)).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ *
 * 13–15 — invalid states
 * ------------------------------------------------------------------ */

test.describe("report level — invalid storage fails closed", () => {
  async function seedRaw(context: BrowserContext, raw: string) {
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, raw],
    );
  }

  test("13. corrupt JSON degrades to an empty draft", async ({ context }) => {
    await seedRaw(context, "{{{ not json at all");
    const page = await context.newPage();
    const errors = collectErrors(page);

    await page.goto(REPORT);
    await expect(page.getByText("Заполнено 0 из 5 записей").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The user is never shown the raw payload.
    await expect(page.getByText(/not json/)).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  test("14. an unknown schema version degrades to an empty draft", async ({ context }) => {
    await seedRaw(
      context,
      JSON.stringify({
        version: 99,
        reports: [{ levelCode: "level.003", entries: [], summary: "x", status: "pending-review" }],
      }),
    );
    const page = await context.newPage();
    await page.goto(REPORT);
    await expect(page.getByText("Заполнено 0 из 5 записей").first()).toBeVisible();
    // A forged pending from an unknown version must not lock the workspace.
    // Scoped to the status chip: «Перед отправкой» legitimately says the words
    // «На проверке» in the future tense while still a draft.
    await expect(page.locator(".rl-status")).toHaveCount(0);
    await expect(submitButton(page)).toBeVisible();
    await page.close();
  });

  test("a forged approved verdict is impossible", async ({ context }) => {
    await seedRaw(
      context,
      JSON.stringify({
        version: 1,
        reports: [
          {
            levelCode: "level.003",
            entries: [],
            summary: "x",
            status: "approved",
          },
        ],
      }),
    );
    const page = await context.newPage();
    await page.goto(REPORT);
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Одобрен");
    // Dropped entirely — back to an empty, editable draft.
    await expect(page.getByText("Заполнено 0 из 5 записей").first()).toBeVisible();
    await page.close();
  });

  test("15. a storage write failure is told honestly, and the route survives", async ({
    context,
  }) => {
    await context.addInitScript(() => {
      const real = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = (key: string, value: string) => {
        // The v3 key — the one the store actually writes since D3-D (DD-296).
        if (key === "ata.report-workspace.v3") throw new Error("QuotaExceededError");
        real(key, value);
      };
    });
    const page = await context.newPage();
    const errors = collectErrors(page);

    await page.goto(REPORT);
    await fillEntry(page, 1, "не сохранится");
    await page.waitForTimeout(SAVE_SETTLE);

    // The page keeps working and tells the truth: local saving is not available.
    await expect(noticedField(page)).toHaveValue("не сохранится");
    await expect(page.getByText(/Локальное сохранение недоступно/).first()).toBeVisible();
    // …and it must NOT claim the draft is safe anywhere on the screen.
    await expect(page.getByText(/Черновик сохранён в этом браузере/)).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.close();
  });
});

/* ------------------------------------------------------------------ *
 * 16–19 — responsive and keyboard
 * ------------------------------------------------------------------ */

test.describe("report level — responsive", () => {
  test("16. mobile 390 works one entry at a time, with nothing under the nav", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);

    // The collapsed rows are gone; the strip + prev/next carry navigation.
    await expect(page.getByRole("button", { expanded: false })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Запись 1" })).toBeVisible();

    const next = page.getByRole("button", { name: /Следующая запись/ });
    await expect(next).toBeVisible();
    await next.click();
    await expect(page.getByRole("heading", { level: 3, name: "Запись 2" })).toBeVisible();

    // Touch targets.
    const box = await next.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // The writing surface is not hidden behind the fixed bottom navigation.
    await noticedField(page).fill("текст на мобильном");
    const field = await noticedField(page).boundingBox();
    const nav = await page.locator(".bottomnav").boundingBox();
    expect(field!.y + field!.height).toBeLessThanOrEqual(nav!.y);

    await assertNoHorizontalOverflow(page);
  });

  test("17. mobile 320 stays usable", async ({ page }) => {
    await page.setViewportSize(MOBILE_320);
    await page.goto(REPORT);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(noticedField(page)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("tablet 1024 keeps the ledger whole", async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto(REPORT);
    await expect(page.getByRole("button", { expanded: false })).toHaveCount(4);
    await assertNoHorizontalOverflow(page);
  });

  test("18. the ledger is fully operable from the keyboard", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await openRow(page, 2).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 3, name: "Запись 2" })).toBeVisible();

    await openRow(page, 4).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("heading", { level: 3, name: "Запись 4" })).toBeVisible();

    // The dialog traps focus and returns it on Escape.
    await makeReady(page);
    await submitButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Отметить как отправленный" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(submitButton(page)).toBeFocused();
  });

  test("19. 200% zoom reflows without horizontal overflow", async ({ page }) => {
    await page.setViewportSize(ZOOM_200);
    await page.goto(REPORT);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(noticedField(page)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("desktop has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await assertNoHorizontalOverflow(page);
  });
});

/* ------------------------------------------------------------------ *
 * D3-B.1 — mobile safe area: every control must clear the fixed bar
 * ------------------------------------------------------------------ */

test.describe("report level — bottom navigation never traps a control", () => {
  const summaryOf = (page: Page) => page.getByRole("textbox", { name: "Итоговое наблюдение" });

  test("390×844 — draft, ready and pending all clear the bar", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);

    // --- partial draft ---
    await fillEntry(page, 1, "первое наблюдение");
    await fillEntry(page, 2, "второе наблюдение");
    await assertClearsBottomNav(page, noticedField(page), "active textarea");
    await assertClearsBottomNav(
      page,
      page.getByRole("button", { name: /Следующая запись/ }),
      "next-entry button",
    );
    await assertClearsBottomNav(page, summaryOf(page), "итоговое наблюдение");
    await assertClearsBottomNav(page, page.locator(".rl-before"), "блок «Перед отправкой»");
    await assertClearsBottomNav(page, submitButton(page), "submit (draft)");

    // --- ready ---
    await makeReady(page);
    await assertClearsBottomNav(page, submitButton(page), "submit (ready)");

    // --- pending ---
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();
    await assertClearsBottomNav(
      page,
      page.getByRole("link", { name: /К списку уроков/ }),
      "pending action «К списку уроков»",
    );
    await assertClearsBottomNav(
      page,
      page.getByRole("link", { name: /Посмотреть Путь/ }),
      "pending action «Посмотреть Путь»",
    );

    await assertNoHorizontalOverflow(page);
  });

  test("320×720 — the narrowest supported width keeps every control reachable", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_320);
    await page.goto(REPORT);

    await fillEntry(page, 1, "первое наблюдение");
    await assertClearsBottomNav(page, noticedField(page), "active textarea");

    // Entry navigation is the ONLY way to reach entries 2–5 at this width.
    const prev = page.getByRole("button", { name: /Предыдущая запись/ });
    const next = page.getByRole("button", { name: /Следующая запись/ });
    await assertClearsBottomNav(page, next, "next-entry button");
    await next.click();
    await expect(page.getByRole("heading", { level: 3, name: "Запись 2" })).toBeVisible();
    await assertClearsBottomNav(page, prev, "prev-entry button");
    await prev.click();
    await expect(page.getByRole("heading", { level: 3, name: "Запись 1" })).toBeVisible();

    await assertClearsBottomNav(page, summaryOf(page), "итоговое наблюдение");
    await assertClearsBottomNav(page, submitButton(page), "submit");

    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();
    await assertClearsBottomNav(
      page,
      page.getByRole("link", { name: /Посмотреть Путь/ }),
      "pending action «Посмотреть Путь»",
    );

    await assertNoHorizontalOverflow(page);
  });

  test("200% zoom — the last control stays reachable and nothing is lost", async ({ page }) => {
    await page.setViewportSize(ZOOM_200);
    await page.goto(REPORT);
    await makeReady(page);

    // The last control of the live work…
    await assertClearsBottomNav(page, submitButton(page), "submit at 200% zoom");

    // …and of the state it leads to.
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();
    await assertClearsBottomNav(
      page,
      page.getByRole("link", { name: /Посмотреть Путь/ }),
      "pending action at 200% zoom",
    );

    // Reflow must not cost функции: the ledger and its statuses survive.
    await expect(page.getByText("На проверке")).toBeVisible();
    await expect(page.getByText("Обычно проверка занимает до одного дня.")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("the bottom gap is breathing room, not a pit", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);
    await makeReady(page);

    // Guards the regression this phase fixed from both sides: D3-B left 108px of
    // dead padding under the CTA plus a 201px hole above it, because a desktop
    // width hint became a height in the mobile column layout.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);

    const btn = (await submitButton(page).boundingBox())!;
    const nav = (await page.locator(".bottomnav").boundingBox())!;
    const gap = nav.y - (btn.y + btn.height);
    expect(gap).toBeGreaterThanOrEqual(NAV_CLEARANCE_PX);
    expect(gap, `resting gap under the CTA should stay calm, got ${Math.round(gap)}px`).toBeLessThan(
      64,
    );

    // The explanation must sit WITH its button, not a screen away from it.
    const txt = (await page.locator(".rl-end-txt").boundingBox())!;
    expect(btn.y - (txt.y + txt.height)).toBeLessThan(48);
  });
});

/* ------------------------------------------------------------------ *
 * 20–21 — console hygiene
 * ------------------------------------------------------------------ */

test.describe("report level — console", () => {
  test("20/21. no console errors and no hydration warnings across the flow", async ({ page }) => {
    const errors = collectErrors(page);

    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();
    await page.reload();
    await page.goto(LIB);
    await page.goto(PATH);

    expect(errors).toEqual([]);
  });
});
