/**
 * User list projection returned by searchUsers / getUserById.
 * Core fields are always present; enriched fields (Phase 1B1) are permission-safe
 * projections attached by the provider. Financials are NEVER raw exact values
 * unless the caller's role permits it (see FinancialProjection).
 */
import type { ISODateString, UserId } from "@/domain/shared/primitives";
import type {
  EngagementStatus,
  FundingStatus,
  LifecycleStage,
  OperationalBlocker,
  ValueSegment,
} from "@/domain/lifecycle/state";
import type { SignalCode } from "@/domain/signals/signal";
import type { CheckpointStatus } from "@/domain/financial/financial";
import type { FinancialProjection } from "@/domain/financial/projection";
import type { IdentityProjection } from "@/domain/identity/identity-projection";
import type { PriorityBand } from "@/domain/priority/priority";
import type { RecommendedActionCode } from "@/domain/recommendations/catalog";

/**
 * Pocket affiliate registration status — exactly three canonical values (D-27).
 * `registered` means the backend accepted a confirmed Pocket registration event.
 */
export type RegistrationStatus = "not_registered" | "registration_pending" | "registered";

export interface UserSummary {
  id: UserId;
  displayName: string;
  maskedEmail: string;
  lifecycleStage: LifecycleStage;
  fundingStatus: FundingStatus;
  engagementStatus: EngagementStatus;
  /** Pocket affiliate registration status (backend-confirmed for `registered`). */
  registrationStatus: RegistrationStatus;
  /** ATA account email confirmation — separate from Pocket registration. */
  emailConfirmed: boolean;
  currentLevel: number;
  lastMeaningfulActionAt: ISODateString | null;

  // ---- Phase 1B1 enriched, permission-safe projections ----
  /** Permission-aware identity projection for the LIST context (always masked). */
  identity?: IdentityProjection;
  valueSegments?: ValueSegment[];
  blockers?: OperationalBlocker[];
  ownerId?: string | null;
  priority?: PriorityBand;
  priorityReasonCode?: string;
  /** Permission-aware balance projection (exact / bucket / aggregated / hidden). */
  balance?: FinancialProjection;
  /** Permission-aware net deposits projection. */
  netDeposits?: FinancialProjection;
  redepositCount?: number;
  xp?: number;
  checkpointStatus?: CheckpointStatus;
  topRecommendationCode?: RecommendedActionCode | null;
  registeredAt?: ISODateString;
  country?: string;
  locale?: string;
  acquisitionSource?: string;
  campaign?: string;
  activeTaskCount?: number;
  activeCaseCount?: number;
  signalCodes?: SignalCode[];
}
