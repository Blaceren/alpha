import { describe, expect, it } from "vitest";
import {
  canAssignOwner,
  canManageSettings,
  canRevealPii,
  canViewAudit,
  canViewExactFinancials,
  canViewSection,
  visibleSections,
} from "./access";
import { CRM_ROLES } from "./roles";
import { SECTION_ORDER } from "@/config/navigation";

describe("permission matrix (ROLE_PERMISSION_MATRIX.md)", () => {
  it("exposes exactly nine canonical roles", () => {
    expect(CRM_ROLES).toHaveLength(9);
    expect(CRM_ROLES).toContain("crm_admin");
    expect(CRM_ROLES).toContain("read_only");
  });

  it("grants exact financials only to admin/manager/retention (D-07)", () => {
    expect(canViewExactFinancials("crm_admin")).toBe(true);
    expect(canViewExactFinancials("crm_manager")).toBe(true);
    expect(canViewExactFinancials("retention_manager")).toBe(true);
    expect(canViewExactFinancials("support")).toBe(false);
    expect(canViewExactFinancials("analyst")).toBe(false);
    expect(canViewExactFinancials("read_only")).toBe(false);
  });

  it("restricts PII reveal and settings management", () => {
    expect(canRevealPii("crm_admin")).toBe(true);
    expect(canRevealPii("mentor")).toBe(false);
    expect(canManageSettings("crm_admin")).toBe(true);
    expect(canManageSettings("crm_manager")).toBe(false);
  });

  it("limits owner assignment and global audit", () => {
    expect(canAssignOwner("retention_manager")).toBe(true);
    expect(canAssignOwner("support")).toBe(false);
    expect(canViewAudit("crm_manager")).toBe(true);
    expect(canViewAudit("content_manager")).toBe(false);
  });
});

describe("section visibility", () => {
  it("shows Today to every role but hides Settings from most", () => {
    for (const role of CRM_ROLES) {
      expect(canViewSection(role, "today")).toBe(true);
    }
    expect(canViewSection("crm_admin", "settings")).toBe(true);
    expect(canViewSection("mentor", "settings")).toBe(false);
  });

  it("hides mentor queue from support and vice-versa", () => {
    expect(canViewSection("mentor", "mentor")).toBe(true);
    expect(canViewSection("support", "mentor")).toBe(false);
    expect(canViewSection("support", "support")).toBe(true);
    expect(canViewSection("mentor", "support")).toBe(false);
  });

  it("visibleSections filters the ordered nav for a role", () => {
    const readOnly = visibleSections("read_only", SECTION_ORDER);
    expect(readOnly).toContain("today");
    expect(readOnly).not.toContain("settings");
    expect(readOnly).not.toContain("tasks");
    // Admin sees everything in the nav.
    expect(visibleSections("crm_admin", SECTION_ORDER)).toEqual(SECTION_ORDER);
  });
});
