/**
 * Review model (Phase D3-C) — the minimal feedback shape a verdict carries.
 *
 * D3-C introduces exactly ONE verdict, `revision-requested`, and exactly one
 * feedback form (DD-288): a single general comment plus the section ids that
 * need attention. Deliberately absent, and never to be added here without a
 * product decision: reviewer name, avatar, countdown, chat, per-section threads,
 * rubric score, trading evaluation, any financial value.
 *
 * Section ids (`report.003.entry.3.noticed`, `report.003.summary`) are MODEL
 * identifiers. They are never rendered and never become an accessible name — the
 * user always sees the human label («Запись 03 · Что заметил после сделки»).
 * Ids are validated against the closed set this module derives from the report
 * definition; free-form ids cannot be minted from user input.
 */

import {
  REPORT_ENTRY_FIELDS,
  reportCodeFor,
  reportEntryId,
  type ReportDefinition,
  type ReportFieldKey,
} from "@/features/report-level/model/report";

/**
 * One review verdict, as stored in the v2 workspace.
 *
 * `atRevision` pins the draft's MEANINGFUL revision counter at the moment the
 * verdict arrived — the resubmit rule compares against it, so «есть изменения
 * после вердикта» is a stored fact, not a guess. `receivedAt` is stored and
 * never rendered (no countdown, DD-288).
 */
export interface ReportReview {
  comment: string;
  sections: ReportReviewSectionId[];
  receivedAt: string;
  atRevision: number;
}

/** A validated member of the closed section-id set. Internal — never rendered. */
export type ReportReviewSectionId = string;

/* ------------------------------------------------------------------ *
 * Section ids — a closed, derived set
 * ------------------------------------------------------------------ */

/** e.g. "report.003.entry.3.noticed" */
export function entryFieldSectionId(
  levelNumber: number,
  ordinal: number,
  field: ReportFieldKey,
): ReportReviewSectionId {
  return `${reportEntryId(levelNumber, ordinal)}.${field}`;
}

/** e.g. "report.003.summary" */
export function summarySectionId(levelNumber: number): ReportReviewSectionId {
  return `${reportCodeFor(levelNumber)}.summary`;
}

/**
 * Every section id that exists for this report. A review may only point at
 * members of this set; anything else is dropped during normalisation — an
 * unknown id is dropped alone, never the user's work with it.
 */
export function knownSectionIds(definition: ReportDefinition): Set<ReportReviewSectionId> {
  const ids = new Set<ReportReviewSectionId>();
  const level = definition.level.number;
  for (let ordinal = 1; ordinal <= definition.entryCount; ordinal += 1) {
    for (const field of REPORT_ENTRY_FIELDS) {
      ids.add(entryFieldSectionId(level, ordinal, field.key));
    }
  }
  ids.add(summarySectionId(level));
  return ids;
}

/* ------------------------------------------------------------------ *
 * Targets — how the UI addresses a flagged section
 * ------------------------------------------------------------------ */

/**
 * A flagged section resolved for presentation: which surface it lives on and
 * what to CALL it. The label is the only string that may reach the user.
 */
export interface ReviewTarget {
  sectionId: ReportReviewSectionId;
  kind: "entry-field" | "summary";
  /** Entry ordinal for an entry field; null for the summary. */
  ordinal: number | null;
  fieldKey: ReportFieldKey | null;
  /** Human label, e.g. «Запись 03 · Что заметил после сделки». */
  label: string;
}

function fieldLabel(key: ReportFieldKey): string {
  return REPORT_ENTRY_FIELDS.find((field) => field.key === key)?.label ?? key;
}

/** Resolve one section id, or null when it is not part of this report. */
export function resolveReviewTarget(
  definition: ReportDefinition,
  sectionId: string,
): ReviewTarget | null {
  const level = definition.level.number;

  if (sectionId === summarySectionId(level)) {
    return {
      sectionId,
      kind: "summary",
      ordinal: null,
      fieldKey: null,
      label: definition.summaryLabel,
    };
  }

  for (let ordinal = 1; ordinal <= definition.entryCount; ordinal += 1) {
    for (const field of REPORT_ENTRY_FIELDS) {
      if (sectionId === entryFieldSectionId(level, ordinal, field.key)) {
        return {
          sectionId,
          kind: "entry-field",
          ordinal,
          fieldKey: field.key,
          label: `Запись ${String(ordinal).padStart(2, "0")} · ${fieldLabel(field.key)}`,
        };
      }
    }
  }

  return null;
}

/**
 * The review's flagged sections as presentation targets, in LEDGER order —
 * entries by ordinal first, the summary last. The pass walks this list; its
 * order comes from the report's own structure, never from the verdict payload.
 */
export function reviewTargets(
  definition: ReportDefinition,
  review: ReportReview | null,
): ReviewTarget[] {
  if (!review) return [];
  const resolved = review.sections
    .map((sectionId) => resolveReviewTarget(definition, sectionId))
    .filter((target): target is ReviewTarget => target !== null);

  return resolved.sort((a, b) => {
    if (a.kind === "summary") return b.kind === "summary" ? 0 : 1;
    if (b.kind === "summary") return -1;
    return (a.ordinal ?? 0) - (b.ordinal ?? 0);
  });
}

/* ------------------------------------------------------------------ *
 * Dev/test verdict adapter — the ONLY source of a verdict (DD-286)
 * ------------------------------------------------------------------ */

/**
 * The verdicts the adapter may produce (DD-298). D3-D adds `approved`, the
 * terminal external verdict. `rejected` still does not exist — there is no member
 * for it, so the adapter cannot emit one even by mistake, and no alias
 * ("auto-approved", "mentor-approved") resolves to `approved`.
 */
export type ReportVerdictAdapter = "revision-requested" | "approved";

/**
 * Resolve the `?verdict=` DEVELOPMENT AND TEST query (the `?scenario` precedent,
 * DD-234/DD-272). EXACT MATCH only — every unknown value, including "rejected"
 * and any approved alias, fails closed to null. This is capture/E2E
 * instrumentation: it never appears in a user-facing link, and no user CTA
 * produces it (asserted by tests).
 */
export function resolveReportVerdictAdapter(raw: unknown): ReportVerdictAdapter | null {
  if (raw === "revision-requested") return "revision-requested";
  if (raw === "approved") return "approved";
  return null;
}
