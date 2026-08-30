/**
 * Audit Workspace permissions across all nine CRM roles (Phase 1B5-B).
 *
 * Two independent axes are pinned here so they cannot drift:
 *   - the SINGLE data gate is `canViewAudit` — only crm_admin and crm_manager;
 *   - navigation visibility is `SECTION_VISIBILITY.audit` — seven roles see the
 *     nav item, content_manager and read_only do not — and it is DELIBERATELY
 *     wider than the data gate: five section-visible roles reach `/audit` and get
 *     a restricted state, not records.
 */
import { describe, expect, it } from "vitest";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { canViewAudit, canViewSection } from "@/domain/identity/access";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MemoryKeyValueStorage } from "@/data/mock/overlay/storage";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";

const clock = new FixedMockClock();
const USER_ID = "usr_mock_026";

const DATA_ROLES: readonly CrmRole[] = ["crm_admin", "crm_manager"];
// PHASE-1 ADMIN: `progression_operator` is not in SECTION_VISIBILITY.audit and
// must not be — correcting a learner's progression grants no audit affordance.
const NAV_HIDDEN: readonly CrmRole[] = ["content_manager", "read_only", "progression_operator"];

function ctx(role: CrmRole): CrmContext {
  return { actorId: "emp_mock_admin", role, now: MOCK_NOW };
}

async function seed(provider: MockCrmDataProvider) {
  await provider.addNote(ctx("crm_admin"), {
    userId: USER_ID,
    body: "seed",
    idempotencyKey: "seed",
  });
}

describe("canViewAudit — the single data gate", () => {
  for (const role of CRM_ROLES) {
    const expected = DATA_ROLES.includes(role);
    it(`${role} → ${expected}`, () => {
      expect(canViewAudit(role)).toBe(expected);
    });
  }
});

describe("SECTION_VISIBILITY.audit — nav semantics", () => {
  for (const role of CRM_ROLES) {
    const expectedVisible = !NAV_HIDDEN.includes(role);
    it(`${role} sees the Audit nav item: ${expectedVisible}`, () => {
      expect(canViewSection(role, "audit")).toBe(expectedVisible);
    });
  }

  it("exactly seven roles see the nav item", () => {
    expect(CRM_ROLES.filter((r) => canViewSection(r, "audit"))).toHaveLength(7);
  });

  it("the nav is wider than the data gate — section-visible roles that get no data exist", () => {
    const sectionVisibleNoData = CRM_ROLES.filter(
      (r) => canViewSection(r, "audit") && !canViewAudit(r),
    );
    expect(sectionVisibleNoData).toEqual([
      "retention_manager",
      "mentor",
      "support",
      "moderator",
      "analyst",
    ]);
  });
});

describe("getAuditRecords — data only for the two Full roles", () => {
  for (const role of CRM_ROLES) {
    it(`${role} ${DATA_ROLES.includes(role) ? "receives records" : "is restricted"}`, async () => {
      const provider = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
      await seed(provider);
      const res = await provider.getAuditRecords(ctx(role), {});
      if (DATA_ROLES.includes(role)) {
        expect(res.status).toBe("ok");
        expect(res.data!.items.length).toBeGreaterThan(0);
      } else {
        expect(res.status).toBe("error");
        expect(res.error?.code).toBe("unauthorized");
        expect(res.data).toBeNull();
      }
    });
  }
});
