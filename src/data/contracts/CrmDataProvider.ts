/**
 * CrmDataProvider — the single boundary between UI/application layers and data.
 * Source of truth: docs/DATA_PROVIDER_CONTRACT.md.
 *
 * MockCrmDataProvider (now) and ApiCrmDataProvider (later) implement this exact
 * interface, so the UI is never rewritten when the data source changes.
 * Phase 1A ships the full typed contract; several operations return minimal
 * shapes and small/empty data until later phases fill them in.
 */
import type { EmployeeId, ISODateString, UserId } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";
import type {
  EngagementStatus,
  FundingStatus,
  LifecycleStage,
  OperationalBlocker,
  ValueSegment,
} from "@/domain/lifecycle/state";
import type { SignalCode, UserSignal } from "@/domain/signals/signal";
import type { CrmTask, PriorityLevel } from "@/domain/tasks/task";
import type { CrmCase, CaseStatus, CaseType } from "@/domain/cases/case";
import type { FinancialBucket } from "@/domain/financial/financial";
import type { PriorityBand } from "@/domain/priority/priority";
import type { UserSummary } from "@/domain/users/user";
import type { User360 } from "@/domain/users/user-360";
import type { CrmNote } from "@/domain/notes/note";
import type { TodayWorkspace } from "@/domain/today/today";
import type { TodayQuery } from "@/domain/today/today-query";
import type { Paginated, PageParams, Result, SortParam } from "./result";

/** Caller context for permission-aware operations. */
export interface CrmContext {
  actorId: EmployeeId;
  role: CrmRole;
  now: ISODateString;
}

/* ------------------------------------------------------------------ Today */

/**
 * The Today read model is defined in the domain (`@/domain/today/today`) and
 * re-exported here, exactly as User 360 is: the provider returns an aggregate
 * that is ALREADY projected for `ctx.role`.
 *
 * It replaces a Phase 1A placeholder whose `TodayGroupKey` list ("today_tasks",
 * "no_progress", "new_ftd", …) never matched what the builder produced — the
 * mock provider had to cast `key: q.code as never` to satisfy it, so the
 * contract was documenting a shape nothing returned (Phase 1B3, D-42).
 */
export type {
  TodayBasis,
  TodayBasisCode,
  TodayDue,
  TodayEvent,
  TodayFilterOptions,
  TodayFreshness,
  TodayQueueItem,
  TodayQueueSection,
  TodaySectionKey,
  TodaySortField,
  TodaySummary,
  TodayWorkspace,
} from "@/domain/today/today";
export type { TodayFilters, TodayQuery } from "@/domain/today/today-query";

/** Input for `getTodayWorkspace`. Filtering and sorting are provider-owned. */
export type GetTodayInput = TodayQuery;

/* ------------------------------------------------------------------ Users */

export type SlaStateFilter = "on_track" | "warning" | "breached" | "none";

export interface UserFilters {
  lifecycleStage?: LifecycleStage[];
  fundingStatus?: FundingStatus[];
  engagementStatus?: EngagementStatus[];
  valueSegment?: ValueSegment[];
  blocker?: OperationalBlocker[];
  signals?: SignalCode[];
  ownerId?: EmployeeId[] | "unassigned";
  currentLevelMin?: number;
  currentLevelMax?: number;
  xpMin?: number;
  xpMax?: number;
  balanceBucket?: FinancialBucket[];
  netDepositBucket?: FinancialBucket[];
  /** Pocket affiliate registration status. Only the three canonical values. */
  registrationStatus?: ("not_registered" | "registration_pending" | "registered")[];
  /** Computed priority band (derived by the provider). */
  priority?: PriorityBand[];
  lastActionFrom?: ISODateString;
  lastActionTo?: ISODateString;
  registeredFrom?: ISODateString;
  registeredTo?: ISODateString;
  acquisitionSource?: string[];
  country?: string[];
  hasOpenTask?: boolean;
  hasOpenCase?: boolean;
  slaState?: SlaStateFilter[];
  /** Free-text search over name / id / masked email. */
  query?: string;
}

export type UserSortField =
  | "name"
  | "owner"
  | "registeredAt"
  | "lastMeaningfulActionAt"
  | "currentLevel"
  | "xp"
  | "balance"
  | "netDeposits"
  | "redepositCount"
  | "priority"
  | "dueAt";

export interface SearchUsersInput {
  query?: string;
  filters?: UserFilters;
  sort?: SortParam<UserSortField>;
  page?: PageParams;
  segmentId?: string;
}

/* ---------------------------------------------------- Timeline / segments */

export type TimelineSource =
  | "product"
  | "pocket"
  | "employee"
  | "communication"
  | "automation"
  | "lifecycle"
  | "signal"
  | "task"
  | "case";

export interface UserTimelineEvent {
  id: string;
  userId: UserId;
  at: ISODateString;
  source: TimelineSource;
  kind: string;
  title: string;
  summary: string | null;
  sensitivity: "LOW" | "MEDIUM" | "HIGH";
}

export interface GetTimelineInput {
  userId: UserId;
  sources?: TimelineSource[];
  from?: ISODateString;
  to?: ISODateString;
  page?: PageParams;
}

export interface Segment {
  id: string;
  name: string;
  kind: "system" | "saved";
  description: string;
  count: number | null;
}

/* ------------------------------------------------------------ Work items */

export interface GetUserTasksInput {
  userId: UserId;
  page?: PageParams;
}

export interface GetUserCasesInput {
  userId: UserId;
  type?: CaseType[];
  status?: CaseStatus[];
  page?: PageParams;
}

/**
 * The note model lives in the domain (`@/domain/notes/note`) and is re-exported
 * here, exactly as Today and User 360 are: one CrmNote, not a contract copy and a
 * domain copy to keep in sync (Phase 1B4-A).
 */
export type { CrmNote, NoteVisibility } from "@/domain/notes/note";

export interface GetUserNotesInput {
  userId: UserId;
  page?: PageParams;
}

/* --------------------------------------------------------------- Queues */

export interface QueueItem {
  userId: UserId;
  title: string;
  slaDueAt: ISODateString | null;
  slaBreached: boolean;
  priority: PriorityLevel;
  status: string;
  owner: EmployeeId | null;
}

export interface GetQueueInput {
  scope?: "own" | "team";
  page?: PageParams;
}

/* ----------------------------------------------------- Financial ops */

export interface FinancialOperationsSummary {
  generatedAt: ISODateString;
  checkpointApproaching: number;
  checkpointGrace: number;
  accessSuspended: number;
  dataConflicts: number;
}

export interface GetFinOpsInput {
  aggregatedOnly?: boolean;
}

/* ----------------------------------------------------- Recommendations */

export interface RecommendedAction {
  id: string;
  userId: UserId;
  title: string;
  rationale: string;
  priority: PriorityLevel;
}

export interface GetRecommendedInput {
  userId?: UserId;
  scope?: "user" | "today";
  limit?: number;
}

/* --------------------------------------------------- Provider interface */

export interface CrmDataProvider {
  getTodayWorkspace(ctx: CrmContext, input: GetTodayInput): Promise<Result<TodayWorkspace>>;
  searchUsers(ctx: CrmContext, input: SearchUsersInput): Promise<Result<Paginated<UserSummary>>>;
  getUserById(ctx: CrmContext, input: { userId: UserId }): Promise<Result<UserSummary>>;
  /**
   * Read-only User 360 aggregate (Phase 1C). Composes the derivation layer and
   * returns it ALREADY projected for `ctx.role` in a single result, so the UI
   * never assembles permissions from several partial reads. Read-only: it has
   * no mutating counterpart in this phase.
   */
  getUser360(ctx: CrmContext, input: { userId: UserId }): Promise<Result<User360>>;
  getUserTimeline(ctx: CrmContext, input: GetTimelineInput): Promise<Result<Paginated<UserTimelineEvent>>>;
  getUserTasks(ctx: CrmContext, input: GetUserTasksInput): Promise<Result<Paginated<CrmTask>>>;
  getUserCases(ctx: CrmContext, input: GetUserCasesInput): Promise<Result<Paginated<CrmCase>>>;
  getUserNotes(ctx: CrmContext, input: GetUserNotesInput): Promise<Result<Paginated<CrmNote>>>;
  getSegments(ctx: CrmContext, input: { kind?: "system" | "saved" }): Promise<Result<Segment[]>>;
  getMentorQueue(ctx: CrmContext, input: GetQueueInput): Promise<Result<Paginated<QueueItem>>>;
  getSupportQueue(ctx: CrmContext, input: GetQueueInput): Promise<Result<Paginated<QueueItem>>>;
  getFinancialOperationsSummary(ctx: CrmContext, input: GetFinOpsInput): Promise<Result<FinancialOperationsSummary>>;
  getUserSignals(ctx: CrmContext, input: { userId: UserId; includeExpired?: boolean }): Promise<Result<UserSignal[]>>;
  getRecommendedActions(ctx: CrmContext, input: GetRecommendedInput): Promise<Result<RecommendedAction[]>>;
}
