/**
 * Trading Journal storage (Phase D4-B) — the only module that touches Web
 * Storage. Browser-local `localStorage`, following the report store precedent
 * (DD-266): losing the user's WORK is not acceptable, so it must survive closing
 * the tab. Nothing is sent anywhere; there is no server, no broker sync.
 *
 * Key: `ata.tools.trading-journal.v1`. Version 1.
 *
 * Every read is defensive. Storage can be unavailable (SSR, private mode, quota)
 * and its contents corrupt or hostile; none of that may break the route. A read
 * that fails structurally FAILS CLOSED to an empty canonical state AND reports
 * `corrupt: true`, so the UI can honestly say the local data could not be read
 * instead of pretending there was none. A single malformed ENTRY inside an
 * otherwise valid v1 payload is DROPPED (never partially resurrected as real
 * data) without flagging the whole store corrupt.
 *
 * Writes report failure (`write → false`) so the caller can tell the user the
 * truth: a failed write never claims success and never advances in-memory state.
 *
 * DELIBERATELY NEVER STORED (DD-303): balance, deposit, account/broker id, P/L,
 * profitability, percentage, aggregate, win rate, running total, auth token,
 * arbitrary JSON. Only the fields of `JournalEntry`.
 */

import {
  isJournalDirection,
  isValidOccurredAt,
  JOURNAL_LIMITS,
  type JournalEntry,
} from "@/features/tools/model/journal-entry";

export const TRADING_JOURNAL_STORAGE_KEY = "ata.tools.trading-journal.v1";
export const TRADING_JOURNAL_VERSION = 1;

export interface TradingJournalStateV1 {
  version: 1;
  /** Monotonic id counter — never a financial total. */
  sequence: number;
  entries: JournalEntry[];
}

export interface JournalReadResult {
  state: TradingJournalStateV1;
  /** True when a present payload could not be read (damage / tampering). */
  corrupt: boolean;
}

export function emptyTradingJournalState(): TradingJournalStateV1 {
  return { version: TRADING_JOURNAL_VERSION, sequence: 0, entries: [] };
}

/* ------------------------------------------------------------------ *
 * Pure state transitions — return new state, never mutate
 * ------------------------------------------------------------------ */

/** The id the next created entry will carry. Derived from the sequence. */
export function nextEntryId(state: TradingJournalStateV1): string {
  return `journal-${state.sequence + 1}`;
}

/** Add a fully-built entry, advancing the sequence. Pure. */
export function withEntryAdded(
  state: TradingJournalStateV1,
  entry: JournalEntry,
): TradingJournalStateV1 {
  return {
    version: TRADING_JOURNAL_VERSION,
    sequence: state.sequence + 1,
    entries: [...state.entries, entry],
  };
}

/** Replace an existing entry by id (edit). Sequence unchanged. No-op if absent. */
export function withEntryReplaced(
  state: TradingJournalStateV1,
  entry: JournalEntry,
): TradingJournalStateV1 {
  if (!state.entries.some((e) => e.id === entry.id)) return state;
  return {
    version: TRADING_JOURNAL_VERSION,
    sequence: state.sequence,
    entries: state.entries.map((e) => (e.id === entry.id ? entry : e)),
  };
}

/* ------------------------------------------------------------------ *
 * Parsing — never throws, never returns junk
 * ------------------------------------------------------------------ */

function readText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+$/u, "");
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Normalise one stored entry. Returns null when the entry is malformed — the
 * REQUIRED fields must all be present and valid; a broken entry is dropped whole,
 * never patched into fake data. `manualResult` must be a finite number or null;
 * anything else (NaN, Infinity, string) drops the entry rather than the value,
 * because a corrupted result is not a trustworthy record.
 */
function normaliseEntry(value: unknown): JournalEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (!isValidOccurredAt(record.occurredAt)) return null;
  if (!isJournalDirection(record.direction)) return null;

  const instrument = readText(record.instrument, JOURNAL_LIMITS.instrument);
  if (instrument.length === 0) return null;
  const plan = readText(record.plan, JOURNAL_LIMITS.plan);
  if (plan.length === 0) return null;
  const execution = readText(record.execution, JOURNAL_LIMITS.execution);
  if (execution.length === 0) return null;
  const lesson = readText(record.lesson, JOURNAL_LIMITS.lesson);
  if (lesson.length === 0) return null;

  // Optional result: present → must be a finite number; null/absent → null.
  let manualResult: number | null = null;
  if (record.manualResult !== undefined && record.manualResult !== null) {
    if (typeof record.manualResult !== "number" || !Number.isFinite(record.manualResult)) {
      return null;
    }
    manualResult = record.manualResult;
  }

  const createdAt = isValidOccurredAt(record.createdAt)
    ? new Date(record.createdAt as string).toISOString()
    : new Date(record.occurredAt as string).toISOString();
  const updatedAt = isValidOccurredAt(record.updatedAt)
    ? new Date(record.updatedAt as string).toISOString()
    : createdAt;

  return {
    id: record.id,
    occurredAt: new Date(record.occurredAt as string).toISOString(),
    instrument,
    direction: record.direction,
    setup: readText(record.setup, JOURNAL_LIMITS.setup),
    plan,
    execution,
    lesson,
    manualResult,
    createdAt,
    updatedAt,
  };
}

/**
 * Parse a raw v1 string. NEVER throws and never returns junk. Root-level damage
 * (bad JSON, non-object, damaged v1 shape) fails closed to empty AND flags
 * `corrupt: true`. An unknown/unsupported `version` fails closed to empty but is
 * NOT flagged corrupt (a fresh, silent start). Malformed or duplicate-id entries
 * inside a valid v1 root are dropped individually.
 */
export function parseTradingJournal(raw: string | null | undefined): JournalReadResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { state: emptyTradingJournalState(), corrupt: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: emptyTradingJournalState(), corrupt: true };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { state: emptyTradingJournalState(), corrupt: true };
  }

  const record = parsed as Record<string, unknown>;

  // Unknown version → empty, not corrupt (unsupported, not damaged).
  if (record.version !== TRADING_JOURNAL_VERSION) {
    return { state: emptyTradingJournalState(), corrupt: false };
  }

  // Damaged v1 shape → corrupt.
  if (!Array.isArray(record.entries)) {
    return { state: emptyTradingJournalState(), corrupt: true };
  }
  if (typeof record.sequence !== "number" || !Number.isInteger(record.sequence) || record.sequence < 0) {
    return { state: emptyTradingJournalState(), corrupt: true };
  }

  const seen = new Set<string>();
  const entries: JournalEntry[] = [];
  for (const item of record.entries) {
    const entry = normaliseEntry(item);
    if (!entry) continue;
    if (seen.has(entry.id)) continue; // duplicate id → keep first, drop the rest
    seen.add(entry.id);
    entries.push(entry);
  }

  // Keep the sequence at least past the highest observed entry ordinal so a new
  // id can never collide with a surviving one, even after dropped entries.
  let sequence = record.sequence;
  for (const entry of entries) {
    const match = /^journal-(\d+)$/.exec(entry.id);
    if (match) sequence = Math.max(sequence, Number(match[1]));
  }

  return {
    state: { version: TRADING_JOURNAL_VERSION, sequence, entries },
    corrupt: false,
  };
}

/** Serialise. Only known fields are written — never any financial aggregate. */
export function serializeTradingJournal(state: TradingJournalStateV1): string {
  return JSON.stringify({
    version: TRADING_JOURNAL_VERSION,
    sequence: state.sequence,
    entries: state.entries.map((entry) => ({
      id: entry.id,
      occurredAt: entry.occurredAt,
      instrument: entry.instrument,
      direction: entry.direction,
      setup: entry.setup,
      plan: entry.plan,
      execution: entry.execution,
      lesson: entry.lesson,
      manualResult: entry.manualResult,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
  });
}

/** Serialise a read result for a stable-by-value external-store snapshot. */
export function serializeReadResult(result: JournalReadResult): string {
  return JSON.stringify({ corrupt: result.corrupt, state: result.state });
}

export function deserializeReadResult(raw: string): JournalReadResult {
  const parsed = JSON.parse(raw) as JournalReadResult;
  return parsed;
}

/* ------------------------------------------------------------------ *
 * Store ports — the only place localStorage is touched
 * ------------------------------------------------------------------ */

export interface TradingJournalStore {
  read(): JournalReadResult;
  /** True when the write actually landed. False means the UI must say so. */
  write(state: TradingJournalStateV1): boolean;
  readonly durable: boolean;
}

export class BrowserLocalJournalStore implements TradingJournalStore {
  readonly durable = true;
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  read(): JournalReadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(TRADING_JOURNAL_STORAGE_KEY);
    } catch {
      // Reading itself failed (blocked storage) — no data we can trust, but this
      // is unavailability, not on-disk corruption.
      return { state: emptyTradingJournalState(), corrupt: false };
    }
    return parseTradingJournal(raw);
  }

  write(state: TradingJournalStateV1): boolean {
    try {
      // The full value is built before touching storage: a serialisation problem
      // can never leave a half-written record behind.
      const payload = serializeTradingJournal(state);
      this.storage.setItem(TRADING_JOURNAL_STORAGE_KEY, payload);
      return true;
    } catch {
      // Quota, blocked origin, private mode. Never throw into the render tree,
      // never claim success.
      return false;
    }
  }
}

/** In-memory store: the server, and any test that wants no browser. */
export class MemoryJournalStore implements TradingJournalStore {
  readonly durable = false;
  private raw: string | null = null;

  read(): JournalReadResult {
    return parseTradingJournal(this.raw);
  }

  write(state: TradingJournalStateV1): boolean {
    this.raw = serializeTradingJournal(state);
    return true;
  }
}

function isUsableStorage(value: unknown): value is Storage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Storage>;
  return (
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  );
}

/**
 * The store for the current environment. On the server there is no localStorage,
 * so this returns an in-memory store and the server renders the empty default;
 * the client re-resolves after hydration with no mismatch.
 */
export function createTradingJournalStore(): TradingJournalStore {
  if (typeof window === "undefined") return new MemoryJournalStore();
  try {
    const storage = window.localStorage;
    if (!isUsableStorage(storage)) return new MemoryJournalStore();
    return new BrowserLocalJournalStore(storage);
  } catch {
    return new MemoryJournalStore();
  }
}
