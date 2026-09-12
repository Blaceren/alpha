/**
 * LEARNER-OPERATIONS-V1 — the SLA clock.
 *
 * Pure functions over a case row and its policy. Nothing here reads the
 * database, nothing here writes, and nothing here knows what a "good" duration
 * is: the numbers come from `LearnerOpsSlaPolicy` and the behaviour comes from
 * `contract.ts`.
 *
 * WHY BREACH IS COMPUTED AND NEVER STORED. A stored breach flag is correct only
 * until the deadline passes, and then stays wrong until some unrelated write
 * happens to refresh it. That window — deadline passed, nothing has touched the
 * row — is exactly when an operator looks at the queue to find what is late. So
 * the state is derived from the clock on every read, which cannot go stale.
 *
 * WHY PAUSE IS ACCUMULATED ON EXIT. The alternative is replaying the event log
 * to work out how long a case sat in each waiting state. That is correct but it
 * makes every list read O(events), and it silently changes meaning if an event
 * is ever backfilled. Accumulating into `pausedMs` when a case LEAVES a pausing
 * state keeps the read O(1) and keeps the number an auditable fact rather than
 * a recomputation.
 */
import type { LearnerOpsCaseStatus, LearnerOpsPriority } from "@prisma/client";
import { clockStopped, resolutionClockPauses, type SlaPauseFlags } from "@/lib/learner-ops/contract";

/** The fields of a case this module needs. Deliberately a structural subset. */
export type SlaCaseInput = {
  readonly status: LearnerOpsCaseStatus;
  readonly openedAt: Date;
  readonly pausedMs: number;
  readonly clockPausedAt: Date | null;
  readonly firstResponseDueAt: Date | null;
  readonly resolutionDueAt: Date | null;
  readonly firstRespondedAt: Date | null;
  readonly resolvedAt: Date | null;
};

export type SlaPolicyInput =
  | (SlaPauseFlags & {
      readonly key: string;
      readonly priority: LearnerOpsPriority;
      readonly firstResponseTargetMinutes: number | null;
      readonly resolutionTargetMinutes: number | null;
      /** Provenance travels with the numbers, always. */
      readonly origin: "preprod_acceptance_fixture" | "product_owner_supplied";
    })
  | null;

/**
 * `none` — no policy, or no target for this clock. NOT a synonym for "met":
 * the CRM renders it as "target not set", because a target nobody chose has not
 * been achieved, it simply does not exist.
 */
export type SlaClockState = "none" | "running" | "paused" | "met" | "breached" | "stopped";

export type SlaClockView = {
  readonly state: SlaClockState;
  readonly dueAt: string | null;
  readonly remainingMs: number | null;
  readonly overdueMs: number | null;
};

export type SlaView = {
  readonly policyKey: string | null;
  readonly origin: "preprod_acceptance_fixture" | "product_owner_supplied" | null;
  readonly firstResponse: SlaClockView;
  readonly resolution: SlaClockView;
  /** True when EITHER clock is breached. The queue's "late" filter uses this. */
  readonly breached: boolean;
};

const MINUTE_MS = 60_000;

export function minutesFromNow(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * MINUTE_MS);
}

/**
 * Elapsed WORKING time — wall time since `openedAt`, less every completed pause
 * and less the pause currently in progress.
 *
 * Guarded to never go negative. A clock skew or a hand-edited row should
 * produce "zero elapsed", not a negative duration that would render as a
 * deadline in the future.
 */
export function elapsedWorkingMs(input: SlaCaseInput, now: Date): number {
  const end = input.resolvedAt && clockStopped(input.status) ? input.resolvedAt : now;
  const gross = end.getTime() - input.openedAt.getTime();
  const openPause = input.clockPausedAt ? Math.max(0, end.getTime() - input.clockPausedAt.getTime()) : 0;
  return Math.max(0, gross - input.pausedMs - openPause);
}

function clockView(
  dueAt: Date | null,
  now: Date,
  options: { readonly satisfied: boolean; readonly stopped: boolean; readonly paused: boolean },
): SlaClockView {
  if (!dueAt) {
    return { state: "none", dueAt: null, remainingMs: null, overdueMs: null };
  }
  const delta = dueAt.getTime() - now.getTime();
  const base = { dueAt: dueAt.toISOString() };

  if (options.satisfied) {
    return { ...base, state: "met", remainingMs: null, overdueMs: null };
  }
  if (options.stopped) {
    return { ...base, state: "stopped", remainingMs: null, overdueMs: null };
  }
  if (delta < 0) {
    return { ...base, state: "breached", remainingMs: null, overdueMs: -delta };
  }
  return {
    ...base,
    state: options.paused ? "paused" : "running",
    remainingMs: delta,
    overdueMs: null,
  };
}

/**
 * The whole SLA picture for one case.
 *
 * FIRST RESPONSE is `met` the moment `firstRespondedAt` exists, and stays met
 * forever — including across a reopen. The first response is a historical fact
 * and a later reopen does not un-happen it.
 *
 * FIRST RESPONSE DOES NOT PAUSE. Its `paused` flag is always false: a learner
 * waiting for their very first reply is waiting on us regardless of which
 * internal or external party we are waiting on. Only the resolution clock
 * honours the policy's pause flags.
 */
export function computeSlaView(
  input: SlaCaseInput,
  policy: SlaPolicyInput,
  now: Date,
): SlaView {
  const stopped = clockStopped(input.status);
  const resolutionPaused =
    !stopped && policy !== null && resolutionClockPauses(input.status, policy);

  const firstResponse = clockView(input.firstResponseDueAt, now, {
    satisfied: input.firstRespondedAt !== null,
    stopped,
    paused: false,
  });

  const resolution = clockView(input.resolutionDueAt, now, {
    satisfied: input.resolvedAt !== null,
    stopped,
    paused: resolutionPaused,
  });

  return {
    policyKey: policy?.key ?? null,
    origin: policy?.origin ?? null,
    firstResponse,
    resolution,
    breached: firstResponse.state === "breached" || resolution.state === "breached",
  };
}

/**
 * The pause bookkeeping for one status transition, returned as the exact column
 * changes to apply. The caller writes them inside the transaction that performs
 * the transition, so the clock and the status can never disagree.
 *
 * ENTERING a pausing state stamps `clockPausedAt`.
 * LEAVING one folds the elapsed pause into `pausedMs` and clears the stamp.
 * A transition between two pausing states does BOTH, in that order, so the
 * accumulated total stays exact rather than restarting.
 */
export function pauseTransition(
  input: Pick<SlaCaseInput, "status" | "pausedMs" | "clockPausedAt">,
  nextStatus: LearnerOpsCaseStatus,
  policy: SlaPolicyInput,
  now: Date,
): { pausedMs: number; clockPausedAt: Date | null } {
  const wasPaused = input.clockPausedAt !== null;
  const shouldPause =
    policy !== null && !clockStopped(nextStatus) && resolutionClockPauses(nextStatus, policy);

  // Fold any pause that is ending. Guarded against a clock that moved backwards.
  const accumulated = wasPaused
    ? input.pausedMs + Math.max(0, now.getTime() - (input.clockPausedAt as Date).getTime())
    : input.pausedMs;

  if (shouldPause) {
    // Staying paused across two pausing states restamps, which is why the fold
    // above had to happen first — otherwise the first interval would be lost.
    return { pausedMs: accumulated, clockPausedAt: now };
  }
  return { pausedMs: accumulated, clockPausedAt: null };
}

/**
 * The targets for a newly opened or reopened case.
 *
 * A reopen recomputes the RESOLUTION target from the reopen instant, because
 * the promise being made is about the new piece of work. It never recomputes
 * the first-response target, and the caller never clears `firstRespondedAt`.
 */
export function computeTargets(
  policy: SlaPolicyInput,
  from: Date,
): { firstResponseDueAt: Date | null; resolutionDueAt: Date | null } {
  if (!policy) return { firstResponseDueAt: null, resolutionDueAt: null };
  return {
    firstResponseDueAt:
      policy.firstResponseTargetMinutes === null
        ? null
        : minutesFromNow(from, policy.firstResponseTargetMinutes),
    resolutionDueAt:
      policy.resolutionTargetMinutes === null
        ? null
        : minutesFromNow(from, policy.resolutionTargetMinutes),
  };
}
