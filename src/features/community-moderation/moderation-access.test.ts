/**
 * COMMUNITY-V1 — the role matrix for the moderation section, with its negative
 * controls.
 *
 * FRONTEND VISIBILITY IS NOT THE SECURITY BOUNDARY (D-12). The backend asserts
 * `community_moderate` on every request, and the negative control that matters
 * is the API one, in the backend suite. What these tests hold is the other
 * half: a role that cannot act must not be shown a section it cannot use, and
 * — the part that actually bites — moderation must not have quietly become
 * reachable to a role that holds operational permissions for other reasons.
 */
import { describe, expect, it } from "vitest";
import { canViewSection, visibleSections } from "@/domain/identity/access";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { SECTION_ORDER } from "@/config/navigation";

const AUTHORIZED: CrmRole[] = ["crm_admin", "moderator"];

describe("Community moderation section visibility", () => {
  it("is visible to exactly crm_admin and moderator", () => {
    for (const role of CRM_ROLES) {
      expect(canViewSection(role, "community_moderation"), role).toBe(
        AUTHORIZED.includes(role),
      );
    }
  });

  it("is hidden from the operational roles that run Learner Operations", () => {
    // These roles hold real operational authority. None of it is Community
    // moderation, and holding `learner_ops_admin` must not imply it.
    for (const role of ["crm_manager", "retention_manager", "support", "mentor"] as const) {
      expect(canViewSection(role, "community_moderation"), role).toBe(false);
    }
  });

  it("is hidden from the read-only and analyst roles", () => {
    expect(canViewSection("read_only", "community_moderation")).toBe(false);
    expect(canViewSection("analyst", "community_moderation")).toBe(false);
    expect(canViewSection("content_manager", "community_moderation")).toBe(false);
  });

  it("appears in the moderator's navigation and not in support's", () => {
    expect(visibleSections("moderator", SECTION_ORDER)).toContain("community_moderation");
    expect(visibleSections("support", SECTION_ORDER)).not.toContain("community_moderation");
  });

  it("does not widen anything else for moderator", () => {
    // `moderator` gains ONE section. It still cannot reach the mentor queue,
    // the support queue, finance or settings.
    const sections = visibleSections("moderator", SECTION_ORDER);
    expect(sections).not.toContain("mentor");
    expect(sections).not.toContain("support");
    expect(sections).not.toContain("financial");
    expect(sections).not.toContain("settings");
  });
});
