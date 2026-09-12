/**
 * L4VC-1 — the Academy's view of the Backend checkpoint verification response.
 *
 * The type is a CLOSED shape with no field an amount could occupy, and the
 * guard below rebuilds nothing it does not recognise. If a future Backend ever
 * sent a balance, this client would still never read it — there is nothing here
 * to read it into.
 */

export type CheckpointVerificationState =
  | "verification_unavailable"
  | "ready"
  | "checking"
  | "cooldown"
  | "not_met"
  | "completed";

export type CheckpointVerificationResult = {
  verificationState: CheckpointVerificationState;
  verificationReason: string;
  /** Seconds to wait. A duration, never money. */
  retryAfterSeconds: number | null;
  completed: boolean;
  replayed: boolean;
  level: { levelNumber: number; stableCode: string } | null;
  nextLevelNumber: number | null;
  /** A financial checkpoint is a gate, not an achievement. */
  xpAwarded: number;
  xpTransactionId: number | null;
};

const STATES = new Set<string>([
  "verification_unavailable",
  "ready",
  "checking",
  "cooldown",
  "not_met",
  "completed",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural guard for the `{ data: ... }` envelope the Backend returns. */
export function isCheckpointVerificationEnvelope(
  value: unknown,
): value is { data: CheckpointVerificationResult } {
  if (!isObject(value) || !isObject(value.data)) return false;
  const data = value.data;
  if (typeof data.verificationState !== "string" || !STATES.has(data.verificationState)) {
    return false;
  }
  if (typeof data.verificationReason !== "string") return false;
  if (data.retryAfterSeconds !== null && typeof data.retryAfterSeconds !== "number") return false;
  if (typeof data.completed !== "boolean" || typeof data.replayed !== "boolean") return false;
  if (data.nextLevelNumber !== null && typeof data.nextLevelNumber !== "number") return false;
  if (data.level !== null) {
    if (!isObject(data.level)) return false;
    if (typeof data.level.levelNumber !== "number") return false;
    if (typeof data.level.stableCode !== "string") return false;
  }
  return true;
}

/**
 * Rebuild the result from an allow-list.
 *
 * Deliberately NOT a spread: an unexpected key on the wire is dropped here
 * rather than carried into component state where it could be rendered.
 */
export function checkpointVerificationData(
  raw: { data: CheckpointVerificationResult },
): CheckpointVerificationResult {
  const data = raw.data;
  const retry = data.retryAfterSeconds;
  return {
    verificationState: data.verificationState,
    verificationReason: data.verificationReason,
    retryAfterSeconds:
      typeof retry === "number" && Number.isFinite(retry) && retry > 0 && retry <= 3_600
        ? Math.ceil(retry)
        : null,
    completed: data.completed === true,
    replayed: data.replayed === true,
    level: data.level
      ? { levelNumber: data.level.levelNumber, stableCode: data.level.stableCode }
      : null,
    nextLevelNumber:
      typeof data.nextLevelNumber === "number" ? data.nextLevelNumber : null,
    // Pinned, not copied: a checkpoint awards nothing, so nothing the Backend
    // sent could make this component display a reward.
    xpAwarded: 0,
    xpTransactionId: null,
  };
}
