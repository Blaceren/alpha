/**
 * Report level domain types (Phase D3-B). Pure types — no UI, no I/O, no storage.
 *
 * Division of ownership follows the DD-243 precedent set by lessons:
 *   - `src/data/curriculum/fixture.ts` stays the canon for level number, module,
 *     title, kind, artifact and sequence;
 *   - this feature owns only what a REPORT needs on top of that: how many
 *     evidence entries the artifact implies and what the fields are called.
 *
 * The field structure below is PROTOTYPE-ONLY editorial structure, NOT canonical
 * trading methodology (DD-268). The curriculum fixture carries no task text for
 * level 3 — only the artifact name — so no canonical instructions are invented
 * here; the UI says «Структура задания уточняется редакцией» instead.
 *
 * Deliberately absent from the entry model, and never to be added here without a
 * product decision: asset, trade amount, profit/loss, entry price, exit price,
 * volume, leverage, win/loss, any financial evaluation of the result, any
 * trading recommendation. This is a learning artifact, not a trading record.
 */

import { CURRICULUM } from "@/data/curriculum/fixture";
import type { CurriculumLevel } from "@/domain/curriculum";

/* ------------------------------------------------------------------ *
 * Which levels are reports
 * ------------------------------------------------------------------ */

/**
 * Every curriculum level whose kind is `report`, derived — never hardcoded.
 * Today this is exactly one (level 3); a consistency test pins that, so if the
 * curriculum ever gains a second report level the test fails loudly instead of
 * the product silently mis-rendering it.
 */
export function reportLevelNumbers(): number[] {
  return CURRICULUM.levels.filter((level) => level.kind === "report").map((l) => l.number);
}

export function isReportLevel(level: CurriculumLevel): boolean {
  return level.kind === "report";
}

export function isReportLevelNumber(levelNumber: number): boolean {
  return reportLevelNumbers().includes(levelNumber);
}

/* ------------------------------------------------------------------ *
 * Field structure — PROTOTYPE-ONLY
 * ------------------------------------------------------------------ */

/**
 * The three fields of one evidence entry.
 *
 * `noticed` is the only REQUIRED one (see `report-readiness.ts`): it is the
 * observation the artifact is actually about. `when` and `decided` are optional
 * context — requiring them would be inventing a rubric the curriculum does not
 * have.
 */
export type ReportFieldKey = "when" | "decided" | "noticed";

export interface ReportFieldDefinition {
  key: ReportFieldKey;
  /** RU label. PROTOTYPE-ONLY — not canonical curriculum content (DD-268). */
  label: string;
  /** RU placeholder. PROTOTYPE-ONLY. */
  placeholder: string;
  /** True for the single field the readiness rule looks at. */
  required: boolean;
  /** Long-form fields render as a writing surface rather than a single line. */
  multiline: boolean;
}

export const REPORT_ENTRY_FIELDS: readonly ReportFieldDefinition[] = [
  {
    key: "when",
    label: "Когда",
    placeholder: "Например: среда, вторая половина дня",
    required: false,
    multiline: false,
  },
  {
    key: "decided",
    label: "Что решил",
    placeholder: "Например: дождался условия и вошёл",
    required: false,
    multiline: false,
  },
  {
    key: "noticed",
    label: "Что заметил после сделки",
    placeholder: "Опиши наблюдение своими словами",
    required: true,
    multiline: true,
  },
] as const;

/** The one field the readiness rule requires per entry. */
export const REQUIRED_ENTRY_FIELD: ReportFieldKey = "noticed";

/* ------------------------------------------------------------------ *
 * Report definition
 * ------------------------------------------------------------------ */

export interface ReportDefinition {
  /** The owning curriculum level (from the fixture — never re-titled here). */
  level: CurriculumLevel;
  /** Stable code, e.g. "report.003" — internal only, NEVER a route (DD-264). */
  code: string;
  /** How many evidence entries the artifact implies. */
  entryCount: number;
  /** RU heading of the closing reflection. PROTOTYPE-ONLY. */
  summaryLabel: string;
  /** RU placeholder of the closing reflection. PROTOTYPE-ONLY. */
  summaryPlaceholder: string;
  /** Honest note: the fixture carries no task text (DD-268). */
  editorialNote: string;
}

/** Stable entry id, e.g. "report.003.entry.1". Internal — never rendered. */
export function reportEntryId(levelNumber: number, ordinal: number): string {
  return `report.${String(levelNumber).padStart(3, "0")}.entry.${ordinal}`;
}

/** Internal report code. NOT a route and NOT a second identifier for the level:
 *  the level's own code (`level.003`) remains the only addressable id (DD-264). */
export function reportCodeFor(levelNumber: number): string {
  return `report.${String(levelNumber).padStart(3, "0")}`;
}
