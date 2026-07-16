/**
 * Permission projection for the User 360 aggregate (Phase 1C).
 *
 * This is the ONLY place that decides what a role may see on `/users/[id]`.
 * It runs inside the provider, before anything reaches React, so forbidden
 * values are never sent to the client at all.
 *
 * Three privacy rules are enforced here:
 *  1. Identity — `detail` context, so full email reaches only roles with
 *     `view_identity_full_email`; everyone else gets masked / pseudonymous /
 *     hidden exactly as `projectIdentity` decides (D-11, PII_ACCESS_POLICY §3).
 *  2. Amounts — only ever `FinancialProjection` (exact / bucket / aggregated /
 *     hidden), never a raw number (D-07).
 *  3. Financially-derived explanations — see FINANCIALLY_DERIVED_SIGNALS below.
 *
 * Framework-agnostic — no React/Next imports.
 */
import type { Clock } from "@/lib/clock";
import type { CrmRole } from "@/domain/identity/roles";
import type { Freshness, StateEvidence } from "@/domain/shared/primitives";
import type { MockUser } from "@/domain/users/mock-user";
import type { ComputedSignal } from "@/domain/signals/engine";
import type { PriorityResult } from "@/domain/priority/priority";
import type { DerivedRecommendation } from "@/domain/recommendations/derive";
import { canViewExactFinancials } from "@/domain/identity/access";
import { FINANCIALLY_DERIVED_SIGNALS } from "@/domain/financial/financially-derived";
import { projectFinancial } from "@/domain/financial/projection";
import { projectIdentity } from "@/domain/identity/identity-projection";
import { RECOMMENDATION_CATALOG } from "@/domain/recommendations/catalog";
import { buildProjectedUserTimeline } from "./user-timeline";
import type {
  SlaState,
  User360,
  User360Event,
  User360Recommendation,
  User360Signal,
} from "./user-360";

/** Evidence is only forwarded when it is safe for the caller's role. */
function projectEvidence(evidence: StateEvidence[], exact: boolean): StateEvidence[] {
  return evidence.filter((e) => {
    if (e.sensitivity === "RESTRICTED") return false; // never surfaced in CRM
    if (e.sensitivity === "HIGH" && !exact) return false;
    return true;
  });
}

function projectSignals(signals: ComputedSignal[], exact: boolean): User360Signal[] {
  return signals.map((s) => {
    const redact = !exact && FINANCIALLY_DERIVED_SIGNALS.includes(s.code);
    return {
      code: s.code,
      severity: s.severity,
      // Withheld entirely rather than restated: the signal's own label already
      // names it, so a neutral rewrite would just print the title twice.
      reason: redact ? null : s.reason,
      evidence: redact ? [] : projectEvidence(s.evidence, exact),
      calculatedAt: s.calculatedAt,
      expiresAt: s.expiresAt,
    };
  });
}

function projectRecommendations(
  recommendations: DerivedRecommendation[],
  role: CrmRole,
): User360Recommendation[] {
  return recommendations.map((r) => ({
    code: r.code,
    title: r.title,
    reason: r.reason,
    priority: r.priority,
    suggestedChannel: r.suggestedChannel,
    humanApprovalRequired: r.humanApprovalRequired,
    sourceSignalCodes: r.sourceSignalCodes,
    allowedForRole: RECOMMENDATION_CATALOG[r.code].allowedRoles.includes(role),
  }));
}

/**
 * Recent operational activity, from the canonical timeline projector shared with
 * `getUserTimeline` (Phase 1C.1). This function only narrows the shape the User
 * 360 model needs — it makes no permission decision of its own, so the two
 * operations can never drift apart on what a role may see.
 */
function projectActivity(u: MockUser, role: CrmRole): User360Event[] {
  return buildProjectedUserTimeline(u, role).map(({ id, at, source, kind, title }) => ({
    id,
    at,
    source,
    kind,
    title,
  }));
}

export interface ProjectUser360Input {
  user: MockUser;
  signals: ComputedSignal[];
  priority: PriorityResult;
  recommendations: DerivedRecommendation[];
  role: CrmRole;
  clock: Clock;
  freshness: Freshness;
  slaState: SlaState;
}

/** Build the fully permission-projected User 360 read model. */
export function projectUser360(input: ProjectUser360Input): User360 {
  const { user: u, signals, priority, recommendations, role, clock, freshness, slaState } = input;
  const exact = canViewExactFinancials(role);

  const identityProjection = projectIdentity({
    role,
    userId: u.identity.userId,
    displayName: u.identity.displayName,
    maskedEmail: u.identity.maskedEmail,
    fullEmail: u.identity.fullEmail,
    context: "detail", // the ONLY context where a full email is possible
  });

  // Roles with no identity at all also get no locale/campaign context — those
  // narrow an anonymized subject down and belong to the same identity axis.
  const anonymous = identityProjection.mode === "hidden" || identityProjection.mode === "pseudonymous";

  return {
    identity: {
      userId: u.identity.userId,
      projection: identityProjection,
      registeredAt: u.identity.registeredAt,
      emailConfirmed: u.identity.emailConfirmed,
      country: anonymous ? null : u.identity.country,
      locale: anonymous ? null : u.identity.locale,
      timezone: anonymous ? null : u.identity.timezone,
      acquisitionSource: anonymous ? null : u.identity.acquisitionSource,
      campaign: anonymous ? null : u.identity.campaign,
    },
    attention: {
      priority: priority.level,
      reasonCode: priority.reasonCode,
      evidence: projectEvidence(priority.evidence, exact),
      sourceSignalCodes: priority.sourceSignalCodes,
    },
    states: {
      lifecycleStage: u.state.lifecycleStage,
      fundingStatus: u.state.fundingStatus,
      engagementStatus: u.state.engagementStatus,
      valueSegments: u.state.valueSegments,
      blockers: u.state.blockers,
      registrationStatus: u.financial.registrationStatus,
    },
    learning: {
      curriculumVersion: u.progression.curriculumVersion,
      currentLevel: u.progression.currentLevel,
      highestCompletedLevel: u.progression.highestCompletedLevel,
      xp: u.progression.xp,
      nextRequiredXp: u.progression.nextRequiredXp,
      currentModule: u.progression.currentModule,
      nextLevel: u.progression.nextLevel,
      lastLesson: u.learning.lastLesson,
      lessonProgressPct: u.learning.lessonProgressPct,
      testAttempts: u.learning.testAttempts,
      latestScore: u.learning.latestScore,
      reportState: u.learning.reportState,
      mentorReviewState: u.learning.mentorReviewState,
      lastLearningActivityAt: u.learning.lastLearningActivityAt,
      lastMeaningfulActionAt: u.progression.lastMeaningfulActionAt,
      checkpointStatus: u.progression.checkpointStatus,
      nextCheckpointLevel: u.progression.nextCheckpointLevel,
      // Grid constant, but withheld without exact financials: combined with the
      // checkpoint delta it would reconstruct the exact balance.
      nextCheckpointRequiredUsd: exact ? u.progression.nextCheckpointRequiredUsd : null,
    },
    financial: {
      balance: projectFinancial({ role, amountUsd: u.financial.balanceUsd, isStale: freshness.isStale }),
      netDeposits: projectFinancial({ role, amountUsd: u.financial.netDepositsUsd, isStale: freshness.isStale }),
      redepositCount: u.financial.redeposits.length,
      hasFtd: u.financial.ftd !== null,
      accessSuspended: u.financial.accessSuspended,
      pocketConflict: u.financial.pocketConflict,
      grace: u.financial.grace
        ? {
            active: u.financial.grace.active,
            endsAt: u.financial.grace.endsAt,
            belowThresholdConfirmations: u.financial.grace.belowThresholdConfirmations,
            hasOpenTrades: u.financial.grace.hasOpenTrades,
            checkpointLevel: u.financial.grace.checkpointLevel,
          }
        : null,
      freshness,
    },
    owner: {
      ownerId: u.operations.primaryOwnerId,
      activeTaskCount: u.operations.activeTaskCount,
      activeCaseCount: u.operations.activeCaseCount,
      lastEmployeeContactAt: u.operations.lastEmployeeContactAt,
      nextFollowUpAt: u.operations.nextFollowUpAt,
      supportState: u.operations.supportState,
      mentorState: u.operations.mentorState,
      sla: u.operations.sla
        ? { key: u.operations.sla.key, dueAt: u.operations.sla.dueAt, state: slaState }
        : null,
    },
    signals: projectSignals(signals, exact),
    recommendations: projectRecommendations(recommendations, role),
    activity: projectActivity(u, role),
    generatedAt: clock.nowIso(),
  };
}
