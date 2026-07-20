import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MockSessionProvider } from "@/components/crm-shell/session-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UsersWorkspace } from "./users-workspace";
import { UsersToolbar } from "./users-toolbar";
import { UsersTable } from "./users-table";
import { BlockersCell } from "./components/blockers-cell";
import { OwnerCell } from "./components/misc-cells";
import { PriorityCell } from "./components/priority-cell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderWorkspace() {
  return render(
    <MockSessionProvider>
      <TooltipProvider>
        <UsersWorkspace providerOverride={new MockCrmDataProvider({ clock: new FixedMockClock(), delayMs: 0 })} />
      </TooltipProvider>
    </MockSessionProvider>,
  );
}

describe("Phase 1B2.1 — Russian terminology", () => {
  it("uses Russian column terms and shows no English Lifecycle/Engagement/Owner", async () => {
    const { container } = renderWorkspace();
    await screen.findByRole("heading", { name: "Пользователи" });
    await userEvent.type(screen.getByPlaceholderText("Имя, email или ID"), "Nina");
    await screen.findAllByRole("link", { name: /Открыть профиль/ });
    const text = container.textContent ?? "";
    // Russian terms present (headers / filters).
    for (const term of ["Этап", "Активность", "Ответственный", "Состояния", "Регистрация Pocket"]) {
      expect(text).toContain(term);
    }
    // English dimension names must not leak into the UI.
    for (const eng of ["Lifecycle", "LIFECYCLE", "Engagement", "ENGAGEMENT", "Owner"]) {
      expect(text).not.toContain(eng);
    }
  });
});

describe("Phase 1B2.1 — row density & action", () => {
  it("owner renders as one logical label (e.g. 'Support 1'), not split lines", () => {
    const { container } = render(<OwnerCell ownerId="emp_sup1" />);
    expect(container.textContent).toBe("Support 1");
    expect(container.querySelector("span")?.className).toContain("whitespace-nowrap");
  });

  it("blocker overflow collapses into a +N chip", () => {
    render(
      <TooltipProvider>
        <BlockersCell blockers={["email_unconfirmed", "report_pending", "mentor_blocked"]} />
      </TooltipProvider>,
    );
    // At least one "+N" overflow chip is rendered (responsive desktop/tablet variants).
    expect(screen.getAllByText(/^\+\d+$/).length).toBeGreaterThan(0);
  });

  it("priority reason is available (accessible text) as a single concise line", () => {
    render(
      <TooltipProvider>
        <PriorityCell priority="critical" reasonCode="critical_support_issue" />
      </TooltipProvider>,
    );
    expect(screen.getAllByText("Критический support-блокер").length).toBeGreaterThan(0);
  });

  it("row action exposes an accessible name including the user name", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "Пользователи" });
    await userEvent.type(screen.getByPlaceholderText("Имя, email или ID"), "Nina");
    const actions = await screen.findAllByRole("link", { name: "Открыть профиль Nina Chmiel" });
    expect(actions[0]).toHaveAttribute("href", "/users/usr_mock_026");
  });
});

describe("Phase 1B2.2 — sticky row action", () => {
  it("row action stays present with all optional columns visible", async () => {
    const clock = new FixedMockClock();
    const provider = new MockCrmDataProvider({ clock, delayMs: 0 });
    const res = await provider.searchUsers(
      { actorId: "e", role: "crm_admin", now: clock.nowIso() },
      { page: { cursor: null, pageSize: 5 } },
    );
    const users = res.data!.items;
    render(
      <TooltipProvider>
        <UsersTable
          users={users}
          columnVisibility={{
            valueSegments: true,
            recommendation: true,
            registrationStatus: true,
            campaign: true,
            balance: true,
            netDeposits: true,
          }}
          sort={{ field: "priority", dir: "asc" }}
          onSort={() => {}}
        />
      </TooltipProvider>,
    );
    // One action link per user (in the desktop table).
    expect(screen.getAllByRole("link", { name: /Открыть профиль/ }).length).toBeGreaterThanOrEqual(users.length);
  });
});

describe("Phase 1B2.1 — mobile filter count", () => {
  it("filters button shows the active filter count", () => {
    const noop = () => {};
    render(
      <TooltipProvider>
        <UsersToolbar
          search=""
          onSearch={noop}
          filters={{}}
          setFilters={noop}
          clearFilter={noop}
          resetFilters={noop}
          activeFilterCount={2}
          columnVisible={{
            valueSegments: false,
            recommendation: false,
            registrationStatus: false,
            campaign: false,
            balance: false,
            netDeposits: false,
          }}
          onToggleColumn={noop}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: /Фильтры \(2\)/ })).toBeInTheDocument();
  });
});
