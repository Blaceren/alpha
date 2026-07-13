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
import type { UserSummary } from "@/domain/users/user";
import type { Paginated, PageParams, Result, SortParam } from "./result";

/** Caller context for permission-aware operations. */
export interface CrmContext {
  actorId: EmployeeId;
  role: CrmRole;
  now: ISODateString;
}

/* ------------------------------------------------------------------ Today */

export type TodayGroupKey =
  | "today_tasks"
  | "overdue"
  | "no_progress"
  | "mentor_sla"
  | "support_blockers"
  | "rejected_reports"
  | "checkpoint_approaching"
  | "checkpoint_grace"
  | "suspended_access"
  | "returned"
  | "new_ftd"
  | "repeat_funders"
  | "communication_fatigue"
  | "data_conflicts"
  | "recommended_actions";

export interface TodayItem {
  userId: UserId;
  reason: string;
  priority: PriorityLevel;
  recommendedAction: string | null;
  owner: EmployeeId | null;
  dueAt: ISODateString | null;
  status: string;
}

export interface TodayGroup {
  key: TodayGroupKey;
  title: string;
  priority: PriorityLevel;
  items: TodayItem[];
}

export interface TodayWorkspace {
  generatedAt: ISODateString;
  groups: TodayGroup[];
}

export interface GetTodayInput {
  scope?: "own" | "team";
  groups?: TodayGroupKey[];
}

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

export interface CrmNote {
  id: string;
  userId: UserId | null;
  caseId: string | null;
  authorId: EmployeeId;
  body: string;
  visibility: "team" | "role_restricted" | "private";
  pinned: boolean;
  createdAt: ISODateString;
}

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
