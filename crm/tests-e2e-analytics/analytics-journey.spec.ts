import { test, expect } from "@playwright/test";
import { ANALYTICS_E2E } from "../playwright.analytics.config";
import {
  ANALYTICS_PATH,
  chooseOption,
  CREDENTIALS,
  hasHorizontalOverflow,
  selectByText,
  signIn,
  trackPageErrors,
  trackRequests,
  waitForAnalytics,
} from "./support/analytics-e2e";

/**
 * AFD-5C1 — the isolated analytics journey, in a real browser against a real
 * backend serving a real migrated database.
 *
 * Everything asserted here is end to end: the numbers on screen were computed by
 * the backend from seeded rows, carried over the same-origin rewrite, parsed by
 * the strict contracts and rendered by the workspace. A regression anywhere in
 * that chain fails here.
 */

test.describe("analyst journey", () => {
  test.beforeEach(async ({ context, request }) => {
    const status = await signIn(context, request, CREDENTIALS.analyst);
    expect(status).toBe(200);
  });

  test("reaches analytics through the affiliate workspace", async ({ page }) => {
    await page.goto("/affiliates");
    await page.getByRole("heading", { name: "Аффилейты" }).waitFor();

    await page.getByRole("link", { name: "Аналитика" }).click();
    await expect(page).toHaveURL(new RegExp(`${ANALYTICS_PATH}$`));
    await waitForAnalytics(page);
  });

  test("opens in event-date mode with the resolved Moscow period", async ({ page }) => {
    await page.goto(ANALYTICS_PATH);
    await waitForAnalytics(page);

    await expect(page.getByRole("radio", { name: /По дате события/ })).toBeChecked();
    await expect(page.getByText("Показатели периода")).toBeVisible();
    await expect(page.getByText(/Europe\/Moscow/).first()).toBeVisible();
    await expect(page.getByText(/неделя с понедельника/).first()).toBeVisible();
  });

  test("shows event-date counts computed by the backend", async ({ page }) => {
    // `all_time` guarantees the seeded fixture window is inside the period.
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    // Scoped to the SUMMARY section on purpose. Every metric label also appears
    // as a chart-series checkbox, so asserting on labels page-wide would pass
    // even when the summary failed to load and rendered an error instead.
    const summary = page.getByRole("region", { name: "Сводка" });
    await expect(summary.getByText("Показатели периода")).toBeVisible();
    for (const label of [
      "Квалифицированные клики",
      "Регистрации в Академии",
      "FD в ожидании идентификации",
      "FD с конфликтом",
    ]) {
      await expect(summary.getByText(label).first()).toBeVisible();
    }
    // The seeded fixture produced real traffic, so the headline count is not
    // merely present but non-zero.
    await expect(
      summary.getByRole("heading", { name: "Соотношения событий периода" }),
    ).toBeVisible();
  });

  test("labels ratios as period event ratios, never as cohort conversion", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    await expect(
      page.getByRole("heading", { name: "Соотношения событий периода" }),
    ).toBeVisible();
    await expect(page.getByText(/не вероятность конверсии клика/)).toBeVisible();
    await expect(page.getByText(/Знаменатель:/).first()).toBeVisible();
  });

  test("moves through every preset without breaking", async ({ page }) => {
    for (const preset of [
      "today",
      "yesterday",
      "current_week",
      "previous_week",
      "last_7_days",
      "last_30_days",
      "current_month",
      "previous_month",
      "all_time",
    ]) {
      await page.goto(`${ANALYTICS_PATH}?preset=${preset}`);
      await waitForAnalytics(page);
      await expect(page.getByRole("heading", { name: "Сводка" })).toBeVisible();
    }
  });

  test("accepts a custom range and preserves it in the URL", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=custom&startDate=2026-06-01&endDate=2026-08-01`);
    await waitForAnalytics(page);

    await expect(page.getByLabel("Начало (включительно)")).toHaveValue("2026-06-01");
    await expect(page.getByLabel("Конец (не включая)")).toHaveValue("2026-08-01");
    await expect(page.getByText("Показатели периода")).toBeVisible();
  });

  test("switches day, week and month grouping", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    for (const [value, label] of [
      ["week", "По неделям"],
      ["month", "По месяцам"],
      ["day", "По дням"],
    ] as const) {
      await page.getByLabel("Группировка").selectOption(value);
      await expect(page).toHaveURL(
        value === "day" ? new RegExp(`${ANALYTICS_PATH}\\?`) : new RegExp(`group=${value}`),
      );
      await expect(page.getByLabel("Группировка")).toHaveValue(value);
      expect(label).toBeTruthy();
    }
  });

  test("filters by affiliate, campaign and tracking link", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    await selectByText(page, "Аффилейт", "Affiliate Alpha");
    await expect(page).toHaveURL(/affiliatePartnerId=/);

    await selectByText(page, "Кампания", "Campaign Alpha One");
    await expect(page).toHaveURL(/affiliateCampaignId=/);

    await selectByText(page, "Ссылка", "Link Alpha One");
    await expect(page).toHaveURL(/affiliateTrackingLinkId=/);

    await waitForAnalytics(page);
    await expect(page.getByText(/только совпадающие записи с атрибуцией/).first()).toBeVisible();
  });

  test("clears incompatible children when the affiliate changes", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    await selectByText(page, "Аффилейт", "Affiliate Alpha");
    await selectByText(page, "Кампания", "Campaign Alpha One");
    await expect(page).toHaveURL(/affiliateCampaignId=/);

    await selectByText(page, "Аффилейт", "Affiliate Beta");
    // The campaign belonged to Alpha; carrying it would be a hierarchy mismatch.
    await expect(page).not.toHaveURL(/affiliateCampaignId=/);
  });

  test("offers archived dimensions as selectable history", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);
    const options = await page.getByLabel("Аффилейт", { exact: true }).locator("option").allTextContents();
    expect(options.some((option) => option.includes("в архиве"))).toBe(true);
  });

  test("shows total, attributed and unattributed coverage", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    await expect(page.getByRole("radio", { name: "Всего" })).toBeEnabled();
    await chooseOption(page, "Охват атрибуции", "Без атрибуции");
    await expect(page).toHaveURL(/coverage=unattributed/);
    await expect(page.getByText(/отчётная категория, а не аффилейт/)).toBeVisible();
  });

  test("renders the event-date chart from backend buckets", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time&group=month`);
    await waitForAnalytics(page);

    const chart = page.getByRole("group", { name: /Динамика событий/ });
    await expect(chart).toBeVisible();
    await expect(page.getByRole("list", { name: "Обозначения графика" }).first()).toBeVisible();
    // Scoped to the chart section: that is where the caveat belongs, beside
    // the two numbers it compares.
    await expect(
      page
        .getByRole("region", { name: "Динамика событий" })
        .getByText(/не равны сумме значений по столбцам графика/),
    ).toBeVisible();
  });

  test("exposes chart values by keyboard and as a table", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time&group=month`);
    await waitForAnalytics(page);

    const chart = page.getByRole("group", { name: /Динамика событий/ });
    await chart.focus();
    await expect(chart).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Home");

    await page.getByRole("button", { name: "Показать таблицу" }).first().click();
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("breaks down by affiliate, campaign and link", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    await expect(page.getByRole("heading", { name: "Детализация" })).toBeVisible();

    await chooseOption(page, "Разрез детализации", "Кампании");
    await expect(page).toHaveURL(/dimension=campaign/);
    await waitForAnalytics(page);

    await chooseOption(page, "Разрез детализации", "Ссылки");
    await expect(page).toHaveURL(/dimension=tracking_link/);
    await waitForAnalytics(page);
    await expect(page.getByRole("heading", { name: "Детализация" })).toBeVisible();
  });

  test("shows an FD total only with an explicit currency", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    const body = await page.locator("body").innerText();
    // The seeded fixture mixes currencies over all time, so the aggregate is
    // withheld. Whichever branch is taken, USD must never be assumed.
    const hasTotal = /Сумма первых депозитов[\s\S]{0,80}(USD|EUR)/.test(body);
    const withheld = body.includes("валюта не указана или в периоде несколько валют");
    expect(hasTotal || withheld).toBe(true);
  });

  test("shows unavailable capabilities as reasons, not as zeroes", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    await expect(page.getByText("Доступность данных")).toBeVisible();
    await expect(page.getByText("Повторные депозиты")).toBeVisible();
    await expect(page.getByText("Текущий баланс")).toBeVisible();
    await expect(page.getByText(/интерфейс появится в следующей фазе/)).toBeVisible();
  });
});

/* ------------------------------------------------------------- cohort mode */

test.describe("cohort mode", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.analyst)).toBe(200);
  });

  test("switches to cohort mode and states its anchor", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    await chooseOption(page, "Режим отчёта", "По когорте привлечения");
    await expect(page).toHaveURL(/mode=acquisition_cohort/);
    await waitForAnalytics(page);

    await expect(page.getByRole("heading", { name: "Когорта привлечения" })).toBeVisible();
    await expect(
      page.getByText(
        /Когорта сформирована по выбранному атрибуционному клику уже зарегистрированных пользователей/,
      ),
    ).toBeVisible();
    await expect(page.getByText("Выбранный атрибуционный клик")).toBeVisible();
  });

  test("uses cohort wording, never event-date ratio wording", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time`);
    await waitForAnalytics(page);

    await expect(page.getByRole("heading", { name: "Конверсия когорты" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Соотношения событий периода" }),
    ).toHaveCount(0);
  });

  test("shows cohort rates, medians and sample sizes", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time`);
    await waitForAnalytics(page);

    await expect(page.getByText("Дошли до Pocket").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Медианные задержки" })).toBeVisible();
    await expect(page.getByText(/наблюден/).first()).toBeVisible();
  });

  test("applies an observation cutoff and keeps it separate from the period", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time`);
    await waitForAnalytics(page);

    await page.getByLabel("Отсечка наблюдения").fill("2026-07-02");
    await page
      .getByRole("button", { name: "Применить" })
      .last()
      .click();

    await expect(page).toHaveURL(/cutoffDate=2026-07-02/);
    // The period control is untouched by the cutoff.
    await expect(page).toHaveURL(/preset=all_time/);
    await waitForAnalytics(page);
    await expect(page.getByText(/Действующая отсечка/)).toBeVisible();
  });

  test("rejects a future cutoff through the backend contract", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time&cutoffDate=2099-01-01`);
    await page.getByRole("heading", { name: "Аналитика аффилейтов" }).waitFor();
    // Rendered once per section (summary, chart, breakdown): each failed
    // independently and each says so, which is the intended behaviour.
    await expect(page.getByText(/Дата отсечки не может быть в будущем/).first()).toBeVisible();
  });

  test("shows the follow-up window without scoring maturity", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time`);
    await waitForAnalytics(page);

    await expect(page.getByRole("heading", { name: "Окно наблюдения" })).toBeVisible();
    await expect(page.getByText("Минимальное наблюдение")).toBeVisible();
    await expect(page.getByText(/не оценка зрелости когорты/)).toBeVisible();
  });

  test("states the direct and anonymous-visitor boundaries", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time`);
    await waitForAnalytics(page);

    await expect(
      page.getByText(/Прямые регистрации без атрибуционного клика в когорту не входят/),
    ).toBeVisible();
    await expect(
      page.getByText(/Конверсия анонимного посетителя в регистрацию не измеряется/),
    ).toBeVisible();
  });

  test("draws counts and rates on separate scales", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time&group=month`);
    await waitForAnalytics(page);

    await expect(page.getByRole("group", { name: /Численность когорт/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /Конверсия когорт/ })).toBeVisible();
    await expect(page.getByText(/шкала 0–100 %/)).toBeVisible();
  });
});

/* ----------------------------------------------------------------- URL state */

test.describe("shareable URL state", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.analyst)).toBe(200);
  });

  test("restores the whole state from a reloaded link", async ({ page }) => {
    const url =
      `${ANALYTICS_PATH}?mode=acquisition_cohort&preset=custom&startDate=2026-06-01` +
      `&endDate=2026-08-01&cutoffDate=2026-07-10&group=week&dimension=campaign`;
    await page.goto(url);
    await waitForAnalytics(page);
    await page.reload();
    await waitForAnalytics(page);

    await expect(page.getByRole("radio", { name: /По когорте привлечения/ })).toBeChecked();
    await expect(page.getByLabel("Группировка")).toHaveValue("week");
    await expect(page.getByLabel("Отсечка наблюдения")).toHaveValue("2026-07-10");
    await expect(page.getByRole("radio", { name: "Кампании" })).toBeChecked();
  });

  test("restores state through browser back and forward", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    await page.getByLabel("Группировка").selectOption("month");
    await expect(page).toHaveURL(/group=month/);
    await waitForAnalytics(page);

    await page.goBack();
    await expect(page).not.toHaveURL(/group=month/);
    await expect(page.getByLabel("Группировка")).toHaveValue("day");

    await page.goForward();
    await expect(page).toHaveURL(/group=month/);
    await expect(page.getByLabel("Группировка")).toHaveValue("month");
  });

  test("normalises a hostile URL instead of failing", async ({ page }) => {
    await page.goto(
      `${ANALYTICS_PATH}?mode=magic&preset=fortnight&group=hour&offset=-5&leadId=42&token=secret`,
    );
    await waitForAnalytics(page);

    await expect(page.getByRole("radio", { name: /По дате события/ })).toBeChecked();
    await expect(page.getByLabel("Группировка")).toHaveValue("day");
  });

  test("carries no identifier or token in a shared link", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);
    await selectByText(page, "Аффилейт", "Affiliate Alpha");
    await expect(page).toHaveURL(/affiliatePartnerId=/);

    const url = page.url().toLowerCase();
    for (const forbidden of ["token", "email", "leadid", "pocket", "clickid", "visitor", "session"]) {
      expect(url).not.toContain(forbidden);
    }
  });
});

/* --------------------------------------------------------------- permissions */

test.describe("permissions", () => {
  test("crm_admin sees analytics and keeps management", async ({ page, context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.admin)).toBe(200);

    await page.goto(ANALYTICS_PATH);
    await waitForAnalytics(page);
    await expect(page.getByRole("heading", { name: "Сводка" })).toBeVisible();

    await page.goto("/affiliates");
    await expect(page.getByRole("heading", { name: "Аффилейты" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Новый аффилейт" })).toBeVisible();
  });

  test("exposes no PII reveal control to crm_admin", async ({ page, context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.admin)).toBe(200);
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);
    await expect(page.getByRole("button", { name: /раскрыть|reveal/i })).toHaveCount(0);
  });

  test("denies staff holding neither permission", async ({ page, context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.unauthorized)).toBe(200);
    await page.goto(ANALYTICS_PATH);
    await expect(page.getByText("Недостаточно прав")).toBeVisible();
  });

  test("refuses a learner with no StaffProfile", async ({ context, request }) => {
    // The CRM session itself is refused: this account is not staff at all.
    const status = await signIn(context, request, CREDENTIALS.learner);
    expect(status).not.toBe(200);
  });

  test("the backend answers 403 regardless of what the UI rendered", async ({
    page,
    context,
    request,
  }) => {
    expect(await signIn(context, request, CREDENTIALS.unauthorized)).toBe(200);

    // `page.request` shares the BROWSER context's cookies, which is where the
    // session was installed. The bare `request` fixture has its own jar and
    // would send an anonymous 401 instead — a weaker assertion that would pass
    // even if the permission check were missing.
    const response = await page.request.get(
      `${ANALYTICS_E2E.baseURL}/api/crm/v1/affiliates/analytics/summary?preset=today`,
    );
    expect(response.status()).toBe(403);
  });
});

/* ------------------------------------------------------------ safety proofs */

test.describe("security and privacy", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.analyst)).toBe(200);
  });

  test("calls no lead, reveal or timeline endpoint", async ({ page }) => {
    const urls = trackRequests(page);
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);
    await chooseOption(page, "Режим отчёта", "По когорте привлечения");
    await waitForAnalytics(page);

    const leadCalls = urls.filter(
      (url) => url.includes("/affiliates/leads") || url.includes("/reveal"),
    );
    expect(leadCalls).toEqual([]);
  });

  test("never reveals the backend origin to the browser", async ({ page }) => {
    const urls = trackRequests(page);
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    const token = ANALYTICS_E2E.backendPortToken;
    expect(urls.filter((url) => url.includes(`:${token}`))).toEqual([]);
    const html = await page.content();
    expect(html).not.toContain(`:${token}`);
  });

  test("paints no learner identity or provider identifier", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);
    const html = (await page.content()).toLowerCase();

    for (const forbidden of [
      "@example.invalid",
      "ataclickid",
      "anonymousvisitorid",
      "pocketplayerid",
      "pocketclickid",
      "postback_secret",
      "session_secret",
      "passwordhash",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  test("responses are private and never stored", async ({ page }) => {
    const headers: Record<string, string>[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/affiliates/analytics/")) headers.push(response.headers());
    });
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);

    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      // `no-store` is the load-bearing directive and it survives the hop: it
      // forbids ANY cache — shared or private — from storing the response.
      //
      // The backend emits `private, no-store`; what the browser receives from
      // the CRM origin is `no-store, must-revalidate`, because the Next rewrite
      // normalises the header. That is not a weakening — `no-store` subsumes
      // `private` — but it is why this asserts the directive that matters
      // rather than the backend's exact string.
      expect(header["cache-control"]).toContain("no-store");
    }
  });

  test("logs no uncaught page error across a full journey", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);
    await chooseOption(page, "Режим отчёта", "По когорте привлечения");
    await waitForAnalytics(page);
    await page.getByLabel("Группировка").selectOption("month");
    await waitForAnalytics(page);
    expect(errors).toEqual([]);
  });

  test("does not overflow the page horizontally on the default desktop width", async ({ page }) => {
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
