/**
 * G4-R7 CONTRACT-DRIFT REGRESSION — the backend half, and the enforcement point.
 *
 * THIS IS THE TEST THAT FAILS WHEN SOMEONE ADDS A CRM PERMISSION.
 *
 * `CRM_PERMISSIONS` is where a new CRM permission is born. The CRM repository
 * cannot observe that event — it is a different repository — so the only place
 * a "backend added a permission and the CRM was not updated" condition can be
 * detected at the moment it is introduced is here.
 *
 * Adding `some_new_permission` to `CRM_PERMISSIONS` fails this file immediately
 * with instructions naming every file that must change. It also fails
 * `tsc --noEmit`, because `roles.ts` carries a compile-time parity assertion
 * against the same contract.
 *
 * WHAT WENT WRONG WITHOUT IT. PHASE-G0 appended three curriculum permissions on
 * 2026-08-08 and PHASE-G2 appended a fourth on 2026-08-10. Both were correct
 * backend changes. Nothing anywhere failed, and the CRM's closed session enum
 * silently began rejecting the sessions of `crm_admin`, `crm_manager`,
 * `content_manager` and `read_only`. The defect surfaced five days later as a
 * blocked production cutover.
 *
 * Nothing below re-states the vocabulary as a literal. Every expectation is
 * derived from `CRM_PERMISSIONS`, from `STAFF_ROLE_PERMISSIONS`, from the
 * contract module, or recomputed.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CRM_PERMISSIONS,
  CRM_STAFF_ROLES,
  STAFF_ROLE_PERMISSIONS,
  canViewAffiliates,
  resolveEffectivePermissions,
} from "@/lib/crm/roles";
import {
  CRM_SESSION_PERMISSION_CONTRACT,
  CRM_SESSION_PERMISSION_CONTRACT_DIGEST,
  CRM_SESSION_PERMISSION_CONTRACT_VERSION,
} from "@/lib/crm/session-permission-contract";

const SYNC_INSTRUCTIONS = [
  "",
  "The backend's CRM_PERMISSIONS and the canonical CRM session permission",
  "contract have diverged. A permission the CRM cannot name makes its closed",
  "session enum reject the WHOLE session, so every principal holding that",
  "permission can log in and then not hold a session (this is G4-R7).",
  "",
  "To add a permission, all of the following must happen together:",
  "  1. append it to CRM_PERMISSIONS in backend src/lib/crm/roles.ts;",
  "  2. append it to CRM_SESSION_PERMISSION_CONTRACT in",
  "     backend src/lib/crm/session-permission-contract.ts;",
  "  3. update CRM_SESSION_PERMISSION_CONTRACT_DIGEST and bump",
  "     CRM_SESSION_PERMISSION_CONTRACT_VERSION;",
  "  4. copy that file verbatim to",
  "     crm src/domain/identity/crm-session-permission-contract.ts;",
  "  5. append it to the Permission union in crm src/domain/identity/roles.ts;",
  "  6. run scripts/ops/verifyCrmSessionPermissionContract.ts against the CRM",
  "     checkout to prove both copies are byte-identical;",
  "  7. decide separately which roles receive it.",
  "",
].join("\n");

describe("G4-R7 — the canonical CRM session permission contract", () => {
  it("matches CRM_PERMISSIONS exactly, name for name and in order", () => {
    // Two independently declared lists compared against each other. This is the
    // assertion the pre-fix tree never had.
    expect([...CRM_SESSION_PERMISSION_CONTRACT], SYNC_INSTRUCTIONS).toEqual([
      ...CRM_PERMISSIONS,
    ]);
  });

  it("declares a digest that matches the list it ships", () => {
    const recomputed = createHash("sha256")
      .update(CRM_SESSION_PERMISSION_CONTRACT.join("\n"))
      .digest("hex");
    expect(
      recomputed,
      `${SYNC_INSTRUCTIONS}\nExpected digest for the current list: ${recomputed}`,
    ).toBe(CRM_SESSION_PERMISSION_CONTRACT_DIGEST);
  });

  it("is versioned", () => {
    expect(CRM_SESSION_PERMISSION_CONTRACT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("contains no duplicates", () => {
    expect(new Set(CRM_PERMISSIONS).size).toBe(CRM_PERMISSIONS.length);
  });
});

describe("every permission a role can hold is in the contract", () => {
  // Derived from the grant map, so a permission granted to a role but missing
  // from the vocabulary — the precise shape of G4-R7 — fails here even if
  // someone edited both lists inconsistently.
  it.each([...CRM_STAFF_ROLES])("%s emits only contractual permissions", (role) => {
    for (const permission of resolveEffectivePermissions(role)) {
      expect([...CRM_SESSION_PERMISSION_CONTRACT], SYNC_INSTRUCTIONS).toContain(permission);
    }
  });

  it("no role's grant set contains a name outside the contract", () => {
    const granted = new Set(
      CRM_STAFF_ROLES.flatMap((role) => [...STAFF_ROLE_PERMISSIONS[role]]),
    );
    const orphans = [...granted].filter(
      (permission) => !(CRM_SESSION_PERMISSION_CONTRACT as readonly string[]).includes(permission),
    );
    expect(orphans, SYNC_INSTRUCTIONS).toEqual([]);
  });
});

describe("§11 — identity is by NAME; order is a separate, deliberate protocol", () => {
  it("resolves permissions by name, not by position", () => {
    // resolveEffectivePermissions filters CRM_PERMISSIONS by set membership.
    // Reversing the caller's grant order must not change the result, which is
    // what proves position carries no identity.
    const forward = resolveEffectivePermissions("crm_manager");
    const reversedGrants = new Set([...STAFF_ROLE_PERMISSIONS.crm_manager].reverse());
    const fromReversed = CRM_PERMISSIONS.filter((permission) => reversedGrants.has(permission));
    expect(fromReversed).toEqual(forward);
  });

  it("returns permissions in canonical contract order", () => {
    // The order IS protocol: clients pin leading positions, so entries are
    // appended and never inserted.
    const emitted = resolveEffectivePermissions("crm_admin");
    const canonicalOrder = CRM_SESSION_PERMISSION_CONTRACT.filter((permission) =>
      emitted.includes(permission),
    );
    expect(emitted).toEqual([...canonicalOrder]);
  });

  it("appends rather than inserts — historical prefixes are stable", () => {
    // The two historical anchors keep their exact positions. This is the
    // assertion that fails the moment somebody INSERTS instead of appending,
    // and it did exactly that when LEARNER-OPERATIONS-V1 extended the contract.
    expect(CRM_SESSION_PERMISSION_CONTRACT.indexOf("view_affiliate_analytics")).toBe(10);
    expect(CRM_SESSION_PERMISSION_CONTRACT.slice(11, 15)).toEqual([
      "curriculum_read",
      "curriculum_author",
      "curriculum_approve",
      "curriculum_source_authority",
    ]);
    // LEARNER-OPERATIONS-V1 — appended at 15, after every historical entry.
    // v4 appends `learner_ops_escalation_resolve` at 24 by the same rule: the
    // twenty-four entries before it do not move. COMMUNITY-V1 appends
    // `community_moderate` at 25, and the twenty-five before it do not move
    // either — including the whole `learner_ops_*` block, which is the point:
    // Community moderation is a NEW axis and displaces nothing.
    expect(CRM_SESSION_PERMISSION_CONTRACT.slice(15)).toEqual([
      "learner_ops_view",
      "learner_ops_handle",
      "learner_ops_report_review",
      "learner_ops_mentor_review",
      "learner_ops_escalate",
      "learner_ops_manage_queues",
      "learner_ops_qa",
      "learner_ops_analytics",
      "learner_ops_admin",
      "learner_ops_escalation_resolve",
      "community_moderate",
      // PHASE-1 ADMIN appends `curriculum_progress_override` at 26 by the same
      // rule: another new axis, and the twenty-six before it do not move.
      "curriculum_progress_override",
    ]);
    expect(CRM_SESSION_PERMISSION_CONTRACT.indexOf("community_moderate")).toBe(25);
    expect(CRM_SESSION_PERMISSION_CONTRACT.indexOf("curriculum_progress_override")).toBe(26);
  });
});

describe("the correction widened no authorization", () => {
  it("keeps the Growth read gate on exactly three roles", () => {
    // Derived from the grant map through the real gate function, never from a
    // list of role names typed into this test.
    const authorized = CRM_STAFF_ROLES.filter((role) =>
      canViewAffiliates(resolveEffectivePermissions(role)),
    );
    expect([...authorized].sort()).toEqual(["analyst", "crm_admin", "crm_manager"]);
  });

  it("grants the four curriculum permissions to no new role", () => {
    const holders = (permission: string) =>
      CRM_STAFF_ROLES.filter((role) =>
        (STAFF_ROLE_PERMISSIONS[role] as readonly string[]).includes(permission),
      ).sort();
    expect(holders("curriculum_read")).toEqual([
      "content_manager",
      "crm_admin",
      "crm_manager",
      "read_only",
    ]);
    expect(holders("curriculum_author")).toEqual(["content_manager", "crm_admin"]);
    expect(holders("curriculum_approve")).toEqual(["crm_admin"]);
    expect(holders("curriculum_source_authority")).toEqual(["crm_admin"]);
  });

  it("still refuses roles that hold neither Growth permission", () => {
    for (const role of ["support", "mentor", "moderator", "retention_manager", "read_only", "content_manager"] as const) {
      expect(canViewAffiliates(resolveEffectivePermissions(role))).toBe(false);
    }
  });
});
