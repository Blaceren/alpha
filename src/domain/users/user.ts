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
import type { FinancialProjection } from "@/domain/financial/projection";
import type { PriorityBand } from "@/domain/priority/priority";

export interface UserSummary {
  id: UserId;
  displayName: string;
  maskedEmail: string;
  lifecycleStage: LifecycleStage;
  fundingStatus: FundingStatus;
  engagementStatus: EngagementStatus;
  currentLevel: number;
  lastMeaningfulActionAt: ISODateString | null;

  // ---- Phase 1B1 enriched, permission-safe projections ----
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
  registeredAt?: ISODateString;
  country?: string;
  acquisitionSource?: string;
  activeTaskCount?: number;
  activeCaseCount?: number;
  signalCodes?: SignalCode[];
}
