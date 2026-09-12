import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmRole } from "@/domain/identity/roles";
import { mockSessionForRole } from "@/domain/identity/session";
import { TooltipProvider } from "@/components/ui/tooltip";
import { User360Workspace } from "./user-360-workspace";

vi.mock("next/navigation", () => ({
  usePathname: () => "/users/usr_mock_026",
  useRouter: () => ({ push: vi.fn() }),
}));

// The role drives the whole session → context → provider → projection path.
// jsdom here has no localStorage, so the session is injected directly.
// Sessions are cached per role because the query effect depends on the session's
// identity (the real MockSessionProvider memoizes it) — a fresh object per render
// would re-fire the provider read in a loop.
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
const provider = new MockCrmDataProvider({ clock, delayMs: 0 });

const HIGH_PRIORITY = "usr_mock_026";
const FULL_EMAIL = "nina.chmiel@example.test";
const EXACT_BALANCE = "$90";

/** Renders the real workspace as `role`, against the real mock provider. */
async function renderAs(role: CrmRole, userId = HIGH_PRIORITY) {
  currentRole = role;
  const utils = render(
    <TooltipProvider>
      <User360Workspace userId={userId} providerOverride={provider} />
    </TooltipProvider>,
  );
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return utils;
}

describe("User 360 — financial permission in the DOM", () => {
  it("admin sees the exact balance", async () => {
    const { container } = await renderAs("crm_admin");
    expect(container.innerHTML).toContain(EXACT_BALANCE);
  });

  it("support sees a bucket and the exact amount is nowhere in the DOM", async () => {
    const { container } = await renderAs("support");
    expect(screen.getAllByText("$50–99").length).toBeGreaterThan(0);
    // Covers text, title/aria attributes and data-* — the value is simply absent.
    expect(container.innerHTML).not.toContain(EXACT_BALANCE);
  });

  it("support cannot derive the balance from the checkpoint grid", async () => {
    const { container } = await renderAs("support");
    expect(container.innerHTML).not.toContain("$100");
    expect(container.innerHTML).not.toContain("осталось 10%");
  });

  it("read_only sees an explicit permission restriction, not a value", async () => {
    const { container } = await renderAs("read_only");
    expect(screen.getAllByText("Недоступно для роли").length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain(EXACT_BALANCE);
    expect(container.innerHTML).not.toContain("$50–99");
  });

  it("mentor sees learning context with bucket financials", async () => {
    const { container } = await renderAs("mentor");
    expect(screen.getAllByText("$50–99").length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain(EXACT_BALANCE);
    expect(screen.getByText("Advanced setups")).toBeInTheDocument();
  });

  it("retention_manager sees the exact balance (permitted)", async () => {
    const { container } = await renderAs("retention_manager");
    expect(container.innerHTML).toContain(EXACT_BALANCE);
  });

  it("says 'no data' — not 'no permission' — when no balance exists", async () => {
    const { container } = await renderAs("crm_admin", "usr_mock_001");
    expect(screen.getAllByText("Нет данных").length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("Недоступно для роли");
  });
});

describe("User 360 — identity permission in the DOM", () => {
  it("admin sees the full email (detail context grants it)", async () => {
    const { container } = await renderAs("crm_admin");
    expect(container.innerHTML).toContain(FULL_EMAIL);
  });

  it("support sees a masked email, never the full one", async () => {
    const { container } = await renderAs("support");
    expect(container.innerHTML).not.toContain(FULL_EMAIL);
    expect(container.innerHTML).toContain("n2***@e***.test");
  });

  it("mentor sees a masked email", async () => {
    const { container } = await renderAs("mentor");
    expect(container.innerHTML).not.toContain(FULL_EMAIL);
    expect(screen.getByRole("heading", { level: 1, name: "Nina Chmiel" })).toBeInTheDocument();
  });

  it("analyst sees a pseudonymous id and no name or email", async () => {
    const { container } = await renderAs("analyst");
    expect(container.innerHTML).not.toContain(FULL_EMAIL);
    expect(container.innerHTML).not.toContain("Nina Chmiel");
    expect(screen.getByRole("heading", { level: 1, name: "anon_026" })).toBeInTheDocument();
  });

  it("content_manager gets no identity, and is told so", async () => {
    const { container } = await renderAs("content_manager");
    expect(container.innerHTML).not.toContain("Nina Chmiel");
    expect(container.innerHTML).not.toContain(FULL_EMAIL);
    expect(screen.getByText(/Идентификация недоступна для вашей роли/)).toBeInTheDocument();
  });
});
