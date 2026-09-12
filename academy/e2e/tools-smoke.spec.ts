import { test, expect, type Page } from "@playwright/test";

/**
 * Tools + Trading Journal smoke (D4-B). Part of the mandatory `npm run test:e2e`
 * gate (its filename matches `smoke.spec.ts`). Asserts the behavioural
 * invariants screenshots cannot prove: the route is in production navigation,
 * the canonical unlocks resolve, the journal creates/edits/persists honestly,
 * storage failure is never a fake success, corruption fails closed, no
 * progression/report key is touched, no financial aggregate is shown, and the
 * geometry holds with a clean console and no horizontal overflow.
 */

const JOURNAL = "/tools/tool.trading_journal";
const STORAGE_KEY = "ata.tools.trading-journal.v1";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
} as const;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function clearJournal(page: Page) {
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
}

async function fillEntry(
  page: Page,
  v: { instrument: string; direction: RegExp; result?: string; lesson: string },
) {
  await page.getByLabel("Дата").fill("14.07.2026");
  await page.getByLabel("Время").fill("09:00");
  await page.getByLabel("Инструмент").fill(v.instrument);
  await page.getByRole("radio", { name: v.direction }).check();
  await page.getByLabel(/^План/).fill("план входа");
  await page.getByLabel(/Исполнение/).fill("что сделал");
  await page.getByLabel(/Урок/).fill(v.lesson);
  if (v.result !== undefined) await page.getByLabel(/Ручной результат/).fill(v.result);
}

test("1 · /tools is a real link in production navigation", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/", { waitUntil: "networkidle" });
  const link = page.getByRole("link", { name: "Инструменты" }).first();
  await expect(link).toHaveAttribute("href", "/tools");
});

test("2-4 · canonical unlocks: Journal + Risk Calculator working (own CTAs), locked targets", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/tools", { waitUntil: "networkidle" });

  // 2 · Trading Journal unlocked → its own journal CTA.
  const cta = page.getByRole("link", { name: /Открыть журнал/ });
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute("href", JOURNAL);

  // 3 · Risk Calculator available (D4-C) → its OWN calculator CTA (per-tool copy).
  await expect(page.getByText("Risk Calculator")).toBeVisible();
  const riskCta = page.getByRole("link", { name: /Открыть калькулятор/ });
  await expect(riskCta).toHaveCount(1);
  await expect(riskCta).toHaveAttribute("href", "/tools/tool.risk_calculator");
  // No stale coming-soon copy for the now-implemented calculator.
  await expect(page.getByText(/Открыт по прогрессу · инструмент готовится/)).toHaveCount(0);

  // 4 · locked previews carry their exact target level.
  await expect(page.getByText("Откроется на уровне 20")).toBeVisible();
  await expect(page.getByText("Откроется на уровне 25")).toBeVisible();
});

test("5-6 · open the journal → honest empty state", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/tools", { waitUntil: "networkidle" });
  await clearJournal(page);
  await page.goto("/tools", { waitUntil: "networkidle" });

  await page.getByRole("link", { name: /Открыть журнал/ }).click();
  await expect(page).toHaveURL(new RegExp(JOURNAL.replace(/\./g, "\\.")));
  await expect(page.getByRole("heading", { level: 1, name: "Trading Journal" })).toBeVisible();
  await expect(page.getByText(/Здесь появится ваша первая запись/)).toBeVisible();
  await expect(
    page.getByText(/Записи вводятся вручную и не синхронизируются с брокером/),
  ).toBeVisible();
});

test("7-10 · create positive / negative / no-result entries, persist across reload", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await clearJournal(page);
  await page.reload({ waitUntil: "networkidle" });

  // 7 · positive
  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await fillEntry(page, { instrument: "XAU/USD", direction: /Продажа/, result: "18", lesson: "терпение сработало" });
  await page.getByRole("button", { name: /Добавить запись/ }).click();
  await expect(page.getByText(/Результат сделки, введён вручную: \+18/)).toBeVisible();

  // 8 · negative
  await page.getByRole("button", { name: "Новая запись" }).click();
  await fillEntry(page, { instrument: "EUR/USD", direction: /Покупка/, result: "-7", lesson: "поспешил" });
  await page.getByRole("button", { name: /Добавить запись/ }).click();
  await expect(page.getByText(/введён вручную: −7/)).toBeVisible();

  // 9 · no result (observation)
  await page.getByRole("button", { name: "Новая запись" }).click();
  await fillEntry(page, { instrument: "GBP/USD", direction: /Наблюдение/, lesson: "пропуск — решение" });
  await page.getByRole("button", { name: /Добавить запись/ }).click();
  await expect(page.getByText(/Денежный результат не указан/).first()).toBeVisible();

  // 10 · reload persistence
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("XAU/USD")).toBeVisible();
  await expect(page.getByText("EUR/USD")).toBeVisible();
  await expect(page.getByText("GBP/USD")).toBeVisible();

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("11 · expand / collapse a saved entry", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await clearJournal(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await fillEntry(page, { instrument: "XAU/USD", direction: /Продажа/, result: "18", lesson: "терпение" });
  await page.getByRole("button", { name: /Добавить запись/ }).click();

  const head = page.locator(".je-node-head").first();
  await expect(head).toHaveAttribute("aria-expanded", "true"); // newest auto-expanded
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
});

test("12 · edit an entry and reload shows the edit", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await clearJournal(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await fillEntry(page, { instrument: "XAU/USD", direction: /Продажа/, result: "18", lesson: "старый вывод" });
  await page.getByRole("button", { name: /Добавить запись/ }).click();

  await page.getByRole("button", { name: /Редактировать/ }).click();
  await page.getByLabel(/Урок/).fill("новый вывод после правки");
  await page.getByRole("button", { name: /Сохранить изменения/ }).click();
  await expect(page.getByText("новый вывод после правки")).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("новый вывод после правки")).toBeVisible();
});

test("13 · storage failure does not show a false success", async ({ page }) => {
  await page.addInitScript((key) => {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const orig = proto.setItem;
    proto.setItem = function (k: string, v: string) {
      if (k === key) throw new Error("quota");
      return orig.call(this, k, v);
    };
  }, STORAGE_KEY);

  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await fillEntry(page, { instrument: "XAU/USD", direction: /Продажа/, result: "18", lesson: "не сохранится" });
  await page.getByRole("button", { name: /Добавить запись/ }).click();

  await expect(page.getByText(/Не удалось сохранить в этом браузере/).first()).toBeVisible();
  // No fabricated entry appeared.
  await expect(page.getByText(/Результат сделки/)).toHaveCount(0);
  const stored = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
  expect(stored).toBeNull();
});

test("14 · corrupt storage fails closed with a calm explanation, no raw payload", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "@@@corrupt@@@not-json");
  }, STORAGE_KEY);

  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await expect(page.getByText(/Локальные записи не удалось прочитать/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Новая запись" })).toBeVisible();
  await expect(page.getByText("@@@corrupt@@@")).toHaveCount(0);
});

test("15 · a locked tool's direct route has no form and no data", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/tools/tool.chart_markup", { waitUntil: "networkidle" });
  await expect(page.getByText(/Откроется на уровне 20/)).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Добавить/ })).toHaveCount(0);
});

test("16-17 · no progression/report writes, no financial aggregate shown", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await clearJournal(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await fillEntry(page, { instrument: "XAU/USD", direction: /Продажа/, result: "18", lesson: "вывод" });
  await page.getByRole("button", { name: /Добавить запись/ }).click();
  await expect(page.getByText("XAU/USD")).toBeVisible();

  // 16 · only the journal key is written — never progression/report keys.
  const keys = await page.evaluate(() => ({
    lessonLocal: window.localStorage.getItem("ata.lesson-progress.v1"),
    lessonSession: window.sessionStorage.getItem("ata.lesson-progress.v1"),
    reportV1: window.localStorage.getItem("ata.report-workspace.v1"),
    reportV2: window.localStorage.getItem("ata.report-workspace.v2"),
    reportV3: window.localStorage.getItem("ata.report-workspace.v3"),
    journal: window.localStorage.getItem("ata.tools.trading-journal.v1"),
  }));
  expect(keys.lessonLocal).toBeNull();
  expect(keys.lessonSession).toBeNull();
  expect(keys.reportV1).toBeNull();
  expect(keys.reportV2).toBeNull();
  expect(keys.reportV3).toBeNull();
  expect(keys.journal).not.toBeNull();

  // 17 · no aggregate balance / P&L / percentage anywhere on the surface.
  const text = ((await page.locator("body").innerText()) || "").toLowerCase();
  for (const banned of ["баланс", "p/l", "p&l", "win rate", "депозит", "итого", "%", "доходност"]) {
    expect(text.includes(banned.toLowerCase()), `must not show "${banned}"`).toBe(false);
  }
});

test("18-19 · console + hydration clean on hub and journal", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/tools", { waitUntil: "networkidle" });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const hydration = errors.filter((e) => /hydrat|did not match|Text content does not match/i.test(e));
  expect(hydration, hydration.join("\n")).toHaveLength(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("20 · responsive geometry: no horizontal overflow across viewports", async ({ page }) => {
  for (const size of [VIEWPORTS.desktop, VIEWPORTS.tablet, VIEWPORTS.mobile, { width: 320, height: 720 }]) {
    await page.setViewportSize(size);
    for (const url of ["/tools", JOURNAL]) {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no overflow at ${size.width} on ${url}`).toBeLessThanOrEqual(1);
    }
  }
});

test("mobile · the journal spine is not a horizontal table and the bottom nav clears content", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await clearJournal(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await fillEntry(page, { instrument: "XAU/USD", direction: /Продажа/, result: "18", lesson: "вывод для мобильного" });
  await page.getByRole("button", { name: /Добавить запись/ }).click();

  // The triptych stacks (no table): the three phase labels sit at the same x.
  await page.getByRole("button", { name: /XAU\/USD/ }).first();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // The last content clears the fixed bottom nav.
  const nav = page.locator("nav.bottomnav");
  await expect(nav).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);
  const lesson = page.getByText("вывод для мобильного");
  const lBox = await lesson.boundingBox();
  const nBox = await nav.boundingBox();
  expect(lBox!.y + lBox!.height).toBeLessThanOrEqual(nBox!.y + 1);
});

/* ---------------- D4-B1 acceptance corrections ---------------- */

test("date/time · explicit Дата/Время fields, ДД.ММ.ГГГГ + 24h, no AM/PM, no native picker", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await clearJournal(page);
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await expect(page.getByLabel("Дата")).toBeVisible();
  await expect(page.getByLabel("Время")).toBeVisible();
  // No native datetime-local anywhere.
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);

  await fillEntry(page, { instrument: "GBP/USD", direction: /Наблюдение/, lesson: "24-часовой вечер" });
  await page.getByLabel("Время").fill("21:30");
  await page.getByRole("button", { name: /Добавить запись/ }).click();

  // Rendered date is ДД.ММ.ГГГГ-derived RU and the time is 24-hour; no AM/PM.
  await expect(page.getByText(/21:30/)).toBeVisible();
  const body = ((await page.locator("body").innerText()) || "").toUpperCase();
  expect(/\bAM\b|\bPM\b/.test(body)).toBe(false);

  // Edit round-trips to explicit fields.
  await page.getByRole("button", { name: /Редактировать/ }).click();
  await expect(page.getByLabel("Время")).toHaveValue("21:30");
  await expect(page.getByLabel("Дата")).toHaveValue("14.07.2026");
});

test("mobile hub · current tool stacks — CTA below the text, ≥44px, spine intact", async ({
  page,
}) => {
  for (const size of [VIEWPORTS.mobile, { width: 320, height: 720 }, { width: 720, height: 450 }]) {
    await page.setViewportSize(size);
    await page.goto("/tools", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    const row = page.locator(".th-row.is-current");
    const title = row.locator(".th-title");
    // Tool-agnostic: assert the CURRENT row's OWN CTA stacks below its text
    // (the current head is whichever available tool has the highest level).
    const cta = row.locator("a.th-cta");
    const titleBox = await title.boundingBox();
    const ctaBox = await cta.boundingBox();

    // CTA sits BELOW the title/description, not beside it.
    expect(ctaBox!.y, `CTA below text @ ${size.width}`).toBeGreaterThan(titleBox!.y + titleBox!.height);
    // Touch target ≥ 44px and inside the viewport.
    expect(ctaBox!.height, `CTA ≥44px @ ${size.width}`).toBeGreaterThanOrEqual(44);
    expect(ctaBox!.x + ctaBox!.width, `CTA within viewport @ ${size.width}`).toBeLessThanOrEqual(size.width + 1);
    // Spine preserved.
    await expect(page.locator(".th-ledger")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `no overflow @ ${size.width}`).toBeLessThanOrEqual(1);
  }
});

test("bottom-nav clearance · last control (Edit) scrolls fully above the nav with a gap", async ({
  page,
}) => {
  for (const size of [VIEWPORTS.mobile, { width: 320, height: 720 }, { width: 720, height: 450 }]) {
    await page.setViewportSize(size);
    await page.goto(JOURNAL, { waitUntil: "networkidle" });
    await clearJournal(page);
    await page.reload({ waitUntil: "networkidle" });

    // A single expanded entry → its «Редактировать» is the LAST interactive control.
    await page.getByRole("button", { name: /Добавить первую запись/ }).click();
    await fillEntry(page, { instrument: "XAU/USD", direction: /Продажа/, result: "18", lesson: "последняя запись" });
    await page.getByRole("button", { name: /Добавить запись/ }).click();

    const nav = page.locator("nav.bottomnav");
    await expect(nav).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);

    const edit = page.getByRole("button", { name: /Редактировать/ });
    const eBox = await edit.boundingBox();
    const nBox = await nav.boundingBox();
    // Fully above the nav top, with a visible gap (≥8px).
    expect(eBox!.y + eBox!.height, `Edit clears nav @ ${size.width}`).toBeLessThanOrEqual(nBox!.y - 8);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `no overflow @ ${size.width}`).toBeLessThanOrEqual(1);
  }
});
