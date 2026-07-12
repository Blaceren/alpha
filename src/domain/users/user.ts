/**
 * Minimal user projection for the Phase 1A shell smoke.
 * The full CrmUser aggregate (docs/CRM_DOMAIN_MODEL.md §1) arrives in later phases.
 */
import type { ISODateString, UserId } from "@/domain/shared/primitives";
import type {
  EngagementStatus,
  FundingStatus,
  LifecycleStage,
} from "@/domain/lifecycle/state";

/** Flattened row used by the (future) Users table. Financials are display-safe. */
export interface UserSummary {
  id: UserId;
  displayName: string;
  maskedEmail: string;
  lifecycleStage: LifecycleStage;
  fundingStatus: FundingStatus;
  engagementStatus: EngagementStatus;
  currentLevel: number;
  lastMeaningfulActionAt: ISODateString | null;
}
