import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRateLimit,
  peekRateLimit,
  rateLimit,
  rateLimitBucketCountForTests,
  resetRateLimitsForTests,
} from "@/lib/rateLimit";

/* 2026-10-07 audit: sign-in counts wrong passwords, not attempts; a correct one
   clears them; and the limiter's memory is bounded. */
const LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

afterEach(() => {
  resetRateLimitsForTests();
  vi.useRealTimers();
});

describe("peekRateLimit", () => {
  it("asks without counting", () => {
    for (let i = 0; i < 20; i += 1) expect(peekRateLimit("k", LIMIT).allowed).toBe(true);
    expect(rateLimitBucketCountForTests()).toBe(0);
  });

  it("says no once the counted outcomes reach the limit, until the window ends", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i += 1) rateLimit("k", LIMIT);
    expect(peekRateLimit("k", LIMIT).allowed).toBe(false);
    vi.advanceTimersByTime(LIMIT.windowMs + 1);
    expect(peekRateLimit("k", LIMIT).allowed).toBe(true);
  });
});

describe("clearRateLimit", () => {
  it("forgets the count", () => {
    for (let i = 0; i < 5; i += 1) rateLimit("k", LIMIT);
    clearRateLimit("k");
    expect(peekRateLimit("k", LIMIT).allowed).toBe(true);
    expect(rateLimitBucketCountForTests()).toBe(0);
  });
});

describe("the limiter's memory", () => {
  it("drops expired keys once it grows", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 6_000; i += 1) rateLimit(`old-${i}`, { limit: 5, windowMs: 1_000 });
    vi.advanceTimersByTime(61_000);
    rateLimit("new", LIMIT);
    expect(rateLimitBucketCountForTests()).toBe(1);
  });

  it("never holds more than its cap, however many live keys arrive", () => {
    for (let i = 0; i < 50_050; i += 1) rateLimit(`live-${i}`, LIMIT);
    expect(rateLimitBucketCountForTests()).toBeLessThanOrEqual(50_000);
    // The newest key is the one kept.
    expect(peekRateLimit("live-50049", LIMIT).remaining).toBe(4);
  });
});
