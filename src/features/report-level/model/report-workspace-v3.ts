/**
 * Report workspace v3 (Phase D3-D) — schema, mutation and migration for the
 * approved verdict.
 *
 * The schema change (a terminal `approved` status + an `approvedAt` timestamp)
 * gets a NEW key rather than a silent in-place migration (`REPORT_STORAGE.md`,
 * DD-296):
 *
 *   v1  ata.report-workspace.v1  — draft | pending-review                (D3-B)
 *   v2  ata.report-workspace.v2  — + revision-requested, review          (D3-C)
 *   v3  ata.report-workspace.v3  — + approved, approvedAt                 (D3-D)
 *
 * `report-draft.ts` (v1) and `report-workspace-v2.ts` (v2) remain UNTOUCHED:
 * migration reads through their parsers, and every fail-closed guarantee they
 * make keeps holding for legacy data. In particular a forged `"approved"` in the
 * v2 KEY is still refused by the v2 parser — `approved` is a v3 concept and only
 * the v3 parser knows it.
 *
 * HONEST BOUNDARY (DD-299). A structurally valid `approved` in this browser's
 * localStorage is a PROVISIONAL FRONTEND PROTOTYPE state, not an authenticated
 * verdict. The frontend cannot cryptographically prove where a localStorage
 * value came from, and it does not pretend to: no signature, token or hash is
 * added, because the same client that would mint it also verifies it — that is
 * not a security boundary. Malformed, unsupported and inconsistent approved
 * records FAIL CLOSED (see `normaliseReportV3`). A real authoritative mentor
 * verdict will require a backend; until then the UI keeps «dev/test · provisional»
 * visible in the approval context.
 *
 * Deliberately NOT stored, ever (unchanged from v1/v2): XP, balances, deposits,
 * any financial value, trading results, secrets, scenario keys.
 */

import {
  MAX_FIELD_LENGTH,
  createEmptyDraft,
  createEmptyEntries,
  isReportReady,
  type ReportDraft,
  type ReportEntryDraft,
} from "@/features/report-level/model/report-draft";
import {
  normalizeFieldValue,
  readReportWorkspaceV2,
  type ReportDraftV2,
  type ReportWorkspaceStateV2,
} from "@/features/report-level/model/report-workspace-v2";
import {
  knownSectionIds,
  type ReportReview,
} from "@/features/report-level/model/report-review";
import type { ReportDefinition } from "@/features/report-level/model/report";

/** Versioned key. The v1 and v2 keys stay untouched on disk — migration never deletes them. */
export const REPORT_STORAGE_KEY_V3 = "ata.report-workspace.v3";

export const REPORT_STORAGE_VERSION_V3 = 3;

/**
 * Persisted lifecycle, v3. `ready`, `editing-revision` and `ready-to-resubmit`
 * are computed presentation states (see `report-experience.ts`) — storing them
 * would let a stale flag disagree with the draft it describes.
 *
 * `approved` is the new TERMINAL member (DD-297): it is the only external
 * verdict, it is not editable and it cannot be resubmitted. `rejected` still
 * does not exist. A stored value outside this union is treated as forgery and
 * the record's verdict is refused.
 */
export type ReportStatusV3 =
  | "draft"
  | "pending-review"
  | "revision-requested"
  | "approved";

export interface ReportDraftV3 extends Omit<ReportDraftV2, "status"> {
  status: ReportStatusV3;
  /**
   * ISO timestamp of the approval, or null. STORED, never rendered to the user
   * (DD-297): the approved screen shows no countdown and no date.
   */
  approvedAt: string | null;
}

export interface ReportWorkspaceStateV3 {
  version: number;
  reports: ReportDraftV3[];
}

/**
 * What the store accepts for writing: a v3 state, or a legacy-shaped state whose
 * records lack the v3 fields (migration and existing callers seed those).
 * Serialisation defaults the missing fields exactly like migration does.
 */
export interface ReportWorkspaceWritableV3 {
  version: number;
  reports: Array<
    Omit<ReportDraft, "status"> & {
      status: ReportStatusV3;
      review?: ReportReview | null;
      meaningfulRevision?: number;
      approvedAt?: string | null;
    }
  >;
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

export function emptyReportWorkspaceV3(): ReportWorkspaceStateV3 {
  return { version: REPORT_STORAGE_VERSION_V3, reports: [] };
}

export function createEmptyDraftV3(definition: ReportDefinition): ReportDraftV3 {
  return {
    ...createEmptyDraft(definition),
    review: null,
    meaningfulRevision: 0,
    approvedAt: null,
  };
}

/** Widen a legacy or partial record into a full v3 draft (migration defaults). */
function toV3Draft(
  draft: Omit<ReportDraft, "status"> & {
    status: ReportStatusV3;
    review?: ReportReview | null;
    meaningfulRevision?: number;
    approvedAt?: string | null;
  },
): ReportDraftV3 {
  return {
    ...draft,
    review: draft.review ?? null,
    meaningfulRevision: draft.meaningfulRevision ?? draft.revision,
    approvedAt: draft.approvedAt ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Content-change helpers (v3-typed — v2's take a narrower status union)
 * ------------------------------------------------------------------ */

function clampText(value: string): string {
  return value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value;
}

/** True when the draft's content changed (normalised) since the verdict. */
export function hasChangeSinceReviewV3(draft: ReportDraftV3): boolean {
  return draft.review !== null && draft.meaningfulRevision > draft.review.atRevision;
}

/** The resubmit rule: readiness AND a real content change after the verdict. */
export function canResubmitV3(draft: ReportDraftV3): boolean {
  return (
    draft.status === "revision-requested" &&
    isReportReady(draft) &&
    hasChangeSinceReviewV3(draft)
  );
}

/* ------------------------------------------------------------------ *
 * Mutation — pure, returns new records
 * ------------------------------------------------------------------ */

/** The two statuses under which the report is the user's live work. `approved`
 *  is deliberately NOT here — it is terminal and read-only by construction. */
function isEditableStatusV3(status: ReportStatusV3): boolean {
  return status === "draft" || status === "revision-requested";
}

export function withEntryFieldV3(
  draft: ReportDraftV3,
  ordinal: number,
  key: "when" | "decided" | "noticed",
  value: string,
): ReportDraftV3 {
  if (!isEditableStatusV3(draft.status)) return draft;
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

export function withSummaryV3(draft: ReportDraftV3, value: string): ReportDraftV3 {
  if (!isEditableStatusV3(draft.status)) return draft;
  const next = clampText(value);
  const changed = normalizeFieldValue(draft.summary) !== normalizeFieldValue(next);
  return {
    ...draft,
    summary: next,
    revision: draft.revision + 1,
    meaningfulRevision: draft.meaningfulRevision + (changed ? 1 : 0),
  };
}

/** First submit: unchanged semantics — draft → pending-review, readiness required. */
export function withSubmittedV3(draft: ReportDraftV3, submittedAt: string): ReportDraftV3 {
  if (draft.status !== "draft") return draft;
  if (!isReportReady(draft)) return draft;
  return { ...draft, status: "pending-review", submittedAt, revision: draft.revision + 1 };
}

/**
 * Apply the revision verdict: pending-review → revision-requested.
 * Only the dev/test adapter calls this (DD-286). `approvedAt` stays null — a
 * revision is not an approval. On an `approved` (terminal) or any non-pending
 * draft this is a no-op.
 */
export function withRevisionRequestedV3(
  draft: ReportDraftV3,
  definition: ReportDefinition,
  input: { comment: string; sections: string[]; receivedAt: string },
): ReportDraftV3 {
  if (draft.status !== "pending-review") return draft;
  const comment = clampText(input.comment).trim();
  if (comment.length === 0) return draft;

  const known = knownSectionIds(definition);
  const sections = [...new Set(input.sections)].filter((id) => known.has(id));

  return {
    ...draft,
    status: "revision-requested",
    review: {
      comment,
      sections,
      receivedAt: input.receivedAt,
      atRevision: draft.meaningfulRevision,
    },
    revision: draft.revision + 1,
  };
}

/** Resubmit: revision-requested → pending-review, guarded by `canResubmitV3`. */
export function withResubmittedV3(draft: ReportDraftV3, submittedAt: string): ReportDraftV3 {
  if (!canResubmitV3(draft)) return draft;
  return { ...draft, status: "pending-review", submittedAt, revision: draft.revision + 1 };
}

/**
 * Apply the approved verdict: pending-review → approved (DD-297).
 *
 * Only the dev/test adapter calls this (DD-298) — no user action reaches it, and
 * there is no `withRejected` to call. The report must be READY (a verdict cannot
 * approve an unfinished report) and the transition is refused on any status
 * other than pending-review, which makes `approved` terminal: a second approval,
 * or an approval of a draft/revision-requested/approved record, is a no-op.
 *
 * `approvedAt` is injected at the edge (the deterministic clock adapter, exactly
 * like `submittedAt`/`receivedAt`), stored, and NEVER rendered. The existing
 * `review` is PRESERVED as the history of the iteration that was approved — the
 * approved screen may quietly show the last comment.
 */
export function withApproved(draft: ReportDraftV3, approvedAt: string): ReportDraftV3 {
  if (draft.status !== "pending-review") return draft;
  if (!isReportReady(draft)) return draft;
  return { ...draft, status: "approved", approvedAt, revision: draft.revision + 1 };
}

/* ------------------------------------------------------------------ *
 * Workspace access
 * ------------------------------------------------------------------ */

export function getStoredDraftV3(
  state: ReportWorkspaceStateV3,
  levelNumber: number,
): ReportDraftV3 | null {
  const code = `level.${String(levelNumber).padStart(3, "0")}`;
  return state.reports.find((report) => report.levelCode === code) ?? null;
}

export function withDraftV3(
  state: ReportWorkspaceStateV3,
  draft: ReportDraftV3,
): ReportWorkspaceStateV3 {
  const others = state.reports.filter((report) => report.levelCode !== draft.levelCode);
  return {
    version: REPORT_STORAGE_VERSION_V3,
    reports: [...others, draft].sort((a, b) => a.levelCode.localeCompare(b.levelCode)),
  };
}

/* ------------------------------------------------------------------ *
 * Parsing — never throws, never returns junk (v1/v2 discipline, v3 schema)
 * ------------------------------------------------------------------ */

function readText(value: unknown): string {
  return typeof value === "string" ? clampText(value) : "";
}

function readCounter(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readStatusV3(value: unknown): ReportStatusV3 | null {
  return value === "draft" ||
    value === "pending-review" ||
    value === "revision-requested" ||
    value === "approved"
    ? value
    : null;
}

/**
 * A valid ISO-8601 UTC timestamp, the shape `new Date().toISOString()` emits.
 * Stricter than the `typeof === "string"` check `submittedAt` uses, because a
 * broken `approvedAt` must downgrade the verdict rather than be trusted (DD-296).
 */
function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * Normalise a stored review. Null means «no usable verdict». Unknown/forged
 * section ids are dropped ALONE — never the user's work with them.
 */
function normaliseReviewV3(value: unknown, definition: ReportDefinition): ReportReview | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const comment = readText(record.comment).trim();
  if (comment.length === 0) return null;
  if (typeof record.receivedAt !== "string") return null;

  const known = knownSectionIds(definition);
  const rawSections = Array.isArray(record.sections) ? record.sections : [];
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

function normaliseEntriesV3(value: unknown, definition: ReportDefinition): ReportEntryDraft[] {
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
      id: empty.id,
      ordinal: empty.ordinal,
      when: readText(record.when),
      decided: readText(record.decided),
      noticed: readText(record.noticed),
    };
  });
}

/**
 * Normalise one stored v3 report.
 *
 * The approved rules (DD-296) preserve the user's WORK whenever the metadata is
 * the only thing broken:
 *   - approved + not ready       → draft (keep work, drop verdict) — no progression;
 *   - approved + missing submit  → draft (submission semantics) — no progression;
 *   - approved + invalid approvedAt → pending-review (KEEP work AND review);
 *   - approved + unknown section ids → drop only those ids;
 *   - unknown status ("rejected", "auto-approved", …) → record refused.
 */
function normaliseReportV3(
  value: unknown,
  resolveDefinition: (levelNumber: number) => ReportDefinition | null,
): ReportDraftV3 | null {
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

  // "auto-approved", "mentor-approved", "rejected", anything unknown → the
  // record is refused outright: a fabricated verdict must never reach the UI.
  const status = readStatusV3(record.status);
  if (status === null) return null;

  const entries = normaliseEntriesV3(record.entries, definition);
  const summary = readText(record.summary);
  const revision = readCounter(record.revision) ?? 0;
  const meaningfulRevision = readCounter(record.meaningfulRevision) ?? revision;
  const submittedAt = typeof record.submittedAt === "string" ? record.submittedAt : null;

  let draft: ReportDraftV3 = {
    levelCode: definition.level.code,
    entries,
    summary,
    status,
    submittedAt,
    revision,
    meaningfulRevision,
    review: null,
    approvedAt: null,
  };

  if (status === "revision-requested") {
    const review = normaliseReviewV3(record.review, definition);
    if (review) {
      draft = { ...draft, review };
    } else {
      // A revision verdict that cannot be trusted costs the VERDICT, not the
      // work: fall back to the last trustworthy stored state — pending-review.
      draft = { ...draft, status: "pending-review" };
    }
  } else if (status === "approved") {
    // The review, if any, is the history of the approved iteration — kept.
    const review = normaliseReviewV3(record.review, definition);
    if (review) draft = { ...draft, review };

    // Incomplete work cannot be approved — keep the work, drop the verdict, open
    // NOTHING. Same for a missing submit (an approval implies a prior submit).
    if (!isReportReady(draft) || draft.submittedAt === null) {
      return { ...draft, status: "draft", submittedAt: null, review: null, approvedAt: null };
    }

    // The verdict metadata is the only thing broken: keep the work AND the
    // review, but refuse the approval — downgrade to the last honest state.
    if (!isIsoTimestamp(record.approvedAt)) {
      return { ...draft, status: "pending-review", approvedAt: null };
    }

    // A fully valid approved record.
    return { ...draft, approvedAt: record.approvedAt };
  } else if (record.review !== undefined && record.review !== null) {
    const review = normaliseReviewV3(record.review, definition);
    if (status === "pending-review" && review) {
      draft = { ...draft, review };
    }
    // draft + review stays reviewless: a verdict cannot precede a submit.
  }

  // A pending-review record that fails readiness could not have been produced by
  // submit — the honest reading is «it was never submitted» (v1/v2 rule).
  if (draft.status === "pending-review" && !isReportReady(draft)) {
    return { ...draft, status: "draft", submittedAt: null, review: null, approvedAt: null };
  }

  return draft;
}

/**
 * Parse a raw v3 string. NEVER throws and never returns junk; every corrupt or
 * hostile shape collapses to an empty workspace. A tampered value can only cost
 * the user their draft — never unlock a level, never fabricate a verdict.
 */
export function parseReportWorkspaceV3(
  raw: string | null | undefined,
  resolveDefinition: (levelNumber: number) => ReportDefinition | null,
): ReportWorkspaceStateV3 {
  if (typeof raw !== "string" || raw.length === 0) return emptyReportWorkspaceV3();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyReportWorkspaceV3();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptyReportWorkspaceV3();
  }

  const record = parsed as Record<string, unknown>;
  if (record.version !== REPORT_STORAGE_VERSION_V3) return emptyReportWorkspaceV3();
  if (!Array.isArray(record.reports)) return emptyReportWorkspaceV3();

  const seen = new Set<string>();
  const reports: ReportDraftV3[] = [];
  for (const item of record.reports) {
    const draft = normaliseReportV3(item, resolveDefinition);
    if (!draft) continue;
    if (seen.has(draft.levelCode)) continue;
    seen.add(draft.levelCode);
    reports.push(draft);
  }

  return {
    version: REPORT_STORAGE_VERSION_V3,
    reports: reports.sort((a, b) => a.levelCode.localeCompare(b.levelCode)),
  };
}

/** Serialise. Only known fields are written; legacy records get v3 defaults. */
export function serializeReportWorkspaceV3(state: ReportWorkspaceWritableV3): string {
  return JSON.stringify({
    version: REPORT_STORAGE_VERSION_V3,
    reports: state.reports.map((report) => {
      const v3 = toV3Draft(report);
      return {
        levelCode: v3.levelCode,
        entries: v3.entries.map((entry) => ({
          id: entry.id,
          ordinal: entry.ordinal,
          when: entry.when,
          decided: entry.decided,
          noticed: entry.noticed,
        })),
        summary: v3.summary,
        status: v3.status,
        submittedAt: v3.submittedAt,
        revision: v3.revision,
        meaningfulRevision: v3.meaningfulRevision,
        review: v3.review
          ? {
              comment: v3.review.comment,
              sections: v3.review.sections,
              receivedAt: v3.review.receivedAt,
              atRevision: v3.review.atRevision,
            }
          : null,
        approvedAt: v3.approvedAt,
      };
    }),
  });
}

/* ------------------------------------------------------------------ *
 * Migration v2 → v3 (DD-296) — one-way, read-time, idempotent
 * ------------------------------------------------------------------ */

/** Lift a parsed (already fail-closed) v2 state into v3 shape. approvedAt = null:
 *  no approval existed in v2, and a forged v2 "approved" was already refused by
 *  the v2 parser before it reached here. */
export function migrateV2WorkspaceToV3(v2: ReportWorkspaceStateV2): ReportWorkspaceStateV3 {
  return {
    version: REPORT_STORAGE_VERSION_V3,
    reports: v2.reports.map((report) => toV3Draft(report)),
  };
}

/**
 * The migration read (DD-296). Rules, in order:
 *
 *  1. A present v3 value is AUTHORITATIVE: parsed fail-closed, v2/v1 not
 *     consulted — a corrupt v3 must not silently fall back to stale lower-version
 *     data a newer session already superseded.
 *  2. Only when NO v3 value exists is the v2 read performed (through the
 *     untouched v2 migration read, which itself lifts v1 when v2 is absent) and
 *     the result lifted into v3 with approvedAt = null.
 *  3. Nothing is written and nothing is deleted here: the v1/v2 keys stay on
 *     disk; the first real save writes the v3 key and v3 wins from then on.
 *
 * Deterministic and idempotent: same inputs, same output, no clock, no I/O.
 */
export function readReportWorkspaceV3(
  rawV3: string | null,
  rawV2: string | null,
  rawV1: string | null,
  resolveDefinition: (levelNumber: number) => ReportDefinition | null,
): ReportWorkspaceStateV3 {
  if (rawV3 !== null) return parseReportWorkspaceV3(rawV3, resolveDefinition);
  return migrateV2WorkspaceToV3(readReportWorkspaceV2(rawV2, rawV1, resolveDefinition));
}
