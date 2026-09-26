import { expect, test } from "@playwright/test";
import { LEADS_E2E } from "../playwright.leads.config";
import {
  collectDisclosureSurface,
  FIXTURES,
  FORBIDDEN_TOKENS,
  leadPath,
  LEADS_PATH,
  signInAdmin,
  signInAnalyst,
  signInUnauthorized,
} from "./support/leads-e2e";

/**
 * AFD-5C2 — the isolated lead journey, in a real browser, against a real
 * backend, on a real migrated database.
 *
 * WHAT THIS PROVES THAT THE UNIT SUITE CANNOT. That the CRM origin actually
 * forwards the three lead routes and nothing else; that a redacted page is
 * redacted in the DOM a browser really builds; that an analyst's reveal attempt
 * is refused BY THE BACKEND and not by a hidden button; that a real reveal
 * writes a real audit row; and that a real reload — a new document, a new
 * JavaScript heap — comes back redacted.
 */

test.describe("analyst — the redacted journey", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signInAnalyst(context, request)).toBe(200);
  });

  test("opens Аффилейты → Лиды and sees a redacted list", async ({ page }) => {
    await page.goto("/affiliates");
    const tabs = page.getByRole("navigation", { name: "Разделы аффилейтов" });
    await expect(tabs.getByRole("link", { name: "Управление" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Аналитика" })).toBeVisible();

    await tabs.getByRole("link", { name: "Лиды" }).click();
    await expect(page).toHaveURL(new RegExp(`${LEADS_PATH}$`));
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();

    // Every seeded lead is listed, masked.
    for (const lead of Object.values(FIXTURES.leads)) {
      await expect(page.getByRole("link", { name: lead.maskedEmail }).first()).toBeVisible();
    }
  });

  test("discloses no full identity, identifier or backend origin", async ({ page }) => {
    await page.goto(LEADS_PATH);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();

    const surface = await collectDisclosureSurface(page);
    for (const token of FORBIDDEN_TOKENS) {
      expect(surface.text).not.toContain(token);
      expect(surface.attributes).not.toContain(token);
      expect(surface.storage).not.toContain(token);
    }
    // The browser never learns the backend origin: the hop is a server-side
    // rewrite through the CRM's own origin.
    expect(surface.text).not.toContain(LEADS_E2E.backendPortToken);
    expect(surface.attributes).not.toContain(LEADS_E2E.backendOrigin);
    // Nothing was written to browser storage at all.
    expect(surface.storage.trim()).toBe("");
  });

  test("filters by attribution, affiliate, stage and deposit state", async ({ page }) => {
    await page.goto(LEADS_PATH);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();

    // Attributed only — the direct lead D disappears.
    await page.getByLabel("Привлечение").selectOption("attributed");
    await expect(page).toHaveURL(/attributionState=attributed/);
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURES.leads.D.maskedEmail })).toHaveCount(0);

    // Direct only — now the mirror image.
    await page.getByLabel("Привлечение").selectOption("unattributed");
    await expect(page).toHaveURL(/attributionState=unattributed/);
    await expect(page.getByRole("link", { name: FIXTURES.leads.D.maskedEmail }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail })).toHaveCount(0);

    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    await expect(page).toHaveURL(new RegExp(`${LEADS_PATH}$`));

    // Affiliate Alpha — A and C, never B (Beta) and never D (direct).
    await page.getByLabel("Аффилейт", { exact: true }).selectOption(FIXTURES.partners.alpha);
    await expect(page).toHaveURL(new RegExp(`affiliatePartnerId=${FIXTURES.partners.alpha}`));
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURES.leads.B.maskedEmail })).toHaveCount(0);

    // The campaign and link selects are scoped to the chosen affiliate.
    await page.getByLabel("Кампания").selectOption(FIXTURES.campaigns.alphaOne);
    await expect(page).toHaveURL(new RegExp(`affiliateCampaignId=${FIXTURES.campaigns.alphaOne}`));
    await page.getByLabel("Ссылка").selectOption(FIXTURES.links.a2);
    await expect(page).toHaveURL(new RegExp(`affiliateTrackingLinkId=${FIXTURES.links.a2}`));
    // Only A was selected on Link Alpha Two.
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURES.leads.C.maskedEmail })).toHaveCount(0);

    // Changing the affiliate clears the campaign and the link.
    await page.getByLabel("Аффилейт", { exact: true }).selectOption(FIXTURES.partners.beta);
    await expect(page).toHaveURL(new RegExp(`affiliatePartnerId=${FIXTURES.partners.beta}`));
    expect(page.url()).not.toContain("affiliateCampaignId");
    expect(page.url()).not.toContain("affiliateTrackingLinkId");

    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    // Wait for the reset to LAND before the next selection: a change computed
    // from the pre-reset state would carry the old affiliate filter with it.
    await expect(page).toHaveURL(new RegExp(`${LEADS_PATH}$`));

    // Journey stage — Academy-only lead E is the one at the floor stage.
    await page.getByLabel("Этап пути").selectOption("academy_registered");
    await expect(page.getByRole("link", { name: FIXTURES.leads.E.maskedEmail }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail })).toHaveCount(0);

    await page.getByLabel("Этап пути").selectOption("first_deposit_confirmed");
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();

    // Deposit state — conflict is C, pending is P.
    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    await expect(page).toHaveURL(new RegExp(`${LEADS_PATH}$`));
    await page.getByLabel("Состояние депозита").selectOption("conflict");
    await expect(page.getByRole("link", { name: FIXTURES.leads.C.maskedEmail }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail })).toHaveCount(0);

    await page.getByLabel("Состояние депозита").selectOption("pending_identity");
    await expect(page.getByRole("link", { name: FIXTURES.leads.P.maskedEmail }).first()).toBeVisible();
  });

  test("offers the archived tracking link as a historical filter", async ({ page }) => {
    await page.goto(`${LEADS_PATH}?affiliatePartnerId=${FIXTURES.partners.beta}`);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();
    const link = page.getByLabel("Ссылка");
    await expect(link.locator("option", { hasText: "в архиве" })).toHaveCount(1);
    // And it still selects the lead acquired through it.
    await link.selectOption(FIXTURES.links.b1);
    await expect(page.getByRole("link", { name: FIXTURES.leads.B.maskedEmail }).first()).toBeVisible();
  });

  test("applies the two periods independently and both together", async ({ page }) => {
    // Registration in March 2026 selects A alone.
    await page.goto(
      `${LEADS_PATH}?registrationPreset=custom&registrationStartDate=2026-03-01&registrationEndDate=2026-04-01`,
    );
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURES.leads.E.maskedEmail })).toHaveCount(0);
    // The backend's own resolution is displayed, in Europe/Moscow.
    await expect(page.getByText(/Сервер применил/).first()).toBeVisible();
    await expect(page.getByText(/Europe\/Moscow/).first()).toBeVisible();

    // An acquisition window that excludes A's selected click (March 9) removes it
    // even though its REGISTRATION is inside the registration window.
    await page.goto(
      `${LEADS_PATH}?registrationPreset=custom&registrationStartDate=2026-03-01&registrationEndDate=2026-04-01` +
        `&acquisitionPreset=custom&acquisitionStartDate=2026-01-01&acquisitionEndDate=2026-03-05`,
    );
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail })).toHaveCount(0);
    await expect(page.getByText("По выбранным фильтрам ничего не найдено")).toBeVisible();

    // Widening the acquisition window to include March 9 brings it back —
    // proving both predicates really applied.
    await page.goto(
      `${LEADS_PATH}?registrationPreset=custom&registrationStartDate=2026-03-01&registrationEndDate=2026-04-01` +
        `&acquisitionPreset=custom&acquisitionStartDate=2026-01-01&acquisitionEndDate=2026-03-20`,
    );
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
  });

  test("pages with the backend cursor and returns with browser history", async ({ page }) => {
    await page.goto(`${LEADS_PATH}?pageSize=3`);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();
    await expect(page.getByText("Страница 1, показано лидов: 3")).toBeVisible();

    const firstPage = await page.getByRole("table").locator("tbody tr").allInnerTexts();

    await page.getByRole("button", { name: "Следующая страница" }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(page.getByText("Страница 2, показано лидов: 3")).toBeVisible();
    // The page LABEL updates as soon as the URL does, while the previous rows
    // deliberately stay on screen through the refresh. Waiting for a row that
    // only page two contains is what actually proves the new page arrived.
    await expect(
      page.getByRole("link", { name: FIXTURES.leads.P.maskedEmail }),
    ).toHaveCount(0);
    const secondPage = await page.getByRole("table").locator("tbody tr").allInnerTexts();

    // No duplicates and no overlap between consecutive pages.
    for (const row of secondPage) expect(firstPage).not.toContain(row);

    // Browser BACK restores the first page from the URL alone.
    await page.goBack();
    await expect(page).not.toHaveURL(/cursor=/);
    await expect(page.getByText("Страница 1, показано лидов: 3")).toBeVisible();
    await expect(
      page.getByRole("link", { name: FIXTURES.leads.P.maskedEmail }).first(),
    ).toBeVisible();
    expect(await page.getByRole("table").locator("tbody tr").allInnerTexts()).toEqual(firstPage);
  });

  test("recovers from a tampered cursor instead of dead-ending", async ({ page }) => {
    await page.goto(`${LEADS_PATH}?cursor=dGFtcGVyZWQ`);
    await expect(
      page.getByText(/Ссылка на страницу устарела или не соответствует текущим фильтрам/),
    ).toBeVisible();
    // Repaired back to page one of the same query.
    await expect(page).not.toHaveURL(/cursor=/);
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
  });

  test("opens lead A redacted, with a factual timeline and no reveal action", async ({ page }) => {
    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await expect(
      page.getByRole("heading", { name: FIXTURES.leads.A.maskedEmail, level: 1 }),
    ).toBeVisible();

    // Acquisition, from the frozen record.
    await expect(page.getByText("Первый контакт", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Последний контакт", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Выбранный контакт", { exact: true })).toBeVisible();
    await expect(page.getByText("Affiliate Alpha (alpha)")).toBeVisible();
    await expect(page.getByText(/не пересчитываются и не редактируются/)).toBeVisible();

    // The timeline is a real ordered list, in the backend's order.
    const timeline = page.getByRole("list", { name: "Фактическая хронология" });
    await expect(timeline).toBeVisible();
    const events = await timeline.locator("li").allInnerTexts();
    const index = (needle: string) => events.findIndex((event) => event.includes(needle));
    expect(index("Первый контакт")).toBeGreaterThanOrEqual(0);
    expect(index("Регистрация в Академии")).toBeGreaterThan(index("Первый контакт"));
    expect(index("Регистрация в Pocket")).toBeGreaterThan(index("Регистрация в Академии"));
    expect(index("Первый депозит подтверждён")).toBeGreaterThan(index("Регистрация в Pocket"));

    // Unavailable capabilities are named with a reason, never as a zero.
    await expect(page.getByText(/Pocket не передаёт идентификатор транзакции/)).toBeVisible();
    await expect(page.getByText(/Официального API баланса у Pocket нет/)).toBeVisible();
    await expect(
      page.getByText(/Достоверных продуктовых событий обучения пока не существует/),
    ).toBeVisible();

    // No reveal for an analyst, and the reason is stated.
    await expect(page.getByRole("button", { name: "Показать данные пользователя" })).toHaveCount(0);
    await expect(page.getByText(/Доступ к аналитике аффилейтов его не даёт/)).toBeVisible();

    const surface = await collectDisclosureSurface(page);
    for (const token of FORBIDDEN_TOKENS) {
      expect(surface.text).not.toContain(token);
      expect(surface.attributes).not.toContain(token);
    }
  });

  test("is refused by the BACKEND when it invokes the reveal route directly", async ({
    page,
  }) => {
    // Not a hidden button: the route itself refuses an analyst. `page.request`
    // shares the BROWSER context cookie jar, so this is the same authenticated
    // session the UI is using — a bare `request` fixture would be anonymous and
    // would prove only that an unauthenticated caller is refused.
    const request = page.request;
    const csrf = await request.get(`${LEADS_E2E.baseURL}/api/crm/auth/csrf`);
    expect(csrf.ok()).toBe(true);
    const token = ((await csrf.json()) as { csrfToken: string }).csrfToken;

    const reply = await request.post(
      `${LEADS_E2E.baseURL}/api/crm/v1/affiliates/leads/${FIXTURES.leads.A.leadId}/reveal`,
      { headers: { "x-csrf-token": token } },
    );
    expect(reply.status()).toBe(403);
    const body = await reply.text();
    // No lead content escapes with the refusal.
    for (const email of Object.values(FIXTURES.leads).map((lead) => lead.email)) {
      expect(body).not.toContain(email);
    }
  });

  test("shows each journey shape truthfully", async ({ page }) => {
    // B — pending arrival then reconciliation: BOTH steps, because the stored
    // timestamps genuinely disagree.
    await page.goto(leadPath(FIXTURES.leads.B.leadId));
    await expect(page.getByText("FD получен до подтверждения личности")).toBeVisible();
    await expect(page.getByText("Первый депозит подтверждён").first()).toBeVisible();

    // C — a conflict that does not claim the Academy account failed.
    await page.goto(leadPath(FIXTURES.leads.C.leadId));
    await expect(page.getByText("Обнаружен конфликт FD")).toBeVisible();
    await expect(page.getByText("Расхождение владельца Pocket-аккаунта")).toBeVisible();
    await expect(
      page.getByText(/не признак проблемы с аккаунтом учащегося в Академии/),
    ).toBeVisible();

    // D — direct, with a real deposit and no synthetic affiliate.
    await page.goto(leadPath(FIXTURES.leads.D.leadId));
    await expect(page.getByText(/Аффилейт не назначается/)).toBeVisible();
    await expect(page.getByText("Affiliate Alpha (alpha)")).toHaveCount(0);
    await expect(page.getByText("Первый депозит подтверждён").first()).toBeVisible();

    // E — Academy only. No Pocket step is invented.
    await page.goto(leadPath(FIXTURES.leads.E.leadId));
    const eTimeline = page.getByRole("list", { name: "Фактическая хронология" });
    await expect(eTimeline).toBeVisible();
    const eEvents = await eTimeline.locator("li").allInnerTexts();
    expect(eEvents.some((event) => event.includes("Регистрация в Академии"))).toBe(true);
    expect(eEvents.some((event) => event.includes("Регистрация в Pocket"))).toBe(false);
    await expect(page.getByText("Депозит не зафиксирован").first()).toBeVisible();

    // F — Pocket registered, no deposit.
    await page.goto(leadPath(FIXTURES.leads.F.leadId));
    const fTimeline = page.getByRole("list", { name: "Фактическая хронология" });
    await expect(fTimeline).toBeVisible();
    const fEvents = await fTimeline.locator("li").allInnerTexts();
    expect(fEvents.some((event) => event.includes("Регистрация в Pocket"))).toBe(true);
    expect(fEvents.some((event) => event.includes("депозит"))).toBe(false);

    // G — the integrity finding, reported separately from the events.
    await page.goto(leadPath(FIXTURES.leads.G.leadId));
    await expect(page.getByRole("heading", { name: "Замечания к целостности данных" })).toBeVisible();
    await expect(
      page.getByText(/Несколько событий регистрации в Академии указывают на этого учащегося/),
    ).toBeVisible();

    // P — pending, and NEVER worded as a confirmation.
    await page.goto(leadPath(FIXTURES.leads.P.leadId));
    await expect(page.getByText("Ожидает подтверждения Pocket-пользователя").first()).toBeVisible();
    await expect(page.getByText("Первый депозит подтверждён")).toHaveCount(0);
  });

  test("merges first, last and selected touch on one click into one event", async ({ page }) => {
    // Lead C has ONE click carrying all three roles.
    await page.goto(leadPath(FIXTURES.leads.C.leadId));
    const cTimeline = page.getByRole("list", { name: "Фактическая хронология" });
    await expect(cTimeline).toBeVisible();
    const events = await cTimeline.locator("li").allInnerTexts();
    const acquisition = events.filter((event) => event.includes("контакт"));
    expect(acquisition).toHaveLength(1);
    expect(acquisition[0]).toContain("первый контакт");
    expect(acquisition[0]).toContain("выбранный для атрибуции");
  });
});

/* ------------------------------------------------------------- crm_admin */

test.describe("crm_admin — the audited reveal", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signInAdmin(context, request)).toBe(200);
  });

  test("opens a lead redacted and reveals only after confirming", async ({ page }) => {
    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await expect(
      page.getByRole("heading", { name: FIXTURES.leads.A.maskedEmail, level: 1 }),
    ).toBeVisible();

    // REDACTED BY DEFAULT, even for an administrator holding reveal_pii.
    let surface = await collectDisclosureSurface(page);
    expect(surface.text).not.toContain(FIXTURES.leads.A.email);

    // Cancelling issues no request and discloses nothing.
    await page.getByRole("button", { name: "Показать данные пользователя" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/только этого одного лида/)).toBeVisible();
    await expect(dialog.getByText(/записывается в журнал аудита/)).toBeVisible();
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    surface = await collectDisclosureSurface(page);
    expect(surface.text).not.toContain(FIXTURES.leads.A.email);

    // Confirming reveals exactly this lead.
    await page.getByRole("button", { name: "Показать данные пользователя" }).click();
    await page.getByRole("button", { name: "Показать данные", exact: true }).click();

    await expect(page.getByText(FIXTURES.leads.A.email)).toBeVisible();
    await expect(page.getByText(FIXTURES.leads.A.name)).toBeVisible();
    await expect(page.getByText(/записан в журнал аудита/)).toBeVisible();

    // The revealed identity is in the DOM and in NOTHING else.
    surface = await collectDisclosureSurface(page);
    expect(surface.text).toContain(FIXTURES.leads.A.email);
    expect(surface.attributes).not.toContain(FIXTURES.leads.A.email);
    expect(surface.storage).not.toContain(FIXTURES.leads.A.email);
    expect(surface.url).not.toContain(FIXTURES.leads.A.email);
    expect(surface.storage.trim()).toBe("");
    // And no OTHER learner was disclosed with it.
    for (const lead of Object.values(FIXTURES.leads)) {
      if (lead.leadId === FIXTURES.leads.A.leadId) continue;
      expect(surface.text).not.toContain(lead.email);
    }
  });

  test("clears the revealed identity on close, lead change, back and reload", async ({ page }) => {
    const reveal = async () => {
      await page.getByRole("button", { name: "Показать данные пользователя" }).click();
      await page.getByRole("button", { name: "Показать данные", exact: true }).click();
      await expect(page.getByText(FIXTURES.leads.A.email)).toBeVisible();
    };

    // CLOSE
    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await reveal();
    await page.getByRole("button", { name: "Скрыть данные пользователя" }).click();
    await expect(page.getByText(FIXTURES.leads.A.email)).toHaveCount(0);
    expect((await collectDisclosureSurface(page)).text).not.toContain(FIXTURES.leads.A.email);

    // LEAD CHANGE
    await reveal();
    await page.goto(leadPath(FIXTURES.leads.B.leadId));
    await expect(
      page.getByRole("heading", { name: FIXTURES.leads.B.maskedEmail, level: 1 }),
    ).toBeVisible();
    expect((await collectDisclosureSurface(page)).text).not.toContain(FIXTURES.leads.A.email);

    // BROWSER BACK — the previous route is restored REDACTED, never with the
    // identity that was on screen when it was left.
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: FIXTURES.leads.A.maskedEmail, level: 1 }),
    ).toBeVisible();
    expect((await collectDisclosureSurface(page)).text).not.toContain(FIXTURES.leads.A.email);

    // RELOAD — a new document and a new heap.
    await reveal();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: FIXTURES.leads.A.maskedEmail, level: 1 }),
    ).toBeVisible();
    expect((await collectDisclosureSurface(page)).text).not.toContain(FIXTURES.leads.A.email);

    // ROUTE CHANGE to the list, then back into the lead.
    await reveal();
    await page.goto(LEADS_PATH);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();
    const listSurface = await collectDisclosureSurface(page);
    for (const lead of Object.values(FIXTURES.leads)) {
      expect(listSurface.text).not.toContain(lead.email);
    }
  });

  test("clears the revealed identity on logout", async ({ page }) => {
    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await page.getByRole("button", { name: "Показать данные пользователя" }).click();
    await page.getByRole("button", { name: "Показать данные", exact: true }).click();
    await expect(page.getByText(FIXTURES.leads.A.email)).toBeVisible();

    await page.getByRole("button", { name: "Выйти" }).click();
    await page.waitForURL(/\/login/);
    const surface = await collectDisclosureSurface(page);
    expect(surface.text).not.toContain(FIXTURES.leads.A.email);
    expect(surface.storage).not.toContain(FIXTURES.leads.A.email);
  });

  test("keeps the reveal to one lead and offers no bulk or export affordance", async ({ page }) => {
    await page.goto(LEADS_PATH);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();

    // Nothing in the LIST can reveal anything.
    await expect(page.getByRole("button", { name: "Показать данные пользователя" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    for (const name of [/экспорт/i, /csv/i, /выгруз/i, /скачать/i, /выбрать все/i]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }

    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await page.getByRole("button", { name: "Показать данные пользователя" }).click();
    await page.getByRole("button", { name: "Показать данные", exact: true }).click();
    await expect(page.getByText(FIXTURES.leads.A.email)).toBeVisible();

    const panel = page.getByRole("region", { name: "Данные пользователя" });
    for (const name of [/скопировать/i, /копир/i, /экспорт/i, /скачать/i]) {
      await expect(panel.getByRole("button", { name })).toHaveCount(0);
    }
  });
});

/* --------------------------------------------------------- unauthorized */

test.describe("unauthorized staff", () => {
  test("is denied the lead list, the lead route and the backend", async ({
    context,
    request,
    page,
  }) => {
    expect(await signInUnauthorized(context, request)).toBe(200);
    // `page.request` shares the browser cookie jar, so these probes carry the same
    // authenticated staff session the UI does.
    const api = page.request;

    await page.goto("/users");
    // The affiliate section is not advertised at all.
    const nav = page.getByRole("navigation", { name: "Разделы CRM" });
    await expect(nav.getByRole("link", { name: "Аффилейты" })).toHaveCount(0);

    await page.goto(LEADS_PATH);
    await expect(page.getByText("Раздел недоступен")).toBeVisible();

    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await expect(page.getByText("Раздел недоступен")).toBeVisible();

    // And the backend refuses independently of what was rendered.
    const list = await api.get(`${LEADS_E2E.baseURL}/api/crm/v1/affiliates/leads`);
    expect(list.status()).toBe(403);
    const detail = await api.get(
      `${LEADS_E2E.baseURL}/api/crm/v1/affiliates/leads/${FIXTURES.leads.A.leadId}`,
    );
    expect(detail.status()).toBe(403);
    for (const lead of Object.values(FIXTURES.leads)) {
      expect(await detail.text()).not.toContain(lead.email);
    }
  });
});
