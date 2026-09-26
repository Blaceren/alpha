/**
 * AFD-5C2 — the lead list workspace.
 *
 * These cover the behaviour that only appears once the pieces are assembled:
 * permission gating, cursor paging that never invents a position, request
 * orchestration refusing to render a stale answer, and the privacy properties of
 * what the list actually calls and actually paints.
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { sessionFromDto } from "@/domain/identity/session";
import type { CrmRole, Permission } from "@/domain/identity/roles";
import { AffiliateLeadsWorkspace } from "./leads-workspace";

/* ----------------------------------------------------------------- routing */

/**
 * A router double that actually navigates.
 *
 * `useSearchParams` is backed by a real external store, so `router.push`
 * re-renders the tree exactly as a navigation does. A mock that merely recorded
 * the call would leave the component frozen on its initial URL, and every
 * assertion about "what happens after a filter change" would silently be
 * testing nothing.
 */
let currentSearch = "";
const searchListeners = new Set<() => void>();
const history: string[] = [];

function setSearch(next: string) {
  currentSearch = next;
  for (const listener of searchListeners) listener();
}

const pushMock = vi.fn((url: string) => {
  history.push(url);
  setSearch(url.includes("?") ? url.slice(url.indexOf("?")) : "");
});
const replaceMock = vi.fn((url: string) => {
  setSearch(url.includes("?") ? url.slice(url.indexOf("?")) : "");
});

vi.mock("next/navigation", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn(), back: vi.fn() }),
    usePathname: () => "/affiliates/leads",
    useSearchParams: () => {
      const raw = react.useSyncExternalStore(
        (listener: () => void) => {
          searchListeners.add(listener);
          return () => searchListeners.delete(listener);
        },
        () => currentSearch,
        () => currentSearch,
      );
      return new URLSearchParams(raw);
    },
  };
});

/* ------------------------------------------------------------- API doubles */

const listMock = vi.fn();
const filtersMock = vi.fn();
const revealMock = vi.fn();

vi.mock("@/application/api/affiliate-leads-client", async () => {
  const actual = await vi.importActual<typeof import("@/application/api/affiliate-leads-client")>(
    "@/application/api/affiliate-leads-client",
  );
  return {
    ...actual,
    fetchLeadList: (...a: unknown[]) => listMock(...a),
    revealLeadPii: (...a: unknown[]) => revealMock(...a),
  };
});

vi.mock("@/application/api/affiliate-analytics-client", async () => {
  const actual = await vi.importActual<
    typeof import("@/application/api/affiliate-analytics-client")
  >("@/application/api/affiliate-analytics-client");
  return { ...actual, fetchAnalyticsFilters: (...a: unknown[]) => filtersMock(...a) };
});

/* ---------------------------------------------------------------- fixtures */

const ok = <T,>(data: T) => Promise.resolve({ status: "success" as const, data });

function row(over: Record<string, unknown> = {}) {
  return {
    leadId: "v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    maskedEmail: "a***@e***.invalid",
    displayName: null,
    piiState: "redacted",
    academyRegisteredAt: "2026-07-01T10:00:00.000Z",
    selectedAcquisitionAt: "2026-06-30T09:00:00.000Z",
    pocketRegisteredAt: "2026-07-02T11:00:00.000Z",
    firstDepositAt: "2026-07-03T12:00:00.000Z",
    journeyStage: "first_deposit_confirmed",
    depositState: "confirmed",
    attributionState: "attributed",
    affiliate: { id: "1", code: "alpha", displayName: "Affiliate Alpha" },
    campaign: { id: "10", code: "a-one", displayName: "Campaign Alpha One" },
    trackingLink: { id: "100", code: "lnk-a1", displayName: "Link Alpha One" },
    integrityFlags: [],
    canRevealPii: false,
    ...over,
  };
}

const PERIOD = {
  resolvedPreset: "last_30_days",
  timezone: "Europe/Moscow",
  weekStart: "monday",
  startUtc: "2026-06-30T21:00:00.000Z",
  endUtc: "2026-07-30T21:00:00.000Z",
  startLocal: "2026-07-01 00:00:00",
  endLocal: "2026-07-31 00:00:00",
  intervalConvention: "start_inclusive_end_exclusive",
};

function list(over: Record<string, unknown> = {}) {
  return {
    filters: {
      affiliatePartnerId: null,
      affiliateCampaignId: null,
      affiliateTrackingLinkId: null,
      attributionState: null,
      journeyStage: null,
      depositState: null,
    },
    periods: { registration: null, acquisition: null },
    sort: "registration_desc",
    supportedSorts: ["registration_desc"],
    pageSize: 25,
    defaultPageSize: 25,
    maxPageSize: 100,
    hasMore: false,
    nextCursor: null,
    rows: [row()],
    generatedAt: "2026-08-02T10:00:00.000Z",
    ...over,
  };
}

const FILTER_OPTIONS = {
  affiliatePartners: [
    { id: "1", code: "alpha", displayName: "Affiliate Alpha", status: "active", archived: false },
    { id: "2", code: "beta", displayName: "Affiliate Beta", status: "archived", archived: true },
  ],
  affiliateCampaigns: [
    {
      id: "10",
      affiliatePartnerId: "1",
      code: "a-one",
      displayName: "Campaign Alpha One",
      status: "active",
      archived: false,
    },
  ],
  affiliateTrackingLinks: [
    {
      id: "100",
      affiliatePartnerId: "1",
      affiliateCampaignId: "10",
      publicCode: "lnk-a1",
      displayName: "Link Alpha One",
      status: "active",
      availability: "available",
      archived: false,
    },
  ],
};

/* ---------------------------------------------------------------- harness */

function renderWorkspace(permissions: Permission[], role: CrmRole = "analyst") {
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
      <AffiliateLeadsWorkspace />
    </AuthenticatedSessionProvider>,
  );
}

const ANALYST: Permission[] = ["view_affiliate_analytics"];
const ADMIN: Permission[] = ["manage_settings", "view_affiliate_analytics", "reveal_pii"];
/** Real staff permissions that grant neither analytics nor settings. */
const UNRELATED: Permission[] = ["view_audit"];

beforeEach(() => {
  setSearch("");
  history.length = 0;
  pushMock.mockClear();
  replaceMock.mockClear();
  revealMock.mockReset();
  listMock.mockReset().mockImplementation(() => ok(list()));
  filtersMock.mockReset().mockImplementation(() => ok(FILTER_OPTIONS));
});

/* ------------------------------------------------------------ permissions */

describe("permissions", () => {
  it("renders the list for an analyst", async () => {
    renderWorkspace(ANALYST);
    // Two layouts render the same rows — the wide table and the narrow cards —
    // so a row legitimately appears twice in the DOM.
    expect((await screen.findAllByText("a***@e***.invalid")).length).toBeGreaterThan(0);
  });

  it("renders the list for a crm_admin", async () => {
    renderWorkspace(ADMIN, "crm_admin");
    expect((await screen.findAllByText("a***@e***.invalid")).length).toBeGreaterThan(0);
  });

  it("denies staff holding neither analytics nor settings, and issues NO request", async () => {
    renderWorkspace(UNRELATED);
    expect(await screen.findByText("Раздел недоступен")).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
    expect(filtersMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------- the section */

describe("navigation", () => {
  it("keeps the management and analytics tabs beside the new one", async () => {
    renderWorkspace(ANALYST);
    const tabs = await screen.findByRole("navigation", { name: "Разделы аффилейтов" });
    expect(within(tabs).getByRole("link", { name: "Управление" })).toHaveAttribute(
      "href",
      "/affiliates",
    );
    expect(within(tabs).getByRole("link", { name: "Аналитика" })).toHaveAttribute(
      "href",
      "/affiliates/analytics",
    );
    const leads = within(tabs).getByRole("link", { name: "Лиды" });
    expect(leads).toHaveAttribute("href", "/affiliates/leads");
    expect(leads).toHaveAttribute("aria-current", "page");
  });

  it("shows no lead count in the tab", async () => {
    renderWorkspace(ANALYST);
    const tabs = await screen.findByRole("navigation", { name: "Разделы аффилейтов" });
    expect(within(tabs).getByRole("link", { name: "Лиды" }).textContent).toBe("Лиды");
  });
});

/* ------------------------------------------------------------------- rows */

describe("the redacted list", () => {
  it("shows a masked address and links to the lead by its opaque reference", async () => {
    renderWorkspace(ANALYST);
    const link = (await screen.findAllByRole("link", { name: "a***@e***.invalid" }))[0]!;
    expect(link).toHaveAttribute(
      "href",
      "/affiliates/leads/v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("shows no full email, no raw user id and no provider identifier anywhere", async () => {
    listMock.mockImplementation(() => ok(list({ rows: [row()] })));
    const { container } = renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    const html = container.innerHTML;
    expect(html).not.toMatch(/nina@|@example\.invalid(?!")/);
    expect(html).not.toMatch(/userId/i);
    expect(html).not.toMatch(/pocketPlayerId|clickId|ataClickId|anonymousVisitorId/i);
    expect(html).not.toMatch(/\bbalance\b/i);
  });

  it("renders journey stage and deposit state as separate labelled facts", async () => {
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(screen.getAllByText("Первый депозит подтверждён").length).toBeGreaterThan(0);
  });

  it("shows a pending deposit without calling it confirmed", async () => {
    listMock.mockImplementation(() =>
      ok(
        list({
          rows: [
            row({
              journeyStage: "pocket_registered",
              depositState: "pending_identity",
              firstDepositAt: null,
            }),
          ],
        }),
      ),
    );
    renderWorkspace(ANALYST);
    const table = await screen.findByRole("table");
    // Scoped to the ROWS: "Первый депозит подтверждён" is also a legitimate
    // option in the two filter dropdowns, and finding it there proves nothing.
    expect(
      within(table).getByText("Ожидает подтверждения Pocket-пользователя"),
    ).toBeInTheDocument();
    expect(within(table).queryByText("Первый депозит подтверждён")).not.toBeInTheDocument();
  });

  it("shows a conflict row distinctly from a confirmed one", async () => {
    listMock.mockImplementation(() =>
      ok(list({ rows: [row({ depositState: "conflict" })] })),
    );
    renderWorkspace(ANALYST);
    expect((await screen.findAllByText("Требует проверки конфликта"))[0]).toBeInTheDocument();
  });

  it("shows a direct lead without inventing an affiliate", async () => {
    listMock.mockImplementation(() =>
      ok(
        list({
          rows: [
            row({
              attributionState: "unattributed",
              affiliate: null,
              campaign: null,
              trackingLink: null,
              selectedAcquisitionAt: null,
            }),
          ],
        }),
      ),
    );
    renderWorkspace(ANALYST);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Прямая регистрация")).toBeInTheDocument();
    // Scoped to the ROWS: "Affiliate Alpha" is a legitimate FILTER option, and
    // the claim under test is that no affiliate is attached to the direct lead.
    expect(within(table).queryByText(/Affiliate Alpha/)).not.toBeInTheDocument();
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("marks a row that carries integrity findings", async () => {
    listMock.mockImplementation(() =>
      ok(list({ rows: [row({ integrityFlags: ["duplicate_academy_registration"] })] })),
    );
    renderWorkspace(ANALYST);
    expect((await screen.findAllByText("Есть замечания к данным"))[0]).toBeInTheDocument();
  });

  it("renders a semantic table with a caption on wide viewports", async () => {
    renderWorkspace(ANALYST);
    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Состояние депозита" }),
    ).toBeInTheDocument();
  });

  it("offers NO PII reveal control anywhere in the list", async () => {
    listMock.mockImplementation(() => ok(list({ rows: [row({ canRevealPii: true })] })));
    renderWorkspace(ADMIN, "crm_admin");
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(
      screen.queryByRole("button", { name: "Показать данные пользователя" }),
    ).not.toBeInTheDocument();
    expect(revealMock).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------------- states */

describe("loading, empty and error states", () => {
  it("shows a loading state before the first response", async () => {
    listMock.mockImplementation(() => new Promise(() => {}));
    renderWorkspace(ANALYST);
    expect(await screen.findByText("Загружаем лиды…")).toBeInTheDocument();
  });

  it("distinguishes an empty population from an empty filter result", async () => {
    listMock.mockImplementation(() => ok(list({ rows: [] })));
    const { unmount } = renderWorkspace(ANALYST);
    expect(await screen.findByText("Лидов пока нет")).toBeInTheDocument();
    unmount();

    setSearch("?depositState=conflict");
    renderWorkspace(ANALYST);
    expect(
      await screen.findByText("По выбранным фильтрам ничего не найдено"),
    ).toBeInTheDocument();
  });

  it("reports a backend failure with a retry", async () => {
    listMock.mockImplementation(() =>
      Promise.resolve({ status: "upstream_unavailable" as const }),
    );
    renderWorkspace(ANALYST);
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервис лидов недоступен");
  });

  it("reports an expired session distinctly", async () => {
    listMock.mockImplementation(() => Promise.resolve({ status: "unauthenticated" as const }));
    renderWorkspace(ANALYST);
    expect(await screen.findByRole("alert")).toHaveTextContent("Сессия истекла");
  });

  it("refuses to render a malformed response", async () => {
    listMock.mockImplementation(() => Promise.resolve({ status: "malformed_response" as const }));
    renderWorkspace(ANALYST);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "не соответствует ожидаемому формату",
    );
  });
});

/* ---------------------------------------------------------------- filters */

describe("filters", () => {
  it("writes a chosen affiliate to the URL and re-requests", async () => {
    const user = userEvent.setup();
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.selectOptions(screen.getByLabelText("Аффилейт"), "1");

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(history.at(-1)).toContain("affiliatePartnerId=1");
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ affiliatePartnerId: "1" }),
        expect.anything(),
      ),
    );
  });

  it("offers archived dimensions and labels them", async () => {
    renderWorkspace(ANALYST);
    const select = await screen.findByLabelText("Аффилейт");
    expect(within(select).getByRole("option", { name: /Affiliate Beta.*в архиве/ })).toBeTruthy();
  });

  it("clears campaign and link when the affiliate changes", async () => {
    const user = userEvent.setup();
    setSearch("?affiliatePartnerId=1&affiliateCampaignId=10&affiliateTrackingLinkId=100");
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.selectOptions(screen.getByLabelText("Аффилейт"), "2");

    await waitFor(() => expect(history.at(-1)).toContain("affiliatePartnerId=2"));
    expect(history.at(-1)).not.toContain("affiliateCampaignId");
    expect(history.at(-1)).not.toContain("affiliateTrackingLinkId");
  });

  it("writes the journey stage and the deposit state as separate keys", async () => {
    const user = userEvent.setup();
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.selectOptions(screen.getByLabelText("Этап пути"), "pocket_registered");
    await waitFor(() => expect(history.at(-1)).toContain("journeyStage=pocket_registered"));

    await user.selectOptions(screen.getByLabelText("Состояние депозита"), "conflict");
    await waitFor(() => expect(history.at(-1)).toContain("depositState=conflict"));
  });

  it("keeps the two periods separate in the URL and in the request", async () => {
    setSearch("?registrationPreset=today&acquisitionPreset=last_7_days");
    renderWorkspace(ANALYST);
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          registrationPreset: "today",
          acquisitionPreset: "last_7_days",
        }),
        expect.anything(),
      ),
    );
  });

  it("displays the period the BACKEND resolved rather than recomputing one", async () => {
    listMock.mockImplementation(() =>
      ok(list({ periods: { registration: PERIOD, acquisition: null } })),
    );
    setSearch("?registrationPreset=last_30_days");
    renderWorkspace(ANALYST);
    expect(await screen.findByText(/2026-07-01 00:00:00 — 2026-07-31 00:00:00/)).toBeInTheDocument();
    expect(screen.getAllByText(/Europe\/Moscow/).length).toBeGreaterThan(0);
  });

  it("disables the acquisition period for direct leads and says why", async () => {
    setSearch("?attributionState=unattributed");
    renderWorkspace(ANALYST);
    const select = await screen.findByLabelText("Период", { selector: "#leads-acquisition-preset" });
    expect(select).toBeDisabled();
    expect(
      screen.getByText(/Недоступно при фильтре «Прямая регистрация»/),
    ).toBeInTheDocument();
  });

  it("resets every filter with one control", async () => {
    const user = userEvent.setup();
    setSearch("?affiliatePartnerId=1&depositState=conflict&registrationPreset=today");
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    await waitFor(() => expect(history.at(-1)).toBe("/affiliates/leads"));
  });

  it("offers no identity search box", async () => {
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/почт|email/i)).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------- paging */

describe("cursor pagination", () => {
  it("carries the backend cursor verbatim and never decodes it", async () => {
    const user = userEvent.setup();
    listMock.mockImplementation(() => ok(list({ hasMore: true, nextCursor: "CURSOR_2" })));
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.click(screen.getByRole("button", { name: "Следующая страница" }));

    await waitFor(() => expect(history.at(-1)).toContain("cursor=CURSOR_2"));
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "CURSOR_2" }),
        expect.anything(),
      ),
    );
  });

  it("disables next on the last page", async () => {
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(screen.getByRole("button", { name: "Следующая страница" })).toBeDisabled();
  });

  it("offers no previous control on the first page", async () => {
    listMock.mockImplementation(() => ok(list({ hasMore: true, nextCursor: "CURSOR_2" })));
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(screen.getByRole("button", { name: "Предыдущая страница" })).toBeDisabled();
  });

  it("returns to a cursor the SERVER issued rather than inventing one", async () => {
    const user = userEvent.setup();
    listMock.mockImplementation(() => ok(list({ hasMore: true, nextCursor: "CURSOR_2" })));
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.click(screen.getByRole("button", { name: "Следующая страница" }));
    await waitFor(() => expect(history.at(-1)).toContain("cursor=CURSOR_2"));

    await user.click(screen.getByRole("button", { name: "Предыдущая страница" }));
    // Back to page one — the unparameterised position, not a fabricated
    // backwards cursor.
    await waitFor(() => expect(history.at(-1)).toBe("/affiliates/leads"));
  });

  it("announces the current page", async () => {
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(screen.getByText("Страница 1, показано лидов: 1")).toBeInTheDocument();
  });

  it("resets the cursor when a filter changes", async () => {
    const user = userEvent.setup();
    setSearch("?cursor=CURSOR_2");
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.selectOptions(screen.getByLabelText("Состояние депозита"), "confirmed");
    await waitFor(() => expect(history.at(-1)).toContain("depositState=confirmed"));
    expect(history.at(-1)).not.toContain("cursor");
  });

  it("resets the cursor when the sort changes", async () => {
    const user = userEvent.setup();
    setSearch("?cursor=CURSOR_2");
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.selectOptions(screen.getByLabelText("Сортировка"), "first_deposit_desc");
    await waitFor(() => expect(history.at(-1)).toContain("sort=first_deposit_desc"));
    expect(history.at(-1)).not.toContain("cursor");
  });

  it("recovers from a tampered cursor by returning to the first page", async () => {
    listMock.mockImplementation(() =>
      Promise.resolve({
        status: "cursor_invalid" as const,
        messageKey: "crm.leads.cursor_invalid",
      }),
    );
    setSearch("?cursor=TAMPERED");
    renderWorkspace(ANALYST);

    // Rewritten with `replace`, so a broken position is not a place back returns
    // to — and explained rather than shown as a dead end.
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/affiliates/leads"));
    expect(
      await screen.findByText(/Ссылка на страницу устарела или не соответствует/),
    ).toBeInTheDocument();
  });

  it("reports the page number from the CURRENT cursor, so browser back stays honest", async () => {
    const user = userEvent.setup();
    listMock.mockImplementation(() => ok(list({ hasMore: true, nextCursor: "CURSOR_2" })));
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.click(screen.getByRole("button", { name: "Следующая страница" }));
    await waitFor(() => expect(screen.getByText(/Страница 2/)).toBeInTheDocument());

    // A BROWSER back — a URL change nobody clicked a control for. The page
    // number must follow the address bar, not a stack of past clicks.
    setSearch("");
    await waitFor(() => expect(screen.getByText(/Страница 1/)).toBeInTheDocument());
    // And "previous" is correctly unavailable again on page one.
    expect(screen.getByRole("button", { name: "Предыдущая страница" })).toBeDisabled();
  });

  it("keeps explaining a refused cursor after the repair has succeeded", async () => {
    // The rejection itself disappears the moment the repaired request succeeds,
    // so a notice rendered from the failure alone would flash and vanish — and
    // the operator would silently be on a different page than the link they
    // followed.
    listMock.mockImplementationOnce(() =>
      Promise.resolve({
        status: "cursor_invalid" as const,
        messageKey: "crm.leads.cursor_invalid",
      }),
    );
    listMock.mockImplementation(() => ok(list()));

    setSearch("?cursor=TAMPERED");
    renderWorkspace(ANALYST);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/affiliates/leads"));
    // The repaired page has loaded AND the explanation is still on screen.
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(
      screen.getByText(/Ссылка на страницу устарела или не соответствует/),
    ).toBeInTheDocument();
  });

  it("shows no page total, because a keyset list has none", async () => {
    listMock.mockImplementation(() => ok(list({ hasMore: true, nextCursor: "CURSOR_2" })));
    const { container } = renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(container.innerHTML).not.toMatch(/из \d+/);
  });
});

/* ----------------------------------------------------- request orchestration */

describe("request orchestration", () => {
  it("issues exactly one list request per URL state", async () => {
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("requests the filter dictionary once, UNSCOPED, and never re-requests it", async () => {
    const user = userEvent.setup();
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    expect(filtersMock).toHaveBeenCalledTimes(1);
    // No parent is sent: the filters route narrows the PARTNER list to the
    // partner it is given, so a scoped request would return a dropdown holding
    // only the affiliate already chosen — and the operator could never switch.
    expect(filtersMock).toHaveBeenCalledWith({}, expect.anything());

    await user.selectOptions(screen.getByLabelText("Состояние депозита"), "conflict");
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(filtersMock).toHaveBeenCalledTimes(1);

    // Not even after choosing an affiliate.
    await user.selectOptions(screen.getByLabelText("Аффилейт"), "1");
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(3));
    expect(filtersMock).toHaveBeenCalledTimes(1);
  });

  it("keeps every affiliate selectable after one has been chosen", async () => {
    const user = userEvent.setup();
    setSearch("?affiliatePartnerId=1");
    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    // The decisive assertion: the OTHER affiliate is still an option, so the
    // operator can switch directly rather than having to reset first.
    const select = screen.getByLabelText("Аффилейт");
    expect(within(select).getByRole("option", { name: /Affiliate Beta/ })).toBeTruthy();
    await user.selectOptions(select, "2");
    await waitFor(() => expect(history.at(-1)).toContain("affiliatePartnerId=2"));
  });

  it("DISCARDS a stale list response that arrives after a newer one", async () => {
    const user = userEvent.setup();

    let releaseFirst: (value: unknown) => void = () => {};
    listMock.mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirst = resolve)),
    );
    listMock.mockImplementationOnce(() =>
      ok(list({ rows: [row({ maskedEmail: "b***@e***.invalid" })] })),
    );

    renderWorkspace(ANALYST);
    await user.selectOptions(await screen.findByLabelText("Состояние депозита"), "conflict");

    await waitFor(() => expect(screen.getAllByText("b***@e***.invalid").length).toBeGreaterThan(0));

    // The superseded request now answers. Its rows must never appear.
    releaseFirst({ status: "success", data: list({ rows: [row({ maskedEmail: "STALE" })] }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
    expect(screen.getAllByText("b***@e***.invalid").length).toBeGreaterThan(0);
  });

  it("keeps the previous rows visible while a refresh runs", async () => {
    const user = userEvent.setup();
    listMock.mockImplementationOnce(() => ok(list()));
    listMock.mockImplementationOnce(() => new Promise(() => {}));

    renderWorkspace(ANALYST);
    await screen.findAllByRole("link", { name: "a***@e***.invalid" });

    await user.selectOptions(screen.getByLabelText("Состояние депозита"), "conflict");

    expect(await screen.findByText("Обновляется…")).toBeInTheDocument();
    expect(screen.getAllByText("a***@e***.invalid").length).toBeGreaterThan(0);
  });
});
