import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CrmRole } from "@/domain/identity/roles";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MockSessionProvider, useSession } from "@/components/crm-shell/session-context";
import { SidebarNav } from "./sidebar-nav";

// Pin the pathname so the component renders deterministically.
vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
}));

function RoleSetter({ role }: { role: CrmRole }) {
  // setRole is non-null inside MockSessionProvider; it is null only for a
  // backend session, which this mock-mode test never mounts.
  const { setRole } = useSession();
  React.useEffect(() => setRole?.(role), [role, setRole]);
  return null;
}

function renderNavForRole(role: CrmRole) {
  return render(
    <MockSessionProvider>
      <TooltipProvider>
        <RoleSetter role={role} />
        <SidebarNav />
      </TooltipProvider>
    </MockSessionProvider>,
  );
}

describe("SidebarNav role visibility", () => {
  it("shows Settings for crm_admin", () => {
    renderNavForRole("crm_admin");
    expect(screen.getByRole("link", { name: "Настройки" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Сегодня" })).toBeInTheDocument();
  });

  it("hides Settings and Tasks for read_only", () => {
    renderNavForRole("read_only");
    expect(screen.getByRole("link", { name: "Сегодня" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Настройки" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Задачи" })).toBeNull();
  });
});
