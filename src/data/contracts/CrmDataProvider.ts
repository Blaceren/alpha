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
import type { AuditRecordView } from "@/domain/audit/audit-view";
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

/**
 * A note plus the capabilities the CURRENT actor holds over it (Phase 1B4-E).
 *
 * The point is that authorship-and-storage facts stay provider-owned. Whether a
 * note is body-editable depends on things the UI must not compute: that the note is
 * physically in the mutation overlay (not the generated fixture note), that it is
 * visible through the canonical projector, and that the actor authored it. A client
 * detecting "editable" from an id prefix like `note_mock_*` would be a second,
 * drifting copy of a rule the provider already owns — the exact failure D-39/D-40
 * had to undo. So the provider annotates each visible note and the UI renders the
 * flag.
 *
 * `getUserNotesView` returns these; the plain `getUserNotes` read is unchanged and
 * still returns bare `CrmNote`s for callers that do not act on them.
 */
export interface CrmNoteListItem {
  note: CrmNote;
  capabilities: {
    /**
     * `true` only when ALL hold: the actor's role has `edit_user_notes`; the note
     * is stored in the overlay `notes[]` (so never the immutable fixture note); the
     * note is visible to the actor; and `note.authorEmployeeId === ctx.actorId`.
     */
    canEditBody: boolean;
    /**
     * `true` under the SAME four conditions as `canEditBody` (Phase 1B5-C): the
     * actor's role has `edit_user_notes`; the note is stored in the overlay
     * `notes[]` (never the fixture note); the note is visible to the actor; and
     * `note.authorEmployeeId === ctx.actorId`. Changing a note's visibility is
     * author-only, exactly like editing its body (D-91/D-92) — the two capabilities
     * currently coincide, but they are separate fields so the UI never has to
     * assume they do. React reads the flag; it never inspects a note id or compares
     * an employee id.
     */
    canChangeVisibility: boolean;
    /**
     * `true` under the SAME conditions as `canEditBody`/`canChangeVisibility` (Phase
     * 1B6): the actor's role has `edit_user_notes`; the note is stored in the overlay
     * `notes[]` (never the fixture note); the note is visible to the actor; and
     * `note.authorEmployeeId === ctx.actorId`. Additionally the note must not already
     * be hidden by a later valid `note_deleted` record — but a note that survived the
     * canonical projection to reach this list inherently is not, so in practice this
     * coincides with the other two flags. Deleting is author-only, exactly like
     * editing (D-96). A separate field so the UI never assumes it coincides; React
     * reads the flag, never a note id and never an employee id.
     */
    canDelete: boolean;
  };
}

/* ---------------------------------------------------------------- Audit */

/**
 * The safe, UI-facing audit read model lives in the domain
 * (`@/domain/audit/audit-view`) and is re-exported here, exactly as Today, User
 * 360 and CrmNote are: one `AuditRecordView`, projected and ordered by the
 * provider, never a raw storage `AuditRecord` and never a contract copy to keep in
 * sync (Phase 1B5-B).
 */
export type { AuditRecordView } from "@/domain/audit/audit-view";

/**
 * Input for `getAuditRecords`. Only pagination — the first version has no filters,
 * no search, no date range and no actor/user filter (D4), so nothing else is
 * added "for later".
 */
export interface GetAuditRecordsInput {
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

/* ----------------------------------------------------- Owner candidates */

/**
 * An employee who may be picked as a user's primary owner.
 *
 * Two fields on purpose. The picker needs an id to send and a caption to show,
 * and nothing else it could show would be honest: role, team, workload and the
 * employee's own users are either absent from the fixtures or would expose the
 * shape of a role's book to a caller that has no right to it. Adding them "for
 * later" would ship a field the mock has to invent.
 */
export interface PrimaryOwnerCandidate {
  employeeId: EmployeeId;
  displayName: string;
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
  /**
   * The same visible, projected, ordered notes as `getUserNotes`, each annotated
   * with the current actor's capabilities over it (Phase 1B4-E). This is the read
   * the notes UI uses, so that "may I edit this note's body" is answered by the
   * provider, not reconstructed in React from id shapes.
   */
  getUserNotesView(
    ctx: CrmContext,
    input: GetUserNotesInput,
  ): Promise<Result<Paginated<CrmNoteListItem>>>;
  getSegments(ctx: CrmContext, input: { kind?: "system" | "saved" }): Promise<Result<Segment[]>>;
  getMentorQueue(ctx: CrmContext, input: GetQueueInput): Promise<Result<Paginated<QueueItem>>>;
  getSupportQueue(ctx: CrmContext, input: GetQueueInput): Promise<Result<Paginated<QueueItem>>>;
  getFinancialOperationsSummary(ctx: CrmContext, input: GetFinOpsInput): Promise<Result<FinancialOperationsSummary>>;
  getUserSignals(ctx: CrmContext, input: { userId: UserId; includeExpired?: boolean }): Promise<Result<UserSignal[]>>;
  getRecommendedActions(ctx: CrmContext, input: GetRecommendedInput): Promise<Result<RecommendedAction[]>>;
  /**
   * Employees who may be assigned as a primary owner (Phase 1B4-C).
   *
   * Permission: Assign — `canAssignOwner(ctx.role)`. Roles that cannot assign get
   * `unauthorized` rather than an empty list: an empty list says "there is nobody
   * to pick", which is a different and untrue statement. Their UI never calls it
   * anyway — the control is not rendered at all (D-59).
   *
   * A read, not a mutation, so it lives here rather than in `CrmMutations`. It is
   * separate from `getUser360` because it is not about a user: the same list
   * serves every user, and folding it into the aggregate would refetch the whole
   * profile to populate a dropdown. The user's CURRENT owner remains part of
   * `getUser360` (D-35) — this operation only supplies what may be chosen.
   */
  getPrimaryOwnerCandidates(ctx: CrmContext): Promise<Result<PrimaryOwnerCandidate[]>>;
  /**
   * The global Audit Workspace read (Phase 1B5-B). Returns the browser-local
   * mutation-overlay audit records, already projected to the safe `AuditRecordView`
   * and ordered newest-first, for a role that may see them.
   *
   * Permission: the SINGLE global gate is `canViewAudit(ctx.role)` — only
   * `crm_admin` and `crm_manager`. Every other role gets `unauthorized`, checked
   * BEFORE the overlay is read, so a role that may not view the log neither reads
   * nor receives any record. This is a read, not a mutation, so it lives here; it
   * never writes and it never touches the append-only log's write semantics.
   */
  getAuditRecords(
    ctx: CrmContext,
    input: GetAuditRecordsInput,
  ): Promise<Result<Paginated<AuditRecordView>>>;
}
