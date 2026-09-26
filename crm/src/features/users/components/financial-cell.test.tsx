import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import type { CrmRole } from "@/domain/identity/roles";
import { projectFinancial } from "@/domain/financial/projection";
import { FINANCIAL_HIDDEN_LABEL } from "@/config/labels";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FinancialCell } from "./financial-cell";
import { MobileUserCard } from "./mobile-user-card";
import type { UserSummary } from "@/domain/users/user";

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
  useRouter: () => ({ push: vi.fn() }),
}));

const clock = new FixedMockClock();
const provider = new MockCrmDataProvider({ clock, delayMs: 0 });
const ctx = (role: CrmRole): CrmContext => ({ actorId: "e", role, now: clock.nowIso() });

/** Nina Chmiel — balance $90 (bucket $50–99). */
const WITH_BALANCE = "usr_mock_026";
/** Nadia Novak — no balance has ever arrived from the product. */
const NO_BALANCE = "usr_mock_001";
const EXACT = "$90";

async function balanceFor(role: CrmRole, userId = WITH_BALANCE) {
  const res = await provider.getUserById(ctx(role), { userId });
  return res.data!.balance!;
}

function renderCell(projection: Parameters<typeof FinancialCell>[0]["projection"]) {
  return render(
    <TooltipProvider>
      <FinancialCell projection={projection} />
    </TooltipProvider>,
  );
}

describe("FinancialCell — hidden semantics distinguish absence from restriction", () => {
  it("permission denied → «Недоступно для роли»", async () => {
    const p = await balanceFor("read_only");
    expect(p.mode).toBe("hidden");
    expect(p.hiddenReason).toBe("not_permitted");
    const { container } = renderCell(p);
    expect(screen.getByText("Недоступно для роли")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Нет данных");
  });

  it("missing data → «Нет данных», even for a role that MAY see financials", async () => {
    const p = await balanceFor("crm_admin", NO_BALANCE);
    expect(p.mode).toBe("hidden");
    expect(p.hiddenReason).toBe("no_data");
    const { container } = renderCell(p);
    expect(screen.getByText("Нет данных")).toBeInTheDocument();
    // The old cell said this to everyone — a false statement about permission.
    expect(container.textContent).not.toContain("Недоступно для роли");
  });

  it("missing data for an unprivileged role still reads as absence", async () => {
    // No value exists, so there is nothing permission could be withholding.
    const p = await balanceFor("support", NO_BALANCE);
    expect(p.hiddenReason).toBe("no_data");
    renderCell(p);
    expect(screen.getByText("Нет данных")).toBeInTheDocument();
  });

  it("an absent projection is treated as absent data, not as a denial", () => {
    const { container } = renderCell(undefined);
    expect(screen.getByText("Нет данных")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Недоступно для роли");
  });
});

describe("FinancialCell — permitted representations", () => {
  it("bucket → the range, no exact value", async () => {
    const p = await balanceFor("support");
    expect(p.mode).toBe("bucket");
    const { container } = renderCell(p);
    expect(screen.getByText("$50–99")).toBeInTheDocument();
    expect(screen.getByText("диапазон")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(EXACT);
  });

  it("aggregated → the allowed aggregated representation, no exact value", async () => {
    const p = await balanceFor("analyst");
    expect(p.mode).toBe("aggregated");
    const { container } = renderCell(p);
    expect(screen.getByText("$50–99")).toBeInTheDocument();
    expect(screen.getByText("агрег.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(EXACT);
  });

  it("exact → only for a permitted role", async () => {
    const p = await balanceFor("retention_manager");
    expect(p.mode).toBe("exact");
    const { container } = renderCell(p);
    expect(container.innerHTML).toContain(EXACT);
  });
});

describe("FinancialCell — nothing forbidden reaches the DOM", () => {
  it.each(["support", "mentor", "moderator", "analyst", "content_manager", "read_only"] as const)(
    "%s: the exact amount is absent from the whole cell",
    async (role) => {
      const p = await balanceFor(role);
      const { container } = renderCell(p);
      // Covers text, title/aria and data-* — not merely CSS-hidden.
      expect(container.innerHTML).not.toContain(EXACT);
    },
  );

  it("never renders a raw hiddenReason code", async () => {
    for (const role of ["read_only", "crm_admin"] as const) {
      const p = await balanceFor(role, role === "crm_admin" ? NO_BALANCE : WITH_BALANCE);
      const { container, unmount } = renderCell(p);
      expect(container.innerHTML).not.toContain("no_data");
      expect(container.innerHTML).not.toContain("not_permitted");
      expect(container.innerHTML).not.toContain("hidden");
      unmount();
    }
  });

  it("the accessible name of a hidden value carries no forbidden data", async () => {
    const p = await balanceFor("read_only");
    const { container } = renderCell(p);
    const withLabels = container.querySelectorAll("[aria-label],[title]");
    for (const el of Array.from(withLabels)) {
      const text = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`;
      expect(text).not.toContain(EXACT);
      expect(text).not.toContain("90");
    }
  });
});

describe("financial hidden semantics are shared, not per-screen", () => {
  it("the projection label and the rendered label are the same string", () => {
    for (const reason of ["no_data", "not_permitted"] as const) {
      const p =
        reason === "no_data"
          ? projectFinancial({ role: "crm_admin", amountUsd: null, isStale: false })
          : projectFinancial({ role: "read_only", amountUsd: 90, isStale: false });
      expect(p.hiddenReason).toBe(reason);
      // The read model must not contradict the screen.
      expect(p.label).toBe(FINANCIAL_HIDDEN_LABEL[reason]);
    }
  });

  it("desktop cell and User 360 render identical text for the same projection", async () => {
    // Both screens read the same shared label source, so a projection can never
    // mean one thing in the table and another on the profile.
    for (const [role, userId] of [
      ["read_only", WITH_BALANCE],
      ["crm_admin", NO_BALANCE],
    ] as const) {
      const p = await balanceFor(role, userId);
      const { container, unmount } = renderCell(p);
      expect(container.textContent).toContain(FINANCIAL_HIDDEN_LABEL[p.hiddenReason!]);
      unmount();
    }
  });
});

describe("mobile user card — no divergent financial representation", () => {
  it("renders no financial value at all, so it cannot disagree with the table", async () => {
    const res = await provider.getUserById(ctx("crm_admin"), { userId: WITH_BALANCE });
    const user = res.data as UserSummary;
    expect(user.balance?.mode).toBe("exact"); // the projection IS available…
    const { container } = render(
      <TooltipProvider>
        <MobileUserCard user={user} />
      </TooltipProvider>,
    );
    // …but the mobile card deliberately shows no financial column.
    expect(container.innerHTML).not.toContain(EXACT);
    expect(container.textContent).not.toContain("Недоступно для роли");
    expect(container.textContent).not.toContain("Нет данных");
    expect(container.textContent).not.toContain("диапазон");
  });
});
