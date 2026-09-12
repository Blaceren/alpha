/**
 * Pure state model for the L4 financial-checkpoint experience (no React, fully
 * testable).
 *
 * EVERY verdict is the Backend's. This reducer never decides whether a
 * threshold was met, never infers a pass from an absence of errors, and never
 * treats local state as authority. It only decides which honest screen to show
 * and whether the verify control may be pressed.
 *
 * It also holds NO amount. There is no field for a balance, a remaining sum or
 * a deposit, so no render path can display one.
 */
import type { NormalizedError } from "@/lib/api/errors";
import type { AcademyCheckpointState } from "@/lib/curriculum/academy-view";
import type { CheckpointVerificationResult } from "@/lib/checkpoint/types";

/**
 * The screens this feature can present. One per required state, plus `error`
 * for a bounded transport failure the Backend never got to answer.
 */
export type CheckpointPhase =
  /** Verification is switched off (checkpoint or provider flag). */
  | "disabled"
  /** The provider exists but cannot answer right now. */
  | "provider_unavailable"
  | "identity_unlinked"
  | "identity_mismatch"
  | "unsupported_currency"
  /** The learner may ask. */
  | "ready"
  /** A request is in flight (locally or server-side). */
  | "checking"
  /** A recent attempt means they must wait. */
  | "cooldown"
  /** The Backend looked and the threshold was not reached. */
  | "not_met"
  | "completed"
  /** A bounded transport/response failure. Not a verdict about money. */
  | "error";

export type CheckpointMachineState = {
  phase: CheckpointPhase;
  /** Seconds left before another attempt is allowed. A duration, never an amount. */
  retryAfterSeconds: number | null;
  /** Identity of the in-flight attempt; reused verbatim for a retry. */
  requestId: string | null;
  error: NormalizedError | null;
  /** True once a verification completed the level (drives the refresh). */
  completed: boolean;
};

export type CheckpointAction =
  | { type: "verify_pending"; requestId: string }
  | { type: "verify_ok"; result: CheckpointVerificationResult }
  | { type: "verify_err"; error: NormalizedError }
  | { type: "tick" }
  | { type: "dismiss_error" };

/** Backend reason -> the screen that tells the learner the truth about it. */
const REASON_PHASE: Record<string, CheckpointPhase> = {
  checkpoint_disabled: "disabled",
  provider_disabled: "disabled",
  provider_unconfigured: "provider_unavailable",
  requirement_unconfigured: "provider_unavailable",
  integration_unknown: "provider_unavailable",
  provider_timeout: "provider_unavailable",
  provider_maintenance: "provider_unavailable",
  provider_rate_limited: "provider_unavailable",
  stale: "provider_unavailable",
  invalid_provider_response: "provider_unavailable",
  unsupported: "provider_unavailable",
  identity_unlinked: "identity_unlinked",
  identity_mismatch: "identity_mismatch",
  unsupported_currency: "unsupported_currency",
};

/**
 * Fold a checkpoint state + reason into a screen.
 *
 * Fail-closed: an unrecognised combination becomes `provider_unavailable`,
 * never `ready` and never `completed`.
 */
export function phaseFor(
  verificationState: string,
  reason: string,
): CheckpointPhase {
  switch (verificationState) {
    case "completed":
      return "completed";
    case "ready":
      return "ready";
    case "checking":
      return "checking";
    case "cooldown":
      // Both our cooldown and the hourly allowance present as "wait" — the
      // difference is operational and belongs in the audit, not on the screen.
      return "cooldown";
    case "not_met":
      return "not_met";
    case "verification_unavailable":
      return REASON_PHASE[reason] ?? "provider_unavailable";
    default:
      return "provider_unavailable";
  }
}

/** Initial state, derived entirely from the server-rendered checkpoint block. */
export function initialState(checkpoint: AcademyCheckpointState): CheckpointMachineState {
  return {
    phase: phaseFor(checkpoint.verificationState, checkpoint.reason),
    retryAfterSeconds: checkpoint.retryAfterSeconds,
    requestId: null,
    error: null,
    completed: checkpoint.verificationState === "completed",
  };
}

/**
 * True only when a verification request may actually be sent.
 *
 * Requires BOTH the Backend's permission (`canVerify`) and a local phase that
 * is not already busy or finished. The Academy narrows the Backend's answer and
 * never widens it.
 */
export function canSubmit(
  state: CheckpointMachineState,
  checkpoint: AcademyCheckpointState,
): boolean {
  if (!checkpoint.canVerify) return false;
  if (state.phase === "checking") return false;
  if (state.phase === "completed") return false;
  if (state.phase === "cooldown") return false;
  return state.phase === "ready" || state.phase === "not_met" || state.phase === "error";
}

/** Map a transport failure to a bounded phase. Never to a verdict. */
export function phaseForError(error: NormalizedError): CheckpointPhase {
  // Feature disabled fails closed as 404 / NOT_FOUND.
  if (error.status === 404 || error.code === "NOT_FOUND") return "disabled";
  return "error";
}

export function reducer(
  state: CheckpointMachineState,
  action: CheckpointAction,
): CheckpointMachineState {
  switch (action.type) {
    case "verify_pending":
      // Guard: never enter `checking` twice. This is the reducer half of the
      // double-submit protection; the component holds the other half.
      if (state.phase === "checking" || state.phase === "completed") return state;
      return {
        ...state,
        phase: "checking",
        requestId: action.requestId,
        error: null,
        retryAfterSeconds: null,
      };
    case "verify_ok": {
      const result = action.result;
      return {
        ...state,
        phase: phaseFor(result.verificationState, result.verificationReason),
        retryAfterSeconds: result.retryAfterSeconds,
        error: null,
        // Completion is the Backend's word, never inferred from the state name.
        completed: result.completed === true,
        // Keep the identity so a retry of THIS attempt replays instead of
        // spending another of the learner's five hourly attempts.
        requestId: state.requestId,
      };
    }
    case "verify_err":
      return { ...state, phase: phaseForError(action.error), error: action.error };
    case "tick": {
      if (state.retryAfterSeconds === null) return state;
      // Named `secondsLeft`, not `remaining`: the privacy contract test bans
      // amount-shaped identifiers outright, and a countdown must not read like
      // "how much is left to deposit".
      const secondsLeft = state.retryAfterSeconds - 1;
      if (secondsLeft > 0) return { ...state, retryAfterSeconds: secondsLeft };
      // The wait is over. A cooldown reopens the control; any other phase keeps
      // its own meaning and merely drops the countdown.
      return {
        ...state,
        retryAfterSeconds: null,
        phase: state.phase === "cooldown" ? "ready" : state.phase,
      };
    }
    case "dismiss_error":
      return { ...state, phase: "ready", error: null };
    default:
      return state;
  }
}
