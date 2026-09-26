/**
 * Report workspace v2 (Phase D3-C) — schema, mutation and migration.
 *
 * The schema change (a stored verdict + feedback) gets a NEW key rather than a
 * silent in-place migration (`REPORT_STORAGE.md` §2, DD-285):
 *
 *   v1  ata.report-workspace.v1  — draft | pending-review            (D3-B)
 *   v2  ata.report-workspace.v2  — + revision-requested, review      (D3-C)
 *
 * `report-draft.ts` remains the untouched v1 module: migration reads through its
 * parser, and every v1 fail-closed guarantee keeps holding for legacy data.
 *
 * Two counters, deliberately:
 *   - `revision`            — bumps on EVERY accepted edit; the autosave key.
 *   - `meaningfulRevision`  — bumps only when a field's normalised value
 *     actually changed. The resubmit rule compares THIS against
 *     `review.atRevision`, so a whitespace-only edit still autosaves (the user's
 *     literal text is their text) but does not count as «изменения после
 *     вердикта».
 *
 * Deliberately NOT stored, ever (unchanged from v1): XP, balances, deposits,
 * any financial value, trading results, secrets, scenario keys.
 */

import {
  MAX_FIELD_LENGTH,
  createEmptyDraft,
  createEmptyEntries,
  isReportReady,
  parseReportWorkspace,
  type ReportDraft,
  type ReportEntryDraft,
  type ReportWorkspaceState,
} from "@/features/report-level/model/report-draft";
import {
  knownSectionIds,
  type ReportReview,
  type ReportReviewSectionId,
} from "@/features/report-level/model/report-review";
import type { ReportDefinition } from "@/features/report-level/model/report";

/** Versioned key. The v1 key stays untouched on disk — migration never deletes it. */
export const REPORT_STORAGE_KEY_V2 = "ata.report-workspace.v2";

export const REPORT_STORAGE_VERSION_V2 = 2;

/**
 * Persisted lifecycle, v2. `ready`, `editing-revision` and `ready-to-resubmit`
 * are computed presentation states (see `report-experience.ts`) — storing them
 * would let a stale flag disagree with the draft it describes.
 *
 * `approved` / `rejected` still do not exist (DD-287). A stored value outside
 * this union is treated as forgery and the record is refused.
 */
export type ReportStatusV2 = "draft" | "pending-review" | "revision-requested";

export interface ReportDraftV2 extends Omit<ReportDraft, "status"> {
  status: ReportStatusV2;
  /** The verdict of the current iteration, or null before any verdict. */
  review: ReportReview | null;
  /** Content-change counter — see the module header. Internal, never rendered. */
  meaningfulRevision: number;
}

export interface ReportWorkspaceStateV2 {
  version: number;
  reports: ReportDraftV2[];
}

/**
 * What the store accepts for writing: a v2 state, or a legacy v1-shaped state
 * whose records lack the v2 fields (existing tests and callers seed those).
 * Serialisation defaults the missing fields exactly like migration does.
 */
export interface ReportWorkspaceWritable {
  version: number;
  reports: Array<
    Omit<ReportDraft, "status"> & {
      /** v2 status superset — a legacy v1 record's status is a subset of it. */
      status: ReportStatusV2;
      review?: ReportReview | null;
      meaningfulRevision?: number;
    }
  >;
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

export function emptyReportWorkspaceV2(): ReportWorkspaceStateV2 {
  return { version: REPORT_STORAGE_VERSION_V2, reports: [] };
}

export function createEmptyDraftV2(definition: ReportDefinition): ReportDraftV2 {
  return { ...createEmptyDraft(definition), review: null, meaningfulRevision: 0 };
}

/** Widen a legacy or partial record into a full v2 draft (migration defaults). */
function toV2Draft(
  draft: Omit<ReportDraft, "status"> & {
    status: ReportStatusV2;
    review?: ReportReview | null;
    meaningfulRevision?: number;
  },
): ReportDraftV2 {
  return {
    ...draft,
    review: draft.review ?? null,
    // A draft that predates the counter gets its technical revision as the
    // baseline: any later content change moves past it.
    meaningfulRevision: draft.meaningfulRevision ?? draft.revision,
  };
}

/* ------------------------------------------------------------------ *
 * Meaningful change — normalised content, not keystrokes
 * ------------------------------------------------------------------ */

/** Whitespace-insensitive value identity: trim + collapse inner runs. */
export function normalizeFieldValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function clampText(value: string): string {
  return value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value;
}

/** True when the draft's content changed (normalised) since the verdict. */
export function hasChangeSinceReview(draft: ReportDraftV2): boolean {
  return draft.review !== null && draft.meaningfulRevision > draft.review.atRevision;
}

/**
 * The resubmit rule (scope §2): the ordinary readiness rule AND a real content
 * change after the verdict. The flagged sections are attention guidance, NOT a
 * validator — a change in ANY field counts (DD-287).
 */
export function canResubmit(draft: ReportDraftV2): boolean {
  return (
    draft.status === "revision-requested" && isReportReady(draft) && hasChangeSinceReview(draft)
  );
}

/* ------------------------------------------------------------------ *
 * Mutation — pure, returns new records
 * ------------------------------------------------------------------ */

/** The two statuses under which the report is the user's live work. */
function isEditableStatus(status: ReportStatusV2): boolean {
  return status === "draft" || status === "revision-requested";
}

export function withEntryFieldV2(
  draft: ReportDraftV2,
  ordinal: number,
  key: "when" | "decided" | "noticed",
  value: string,
): ReportDraftV2 {
  if (!isEditableStatus(draft.status)) return draft;
  const target = draft.entries.find((entry) => entry.ordinal === ordinal);
  if (!target) return draft;

  const next = clampText(value);
  const changed = normalizeFieldValue(target[key]) !== normalizeFieldValue(next);
  const entries: ReportEntryDraft[] = draft.entries.map((entry) =>
    entry.ordinal === ordinal ? { ...entry, [key]: next } : entry,
  );
  return {
    ...draft,
    entries,
    revision: draft.revision + 1,
    meaningfulRevision: draft.meaningfulRevision + (changed ? 1 : 0),
  };
}

export function withSummaryV2(draft: ReportDraftV2, value: string): ReportDraftV2 {
  if (!isEditableStatus(draft.status)) return draft;
  const next = clampText(value);
  const changed = normalizeFieldValue(draft.summary) !== normalizeFieldValue(next);
  return {
    ...draft,
    summary: next,
    revision: draft.revision + 1,
    meaningfulRevision: draft.meaningfulRevision + (changed ? 1 : 0),
  };
}

/** First submit: unchanged v1 semantics — draft → pending-review, readiness required. */
export function withSubmittedV2(draft: ReportDraftV2, submittedAt: string): ReportDraftV2 {
  if (draft.status !== "draft") return draft;
  if (!isReportReady(draft)) return draft;
  return { ...draft, status: "pending-review", submittedAt, revision: draft.revision + 1 };
}

/**
 * Apply a verdict: pending-review → revision-requested.
 *
 * Only the dev/test adapter calls this (DD-286) — no user action reaches it.
 * There is no `withApproved` and no `withRejected` to call: those verdicts do
 * not exist in D3-C (DD-287). Sections are filtered against the closed set; an
 * empty comment refuses the verdict rather than storing an unusable one.
 * `atRevision` pins the meaningful counter — a verdict is not a content change,
 * so the counters themselves do not move.
 */
export function withRevisionRequested(
  draft: ReportDraftV2,
  definition: ReportDefinition,
  input: { comment: string; sections: ReportReviewSectionId[]; receivedAt: string },
): ReportDraftV2 {
  if (draft.status !== "pending-review") return draft;
  const comment = clampText(input.comment).trim();
  if (comment.length === 0) return draft;

  const known = knownSectionIds(definition);
  const sections = [...new Set(input.sections)].filter((id) => known.has(id));

  return {
    ...draft,
    status: "revision-requested",
    review: { comment, sections, receivedAt: input.receivedAt, atRevision: draft.meaningfulRevision },
    revision: draft.revision + 1,
  };
}

/**
 * Resubmit: revision-requested → pending-review, guarded by `canResubmit`.
 * The review is PRESERVED as the historical context of this iteration — the
 * pending screen may say what was addressed, without turning it back into an
 * active task list.
 */
export function withResubmitted(draft: ReportDraftV2, submittedAt: string): ReportDraftV2 {
  if (!canResubmit(draft)) return draft;
  return { ...draft, status: "pending-review", submittedAt, revision: draft.revision + 1 };
}

/* ------------------------------------------------------------------ *
 * Workspace access
 * ------------------------------------------------------------------ */

export function getStoredDraftV2(
  state: ReportWorkspaceStateV2,
  levelNumber: number,
): ReportDraftV2 | null {
  const code = `level.${String(levelNumber).padStart(3, "0")}`;
  return state.reports.find((report) => report.levelCode === code) ?? null;
}

export function withDraftV2(
  state: ReportWorkspaceStateV2,
  draft: ReportDraftV2,
): ReportWorkspaceStateV2 {
  const others = state.reports.filter((report) => report.levelCode !== draft.levelCode);
  return {
    version: REPORT_STORAGE_VERSION_V2,
    reports: [...others, draft].sort((a, b) => a.levelCode.localeCompare(b.levelCode)),
  };
}

/* ------------------------------------------------------------------ *
 * Parsing — never throws, never returns junk (v1 discipline, v2 schema)
 * ------------------------------------------------------------------ */

function readText(value: unknown): string {
  return typeof value === "string" ? clampText(value) : "";
}

function readCounter(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readStatusV2(value: unknown): ReportStatusV2 | null {
  return value === "draft" || value === "pending-review" || value === "revision-requested"
    ? value
    : null;
}

/**
 * Normalise a stored review. Null means «no usable verdict»: the caller then
 * treats the record as if the verdict never arrived (downgrade to
 * pending-review) — a broken verdict may cost the VERDICT, never the work.
 */
function normaliseReview(value: unknown, definition: ReportDefinition): ReportReview | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const comment = readText(record.comment).trim();
  if (comment.length === 0) return null;
  if (typeof record.receivedAt !== "string") return null;

  const known = knownSectionIds(definition);
  const rawSections = Array.isArray(record.sections) ? record.sections : [];
  // An unknown or forged section id is dropped ALONE — never the user's work.
  const sections = [
    ...new Set(rawSections.filter((id): id is string => typeof id === "string")),
  ].filter((id) => known.has(id));

  return {
    comment,
    sections,
    receivedAt: record.receivedAt,
    atRevision: readCounter(record.atRevision) ?? 0,
  };
}

function normaliseEntriesV2(value: unknown, definition: ReportDefinition): ReportEntryDraft[] {
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
      // Regenerated, never trusted from storage — same rule as v1.
      id: empty.id,
      ordinal: empty.ordinal,
      when: readText(record.when),
      decided: readText(record.decided),
      noticed: readText(record.noticed),
    };
  });
}

function normaliseReportV2(
  value: unknown,
  resolveDefinition: (levelNumber: number) => ReportDefinition | null,
): ReportDraftV2 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const levelCode = record.levelCode;
  if (typeof levelCode !== "string") return null;
  const match = /^level\.(\d{3})$/.exec(levelCode);
  if (!match) return null;
  const levelNumber = Number(match[1]);

  const definition = resolveDefinition(levelNumber);
  if (!definition) return null;
  if (definition.level.code !== levelCode) return null;

  // "approved", "rejected", anything unknown → the record is refused outright:
  // a fabricated verdict must never reach the UI (v1 rule, kept verbatim).
  const status = readStatusV2(record.status);
  if (status === null) return null;

  const entries = normaliseEntriesV2(record.entries, definition);
  const summary = readText(record.summary);
  const revision = readCounter(record.revision) ?? 0;
  // An absent/invalid meaningful counter falls back to the technical one — the
  // safe default migration also uses. A forged large value could only enable the
  // resubmit BUTTON on an unchanged report; it can never unlock a level or
  // fabricate a verdict.
  const meaningfulRevision = readCounter(record.meaningfulRevision) ?? revision;

  let draft: ReportDraftV2 = {
    levelCode: definition.level.code,
    entries,
    summary,
    status,
    submittedAt: typeof record.submittedAt === "string" ? record.submittedAt : null,
    revision,
    meaningfulRevision,
    review: null,
  };

  if (status === "revision-requested") {
    const review = normaliseReview(record.review, definition);
    if (review) {
      draft = { ...draft, review };
    } else {
      // A revision-requested record whose review is unusable: the verdict cannot
      // be trusted, the work can. Fall back to the last trustworthy stored state
      // — pending-review — rather than dropping the user's report.
      draft = { ...draft, status: "pending-review" };
    }
  } else if (record.review !== undefined && record.review !== null) {
    // A review is only meaningful alongside its verdict or after resubmit.
    const review = normaliseReview(record.review, definition);
    if (status === "pending-review" && review) {
      // pending WITH a review = resubmitted iteration; kept as history.
      draft = { ...draft, review };
    }
    // draft + review stays reviewless: a verdict cannot precede a submit.
  }

  // A pending-review record that fails the readiness rule could not have been
  // produced by submit — the honest reading is «it was never submitted» (v1
  // rule). revision-requested is exempt: revision editing may legitimately
  // empty a field.
  if (draft.status === "pending-review" && !isReportReady(draft)) {
    return { ...draft, status: "draft", submittedAt: null, review: null };
  }

  return draft;
}

/**
 * Parse a raw v2 string. NEVER throws and never returns junk; every corrupt or
 * hostile shape collapses to an empty workspace. A tampered value can only cost
 * the user their draft — never unlock a level, never fabricate a verdict.
 */
export function parseReportWorkspaceV2(
  raw: string | null | undefined,
  resolveDefinition: (levelNumber: number) => ReportDefinition | null,
): ReportWorkspaceStateV2 {
  if (typeof raw !== "string" || raw.length === 0) return emptyReportWorkspaceV2();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyReportWorkspaceV2();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptyReportWorkspaceV2();
  }

  const record = parsed as Record<string, unknown>;
  if (record.version !== REPORT_STORAGE_VERSION_V2) return emptyReportWorkspaceV2();
  if (!Array.isArray(record.reports)) return emptyReportWorkspaceV2();

  const seen = new Set<string>();
  const reports: ReportDraftV2[] = [];
  for (const item of record.reports) {
    const draft = normaliseReportV2(item, resolveDefinition);
    if (!draft) continue;
    if (seen.has(draft.levelCode)) continue;
    seen.add(draft.levelCode);
    reports.push(draft);
  }

  return {
    version: REPORT_STORAGE_VERSION_V2,
    reports: reports.sort((a, b) => a.levelCode.localeCompare(b.levelCode)),
  };
}

/** Serialise. Only known fields are written; legacy records get v2 defaults. */
export function serializeReportWorkspaceV2(state: ReportWorkspaceWritable): string {
  return JSON.stringify({
    version: REPORT_STORAGE_VERSION_V2,
    reports: state.reports.map((report) => {
      const v2 = toV2Draft(report);
      return {
        levelCode: v2.levelCode,
        entries: v2.entries.map((entry) => ({
          id: entry.id,
          ordinal: entry.ordinal,
          when: entry.when,
          decided: entry.decided,
          noticed: entry.noticed,
        })),
        summary: v2.summary,
        status: v2.status,
        submittedAt: v2.submittedAt,
        revision: v2.revision,
        meaningfulRevision: v2.meaningfulRevision,
        review: v2.review
          ? {
              comment: v2.review.comment,
              sections: v2.review.sections,
              receivedAt: v2.review.receivedAt,
              atRevision: v2.review.atRevision,
            }
          : null,
      };
    }),
  });
}

/* ------------------------------------------------------------------ *
 * Migration v1 → v2 (DD-285) — one-way, read-time, idempotent
 * ------------------------------------------------------------------ */

/** Lift a parsed (already fail-closed) v1 state into v2 shape. */
export function migrateV1Workspace(v1: ReportWorkspaceState): ReportWorkspaceStateV2 {
  return {
    version: REPORT_STORAGE_VERSION_V2,
    // Entry values, summary, status, submittedAt and revision carry VERBATIM;
    // review is null — no verdict existed in v1.
    reports: v1.reports.map((report) => toV2Draft(report)),
  };
}

/**
 * The migration read (DD-285). Rules, in order:
 *
 *  1. A present v2 value is AUTHORITATIVE: it is parsed fail-closed and v1 is
 *     not consulted — a corrupt v2 must not silently fall back to stale v1 data
 *     that a newer session already superseded.
 *  2. Only when NO v2 value exists is v1 read, through the untouched v1 parser
 *     (every v1 guarantee holds), and lifted into v2 shape.
 *  3. Corrupt v1 yields an empty workspace — it never fabricates a v2 record.
 *  4. Nothing is written and nothing is deleted here: the v1 key stays on disk;
 *     the first real save writes the v2 key and v2 wins from then on.
 *
 * Deterministic and idempotent: same inputs, same output, no clock, no I/O.
 */
export function readReportWorkspaceV2(
  rawV2: string | null,
  rawV1: string | null,
  resolveDefinition: (levelNumber: number) => ReportDefinition | null,
): ReportWorkspaceStateV2 {
  if (rawV2 !== null) return parseReportWorkspaceV2(rawV2, resolveDefinition);
  return migrateV1Workspace(parseReportWorkspace(rawV1, resolveDefinition));
}
