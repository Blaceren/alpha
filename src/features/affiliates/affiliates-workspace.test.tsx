import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { sessionFromDto } from "@/domain/identity/session";
import type { Permission } from "@/domain/identity/roles";
import { NAV_GROUPS, SECTION_ORDER } from "@/config/navigation";
import { SECTION_VISIBILITY } from "@/domain/identity/permissions";
import { visibleSections } from "@/domain/identity/access";
import { AffiliatesWorkspace } from "./affiliates-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/affiliates",
}));

const listMock = vi.fn();
vi.mock("@/application/api/affiliates-client", async () => {
  const actual = await vi.importActual<typeof import("@/application/api/affiliates-client")>(
    "@/application/api/affiliates-client",
  );
  return {
    ...actual,
    fetchAffiliatePartners: (...args: unknown[]) => listMock(...args),
  };
});

function partner(over: Record<string, unknown> = {}) {
  return {
    id: "1",
    code: "alpha",
    displayName: "Affiliate Alpha",
    description: null,
    status: "active",
    availability: "available",
    defaultAttributionWindowDays: 30,
    inventory: { campaigns: 2, trackingLinks: 3, activeTrackingLinks: 1 },
    createdBy: { employeeId: "emp_1", displayName: "Staff crm_admin" },
    createdAt: "2026-07-31T10:00:00.000Z",
    updatedAt: "2026-07-31T10:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function renderAs(permissions: Permission[], role: "crm_admin" | "analyst" = "crm_admin") {
  const session = sessionFromDto({
    employeeId: "emp_1",
    displayName: "Тестовый сотрудник",
    role,
    effectivePermissions: permissions,
    permissionVersion: 1,
    expiresAt: "2026-08-01T10:00:00.000Z",
  });
  return render(
    <AuthenticatedSessionProvider session={session}>
      <AffiliatesWorkspace />
    </AuthenticatedSessionProvider>,
  );
}

beforeEach(() => {
  listMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

/* ---------------------------------------------------------------- navigation */

describe("navigation canon", () => {
  it("exposes the affiliates section exactly to the roles the backend admits", () => {
    expect(SECTION_VISIBILITY.affiliates).toEqual(["crm_admin", "crm_manager", "analyst"]);
  });

  it("is reachable in the nav model and ordered with the analytics group", () => {
    expect(SECTION_ORDER).toContain("affiliates");
    const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === "affiliates");
    expect(item).toEqual({
      key: "affiliates",
      label: "Аффилейты",
      href: "/affiliates",
      icon: "Share2",
    });
  });

  it("is visible to analyst and crm_admin, and hidden from every other role", () => {
    for (const role of ["crm_admin", "crm_manager", "analyst"] as const) {
      expect(visibleSections(role, SECTION_ORDER)).toContain("affiliates");
    }
    for (const role of [
      "retention_manager",
      "mentor",
      "support",
      "moderator",
      "content_manager",
      "read_only",
    ] as const) {
      expect(visibleSections(role, SECTION_ORDER), role).not.toContain("affiliates");
    }
  });
});

/* -------------------------------------------------------------------- states */

describe("affiliate list states", () => {
  it("announces loading", () => {
    listMock.mockReturnValue(new Promise(() => {}));
    renderAs(["manage_settings"]);
    expect(screen.getByText("Загрузка списка аффилейтов")).toBeInTheDocument();
  });

  it("renders inventory columns and no traffic metric", async () => {
    listMock.mockResolvedValue({
      status: "success",
      data: { items: [partner()], total: 1, limit: 25, offset: 0 },
    });
    renderAs(["manage_settings"]);

    await screen.findAllByText("Affiliate Alpha");
    expect(screen.getAllByText("alpha").length).toBeGreaterThan(0);

    // Inventory is shown…
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    // …and nothing that would read as traffic.
    for (const forbidden of [/кликов/i, /клики/i, /конверси/i, /депозит/i, /баланс/i, /доход/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it("shows an empty state that explains what to do next", async () => {
    listMock.mockResolvedValue({
      status: "success",
      data: { items: [], total: 0, limit: 25, offset: 0 },
    });
    renderAs(["manage_settings"]);
    expect(await screen.findByText("Аффилейтов пока нет")).toBeInTheDocument();
  });

  it("distinguishes a filtered empty result from an empty inventory", async () => {
    listMock.mockResolvedValue({
      status: "success",
      data: { items: [], total: 0, limit: 25, offset: 0 },
    });
    renderAs(["manage_settings"]);
    await screen.findByText("Аффилейтов пока нет");

    await userEvent.type(screen.getByLabelText(/Поиск по названию/), "zzz");
    await userEvent.click(screen.getByRole("button", { name: "Найти" }));

    expect(await screen.findByText("Ничего не найдено")).toBeInTheDocument();
  });

  it("renders a retryable error with the support reference", async () => {
    listMock.mockResolvedValue({
      status: "upstream_unavailable",
    });
    renderAs(["manage_settings"]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Сервер недоступен/);
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });

  it("renders an access-denied state on 403 rather than an empty list", async () => {
    listMock.mockResolvedValue({
      status: "forbidden",
      messageKey: "crm.affiliates.forbidden",
      requestId: "req-1",
    });
    renderAs(["view_affiliate_analytics"], "analyst");
    expect(await screen.findByText("Нет доступа")).toBeInTheDocument();
  });

  it("never renders a fabricated zero for a metric it does not have", async () => {
    listMock.mockResolvedValue({
      status: "success",
      data: {
        items: [partner({ inventory: { campaigns: 0, trackingLinks: 0, activeTrackingLinks: 0 } })],
        total: 1,
        limit: 25,
        offset: 0,
      },
    });
    renderAs(["manage_settings"]);
    await screen.findAllByText("Affiliate Alpha");
    // Zero inventory is legitimate and shown; there is simply no traffic column
    // in which a misleading zero could appear.
    const table = screen.getByRole("table");
    const headers = Array.from(table.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual([
      "Название",
      "Код",
      "Статус",
      "Доступность",
      "Окно",
      "Кампании",
      "Ссылки",
      "Создан",
    ]);
  });
});

/* ------------------------------------------------------------- analyst mode */

describe("read-only analyst mode", () => {
  beforeEach(() => {
    listMock.mockResolvedValue({
      status: "success",
      data: { items: [partner()], total: 1, limit: 25, offset: 0 },
    });
  });

  it("shows the list but offers no create control", async () => {
    renderAs(["view_affiliate_analytics"], "analyst");
    await screen.findAllByText("Affiliate Alpha");
    expect(screen.queryByRole("button", { name: "Новый аффилейт" })).toBeNull();
  });

  it("states plainly that the section is read-only", async () => {
    renderAs(["view_affiliate_analytics"], "analyst");
    await screen.findAllByText("Affiliate Alpha");
    expect(screen.getByText(/Режим только для чтения/)).toBeInTheDocument();
  });

  it("gives a manager the create control and no read-only notice", async () => {
    renderAs(["manage_settings", "view_affiliate_analytics"]);
    await screen.findAllByText("Affiliate Alpha");
    expect(screen.getByRole("button", { name: "Новый аффилейт" })).toBeInTheDocument();
    expect(screen.queryByText(/Режим только для чтения/)).toBeNull();
  });

  it("treats manage_settings alone as full access, since it implies the read", async () => {
    renderAs(["manage_settings"]);
    await screen.findAllByText("Affiliate Alpha");
    expect(screen.getByRole("button", { name: "Новый аффилейт" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------ accessibility */

describe("accessibility", () => {
  beforeEach(() => {
    listMock.mockResolvedValue({
      status: "success",
      data: { items: [partner()], total: 1, limit: 25, offset: 0 },
    });
  });

  it("has one page heading and labelled filter controls", async () => {
    renderAs(["manage_settings"]);
    await screen.findAllByText("Affiliate Alpha");

    expect(screen.getByRole("heading", { level: 1, name: "Аффилейты" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Поиск по названию/)).toBeInTheDocument();
    expect(screen.getByLabelText("Статус")).toBeInTheDocument();
  });

  it("gives the data table an accessible caption", async () => {
    renderAs(["manage_settings"]);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByRole("table")).toHaveAccessibleName("Список аффилейт-партнёров");
  });

  it("labels status with text, never colour alone", async () => {
    renderAs(["manage_settings"]);
    await screen.findAllByText("Affiliate Alpha");
    expect(screen.getAllByText("Активен").length).toBeGreaterThan(0);
  });
});
