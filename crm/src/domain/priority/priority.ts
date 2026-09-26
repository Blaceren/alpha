/**
 * Rule-based priority model (Phase 1B1 §8). NO opaque numeric score — priority is
 * one of critical/high/normal/low, decided by explicit ordered rules, each with a
 * reasonCode and evidence. A private rule index is used only for deterministic
 * ordering; it is never surfaced as a score.
 */
import type { Clock } from "@/lib/clock";
import { hoursSince, hoursUntil } from "@/lib/clock";
import type { StateEvidence } from "@/domain/shared/primitives";
import type { MockUser } from "@/domain/users/mock-user";
import type { ComputedSignal } from "@/domain/signals/engine";
import type { SignalCode } from "@/domain/signals/signal";

export type PriorityBand = "critical" | "high" | "normal" | "low";

export interface PriorityResult {
  level: PriorityBand;
  reasonCode: string;
  evidence: StateEvidence[];
  /**
   * The active signals the matched rule interpreted. Lets a UI link the priority
   * back to its source instead of repeating the same fact as a separate badge.
   * Empty when the priority came from state rather than a signal.
   */
  sourceSignalCodes: SignalCode[];
  /** Private ordering index (lower = more urgent). Not a public score. */
  ruleIndex: number;
}

const BAND_RANK: Record<PriorityBand, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

interface Rule {
  index: number;
  level: PriorityBand;
  reasonCode: string;
  /** Signal codes this rule interprets, narrowed to the ones actually active. */
  sources: (s: ComputedSignal[]) => SignalCode[];
  match: (u: MockUser, s: ComputedSignal[], clock: Clock) => StateEvidence[] | null;
}

const has = (s: ComputedSignal[], code: ComputedSignal["code"]) => s.find((x) => x.code === code) ?? null;

/** Declares a rule's source signals; keeps the ladder the single source of truth. */
const from =
  (...codes: SignalCode[]) =>
  (s: ComputedSignal[]): SignalCode[] =>
    codes.filter((c) => s.some((x) => x.code === c));

function evidenceFrom(sig: ComputedSignal | null, extra?: StateEvidence): StateEvidence[] {
  const base = sig ? sig.evidence : [];
  return extra ? [...base, extra] : base;
}

/** Ordered rules — first match wins. Mirrors the documented priority ladder. */
const RULES: Rule[] = [
  {
    index: 1,
    level: "critical",
    reasonCode: "critical_support_issue",
    sources: from("support_blocked"),
    match: (u, s) => {
      const sig = has(s, "support_blocked");
      return sig || u.operations.supportState === "blocked" ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 2,
    level: "critical",
    reasonCode: "financial_access_suspended",
    sources: from("financial_access_suspended"),
    match: (_u, s) => {
      const sig = has(s, "financial_access_suspended");
      return sig ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 3,
    level: "high",
    reasonCode: "financial_data_conflict",
    sources: from("pocket_data_conflict"),
    match: (u, s) => {
      const sig = has(s, "pocket_data_conflict");
      return sig || u.financial.pocketConflict ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 4,
    level: "high",
    reasonCode: "sla_breach",
    sources: from("mentor_sla_risk"),
    match: (u, s, clock) => {
      const sig = has(s, "mentor_sla_risk");
      if (!u.operations.sla) return null;
      const breached = clock.nowMs() >= new Date(u.operations.sla.dueAt).getTime();
      return breached ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 5,
    level: "high",
    reasonCode: "checkpoint_grace_near_expiration",
    sources: from("checkpoint_grace_active"),
    match: (u, s, clock) => {
      const sig = has(s, "checkpoint_grace_active");
      if (!u.financial.grace?.active) return null;
      const endsIn = hoursUntil(clock, u.financial.grace.endsAt);
      return endsIn !== null && endsIn <= 8 ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 6,
    level: "high",
    reasonCode: "report_or_mentor_blocker",
    sources: from("report_rejected_no_return", "mentor_sla_risk", "report_pending"),
    match: (_u, s) => {
      const sig = has(s, "report_rejected_no_return") ?? has(s, "mentor_sla_risk") ?? has(s, "report_pending");
      return sig ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 7,
    level: "high",
    reasonCode: "rapid_balance_decline",
    sources: from("rapid_balance_decline"),
    match: (_u, s) => {
      const sig = has(s, "rapid_balance_decline");
      return sig ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 8,
    level: "normal",
    reasonCode: "returned_user",
    sources: from("returned_after_absence"),
    match: (_u, s) => {
      const sig = has(s, "returned_after_absence");
      return sig ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 9,
    level: "normal",
    reasonCode: "progression_stalled",
    sources: from("progression_stalled", "inactive_7_days", "dormant_14_days", "dormant_30_days"),
    match: (_u, s) => {
      const sig = has(s, "progression_stalled") ?? has(s, "inactive_7_days") ?? has(s, "dormant_14_days") ?? has(s, "dormant_30_days");
      return sig ? evidenceFrom(sig) : null;
    },
  },
  {
    index: 10,
    level: "normal",
    reasonCode: "ordinary_follow_up",
    sources: (s) => (s[0] ? [s[0].code] : []),
    match: (_u, s) => (s.length > 0 ? evidenceFrom(s[0]!) : null),
  },
];

/** Compute the priority for a user given its computed signals. */
export function computePriority(user: MockUser, signals: ComputedSignal[], clock: Clock): PriorityResult {
  for (const rule of RULES) {
    const evidence = rule.match(user, signals, clock);
    if (evidence) {
      return {
        level: rule.level,
        reasonCode: rule.reasonCode,
        evidence,
        sourceSignalCodes: rule.sources(signals),
        ruleIndex: rule.index,
      };
    }
  }
  return {
    level: "low",
    reasonCode: "no_priority_signal",
    evidence: [],
    sourceSignalCodes: [],
    ruleIndex: 99,
  };
}

/**
 * Deterministic comparator for items of the SAME or different priority.
 * Order: band → ruleIndex → SLA dueAt → signal severity → last meaningful action → user id.
 */
export function comparePriority(
  a: { user: MockUser; priority: PriorityResult; signals: ComputedSignal[] },
  b: { user: MockUser; priority: PriorityResult; signals: ComputedSignal[] },
  clock: Clock,
): number {
  const band = BAND_RANK[a.priority.level] - BAND_RANK[b.priority.level];
  if (band !== 0) return band;

  const rule = a.priority.ruleIndex - b.priority.ruleIndex;
  if (rule !== 0) return rule;

  // SLA dueAt ascending (sooner first); users without SLA sort after.
  const aDue = a.user.operations.sla ? new Date(a.user.operations.sla.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.user.operations.sla ? new Date(b.user.operations.sla.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;

  // Signal severity (most severe first).
  const aSev = topSeverityRank(a.signals);
  const bSev = topSeverityRank(b.signals);
  if (aSev !== bSev) return aSev - bSev;

  // Last meaningful action ascending (older/more stale first).
  const aAct = hoursSince(clock, a.user.progression.lastMeaningfulActionAt) ?? Number.POSITIVE_INFINITY;
  const bAct = hoursSince(clock, b.user.progression.lastMeaningfulActionAt) ?? Number.POSITIVE_INFINITY;
  if (aAct !== bAct) return bAct - aAct;

  // Stable user id.
  return a.user.identity.userId.localeCompare(b.user.identity.userId);
}

function topSeverityRank(signals: ComputedSignal[]): number {
  return signals.reduce((min, s) => Math.min(min, SEVERITY_RANK[s.severity]), 4);
}
