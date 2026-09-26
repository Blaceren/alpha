import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { fail, type Paginated } from "@/data/contracts/result";
import type { UserSummary } from "@/domain/users/user";
import { RECOMMENDATION_CATALOG } from "@/domain/recommendations/catalog";
import { MockSessionProvider } from "@/components/crm-shell/session-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UsersWorkspace } from "./users-workspace";
import { UsersTable } from "./users-table";
import { DEFAULT_COLUMN_VISIBILITY } from "./columns/columns";
import { RecommendationCell } from "./components/misc-cells";

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * The search box debounces on a real 300 ms timer and this suite's assertions
 * must sit through it before the work they actually test begins. Measured: 782
 * ms idle against `waitFor`'s 1000 ms budget, 1152 ms under parallel workers —
 * i.e. the assertion was failing on machine speed, not on behaviour. Nothing
 * here is a test OF the debounce, so it is driven to 0 and the assertions
 * measure what they are named after.
 */
function renderWorkspace(provider?: CrmDataProvider) {
  return render(
    <MockSessionProvider>
      <TooltipProvider>
        <UsersWorkspace
          providerOverride={provider ?? new MockCrmDataProvider({ clock: new FixedMockClock(), delayMs: 0 })}
          searchDebounceMs={0}
        />
      </TooltipProvider>
    </MockSessionProvider>,
  );
}

const RAW_CODES = ["at_risk", "checkpoint_grace", "pocket_registration_incomplete", "not_available", "dormant_14d"];

// NOTE: in jsdom, Tailwind's responsive `hidden` classes are not applied, so
// BOTH the desktop table and the mobile cards render — links appear twice.
// Tests use findAllByRole and take the first match.

describe("UsersWorkspace — rendering", () => {
  it("renders users via the provider and links each to User 360", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "Пользователи" });
    // Search scopes to a single, deterministic user (avoids pagination order).
    await userEvent.type(screen.getByPlaceholderText("Имя, email или ID"), "Nina");
    const links = await screen.findAllByRole("link", { name: "Nina Chmiel" });
    expect(links[0]).toHaveAttribute("href", "/users/usr_mock_026");
  });

  it("shows only human-readable labels (no raw enum codes)", async () => {
    const { container } = renderWorkspace();
    await screen.findByRole("heading", { name: "Пользователи" });
    await userEvent.type(screen.getByPlaceholderText("Имя, email или ID"), "Nina");
    await screen.findAllByRole("link", { name: "Nina Chmiel" });
    const text = container.textContent ?? "";
    for (const raw of RAW_CODES) expect(text).not.toContain(raw);
    expect(text).toContain("Активные блокеры"); // human column header present
  });
});

describe("UsersWorkspace — states", () => {
  it("error state offers retry", async () => {
    renderWorkspace(new MockCrmDataProvider({ clock: new FixedMockClock(), delayMs: 0, errorMode: true }));
    expect(await screen.findByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });

  it("empty dataset state", async () => {
    renderWorkspace(new MockCrmDataProvider({ clock: new FixedMockClock(), delayMs: 0, emptyMode: true }));
    expect(await screen.findByText("В базе пока нет пользователей")).toBeInTheDocument();
  });

  it("stale keeps the table visible with a banner", async () => {
    renderWorkspace(new MockCrmDataProvider({ clock: new FixedMockClock(), delayMs: 0, staleMode: true }));
    expect(await screen.findByText(/могли устареть/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0); // table still shown
  });

  it("unauthorized shows a restricted state without partial data", async () => {
    const unauth = new MockCrmDataProvider({ clock: new FixedMockClock(), delayMs: 0 });
    unauth.searchUsers = async () =>
      fail<Paginated<UserSummary>>({ code: "unauthorized", message: "no", retriable: false });
    renderWorkspace(unauth);
    expect(await screen.findByText("Доступ ограничен")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("no-results state with reset after a non-matching search", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "Пользователи" });
    await userEvent.type(screen.getByPlaceholderText("Имя, email или ID"), "zzzzzz");
    expect(await screen.findByText(/пользователи не найдены/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сбросить фильтры" })).toBeInTheDocument();
  });
});

/**
 * D-52: Users must word an action exactly as Today and User 360 do. The
 * expectation is read from the catalog rather than typed here, so this asserts
 * "the screen agrees with the canonical source" — not "the screen prints the
 * string I happened to paste".
 */
describe("UsersWorkspace — recommendation wording (D-52)", () => {
  it("prints the canonical catalog wording for every recommended action", async () => {
    const clock = new FixedMockClock();
    const p = new MockCrmDataProvider({ clock, delayMs: 0 });
    const res = await p.searchUsers(
      { actorId: "emp_mock_admin", role: "crm_admin", now: clock.nowIso() },
      { page: { cursor: null, pageSize: 30 } },
    );
    const users = res.data!.items;
    const withRec = users.filter(
      (u) => u.topRecommendationCode && u.topRecommendationCode !== "no_action_required",
    );
    expect(withRec.length).toBeGreaterThan(0);

    const { container } = render(
      <TooltipProvider>
        <UsersTable
          users={users}
          columnVisibility={{ ...DEFAULT_COLUMN_VISIBILITY, recommendation: true }}
          sort={{ field: "priority", dir: "asc" }}
          onSort={() => {}}
        />
      </TooltipProvider>,
    );
    const text = container.textContent ?? "";

    for (const u of withRec) {
      const code = u.topRecommendationCode!;
      expect(text, `Users must word ${code} as the catalog does`).toContain(
        RECOMMENDATION_CATALOG[code].title,
      );
      // The label, never the raw code.
      expect(text).not.toContain(code);
    }
  });

  it("renders a safe placeholder when there is no recommendation to word", () => {
    const { container } = render(<RecommendationCell code={null} />);
    expect(container.textContent).toBe("—");
  });
});
