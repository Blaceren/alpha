import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { resetClientRuntimeMode } from "@/config/client-runtime-mode";
import { AppShell } from "./app-shell";

// The pathname is what decides api-mode composition, so each case drives it.
let pathname = "/users";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
  // The analytics workspace reads its whole state from the query string.
  useSearchParams: () => new URLSearchParams(""),
}));

// Keep the boundary deterministic: a validated session, no network.
// AFD-5C1: the affiliate nav item is permission-gated, so the stub session's
// permissions must be settable per test. Default stays [] — the pre-existing
// bounded-shell expectations depend on it.
let stubPermissions: string[] = [];

vi.mock("@/application/session-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/application/session-client")>();
  return {
    ...actual,
    fetchSession: async () => ({
      status: "authenticated" as const,
      dto: {
        employeeId: "emp_stub_1",
        displayName: "Ирина Соколова",
        role: "support" as const,
        effectivePermissions: stubPermissions as never,
        permissionVersion: 1,
        expiresAt: "2099-12-31T23:59:59.000Z",
      },
    }),
  };
});

// The production list would otherwise fetch; stub it to a stable empty page.
vi.mock("@/data/api/api-crm-data-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/api/api-crm-data-provider")>();
  return {
    ...actual,
    createApiCrmDataProvider: () => ({
      listUsers: async () => ({ status: "success" as const, page: { items: [], nextCursor: null } }),
      getUserDetail: async () => ({
        status: "success" as const,
        detail: {
          userId: "1000",
          displayName: "Detail Learner",
          email: { value: "d***@e***.test", visibility: "masked" as const },
          status: "active" as const,
          level: 3,
          xp: 120,
          emailConfirmed: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      // The Owner section mounts for every StaffProfile; answer with the
      // pristine, never-mutated state so this composition test stays focused on
      // routing, not on owner behaviour.
      getUserOwner: async () => ({
        status: "success" as const,
        owner: { owner: null, ownerVersion: 0 },
      }),
      listOwnerCandidates: async () => ({ status: "forbidden" as const }),
      setUserOwner: async () => ({ status: "forbidden" as const }),
    }),
  };
});

vi.mock("@/application/api/affiliates-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/application/api/affiliates-client")>();
  return {
    ...actual,
    fetchAffiliatePartners: async () => ({
      status: "success" as const,
      data: { items: [], total: 0, limit: 25, offset: 0 },
    }),
  };
});

vi.mock("@/application/api/affiliate-analytics-client", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/application/api/affiliate-analytics-client")
  >();
  return {
    ...actual,
    fetchAnalyticsFilters: async () => ({ status: "upstream_unavailable" as const }),
    fetchEventDateSummary: async () => ({ status: "upstream_unavailable" as const }),
    fetchEventDateTimeseries: async () => ({ status: "upstream_unavailable" as const }),
    fetchEventDateBreakdown: async () => ({ status: "upstream_unavailable" as const }),
  };
});

beforeEach(() => {
  stubPermissions = [];
  resetClientRuntimeMode();
});
afterEach(() => resetClientRuntimeMode());

const FEATURE_CHILD = "MOCK FEATURE CHILD";

function renderAt(path: string, mode: "api" | "mock") {
  pathname = path;
  return render(
    <AppShell mode={mode}>
      <p>{FEATURE_CHILD}</p>
    </AppShell>,
  );
}

describe("api mode — /users is the one mountable route", () => {
  it("mounts the production users list at exactly /users", async () => {
    renderAt("/users", "api");
    expect(await screen.findByRole("heading", { name: "Пользователи", level: 1 })).toBeInTheDocument();
    // The mock feature child is never rendered.
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
  });

  it("shows the bounded shell with only the Users navigation item", async () => {
    renderAt("/users", "api");
    await screen.findByRole("heading", { name: "Пользователи", level: 1 });

    const nav = screen.getByRole("navigation", { name: "Разделы CRM" });
    expect(within(nav).getAllByRole("link")).toHaveLength(1);

    const html = document.body.innerHTML;
    for (const section of ["Сегодня", "Аудит", "Финанс", "Задачи", "Кейсы", "Настройки", "Ментор", "Аналитика"]) {
      expect(html, `must not offer ${section}`).not.toContain(section);
    }
  });

  it("never renders the role switch or mock chrome in api mode", async () => {
    renderAt("/users", "api");
    await screen.findByRole("heading", { name: "Пользователи", level: 1 });
    const html = document.body.innerHTML;
    expect(html).not.toContain("Демо-роль");
    expect(html).not.toContain("Роль:");
    expect(html).not.toContain("DEMO");
  });

  it("does not leak employeeId, permissions or environment details", async () => {
    renderAt("/users", "api");
    await screen.findByRole("heading", { name: "Пользователи", level: 1 });
    const html = document.body.innerHTML;
    for (const secret of ["emp_stub_1", "effectivePermissions", "permissionVersion", "2099-12-31", "CRM_BACKEND_ORIGIN", "127.0.0.1"]) {
      expect(html, `leaked ${secret}`).not.toContain(secret);
    }
  });
});

describe("api mode — every other route stays deferred", () => {
  it.each(["/today", "/audit", "/financial", "/settings", "/support", "/tasks", "/cases", "/"])(
    "%s renders the deferred state and no feature child",
    async (path) => {
      renderAt(path, "api");
      expect(await screen.findByText("Раздел ещё не подключён")).toBeInTheDocument();
      expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    },
  );

  it("/users/[id] mounts the production detail foundation, never mock User 360", async () => {
    // Changed in Frontend CRM User Detail API Slice 2: this route is now
    // connected. It must still never mount the mock User360Workspace.
    renderAt("/users/1000", "api");
    expect(await screen.findByRole("heading", { name: "Detail Learner" })).toBeInTheDocument();
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
    const html = document.body.innerHTML;
    for (const banned of ["Заметки", "Владелец", "Баланс", "User 360", "Активность"]) {
      expect(html).not.toContain(banned);
    }
  });

  it("an invalid /users/[id] renders the local invalid-id state", async () => {
    renderAt("/users/mock_user_1", "api");
    expect(await screen.findByText("Некорректный идентификатор пользователя")).toBeInTheDocument();
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
  });

  it("a nested learner route stays deferred", async () => {
    // /users/1000/notes has no backend and must not appear to exist.
    renderAt("/users/1000/notes", "api");
    expect(await screen.findByText("Раздел ещё не подключён")).toBeInTheDocument();
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
  });

  it("the deferred state offers a safe way to the one working section", async () => {
    renderAt("/today", "api");
    await screen.findByText("Раздел ещё не подключён");
    const link = screen.getByRole("link", { name: "Перейти к пользователям" });
    expect(link).toHaveAttribute("href", "/users");
  });
});

/* ----------------------------------------------------- affiliates (AFD-5C1) */

describe("api mode — the affiliate section", () => {
  it("mounts the inventory workspace at exactly /affiliates", async () => {
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates", "api");
    expect(await screen.findByRole("heading", { name: "Аффилейты", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
  });

  it("mounts the analytics workspace at exactly /affiliates/analytics", async () => {
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates/analytics", "api");
    expect(
      await screen.findByRole("heading", { name: "Аналитика аффилейтов", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
  });

  it("does not read `analytics` as a partner id", async () => {
    // The exact analytics path is matched BEFORE /affiliates/{partnerId}; if it
    // were not, this route would render a detail page for a partner named
    // "analytics" and the analytics workspace would be unreachable.
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates/analytics", "api");
    await screen.findByRole("heading", { name: "Аналитика аффилейтов", level: 1 });
    expect(screen.queryByText("Некорректный идентификатор")).not.toBeInTheDocument();
  });

  it("keeps an unbuilt nested affiliate route deferred", async () => {
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates/analytics/leads", "api");
    expect(await screen.findByText("Раздел ещё не подключён")).toBeInTheDocument();
  });

  it("shows the affiliate nav item to a session granted analytics", async () => {
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates", "api");
    await screen.findByRole("heading", { name: "Аффилейты", level: 1 });
    const nav = screen.getByRole("navigation", { name: "Разделы CRM" });
    expect(within(nav).getByRole("link", { name: "Аффилейты" })).toBeInTheDocument();
  });

  it("shows the affiliate nav item to a session granted manage_settings", async () => {
    stubPermissions = ["manage_settings"];
    renderAt("/users", "api");
    await screen.findByRole("heading", { name: "Пользователи", level: 1 });
    const nav = screen.getByRole("navigation", { name: "Разделы CRM" });
    expect(within(nav).getByRole("link", { name: "Аффилейты" })).toBeInTheDocument();
  });

  it("hides the affiliate nav item from a session granted neither", async () => {
    stubPermissions = [];
    renderAt("/users", "api");
    await screen.findByRole("heading", { name: "Пользователи", level: 1 });
    const nav = screen.getByRole("navigation", { name: "Разделы CRM" });
    expect(within(nav).queryByRole("link", { name: "Аффилейты" })).not.toBeInTheDocument();
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
  });

  it("renders the analytics denial for a session granted neither", async () => {
    // The route still MOUNTS — the backend is the boundary — but the workspace
    // itself refuses rather than issuing requests that could only 403.
    stubPermissions = [];
    renderAt("/affiliates/analytics", "api");
    expect(await screen.findByText("Недостаточно прав")).toBeInTheDocument();
  });
});

/* ------------------------------------------------ affiliate leads (AFD-5C2) */

describe("api mode — the affiliate lead routes", () => {
  it("mounts the lead list at exactly /affiliates/leads", async () => {
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates/leads", "api");
    expect(
      await screen.findByRole("heading", { name: "Лиды аффилейтов", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
  });

  it("does not read `leads` as a partner id", async () => {
    // The exact leads path is matched BEFORE /affiliates/{partnerId}; if it were
    // not, this route would render a detail page for a partner named "leads" and
    // the lead list would be unreachable.
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates/leads", "api");
    await screen.findByRole("heading", { name: "Лиды аффилейтов", level: 1 });
    expect(screen.queryByText("Некорректный идентификатор")).not.toBeInTheDocument();
  });

  it("mounts the lead detail at /affiliates/leads/{leadId}", async () => {
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates/leads/v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "api");
    // The detail heading is the masked address once loaded; before that the
    // route must at least not be the deferred placeholder.
    await waitFor(() =>
      expect(screen.queryByText("Раздел ещё не подключён")).not.toBeInTheDocument(),
    );
  });

  it("keeps a route BELOW the lead detail deferred", async () => {
    stubPermissions = ["view_affiliate_analytics"];
    renderAt("/affiliates/leads/v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/reveal", "api");
    expect(await screen.findByText("Раздел ещё не подключён")).toBeInTheDocument();
  });

  it("renders the lead denial for a session granted neither", async () => {
    stubPermissions = [];
    renderAt("/affiliates/leads", "api");
    expect(await screen.findByText("Раздел недоступен")).toBeInTheDocument();
  });
});

describe("mock mode is untouched", () => {
  it("renders the mock feature child at /users", async () => {
    renderAt("/users", "mock");
    expect(await screen.findByText(FEATURE_CHILD)).toBeInTheDocument();
  });

  it("renders the mock feature child at /users/[id]", async () => {
    renderAt("/users/1000", "mock");
    expect(await screen.findByText(FEATURE_CHILD)).toBeInTheDocument();
  });

  it("never shows the api-mode deferred state", async () => {
    renderAt("/today", "mock");
    await screen.findByText(FEATURE_CHILD);
    expect(screen.queryByText("Раздел ещё не подключён")).not.toBeInTheDocument();
  });
});
