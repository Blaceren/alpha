/**
 * MockCrmDataProvider — full deterministic read-model over the synthetic dataset.
 * Implements every read operation of the CrmDataProvider contract with
 * pagination, filtering, sorting, permission-aware projection, stale metadata,
 * controllable delay/error/empty modes. UI never imports fixtures directly.
 */
import type { UserId, Freshness } from "@/domain/shared/primitives";
import type { UserSummary } from "@/domain/users/user";
import type { User360 } from "@/domain/users/user-360";
import { projectUser360 } from "@/domain/users/user-360-projection";
import { buildProjectedUserTimeline } from "@/domain/users/user-timeline";
import type { Paginated, Result } from "@/data/contracts/result";
import { empty, fail, ok, stale } from "@/data/contracts/result";
import type { CrmRole } from "@/domain/identity/roles";
import type {
  CrmContext,
  CrmDataProvider,
  CrmNote,
  FinancialOperationsSummary,
  GetFinOpsInput,
  GetQueueInput,
  GetRecommendedInput,
  GetTimelineInput,
  GetTodayInput,
  GetUserCasesInput,
  GetUserNotesInput,
  GetUserTasksInput,
  QueueItem,
  RecommendedAction,
  SearchUsersInput,
  Segment,
  TodayWorkspace,
  UserFilters,
  UserSortField,
  UserTimelineEvent,
} from "@/data/contracts/CrmDataProvider";
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
import { canViewExactFinancials } from "@/domain/identity/access";
import { computeSegments } from "@/domain/segments/segments";
import { buildTodayWorkspace } from "@/domain/today/builder";

export interface MockProviderOptions {
  clock?: Clock;
  delayMs?: number;
  errorMode?: boolean;
  emptyMode?: boolean;
  staleMode?: boolean;
}

interface Derived {
  user: MockUser;
  signals: ComputedSignal[];
  priority: ReturnType<typeof computePriority>;
}

const PAGE_DEFAULT = 50;
const bandToLevel: Record<PriorityBand, PriorityLevel> = {
  critical: "critical",
  high: "high",
  normal: "medium",
  low: "low",
};

export class MockCrmDataProvider implements CrmDataProvider {
  private readonly clock: Clock;
  private readonly delayMs: number;
  private readonly errorMode: boolean;
  private readonly emptyMode: boolean;
  private readonly staleMode: boolean;
  private readonly users: MockUser[];
  private readonly derivedCache = new Map<string, Derived>();

  constructor(options: MockProviderOptions = {}) {
    this.clock = options.clock ?? new FixedMockClock();
    this.delayMs = options.delayMs ?? 0;
    this.errorMode = options.errorMode ?? false;
    this.emptyMode = options.emptyMode ?? false;
    this.staleMode = options.staleMode ?? false;
    this.users = defaultDataset(this.clock);
  }

  /* ------------------------------------------------------------- helpers */

  private async gate<T>(produce: () => Result<T>): Promise<Result<T>> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.errorMode) {
      return fail<T>({ code: "upstream_unavailable", message: "Mock error mode.", retriable: true });
    }
    return produce();
  }

  private derive(user: MockUser): Derived {
    const cached = this.derivedCache.get(user.identity.userId);
    if (cached) return cached;
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

  getTodayWorkspace(ctx: CrmContext, _input: GetTodayInput): Promise<Result<TodayWorkspace>> {
    return this.gate(() => {
      const built = buildTodayWorkspace(this.users, this.clock, ctx.role);
      // Adapt the rich builder output to the contract TodayWorkspace shape.
      const workspace: TodayWorkspace = {
        generatedAt: built.generatedAt,
        groups: built.queues.map((q) => ({
          key: q.code as never,
          title: q.title,
          priority: bandToLevel[q.priority],
          items: q.items.map((it) => ({
            userId: it.userId,
            reason: it.reason,
            priority: bandToLevel[it.priority],
            recommendedAction: it.recommendedAction?.code ?? null,
            owner: it.ownerId,
            dueAt: it.dueAt,
            status: it.reasonCode,
          })),
        })),
      };
      return ok(workspace);
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
      let rows = this.users.map((u) => this.derive(u)).filter((d) => this.matches(d, filters));
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
      const u = this.users.find((x) => x.identity.userId === input.userId);
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
      const u = this.users.find((x) => x.identity.userId === input.userId);
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
   */
  getUserTimeline(ctx: CrmContext, input: GetTimelineInput): Promise<Result<Paginated<UserTimelineEvent>>> {
    return this.gate(() => {
      const u = this.users.find((x) => x.identity.userId === input.userId);
      // Unknown user keeps its previous contract: an empty page, not an error.
      if (!u) return empty(this.paginate<UserTimelineEvent>([]));
      const events: UserTimelineEvent[] = buildProjectedUserTimeline(u, ctx.role).filter(
        (e) => !input.sources || input.sources.includes(e.source),
      );
      return ok(this.paginate(events, input.page?.cursor, input.page?.pageSize));
    });
  }

  getUserTasks(_ctx: CrmContext, input: GetUserTasksInput): Promise<Result<Paginated<CrmTask>>> {
    return this.gate(() => {
      const u = this.users.find((x) => x.identity.userId === input.userId);
      if (!u) return empty(this.paginate<CrmTask>([]));
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
      const u = this.users.find((x) => x.identity.userId === input.userId);
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

  getUserNotes(_ctx: CrmContext, input: GetUserNotesInput): Promise<Result<Paginated<CrmNote>>> {
    return this.gate(() => {
      const u = this.users.find((x) => x.identity.userId === input.userId);
      if (!u) return empty(this.paginate<CrmNote>([]));
      const notes: CrmNote[] = [
        {
          id: `${u.identity.userId}_note_1`,
          userId: u.identity.userId,
          caseId: null,
          authorId: u.operations.primaryOwnerId ?? "emp_mock_admin",
          body: `Синтетическая заметка: ${u.state.reasonCode}.`,
          visibility: "team",
          pinned: false,
          createdAt: this.clock.nowIso(),
        },
      ];
      return ok(this.paginate(notes, input.page?.cursor));
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
    const rows = this.users
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
}
