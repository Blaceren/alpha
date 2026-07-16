/**
 * Pure TodayWorkspace builder (Phase 1B1 §9). No React here — this derives the
 * queues, their items, and a deduplicated summary from the dataset.
 */
import type { Clock } from "@/lib/clock";
import { hoursSince, hoursUntil } from "@/lib/clock";
import type { ISODateString, StateEvidence } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";
import type { MockUser } from "@/domain/users/mock-user";
import { computeSignals, type ComputedSignal } from "@/domain/signals/engine";
import { comparePriority, computePriority, type PriorityBand, type PriorityResult } from "@/domain/priority/priority";
import { deriveRecommendations, type DerivedRecommendation } from "@/domain/recommendations/derive";
import { projectFinancial, type FinancialProjection } from "@/domain/financial/projection";
import { projectIdentity, type IdentityProjection } from "@/domain/identity/identity-projection";
import {
  QUEUE_PRIORITY,
  QUEUE_TITLE,
  QUEUES_WITHOUT_FINANCIALS,
  TODAY_QUEUE_ORDER,
  type TodayQueueCode,
} from "@/config/queues";

export type { TodayQueueCode };

export interface TodayQueueItem {
  userId: string;
  displayName: string;
  queueCode: TodayQueueCode;
  priority: PriorityBand;
  reason: string;
  reasonCode: string;
  evidence: StateEvidence[];
  ownerId: string | null;
  dueAt: ISODateString | null;
  recommendedAction: DerivedRecommendation | null;
  signalCodes: ComputedSignal["code"][];
  freshness: { asOf: ISODateString | null; isStale: boolean };
  /** Permission-aware financial representation; `hidden` for onboarding queue. */
  financial: FinancialProjection;
  identity: IdentityProjection;
}

export interface TodayQueue {
  code: TodayQueueCode;
  title: string;
  priority: PriorityBand;
  items: TodayQueueItem[];
}

export interface TodayWorkspaceResult {
  generatedAt: ISODateString;
  role: CrmRole;
  /** Distinct users across all queues (deduplicated). */
  distinctUserCount: number;
  queues: TodayQueue[];
}

interface Derivation {
  user: MockUser;
  signals: ComputedSignal[];
  priority: PriorityResult;
  recommendations: DerivedRecommendation[];
}

const hasSig = (d: Derivation, c: ComputedSignal["code"]) => d.signals.some((s) => s.code === c);

const QUEUE_MEMBERSHIP: Record<TodayQueueCode, (d: Derivation, clock: Clock) => boolean> = {
  critical_attention: (d) => d.priority.level === "critical",
  onboarding_attention: (d) =>
    hasSig(d, "registration_no_start") ||
    hasSig(d, "pocket_registration_incomplete") ||
    hasSig(d, "email_not_confirmed"),
  sla_breached: (d, clock) =>
    !!d.user.operations.sla && clock.nowMs() >= new Date(d.user.operations.sla.dueAt).getTime(),
  due_today: (d, clock) => {
    const due = d.user.operations.sla?.dueAt ?? d.user.operations.nextFollowUpAt;
    if (!due) return false;
    const h = hoursUntil(clock, due);
    return h !== null && h >= 0 && h <= 24;
  },
  mentor_review: (d) =>
    hasSig(d, "report_pending") ||
    hasSig(d, "mentor_sla_risk") ||
    hasSig(d, "report_rejected_no_return") ||
    d.user.operations.mentorState === "queued" ||
    d.user.operations.mentorState === "reviewing" ||
    d.user.operations.mentorState === "blocked",
  support_blockers: (d) => hasSig(d, "support_blocked"),
  checkpoint_attention: (d) =>
    hasSig(d, "checkpoint_grace_active") || hasSig(d, "checkpoint_approaching") || hasSig(d, "financial_access_suspended"),
  learning_stalled: (d) =>
    hasSig(d, "progression_stalled") ||
    hasSig(d, "lesson_abandoned") ||
    hasSig(d, "repeated_test_failure") ||
    hasSig(d, "inactive_7_days") ||
    hasSig(d, "dormant_14_days") ||
    hasSig(d, "dormant_30_days"),
  returned_users: (d) => hasSig(d, "returned_after_absence"),
  new_funded_users: (d, clock) => {
    const ftdAt = d.user.financial.ftd?.at ?? null;
    const h = hoursSince(clock, ftdAt);
    return d.user.state.lifecycleStage === "first_depositor" || (h !== null && h <= 24);
  },
  repeat_funders: (d) =>
    d.user.state.valueSegments.includes("repeat_funder") || d.user.state.valueSegments.includes("frequent_repeat_funder"),
  communication_suppression: (d) => hasSig(d, "communication_fatigue"),
  data_quality_issues: (d) => hasSig(d, "pocket_data_conflict") || hasSig(d, "balance_data_stale"),
};

const HIDDEN_FINANCIAL: FinancialProjection = {
  mode: "hidden",
  amountUsd: null,
  bucket: null,
  label: "—",
  // Withheld by queue policy (QUEUES_WITHOUT_FINANCIALS), not absent from source.
  hiddenReason: "not_permitted",
  stale: false,
};

function toItem(d: Derivation, code: TodayQueueCode, role: CrmRole): TodayQueueItem {
  const isStale =
    hasSig(d, "balance_data_stale") || d.user.state.fundingStatus === "balance_unknown";
  const financial = QUEUES_WITHOUT_FINANCIALS.has(code)
    ? HIDDEN_FINANCIAL
    : projectFinancial({ role, amountUsd: d.user.financial.balanceUsd, isStale });
  return {
    userId: d.user.identity.userId,
    displayName: d.user.identity.displayName,
    queueCode: code,
    priority: d.priority.level,
    reason: d.signals[0]?.reason ?? d.priority.reasonCode,
    reasonCode: d.priority.reasonCode,
    evidence: d.priority.evidence,
    ownerId: d.user.operations.primaryOwnerId,
    dueAt: d.user.operations.sla?.dueAt ?? d.user.operations.nextFollowUpAt ?? null,
    recommendedAction: d.recommendations[0] ?? null,
    signalCodes: d.signals.map((s) => s.code),
    freshness: { asOf: d.user.financial.balanceTimestamp, isStale },
    financial,
    identity: projectIdentity({
      role,
      userId: d.user.identity.userId,
      displayName: d.user.identity.displayName,
      maskedEmail: d.user.identity.maskedEmail,
      fullEmail: d.user.identity.fullEmail,
      context: "list",
    }),
  };
}

/** Build the full Today workspace for a role from the dataset. */
export function buildTodayWorkspace(users: MockUser[], clock: Clock, role: CrmRole): TodayWorkspaceResult {
  const derivations: Derivation[] = users.map((user) => {
    const signals = computeSignals(user, clock);
    return {
      user,
      signals,
      priority: computePriority(user, signals, clock),
      recommendations: deriveRecommendations(user, signals),
    };
  });

  const distinct = new Set<string>();
  const queues: TodayQueue[] = TODAY_QUEUE_ORDER.map((code) => {
    const members = derivations
      .filter((d) => QUEUE_MEMBERSHIP[code](d, clock))
      .sort((a, b) => comparePriority(a, b, clock));
    for (const m of members) distinct.add(m.user.identity.userId);
    return {
      code,
      title: QUEUE_TITLE[code],
      priority: QUEUE_PRIORITY[code],
      items: members.map((d) => toItem(d, code, role)),
    };
  });

  return {
    generatedAt: clock.nowIso(),
    role,
    distinctUserCount: distinct.size,
    queues,
  };
}
