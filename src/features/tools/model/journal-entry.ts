/**
 * Trading Journal entry model (Phase D4-B) — pure types, validation and
 * mutation. No storage, no React, no clock: the clock is injected at the edge.
 *
 * A journal entry is the discipline object of the tool: PLAN → EXECUTION →
 * LESSON, with the lesson as the point. The manual result is a SECONDARY,
 * optional per-trade number (DD-303) — never a balance, never aggregated, never
 * a percentage, never bound to an account or broker. Its absence is a normal,
 * complete state (an observation with no entry).
 *
 * DELIBERATELY ABSENT, forever: balance, deposit, account/broker id, P/L,
 * profitability, percentage, aggregate, win rate, running total, Pocket link.
 */

export type JournalDirection = "buy" | "sell" | "observation";

export interface JournalEntry {
  id: string;
  /** ISO-8601 timestamp of when the trade / decision happened. */
  occurredAt: string;
  instrument: string;
  direction: JournalDirection;
  /** Optional setup / idea. May be empty. */
  setup: string;
  plan: string;
  execution: string;
  /** The point of the entry — the lesson. Required. */
  lesson: string;
  /**
   * Optional manual per-trade result. Finite number or null. Positive, negative
   * or zero are all valid; null (no value) is a normal, complete state.
   */
  manualResult: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Human RU label for a direction. State is never conveyed by colour alone. */
export const DIRECTION_LABEL: Record<JournalDirection, string> = {
  buy: "Покупка",
  sell: "Продажа",
  observation: "Наблюдение / без входа",
};

export function isJournalDirection(value: unknown): value is JournalDirection {
  return value === "buy" || value === "sell" || value === "observation";
}

/** Bounded string limits, aligned with the report workspace (MAX_FIELD_LENGTH). */
export const JOURNAL_LIMITS = {
  instrument: 60,
  setup: 400,
  plan: 2000,
  execution: 2000,
  lesson: 2000,
} as const;

/**
 * The raw form input. `manualResult` arrives as the user's string (or null when
 * the field is untouched); validation parses it. Everything else is a string.
 */
export interface JournalEntryInput {
  occurredAt: string;
  instrument: string;
  direction: string;
  setup: string;
  plan: string;
  execution: string;
  lesson: string;
  /** The user's raw text for the optional result, or null/"" for "not given". */
  manualResult: string | null;
}

/** One field key that can carry a validation error. */
export type JournalFieldError =
  | "occurredAt"
  | "instrument"
  | "direction"
  | "plan"
  | "execution"
  | "lesson"
  | "manualResult";

export type JournalFieldErrors = Partial<Record<JournalFieldError, string>>;

export interface NormalizedJournalInput {
  occurredAt: string;
  instrument: string;
  direction: JournalDirection;
  setup: string;
  plan: string;
  execution: string;
  lesson: string;
  manualResult: number | null;
}

export type JournalValidation =
  | { ok: true; value: NormalizedJournalInput }
  | { ok: false; errors: JournalFieldErrors };

function clamp(value: string, max: number): string {
  const trimmed = value.replace(/\s+$/u, "");
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** A valid ISO-8601 timestamp (accepts a `datetime-local`-style value too). */
export function isValidOccurredAt(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time);
}

/**
 * Parse the manual-result field. Empty / null → null (absence is normal). A
 * non-finite or non-numeric value is an ERROR — it must never become data.
 */
function parseManualResult(
  raw: string | null,
): { ok: true; value: number | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  // Reject grouping, currency, percent — a plain signed decimal only.
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

/**
 * Validate + normalise raw input. Required, non-whitespace: occurredAt,
 * instrument, direction, plan, execution, lesson. `setup` and `manualResult`
 * are optional. Never accepts a whitespace-only required field.
 */
export function validateJournalInput(input: JournalEntryInput): JournalValidation {
  const errors: JournalFieldErrors = {};

  if (!isValidOccurredAt(input.occurredAt)) {
    errors.occurredAt = "Укажите дату и время сделки.";
  }
  const instrument = clamp(input.instrument.trim(), JOURNAL_LIMITS.instrument);
  if (instrument.length === 0) {
    errors.instrument = "Укажите инструмент.";
  }
  if (!isJournalDirection(input.direction)) {
    errors.direction = "Выберите направление.";
  }
  const plan = clamp(input.plan.trim(), JOURNAL_LIMITS.plan);
  if (plan.length === 0) {
    errors.plan = "Опишите план.";
  }
  const execution = clamp(input.execution.trim(), JOURNAL_LIMITS.execution);
  if (execution.length === 0) {
    errors.execution = "Опишите исполнение.";
  }
  const lesson = clamp(input.lesson.trim(), JOURNAL_LIMITS.lesson);
  if (lesson.length === 0) {
    errors.lesson = "Запишите вывод — это главное в записи.";
  }
  const result = parseManualResult(input.manualResult);
  if (!result.ok) {
    errors.manualResult = "Результат — простое число (например 18 или −7) или пусто.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      occurredAt: new Date(input.occurredAt).toISOString(),
      instrument,
      direction: input.direction as JournalDirection,
      setup: clamp(input.setup.trim(), JOURNAL_LIMITS.setup),
      plan,
      execution,
      lesson,
      manualResult: result.ok ? result.value : null,
    },
  };
}

/** Build a new entry from validated input. Pure — id + clock injected at edge. */
export function buildJournalEntry(
  value: NormalizedJournalInput,
  id: string,
  now: string,
): JournalEntry {
  return { ...value, id, createdAt: now, updatedAt: now };
}

/** Apply an edit to an existing entry. `updatedAt` bumps; `createdAt`/`id` stay. */
export function applyJournalEdit(
  existing: JournalEntry,
  value: NormalizedJournalInput,
  now: string,
): JournalEntry {
  return {
    ...existing,
    ...value,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
}

/**
 * Sort for display: newest `occurredAt` first, stable tie-break by id. Pure and
 * total — never throws on a malformed date (already filtered by the parser).
 */
export function sortJournalEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => {
    const byTime = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}
