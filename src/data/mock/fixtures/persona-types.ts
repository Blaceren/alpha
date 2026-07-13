// SYNTHETIC MOCK DATA — NOT PRODUCTION.
// Raw persona definitions use RELATIVE offsets (…DaysAgo / …HoursAgo). Absolute
// timestamps are resolved by the builder against a Clock, so no relative strings
// are ever baked into fixtures (Phase 1B1 §2).
import type {
  EngagementStatus,
  FundingStatus,
  LifecycleStage,
  OperationalBlocker,
  ValueSegment,
} from "@/domain/lifecycle/state";
import type { CheckpointStatus } from "@/domain/financial/financial";

export interface RawDeposit {
  usd: number;
  daysAgo: number;
  kind: "ftd" | "redeposit";
}
export interface RawWithdrawal {
  usd: number;
  daysAgo: number;
  status: "requested" | "cancelled" | "completed";
}

export interface RawGrace {
  endsInHours: number;
  confirmations: number;
  openTrades: boolean;
  checkpointLevel: number;
}

export interface RawSla {
  key: string;
  startedHoursAgo: number;
  durationHours: number;
}

export interface RawPersona {
  id: string;
  name: string;
  maskedEmail: string;
  fullEmail: string;
  country: string;
  locale: string;
  timezone: string;
  registeredDaysAgo: number;
  acquisitionSource: string;
  campaign: string;
  deviceClass: "desktop" | "mobile" | "tablet";

  // 5-dimension state
  lifecycleStage: LifecycleStage;
  fundingStatus: FundingStatus;
  engagementStatus: EngagementStatus;
  valueSegments: ValueSegment[];
  blockers: OperationalBlocker[];
  reasonCode: string;
  evidence: string[];
  stateExpiresInHours?: number;

  // progression
  level: number;
  highestCompletedLevel: number;
  xp: number;
  nextRequiredXp: number;
  currentModule: string;
  checkpointStatus?: CheckpointStatus;
  /** Hours since last meaningful action; null = never. */
  lastActionHoursAgo: number | null;

  // learning
  lastLesson: string | null;
  lessonProgressPct: number;
  testAttempts: number;
  latestScore: number | null;
  reportState: "none" | "pending" | "approved" | "rejected";
  reportSubmittedHoursAgo?: number;
  mentorReviewState: "none" | "queued" | "in_review" | "approved" | "rejected";
  lastLearningHoursAgo: number | null;

  // identity — ATA account email confirmation (SEPARATE axis from Pocket).
  emailConfirmed: boolean;

  // financial — Pocket affiliate registration status (not "connection")
  registrationStatus: "not_registered" | "registration_pending" | "registered";
  hasTraderId: boolean;
  /** number = USD, null = no balance yet, "unknown" = balance unavailable. */
  balanceUsd: number | null | "unknown";
  /** Minutes since balance timestamp; null = no timestamp at all. */
  balanceAgeMinutes: number | null;
  ftdUsd: number | null;
  ftdDaysAgo?: number;
  redeposits: RawDeposit[];
  successfulWithdrawals: RawWithdrawal[];
  withdrawalRequests: RawWithdrawal[];
  pocketConflict: boolean;
  previousBalanceUsd?: number;
  previousBalanceHoursAgo?: number;
  grace?: RawGrace;
  accessSuspended: boolean;
  accessRestoredDaysAgo?: number;

  // operations
  primaryOwnerId: string | null;
  activeTaskCount: number;
  activeCaseCount: number;
  lastEmployeeContactDaysAgo: number | null;
  /** Hours until next follow-up; negative = overdue; null = none. */
  nextFollowUpInHours: number | null;
  supportState: "none" | "open" | "blocked" | "resolved";
  mentorState: "none" | "queued" | "reviewing" | "blocked";
  sla?: RawSla;
  communications24h: number;
  communications7d: number;

  primaryScenario: string;
}
