/**
 * G4-R7 CONTRACT-DRIFT REGRESSION — the CRM half.
 *
 * The defect this file exists to catch: the backend appended four permissions
 * to `CRM_PERMISSIONS`, the CRM's closed session enum never received them, and
 * every principal whose role granted one of them could authenticate and then
 * not hold a session. `crm_admin`, `crm_manager`, `content_manager` and
 * `read_only` were all affected on live PREPROD, which blocked the G4 cutover.
 *
 * WHAT MAKES THIS TEST DIFFERENT FROM THE ONE THAT DID NOT CATCH IT.
 *
 * The previous test asserted `SESSION_PERMISSIONS` equalled a literal list
 * copied into the test body. Two copies of the same mistake agree with each
 * other, so it passed throughout the entire period the CRM was broken. Nothing
 * below re-states the vocabulary: every expectation is derived from the
 * canonical contract module, from the role grant maps, or recomputed.
 *
 * WHAT THIS HALF CAN AND CANNOT PROVE.
 *
 * The CRM repository cannot see the backend, so it cannot detect a backend-side
 * addition on its own. That detection lives in the backend's own
 * `session-permission-contract.test.ts`, which fails the moment `CRM_PERMISSIONS`
 * and the contract disagree, and in
 * `scripts/ops/verifyCrmSessionPermissionContract.ts`, which proves the two
 * repositories carry byte-identical copies. What this half proves is the other
 * necessary half: that the session parser accepts the COMPLETE canonical
 * vocabulary, so no permission the backend can legitimately send is able to
 * invalidate a session.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CRM_SESSION_PERMISSION_CONTRACT,
  CRM_SESSION_PERMISSION_CONTRACT_DIGEST,
  CRM_SESSION_PERMISSION_CONTRACT_VERSION,
  type CrmSessionPermission,
} from "./crm-session-permission-contract";
import { SESSION_PERMISSIONS, SessionDtoSchema } from "./session-dto";
import { ROLE_PERMISSIONS } from "./permissions";
import { CRM_ROLES } from "./roles";

const VALID = {
  employeeId: "emp_7f3a9c",
  displayName: "Ирина Соколова",
  role: "crm_admin",
  effectivePermissions: [] as readonly string[],
  permissionVersion: 3,
  expiresAt: "2026-07-20T18:30:00.000Z",
} as const;

function withPermissions(effectivePermissions: readonly string[]) {
  return SessionDtoSchema.safeParse({ ...VALID, effectivePermissions });
}

describe("canonical session permission contract", () => {
  it("declares a digest that matches the list it ships", () => {
    // Recomputed, never restated. Editing the vocabulary without updating the
    // digest fails here, and the digest is the token that proves the backend's
    // copy of this file is the same artifact.
    const recomputed = createHash("sha256")
      .update(CRM_SESSION_PERMISSION_CONTRACT.join("\n"))
      .digest("hex");
    expect(recomputed).toBe(CRM_SESSION_PERMISSION_CONTRACT_DIGEST);
  });

  it("is versioned, so a change is a deliberate act", () => {
    expect(CRM_SESSION_PERMISSION_CONTRACT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("contains no duplicate names", () => {
    expect(new Set(CRM_SESSION_PERMISSION_CONTRACT).size).toBe(
      CRM_SESSION_PERMISSION_CONTRACT.length,
    );
  });

  it("is what the session vocabulary IS, not a copy of it", () => {
    // Guards against someone re-hardcoding SESSION_PERMISSIONS as a literal.
    expect(SESSION_PERMISSIONS).toBe(CRM_SESSION_PERMISSION_CONTRACT);
  });
});

describe("the session parser accepts the COMPLETE canonical vocabulary", () => {
  // This is the assertion that fails on the pre-fix candidate: on that build
  // SESSION_PERMISSIONS held eleven entries and the four curriculum_* names
  // were rejected by the closed enum.
  it.each([...CRM_SESSION_PERMISSION_CONTRACT])(
    "accepts %s on its own",
    (permission) => {
      expect(withPermissions([permission]).success).toBe(true);
    },
  );

  it("accepts every canonical permission at once", () => {
    const parsed = withPermissions([...CRM_SESSION_PERMISSION_CONTRACT]);
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty permission list — a role may legitimately hold none", () => {
    expect(withPermissions([]).success).toBe(true);
  });
});

describe("G4-R7 — a real role's full grant set must parse", () => {
  /**
   * The backend's own role grants, restated here as the SHAPE of a session the
   * backend can emit. These are deliberately the grants, not the vocabulary:
   * the defect was that a legitimate role's real permission set could not be
   * read, and that is what must never regress.
   *
   * `crm_admin` holds every canonical permission, so it is simultaneously the
   * worst case and the exact principal that was locked out.
   */
  const BACKEND_ROLE_GRANTS: Record<string, readonly CrmSessionPermission[]> = {
    crm_admin: [...CRM_SESSION_PERMISSION_CONTRACT],
    crm_manager: [
      "view_exact_financials",
      "view_identity_full_email",
      "reveal_pii",
      "assign_owner",
      "export",
      "view_audit",
      "edit_user_notes",
      "view_user_notes",
      "create_user_notes",
      "view_affiliate_analytics",
      "curriculum_read",
    ],
    retention_manager: [
      "view_exact_financials",
      "view_identity_full_email",
      "reveal_pii",
      "assign_owner",
      "export",
      "edit_user_notes",
      "view_user_notes",
      "create_user_notes",
    ],
    mentor: [],
    support: ["edit_user_notes", "view_user_notes", "create_user_notes"],
    moderator: [],
    analyst: ["view_affiliate_analytics"],
    content_manager: ["curriculum_read", "curriculum_author"],
    read_only: ["curriculum_read"],
    // PHASE-1 ADMIN. Exactly one permission — the whole point of the role.
    progression_operator: ["curriculum_progress_override"],
  };

  it("covers every canonical role", () => {
    expect(Object.keys(BACKEND_ROLE_GRANTS).sort()).toEqual([...CRM_ROLES].sort());
  });

  it.each(Object.entries(BACKEND_ROLE_GRANTS))(
    "%s holds a parseable session",
    (role, permissions) => {
      const parsed = SessionDtoSchema.safeParse({
        ...VALID,
        role,
        effectivePermissions: permissions,
      });
      expect(parsed.success).toBe(true);
    },
  );

  it("every granted permission is in the canonical vocabulary", () => {
    for (const permissions of Object.values(BACKEND_ROLE_GRANTS)) {
      for (const permission of permissions) {
        expect(CRM_SESSION_PERMISSION_CONTRACT).toContain(permission);
      }
    }
  });
});

describe("§11 — identity is by NAME, order is a separate protocol property", () => {
  it("accepts the vocabulary in any order — position is not identity", () => {
    const shuffled = [...CRM_SESSION_PERMISSION_CONTRACT].reverse();
    expect(withPermissions(shuffled).success).toBe(true);
    const rotated = [
      ...CRM_SESSION_PERMISSION_CONTRACT.slice(5),
      ...CRM_SESSION_PERMISSION_CONTRACT.slice(0, 5),
    ];
    expect(withPermissions(rotated).success).toBe(true);
  });

  it("pins the canonical ORDER, which IS part of the protocol", () => {
    // The backend returns effectivePermissions in this order and its own
    // regressions pin the leading positions, so entries are appended and never
    // inserted. Breaking that is a protocol break even though it would not
    // change any permission's meaning.
    expect(CRM_SESSION_PERMISSION_CONTRACT.indexOf("view_exact_financials")).toBe(0);
    expect(CRM_SESSION_PERMISSION_CONTRACT.indexOf("view_affiliate_analytics")).toBe(10);
    expect(CRM_SESSION_PERMISSION_CONTRACT.slice(11, 15)).toEqual([
      "curriculum_read",
      "curriculum_author",
      "curriculum_approve",
      "curriculum_source_authority",
    ]);
    // LEARNER-OPERATIONS-V1 — appended at 15, after every historical entry, so
    // no client that pinned the first fifteen positions changes meaning. v4
    // appends `learner_ops_escalation_resolve` at 24 for the same reason: the
    // twenty-four before it keep their positions exactly. v5 appends
    // `community_moderate` at 25 — a NEW axis, so it displaces nothing.
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
      // v6 appends `curriculum_progress_override` at 26 — again a NEW axis, so
      // the twenty-six before it keep their positions exactly.
      "curriculum_progress_override",
    ]);
    expect(CRM_SESSION_PERMISSION_CONTRACT.indexOf("learner_ops_escalation_resolve")).toBe(24);
    expect(CRM_SESSION_PERMISSION_CONTRACT.indexOf("curriculum_progress_override")).toBe(26);
  });
});

describe("recognising a permission is not granting it", () => {
  it("leaves the mock-mode role map untouched by the vocabulary change", () => {
    // The four curriculum permissions are now readable. They are granted to
    // nobody by the CRM's own map, which is what proves this correction
    // widened no authorization.
    for (const role of CRM_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(CRM_SESSION_PERMISSION_CONTRACT).toContain(permission);
      }
    }
    const everyGranted = new Set(CRM_ROLES.flatMap((role) => [...ROLE_PERMISSIONS[role]]));
    expect(everyGranted.has("curriculum_read")).toBe(false);
    expect(everyGranted.has("curriculum_author")).toBe(false);
    expect(everyGranted.has("curriculum_approve")).toBe(false);
    expect(everyGranted.has("curriculum_source_authority")).toBe(false);
  });

  it("still rejects a name outside the canonical vocabulary", () => {
    // The enum stays closed. Widening the vocabulary did not weaken the trust
    // boundary — an invented permission is still a failed parse.
    expect(withPermissions(["some_new_permission"]).success).toBe(false);
    expect(withPermissions(["curriculum_delete"]).success).toBe(false);
    expect(withPermissions([...CRM_SESSION_PERMISSION_CONTRACT, "extra"]).success).toBe(false);
  });

  it("still rejects duplicates, including of the new names", () => {
    expect(withPermissions(["curriculum_read", "curriculum_read"]).success).toBe(false);
  });

  it("still rejects unknown extra fields on the DTO", () => {
    const parsed = SessionDtoSchema.safeParse({
      ...VALID,
      effectivePermissions: [...CRM_SESSION_PERMISSION_CONTRACT],
      email: "leaked@example.invalid",
    });
    expect(parsed.success).toBe(false);
  });
});
