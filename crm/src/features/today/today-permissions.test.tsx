/**
 * Today role projection, proved at the RENDERED level (Phase 1B3 §11/§23/§24).
 *
 * The builder tests prove a forbidden value is never produced. These prove the
 * screen agrees: nothing forbidden reaches the DOM, an aria/title attribute, or
 * a data-* attribute — and that switching role rebuilds the queue rather than
 * leaving the previous role's data behind.
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { buildDataset } from "@/data/mock/fixtures/build";
import { mockSessionForRole } from "@/domain/identity/session";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { TodayWorkspace } from "./today-workspace";

// Same approach as user-360-permissions: jsdom here has no localStorage, so the
// session is injected directly. Sessions are cached per role because the query
// effect depends on the session's identity — a fresh object per render would
// re-fire the provider read in a loop.
const SESSIONS = new Map<CrmRole, ReturnType<typeof mockSessionForRole>>();
const sessionFor = (role: CrmRole) => {
  if (!SESSIONS.has(role)) SESSIONS.set(role, mockSessionForRole(role));
  return SESSIONS.get(role)!;
};
let currentRole: CrmRole = "crm_admin";
vi.mock("@/components/crm-shell/session-context", () => ({
  useSession: () => ({ session: sessionFor(currentRole), setRole: vi.fn() }),
}));

const clock = new FixedMockClock();
const users = buildDataset(clock);

/** Renders the real workspace as `role`, against the real mock provider. */
/**
 * The search box debounces on a real 300 ms timer and this suite's assertions
 * must sit through it before the work they actually test begins. Measured: 782
 * ms idle against `waitFor`'s 1000 ms budget, 1152 ms under parallel workers —
 * i.e. the assertion was failing on machine speed, not on behaviour. Nothing
 * here is a test OF the debounce, so it is driven to 0 and the assertions
 * measure what they are named after.
 */
function renderAs(role: CrmRole) {
  currentRole = role;
  return render(
    <TooltipProvider>
      <TodayWorkspace
        providerOverride={new MockCrmDataProvider({ clock, delayMs: 0 })}
        searchDebounceMs={0}
      />
    </TooltipProvider>,
  );
}

const settled = async () =>
  waitFor(() => expect(screen.getAllByRole("link", { name: /Открыть профиль/ }).length).toBeGreaterThan(0));

/** Exact balances that exist in the dataset and are not part of a bucket label. */
const EXACT_AMOUNTS = ["$180", "$70", "$82", "$95", "$88", "$130", "$60", "$75", "$80"];

const EXACT_ROLES: CrmRole[] = ["crm_admin", "crm_manager", "retention_manager"];
const NON_EXACT_ROLES = CRM_ROLES.filter((r) => !EXACT_ROLES.includes(r));

describe("Today — financial privacy on screen", () => {
  it.each(NON_EXACT_ROLES)("%s: no exact amount in text, attributes or the DOM", async (role) => {
    const { container } = renderAs(role);
    await settled();

    const html = container.innerHTML;
    const text = container.textContent ?? "";
    for (const amount of EXACT_AMOUNTS) {
      expect(text, `${amount} rendered for ${role}`).not.toContain(amount);
      // Covers title/aria-label/data-* too — innerHTML is everything served.
      expect(html, `${amount} in an attribute for ${role}`).not.toContain(amount);
    }
    // The percentage that would reconstruct a balance from the published grid.
    expect(text).not.toMatch(/осталось \d+%/);
  });

  it.each(EXACT_ROLES)("%s does see exact amounts — the assertion can fail", async (role) => {
    const { container } = renderAs(role);
    await settled();
    const text = container.textContent ?? "";
    expect(EXACT_AMOUNTS.some((a) => text.includes(a))).toBe(true);
  });

  it("support sees a bucket where an admin sees the exact value", async () => {
    const support = renderAs("support");
    await settled();
    expect(support.container.textContent).toContain("$50–99");
    expect(support.container.textContent).not.toContain("$70");
    support.unmount();

    const admin = renderAs("crm_admin");
    await settled();
    expect(admin.container.textContent).toContain("$70");
  });
});

describe("Today — identity privacy on screen", () => {
  it.each(CRM_ROLES)("%s: no full email is ever rendered", async (role) => {
    const { container } = renderAs(role);
    await settled();
    const html = container.innerHTML;
    for (const u of users) {
      expect(html, `full email leaked for ${role}`).not.toContain(u.identity.fullEmail);
    }
  });

  it("an analyst sees pseudonyms, never names", async () => {
    const { container } = renderAs("analyst");
    await settled();
    const html = container.innerHTML;
    expect(html).toMatch(/anon_/);
    for (const u of users) {
      expect(html).not.toContain(u.identity.displayName);
      expect(html).not.toContain(u.identity.maskedEmail);
    }
  });

  it("a content_manager sees no identity, but can still open the profile", async () => {
    const { container } = renderAs("content_manager");
    await settled();
    for (const u of users) {
      expect(container.innerHTML).not.toContain(u.identity.displayName);
    }
    expect(screen.getAllByText("Без идентификации").length).toBeGreaterThan(0);
    // The platform id is not identity — it is how the row is still actionable.
    expect(container.innerHTML).toContain("usr_mock_026");
  });
});

describe("Today — role switch does not leave stale forbidden data", () => {
  it("drops a search typed against the previous role's identity projection", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const view = renderAs("crm_admin");
    await settled();

    // Search by a name only a role that receives names could know.
    await user.type(screen.getByLabelText("Поиск по очереди"), "Nina");
    await waitFor(() =>
      // Desktop row + mobile card both render, hence two links for one user.
      expect(screen.getAllByRole("link", { name: /Открыть профиль/ })).toHaveLength(2),
    );

    // Switching role re-renders the same tree with a new session.
    currentRole = "analyst";
    view.rerender(
      <TooltipProvider>
        <TodayWorkspace providerOverride={new MockCrmDataProvider({ clock, delayMs: 0 })} />
      </TooltipProvider>,
    );

    // The string is dropped rather than re-applied: re-running it would ask the
    // projection a question it exists to refuse (§24).
    await waitFor(() =>
      expect((screen.getByLabelText("Поиск по очереди") as HTMLInputElement).value).toBe(""),
    );
    await settled();
  });

  it("an analyst cannot find a user by the name it never received", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderAs("analyst");
    await settled();

    await user.type(screen.getByLabelText("Поиск по очереди"), "Nina");
    // No name index exists client-side for this role to match against.
    expect(await screen.findByText("По выбранным фильтрам ничего не найдено")).toBeInTheDocument();
  });
});

describe("Today — recommendations a role may not perform", () => {
  it("marks them rather than hiding them", async () => {
    renderAs("support");
    await settled();
    // Support may follow up on support, but not on a mentor review.
    expect(screen.getAllByText(/не для вашей роли/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Follow-up ментора").length).toBeGreaterThan(0);
  });
});
