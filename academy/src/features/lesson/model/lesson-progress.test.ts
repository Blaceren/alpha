import { describe, it, expect } from "vitest";
import {
  createMediaState,
  hasReachedThreshold,
  mediaProgressState,
  pause,
  play,
  seek,
  stateAtVerifiedPercent,
  tick,
  toggleCaptions,
  toggleMuted,
  togglePlay,
  watchProgressPercent,
} from "@/features/lesson/model/lesson-progress";

const DURATION = 480; // 8:00 — the level 18 fixture length
const THRESHOLD = 50;

/** Play `seconds` of contiguous playback from the current position. */
function watch(state: ReturnType<typeof createMediaState>, seconds: number) {
  let next = play(state);
  for (let i = 0; i < seconds; i += 1) next = tick(next, 1);
  return next;
}

describe("watch progress — clamping and derivation", () => {
  it("starts at zero and reports not_started", () => {
    const state = createMediaState(DURATION);
    expect(watchProgressPercent(state)).toBe(0);
    expect(mediaProgressState(state, THRESHOLD)).toBe("not_started");
  });

  it("clamps progress into 0–100 and never exceeds 100", () => {
    const over = createMediaState(DURATION, { maxVerifiedWatchedPosition: 99_999 });
    expect(watchProgressPercent(over)).toBe(100);

    const under = createMediaState(DURATION, { maxVerifiedWatchedPosition: -50 });
    expect(watchProgressPercent(under)).toBe(0);
  });

  it("collapses non-finite input to zero rather than producing NaN", () => {
    const broken = createMediaState(DURATION, { maxVerifiedWatchedPosition: Number.NaN });
    expect(watchProgressPercent(broken)).toBe(0);
  });

  it("never lets the playhead leave the media", () => {
    const state = createMediaState(DURATION);
    expect(seek(state, 10_000).currentPosition).toBe(DURATION);
    expect(seek(state, -10).currentPosition).toBe(0);
  });
});

describe("the 50% gate", () => {
  it("stays locked at 49.99%", () => {
    const state = stateAtVerifiedPercent(DURATION, 49.99);
    expect(watchProgressPercent(state)).toBeCloseTo(49.99, 5);
    expect(hasReachedThreshold(state, THRESHOLD)).toBe(false);
    expect(mediaProgressState(state, THRESHOLD)).toBe("watching");
  });

  it("stays locked at exactly 49%", () => {
    const state = stateAtVerifiedPercent(DURATION, 49);
    expect(hasReachedThreshold(state, THRESHOLD)).toBe(false);
  });

  it("unlocks at exactly 50% — the threshold is inclusive", () => {
    const state = stateAtVerifiedPercent(DURATION, 50);
    expect(watchProgressPercent(state)).toBe(50);
    expect(hasReachedThreshold(state, THRESHOLD)).toBe(true);
    expect(mediaProgressState(state, THRESHOLD)).toBe("threshold_reached");
  });

  it("does not require a full watch — 50% is enough, 100% is not demanded", () => {
    const half = watch(createMediaState(DURATION), DURATION / 2);
    expect(hasReachedThreshold(half, THRESHOLD)).toBe(true);
    expect(watchProgressPercent(half)).toBeLessThan(100);
  });

  it("reports watched_beyond_threshold past the gate", () => {
    const state = stateAtVerifiedPercent(DURATION, 60);
    expect(mediaProgressState(state, THRESHOLD)).toBe("watched_beyond_threshold");
  });
});

describe("the verified frontier is monotonic", () => {
  it("does not drop when the user rewinds", () => {
    const watched = watch(createMediaState(DURATION), 300);
    const before = watchProgressPercent(watched);

    const rewound = seek(watched, 10);
    expect(rewound.currentPosition).toBe(10);
    expect(watchProgressPercent(rewound)).toBe(before);
    expect(rewound.maxVerifiedWatchedPosition).toBe(watched.maxVerifiedWatchedPosition);
  });

  it("does not double-count re-watching an already verified span", () => {
    const watched = watch(createMediaState(DURATION), 300);
    const again = watch(seek(watched, 0), 100);
    expect(again.maxVerifiedWatchedPosition).toBe(watched.maxVerifiedWatchedPosition);
  });

  it("keeps progress after rewinding and playing forward again", () => {
    const watched = watch(createMediaState(DURATION), 240);
    const replayed = watch(seek(watched, 100), 60);
    // 100 + 60 = 160 < 240, so the frontier must stay at 240.
    expect(replayed.maxVerifiedWatchedPosition).toBe(240);
    expect(hasReachedThreshold(replayed, THRESHOLD)).toBe(true);
  });
});

describe("seeking cannot fake a watch", () => {
  it("scrubbing to the end does not unlock the assessment", () => {
    const scrubbed = seek(createMediaState(DURATION), DURATION);
    expect(scrubbed.currentPosition).toBe(DURATION);
    expect(watchProgressPercent(scrubbed)).toBe(0);
    expect(hasReachedThreshold(scrubbed, THRESHOLD)).toBe(false);
  });

  it("playing inside a region reached by skipping ahead credits nothing", () => {
    const skipped = seek(createMediaState(DURATION), 400);
    const played = watch(skipped, 60);
    expect(played.currentPosition).toBe(460);
    // The 0–400 span was never watched, so the frontier must not move.
    expect(played.maxVerifiedWatchedPosition).toBe(0);
    expect(hasReachedThreshold(played, THRESHOLD)).toBe(false);
  });

  it("credits playback that resumes contiguously from the frontier", () => {
    const watched = watch(createMediaState(DURATION), 100);
    const resumed = watch(seek(watched, 100), 140);
    expect(resumed.maxVerifiedWatchedPosition).toBe(240);
    expect(hasReachedThreshold(resumed, THRESHOLD)).toBe(true);
  });
});

describe("playback transitions", () => {
  it("ticks only while playing", () => {
    const paused = createMediaState(DURATION);
    expect(tick(paused, 10)).toBe(paused);
    expect(tick(pause(play(paused)), 10).currentPosition).toBe(0);
  });

  it("ignores non-positive and non-finite deltas", () => {
    const playing = play(createMediaState(DURATION));
    expect(tick(playing, 0)).toBe(playing);
    expect(tick(playing, -5)).toBe(playing);
    expect(tick(playing, Number.NaN)).toBe(playing);
  });

  it("ends at the duration and restarts the playhead on replay", () => {
    const ended = watch(createMediaState(DURATION), DURATION);
    expect(ended.playback).toBe("ended");
    expect(watchProgressPercent(ended)).toBe(100);

    const replay = play(ended);
    expect(replay.currentPosition).toBe(0);
    expect(replay.maxVerifiedWatchedPosition).toBe(DURATION);
  });

  it("toggles play, mute and captions without touching progress", () => {
    const state = watch(createMediaState(DURATION), 60);
    expect(togglePlay(state).playback).toBe("paused");
    expect(toggleMuted(state).muted).toBe(true);
    expect(toggleCaptions(state).captionsOn).toBe(true);
    expect(watchProgressPercent(toggleMuted(state))).toBe(watchProgressPercent(state));
  });
});

describe("determinism", () => {
  it("produces identical state for identical inputs (no clock, no randomness)", () => {
    const a = watch(createMediaState(DURATION), 137);
    const b = watch(createMediaState(DURATION), 137);
    expect(a).toEqual(b);
  });
});
