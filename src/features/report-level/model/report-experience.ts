/**
 * Report experience derivation (Phase D3-B). The single owner of report business
 * logic — components read derived state from here and never re-decide a rule
 * (the DD-256 / DD-262 principle, applied to the report).
 *
 * Composition: the report definition + the browser-local draft + the shared
 * sequential marker + this session's completions → one derived ReportExperience.
 *
 * The blocked-progression sentence is DERIVED, never hardcoded: it is emitted
 * only when the availability resolver actually says the next level is locked. In
 * the canonical profile (Артём on level 18) level 4 is long since open, and
 * claiming otherwise would be a lie the user could see through.
 *
 * Raw enum values are never rendered; every user-facing string comes from this
 * module's label helpers.
 */

import { getLevel } from "@/data/curriculum/fixture";
import { resolveRouteAvailability } from "@/features/lesson/model/lesson-availability";
import type { LessonSessionProgress } from "@/features/lesson/model/lesson-session-progress";
import type { PathProgress } from "@/features/path/model/path-state";
import type { ReportDefinition } from "@/features/report-level/model/report";
import {
  filledEntryCount,
  hasSummary,
  isReportReady,
  type ReportDraft,
} from "@/features/report-level/model/report-draft";

/**
 * Lifecycle as the UI sees it. `ready` is computed, not persisted: it is a
 * statement about the entries, so deriving it keeps it from ever disagreeing
 * with them (see `report-draft.ts`).
 */
export type ReportLifecycle = "draft" | "ready" | "pending-review";

/**
 * How the workspace behaves.
 *
 *  - `editing` — level 3 is the user's current step: the report is live work.
 *  - `pending` — submitted in THIS browser: read-only, awaiting a review that
 *    this prototype does not perform.
 *  - `archive`  — the sequence already carried the user past level 3 (the
 *    canonical profile). The report is not live work; whatever this browser
 *    holds is shown read-only, and nothing is claimed about a report the user
 *    may have filed before this workspace existed.
 */
export type ReportMode = "editing" | "pending" | "archive";

export interface ReportExperience {
  definition: ReportDefinition;
  draft: ReportDraft;
  lifecycle: ReportLifecycle;
  mode: ReportMode;
  /** True only in `editing` — the one place edits are accepted. */
  editable: boolean;
  filledCount: number;
  totalCount: number;
  summaryFilled: boolean;
  /** e.g. «Заполнено 3 из 5 записей». Never a percentage, never a score. */
  readinessLabel: string;
  /** What is still missing, or null once ready. */
  remainingLabel: string | null;
  /** e.g. «Можно отправить на проверку», shown only when ready. */
  readyLabel: string | null;
  canSubmit: boolean;
  /** RU status chip text. */
  statusLabel: string;
  nextLevelNumber: number | null;
  nextLevelTitle: string | null;
  /** Derived from the availability resolver — never assumed. */
  nextLevelLocked: boolean;
  /** The blocked-progression sentence, or null when the next level is NOT locked. */
  blockedNote: string | null;
}

/* ------------------------------------------------------------------ *
 * RU pluralisation — the counts are read as sentences, not as digits
 * ------------------------------------------------------------------ */

/** Russian plural for count-driven nouns: 1 запись, 2 записи, 5 записей. */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function entriesWord(count: number): string {
  return pluralRu(count, "запись", "записи", "записей");
}

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

export function reportStatusLabel(lifecycle: ReportLifecycle): string {
  switch (lifecycle) {
    case "draft":
      return "Черновик";
    case "ready":
      return "Готов к отправке";
    case "pending-review":
      return "На проверке";
  }
}

function buildRemainingLabel(draft: ReportDraft, total: number): string | null {
  const missingEntries = total - filledEntryCount(draft);
  const missingSummary = !hasSummary(draft);

  if (missingEntries === 0 && !missingSummary) return null;

  const parts: string[] = [];
  if (missingEntries > 0) {
    parts.push(`${missingEntries} ${entriesWord(missingEntries)}`);
  }
  if (missingSummary) {
    parts.push("итоговое наблюдение");
  }
  return `Осталось заполнить ${parts.join(" и ")}`;
}

/* ------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------ */

export function deriveReportLifecycle(draft: ReportDraft): ReportLifecycle {
  if (draft.status === "pending-review") return "pending-review";
  return isReportReady(draft) ? "ready" : "draft";
}

export function deriveReportExperience({
  definition,
  draft,
  marker,
  session,
}: {
  definition: ReportDefinition;
  draft: ReportDraft;
  marker: PathProgress;
  session: LessonSessionProgress;
}): ReportExperience {
  const levelNumber = definition.level.number;
  const lifecycle = deriveReportLifecycle(draft);
  const availability = resolveRouteAvailability(levelNumber, marker, session);

  // The canonical sequence wins over the browser-local record: if it has already
  // carried the user past this level, the report is history, whatever the local
  // marker says. Letting a stored `pending-review` override that would let a
  // draft contradict progression the user already earned — the same rule the
  // library and the path apply to a report status (DD-271).
  const mode: ReportMode =
    availability === "completed"
      ? "archive"
      : lifecycle === "pending-review"
        ? "pending"
        : availability === "available"
          ? "editing"
          : "archive";

  const total = definition.entryCount;
  const filled = filledEntryCount(draft);

  const nextLevelNumber = levelNumber < 100 ? levelNumber + 1 : null;
  const nextLevel = nextLevelNumber !== null ? getLevel(nextLevelNumber) : null;

  // THE derivation that matters: is the next level actually locked right now?
  // We ask the one resolver that owns the answer instead of assuming it. The
  // report never closes a level — it simply never completes level 3, so under a
  // marker that has already passed level 3 this is false and no claim is made.
  const nextLevelLocked =
    nextLevelNumber !== null &&
    resolveRouteAvailability(nextLevelNumber, marker, session) === "locked";

  const blockedNote =
    nextLevelLocked && nextLevel
      ? `Уровень ${nextLevel.number} «${nextLevel.title}» откроется после одобрения отчёта.`
      : null;

  return {
    definition,
    draft,
    lifecycle,
    mode,
    editable: mode === "editing",
    filledCount: filled,
    totalCount: total,
    summaryFilled: hasSummary(draft),
    readinessLabel: `Заполнено ${filled} из ${total} ${entriesWord(total)}`,
    remainingLabel: buildRemainingLabel(draft, total),
    readyLabel: isReportReady(draft) ? "Можно отправить на проверку" : null,
    canSubmit: mode === "editing" && isReportReady(draft),
    statusLabel: reportStatusLabel(lifecycle),
    nextLevelNumber,
    nextLevelTitle: nextLevel?.title ?? null,
    nextLevelLocked,
    blockedNote,
  };
}
