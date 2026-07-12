/**
 * MockCrmDataProvider — Phase 1A shell-smoke implementation of CrmDataProvider.
 * Returns small/empty synthetic results, supports an artificial dev delay and a
 * controllable error mode for exercising error states. NOT production data.
 */
import type { UserId } from "@/domain/shared/primitives";
import type { UserSummary } from "@/domain/users/user";
import type { Paginated, Result } from "@/data/contracts/result";
import { empty, fail, ok } from "@/data/contracts/result";
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
  Segment,
  TodayWorkspace,
  UserTimelineEvent,
} from "@/data/contracts/CrmDataProvider";
import type { CrmTask } from "@/domain/tasks/task";
import type { CrmCase } from "@/domain/cases/case";
import type { UserSignal } from "@/domain/signals/signal";
import { MOCK_USERS } from "./fixtures";

export interface MockProviderOptions {
  /** Artificial latency in ms (dev realism). */
  delayMs?: number;
  /** When true, every operation returns an `upstream_unavailable` error. */
  errorMode?: boolean;
}

function emptyPage<T>(): Paginated<T> {
  return { items: [], page: { cursor: null, nextCursor: null, total: 0, pageSize: 50 } };
}

export class MockCrmDataProvider implements CrmDataProvider {
  private readonly delayMs: number;
  private readonly errorMode: boolean;

  constructor(options: MockProviderOptions = {}) {
    this.delayMs = options.delayMs ?? 0;
    this.errorMode = options.errorMode ?? false;
  }

  private async gate<T>(produce: () => Result<T>): Promise<Result<T>> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.errorMode) {
      return fail<T>({
        code: "upstream_unavailable",
        message: "Mock provider error mode is enabled.",
        retriable: true,
      });
    }
    return produce();
  }

  getTodayWorkspace(_ctx: CrmContext, _input: GetTodayInput): Promise<Result<TodayWorkspace>> {
    return this.gate(() =>
      ok<TodayWorkspace>({ generatedAt: new Date().toISOString(), groups: [] }),
    );
  }

  searchUsers(
    _ctx: CrmContext,
    _input: Parameters<CrmDataProvider["searchUsers"]>[1],
  ): Promise<Result<Paginated<UserSummary>>> {
    return this.gate(() =>
      ok<Paginated<UserSummary>>({
        items: MOCK_USERS,
        page: {
          cursor: null,
          nextCursor: null,
          total: MOCK_USERS.length,
          pageSize: 50,
        },
      }),
    );
  }

  getUserById(_ctx: CrmContext, input: { userId: UserId }): Promise<Result<UserSummary>> {
    return this.gate(() => {
      const found = MOCK_USERS.find((u) => u.id === input.userId);
      if (!found) {
        return fail<UserSummary>({
          code: "not_found",
          message: `No mock user ${input.userId}.`,
          retriable: false,
        });
      }
      return ok(found);
    });
  }

  getUserTimeline(_ctx: CrmContext, _input: GetTimelineInput): Promise<Result<Paginated<UserTimelineEvent>>> {
    return this.gate(() => empty(emptyPage<UserTimelineEvent>()));
  }

  getUserTasks(_ctx: CrmContext, _input: GetUserTasksInput): Promise<Result<Paginated<CrmTask>>> {
    return this.gate(() => empty(emptyPage<CrmTask>()));
  }

  getUserCases(_ctx: CrmContext, _input: GetUserCasesInput): Promise<Result<Paginated<CrmCase>>> {
    return this.gate(() => empty(emptyPage<CrmCase>()));
  }

  getUserNotes(_ctx: CrmContext, _input: GetUserNotesInput): Promise<Result<Paginated<CrmNote>>> {
    return this.gate(() => empty(emptyPage<CrmNote>()));
  }

  getSegments(
    _ctx: CrmContext,
    _input: { kind?: "system" | "saved" },
  ): Promise<Result<Segment[]>> {
    return this.gate(() => empty<Segment[]>([]));
  }

  getMentorQueue(_ctx: CrmContext, _input: GetQueueInput): Promise<Result<Paginated<QueueItem>>> {
    return this.gate(() => empty(emptyPage<QueueItem>()));
  }

  getSupportQueue(_ctx: CrmContext, _input: GetQueueInput): Promise<Result<Paginated<QueueItem>>> {
    return this.gate(() => empty(emptyPage<QueueItem>()));
  }

  getFinancialOperationsSummary(_ctx: CrmContext, _input: GetFinOpsInput): Promise<Result<FinancialOperationsSummary>> {
    return this.gate(() =>
      ok<FinancialOperationsSummary>({
        generatedAt: new Date().toISOString(),
        checkpointApproaching: 0,
        checkpointGrace: 0,
        accessSuspended: 0,
        dataConflicts: 0,
      }),
    );
  }

  getUserSignals(
    _ctx: CrmContext,
    _input: { userId: UserId; includeExpired?: boolean },
  ): Promise<Result<UserSignal[]>> {
    return this.gate(() => empty<UserSignal[]>([]));
  }

  getRecommendedActions(_ctx: CrmContext, _input: GetRecommendedInput): Promise<Result<RecommendedAction[]>> {
    return this.gate(() => empty<RecommendedAction[]>([]));
  }
}
