/**
 * Watch progress semantics (Phase D2B). Pure, deterministic, framework-free.
 *
 * Three values are kept apart on purpose:
 *   - currentPosition            — where the playhead is now (may move backwards);
 *   - maxVerifiedWatchedPosition — the furthest point actually PLAYED THROUGH;
 *   - watchProgressPercent       — derived from maxVerifiedWatchedPosition only.
 *
 * The assessment unlock is computed from the verified frontier, never from the
 * playhead, so neither rewinding nor scrubbing to the end can fake it (DD-249):
 *   - rewinding never lowers progress (the frontier is monotonic);
 *   - seeking ahead of the frontier moves the playhead only; playing inside that
 *     unverified region does not extend the frontier, because the skipped span
 *     was never watched.
 *
 * No Date.now(), no Math.random(), no timers here — time is injected as an
 * explicit delta by the caller, so tests and SSR hydration are deterministic.
 */

/** Playback lifecycle of the media itself. */
export type MediaPlaybackState = "idle" | "playing" | "paused" | "ended";

/** Coarse progress phase, derived from the verified frontier vs the threshold. */
export type MediaProgressState =
  | "not_started"
  | "watching"
  | "threshold_reached"
  | "watched_beyond_threshold";

export interface MediaState {
  durationSeconds: number;
  currentPosition: number;
  maxVerifiedWatchedPosition: number;
  playback: MediaPlaybackState;
  muted: boolean;
  captionsOn: boolean;
}

/** Tolerance (seconds) for treating a play span as contiguous with the frontier. */
export const CONTIGUITY_TOLERANCE_SECONDS = 1;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function createMediaState(
  durationSeconds: number,
  overrides: Partial<Pick<MediaState, "currentPosition" | "maxVerifiedWatchedPosition" | "playback" | "muted" | "captionsOn">> = {},
): MediaState {
  const duration = Math.max(1, Math.floor(durationSeconds));
  const verified = clamp(overrides.maxVerifiedWatchedPosition ?? 0, 0, duration);
  return {
    durationSeconds: duration,
    currentPosition: clamp(overrides.currentPosition ?? verified, 0, duration),
    maxVerifiedWatchedPosition: verified,
    playback: overrides.playback ?? "idle",
    muted: overrides.muted ?? false,
    captionsOn: overrides.captionsOn ?? false,
  };
}

/** Verified watch percent, 0–100. Clamped; invalid input collapses to 0. */
export function watchProgressPercent(state: MediaState): number {
  if (state.durationSeconds <= 0) return 0;
  const raw = (state.maxVerifiedWatchedPosition / state.durationSeconds) * 100;
  return clamp(raw, 0, 100);
}

/** Is the assessment unlocked? Threshold is inclusive: exactly 50% unlocks. */
export function hasReachedThreshold(state: MediaState, thresholdPercent: number): boolean {
  return watchProgressPercent(state) >= thresholdPercent;
}

export function mediaProgressState(
  state: MediaState,
  thresholdPercent: number,
): MediaProgressState {
  const percent = watchProgressPercent(state);
  if (percent <= 0) return "not_started";
  if (percent < thresholdPercent) return "watching";
  if (percent === thresholdPercent) return "threshold_reached";
  return "watched_beyond_threshold";
}

/* ------------------------------------------------------------------ *
 * Transitions — each returns a NEW state; none mutate.
 * ------------------------------------------------------------------ */

export function play(state: MediaState): MediaState {
  if (state.playback === "ended") {
    // Replaying from the end restarts the playhead; the frontier is untouched.
    return { ...state, playback: "playing", currentPosition: 0 };
  }
  return { ...state, playback: "playing" };
}

export function pause(state: MediaState): MediaState {
  if (state.playback !== "playing") return state;
  return { ...state, playback: "paused" };
}

export function togglePlay(state: MediaState): MediaState {
  return state.playback === "playing" ? pause(state) : play(state);
}

/**
 * Move the playhead without crediting any watch time. The frontier is left
 * exactly as it was — this is what stops scrubbing from unlocking the test.
 */
export function seek(state: MediaState, position: number): MediaState {
  const next = clamp(position, 0, state.durationSeconds);
  return {
    ...state,
    currentPosition: next,
    playback: state.playback === "ended" && next < state.durationSeconds ? "paused" : state.playback,
  };
}

/**
 * Advance playback by `deltaSeconds`. Only a span that starts at (or within
 * tolerance of) the verified frontier counts as watched — playing inside a
 * region reached by skipping ahead leaves the frontier alone.
 */
export function tick(state: MediaState, deltaSeconds: number): MediaState {
  if (state.playback !== "playing") return state;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return state;

  const from = state.currentPosition;
  const to = clamp(from + deltaSeconds, 0, state.durationSeconds);
  const contiguous = from <= state.maxVerifiedWatchedPosition + CONTIGUITY_TOLERANCE_SECONDS;

  return {
    ...state,
    currentPosition: to,
    maxVerifiedWatchedPosition: contiguous
      ? Math.max(state.maxVerifiedWatchedPosition, to)
      : state.maxVerifiedWatchedPosition,
    playback: to >= state.durationSeconds ? "ended" : "playing",
  };
}

export function toggleMuted(state: MediaState): MediaState {
  return { ...state, muted: !state.muted };
}

export function toggleCaptions(state: MediaState): MediaState {
  return { ...state, captionsOn: !state.captionsOn };
}

/**
 * Build a state whose verified frontier sits at an exact percent — the only way
 * dev scenarios seed watch progress, so `threshold-49` and `threshold-50` are
 * exact rather than approximated by simulated playback.
 */
export function stateAtVerifiedPercent(
  durationSeconds: number,
  percent: number,
  overrides: Partial<Pick<MediaState, "playback" | "muted" | "captionsOn">> = {},
): MediaState {
  const duration = Math.max(1, Math.floor(durationSeconds));
  const verified = clamp((percent / 100) * duration, 0, duration);
  return createMediaState(duration, {
    currentPosition: verified,
    maxVerifiedWatchedPosition: verified,
    ...overrides,
  });
}
