/**
 * User 360 aggregate — the permission-projected read model behind `/users/[id]`.
 * Returned by CrmDataProvider.getUser360 (Phase 1C).
 *
 * Every field here is ALREADY projected for the caller's role. The UI renders
 * what it receives and never re-decides visibility: an exact amount or a full
 * email simply is not present for a role that may not see it, so it cannot leak
 * through the DOM, props, title/aria attributes, or serialized page data.
 *
 * Framework-agnostic — no React/Next imports.
 */
import type { Freshness, ISODateString, StateEvidence, UserId } from "@/domain/shared/primitives";
import type {
  EngagementStatus,
  FundingStatus,
  LifecycleStage,
  OperationalBlocker,
  ValueSegment,
} from "@/domain/lifecycle/state";
import type { SignalCode, SignalSeverity } from "@/domain/signals/signal";
import type { CheckpointStatus } from "@/domain/financial/financial";
import type { FinancialProjection } from "@/domain/financial/projection";
import type { IdentityProjection } from "@/domain/identity/identity-projection";
import type { PriorityBand } from "@/domain/priority/priority";
import type {
  ActionPriority,
  RecommendedActionCode,
  SuggestedChannel,
} from "@/domain/recommendations/catalog";
import type { RegistrationStatus } from "@/domain/users/user";
import type { TimelineEventSource } from "@/domain/users/user-timeline";

/** Identity block. `projection` is the ONLY source of name/email/pseudonym. */
export interface User360Identity {
  userId: UserId;
  /** Permission-aware. `detail` context — full email only for permitted roles. */
  projection: IdentityProjection;
  registeredAt: ISODateString;
  /** ATA account email confirmation — independent of Pocket registration (D-23). */
  emailConfirmed: boolean;
  /** Non-identifying context; null when the role gets no identity at all. */
  country: string | null;
  locale: string | null;
  timezone: string | null;
  acquisitionSource: string | null;
  campaign: string | null;
}

/** Why this user needs attention (or does not). Never an opaque score (D-20). */
export interface User360Attention {
  priority: PriorityBand;
  reasonCode: string;
  evidence: StateEvidence[];
  /** Active signals the priority rule interpreted — lets the UI link the
   *  interpretation to its source instead of repeating it as another badge. */
  sourceSignalCodes: SignalCode[];
}

/** The five orthogonal state dimensions (D-01) — never merged into one enum. */
export interface User360States {
  lifecycleStage: LifecycleStage;
  fundingStatus: FundingStatus;
  engagementStatus: EngagementStatus;
  valueSegments: ValueSegment[];
  blockers: OperationalBlocker[];
  /** Pocket affiliate registration (D-27) — a separate axis from the four above. */
  registrationStatus: RegistrationStatus;
}

/**
 * Learning progress from data that actually exists in the CRM read model.
 * `nextCheckpointRequiredUsd` is the PUBLISHED curriculum grid constant, not a
 * user balance — but it is still withheld from roles without exact financials,
 * because grid + delta% would reconstruct the exact balance (see projection).
 */
export interface User360Learning {
  curriculumVersion: string;
  currentLevel: number;
  highestCompletedLevel: number;
  xp: number;
  nextRequiredXp: number;
  currentModule: string;
  nextLevel: number | null;
  lastLesson: string | null;
  lessonProgressPct: number;
  testAttempts: number;
  latestScore: number | null;
  reportState: "none" | "pending" | "approved" | "rejected";
  mentorReviewState: "none" | "queued" | "in_review" | "approved" | "rejected";
  lastLearningActivityAt: ISODateString | null;
  lastMeaningfulActionAt: ISODateString | null;
  checkpointStatus: CheckpointStatus;
  nextCheckpointLevel: number | null;
  nextCheckpointRequiredUsd: number | null;
}

/** A derived signal, with its explanation already permission-filtered. */
export interface User360Signal {
  code: SignalCode;
  severity: SignalSeverity;
  /**
   * Human explanation, or null when it was withheld because it embeds
   * balance-derived numbers the role may not see. Null (rather than a neutral
   * restatement of the signal name) so the UI can simply omit the line instead
   * of printing the title twice.
   */
  reason: string | null;
  evidence: StateEvidence[];
  calculatedAt: ISODateString;
  expiresAt: ISODateString | null;
}

/** A recommended action. READ-ONLY — the CRM cannot execute it in Phase 1C. */
export interface User360Recommendation {
  code: RecommendedActionCode;
  title: string;
  reason: string;
  priority: ActionPriority;
  suggestedChannel: SuggestedChannel;
  humanApprovalRequired: boolean;
  sourceSignalCodes: SignalCode[];
  /** True when the caller's role is among the action's allowed roles. */
  allowedForRole: boolean;
}

/** Financial context. Amounts exist only as permission-aware projections. */
export interface User360Financial {
  balance: FinancialProjection;
  netDeposits: FinancialProjection;
  redepositCount: number;
  hasFtd: boolean;
  accessSuspended: boolean;
  pocketConflict: boolean;
  /** Grace carries counts/levels/timers only — never an amount. */
  grace: {
    active: boolean;
    endsAt: ISODateString | null;
    belowThresholdConfirmations: number;
    hasOpenTrades: boolean;
    checkpointLevel: number | null;
  } | null;
  freshness: Freshness;
}

export type SlaState = "on_track" | "warning" | "breached" | "none";

/** Operational context: who owns this user and what work is open. */
export interface User360Owner {
  ownerId: string | null;
  activeTaskCount: number;
  activeCaseCount: number;
  lastEmployeeContactAt: ISODateString | null;
  nextFollowUpAt: ISODateString | null;
  supportState: "none" | "open" | "blocked" | "resolved";
  mentorState: "none" | "queued" | "reviewing" | "blocked";
  sla: { key: string; dueAt: ISODateString; state: SlaState } | null;
}

/**
 * A recent operational event — a narrowed view of the canonical timeline entry
 * (see `user-timeline.ts`), already projected for the caller's role. HIGH
 * (financial) events are withheld from roles without exact financials.
 */
export interface User360Event {
  id: string;
  at: ISODateString;
  source: TimelineEventSource;
  kind: string;
  title: string;
}

export interface User360 {
  identity: User360Identity;
  attention: User360Attention;
  states: User360States;
  learning: User360Learning;
  financial: User360Financial;
  owner: User360Owner;
  signals: User360Signal[];
  recommendations: User360Recommendation[];
  activity: User360Event[];
  /** Deterministic — derived from the provider clock, never the browser clock. */
  generatedAt: ISODateString;
}
