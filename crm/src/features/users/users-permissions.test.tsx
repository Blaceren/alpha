import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FinancialCell } from "./components/financial-cell";
import { UserCell } from "./components/user-cell";
import type { UserSummary } from "@/domain/users/user";

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
  useRouter: () => ({ push: vi.fn() }),
}));

const clock = new FixedMockClock();
const ctx = (role: CrmContext["role"]): CrmContext => ({ actorId: "e", role, now: clock.nowIso() });
const provider = new MockCrmDataProvider({ clock, delayMs: 0 });

const FULL_EMAIL = "yulia.sowa@example.test";

async function summaryFor(role: CrmContext["role"]): Promise<UserSummary> {
  const res = await provider.getUserById(ctx(role), { userId: "usr_mock_017" });
  return res.data!;
}

describe("financial permission projection in the DOM", () => {
  it("retention (allowed) sees the exact value", async () => {
    const u = await summaryFor("retention_manager");
    expect(u.balance?.mode).toBe("exact");
    expect(u.balance?.amountUsd).not.toBeNull();
    render(
      <TooltipProvider>
        <FinancialCell projection={u.balance} />
      </TooltipProvider>,
    );
    expect(screen.getByText(u.balance!.label)).toBeInTheDocument();
  });

  it("support (denied) never has the exact value in the DOM (bucket only)", async () => {
    const exactLabel = (await summaryFor("retention_manager")).balance!.label; // e.g. "$220"
    const u = await summaryFor("support");
    expect(u.balance?.mode).toBe("bucket");
    expect(u.balance?.amountUsd).toBeNull();
    const { container } = render(
      <TooltipProvider>
        <FinancialCell projection={u.balance} />
      </TooltipProvider>,
    );
    // The exact value string is absent from the rendered HTML (incl. title/data-*).
    expect(container.innerHTML).not.toContain(exactLabel);
    expect(container.textContent).toMatch(/–|диапазон/);
  });

  it("read_only sees a hidden placeholder, not a value", async () => {
    const u = await summaryFor("read_only");
    expect(u.balance?.mode).toBe("hidden");
    const { container } = render(
      <TooltipProvider>
        <FinancialCell projection={u.balance} />
      </TooltipProvider>,
    );
    expect(container.innerHTML).not.toContain("520");
    expect(screen.getByText("Недоступно для роли")).toBeInTheDocument();
  });

  it("analyst gets an aggregated (bucket) representation, no exact value", async () => {
    const u = await summaryFor("analyst");
    expect(u.balance?.mode).toBe("aggregated");
    expect(u.balance?.amountUsd).toBeNull();
  });
});

describe("identity projection in the list is always masked", () => {
  it("support sees masked email, never the full synthetic email", async () => {
    const u = await summaryFor("support");
    expect(u.identity?.mode).toBe("masked");
    const { container } = render(<UserCell user={u} />);
    expect(container.innerHTML).not.toContain(FULL_EMAIL);
    expect(container.textContent).toContain("Yulia");
  });

  it("even privileged retention role gets masked identity in the LIST context", async () => {
    const u = await summaryFor("retention_manager");
    expect(u.identity?.mode).toBe("masked");
    const { container } = render(<UserCell user={u} />);
    expect(container.innerHTML).not.toContain(FULL_EMAIL);
  });
});
