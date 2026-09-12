/**
 * Deterministic time abstraction. Fixtures and the derivation layer never read
 * the real wall clock — they compute all relative state against a Clock.
 * Source of truth for the fixed reference instant: MOCK_NOW below.
 */
import type { ISODateString } from "@/domain/shared/primitives";

export interface Clock {
  /** Current instant as epoch milliseconds. */
  nowMs(): number;
  /** Current instant as an ISO-8601 string (UTC). */
  nowIso(): ISODateString;
}

/** Real system clock — used in production / live runtime. */
export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
  nowIso(): ISODateString {
    return new Date().toISOString();
  }
}

/**
 * The single fixed reference instant for all synthetic data and tests.
 * Chosen to sit inside the project timeline (see ARCHITECTURE.md).
 */
export const MOCK_NOW: ISODateString = "2026-07-13T09:00:00.000Z";

/** Fixed clock anchored to MOCK_NOW (or a supplied override) for determinism. */
export class FixedMockClock implements Clock {
  private readonly fixedMs: number;

  constructor(iso: ISODateString = MOCK_NOW) {
    this.fixedMs = new Date(iso).getTime();
  }

  nowMs(): number {
    return this.fixedMs;
  }
  nowIso(): ISODateString {
    return new Date(this.fixedMs).toISOString();
  }
}

/* --------------------------- relative-time helpers --------------------------- */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** ISO string for an instant N minutes before the clock's now. */
export function minutesAgo(clock: Clock, n: number): ISODateString {
  return new Date(clock.nowMs() - n * MINUTE_MS).toISOString();
}
export function hoursAgo(clock: Clock, n: number): ISODateString {
  return new Date(clock.nowMs() - n * HOUR_MS).toISOString();
}
export function daysAgo(clock: Clock, n: number): ISODateString {
  return new Date(clock.nowMs() - n * DAY_MS).toISOString();
}
export function hoursFromNow(clock: Clock, n: number): ISODateString {
  return new Date(clock.nowMs() + n * HOUR_MS).toISOString();
}
export function daysFromNow(clock: Clock, n: number): ISODateString {
  return new Date(clock.nowMs() + n * DAY_MS).toISOString();
}

/** Whole hours between an ISO instant and the clock's now (positive = in the past). */
export function hoursSince(clock: Clock, iso: ISODateString | null): number | null {
  if (!iso) return null;
  return (clock.nowMs() - new Date(iso).getTime()) / HOUR_MS;
}
export function daysSince(clock: Clock, iso: ISODateString | null): number | null {
  const h = hoursSince(clock, iso);
  return h === null ? null : h / 24;
}
/** Whole hours until an ISO instant (positive = in the future, negative = passed). */
export function hoursUntil(clock: Clock, iso: ISODateString | null): number | null {
  if (!iso) return null;
  return (new Date(iso).getTime() - clock.nowMs()) / HOUR_MS;
}
