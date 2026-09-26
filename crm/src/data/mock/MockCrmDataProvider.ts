/**
 * MockCrmDataProvider — full deterministic read-model over the synthetic dataset.
 * Implements every read operation of the CrmDataProvider contract with
 * pagination, filtering, sorting, permission-aware projection, stale metadata,
 * controllable delay/error/empty modes. UI never imports fixtures directly.
 */
import type { EmployeeId, UserId, Freshness } from "@/domain/shared/primitives";
import type { UserSummary } from "@/domain/users/user";
import type { User360 } from "@/domain/users/user-360";
import { projectUser360 } from "@/domain/users/user-360-projection";
import {
  buildProjectedUserTimeline,
  filterTimelineByRange,
  parseTimelineRange,
  type TimelineRangeError,
} from "@/domain/users/user-timeline";
import type { Paginated, Result } from "@/data/contracts/result";
import { empty, fail, ok, stale } from "@/data/contracts/result";
import type { CrmRole } from "@/domain/identity/roles";
import type {
  AuditRecordView,
  CrmContext,
  CrmDataProvider,
  CrmNote,
  CrmNoteListItem,
  FinancialOperationsSummary,
  GetAuditRecordsInput,
  GetFinOpsInput,
  GetQueueInput,
  GetRecommendedInput,
  GetTimelineInput,
  GetTodayInput,
  GetUserCasesInput,
  GetUserNotesInput,
  GetUserTasksInput,
  PrimaryOwnerCandidate,
  QueueItem,
  RecommendedAction,
  SearchUsersInput,
  Segment,
  TodayWorkspace,
  UserFilters,
  UserSortField,
  UserTimelineEvent,
} from "@/data/contracts/CrmDataProvider";
import type {
  AddNoteCommand,
  AddNoteResult,
  AssignPrimaryOwnerCommand,
  AssignPrimaryOwnerResult,
  CrmMutations,
  DeleteNoteCommand,
  DeleteNoteResult,
  SetNotePinnedCommand,
  SetNotePinnedResult,
  SetNoteVisibilityCommand,
  SetNoteVisibilityResult,
  UpdateNoteBodyCommand,
  UpdateNoteBodyResult,
} from "@/data/contracts/CrmMutations";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "@/data/contracts/CrmMutations";
import type {
  AuditRecord,
  NoteBodyChangedAuditRecord,
  NoteDeletedAuditRecord,
  NotePinChangedAuditRecord,
  NoteVisibilityChangedAuditRecord,
  PrimaryOwnerChangedAuditRecord,
} from "@/domain/audit/audit";
import { mockAuditId } from "@/domain/audit/audit";
import { projectAuditRecords } from "@/domain/audit/audit-view";
import { isPrimaryOwnerCandidate, PRIMARY_OWNER_CANDIDATES } from "@/domain/identity/employees";
import type { NoteBodyError } from "@/domain/notes/note";
import { mockNoteId, normalizeNoteBody, NOTE_BODY_MAX_LENGTH } from "@/domain/notes/note";
import {
  hideDeletedNotes,
  projectNotes,
  resolveEffectivePins,
  sortNotes,
} from "@/domain/notes/note-projection";
import type { MutationOverlay } from "./overlay/mutation-overlay";
import {
  MUTATION_OVERLAY_VERSION,
  MutationOverlayStore,
  NOTE_BODY_RECEIPT_KIND,
  NOTE_DELETE_RECEIPT_KIND,
  NOTE_PIN_RECEIPT_KIND,
  NOTE_VISIBILITY_RECEIPT_KIND,
  PRIMARY_OWNER_RECEIPT_KIND,
} from "./overlay/mutation-overlay";
import type { KeyValueStorage } from "./overlay/storage";
import {
  fingerprintAddNote,
  fingerprintAssignPrimaryOwner,
  fingerprintDeleteNote,
  fingerprintSetNotePinned,
  fingerprintSetNoteVisibility,
  fingerprintUpdateNoteBody,
} from "./overlay/fingerprint";
import type { CrmTask, PriorityLevel } from "@/domain/tasks/task";
import type { CrmCase } from "@/domain/cases/case";
import type { UserSignal } from "@/domain/signals/signal";
import { FixedMockClock, hoursSince, type Clock } from "@/lib/clock";
import type { MockUser } from "@/domain/users/mock-user";
import { defaultDataset } from "./fixtures/index";
import { computeSignals, type ComputedSignal } from "@/domain/signals/engine";
import { computePriority, comparePriority, type PriorityBand } from "@/domain/priority/priority";
import { deriveRecommendations } from "@/domain/recommendations/derive";
import { projectFinancial } from "@/domain/financial/projection";
import { projectIdentity } from "@/domain/identity/identity-projection";
import { toFinancialBucket } from "@/domain/financial/financial";
import { canAssignOwner, canEditUserNotes, canViewAudit, canViewExactFinancials } from "@/domain/identity/access";
import { ownerLabel, UNKNOWN_USER_LABEL } from "@/config/labels";
import { computeSegments } from "@/domain/segments/segments";
import { buildTodayWorkspace } from "@/domain/today/builder";

export interface MockProviderOptions {
  clock?: Clock;
  delayMs?: number;
  errorMode?: boolean;
  emptyMode?: boolean;
  staleMode?: boolean;
  /**
   * Where the mutation overlay is persisted. Defaults to localStorage in a
   * browser and to memory elsewhere; tests inject a MemoryKeyValueStorage, which
   * is also how they seed a controlled initial overlay.
   */
  storage?: KeyValueStorage;
}

interface Derived {
  user: MockUser;
  signals: ComputedSignal[];
  priority: ReturnType<typeof computePriority>;
}

const PAGE_DEFAULT = 50;

/** Audit Workspace page size (Phase 1B5-B, contract §6): newest 20 per page. */
const PAGE_AUDIT = 20;

/** Why a timeline range was rejected. Diagnostic text — never shown raw to users. */
const TIMELINE_RANGE_MESSAGE: Record<TimelineRangeError, string> = {
  invalid_from: "Timeline range: `from` is not a valid ISO-8601 instant.",
  invalid_to: "Timeline range: `to` is not a valid ISO-8601 instant.",
  inverted_range: "Timeline range: `from` must not be later than `to`.",
};

/** Why a note body was rejected. Diagnostic text — never carries the body itself. */
const NOTE_BODY_MESSAGE: Record<NoteBodyError, string> = {
  empty: "Note body is empty.",
  too_long: `Note body exceeds ${NOTE_BODY_MAX_LENGTH} characters.`,
};

const bandToLevel: Record<PriorityBand, PriorityLevel> = {
  critical: "critical",
  high: "high",
  normal: "medium",
  low: "low",
};

export class MockCrmDataProvider implements CrmDataProvider, CrmMutations {
  private readonly clock: Clock;
  private readonly delayMs: number;
  private readonly errorMode: boolean;
  private readonly emptyMode: boolean;
  private readonly staleMode: boolean;
  private readonly users: MockUser[];
  private readonly derivedCache = new Map<string, Derived>();
  /**
   * One overlay adapter per provider, built once here rather than per method
   * call. `getCrmDataProvider` caches the provider per demo state, so a browser
   * session reads and writes through a single instance.
   */
  private readonly overlay: MutationOverlayStore;

  constructor(options: MockProviderOptions = {}) {
    this.clock = options.clock ?? new FixedMockClock();
    this.delayMs = options.delayMs ?? 0;
    this.errorMode = options.errorMode ?? false;
    this.emptyMode = options.emptyMode ?? false;
    this.staleMode = options.staleMode ?? false;
    this.users = defaultDataset(this.clock);
    this.overlay = new MutationOverlayStore(options.storage);
  }

  /* ------------------------------------------------------------- helpers */

  private async gate<T>(produce: () => Result<T>): Promise<Result<T>> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.errorMode) {
      return fail<T>({ code: "upstream_unavailable", message: "Mock error mode.", retriable: true });
    }
    return produce();
  }

  /* ------------------------------------------------- effective owner */

  /**
   * Owner overrides read from the overlay: the LATEST `primary_owner_changed`
   * audit record per user. There is no separate owner store — the append-only
   * audit log is the history D-08 requires be kept, and reading the current value
   * off it means the value and its history cannot disagree.
   *
   * Latest = last matching record in array order. Records are only ever appended,
   * and the store writes them in sequence order, so array order IS write order.
   * `at` (clock.nowMs() + sequence) agrees with it; array order is used because it
   * keeps holding once the zero-padded sequence in an id outgrows four digits and
   * lexicographic id order stops matching numeric order.
   */
  private ownerOverrides(): Map<UserId, EmployeeId | null> {
    const out = new Map<UserId, EmployeeId | null>();
    for (const record of this.overlay.read().auditRecords) {
      if (record.action !== "primary_owner_changed") continue;
      out.set(record.targetUserId, record.nextOwnerId);
    }
    return out;
  }

  /**
   * A user with the effective owner applied. The baseline fixture is NEVER
   * mutated — `defaultDataset` memoizes one array per clock and hands the same
   * `MockUser` objects to every provider instance, so assigning through one demo
   * state would surface in all of them and the "fixtures are byte-identical after
   * a mutation" invariant would be gone. A shallow clone costs nothing at 30 users
   * and keeps the fixture the fixed point it is supposed to be.
   */
  private withEffectiveOwner(u: MockUser, overrides: Map<UserId, EmployeeId | null>): MockUser {
    if (!overrides.has(u.identity.userId)) return u;
    const ownerId = overrides.get(u.identity.userId) ?? null;
    if (ownerId === u.operations.primaryOwnerId) return u;
    return { ...u, operations: { ...u.operations, primaryOwnerId: ownerId } };
  }

  /**
   * The dataset every read sees. This is the ONE place owner resolution happens:
   * ten call sites used to read `operations.primaryOwnerId` straight off the
   * fixture, and resolving in each of them is how User 360 and Users end up
   * reporting different owners — the drift D-39/D-40 had to undo for financials
   * and timeline.
   */
  private effectiveUsers(): MockUser[] {
    const overrides = this.ownerOverrides();
    if (overrides.size === 0) return this.users;
    return this.users.map((u) => this.withEffectiveOwner(u, overrides));
  }

  /** Single-user counterpart of `effectiveUsers`. */
  private effectiveUser(userId: UserId): MockUser | undefined {
    const u = this.users.find((x) => x.identity.userId === userId);
    if (!u) return undefined;
    return this.withEffectiveOwner(u, this.ownerOverrides());
  }

  /**
   * Signals and priority do not depend on the owner, so a reassignment cannot
   * change them — but `Derived.user` is handed to the callers that read the owner
   * off it, so a cache hit must not serve a user carrying a stale one.
   *
   * The guard compares the cached owner with the one asked for rather than
   * tracking invalidation: that is correct even when the overlay was written by a
   * different provider instance over the same storage, because the caller already
   * resolved the owner from storage before calling in.
   */
  private derive(user: MockUser): Derived {
    const cached = this.derivedCache.get(user.identity.userId);
    if (cached && cached.user.operations.primaryOwnerId === user.operations.primaryOwnerId) {
      return cached;
    }
    const signals = computeSignals(user, this.clock);
    const priority = computePriority(user, signals, this.clock);
    const d = { user, signals, priority };
    this.derivedCache.set(user.identity.userId, d);
    return d;
  }

  private freshness(user: MockUser): Freshness {
    const ts = user.financial.balanceTimestamp;
    const ageH = hoursSince(this.clock, ts);
    const isStale = this.staleMode || user.state.fundingStatus === "balance_unknown" || (ageH !== null && ageH >= 1);
    return { asOf: ts ?? this.clock.nowIso(), isStale };
  }

  private toSummary(d: Derived, role: CrmRole): UserSummary {
    const u = d.user;
    const stl = this.freshness(u).isStale;
    const identity = projectIdentity({
      role,
      userId: u.identity.userId,
      displayName: u.identity.displayName,
      maskedEmail: u.identity.maskedEmail,
      fullEmail: u.identity.fullEmail,
      context: "list", // list is ALWAYS masked (never full email)
    });
    return {
      id: u.identity.userId,
      displayName: u.identity.displayName,
      maskedEmail: u.identity.maskedEmail,
      identity,
      lifecycleStage: u.state.lifecycleStage,
      fundingStatus: u.state.fundingStatus,
      engagementStatus: u.state.engagementStatus,
      registrationStatus: u.financial.registrationStatus,
      emailConfirmed: u.identity.emailConfirmed,
      currentLevel: u.progression.currentLevel,
      lastMeaningfulActionAt: u.progression.lastMeaningfulActionAt,
      valueSegments: u.state.valueSegments,
      blockers: u.state.blockers,
      ownerId: u.operations.primaryOwnerId,
      priority: d.priority.level,
      priorityReasonCode: d.priority.reasonCode,
      balance: projectFinancial({ role, amountUsd: u.financial.balanceUsd, isStale: stl }),
      netDeposits: projectFinancial({ role, amountUsd: u.financial.netDepositsUsd, isStale: stl }),
      redepositCount: u.financial.redeposits.length,
      xp: u.progression.xp,
      checkpointStatus: u.progression.checkpointStatus,
      topRecommendationCode: deriveRecommendations(u, d.signals)[0]?.code ?? null,
      registeredAt: u.identity.registeredAt,
      country: u.identity.country,
      locale: u.identity.locale,
      acquisitionSource: u.identity.acquisitionSource,
      campaign: u.identity.campaign,
      activeTaskCount: u.operations.activeTaskCount,
      activeCaseCount: u.operations.activeCaseCount,
      signalCodes: d.signals.map((s) => s.code),
    };
  }

  private matches(d: Derived, f: UserFilters | undefined): boolean {
    if (!f) return true;
    const u = d.user;
    const inArr = <T>(arr: T[] | undefined, v: T) => !arr || arr.length === 0 || arr.includes(v);
    const anyOf = <T>(arr: T[] | undefined, vals: T[]) => !arr || arr.length === 0 || vals.some((v) => arr.includes(v));

    if (!inArr(f.lifecycleStage, u.state.lifecycleStage)) return false;
    if (!inArr(f.fundingStatus, u.state.fundingStatus)) return false;
    if (!inArr(f.engagementStatus, u.state.engagementStatus)) return false;
    if (!inArr(f.registrationStatus, u.financial.registrationStatus)) return false;
    if (!inArr(f.priority, d.priority.level)) return false;
    if (!anyOf(f.valueSegment, u.state.valueSegments)) return false;
    if (!anyOf(f.blocker, u.state.blockers)) return false;
    if (f.signals && f.signals.length > 0 && !f.signals.some((c) => d.signals.some((s) => s.code === c))) return false;

    if (f.ownerId) {
      if (f.ownerId === "unassigned") {
        if (u.operations.primaryOwnerId !== null) return false;
      } else if (u.operations.primaryOwnerId === null || !f.ownerId.includes(u.operations.primaryOwnerId)) {
        return false;
      }
    }
    if (f.currentLevelMin != null && u.progression.currentLevel < f.currentLevelMin) return false;
    if (f.currentLevelMax != null && u.progression.currentLevel > f.currentLevelMax) return false;
    if (f.xpMin != null && u.progression.xp < f.xpMin) return false;
    if (f.xpMax != null && u.progression.xp > f.xpMax) return false;

    if (f.balanceBucket && f.balanceBucket.length > 0) {
      if (u.financial.balanceUsd === null) return false;
      if (!f.balanceBucket.includes(toFinancialBucket(Math.round(u.financial.balanceUsd * 100)))) return false;
    }
    if (f.netDepositBucket && f.netDepositBucket.length > 0) {
      if (!f.netDepositBucket.includes(toFinancialBucket(Math.round(u.financial.netDepositsUsd * 100)))) return false;
    }
    if (f.lastActionFrom && (!u.progression.lastMeaningfulActionAt || u.progression.lastMeaningfulActionAt < f.lastActionFrom)) return false;
    if (f.lastActionTo && (!u.progression.lastMeaningfulActionAt || u.progression.lastMeaningfulActionAt > f.lastActionTo)) return false;
    if (f.registeredFrom && u.identity.registeredAt < f.registeredFrom) return false;
    if (f.registeredTo && u.identity.registeredAt > f.registeredTo) return false;
    if (!inArr(f.acquisitionSource, u.identity.acquisitionSource)) return false;
    if (!inArr(f.country, u.identity.country)) return false;
    if (f.hasOpenTask === true && u.operations.activeTaskCount === 0) return false;
    if (f.hasOpenTask === false && u.operations.activeTaskCount > 0) return false;
    if (f.hasOpenCase === true && u.operations.activeCaseCount === 0) return false;
    if (f.hasOpenCase === false && u.operations.activeCaseCount > 0) return false;

    if (f.slaState && f.slaState.length > 0) {
      const st = this.slaState(u);
      if (!f.slaState.includes(st)) return false;
    }
    if (f.query && f.query.trim() !== "") {
      const q = f.query.trim().toLowerCase();
      const hay = `${u.identity.displayName} ${u.identity.userId} ${u.identity.maskedEmail}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  private slaState(u: MockUser): "on_track" | "warning" | "breached" | "none" {
    if (!u.operations.sla) return "none";
    const started = new Date(u.operations.sla.startedAt).getTime();
    const due = new Date(u.operations.sla.dueAt).getTime();
    const now = this.clock.nowMs();
    if (now >= due) return "breached";
    if ((now - started) / (due - started) >= 0.8) return "warning";
    return "on_track";
  }

  private paginate<T>(items: T[], cursor?: string | null, pageSize = PAGE_DEFAULT): Paginated<T> {
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const slice = items.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize;
    return {
      items: slice,
      page: {
        cursor: cursor ?? null,
        nextCursor: nextOffset < items.length ? String(nextOffset) : null,
        total: items.length,
        pageSize,
      },
    };
  }

  /* --------------------------------------------------------------- ops */

  /**
   * Read-only Today workspace (Phase 1B3). Queue membership, grouping, ordering
   * and every permission decision happen in the builder, inside this provider —
   * the result is already safe for `ctx.role`, so React neither re-derives the
   * queue nor re-decides visibility. Read-only: no mutating counterpart exists.
   */
  getTodayWorkspace(ctx: CrmContext, input: GetTodayInput): Promise<Result<TodayWorkspace>> {
    return this.gate(() => {
      if (this.emptyMode) {
        return empty(
          buildTodayWorkspace({ users: [], clock: this.clock, role: ctx.role, query: input }),
        );
      }
      const workspace = buildTodayWorkspace({
        users: this.effectiveUsers(),
        clock: this.clock,
        role: ctx.role,
        query: input,
        staleMode: this.staleMode,
      });
      const freshness: Freshness = { asOf: workspace.freshness.asOf, isStale: workspace.freshness.isStale };
      if (this.staleMode) return stale(workspace, freshness);
      // An empty queue is a legitimate answer ("nothing needs you today"), not
      // an error — the UI distinguishes it from a filtered-out result itself.
      return ok(workspace, freshness);
    });
  }

  searchUsers(ctx: CrmContext, input: SearchUsersInput): Promise<Result<Paginated<UserSummary>>> {
    return this.gate(() => {
      if (this.emptyMode) return empty(this.paginate<UserSummary>([]));

      const sortField = input.sort?.field;
      if ((sortField === "balance" || sortField === "netDeposits") && !canViewExactFinancials(ctx.role)) {
        // Sorting by exact financial value would leak ordering to unprivileged
        // roles, so we reject rather than silently reorder (documented decision).
        return fail<Paginated<UserSummary>>({
          code: "invalid_input",
          message: "Sorting by exact financial value requires financial permission.",
          retriable: false,
        });
      }

      const filters: UserFilters = { ...input.filters, query: input.filters?.query ?? input.query };
      let rows = this.effectiveUsers().map((u) => this.derive(u)).filter((d) => this.matches(d, filters));
      rows = this.sortRows(rows, input.sort);
      const summaries = rows.map((d) => this.toSummary(d, ctx.role));
      const page = this.paginate(summaries, input.page?.cursor, input.page?.pageSize);
      if (page.items.length === 0) return empty(page);
      if (this.staleMode) return stale(page, { asOf: this.clock.nowIso(), isStale: true });
      return ok(page, { asOf: this.clock.nowIso(), isStale: false });
    });
  }

  private sortRows(rows: Derived[], sort?: { field: UserSortField; dir: "asc" | "desc" }): Derived[] {
    if (!sort) {
      return [...rows].sort((a, b) => comparePriority(a, b, this.clock));
    }
    const dir = sort.dir === "desc" ? -1 : 1;
    const val = (d: Derived): number | string => {
      const u = d.user;
      switch (sort.field) {
        case "name":
          return u.identity.displayName;
        case "owner":
          return u.operations.primaryOwnerId ?? "￿"; // unassigned sorts last
        case "registeredAt":
          return u.identity.registeredAt;
        case "lastMeaningfulActionAt":
          return u.progression.lastMeaningfulActionAt ?? "";
        case "currentLevel":
          return u.progression.currentLevel;
        case "xp":
          return u.progression.xp;
        case "balance":
          return u.financial.balanceUsd ?? -1;
        case "netDeposits":
          return u.financial.netDepositsUsd;
        case "redepositCount":
          return u.financial.redeposits.length;
        case "dueAt":
          return u.operations.sla?.dueAt ?? "￿";
        case "priority":
        default:
          return d.priority.ruleIndex;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.user.identity.userId.localeCompare(b.user.identity.userId);
    });
  }

  getUserById(ctx: CrmContext, input: { userId: UserId }): Promise<Result<UserSummary>> {
    return this.gate(() => {
      const u = this.effectiveUser(input.userId);
      if (!u) return fail<UserSummary>({ code: "not_found", message: `No user ${input.userId}.`, retriable: false });
      const summary = this.toSummary(this.derive(u), ctx.role);
      const fr = this.freshness(u);
      return fr.isStale ? stale(summary, fr) : ok(summary, fr);
    });
  }

  /**
   * Read-only User 360 aggregate. All permission projection happens here (via
   * projectUser360) — an exact amount or full email is never produced for a role
   * that may not see it, so it cannot reach the client at all.
   */
  getUser360(ctx: CrmContext, input: { userId: UserId }): Promise<Result<User360>> {
    return this.gate(() => {
      const u = this.effectiveUser(input.userId);
      if (!u) {
        return fail<User360>({
          code: "not_found",
          message: `No user ${input.userId}.`,
          retriable: false,
        });
      }
      const d = this.derive(u);
      const fr = this.freshness(u);
      const view = projectUser360({
        user: u,
        signals: d.signals,
        priority: d.priority,
        recommendations: deriveRecommendations(u, d.signals),
        role: ctx.role,
        clock: this.clock,
        freshness: fr,
        slaState: this.slaState(u),
      });
      return fr.isStale ? stale(view, fr) : ok(view, fr);
    });
  }

  /**
   * Permission-aware timeline. Projection happens HERE, via the same canonical
   * projector `getUser360` uses, so an event a role may not see is never built
   * into the result at all (Phase 1C.1, D-39).
   *
   * Pipeline order matters: project → sources → range → paginate. The window
   * narrows an already-projected list, so `page.total` counts only events this
   * role may see (Phase 1B3, D-41).
   */
  getUserTimeline(ctx: CrmContext, input: GetTimelineInput): Promise<Result<Paginated<UserTimelineEvent>>> {
    return this.gate(() => {
      // Validated before the user lookup: a malformed range is the caller's bug
      // either way, and answering it identically for known and unknown ids keeps
      // the error from revealing whether a user exists.
      const parsed = parseTimelineRange(input.from, input.to);
      if (!parsed.ok) {
        return fail<Paginated<UserTimelineEvent>>({
          code: "invalid_input",
          message: TIMELINE_RANGE_MESSAGE[parsed.reason],
          retriable: false,
          details: { from: input.from ?? null, to: input.to ?? null },
        });
      }

      const u = this.users.find((x) => x.identity.userId === input.userId);
      // Unknown user keeps its previous contract: an empty page, not an error.
      if (!u) return empty(this.paginate<UserTimelineEvent>([]));

      const projected = buildProjectedUserTimeline(u, ctx.role).filter(
        (e) => !input.sources || input.sources.includes(e.source),
      );
      const events: UserTimelineEvent[] = filterTimelineByRange(projected, parsed.range);
      const page = this.paginate(events, input.page?.cursor, input.page?.pageSize);
      // A window that matches nothing is empty, not an error — same convention
      // as every other read on this provider.
      return events.length === 0 ? empty(page) : ok(page);
    });
  }

  getUserTasks(_ctx: CrmContext, input: GetUserTasksInput): Promise<Result<Paginated<CrmTask>>> {
    return this.gate(() => {
      const u = this.effectiveUser(input.userId);
      if (!u) return empty(this.paginate<CrmTask>([]));
      // Synthetic tasks derive their owner from the user's primary owner, so they
      // follow a reassignment. Task assignees as an independent field are D-08's
      // other half and are not modelled here.
      const tasks: CrmTask[] = Array.from({ length: u.operations.activeTaskCount }).map((_, i) => ({
        id: `${u.identity.userId}_task_${i + 1}`,
        title: `Follow-up: ${u.state.reasonCode}`,
        type: "retention_follow_up",
        userId: u.identity.userId,
        caseId: null,
        owner: u.operations.primaryOwnerId,
        createdBy: "automation",
        source: "signal",
        reasonCode: u.state.reasonCode,
        priority: this.derive(u).priority.level === "critical" ? "critical" : "high",
        status: "open",
        dueAt: u.operations.sla?.dueAt ?? u.operations.nextFollowUpAt ?? null,
        completedAt: null,
        outcome: null,
        followUpAt: null,
        createdAt: this.clock.nowIso(),
        updatedAt: this.clock.nowIso(),
      }));
      return tasks.length === 0 ? empty(this.paginate(tasks)) : ok(this.paginate(tasks, input.page?.cursor));
    });
  }

  getUserCases(_ctx: CrmContext, input: GetUserCasesInput): Promise<Result<Paginated<CrmCase>>> {
    return this.gate(() => {
      // Synthetic cases carry the primary owner for the same reason tasks do.
      const u = this.effectiveUser(input.userId);
      if (!u) return empty(this.paginate<CrmCase>([]));
      const type = u.operations.supportState === "blocked" ? "support" : u.financial.pocketConflict ? "financial_data_conflict" : "retention";
      const cases: CrmCase[] = Array.from({ length: u.operations.activeCaseCount }).map((_, i) => ({
        id: `${u.identity.userId}_case_${i + 1}`,
        userId: u.identity.userId,
        type,
        status: "open",
        priority: this.derive(u).priority.level === "critical" ? "critical" : "high",
        owner: u.operations.primaryOwnerId,
        sla: u.operations.sla ? { dueAt: u.operations.sla.dueAt, breached: this.slaState(u) === "breached" } : null,
        reason: u.state.reasonCode,
        taskIds: [],
        noteIds: [],
        outcome: null,
        closingReason: null,
        openedAt: this.clock.nowIso(),
        closedAt: null,
      }));
      return cases.length === 0 ? empty(this.paginate(cases)) : ok(this.paginate(cases, input.page?.cursor));
    });
  }

  /**
   * Synthetic notes derived from a fixture. Rebuilt on every read from immutable
   * fixture data — the fixture itself is never touched, and authored notes live in
   * the overlay, so a mutation can never rewrite generated content.
   *
   * The body interpolated `state.reasonCode` until Phase 1B4-B gave notes a
   * reader. That put a raw enum code (`support_blocked`) into user-facing text,
   * which config/labels exists to prevent — and unlike every other code on this
   * screen, `state.reasonCode` has no label map to resolve it through (only
   * `priority.reasonCode` does, via PRIORITY_REASON_LABEL). Seeding a human
   * sentence is the fix: a data-layer note cannot resolve labels anyway, since
   * Russian copy lives in config and config depends on domain, not the reverse.
   *
   * The seeded note is dated two days back rather than "now". At `clock.nowIso()`
   * it rendered as «только что» on every load — a note that claims it was just
   * written, every time, and that a note the employee actually just wrote could
   * not be told apart from. Two days is still fully deterministic (it is derived
   * from the fixed mock clock) and it makes the ordering visible: authored notes
   * are stamped `nowMs + sequence` and land above this one.
   */
  private fixtureNotes(u: MockUser): CrmNote[] {
    const at = new Date(this.clock.nowMs() - 2 * 24 * 60 * 60 * 1000).toISOString();
    // The author is the BASELINE fixture owner, looked up from the untouched
    // dataset rather than read off `u` (Phase 1B4-C). Authorship is a historical
    // fact: the employee who wrote a note two days ago wrote it, and reassigning
    // the user today must not rewrite who wrote it. Reading `u` would do exactly
    // that as soon as `u` carries an effective owner, which every list read now
    // hands around — so the lookup is structural, not a convention to remember.
    const baselineOwnerId =
      this.users.find((x) => x.identity.userId === u.identity.userId)?.operations.primaryOwnerId ?? null;
    return [
      {
        id: `${u.identity.userId}_note_1`,
        userId: u.identity.userId,
        caseId: null,
        authorEmployeeId: baselineOwnerId ?? "emp_mock_admin",
        body: "Синтетическая заметка: демонстрационная запись о работе с пользователем.",
        visibility: "team",
        pinned: false,
        createdAt: at,
        updatedAt: at,
        mock: true,
      },
    ];
  }

  /**
   * The one canonical way to build a user's visible, pinned-resolved, ordered notes
   * for `ctx`. Both `getUserNotes` and `getUserNotesView` go through here, so the
   * bare read and the capability-annotated read cannot disagree about which notes
   * exist or in what order.
   *
   * `ctx` is applied through the canonical projector (`domain/notes/note-projection`)
   * rather than here, and projection runs BEFORE ordering so a note the role may not
   * see is dropped entirely. A note removed by a valid `note_deleted` record is
   * dropped FIRST (D-97), so a hard-deleted note — or a legacy/corrupt overlay that
   * still carries the row — never reaches pinning, projection or `page.total`.
   * Effective pinned state is resolved from the audit log (D-76) BEFORE projection and
   * ordering, so the pinned-first sort sees the current pin, not the `false` baseline.
   */
  private orderedVisibleNotes(ctx: CrmContext, u: MockUser, overlay: MutationOverlay): CrmNote[] {
    const authored = overlay.notes.filter((n) => n.userId === u.identity.userId);
    const alive = hideDeletedNotes([...this.fixtureNotes(u), ...authored], overlay.auditRecords);
    const withPins = resolveEffectivePins(alive, overlay.auditRecords);
    const visible = projectNotes(withPins, { actorId: ctx.actorId, role: ctx.role });
    return sortNotes(visible);
  }

  /**
   * Notes for a user: fixture-generated + overlay, projected for `ctx`.
   *
   * Projection runs BEFORE pagination so a note the role may not see is absent from
   * `page.total` as well as from `items` — a hidden note must not be countable, only
   * invisible. Every role may open User 360 (matrix §2), so there is no role-level
   * refusal: visibility is decided per note.
   */
  getUserNotes(ctx: CrmContext, input: GetUserNotesInput): Promise<Result<Paginated<CrmNote>>> {
    return this.gate(() => {
      const u = this.users.find((x) => x.identity.userId === input.userId);
      if (!u) return empty(this.paginate<CrmNote>([]));

      const overlay = this.overlay.read();
      const ordered = this.orderedVisibleNotes(ctx, u, overlay);

      return ordered.length === 0
        ? empty(this.paginate<CrmNote>([]))
        : ok(this.paginate(ordered, input.page?.cursor));
    });
  }

  /**
   * The same visible/ordered notes as `getUserNotes`, each wrapped with the current
   * actor's capabilities (Phase 1B4-E). `canEditBody` is decided HERE, from facts the
   * UI must not compute for itself: role permission, physical overlay membership (so
   * never the generated fixture note), visibility, and authorship. React reads the
   * flag; it never inspects a note id.
   */
  getUserNotesView(
    ctx: CrmContext,
    input: GetUserNotesInput,
  ): Promise<Result<Paginated<CrmNoteListItem>>> {
    return this.gate(() => {
      const u = this.users.find((x) => x.identity.userId === input.userId);
      if (!u) return empty(this.paginate<CrmNoteListItem>([]));

      const overlay = this.overlay.read();
      const ordered = this.orderedVisibleNotes(ctx, u, overlay);

      // Ids physically stored in the overlay for THIS user. The fixture note is
      // generated at read time and is never in this set, so it is never editable.
      const overlayNoteIds = new Set(
        overlay.notes.filter((n) => n.userId === input.userId).map((n) => n.id),
      );
      const roleMayEdit = canEditUserNotes(ctx.role);

      const items: CrmNoteListItem[] = ordered.map((note) => {
        // Body edit, visibility change AND delete share the SAME conditions: role,
        // overlay membership (never the fixture note), visibility, and authorship.
        // A note that reached this list already survived the canonical projection, so
        // it is not hidden by a `note_deleted` record — the delete-specific condition
        // is therefore already satisfied here. They are three fields so the UI never
        // assumes they coincide.
        const canAct =
          roleMayEdit && overlayNoteIds.has(note.id) && note.authorEmployeeId === ctx.actorId;
        return {
          note,
          capabilities: { canEditBody: canAct, canChangeVisibility: canAct, canDelete: canAct },
        };
      });

      return items.length === 0
        ? empty(this.paginate<CrmNoteListItem>([]))
        : ok(this.paginate(items, input.page?.cursor));
    });
  }

  getSegments(_ctx: CrmContext, _input: { kind?: "system" | "saved" }): Promise<Result<Segment[]>> {
    return this.gate(() => {
      if (this.emptyMode) return empty<Segment[]>([]);
      const segs = computeSegments(this.users, this.clock).map<Segment>((s) => ({
        id: s.code,
        name: s.title,
        kind: "system",
        description: s.description,
        count: s.userCount,
      }));
      return ok(segs);
    });
  }

  getMentorQueue(ctx: CrmContext, input: GetQueueInput): Promise<Result<Paginated<QueueItem>>> {
    return this.gate(() => this.queue(ctx, input, (u) => u.operations.mentorState !== "none"));
  }

  getSupportQueue(ctx: CrmContext, input: GetQueueInput): Promise<Result<Paginated<QueueItem>>> {
    return this.gate(() => this.queue(ctx, input, (u) => u.operations.supportState === "open" || u.operations.supportState === "blocked"));
  }

  private queue(_ctx: CrmContext, input: GetQueueInput, pred: (u: MockUser) => boolean): Result<Paginated<QueueItem>> {
    if (this.emptyMode) return empty(this.paginate<QueueItem>([]));
    const rows = this.effectiveUsers()
      .filter(pred)
      .map((u) => this.derive(u))
      .sort((a, b) => comparePriority(a, b, this.clock));
    const items: QueueItem[] = rows.map((d) => ({
      userId: d.user.identity.userId,
      title: d.user.state.reasonCode,
      slaDueAt: d.user.operations.sla?.dueAt ?? null,
      slaBreached: this.slaState(d.user) === "breached",
      priority: bandToLevel[d.priority.level],
      status: d.user.operations.mentorState !== "none" ? d.user.operations.mentorState : d.user.operations.supportState,
      owner: d.user.operations.primaryOwnerId,
    }));
    return items.length === 0 ? empty(this.paginate(items)) : ok(this.paginate(items, input.page?.cursor));
  }

  getFinancialOperationsSummary(_ctx: CrmContext, _input: GetFinOpsInput): Promise<Result<FinancialOperationsSummary>> {
    return this.gate(() => {
      const count = (p: (u: MockUser) => boolean) => this.users.filter(p).length;
      return ok<FinancialOperationsSummary>({
        generatedAt: this.clock.nowIso(),
        checkpointApproaching: count((u) => u.progression.checkpointStatus === "approaching"),
        checkpointGrace: count((u) => u.state.fundingStatus === "checkpoint_grace"),
        accessSuspended: count((u) => u.state.fundingStatus === "financial_access_suspended"),
        dataConflicts: count((u) => u.financial.pocketConflict),
      });
    });
  }

  getUserSignals(_ctx: CrmContext, input: { userId: UserId; includeExpired?: boolean }): Promise<Result<UserSignal[]>> {
    return this.gate(() => {
      const u = this.users.find((x) => x.identity.userId === input.userId);
      if (!u) return fail<UserSignal[]>({ code: "not_found", message: `No user ${input.userId}.`, retriable: false });
      const signals: UserSignal[] = this.derive(u).signals.map((s) => ({
        id: `${u.identity.userId}_${s.code}`,
        userId: u.identity.userId,
        code: s.code,
        severity: s.severity,
        status: "active",
        reasonCode: s.reasonCode,
        evidence: s.evidence,
        createdAt: s.calculatedAt,
        calculatedAt: s.calculatedAt,
        expiresAt: s.expiresAt,
      }));
      return ok(signals);
    });
  }

  getRecommendedActions(_ctx: CrmContext, input: GetRecommendedInput): Promise<Result<RecommendedAction[]>> {
    return this.gate(() => {
      const u = input.userId ? this.users.find((x) => x.identity.userId === input.userId) : undefined;
      if (input.userId && !u) return fail<RecommendedAction[]>({ code: "not_found", message: "No user.", retriable: false });
      const targets = u ? [u] : this.users;
      const out: RecommendedAction[] = [];
      for (const t of targets) {
        const d = this.derive(t);
        for (const rec of deriveRecommendations(t, d.signals)) {
          out.push({
            id: `${t.identity.userId}_${rec.code}`,
            userId: t.identity.userId,
            title: rec.title,
            rationale: rec.reason,
            priority: bandToLevel[rec.priority],
          });
        }
      }
      return ok(out.slice(0, input.limit ?? out.length));
    });
  }

  /**
   * Employees who may be assigned as a primary owner (Phase 1B4-C).
   *
   * Straight from the canonical directory — the mock does not compute, filter or
   * rank it. Refused for roles without Assign: an empty list would claim there is
   * nobody to pick, which is a different statement from "you may not pick".
   *
   * Only id and display name leave here. `errorMode` still applies through
   * `gate`, so the dev demo-state switch can exercise the failure surface.
   */
  getPrimaryOwnerCandidates(ctx: CrmContext): Promise<Result<PrimaryOwnerCandidate[]>> {
    return this.gate(() => {
      if (!canAssignOwner(ctx.role)) {
        return fail<PrimaryOwnerCandidate[]>({
          code: "unauthorized",
          message: "Role may not assign owners.",
          retriable: false,
        });
      }
      return ok(
        PRIMARY_OWNER_CANDIDATES.map<PrimaryOwnerCandidate>((e) => ({
          employeeId: e.employeeId,
          displayName: e.displayName,
        })),
      );
    });
  }

  /**
   * The global Audit Workspace read (Phase 1B5-B).
   *
   * Order is exactly the contract's (§1): permission → read → project → sort →
   * paginate. `canViewAudit` is checked FIRST and BEFORE the overlay is touched, so
   * a role that may not view the log neither reads storage nor receives a record —
   * `unauthorized` is returned without ever building a view. Only `crm_admin` and
   * `crm_manager` hold `view_audit` (matrix §1), so every other role stops here.
   *
   * The overlay read is fail-closed by existing design (docs/MUTATION_OVERLAY.md):
   * a corrupt overlay degrades to an EMPTY one, so this read shows an honest
   * empty-state rather than partial or reconstructed records. A genuine storage
   * failure is surfaced through `gate` (errorMode) as `upstream_unavailable`, which
   * the UI renders as a localized error with retry — no raw diagnostics leave here.
   *
   * Projection and ordering are the canonical `projectAuditRecords`: newest-first,
   * `id` descending as tie-break, on a COPY of the append-only log. Every raw id is
   * resolved to a caption before it can leave — actor and owner through the
   * canonical `ownerLabel` (unknown → «Неизвестный сотрудник», null owner → «Не
   * назначен»), the target user through the dataset's display name (absent →
   * «Неизвестный пользователь»). No employee/note/user id, no note body, no reason
   * code and no storage metadata is ever placed in the view.
   */
  getAuditRecords(
    ctx: CrmContext,
    input: GetAuditRecordsInput,
  ): Promise<Result<Paginated<AuditRecordView>>> {
    return this.gate(() => {
      // 1. Permission — before any storage read. A refused role gets no data.
      if (!canViewAudit(ctx.role)) {
        return fail<Paginated<AuditRecordView>>({
          code: "unauthorized",
          message: "Role may not view the global audit log.",
          retriable: false,
        });
      }

      // 2. Read the append-only overlay (fail-closed empty on corruption).
      const overlay = this.overlay.read();

      // 3–5. Project + sort through the canonical reader. Target names come from the
      // untouched dataset; actor/owner names from the canonical directory.
      const targetNames = new Map<UserId, string>(
        this.users.map((u) => [u.identity.userId, u.identity.displayName]),
      );
      const views = projectAuditRecords(overlay.auditRecords, {
        employeeName: (id) => ownerLabel(id),
        ownerName: (id) => ownerLabel(id),
        userName: (id) => targetNames.get(id) ?? UNKNOWN_USER_LABEL,
      });

      // 6. Paginate — page size 20, newest first (already ordered above).
      const page = this.paginate(views, input.page?.cursor, input.page?.pageSize ?? PAGE_AUDIT);
      return page.items.length === 0 ? empty(page) : ok(page);
    });
  }

  /* ---------------------------------------------------------- mutations */

  /**
   * Add a plain-text note (Phase 1B4-A — the only mutation that exists).
   *
   * Order is deliberate: validate → user exists → permission → idempotency →
   * write. Permission is read from `ctx` and never from the command, so a caller
   * cannot claim a role it does not hold. Error messages carry no note body.
   *
   * Nothing is persisted until the whole overlay is assembled, so a rejected call
   * — for any reason, including a storage failure — leaves the overlay exactly as
   * it was and writes no audit record.
   */
  addNote(ctx: CrmContext, command: AddNoteCommand): Promise<Result<AddNoteResult>> {
    return this.gate(() => {
      const key = typeof command.idempotencyKey === "string" ? command.idempotencyKey.trim() : "";
      if (key.length === 0) {
        return fail<AddNoteResult>({
          code: "invalid_input",
          message: "Idempotency key is required.",
          retriable: false,
        });
      }
      if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        return fail<AddNoteResult>({
          code: "invalid_input",
          message: `Idempotency key exceeds ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
          retriable: false,
        });
      }

      const normalized = normalizeNoteBody(command.body);
      if (!normalized.ok) {
        return fail<AddNoteResult>({
          code: "invalid_input",
          message: NOTE_BODY_MESSAGE[normalized.error],
          retriable: false,
        });
      }

      const user = this.users.find((x) => x.identity.userId === command.userId);
      if (!user) {
        return fail<AddNoteResult>({ code: "not_found", message: "User not found.", retriable: false });
      }

      if (!canEditUserNotes(ctx.role)) {
        return fail<AddNoteResult>({
          code: "unauthorized",
          message: "Role may not edit notes.",
          retriable: false,
        });
      }

      const overlay = this.overlay.read();
      const fingerprint = fingerprintAddNote({
        userId: command.userId,
        actorId: ctx.actorId,
        role: ctx.role,
        body: normalized.body,
      });

      const receipt = overlay.idempotencyReceipts.find((r) => r.key === key);
      if (receipt) {
        // The receipt KIND is checked alongside the fingerprint (Phase 1B4-C).
        // Each command fingerprints four parts of its own, so a note and an owner
        // change could in principle hash alike; only the receipt records which
        // command the key was actually spent on. A key spent on an owner change is
        // spent — replaying it as a note would answer a question nobody asked.
        if (receipt.kind !== undefined || receipt.fingerprint !== fingerprint) {
          return fail<AddNoteResult>({
            code: "conflict",
            message: "Idempotency key was already used for a different command.",
            retriable: false,
          });
        }
        const audit = overlay.auditRecords.find((a) => a.id === receipt.auditId);
        if (!audit) {
          // A receipt without its audit record means the overlay was edited by hand.
          // The note row may legitimately be absent — see the reconstruction below —
          // but the append-only audit record is never removed by any mutation.
          return fail<AddNoteResult>({
            code: "internal",
            message: "Overlay receipt refers to a missing record.",
            retriable: false,
          });
        }
        const existing = overlay.notes.find((n) => n.id === receipt.noteId);
        if (existing) {
          return ok({ note: existing, audit, replayed: true });
        }
        // Lifecycle compatibility (Phase 1B6, D-98): the note was DELETED after this
        // add. A delete is a hard remove, so the row is gone — and replaying this key
        // must NOT write it back (that would resurrect a deleted note). The original
        // add result is reconstructed from the audit record (id/at/actor) and this
        // retry's command payload, whose normalized body is guaranteed identical to the
        // original by the fingerprint match above; nothing here is persisted, and the
        // body is never taken from storage (it is not there to take). `at` was shared
        // by the note's createdAt/updatedAt and the audit `at` at add time.
        const note: CrmNote = {
          id: receipt.noteId,
          userId: command.userId,
          caseId: null,
          authorEmployeeId: ctx.actorId,
          body: normalized.body,
          visibility: "team",
          pinned: false,
          createdAt: audit.at,
          updatedAt: audit.at,
          mock: true,
        };
        return ok({ note, audit, replayed: true });
      }

      const sequence = overlay.sequence + 1;
      // Offsetting by the sequence keeps several notes distinguishable and
      // ordered under a fixed mock clock, where clock.now() alone repeats.
      const at = new Date(this.clock.nowMs() + sequence).toISOString();

      const note: CrmNote = {
        id: mockNoteId(sequence),
        userId: command.userId,
        caseId: null,
        authorEmployeeId: ctx.actorId,
        body: normalized.body,
        visibility: "team",
        pinned: false,
        createdAt: at,
        updatedAt: at,
        mock: true,
      };

      const audit: AuditRecord = {
        id: mockAuditId(sequence),
        action: "note_added",
        actorEmployeeId: ctx.actorId,
        actorRole: ctx.role,
        targetUserId: command.userId,
        entityType: "note",
        entityId: note.id,
        at,
        reasonCode: "note_added_by_employee",
        mock: true,
      };

      const next: MutationOverlay = {
        version: MUTATION_OVERLAY_VERSION,
        sequence,
        notes: [...overlay.notes, note],
        auditRecords: [...overlay.auditRecords, audit],
        idempotencyReceipts: [
          ...overlay.idempotencyReceipts,
          { key, fingerprint, noteId: note.id, auditId: audit.id },
        ],
      };

      try {
        this.overlay.write(next);
      } catch {
        return fail<AddNoteResult>({
          code: "internal",
          message: "Mock overlay could not be persisted.",
          retriable: true,
        });
      }

      return ok({ note, audit, replayed: false });
    });
  }

  /**
   * Set or clear a user's primary owner (Phase 1B4-C).
   *
   * Order matches `addNote` — validate → user exists → permission → idempotency →
   * write — with one step notes never needed, `expectedOwnerId`, sitting between
   * idempotency and the write.
   *
   * That position is load-bearing. A replay is checked FIRST, so re-sending a
   * command that already succeeded returns the original result even though the
   * current owner is now the value it assigned and its `expectedOwnerId` is
   * therefore stale. Were the precondition checked first, every safe retry of a
   * successful write would come back as `conflict` — the check meant to prevent a
   * lost update would instead invent one.
   *
   * Nothing is persisted until the whole overlay is assembled: a refusal for any
   * reason, storage failure included, leaves the previous overlay byte-for-byte
   * intact and writes no audit record.
   */
  assignPrimaryOwner(
    ctx: CrmContext,
    command: AssignPrimaryOwnerCommand,
  ): Promise<Result<AssignPrimaryOwnerResult>> {
    return this.gate(() => {
      const key = typeof command.idempotencyKey === "string" ? command.idempotencyKey.trim() : "";
      if (key.length === 0) {
        return fail<AssignPrimaryOwnerResult>({
          code: "invalid_input",
          message: "Idempotency key is required.",
          retriable: false,
        });
      }
      if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        return fail<AssignPrimaryOwnerResult>({
          code: "invalid_input",
          message: `Idempotency key exceeds ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
          retriable: false,
        });
      }

      // `null` clears the owner and is valid. Anything else must be an employee
      // the directory actually offers: validating against the canonical candidate
      // set is what stops a caller assigning an id the picker never showed it.
      const ownerId = command.ownerId ?? null;
      if (ownerId !== null && !isPrimaryOwnerCandidate(ownerId)) {
        return fail<AssignPrimaryOwnerResult>({
          code: "invalid_input",
          message: "Owner is not an assignable employee.",
          retriable: false,
        });
      }

      const user = this.effectiveUser(command.userId);
      if (!user) {
        return fail<AssignPrimaryOwnerResult>({
          code: "not_found",
          message: "User not found.",
          retriable: false,
        });
      }

      if (!canAssignOwner(ctx.role)) {
        return fail<AssignPrimaryOwnerResult>({
          code: "unauthorized",
          message: "Role may not assign owners.",
          retriable: false,
        });
      }

      const overlay = this.overlay.read();
      const fingerprint = fingerprintAssignPrimaryOwner({
        userId: command.userId,
        actorId: ctx.actorId,
        role: ctx.role,
        ownerId,
      });

      const receipt = overlay.idempotencyReceipts.find((r) => r.key === key);
      if (receipt) {
        if (receipt.kind !== PRIMARY_OWNER_RECEIPT_KIND || receipt.fingerprint !== fingerprint) {
          return fail<AssignPrimaryOwnerResult>({
            code: "conflict",
            message: "Idempotency key was already used for a different command.",
            retriable: false,
          });
        }
        const audit = overlay.auditRecords.find(
          (a): a is PrimaryOwnerChangedAuditRecord =>
            a.id === receipt.auditId && a.action === "primary_owner_changed",
        );
        if (!audit) {
          // A receipt without its record means the overlay was edited by hand.
          return fail<AssignPrimaryOwnerResult>({
            code: "internal",
            message: "Overlay receipt refers to a missing record.",
            retriable: false,
          });
        }
        return ok({
          userId: command.userId,
          ownerId: audit.nextOwnerId,
          audit,
          replayed: true,
        });
      }

      // The precondition: refuse if the owner is no longer what the caller saw.
      // Last-write-wins would silently discard whoever assigned in between.
      const currentOwnerId = user.operations.primaryOwnerId;
      if ((command.expectedOwnerId ?? null) !== currentOwnerId) {
        return fail<AssignPrimaryOwnerResult>({
          code: "conflict",
          message: "Primary owner changed since it was read.",
          retriable: false,
        });
      }

      const sequence = overlay.sequence + 1;
      const at = new Date(this.clock.nowMs() + sequence).toISOString();

      const audit: PrimaryOwnerChangedAuditRecord = {
        id: mockAuditId(sequence),
        action: "primary_owner_changed",
        actorEmployeeId: ctx.actorId,
        actorRole: ctx.role,
        targetUserId: command.userId,
        entityType: "user",
        entityId: command.userId,
        at,
        reasonCode: "primary_owner_changed_by_employee",
        previousOwnerId: currentOwnerId,
        nextOwnerId: ownerId,
        mock: true,
      };

      const next: MutationOverlay = {
        version: MUTATION_OVERLAY_VERSION,
        sequence,
        notes: overlay.notes,
        auditRecords: [...overlay.auditRecords, audit],
        idempotencyReceipts: [
          ...overlay.idempotencyReceipts,
          { kind: PRIMARY_OWNER_RECEIPT_KIND, key, fingerprint, auditId: audit.id },
        ],
      };

      try {
        this.overlay.write(next);
      } catch {
        return fail<AssignPrimaryOwnerResult>({
          code: "internal",
          message: "Mock overlay could not be persisted.",
          retriable: true,
        });
      }

      // The cached derivation still holds the user with the previous owner.
      // `derive` would notice on its own, but dropping the entry here keeps the
      // stale object from outliving the write that invalidated it.
      this.derivedCache.delete(command.userId);

      return ok({ userId: command.userId, ownerId, audit, replayed: false });
    });
  }

  /**
   * Pin or unpin a note (Phase 1B4-D).
   *
   * Order matches the other mutators — validate → user exists → note exists AND is
   * visible → permission → idempotency → precondition → write. Two properties are
   * specific to pinning:
   *
   *   - The note is looked up through the SAME canonical projector every read uses
   *     (`resolveEffectivePins` then `projectNotes`), so a note the caller may not
   *     see is `not_found`, exactly like a note that does not exist — the mutation
   *     cannot be turned into a probe for hidden `private`/`role_restricted` notes.
   *
   *   - Nothing on the note is rewritten. The pin change is an audit record; the
   *     effective state is derived from the log (D-76). So pinning the immutable
   *     fixture note works with no note in the overlay, and pinning an authored
   *     note leaves the stored note byte-for-byte unchanged.
   *
   * Nothing is persisted until the whole overlay is assembled: a refusal for any
   * reason, storage failure included, leaves the previous overlay intact and writes
   * no audit record.
   */
  setNotePinned(
    ctx: CrmContext,
    command: SetNotePinnedCommand,
  ): Promise<Result<SetNotePinnedResult>> {
    return this.gate(() => {
      const key = typeof command.idempotencyKey === "string" ? command.idempotencyKey.trim() : "";
      if (key.length === 0) {
        return fail<SetNotePinnedResult>({
          code: "invalid_input",
          message: "Idempotency key is required.",
          retriable: false,
        });
      }
      if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        return fail<SetNotePinnedResult>({
          code: "invalid_input",
          message: `Idempotency key exceeds ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
          retriable: false,
        });
      }

      const noteId = typeof command.noteId === "string" ? command.noteId.trim() : "";
      if (noteId.length === 0) {
        return fail<SetNotePinnedResult>({
          code: "invalid_input",
          message: "Note id is required.",
          retriable: false,
        });
      }

      // The command must describe a change. `pinned === expectedPinned` is not a
      // race — it is a request to set the state to what the caller already believes
      // it is, which is malformed, not a conflict.
      if (typeof command.pinned !== "boolean" || typeof command.expectedPinned !== "boolean") {
        return fail<SetNotePinnedResult>({
          code: "invalid_input",
          message: "Pin state must be a boolean.",
          retriable: false,
        });
      }
      if (command.pinned === command.expectedPinned) {
        return fail<SetNotePinnedResult>({
          code: "invalid_input",
          message: "Pin command describes no change.",
          retriable: false,
        });
      }

      const user = this.users.find((x) => x.identity.userId === command.userId);
      if (!user) {
        return fail<SetNotePinnedResult>({ code: "not_found", message: "User not found.", retriable: false });
      }

      // The note as this caller sees it: fixture + authored, pins resolved from the
      // log, then filtered by visibility. A note not in `visible` is either absent
      // or hidden, and both answer `not_found`.
      const overlay = this.overlay.read();
      const authored = overlay.notes.filter((n) => n.userId === command.userId);
      const withPins = resolveEffectivePins([...this.fixtureNotes(user), ...authored], overlay.auditRecords);
      const visible = projectNotes(withPins, { actorId: ctx.actorId, role: ctx.role });
      const note = visible.find((n) => n.id === noteId);
      if (!note) {
        return fail<SetNotePinnedResult>({ code: "not_found", message: "Note not found.", retriable: false });
      }

      if (!canEditUserNotes(ctx.role)) {
        return fail<SetNotePinnedResult>({
          code: "unauthorized",
          message: "Role may not edit notes.",
          retriable: false,
        });
      }

      const fingerprint = fingerprintSetNotePinned({
        userId: command.userId,
        actorId: ctx.actorId,
        role: ctx.role,
        noteId,
        pinned: command.pinned,
      });

      const receipt = overlay.idempotencyReceipts.find((r) => r.key === key);
      if (receipt) {
        if (receipt.kind !== NOTE_PIN_RECEIPT_KIND || receipt.fingerprint !== fingerprint) {
          return fail<SetNotePinnedResult>({
            code: "conflict",
            message: "Idempotency key was already used for a different command.",
            retriable: false,
          });
        }
        const audit = overlay.auditRecords.find(
          (a): a is NotePinChangedAuditRecord =>
            a.id === receipt.auditId && a.action === "note_pin_changed",
        );
        if (!audit) {
          // A receipt without its record means the overlay was edited by hand.
          return fail<SetNotePinnedResult>({
            code: "internal",
            message: "Overlay receipt refers to a missing record.",
            retriable: false,
          });
        }
        // Return the result THIS command produced (its `nextPinned`), not the
        // note's current effective state — a later command under a different key
        // may have changed it since, exactly as the owner replay returns
        // `audit.nextOwnerId`.
        return ok({ note: { ...note, pinned: audit.nextPinned }, audit, replayed: true });
      }

      // The precondition: refuse if the pin is no longer what the caller saw.
      // Last-write-wins would silently discard whoever pinned in between.
      if (command.expectedPinned !== note.pinned) {
        return fail<SetNotePinnedResult>({
          code: "conflict",
          message: "Note pin state changed since it was read.",
          retriable: false,
        });
      }

      const sequence = overlay.sequence + 1;
      const at = new Date(this.clock.nowMs() + sequence).toISOString();

      const audit: NotePinChangedAuditRecord = {
        id: mockAuditId(sequence),
        action: "note_pin_changed",
        actorEmployeeId: ctx.actorId,
        actorRole: ctx.role,
        targetUserId: command.userId,
        entityType: "note",
        entityId: note.id,
        at,
        reasonCode: "note_pin_changed_by_employee",
        previousPinned: note.pinned,
        nextPinned: command.pinned,
        mock: true,
      };

      const next: MutationOverlay = {
        version: MUTATION_OVERLAY_VERSION,
        sequence,
        // Notes are NOT mutated for pin state — the audit record is the state.
        notes: overlay.notes,
        auditRecords: [...overlay.auditRecords, audit],
        idempotencyReceipts: [
          ...overlay.idempotencyReceipts,
          { kind: NOTE_PIN_RECEIPT_KIND, key, fingerprint, auditId: audit.id },
        ],
      };

      try {
        this.overlay.write(next);
      } catch {
        return fail<SetNotePinnedResult>({
          code: "internal",
          message: "Mock overlay could not be persisted.",
          retriable: true,
        });
      }

      return ok({ note: { ...note, pinned: command.pinned }, audit, replayed: false });
    });
  }

  /**
   * Edit the body of an employee-authored note (Phase 1B4-E).
   *
   * The order is deliberate and tested (docs/MUTATION_OVERLAY.md §7):
   *   1. validate the idempotency key;
   *   2. normalize and validate the body (empty/whitespace-only/over-long);
   *   3. validate `expectedUpdatedAt` is a parseable instant;
   *   4. resolve the user or `not_found`;
   *   5. resolve the target through the SAME canonical projector every read uses
   *      (`resolveEffectivePins` then `projectNotes`);
   *   6. a note not visible to the caller is `not_found`, exactly like one that does
   *      not exist — the mutation cannot be turned into a probe for hidden notes;
   *   7. role permission (`canEditUserNotes`) or `unauthorized`;
   *   8. a visible note that is NOT in the overlay is the immutable fixture note →
   *      `invalid_input` (it is visibly present, so `not_found` would be a lie);
   *   9. a note authored by someone else → `unauthorized`, even for a permitted role;
   *  10. idempotency replay (BEFORE the precondition, so a safe retry of an applied
   *      edit still replays after `updatedAt` has advanced — D-82);
   *  11. a normalized body equal to the stored body describes no change →
   *      `invalid_input`, and no audit record is written;
   *  12. `expectedUpdatedAt` must still match the stored `updatedAt`, else `conflict`;
   *  13. one atomic overlay write.
   *
   * The stored note is rewritten in place in `notes[]` — same id, createdAt,
   * authorEmployeeId, visibility and baseline `pinned`; only `body` and `updatedAt`
   * change. The single mutation timestamp is shared by the note's `updatedAt` and the
   * audit `at`, so a replay reconstructs the result metadata from the audit alone
   * (D-83). Nothing is persisted until the whole overlay is assembled, so any refusal
   * — storage failure included — leaves the overlay untouched and writes no audit.
   */
  updateNoteBody(
    ctx: CrmContext,
    command: UpdateNoteBodyCommand,
  ): Promise<Result<UpdateNoteBodyResult>> {
    return this.gate(() => {
      // 1. Idempotency key.
      const key = typeof command.idempotencyKey === "string" ? command.idempotencyKey.trim() : "";
      if (key.length === 0) {
        return fail<UpdateNoteBodyResult>({
          code: "invalid_input",
          message: "Idempotency key is required.",
          retriable: false,
        });
      }
      if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        return fail<UpdateNoteBodyResult>({
          code: "invalid_input",
          message: `Idempotency key exceeds ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
          retriable: false,
        });
      }

      // 2. Body — normalized through the same domain rule as addNote, so the two
      // cannot disagree about what an acceptable body is. The message never carries
      // the body itself.
      const normalized = normalizeNoteBody(command.body);
      if (!normalized.ok) {
        return fail<UpdateNoteBodyResult>({
          code: "invalid_input",
          message: NOTE_BODY_MESSAGE[normalized.error],
          retriable: false,
        });
      }

      // 3. `expectedUpdatedAt` — a parseable instant, checked before any lookup. A
      // garbage precondition is malformed input, not a race.
      const expectedUpdatedAt =
        typeof command.expectedUpdatedAt === "string" ? command.expectedUpdatedAt.trim() : "";
      if (expectedUpdatedAt.length === 0 || Number.isNaN(Date.parse(expectedUpdatedAt))) {
        return fail<UpdateNoteBodyResult>({
          code: "invalid_input",
          message: "expectedUpdatedAt is not a valid instant.",
          retriable: false,
        });
      }

      const noteId = typeof command.noteId === "string" ? command.noteId.trim() : "";
      if (noteId.length === 0) {
        return fail<UpdateNoteBodyResult>({
          code: "invalid_input",
          message: "Note id is required.",
          retriable: false,
        });
      }

      // 4. User.
      const user = this.users.find((x) => x.identity.userId === command.userId);
      if (!user) {
        return fail<UpdateNoteBodyResult>({ code: "not_found", message: "User not found.", retriable: false });
      }

      // 5–6. The note as this caller sees it: fixture + authored, pins resolved,
      // then filtered by visibility. A note absent from `visible` is either missing
      // or hidden, and both answer `not_found`.
      const overlay = this.overlay.read();
      const visible = this.orderedVisibleNotes(ctx, user, overlay);
      const visibleNote = visible.find((n) => n.id === noteId);
      if (!visibleNote) {
        return fail<UpdateNoteBodyResult>({ code: "not_found", message: "Note not found.", retriable: false });
      }

      // 7. Role permission.
      if (!canEditUserNotes(ctx.role)) {
        return fail<UpdateNoteBodyResult>({
          code: "unauthorized",
          message: "Role may not edit notes.",
          retriable: false,
        });
      }

      // 8. The stored, mutable note. A visible note that is NOT in the overlay is the
      // generated fixture note: immutable, and visibly present, so `invalid_input`
      // rather than `not_found`.
      const stored = overlay.notes.find((n) => n.id === noteId && n.userId === command.userId);
      if (!stored) {
        return fail<UpdateNoteBodyResult>({
          code: "invalid_input",
          message: "Note is not editable.",
          retriable: false,
        });
      }

      // 9. Authorship — only the note's own author may rewrite its text, even with the
      // permission. This is stricter than pinning (D-76), because editing changes
      // another employee's authored content (D-82).
      if (stored.authorEmployeeId !== ctx.actorId) {
        return fail<UpdateNoteBodyResult>({
          code: "unauthorized",
          message: "Only the note's author may edit its body.",
          retriable: false,
        });
      }

      const fingerprint = fingerprintUpdateNoteBody({
        userId: command.userId,
        actorId: ctx.actorId,
        role: ctx.role,
        noteId,
        body: normalized.body,
      });

      // 10. Replay — before the precondition, so a safe retry of an already-applied
      // edit still replays even though the stored `updatedAt` has advanced.
      const receipt = overlay.idempotencyReceipts.find((r) => r.key === key);
      if (receipt) {
        if (receipt.kind !== NOTE_BODY_RECEIPT_KIND || receipt.fingerprint !== fingerprint) {
          return fail<UpdateNoteBodyResult>({
            code: "conflict",
            message: "Idempotency key was already used for a different command.",
            retriable: false,
          });
        }
        const audit = overlay.auditRecords.find(
          (a): a is NoteBodyChangedAuditRecord =>
            a.id === receipt.auditId && a.action === "note_body_changed",
        );
        if (!audit) {
          // A receipt without its record means the overlay was edited by hand.
          return fail<UpdateNoteBodyResult>({
            code: "internal",
            message: "Overlay receipt refers to a missing record.",
            retriable: false,
          });
        }
        // Reconstruct the ORIGINAL result from the audit alone: its `at` was the
        // note's `updatedAt` at the moment of that edit. The note may have been
        // edited again since, so returning its current body/updatedAt would be a
        // different edit's result — which is exactly why the result carries no note.
        return ok({ noteId: audit.entityId, updatedAt: audit.at, audit, replayed: true });
      }

      // 11. No-change — a normalized body equal to what is stored describes nothing to
      // do. Malformed rather than a race (mirrors setNotePinned's no-change rule), and
      // it writes no audit record and does not touch `updatedAt`.
      if (normalized.body === stored.body) {
        return fail<UpdateNoteBodyResult>({
          code: "invalid_input",
          message: "Note body is unchanged.",
          retriable: false,
        });
      }

      // 12. Precondition — refuse if the note was edited since the caller read it.
      // Last-write-wins would silently discard whoever edited in between.
      if (expectedUpdatedAt !== stored.updatedAt) {
        return fail<UpdateNoteBodyResult>({
          code: "conflict",
          message: "Note body changed since it was read.",
          retriable: false,
        });
      }

      // 13. One atomic write.
      const sequence = overlay.sequence + 1;
      const at = new Date(this.clock.nowMs() + sequence).toISOString();

      const updatedNote: CrmNote = {
        ...stored,
        body: normalized.body,
        updatedAt: at,
      };

      const audit: NoteBodyChangedAuditRecord = {
        id: mockAuditId(sequence),
        action: "note_body_changed",
        actorEmployeeId: ctx.actorId,
        actorRole: ctx.role,
        targetUserId: command.userId,
        entityType: "note",
        entityId: stored.id,
        at,
        reasonCode: "note_body_changed_by_employee",
        mock: true,
      };

      const next: MutationOverlay = {
        version: MUTATION_OVERLAY_VERSION,
        sequence,
        // The authored note is rewritten in place: same id, createdAt, author,
        // visibility and baseline pinned — only body and updatedAt change.
        notes: overlay.notes.map((n) => (n.id === stored.id ? updatedNote : n)),
        auditRecords: [...overlay.auditRecords, audit],
        idempotencyReceipts: [
          ...overlay.idempotencyReceipts,
          { kind: NOTE_BODY_RECEIPT_KIND, key, fingerprint, auditId: audit.id },
        ],
      };

      try {
        this.overlay.write(next);
      } catch {
        return fail<UpdateNoteBodyResult>({
          code: "internal",
          message: "Mock overlay could not be persisted.",
          retriable: true,
        });
      }

      return ok({ noteId: stored.id, updatedAt: at, audit, replayed: false });
    });
  }

  /**
   * Change the visibility of an employee-authored note between `team` and `private`
   * (Phase 1B5-C).
   *
   * The order is `updateNoteBody`'s, step for step (docs/MUTATION_OVERLAY.md §7),
   * because the same invariants apply — it rewrites an authored note in place and it
   * must not become an oracle for hidden notes:
   *   1. validate the idempotency key;
   *   2. validate the desired visibility is exactly `team` or `private` — a
   *      `role_restricted` or unknown value is `invalid_input` (D-91);
   *   3. validate `expectedUpdatedAt` is a parseable instant;
   *   4. resolve the user or `not_found`;
   *   5. resolve the target through the SAME canonical projector every read uses;
   *   6. a note not visible to the caller is `not_found`, exactly like one that does
   *      not exist — the mutation cannot be turned into a probe for hidden notes;
   *   7. role permission (`canEditUserNotes`) or `unauthorized`;
   *   8. a visible note NOT in the overlay is the immutable fixture note →
   *      `invalid_input`;
   *   9. a note authored by someone else → `unauthorized`, even for a permitted role
   *      (`private` is author-identity-based, not role-based — D-92);
   *  10. idempotency replay (BEFORE the precondition, so a safe retry of an applied
   *      change still replays after `updatedAt` has advanced — D-83);
   *  11. a requested visibility equal to the stored one describes no change →
   *      `invalid_input`, and no audit record is written;
   *  12. `expectedUpdatedAt` must still match the stored `updatedAt`, else `conflict`;
   *  13. one atomic overlay write.
   *
   * The stored note is rewritten in place — same id, createdAt, authorEmployeeId,
   * userId, body and baseline `pinned`; only `visibility` and `updatedAt` change. The
   * single mutation timestamp is shared by the note's `updatedAt` and the audit `at`
   * (D-83). Nothing is persisted until the whole overlay is assembled, so any refusal
   * — storage failure included — leaves the overlay untouched and writes no audit.
   */
  setNoteVisibility(
    ctx: CrmContext,
    command: SetNoteVisibilityCommand,
  ): Promise<Result<SetNoteVisibilityResult>> {
    return this.gate(() => {
      // 1. Idempotency key.
      const key = typeof command.idempotencyKey === "string" ? command.idempotencyKey.trim() : "";
      if (key.length === 0) {
        return fail<SetNoteVisibilityResult>({
          code: "invalid_input",
          message: "Idempotency key is required.",
          retriable: false,
        });
      }
      if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        return fail<SetNoteVisibilityResult>({
          code: "invalid_input",
          message: `Idempotency key exceeds ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
          retriable: false,
        });
      }

      // 2. Desired visibility — exactly `team` or `private`. `role_restricted` and any
      // unknown value are rejected: `role_restricted` has no allowed-roles model and
      // is not writable (D-91).
      const visibility = command.visibility;
      if (visibility !== "team" && visibility !== "private") {
        return fail<SetNoteVisibilityResult>({
          code: "invalid_input",
          message: "Visibility must be `team` or `private`.",
          retriable: false,
        });
      }

      // 3. `expectedUpdatedAt` — a parseable instant, checked before any lookup.
      const expectedUpdatedAt =
        typeof command.expectedUpdatedAt === "string" ? command.expectedUpdatedAt.trim() : "";
      if (expectedUpdatedAt.length === 0 || Number.isNaN(Date.parse(expectedUpdatedAt))) {
        return fail<SetNoteVisibilityResult>({
          code: "invalid_input",
          message: "expectedUpdatedAt is not a valid instant.",
          retriable: false,
        });
      }

      const noteId = typeof command.noteId === "string" ? command.noteId.trim() : "";
      if (noteId.length === 0) {
        return fail<SetNoteVisibilityResult>({
          code: "invalid_input",
          message: "Note id is required.",
          retriable: false,
        });
      }

      // 4. User.
      const user = this.users.find((x) => x.identity.userId === command.userId);
      if (!user) {
        return fail<SetNoteVisibilityResult>({ code: "not_found", message: "User not found.", retriable: false });
      }

      // 5–6. The note as this caller sees it. A note absent from `visible` is either
      // missing or hidden, and both answer `not_found`.
      const overlay = this.overlay.read();
      const visible = this.orderedVisibleNotes(ctx, user, overlay);
      const visibleNote = visible.find((n) => n.id === noteId);
      if (!visibleNote) {
        return fail<SetNoteVisibilityResult>({ code: "not_found", message: "Note not found.", retriable: false });
      }

      // 7. Role permission.
      if (!canEditUserNotes(ctx.role)) {
        return fail<SetNoteVisibilityResult>({
          code: "unauthorized",
          message: "Role may not edit notes.",
          retriable: false,
        });
      }

      // 8. The stored, mutable note. A visible note NOT in the overlay is the fixture
      // note: immutable, visibly present → `invalid_input`, not `not_found`.
      const stored = overlay.notes.find((n) => n.id === noteId && n.userId === command.userId);
      if (!stored) {
        return fail<SetNoteVisibilityResult>({
          code: "invalid_input",
          message: "Note is not editable.",
          retriable: false,
        });
      }

      // 9. Authorship — only the note's own author may change its visibility, even
      // with the permission. `private` is author-identity-based, not role-based (D-92).
      if (stored.authorEmployeeId !== ctx.actorId) {
        return fail<SetNoteVisibilityResult>({
          code: "unauthorized",
          message: "Only the note's author may change its visibility.",
          retriable: false,
        });
      }

      const fingerprint = fingerprintSetNoteVisibility({
        userId: command.userId,
        actorId: ctx.actorId,
        role: ctx.role,
        noteId,
        visibility,
      });

      // 10. Replay — before the precondition, so a safe retry of an already-applied
      // change still replays even though the stored `updatedAt` has advanced.
      const receipt = overlay.idempotencyReceipts.find((r) => r.key === key);
      if (receipt) {
        if (receipt.kind !== NOTE_VISIBILITY_RECEIPT_KIND || receipt.fingerprint !== fingerprint) {
          return fail<SetNoteVisibilityResult>({
            code: "conflict",
            message: "Idempotency key was already used for a different command.",
            retriable: false,
          });
        }
        const audit = overlay.auditRecords.find(
          (a): a is NoteVisibilityChangedAuditRecord =>
            a.id === receipt.auditId && a.action === "note_visibility_changed",
        );
        if (!audit) {
          return fail<SetNoteVisibilityResult>({
            code: "internal",
            message: "Overlay receipt refers to a missing record.",
            retriable: false,
          });
        }
        // Reconstruct the ORIGINAL result from the audit alone: its `at` was the
        // note's `updatedAt` at the moment of that change. A later change may have
        // moved it since, so the note's current `updatedAt` would be a different
        // change's result — which is why the result carries no note.
        return ok({ noteId: audit.entityId, updatedAt: audit.at, audit, replayed: true });
      }

      // 11. No-change — a requested visibility equal to the stored one describes
      // nothing to do. Malformed rather than a race (mirrors updateNoteBody), and it
      // writes no audit record and does not touch `updatedAt`.
      if (visibility === stored.visibility) {
        return fail<SetNoteVisibilityResult>({
          code: "invalid_input",
          message: "Note visibility is unchanged.",
          retriable: false,
        });
      }

      // 12. Precondition — refuse if the note changed since the caller read it.
      if (expectedUpdatedAt !== stored.updatedAt) {
        return fail<SetNoteVisibilityResult>({
          code: "conflict",
          message: "Note changed since it was read.",
          retriable: false,
        });
      }

      // 13. One atomic write.
      const sequence = overlay.sequence + 1;
      const at = new Date(this.clock.nowMs() + sequence).toISOString();

      // The stored visibility must be one of the two writable values for the audit
      // record's `previousVisibility`. A note can only have reached `private` through
      // THIS mutation (nothing else writes non-`team`), and fixtures/authored notes
      // are born `team`, so `stored.visibility` is always `team` or `private` here.
      const previousVisibility: "team" | "private" =
        stored.visibility === "private" ? "private" : "team";

      const updatedNote: CrmNote = {
        ...stored,
        visibility,
        updatedAt: at,
      };

      const audit: NoteVisibilityChangedAuditRecord = {
        id: mockAuditId(sequence),
        action: "note_visibility_changed",
        actorEmployeeId: ctx.actorId,
        actorRole: ctx.role,
        targetUserId: command.userId,
        entityType: "note",
        entityId: stored.id,
        at,
        reasonCode: "note_visibility_changed_by_employee",
        previousVisibility,
        nextVisibility: visibility,
        mock: true,
      };

      const next: MutationOverlay = {
        version: MUTATION_OVERLAY_VERSION,
        sequence,
        // The authored note is rewritten in place: same id, createdAt, author,
        // userId, body and baseline pinned — only visibility and updatedAt change.
        notes: overlay.notes.map((n) => (n.id === stored.id ? updatedNote : n)),
        auditRecords: [...overlay.auditRecords, audit],
        idempotencyReceipts: [
          ...overlay.idempotencyReceipts,
          { kind: NOTE_VISIBILITY_RECEIPT_KIND, key, fingerprint, auditId: audit.id },
        ],
      };

      try {
        this.overlay.write(next);
      } catch {
        return fail<SetNoteVisibilityResult>({
          code: "internal",
          message: "Mock overlay could not be persisted.",
          retriable: true,
        });
      }

      return ok({ noteId: stored.id, updatedAt: at, audit, replayed: false });
    });
  }

  /**
   * Permanently delete an employee-authored note (Phase 1B6).
   *
   * The order is DELIBERATELY different from the edit mutations in one place: the
   * idempotency replay is resolved BEFORE the note is looked up. After a successful
   * delete the note is gone, so a retry that looked it up first would answer
   * `not_found` — the check meant to make retries safe would instead break them. So
   * (docs/MUTATION_OVERLAY.md §7, D-98):
   *   1. validate the idempotency key;
   *   2. validate `expectedUpdatedAt` is a parseable instant;
   *   3. validate `noteId` is present;
   *   4. compute the delete fingerprint (userId, noteId, actorId, role — never
   *      `expectedUpdatedAt`);
   *   5. resolve the receipt by key: a matching kind+fingerprint replays the original
   *      result; a different kind or fingerprint is `conflict`. THIS IS BEFORE THE
   *      ENTITY LOOKUP;
   *   6. resolve the user or `not_found`;
   *   7. resolve the target through the SAME canonical projector every read uses — a
   *      note not visible to the caller is `not_found`, exactly like one that does not
   *      exist, so the mutation cannot probe for hidden notes;
   *   8. role permission (`canEditUserNotes`) or `unauthorized`;
   *   9. a visible note NOT in the overlay is the immutable fixture note →
   *      `invalid_input`;
   *  10. a note authored by someone else → `unauthorized`, even for a permitted role,
   *      and for `private` notes too (no extra exception — D-96);
   *  11. `expectedUpdatedAt` must still match the stored `updatedAt`, else `conflict`;
   *  12. one atomic overlay write: remove the note row, append the `note_deleted`
   *      audit record and the delete receipt.
   *
   * The delete is HARD: the note row leaves `notes[]`, no tombstone or body is kept,
   * and the note's earlier records (note_added, edits, pin/visibility changes) are NOT
   * removed. The single deletion timestamp is shared by the audit `at` and
   * `result.deletedAt` (D-98). Nothing is persisted until the whole overlay is
   * assembled, so any refusal — storage failure included — leaves the overlay
   * byte-for-byte intact and writes no audit record, and the same key may be retried.
   */
  deleteNote(ctx: CrmContext, command: DeleteNoteCommand): Promise<Result<DeleteNoteResult>> {
    return this.gate(() => {
      // 1. Idempotency key.
      const key = typeof command.idempotencyKey === "string" ? command.idempotencyKey.trim() : "";
      if (key.length === 0) {
        return fail<DeleteNoteResult>({
          code: "invalid_input",
          message: "Idempotency key is required.",
          retriable: false,
        });
      }
      if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        return fail<DeleteNoteResult>({
          code: "invalid_input",
          message: `Idempotency key exceeds ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
          retriable: false,
        });
      }

      // 2. `expectedUpdatedAt` — a parseable instant, checked before any lookup. A
      // garbage precondition is malformed input, not a race. It gates the precondition
      // check (step 11), not the fingerprint, so a replay never depends on it.
      const expectedUpdatedAt =
        typeof command.expectedUpdatedAt === "string" ? command.expectedUpdatedAt.trim() : "";
      if (expectedUpdatedAt.length === 0 || Number.isNaN(Date.parse(expectedUpdatedAt))) {
        return fail<DeleteNoteResult>({
          code: "invalid_input",
          message: "expectedUpdatedAt is not a valid instant.",
          retriable: false,
        });
      }

      // 3. Note id.
      const noteId = typeof command.noteId === "string" ? command.noteId.trim() : "";
      if (noteId.length === 0) {
        return fail<DeleteNoteResult>({
          code: "invalid_input",
          message: "Note id is required.",
          retriable: false,
        });
      }

      const overlay = this.overlay.read();

      // 4. Fingerprint — from the command's identity alone (never the deleted note's
      // contents), so it survives the entity vanishing.
      const fingerprint = fingerprintDeleteNote({
        userId: command.userId,
        actorId: ctx.actorId,
        role: ctx.role,
        noteId,
      });

      // 5. Replay — BEFORE the entity lookup. This is the property that makes a retry
      // after a successful delete return the original result instead of `not_found`.
      const receipt = overlay.idempotencyReceipts.find((r) => r.key === key);
      if (receipt) {
        if (receipt.kind !== NOTE_DELETE_RECEIPT_KIND || receipt.fingerprint !== fingerprint) {
          return fail<DeleteNoteResult>({
            code: "conflict",
            message: "Idempotency key was already used for a different command.",
            retriable: false,
          });
        }
        const audit = overlay.auditRecords.find(
          (a): a is NoteDeletedAuditRecord =>
            a.id === receipt.auditId && a.action === "note_deleted",
        );
        if (!audit) {
          return fail<DeleteNoteResult>({
            code: "internal",
            message: "Overlay receipt refers to a missing record.",
            retriable: false,
          });
        }
        // The original result, reconstructed from the audit alone: its `at` was the
        // deletion timestamp, and `entityId` the deleted note's id. No second audit or
        // receipt is written.
        return ok({ noteId: audit.entityId, deletedAt: audit.at, audit, replayed: true });
      }

      // 6. User.
      const user = this.users.find((x) => x.identity.userId === command.userId);
      if (!user) {
        return fail<DeleteNoteResult>({ code: "not_found", message: "User not found.", retriable: false });
      }

      // 7. The note as this caller sees it. A note absent from `visible` is either
      // missing or hidden, and both answer `not_found`.
      const visible = this.orderedVisibleNotes(ctx, user, overlay);
      const visibleNote = visible.find((n) => n.id === noteId);
      if (!visibleNote) {
        return fail<DeleteNoteResult>({ code: "not_found", message: "Note not found.", retriable: false });
      }

      // 8. Role permission.
      if (!canEditUserNotes(ctx.role)) {
        return fail<DeleteNoteResult>({
          code: "unauthorized",
          message: "Role may not edit notes.",
          retriable: false,
        });
      }

      // 9. The stored, mutable note. A visible note NOT in the overlay is the fixture
      // note: immutable, visibly present → `invalid_input`, not `not_found`.
      const stored = overlay.notes.find((n) => n.id === noteId && n.userId === command.userId);
      if (!stored) {
        return fail<DeleteNoteResult>({
          code: "invalid_input",
          message: "Note is not deletable.",
          retriable: false,
        });
      }

      // 10. Authorship — only the note's own author may delete it, even with the
      // permission, and for `private` notes on the same rule (no extra exception).
      if (stored.authorEmployeeId !== ctx.actorId) {
        return fail<DeleteNoteResult>({
          code: "unauthorized",
          message: "Only the note's author may delete it.",
          retriable: false,
        });
      }

      // 11. Precondition — refuse if the note changed since the caller read it, so a
      // delete never silently discards an intervening edit.
      if (expectedUpdatedAt !== stored.updatedAt) {
        return fail<DeleteNoteResult>({
          code: "conflict",
          message: "Note changed since it was read.",
          retriable: false,
        });
      }

      // 12. One atomic write: remove the row, append the audit and the receipt.
      const sequence = overlay.sequence + 1;
      const at = new Date(this.clock.nowMs() + sequence).toISOString();

      const audit: NoteDeletedAuditRecord = {
        id: mockAuditId(sequence),
        action: "note_deleted",
        actorEmployeeId: ctx.actorId,
        actorRole: ctx.role,
        targetUserId: command.userId,
        entityType: "note",
        entityId: stored.id,
        at,
        reasonCode: "note_deleted_by_employee",
        mock: true,
      };

      const next: MutationOverlay = {
        version: MUTATION_OVERLAY_VERSION,
        sequence,
        // Hard delete: the note row is physically removed. Its earlier audit records
        // (note_added, edits, pin/visibility) stay — the log is append-only.
        notes: overlay.notes.filter((n) => n.id !== stored.id),
        auditRecords: [...overlay.auditRecords, audit],
        idempotencyReceipts: [
          ...overlay.idempotencyReceipts,
          { kind: NOTE_DELETE_RECEIPT_KIND, key, fingerprint, auditId: audit.id },
        ],
      };

      try {
        this.overlay.write(next);
      } catch {
        return fail<DeleteNoteResult>({
          code: "internal",
          message: "Mock overlay could not be persisted.",
          retriable: true,
        });
      }

      return ok({ noteId: stored.id, deletedAt: at, audit, replayed: false });
    });
  }
}
