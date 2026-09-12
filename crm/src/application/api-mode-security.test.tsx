import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SessionOutcome } from "@/application/session-client";
import {
  getClientRuntimeMode,
  resetClientRuntimeMode,
  setClientRuntimeMode,
} from "@/config/client-runtime-mode";
import { getCrmDataProvider, getCrmMutations, MockProviderUnavailableError } from "@/application/provider";
import { sessionGrants } from "@/domain/identity/access";
import { sessionFromDto, mockSessionForRole } from "@/domain/identity/session";
import { ROLE_PERMISSIONS } from "@/domain/identity/permissions";
import { contextFromSession } from "@/application/context";
import { AppShell } from "@/components/crm-shell/app-shell";
import * as sessionContext from "@/components/crm-shell/session-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/today",
}));

const STORAGE_KEY = "ata-crm.mock-role.v1";

/** A backend session whose role looks powerful but carries no permissions. */
const ADMIN_ROLE_NO_PERMISSIONS = {
  employeeId: "emp_backend_001",
  displayName: "Ирина Соколова",
  role: "crm_admin" as const,
  effectivePermissions: [],
  permissionVersion: 9,
  expiresAt: "2026-07-20T18:30:00.000Z",
};

beforeEach(() => {
  resetClientRuntimeMode();
  window.localStorage.clear();
});
afterEach(() => {
  resetClientRuntimeMode();
  window.localStorage.clear();
});

describe("effectivePermissions is the UI authority", () => {
  it("grants nothing when the backend sends an empty permission list, despite role=crm_admin", () => {
    const session = sessionFromDto(ADMIN_ROLE_NO_PERMISSIONS);
    expect(session.role).toBe("crm_admin");

    // The role-based matrix would grant all twenty (AFD-5A appended
    // view_affiliate_analytics, LEARNER-OPERATIONS-V1 appended its nine,
    // contract v4 appended learner_ops_escalation_resolve, and COMMUNITY-V1
    // appended community_moderate). The session grants none — which is the
    // whole point: the count is incidental, the assertion below is the
    // invariant.
    expect(ROLE_PERMISSIONS.crm_admin.length).toBe(20);
    for (const permission of ROLE_PERMISSIONS.crm_admin) {
      expect(sessionGrants(session, permission)).toBe(false);
    }
  });

  it.each([
    "assign_owner",
    "export",
    "view_audit",
    "edit_user_notes",
    "manage_settings",
  ] as const)("denies %s for an admin role with no effective permissions", (permission) => {
    expect(sessionGrants(sessionFromDto(ADMIN_ROLE_NO_PERMISSIONS), permission)).toBe(false);
  });

  it("grants exactly what the backend sent, no more", () => {
    const session = sessionFromDto({
      ...ADMIN_ROLE_NO_PERMISSIONS,
      role: "read_only",
      effectivePermissions: ["view_audit"],
    });
    expect(sessionGrants(session, "view_audit")).toBe(true);
    expect(sessionGrants(session, "assign_owner")).toBe(false);
    expect(sessionGrants(session, "edit_user_notes")).toBe(false);
  });

  it("keeps mock sessions on the local matrix so mock affordances are unchanged", () => {
    expect(sessionGrants(mockSessionForRole("crm_admin"), "assign_owner")).toBe(true);
    expect(sessionGrants(mockSessionForRole("support"), "edit_user_notes")).toBe(true);
    expect(sessionGrants(mockSessionForRole("support"), "assign_owner")).toBe(false);
    expect(sessionGrants(mockSessionForRole("read_only"), "edit_user_notes")).toBe(false);
  });
});

describe("CrmContext mapping", () => {
  it("maps backend employeeId to actorId", () => {
    const context = contextFromSession(sessionFromDto(ADMIN_ROLE_NO_PERMISSIONS));
    expect(context.actorId).toBe("emp_backend_001");
    expect(context.role).toBe("crm_admin");
  });

  it("never uses the mock actor id for a backend session", () => {
    const context = contextFromSession(sessionFromDto(ADMIN_ROLE_NO_PERMISSIONS));
    expect(context.actorId).not.toBe("emp_mock_admin");
  });

  it("does not read actorId from localStorage", () => {
    window.localStorage.setItem("ata-crm.actor", "emp_attacker");
    const context = contextFromSession(sessionFromDto(ADMIN_ROLE_NO_PERMISSIONS));
    expect(context.actorId).toBe("emp_backend_001");
  });
});

describe("localStorage role cannot influence an API session", () => {
  it("ignores a stored crm_admin role", () => {
    window.localStorage.setItem(STORAGE_KEY, "crm_admin");

    const session = sessionFromDto({
      ...ADMIN_ROLE_NO_PERMISSIONS,
      role: "read_only",
      effectivePermissions: [],
    });

    expect(session.role).toBe("read_only");
    expect(session.effectivePermissions).toEqual([]);
    expect(session.employeeId).toBe("emp_backend_001");
    expect(sessionGrants(session, "assign_owner")).toBe(false);
  });

  it("does not write the mock role key while an API session renders", async () => {
    setClientRuntimeMode("api");
    const impl = async (): Promise<SessionOutcome> => ({
      status: "authenticated",
      dto: ADMIN_ROLE_NO_PERMISSIONS,
    });
    // Render the real boundary through AppShell's api path.
    const { SessionBoundary, ApiSessionConfirmed } = await import(
      "@/components/crm-shell/session-boundary"
    );
    function Harness() {
      return (
        <SessionBoundary fetchSessionImpl={impl as never}>
          <ApiSessionConfirmed session={sessionFromDto(ADMIN_ROLE_NO_PERMISSIONS)} />
        </SessionBoundary>
      );
    }
    render(<Harness />);
    expect(await screen.findByText("Сессия сотрудника подтверждена")).toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("never calls mockSessionForRole in the api path", async () => {
    const spy = vi.spyOn(sessionContext, "MockSessionProvider");
    setClientRuntimeMode("api");
    render(
      <AppShell mode="api">
        <p>CRM FEATURE CHILD</p>
      </AppShell>,
    );
    // The mock provider component is the only producer of mockSessionForRole.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("MockCrmDataProvider is unreachable in api mode", () => {
  it("throws rather than handing back the mock provider", () => {
    setClientRuntimeMode("api");
    expect(() => getCrmDataProvider()).toThrow(MockProviderUnavailableError);
    expect(() => getCrmMutations()).toThrow(MockProviderUnavailableError);
  });

  it("throws for every demo state", () => {
    setClientRuntimeMode("api");
    for (const state of ["default", "stale", "empty", "error"] as const) {
      expect(() => getCrmDataProvider(state)).toThrow(MockProviderUnavailableError);
    }
  });

  it("still returns the mock provider in mock mode", () => {
    setClientRuntimeMode("mock");
    expect(getCrmDataProvider()).toBeDefined();
    expect(getCrmMutations()).toBeDefined();
  });

  it("defaults to mock so hook tests without the shell behave as before", () => {
    expect(getClientRuntimeMode()).toBe("mock");
    expect(getCrmDataProvider()).toBeDefined();
  });
});

describe("api-mode landing shows no mock CRM data and no sensitive session fields", () => {
  it("renders the truthful confirmation only", async () => {
    setClientRuntimeMode("api");
    render(
      <AppShell mode="api">
        <p>CRM FEATURE CHILD</p>
      </AppShell>,
    );
    // Feature children never mount, even before the fetch resolves.
    expect(screen.queryByText("CRM FEATURE CHILD")).not.toBeInTheDocument();
  });

  it("hides employeeId, permissions, expiry and version", async () => {
    const { ApiSessionConfirmed } = await import("@/components/crm-shell/session-boundary");
    render(<ApiSessionConfirmed session={sessionFromDto(ADMIN_ROLE_NO_PERMISSIONS)} />);

    expect(screen.getByText("Сессия сотрудника подтверждена")).toBeInTheDocument();
    expect(screen.getByText("Ирина Соколова")).toBeInTheDocument();

    const html = document.body.innerHTML;
    expect(html).not.toContain("emp_backend_001");
    expect(html).not.toContain("effectivePermissions");
    expect(html).not.toContain("2026-07-20T18:30:00.000Z");
    expect(html).not.toContain("permissionVersion");
    // No developer JSON dump.
    expect(html).not.toContain("{&quot;");
  });
});

describe("expiresAt and permissionVersion are not authorization", () => {
  it("an expired timestamp does not change what the session grants", () => {
    const expired = sessionFromDto({
      ...ADMIN_ROLE_NO_PERMISSIONS,
      effectivePermissions: ["view_audit"],
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    // The client does not police expiry — the backend does. The grant is
    // unchanged, proving no client-side authorization decision was made on it.
    expect(sessionGrants(expired, "view_audit")).toBe(true);
  });

  it("permissionVersion does not gate anything", () => {
    const v1 = sessionFromDto({ ...ADMIN_ROLE_NO_PERMISSIONS, permissionVersion: 1, effectivePermissions: ["export"] });
    const v99 = sessionFromDto({ ...ADMIN_ROLE_NO_PERMISSIONS, permissionVersion: 99, effectivePermissions: ["export"] });
    expect(sessionGrants(v1, "export")).toBe(sessionGrants(v99, "export"));
  });
});
