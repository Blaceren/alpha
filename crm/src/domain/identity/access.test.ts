import { describe, expect, it } from "vitest";
import {
  canAssignOwner,
  canEditUserNotes,
  canManageSettings,
  canRevealPii,
  canViewAudit,
  canViewExactFinancials,
  canViewIdentity,
  canViewSection,
  visibleSections,
} from "./access";
import { CRM_ROLES } from "./roles";
import { SECTION_ORDER } from "@/config/navigation";

describe("permission matrix (ROLE_PERMISSION_MATRIX.md)", () => {
  it("exposes exactly ten canonical roles", () => {
    // PHASE-1 ADMIN appended `progression_operator`.
    expect(CRM_ROLES).toHaveLength(10);
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

/**
 * Edit → notes (ROLE_PERMISSION_MATRIX §1, DECISIONS D-53). Phase 1B4-A reads the
 * Edit column literally: Full covers every entity; among the Limited roles only
 * `support` names notes in its scope.
 */
describe("canEditUserNotes", () => {
  it("grants the three Edit=Full roles", () => {
    expect(canEditUserNotes("crm_admin")).toBe(true);
    expect(canEditUserNotes("crm_manager")).toBe(true);
    expect(canEditUserNotes("retention_manager")).toBe(true);
  });

  it("grants support, the only Edit=Limited role whose scope names notes", () => {
    expect(canEditUserNotes("support")).toBe(true);
  });

  it("denies Edit=Limited roles whose scope does not name notes", () => {
    expect(canEditUserNotes("mentor")).toBe(false);
    expect(canEditUserNotes("moderator")).toBe(false);
    expect(canEditUserNotes("content_manager")).toBe(false);
  });

  it("denies the Edit=None roles", () => {
    expect(canEditUserNotes("analyst")).toBe(false);
    expect(canEditUserNotes("read_only")).toBe(false);
  });

  it("decides for all nine roles with no role left undefined", () => {
    for (const role of CRM_ROLES) {
      expect(typeof canEditUserNotes(role)).toBe("boolean");
    }
    expect(CRM_ROLES.filter(canEditUserNotes)).toHaveLength(4);
  });

  it("is not derived from financial visibility: support edits notes but sees no exact amounts", () => {
    expect(canEditUserNotes("support")).toBe(true);
    expect(canViewExactFinancials("support")).toBe(false);
  });

  it("is not derived from assign_owner: support edits notes but assigns no owner", () => {
    expect(canEditUserNotes("support")).toBe(true);
    expect(canAssignOwner("support")).toBe(false);
  });

  it("does not widen any existing view permission for support", () => {
    expect(canViewIdentity("support")).toBe(false);
    expect(canRevealPii("support")).toBe(false);
    expect(canViewAudit("support")).toBe(false);
    expect(canManageSettings("support")).toBe(false);
  });
});
