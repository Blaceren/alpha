/**
 * Full resolved synthetic user aggregate used by the mock domain.
 * Produced by the fixture builder from raw persona definitions + a Clock.
 * All timestamps are absolute ISO strings resolved from FixedMockClock.
 */
import type { ISODateString, UserId } from "@/domain/shared/primitives";
import type {
  EngagementStatus,
  FundingStatus,
  LifecycleStage,
  OperationalBlocker,
  ValueSegment,
} from "@/domain/lifecycle/state";
import type { CheckpointStatus } from "@/domain/financial/financial";

export interface MockIdentity {
  userId: UserId;
  displayName: string;
  maskedEmail: string;
  /** Synthetic full email (example.test domains only) for permission testing. */
  fullEmail: string;
  /**
   * ATA account email confirmation ONLY. Does NOT represent Pocket registration
   * or the Pocket "Email Confirmation" provider event — those are separate.
   */
  emailConfirmed: boolean;
  country: string;
  locale: string;
  timezone: string;
  registeredAt: ISODateString;
  acquisitionSource: string;
  campaign: string;
  deviceClass: "desktop" | "mobile" | "tablet";
}

export interface MockProductState {
  lifecycleStage: LifecycleStage;
  fundingStatus: FundingStatus;
  engagementStatus: EngagementStatus;
  valueSegments: ValueSegment[];
  blockers: OperationalBlocker[];
  reasonCode: string;
  evidence: string[];
  calculatedAt: ISODateString;
  expiresAt: ISODateString | null;
}

export interface MockProgression {
  curriculumVersion: string;
  currentLevel: number;
  highestCompletedLevel: number;
  xp: number;
  nextRequiredXp: number;
  currentModule: string;
  nextLevel: number | null;
  nextCheckpointLevel: number | null;
  nextCheckpointRequiredUsd: number | null;
  checkpointStatus: CheckpointStatus;
  lastMeaningfulActionAt: ISODateString | null;
}

export interface MockLearning {
  lastLesson: string | null;
  lessonProgressPct: number;
  testAttempts: number;
  latestScore: number | null;
  reportState: "none" | "pending" | "approved" | "rejected";
  reportSubmittedAt: ISODateString | null;
  mentorReviewState: "none" | "queued" | "in_review" | "approved" | "rejected";
  lastLearningActivityAt: ISODateString | null;
}

export interface MockDeposit {
  amountUsd: number;
  at: ISODateString;
  kind: "ftd" | "redeposit";
}
export interface MockWithdrawal {
  amountUsd: number;
  at: ISODateString;
  status: "requested" | "cancelled" | "completed";
}

export interface MockFinancial {
  // Pocket AFFILIATE registration status. `registered` means the backend
  // received and accepted the confirmed Pocket registration event via the
  // affiliate flow. NOT set by user click, local form, deposit, financial data,
  // or email confirmation. ATA email confirmation is a separate identity axis.
  registrationStatus: "not_registered" | "registration_pending" | "registered";
  traderId: string | null;
  /** Real balance in USD; null when unknown/unavailable. */
  balanceUsd: number | null;
  balanceTimestamp: ISODateString | null;
  ftd: MockDeposit | null;
  redeposits: MockDeposit[];
  successfulWithdrawals: MockWithdrawal[];
  withdrawalRequests: MockWithdrawal[];
  /** Precomputed & validated: FTD + redeposits − successful withdrawals. */
  netDepositsUsd: number;
  pocketConflict: boolean;
  /** Previous balance for rapid-decline detection (synthetic). */
  previousBalanceUsd: number | null;
  previousBalanceAt: ISODateString | null;
  grace: {
    active: boolean;
    startedAt: ISODateString | null;
    endsAt: ISODateString | null;
    belowThresholdConfirmations: number;
    hasOpenTrades: boolean;
    checkpointLevel: number | null;
  } | null;
  accessSuspended: boolean;
  accessRestoredAt: ISODateString | null;
}

export interface MockOperations {
  primaryOwnerId: string | null;
  activeTaskCount: number;
  activeCaseCount: number;
  lastEmployeeContactAt: ISODateString | null;
  nextFollowUpAt: ISODateString | null;
  supportState: "none" | "open" | "blocked" | "resolved";
  mentorState: "none" | "queued" | "reviewing" | "blocked";
  /** Active SLA on this user's most pressing work item, if any. */
  sla: {
    key: string;
    startedAt: ISODateString;
    dueAt: ISODateString;
  } | null;
  communications24h: number;
  communications7d: number;
}

export interface MockUser {
  identity: MockIdentity;
  state: MockProductState;
  progression: MockProgression;
  learning: MockLearning;
  financial: MockFinancial;
  operations: MockOperations;
  /** The persona's primary scenario tag (for coverage). */
  primaryScenario: string;
}
