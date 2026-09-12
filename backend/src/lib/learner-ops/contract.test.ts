/**
 * LEARNER-OPERATIONS-V1 — state machine, SLA clock and permission-matrix
 * regressions.
 *
 * These are the checks that must go RED if the rules drift. Several of them
 * assert an ABSENCE (no transition into a state, no permission on a role), and
 * an absence is exactly the kind of rule that rots silently — which is why each
 * one names the specific thing it forbids rather than snapshotting a structure.
 */
import { describe, expect, it } from "vitest";
import {
  isActiveStatus,
  isLegalTransition,
  isReopenTransition,
  isWaitingStatus,
  LEARNER_OPS_ACTIVE_STATUSES,
  LEARNER_OPS_CANONICAL_DECISION_TYPES,
  LEARNER_OPS_REQUIRED_ANCHOR,
  LEARNER_OPS_STATUSES,
  LEARNER_OPS_TRANSITIONS,
  LEARNER_OPS_TYPES,
  requiresCanonicalDecision,
  resolutionClockPauses,
} from "@/lib/learner-ops/contract";
import {
  computeSlaView,
  computeTargets,
  elapsedWorkingMs,
  pauseTransition,
  type SlaCaseInput,
  type SlaPolicyInput,
} from "@/lib/learner-ops/sla";
import {
  canHandleLearnerOps,
  canPerformMentorReview,
  canPerformReportReview,
  canViewLearnerOps,
  CRM_PERMISSIONS,
  resolveEffectivePermissions,
  STAFF_ROLE_PERMISSIONS,
} from "@/lib/crm/roles";
import {
  CRM_SESSION_PERMISSION_CONTRACT,
  CRM_SESSION_PERMISSION_CONTRACT_VERSION,
} from "@/lib/crm/session-permission-contract";

/* ------------------------------------------------------------ state machine */

describe("case state machine", () => {
  it("declares exactly the nine statuses the schema CHECK admits", () => {
    expect([...LEARNER_OPS_STATUSES].sort()).toEqual(
      [
        "closed",
        "escalated",
        "in_progress",
        "new",
        "open",
        "resolved",
        "waiting_external",
        "waiting_internal",
        "waiting_learner",
      ].sort(),
    );
  });

  it("has no `assigned` or `reopened` status — both are derived axes", () => {
    expect(LEARNER_OPS_STATUSES).not.toContain("assigned" as never);
    expect(LEARNER_OPS_STATUSES).not.toContain("reopened" as never);
  });

  it("never lists a self-transition, which the DB CHECK would refuse anyway", () => {
    for (const [from, targets] of Object.entries(LEARNER_OPS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });

  it("only ever transitions into a declared status", () => {
    for (const targets of Object.values(LEARNER_OPS_TRANSITIONS)) {
      for (const target of targets) {
        expect(LEARNER_OPS_STATUSES).toContain(target);
      }
    }
  });

  it("reopens from both terminal states, and only ever to `open`", () => {
    expect(isReopenTransition("resolved", "open")).toBe(true);
    expect(isReopenTransition("closed", "open")).toBe(true);
    // Never straight back into somebody's active work — a reopened case is
    // unclaimed again until it is taken.
    expect(isLegalTransition("resolved", "in_progress")).toBe(false);
    expect(isLegalTransition("closed", "in_progress")).toBe(false);
    expect(isReopenTransition("open", "in_progress")).toBe(false);
  });

  it("refuses a transition that is not declared", () => {
    expect(isLegalTransition("closed", "escalated")).toBe(false);
    expect(isLegalTransition("resolved", "waiting_learner")).toBe(false);
    expect(isLegalTransition("closed", "resolved")).toBe(false);
  });

  it("lets an UNTRIAGED case be parked or escalated without a pointless hop", () => {
    // `new` reaches everything `open` does. An operator who reads an untriaged
    // case and immediately needs the learner, or a methodologist, must be able
    // to act — and forcing a hop through `open` first would write a triage
    // event that never happened.
    for (const target of [
      "waiting_learner",
      "waiting_internal",
      "waiting_external",
      "escalated",
    ] as const) {
      expect(isLegalTransition("new", target)).toBe(true);
    }
  });

  it("treats the three waits as active work but the two terminals as not", () => {
    for (const status of ["waiting_learner", "waiting_internal", "waiting_external"] as const) {
      expect(isWaitingStatus(status)).toBe(true);
      expect(isActiveStatus(status)).toBe(true);
    }
    expect(isActiveStatus("resolved")).toBe(false);
    expect(isActiveStatus("closed")).toBe(false);
    expect(LEARNER_OPS_ACTIVE_STATUSES).not.toContain("resolved" as never);
  });
});

/* -------------------------------------------------------------------- types */

describe("case types and canonical anchors", () => {
  it("declares the seven types the operating model names", () => {
    expect(LEARNER_OPS_TYPES).toHaveLength(7);
  });

  it("requires an anchor for exactly the two canonical-decision types", () => {
    expect(LEARNER_OPS_REQUIRED_ANCHOR.report_review).toBe("reportSubmission");
    expect(LEARNER_OPS_REQUIRED_ANCHOR.mentor_review).toBe("userLevelProgress");
    for (const type of LEARNER_OPS_TYPES) {
      if (type === "report_review" || type === "mentor_review") continue;
      expect(LEARNER_OPS_REQUIRED_ANCHOR[type]).toBeUndefined();
    }
  });

  it("marks only report and mentor review as decided by a canonical owner", () => {
    expect([...LEARNER_OPS_CANONICAL_DECISION_TYPES].sort()).toEqual([
      "mentor_review",
      "report_review",
    ]);
    expect(requiresCanonicalDecision("support_request")).toBe(false);
    expect(requiresCanonicalDecision("complaint")).toBe(false);
  });
});

/* ---------------------------------------------------------------- SLA clock */

const POLICY: SlaPolicyInput = {
  key: "test",
  priority: "normal",
  firstResponseTargetMinutes: 60,
  resolutionTargetMinutes: 240,
  pausesOnWaitingLearner: true,
  pausesOnWaitingInternal: false,
  pausesOnWaitingExternal: true,
  origin: "preprod_acceptance_fixture",
};

const T0 = new Date("2026-08-16T10:00:00.000Z");
const baseCase: SlaCaseInput = {
  status: "open",
  openedAt: T0,
  pausedMs: 0,
  clockPausedAt: null,
  firstResponseDueAt: new Date("2026-08-16T11:00:00.000Z"),
  resolutionDueAt: new Date("2026-08-16T14:00:00.000Z"),
  firstRespondedAt: null,
  resolvedAt: null,
};

describe("SLA clock", () => {
  it("pauses the resolution clock only where the policy says so", () => {
    expect(resolutionClockPauses("waiting_learner", POLICY)).toBe(true);
    // Waiting on an INTERNAL decision is our own delay and must keep running.
    expect(resolutionClockPauses("waiting_internal", POLICY)).toBe(false);
    expect(resolutionClockPauses("waiting_external", POLICY)).toBe(true);
    expect(resolutionClockPauses("in_progress", POLICY)).toBe(false);
    expect(resolutionClockPauses("escalated", POLICY)).toBe(false);
  });

  it("never pauses the FIRST-RESPONSE clock, whatever we are waiting on", () => {
    const waiting = { ...baseCase, status: "waiting_external" as const, clockPausedAt: T0 };
    const view = computeSlaView(waiting, POLICY, new Date("2026-08-16T10:30:00.000Z"));
    expect(view.firstResponse.state).toBe("running");
    expect(view.resolution.state).toBe("paused");
  });

  it("reports a breach the moment the deadline passes, without a stored flag", () => {
    const view = computeSlaView(baseCase, POLICY, new Date("2026-08-16T11:00:01.000Z"));
    expect(view.firstResponse.state).toBe("breached");
    expect(view.firstResponse.overdueMs).toBe(1_000);
    expect(view.breached).toBe(true);
  });

  it("keeps first response `met` forever once recorded, however late everything else runs", () => {
    const responded = { ...baseCase, firstRespondedAt: new Date("2026-08-16T10:05:00.000Z") };
    const long = computeSlaView(responded, POLICY, new Date("2026-08-20T00:00:00.000Z"));
    // Four days later the RESOLUTION clock is long breached — and the
    // first-response fact is still met, because it happened. `breached` is the
    // OR of the two clocks, so it is true here for the resolution alone.
    expect(long.firstResponse.state).toBe("met");
    expect(long.resolution.state).toBe("breached");
    expect(long.breached).toBe(true);

    // With no resolution target at all, a satisfied first response leaves
    // nothing breached.
    const noResolutionTarget = { ...responded, resolutionDueAt: null };
    const view = computeSlaView(noResolutionTarget, POLICY, new Date("2026-08-20T00:00:00.000Z"));
    expect(view.firstResponse.state).toBe("met");
    expect(view.breached).toBe(false);
  });

  it("reports `none` rather than `met` when no target was ever set", () => {
    const noTargets = { ...baseCase, firstResponseDueAt: null, resolutionDueAt: null };
    const view = computeSlaView(noTargets, null, new Date("2026-08-20T00:00:00.000Z"));
    expect(view.firstResponse.state).toBe("none");
    expect(view.resolution.state).toBe("none");
    expect(view.breached).toBe(false);
    expect(view.policyKey).toBeNull();
  });

  it("always carries the policy's provenance so a fixture cannot pass as policy", () => {
    const view = computeSlaView(baseCase, POLICY, T0);
    expect(view.origin).toBe("preprod_acceptance_fixture");
  });

  it("accumulates pause across TWO consecutive waiting states without losing the first", () => {
    // waiting_learner for 30 min, then straight to waiting_external.
    const entered = pauseTransition(
      { status: "open", pausedMs: 0, clockPausedAt: null },
      "waiting_learner",
      POLICY,
      T0,
    );
    expect(entered.clockPausedAt).toEqual(T0);
    expect(entered.pausedMs).toBe(0);

    const t30 = new Date(T0.getTime() + 30 * 60_000);
    const moved = pauseTransition(
      { status: "waiting_learner", pausedMs: entered.pausedMs, clockPausedAt: entered.clockPausedAt },
      "waiting_external",
      POLICY,
      t30,
    );
    // The first 30 minutes are folded in AND the clock restamps.
    expect(moved.pausedMs).toBe(30 * 60_000);
    expect(moved.clockPausedAt).toEqual(t30);

    const t45 = new Date(T0.getTime() + 45 * 60_000);
    const resumed = pauseTransition(
      { status: "waiting_external", pausedMs: moved.pausedMs, clockPausedAt: moved.clockPausedAt },
      "in_progress",
      POLICY,
      t45,
    );
    expect(resumed.pausedMs).toBe(45 * 60_000);
    expect(resumed.clockPausedAt).toBeNull();
  });

  it("does not pause on entering a state the policy says keeps running", () => {
    const entered = pauseTransition(
      { status: "open", pausedMs: 0, clockPausedAt: null },
      "waiting_internal",
      POLICY,
      T0,
    );
    expect(entered.clockPausedAt).toBeNull();
  });

  it("subtracts accumulated pause from elapsed working time", () => {
    const t60 = new Date(T0.getTime() + 60 * 60_000);
    const elapsed = elapsedWorkingMs({ ...baseCase, pausedMs: 20 * 60_000 }, t60);
    expect(elapsed).toBe(40 * 60_000);
  });

  it("never returns negative elapsed time if the clock moved backwards", () => {
    const before = new Date(T0.getTime() - 60_000);
    expect(elapsedWorkingMs(baseCase, before)).toBe(0);
  });

  it("computes no targets at all when there is no policy", () => {
    expect(computeTargets(null, T0)).toEqual({ firstResponseDueAt: null, resolutionDueAt: null });
  });
});

/* ------------------------------------------------------- permission matrix */

describe("Learner Operations permission matrix", () => {
  const NEW_PERMISSIONS = [
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
  ] as const;

  it("appends the Learner Operations permissions to the contract without reordering it", () => {
    // v3 added nine; v4 added the tenth, `learner_ops_escalation_resolve`,
    // after LO-ESCALATION-RESOLVE-AUTHORITY-1 showed that raising an escalation
    // and answering one had been fused into a single permission. v5 appends
    // `community_moderate` and v6 appends `curriculum_progress_override`;
    // neither belongs to a `learner_ops_*` family — the assertions below are
    // unchanged because nothing before position 25 moved.
    expect(CRM_SESSION_PERMISSION_CONTRACT_VERSION).toBe(6);
    expect(CRM_SESSION_PERMISSION_CONTRACT).toHaveLength(27);
    // The Learner Operations block still occupies exactly 15..24 — which is the
    // property this file owns, and the reason two later appends changed nothing
    // here.
    expect(CRM_SESSION_PERMISSION_CONTRACT.slice(15, 25)).toEqual([...NEW_PERMISSIONS]);
    // The first fifteen keep their exact accepted positions.
    expect(CRM_SESSION_PERMISSION_CONTRACT.slice(0, 15)).toEqual([
      "view_exact_financials",
      "view_identity_full_email",
      "reveal_pii",
      "assign_owner",
      "export",
      "view_audit",
      "manage_settings",
      "edit_user_notes",
      "view_user_notes",
      "create_user_notes",
      "view_affiliate_analytics",
      "curriculum_read",
      "curriculum_author",
      "curriculum_approve",
      "curriculum_source_authority",
    ]);
    // The Learner Operations block occupies exactly its own span. It is no
    // longer the tail of the contract — COMMUNITY-V1 appended after it — so the
    // slice is bounded by the block's own length rather than by "everything
    // from 15 on", which was only ever true while LO happened to be last.
    expect(CRM_SESSION_PERMISSION_CONTRACT.slice(15, 15 + NEW_PERMISSIONS.length)).toEqual(
      NEW_PERMISSIONS,
    );
    // And everything that follows it belongs to no learner-operations family —
    // which is the actual property, so it is asserted as such rather than by
    // listing whatever happens to have been appended since.
    const after = CRM_SESSION_PERMISSION_CONTRACT.slice(15 + NEW_PERMISSIONS.length);
    expect(after).toEqual(["community_moderate", "curriculum_progress_override"]);
    expect(after.some((permission) => permission.startsWith("learner_ops_"))).toBe(false);
  });

  it("gives mentor RESOLVE and withholds RAISE — LO-ESCALATION-RESOLVE-AUTHORITY-1", () => {
    // The asymmetry is the control. A mentor answers escalations addressed to
    // them; routing work to another authority stays a frontline and management
    // act. Support is the mirror image and is asserted alongside so a future
    // edit cannot quietly collapse the two back into one permission.
    const mentor = resolveEffectivePermissions("mentor");
    expect(mentor).toContain("learner_ops_escalation_resolve");
    expect(mentor).not.toContain("learner_ops_escalate");

    const support = resolveEffectivePermissions("support");
    expect(support).toContain("learner_ops_escalate");
    expect(support).not.toContain("learner_ops_escalation_resolve");
  });

  it("keeps the backend vocabulary identical to the shared contract", () => {
    expect([...CRM_PERMISSIONS]).toEqual([...CRM_SESSION_PERMISSION_CONTRACT]);
  });

  it("gives mentor its review permissions — the LO-AUTH-AXIS-1 fix", () => {
    const mentor = resolveEffectivePermissions("mentor");
    expect(canPerformReportReview(mentor)).toBe(true);
    expect(canPerformMentorReview(mentor)).toBe(true);
    expect(canHandleLearnerOps(mentor)).toBe(true);
    // A mentor reviews learners. It does not run the department.
    expect(mentor).not.toContain("learner_ops_manage_queues");
    expect(mentor).not.toContain("learner_ops_qa");
    expect(mentor).not.toContain("learner_ops_admin");
  });

  it("withholds review authority from moderator — the principal that had it silently", () => {
    const moderator = resolveEffectivePermissions("moderator");
    // COMMUNITY-V1 gave `moderator` its first permission, so this is no longer
    // the empty set. The property this test exists for is unchanged and is now
    // stated directly rather than as a side effect of holding nothing: the role
    // holds Community moderation and NOT ONE Learner Operations permission.
    expect(moderator).toEqual(["community_moderate"]);
    expect(moderator.filter((p) => p.startsWith("learner_ops_"))).toEqual([]);
    expect(canPerformReportReview(moderator)).toBe(false);
    expect(canPerformMentorReview(moderator)).toBe(false);
    expect(canViewLearnerOps(moderator)).toBe(false);
  });

  it("gives Community moderation to exactly moderator and crm_admin", () => {
    for (const role of Object.keys(STAFF_ROLE_PERMISSIONS)) {
      const held = resolveEffectivePermissions(role);
      expect(held.includes("community_moderate")).toBe(role === "moderator" || role === "crm_admin");
    }
  });

  it("does not let Community moderation carry any learner-operations authority", () => {
    // The negative control for the role matrix: a principal whose ONLY
    // permission is Community moderation can moderate a discussion and can do
    // nothing in the operational department.
    const moderator = resolveEffectivePermissions("moderator");
    expect(canViewLearnerOps(moderator)).toBe(false);
    expect(canHandleLearnerOps(moderator)).toBe(false);
    expect(moderator).not.toContain("view_user_notes");
    expect(moderator).not.toContain("reveal_pii");
    expect(moderator).not.toContain("view_exact_financials");
  });

  it("never lets a frontline support role approve educational work", () => {
    const support = resolveEffectivePermissions("support");
    expect(canHandleLearnerOps(support)).toBe(true);
    expect(canPerformReportReview(support)).toBe(false);
    expect(canPerformMentorReview(support)).toBe(false);
  });

  it("never lets a supervisory role acquire review authority from its supervisory marker", () => {
    const manager = resolveEffectivePermissions("crm_manager");
    expect(manager).toContain("view_audit");
    expect(manager).toContain("learner_ops_manage_queues");
    // view_audit is a READ marker and must never widen an educational authority.
    expect(canPerformReportReview(manager)).toBe(false);
    expect(canPerformMentorReview(manager)).toBe(false);
    expect(manager).not.toContain("learner_ops_admin");
  });

  it("gives only crm_admin the configuration permission", () => {
    for (const role of Object.keys(STAFF_ROLE_PERMISSIONS)) {
      const held = resolveEffectivePermissions(role);
      expect(held.includes("learner_ops_admin")).toBe(role === "crm_admin");
    }
  });

  it("grants read-only and analyst nothing that can mutate", () => {
    const readOnly = resolveEffectivePermissions("read_only");
    expect(readOnly).toContain("learner_ops_view");
    expect(readOnly).not.toContain("learner_ops_handle");

    const analyst = resolveEffectivePermissions("analyst");
    expect(analyst).toContain("learner_ops_analytics");
    expect(analyst).not.toContain("learner_ops_handle");
    expect(canViewLearnerOps(analyst)).toBe(false);
  });

  it("gives content_manager nothing operational", () => {
    const content = resolveEffectivePermissions("content_manager");
    for (const permission of NEW_PERMISSIONS) {
      expect(content).not.toContain(permission);
    }
  });

  it("fails closed for an unknown role", () => {
    expect(resolveEffectivePermissions("not_a_role")).toEqual([]);
  });

  it("returns permissions in the canonical contract order", () => {
    const admin = resolveEffectivePermissions("crm_admin");
    const expected = CRM_PERMISSIONS.filter((p) => admin.includes(p));
    expect(admin).toEqual([...expected]);
  });
});
