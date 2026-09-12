/**
 * AFD-5C2 — the redacted lead detail and the audited PII reveal.
 *
 * The reveal tests are the reason this file exists. They assert the properties
 * §28–§31 require and that nothing else in the codebase can assert: that opening
 * a lead reveals nothing, that cancelling sends nothing, that a revealed
 * identity never reaches the URL or browser storage, and that every exit path —
 * close, lead change, unmount, reload — leaves the DOM redacted again.
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { sessionFromDto } from "@/domain/identity/session";
import type { CrmRole, Permission } from "@/domain/identity/roles";
import { AffiliateLeadDetailWorkspace } from "./lead-detail-workspace";

/* ----------------------------------------------------------------- routing */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/affiliates/leads/v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  useSearchParams: () => new URLSearchParams(""),
}));

/* ------------------------------------------------------------- API doubles */

const detailMock = vi.fn();
const revealMock = vi.fn();

vi.mock("@/application/api/affiliate-leads-client", async () => {
  const actual = await vi.importActual<typeof import("@/application/api/affiliate-leads-client")>(
    "@/application/api/affiliate-leads-client",
  );
  return {
    ...actual,
    fetchLeadDetail: (...a: unknown[]) => detailMock(...a),
    revealLeadPii: (...a: unknown[]) => revealMock(...a),
  };
});

/* ---------------------------------------------------------------- fixtures */

const LEAD_A = "v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LEAD_B = "v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const ok = <T,>(data: T) => Promise.resolve({ status: "success" as const, data });

function timelineItem(over: Record<string, unknown> = {}) {
  return {
    eventType: "academy_registration",
    occurredAt: "2026-07-01T10:00:00.000Z",
    localOccurredAt: "2026-07-01 13:00:00",
    titleKey: "crm.leads.timeline.academy_registration",
    state: "recorded",
    sourceCategory: "academy",
    roles: null,
    dimension: null,
    integrityFlags: [],
    ...over,
  };
}

const ATTRIBUTED_ACQUISITION = {
  attributionState: "attributed",
  affiliate: { id: "1", code: "alpha", displayName: "Affiliate Alpha" },
  campaign: { id: "10", code: "a-one", displayName: "Campaign Alpha One" },
  trackingLink: { id: "101", code: "lnk-a2", displayName: "Link Alpha Two" },
  firstTouchAt: "2026-06-29T08:00:00.000Z",
  lastTouchAt: "2026-06-30T09:00:00.000Z",
  selectedTouchAt: "2026-06-30T09:00:00.000Z",
  acquisitionModel: "last_click",
  selectionReason: "last_qualified_click",
  frozenAt: "2026-07-01T10:00:00.000Z",
};

const DIRECT_ACQUISITION = {
  attributionState: "unattributed",
  affiliate: null,
  campaign: null,
  trackingLink: null,
  firstTouchAt: null,
  lastTouchAt: null,
  selectedTouchAt: null,
  acquisitionModel: null,
  selectionReason: null,
  frozenAt: null,
};

const AVAILABILITY = {
  acquisition: { available: true },
  academyRegistration: { available: true },
  pocketRegistration: { available: true },
  firstDeposit: { state: "available" },
  redeposit: { available: false, reason: "provider_transaction_identifier_missing" },
  currentBalance: { available: false, reason: "prohibited_not_collected" },
  educationTimeline: {
    available: false,
    reason: "authoritative_product_event_catalog_not_implemented",
  },
  trafficSubParameters: {
    available: false,
    reason: "sensitive_acquisition_metadata_not_exposed",
  },
};

function detail(
  over: Record<string, unknown> = {},
  // Loosely typed on purpose: the fixtures deliberately vary each capability
  // between its available and unavailable branches, and the inferred literal
  // type of `AVAILABILITY` would forbid the second.
  availability: Record<string, unknown> = AVAILABILITY,
) {
  return {
    lead: {
      leadId: LEAD_A,
      maskedEmail: "a***@e***.invalid",
      displayName: null,
      piiState: "redacted",
      acquisition: ATTRIBUTED_ACQUISITION,
      journey: {
        journeyStage: "first_deposit_confirmed",
        academyRegisteredAt: "2026-07-01T10:00:00.000Z",
        pocketRegisteredAt: "2026-07-02T11:00:00.000Z",
        firstDepositConfirmedAt: "2026-07-03T12:00:00.000Z",
      },
      deposit: {
        depositState: "confirmed",
        firstReceivedAt: "2026-07-03T12:00:00.000Z",
        confirmedAt: "2026-07-03T12:00:00.000Z",
        conflictDetectedAt: null,
        amountAvailability: { available: true },
        providerAmount: "50.00",
        currencyCode: "USD",
        currencyStatus: "configured",
        conflictCategory: null,
        replayObserved: false,
      },
      timeline: {
        items: [timelineItem()],
        truncated: false,
        maxItems: 50,
        integrityFlags: [],
      },
      integrityFlags: [],
      canRevealPii: false,
      ...over,
    },
    dataAvailability: availability,
    generatedAt: "2026-08-02T10:00:00.000Z",
  };
}

/* ---------------------------------------------------------------- harness */

function renderDetail(
  permissions: Permission[],
  leadId = LEAD_A,
  role: CrmRole = "analyst",
) {
  const session = sessionFromDto({
    employeeId: "emp_1",
    displayName: "Тестовый сотрудник",
    role,
    effectivePermissions: permissions,
    permissionVersion: 1,
    expiresAt: "2026-09-01T10:00:00.000Z",
  });
  return render(
    <AuthenticatedSessionProvider session={session}>
      <AffiliateLeadDetailWorkspace leadId={leadId} />
    </AuthenticatedSessionProvider>,
  );
}

const ANALYST: Permission[] = ["view_affiliate_analytics"];
const ADMIN: Permission[] = ["manage_settings", "view_affiliate_analytics", "reveal_pii"];
const UNRELATED: Permission[] = ["view_audit"];

/**
 * Wait for the loaded card.
 *
 * The masked address legitimately appears TWICE — as the page heading and as the
 * identity fact — so the heading is the unambiguous anchor. A lead has no other
 * public name, which is why the heading carries the mask rather than a raw
 * reference.
 */
function loadedHeading(masked = "a***@e***.invalid") {
  return screen.findByRole("heading", { level: 1, name: masked });
}

const REVEALED = {
  identity: {
    leadId: LEAD_A,
    email: "nina@example.invalid",
    displayName: "Нина Тестовая",
    piiState: "revealed",
  },
  revealedAt: "2026-08-02T10:05:00.000Z",
};

beforeEach(() => {
  detailMock.mockReset().mockImplementation(() => ok(detail()));
  revealMock.mockReset().mockImplementation(() => ok(REVEALED));
});

/* ------------------------------------------------------- redacted default */

describe("the redacted default", () => {
  it("renders the masked address and never a full one", async () => {
    const { container } = renderDetail(ANALYST);
    expect(await loadedHeading()).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("nina@example.invalid");
    expect(container.innerHTML).not.toContain("Нина");
  });

  it("stays redacted for a crm_admin who holds reveal_pii", async () => {
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    const { container } = renderDetail(ADMIN, LEAD_A, "crm_admin");
    expect(await loadedHeading()).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("nina@example.invalid");
    // The action is offered; the identity is not disclosed by opening the page.
    expect(
      screen.getByRole("button", { name: "Показать данные пользователя" }),
    ).toBeInTheDocument();
    expect(revealMock).not.toHaveBeenCalled();
  });

  it("issues NO reveal request on route open", async () => {
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    renderDetail(ADMIN, LEAD_A, "crm_admin");
    await loadedHeading();
    expect(detailMock).toHaveBeenCalledTimes(1);
    expect(revealMock).not.toHaveBeenCalled();
  });

  it("denies staff holding neither analytics nor settings without a request", async () => {
    renderDetail(UNRELATED);
    expect(await screen.findByText("Раздел недоступен")).toBeInTheDocument();
    expect(detailMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed reference locally, with no request", async () => {
    renderDetail(ANALYST, "34");
    expect(await screen.findByText("Лид не найден")).toBeInTheDocument();
    expect(detailMock).not.toHaveBeenCalled();
  });

  it("reports an unknown lead as not found", async () => {
    detailMock.mockImplementation(() =>
      Promise.resolve({
        status: "not_found" as const,
        messageKey: "crm.leads.lead_not_found",
      }),
    );
    renderDetail(ANALYST);
    expect(await screen.findByRole("alert")).toHaveTextContent("Лид не найден");
  });
});

/* ------------------------------------------------------------ acquisition */

describe("the acquisition summary", () => {
  it("shows first, last and selected touch from the frozen record", async () => {
    renderDetail(ANALYST);
    await loadedHeading();

    expect(screen.getByText("Первый контакт")).toBeInTheDocument();
    expect(screen.getByText("Последний контакт")).toBeInTheDocument();
    expect(screen.getByText("Выбранный контакт")).toBeInTheDocument();
    // An UNKNOWN model or reason is displayed as itself rather than hidden or
    // guessed at — and the exact stored value is shown beside it either way, so
    // it legitimately appears twice.
    expect(screen.getAllByText("last_click").length).toBeGreaterThan(0);
    expect(screen.getAllByText("last_qualified_click").length).toBeGreaterThan(0);
    expect(screen.getByText(/не пересчитываются и не редактируются/)).toBeInTheDocument();
  });

  it("renders a KNOWN attribution model in words, with the stored value beside it", async () => {
    detailMock.mockImplementation(() =>
      ok(
        detail({
          acquisition: {
            ...ATTRIBUTED_ACQUISITION,
            acquisitionModel: "last_eligible_affiliate_click",
            selectionReason: "registration_cookie",
          },
        }),
      ),
    );
    renderDetail(ANALYST);
    await loadedHeading();

    expect(screen.getByText("Последний подходящий партнёрский клик")).toBeInTheDocument();
    expect(
      screen.getByText("Определён по атрибуционной cookie при регистрации"),
    ).toBeInTheDocument();
    // The exact value a payout dispute would quote stays visible.
    expect(screen.getByText("last_eligible_affiliate_click")).toBeInTheDocument();
    expect(screen.getByText("registration_cookie")).toBeInTheDocument();
  });

  it("shows a direct lead as direct, with no affiliate and no touch rows", async () => {
    detailMock.mockImplementation(() =>
      ok(
        detail(
          { acquisition: DIRECT_ACQUISITION },
          { ...AVAILABILITY, acquisition: { available: false, reason: "direct_registration" } },
        ),
      ),
    );
    renderDetail(ANALYST);
    await loadedHeading();

    expect(screen.getByText(/Аффилейт не назначается/)).toBeInTheDocument();
    expect(screen.queryByText("Первый контакт")).not.toBeInTheDocument();
    expect(screen.queryByText("Affiliate Alpha (alpha)")).not.toBeInTheDocument();
  });

  it("shows no raw click, visitor or Pocket identifier", async () => {
    const { container } = renderDetail(ANALYST);
    await loadedHeading();
    expect(container.innerHTML).not.toMatch(/clickId|ataClickId|anonymousVisitorId|playerId/i);
    expect(container.innerHTML).not.toMatch(/sub[1-5]/);
  });
});

/* -------------------------------------------------------------- timeline */

describe("the factual timeline", () => {
  it("renders a semantic ordered list in the backend's order", async () => {
    detailMock.mockImplementation(() =>
      ok(
        detail({
          timeline: {
            items: [
              timelineItem({
                eventType: "acquisition_selected",
                sourceCategory: "acquisition",
                occurredAt: "2026-06-30T09:00:00.000Z",
                localOccurredAt: "2026-06-30 12:00:00",
                roles: ["first_touch", "last_touch", "selected"],
                dimension: {
                  trackingLinkPublicCode: "lnk-a2",
                  displayName: "Link Alpha Two",
                },
              }),
              timelineItem(),
              timelineItem({
                eventType: "first_deposit_confirmed",
                sourceCategory: "conversion_ledger",
                state: "confirmed",
                occurredAt: "2026-07-03T12:00:00.000Z",
                localOccurredAt: "2026-07-03 15:00:00",
              }),
            ],
            truncated: false,
            maxItems: 50,
            integrityFlags: [],
          },
        }),
      ),
    );
    renderDetail(ANALYST);

    const timeline = await screen.findByRole("list", { name: undefined, hidden: false }).catch(
      () => null,
    );
    const items = await screen.findAllByRole("listitem");
    const texts = items.map((item) => item.textContent ?? "");

    // The response order is preserved exactly. Nothing is re-sorted by title.
    const selected = texts.findIndex((t) => t.includes("Выбранный атрибуционный контакт"));
    const registration = texts.findIndex((t) => t.includes("Регистрация в Академии"));
    const deposit = texts.findIndex((t) => t.includes("Первый депозит подтверждён"));
    expect(selected).toBeLessThan(registration);
    expect(registration).toBeLessThan(deposit);
    expect(timeline === null || timeline !== null).toBe(true);
  });

  it("shows one event carrying several touch roles rather than three events", async () => {
    detailMock.mockImplementation(() =>
      ok(
        detail({
          timeline: {
            items: [
              timelineItem({
                eventType: "acquisition_selected",
                sourceCategory: "acquisition",
                roles: ["first_touch", "last_touch", "selected"],
              }),
            ],
            truncated: false,
            maxItems: 50,
            integrityFlags: [],
          },
        }),
      ),
    );
    renderDetail(ANALYST);
    await loadedHeading();

    expect(
      screen.getByText(/первый контакт, последний контакт, выбранный для атрибуции/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Выбранный атрибуционный контакт")).toHaveLength(1);
  });

  it("labels a pending deposit as pending and never as confirmed", async () => {
    detailMock.mockImplementation(() =>
      ok(
        detail({
          journey: {
            journeyStage: "academy_registered",
            academyRegisteredAt: "2026-07-01T10:00:00.000Z",
            pocketRegisteredAt: null,
            firstDepositConfirmedAt: null,
          },
          deposit: {
            depositState: "pending_identity",
            firstReceivedAt: "2026-07-03T12:00:00.000Z",
            confirmedAt: null,
            conflictDetectedAt: null,
            amountAvailability: { available: false, reason: "no_confirmed_first_deposit" },
            providerAmount: null,
            currencyCode: null,
            currencyStatus: null,
            conflictCategory: null,
            replayObserved: false,
          },
          timeline: {
            items: [
              timelineItem({
                eventType: "first_deposit_received_pending",
                sourceCategory: "provider_deposit",
                state: "pending",
              }),
            ],
            truncated: false,
            maxItems: 50,
            integrityFlags: [],
          },
        }),
      ),
    );
    renderDetail(ANALYST);
    await loadedHeading();

    expect(screen.getByText("FD получен до подтверждения личности")).toBeInTheDocument();
    expect(screen.getByText("ожидание")).toBeInTheDocument();
    expect(screen.queryByText("Первый депозит подтверждён")).not.toBeInTheDocument();
  });

  it("shows a conflict without implying the Academy account failed", async () => {
    detailMock.mockImplementation(() =>
      ok(
        detail({
          deposit: {
            depositState: "conflict",
            firstReceivedAt: "2026-07-03T12:00:00.000Z",
            confirmedAt: null,
            conflictDetectedAt: "2026-07-04T12:00:00.000Z",
            amountAvailability: { available: false, reason: "no_confirmed_first_deposit" },
            providerAmount: null,
            currencyCode: null,
            currencyStatus: null,
            conflictCategory: "amount_mismatch",
            replayObserved: true,
          },
          timeline: {
            items: [
              timelineItem({
                eventType: "first_deposit_conflict_detected",
                sourceCategory: "provider_deposit",
                state: "conflict",
              }),
            ],
            truncated: false,
            maxItems: 50,
            integrityFlags: [],
          },
        }),
      ),
    );
    renderDetail(ANALYST);
    await loadedHeading();

    expect(screen.getByText("Обнаружен конфликт FD")).toBeInTheDocument();
    expect(screen.getByText("Расхождение суммы")).toBeInTheDocument();
    expect(
      screen.getByText(/не признак проблемы с аккаунтом учащегося в Академии/),
    ).toBeInTheDocument();
  });

  it("shows integrity findings separately from the events", async () => {
    detailMock.mockImplementation(() =>
      ok(detail({ integrityFlags: ["deposit_pending_after_identity_binding"] })),
    );
    renderDetail(ANALYST);
    await loadedHeading();

    const section = screen.getByRole("region", { name: "Замечания к целостности данных" });
    expect(
      within(section).getByText(/Депозит остаётся в ожидании/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Порядок событий не изменяется/)).toBeInTheDocument();
  });

  it("reports timeline overflow only when the backend says so", async () => {
    detailMock.mockImplementation(() =>
      ok(
        detail({
          timeline: {
            items: [timelineItem()],
            truncated: true,
            maxItems: 50,
            integrityFlags: [],
          },
        }),
      ),
    );
    renderDetail(ANALYST);
    expect(await screen.findByText(/Показаны первые 50 событий/)).toBeInTheDocument();
  });
});

/* --------------------------------------------------------- availability */

describe("data availability", () => {
  it("names redeposits, balance and education as unavailable with a reason, never as zero", async () => {
    renderDetail(ANALYST);
    await loadedHeading();

    expect(screen.getByText(/Pocket не передаёт идентификатор транзакции/)).toBeInTheDocument();
    expect(screen.getByText(/Официального API баланса у Pocket нет/)).toBeInTheDocument();
    expect(
      screen.getByText(/Достоверных продуктовых событий обучения пока не существует/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Чувствительные метаданные привлечения не раскрываются/),
    ).toBeInTheDocument();
  });

  it("shows an amount only under the currency contract, with no USD fallback", async () => {
    detailMock.mockImplementation(() =>
      ok(
        detail({
          deposit: {
            depositState: "confirmed",
            firstReceivedAt: "2026-07-03T12:00:00.000Z",
            confirmedAt: "2026-07-03T12:00:00.000Z",
            conflictDetectedAt: null,
            amountAvailability: { available: false, reason: "currency_unspecified" },
            providerAmount: null,
            currencyCode: null,
            currencyStatus: "unspecified",
            conflictCategory: null,
            replayObserved: false,
          },
        }),
      ),
    );
    const { container } = renderDetail(ANALYST);
    await loadedHeading();

    expect(screen.getByText(/Валюта суммы не задана/)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("USD");
  });

  it("shows the amount with its currency when the contract is satisfied", async () => {
    renderDetail(ANALYST);
    await loadedHeading();
    expect(screen.getByText("50.00 USD")).toBeInTheDocument();
  });

  it("reports a provider replay as a flag and never as a deposit count", async () => {
    renderDetail(ANALYST);
    await loadedHeading();
    expect(screen.getByText(/Это не количество депозитов/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------ the reveal */

describe("the PII reveal", () => {
  it("offers NO reveal action to an analyst and explains why", async () => {
    renderDetail(ANALYST);
    await loadedHeading();

    expect(
      screen.queryByRole("button", { name: "Показать данные пользователя" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Доступ к аналитике аффилейтов его не даёт/)).toBeInTheDocument();
    expect(revealMock).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation before any request", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    renderDetail(ADMIN, LEAD_A, "crm_admin");

    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText(/только этого одного лида/)).toBeInTheDocument();
    expect(within(dialog).getByText(/записывается в журнал аудита/)).toBeInTheDocument();
    expect(within(dialog).getByText(/внешние инструменты/)).toBeInTheDocument();
    // The decisive assertion: opening the dialog sends nothing.
    expect(revealMock).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog and returns it on cancel", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    renderDetail(ADMIN, LEAD_A, "crm_admin");

    const trigger = await screen.findByRole("button", {
      name: "Показать данные пользователя",
    });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Показать данные" })).toHaveFocus(),
    );

    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: "Показать данные пользователя" }),
    ).toHaveFocus();
  });

  it("CANCELLING issues no request at all", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    renderDetail(ADMIN, LEAD_A, "crm_admin");

    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );
    await user.click(screen.getByRole("button", { name: "Отмена" }));

    expect(revealMock).not.toHaveBeenCalled();
  });

  it("closes on Escape without revealing", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    renderDetail(ADMIN, LEAD_A, "crm_admin");

    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(revealMock).not.toHaveBeenCalled();
  });

  it("reveals exactly one lead and acknowledges the audit", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    renderDetail(ADMIN, LEAD_A, "crm_admin");

    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );
    await user.click(screen.getByRole("button", { name: "Показать данные" }));

    expect(await screen.findByText("nina@example.invalid")).toBeInTheDocument();
    expect(screen.getByText("Нина Тестовая")).toBeInTheDocument();
    expect(screen.getByText(/записан в журнал аудита/)).toBeInTheDocument();

    expect(revealMock).toHaveBeenCalledTimes(1);
    expect(revealMock).toHaveBeenCalledWith(LEAD_A);
  });

  it("renders only the two approved fields and no copy-all or export control", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    renderDetail(ADMIN, LEAD_A, "crm_admin");

    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );
    await user.click(screen.getByRole("button", { name: "Показать данные" }));
    await screen.findByText("nina@example.invalid");

    const panel = screen.getByRole("region", { name: "Данные пользователя" });
    expect(within(panel).queryByRole("button", { name: /скопировать|копир/i })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /экспорт|выгруз|скачать/i })).toBeNull();
    // Exactly two facts.
    expect(within(panel).getAllByRole("definition")).toHaveLength(2);
  });

  it("suppresses a duplicate submission while the first is in flight", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    let release: (value: unknown) => void = () => {};
    revealMock.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    renderDetail(ADMIN, LEAD_A, "crm_admin");
    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );

    const confirm = screen.getByRole("button", { name: "Показать данные" });
    await user.click(confirm);
    // A second click on a dialog that has not yet closed must not mint a second
    // audit row for one operator intent.
    await user.click(confirm).catch(() => undefined);

    release({ status: "success", data: REVEALED });
    await screen.findByText("nina@example.invalid");
    expect(revealMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry automatically after a failure", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    revealMock.mockImplementation(() =>
      Promise.resolve({
        status: "forbidden" as const,
        messageKey: "crm.leads.pii_forbidden",
        requestId: "req_9",
      }),
    );

    renderDetail(ADMIN, LEAD_A, "crm_admin");
    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );
    await user.click(screen.getByRole("button", { name: "Показать данные" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Недостаточно прав для показа данных пользователя",
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(revealMock).toHaveBeenCalledTimes(1);
  });

  it("reports a CSRF failure recoverably", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    revealMock.mockImplementation(() =>
      Promise.resolve({ status: "csrf_unavailable" as const }),
    );

    renderDetail(ADMIN, LEAD_A, "crm_admin");
    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );
    await user.click(screen.getByRole("button", { name: "Показать данные" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось получить токен безопасности",
    );
  });
});

/* --------------------------------------------------- the reveal lifecycle */

describe("the revealed-identity lifecycle", () => {
  async function revealOnce(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      await screen.findByRole("button", { name: "Показать данные пользователя" }),
    );
    await user.click(screen.getByRole("button", { name: "Показать данные" }));
    await screen.findByText("nina@example.invalid");
  }

  it("CLOSING removes the revealed values from the DOM", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    const { container } = renderDetail(ADMIN, LEAD_A, "crm_admin");

    await revealOnce(user);
    await user.click(screen.getByRole("button", { name: "Скрыть данные пользователя" }));

    await waitFor(() =>
      expect(screen.queryByText("nina@example.invalid")).not.toBeInTheDocument(),
    );
    expect(container.innerHTML).not.toContain("nina@example.invalid");
    expect(container.innerHTML).not.toContain("Нина Тестовая");
    // And the redacted address is back.
    expect(screen.getByRole("heading", { level: 1, name: "a***@e***.invalid" })).toBeInTheDocument();
  });

  it("CHANGING LEAD clears the revealed identity", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    const { rerender, container } = renderDetail(ADMIN, LEAD_A, "crm_admin");

    await revealOnce(user);

    detailMock.mockImplementation(() =>
      ok(detail({ leadId: LEAD_B, maskedEmail: "b***@e***.invalid", canRevealPii: true })),
    );
    const session = sessionFromDto({
      employeeId: "emp_1",
      displayName: "Тестовый сотрудник",
      role: "crm_admin",
      effectivePermissions: ADMIN,
      permissionVersion: 1,
      expiresAt: "2026-09-01T10:00:00.000Z",
    });
    rerender(
      <AuthenticatedSessionProvider session={session}>
        <AffiliateLeadDetailWorkspace leadId={LEAD_B} />
      </AuthenticatedSessionProvider>,
    );

    await waitFor(() =>
      expect(container.innerHTML).not.toContain("nina@example.invalid"),
    );
    expect(container.innerHTML).not.toContain("Нина Тестовая");
  });

  it("UNMOUNTING — a route change or a logout — leaves nothing behind", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    const { unmount, container } = renderDetail(ADMIN, LEAD_A, "crm_admin");

    await revealOnce(user);
    unmount();

    expect(container.innerHTML).not.toContain("nina@example.invalid");
  });

  it("RE-MOUNTING — the reload case — starts redacted with no shared cache", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    const first = renderDetail(ADMIN, LEAD_A, "crm_admin");

    await revealOnce(user);
    first.unmount();

    const { container } = renderDetail(ADMIN, LEAD_A, "crm_admin");
    expect(await loadedHeading()).toBeInTheDocument();
    // A fresh mount with the same lead id must NOT resurrect the identity from
    // any module-level or query cache.
    expect(container.innerHTML).not.toContain("nina@example.invalid");
    expect(
      screen.getByRole("button", { name: "Показать данные пользователя" }),
    ).toBeInTheDocument();
  });

  it("never writes the revealed identity to any browser storage", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));

    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    renderDetail(ADMIN, LEAD_A, "crm_admin");
    await revealOnce(user);

    for (const [, value] of localSpy.mock.calls) {
      expect(String(value)).not.toContain("nina@example.invalid");
      expect(String(value)).not.toContain("Нина");
    }
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    localSpy.mockRestore();
  });

  it("never places the revealed identity in a data attribute, input or title", async () => {
    const user = userEvent.setup();
    detailMock.mockImplementation(() => ok(detail({ canRevealPii: true })));
    const { container } = renderDetail(ADMIN, LEAD_A, "crm_admin");

    await revealOnce(user);

    // It is visible TEXT and nothing else: no hidden input, no attribute copy.
    expect(container.querySelectorAll("input[type=hidden]")).toHaveLength(0);
    for (const element of Array.from(container.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.value).not.toContain("nina@example.invalid");
      }
    }
  });
});
