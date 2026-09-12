/**
 * Report draft — shape, parsing, normalisation and the readiness rule (D3-B).
 * Pure and deterministic: no I/O, no Date.now(), no Math.random(). Storage lives
 * in `report-store.ts`, so every parse path is unit-testable without a browser.
 *
 * WHAT THIS IS: the honest browser-local record of a report the user is writing.
 *
 * WHAT THIS IS NOT: backend persistence. Nothing here is sent anywhere, nothing
 * is synced, and no mentor sees it. `pending-review` means exactly «the user
 * marked this as submitted in this browser» and nothing more (DD-265, DD-266).
 *
 * Deliberately NOT stored, ever: XP, balances, deposits, any financial value,
 * trading results, secrets, scenario keys, navigation state.
 */

import { parseLevelCode, levelCodeFor } from "@/features/lesson/model/lesson";
import {
  REQUIRED_ENTRY_FIELD,
  isReportLevelNumber,
  reportEntryId,
  type ReportDefinition,
} from "@/features/report-level/model/report";

/** Versioned key: a schema change gets a new key rather than a silent migration. */
export const REPORT_STORAGE_KEY = "ata.report-workspace.v1";

/** Schema version carried inside the payload; anything else is discarded. */
export const REPORT_STORAGE_VERSION = 1;

/**
 * Upper bound on one field. Not a product rule and never shown as a limit — it
 * exists so a hostile or runaway value cannot fill the origin's storage quota
 * and take the route down with it.
 */
export const MAX_FIELD_LENGTH = 2000;

/**
 * Persisted lifecycle. `ready` is deliberately ABSENT: it is a computed
 * presentation state (see `report-experience.ts`), not a fact worth storing —
 * storing it would let a stale flag disagree with the entries it describes.
 *
 * `approved` / `rejected` / `revision-requested` are absent because they require
 * a mentor verdict that does not exist. A stored value outside this union is
 * treated as forgery and the whole report is dropped.
 */
export type ReportStatus = "draft" | "pending-review";

export interface ReportEntryDraft {
  /** Stable id, e.g. "report.003.entry.1". Internal — never rendered. */
  id: string;
  /** 1-based position, 1…entryCount. */
  ordinal: number;
  when: string;
  decided: string;
  noticed: string;
}

export interface ReportDraft {
  /** The owning level's canonical code — the ONLY identifier (DD-264). */
  levelCode: string;
  entries: ReportEntryDraft[];
  summary: string;
  status: ReportStatus;
  /** ISO timestamp of the local submit. Stored, never rendered as a countdown. */
  submittedAt: string | null;
  /** Monotonic local write counter — makes save ordering deterministic in tests. */
  revision: number;
}

export interface ReportWorkspaceState {
  version: number;
  reports: ReportDraft[];
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

export function emptyReportWorkspace(): ReportWorkspaceState {
  return { version: REPORT_STORAGE_VERSION, reports: [] };
}

export function createEmptyEntries(definition: ReportDefinition): ReportEntryDraft[] {
  return Array.from({ length: definition.entryCount }, (_, index) => ({
    id: reportEntryId(definition.level.number, index + 1),
    ordinal: index + 1,
    when: "",
    decided: "",
    noticed: "",
  }));
}

export function createEmptyDraft(definition: ReportDefinition): ReportDraft {
  return {
    levelCode: definition.level.code,
    entries: createEmptyEntries(definition),
    summary: "",
    status: "draft",
    submittedAt: null,
    revision: 0,
  };
}

/* ------------------------------------------------------------------ *
 * Readiness — a PROTOTYPE-ONLY structural rule, not a rubric
 * ------------------------------------------------------------------ */

/**
 * An entry counts as filled when its single required field carries text.
 * `when` and `decided` are optional context: requiring them would be inventing a
 * rubric the curriculum does not have.
 */
export function isEntryFilled(entry: ReportEntryDraft): boolean {
  return entry[REQUIRED_ENTRY_FIELD].trim().length > 0;
}

/**
 * What the readiness rule actually reads: the content, not the lifecycle.
 * Structural on purpose — the v2 draft (D3-C) satisfies it too, and readiness
 * stays ONE rule across schema versions instead of two copies.
 */
export interface ReportContent {
  entries: ReportEntryDraft[];
  summary: string;
}

export function filledEntryCount(draft: ReportContent): number {
  return draft.entries.filter(isEntryFilled).length;
}

export function hasSummary(draft: ReportContent): boolean {
  return draft.summary.trim().length > 0;
}

/**
 * The readiness rule.
 *
 * This is a PROTOTYPE-ONLY structural check: every evidence entry carries an
 * observation, and the closing reflection exists. It is explicitly NOT a mentor
 * rubric, NOT a trading evaluation, NOT a measure of the report's quality, and
 * NOT a promise of approval (DD-268, DD-272). It answers one question only:
 * «is there something to review?»
 */
export function isReportReady(draft: ReportContent): boolean {
  return draft.entries.every(isEntryFilled) && hasSummary(draft);
}

/* ------------------------------------------------------------------ *
 * Mutation — pure, returns new records
 * ------------------------------------------------------------------ */

function clampText(value: string): string {
  return value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value;
}

/** Edits are refused once submitted: pending is read-only by construction, not
 *  merely by a disabled attribute a caller could forget. */
export function withEntryField(
  draft: ReportDraft,
  ordinal: number,
  key: "when" | "decided" | "noticed",
  value: string,
): ReportDraft {
  if (draft.status !== "draft") return draft;
  const target = draft.entries.find((entry) => entry.ordinal === ordinal);
  if (!target) return draft;

  const entries = draft.entries.map((entry) =>
    entry.ordinal === ordinal ? { ...entry, [key]: clampText(value) } : entry,
  );
  return { ...draft, entries, revision: draft.revision + 1 };
}

export function withSummary(draft: ReportDraft, value: string): ReportDraft {
  if (draft.status !== "draft") return draft;
  return { ...draft, summary: clampText(value), revision: draft.revision + 1 };
}

/**
 * Mark the report as submitted — LOCALLY. Refused unless the readiness rule is
 * satisfied, so a `pending-review` record can never describe an unfinished
 * report. `submittedAt` is injected, never read from a clock here, so the model
 * stays deterministic.
 */
export function withSubmitted(draft: ReportDraft, submittedAt: string): ReportDraft {
  if (draft.status !== "draft") return draft;
  if (!isReportReady(draft)) return draft;
  return {
    ...draft,
    status: "pending-review",
    submittedAt,
    revision: draft.revision + 1,
  };
}

/* ------------------------------------------------------------------ *
 * Workspace access
 * ------------------------------------------------------------------ */

export function getStoredDraft(
  state: ReportWorkspaceState,
  levelNumber: number,
): ReportDraft | null {
  const code = levelCodeFor(levelNumber);
  return state.reports.find((report) => report.levelCode === code) ?? null;
}

export function withDraft(
  state: ReportWorkspaceState,
  draft: ReportDraft,
): ReportWorkspaceState {
  const others = state.reports.filter((report) => report.levelCode !== draft.levelCode);
  return {
    version: REPORT_STORAGE_VERSION,
    reports: [...others, draft].sort((a, b) => a.levelCode.localeCompare(b.levelCode)),
  };
}

/* ------------------------------------------------------------------ *
 * Parsing — never throws, never returns junk
 * ------------------------------------------------------------------ */

function readText(value: unknown): string {
  return typeof value === "string" ? clampText(value) : "";
}

function readStatus(value: unknown): ReportStatus | null {
  return value === "draft" || value === "pending-review" ? value : null;
}

/**
 * Rebuild the entry list from the definition, filling from whatever was stored.
 *
 * This normalises rather than trusts: a payload with 4, 6 or 0 entries, with
 * shuffled ordinals, forged ids or extra properties still yields exactly
 * `entryCount` canonical entries. Unknown fields do not survive the round trip.
 */
function normaliseEntries(value: unknown, definition: ReportDefinition): ReportEntryDraft[] {
  const stored = Array.isArray(value) ? value : [];

  const byOrdinal = new Map<number, Record<string, unknown>>();
  for (const item of stored) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const ordinal = record.ordinal;
    if (typeof ordinal !== "number" || !Number.isInteger(ordinal)) continue;
    if (ordinal < 1 || ordinal > definition.entryCount) continue;
    if (!byOrdinal.has(ordinal)) byOrdinal.set(ordinal, record);
  }

  return createEmptyEntries(definition).map((empty) => {
    const record = byOrdinal.get(empty.ordinal);
    if (!record) return empty;
    return {
      // The id is REGENERATED, never taken from storage: it is derived data, and
      // accepting a stored id would let a payload rename an entry.
      id: empty.id,
      ordinal: empty.ordinal,
      when: readText(record.when),
      decided: readText(record.decided),
      noticed: readText(record.noticed),
    };
  });
}

/**
 * Normalise one stored report. Returns null when the record cannot be trusted —
 * the caller drops it, which is always the safe direction: a missing report
 * means an empty draft, and an empty draft opens nothing.
 */
function normaliseReport(
  value: unknown,
  resolveDefinition: (levelNumber: number) => ReportDefinition | null,
): ReportDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const levelCode = record.levelCode;
  if (typeof levelCode !== "string") return null;

  const levelNumber = parseLevelCode(levelCode);
  if (levelNumber === null) return null;

  // A report stored against a level the curriculum does not call a report is
  // discarded outright — it can only be stale data or tampering.
  if (!isReportLevelNumber(levelNumber)) return null;

  const definition = resolveDefinition(levelNumber);
  if (!definition) return null;

  // An unknown status ("approved", "rejected", anything else) is a forgery
  // attempt or a schema drift. Either way we refuse the record rather than
  // downgrade it: a fabricated verdict must never reach the UI.
  const status = readStatus(record.status);
  if (status === null) return null;

  const entries = normaliseEntries(record.entries, definition);
  const summary = readText(record.summary);
  const revisionValue = record.revision;
  const revision =
    typeof revisionValue === "number" && Number.isInteger(revisionValue) && revisionValue >= 0
      ? revisionValue
      : 0;

  const draft: ReportDraft = {
    levelCode: definition.level.code,
    entries,
    summary,
    status,
    submittedAt: typeof record.submittedAt === "string" ? record.submittedAt : null,
    revision,
  };

  // A `pending-review` record that does not satisfy the readiness rule could not
  // have been produced by `withSubmitted`. Rather than lock the user out of
  // their own unfinished work, we hand back the editable draft — the honest
  // reading is "this was never really submitted".
  if (draft.status === "pending-review" && !isReportReady(draft)) {
    return { ...draft, status: "draft", submittedAt: null };
  }

  return draft;
}

/**
 * Parse a raw stored string. NEVER throws and never returns junk: corrupt JSON,
 * a wrong shape, an unknown version, a forged status or poisoned entries all
 * collapse to an empty workspace. A tampered value can only ever cost the user
 * their draft — it can never unlock a level or fabricate a verdict.
 */
export function parseReportWorkspace(
  raw: string | null | undefined,
  resolveDefinition: (levelNumber: number) => ReportDefinition | null,
): ReportWorkspaceState {
  if (typeof raw !== "string" || raw.length === 0) return emptyReportWorkspace();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyReportWorkspace();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptyReportWorkspace();
  }

  const record = parsed as Record<string, unknown>;
  if (record.version !== REPORT_STORAGE_VERSION) return emptyReportWorkspace();
  if (!Array.isArray(record.reports)) return emptyReportWorkspace();

  const seen = new Set<string>();
  const reports: ReportDraft[] = [];
  for (const item of record.reports) {
    const draft = normaliseReport(item, resolveDefinition);
    if (!draft) continue;
    if (seen.has(draft.levelCode)) continue;
    seen.add(draft.levelCode);
    reports.push(draft);
  }

  return {
    version: REPORT_STORAGE_VERSION,
    reports: reports.sort((a, b) => a.levelCode.localeCompare(b.levelCode)),
  };
}

/** Serialise. Only known fields are written — the payload cannot grow by echo. */
export function serializeReportWorkspace(state: ReportWorkspaceState): string {
  return JSON.stringify({
    version: REPORT_STORAGE_VERSION,
    reports: state.reports.map((report) => ({
      levelCode: report.levelCode,
      entries: report.entries.map((entry) => ({
        id: entry.id,
        ordinal: entry.ordinal,
        when: entry.when,
        decided: entry.decided,
        noticed: entry.noticed,
      })),
      summary: report.summary,
      status: report.status,
      submittedAt: report.submittedAt,
      revision: report.revision,
    })),
  });
}
