/**
 * Report experience derivation (Phase D3-B, revision cycle in D3-C). The single
 * owner of report business logic — components read derived state from here and
 * never re-decide a rule (the DD-256 / DD-262 principle, applied to the report).
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
 * module's label helpers. Raw section ids never render either — the review
 * targets carry the human labels (`report-review.ts`).
 */

import { getLevel } from "@/data/curriculum/fixture";
import { formatThresholdUsd } from "@/domain/curriculum";
import { resolveRouteAvailability } from "@/features/lesson/model/lesson-availability";
import type { LessonSessionProgress } from "@/features/lesson/model/lesson-session-progress";
import type { PathProgress } from "@/features/path/model/path-state";
import type { ReportDefinition } from "@/features/report-level/model/report";
import {
  filledEntryCount,
  hasSummary,
  isReportReady,
} from "@/features/report-level/model/report-draft";
import {
  canResubmitV3,
  hasChangeSinceReviewV3,
  type ReportDraftV3,
} from "@/features/report-level/model/report-workspace-v3";
import { sessionWithApprovedReports } from "@/features/report-level/model/report-progression";
import {
  reviewTargets,
  type ReportReview,
  type ReviewTarget,
} from "@/features/report-level/model/report-review";

/**
 * Lifecycle as the UI sees it. `ready`, `revision-requested`-with-changes
 * (`ready-to-resubmit`) are computed, not persisted: they are statements about
 * the entries, so deriving them keeps them from ever disagreeing with the draft
 * (see `report-workspace-v2.ts`).
 *
 * `rejected` has no member here — it does not exist (DD-297). `approved` is the
 * D3-D terminal verdict.
 */
export type ReportLifecycle =
  | "draft"
  | "ready"
  | "pending-review"
  | "revision-requested"
  | "ready-to-resubmit"
  | "approved";

/**
 * How the workspace behaves.
 *
 *  - `editing`  — level 3 is the user's current step: the report is live work.
 *  - `revision` — the review returned the report (D3-C): the SAME work is
 *    editable again, with the reviewer's comment as the working order.
 *  - `pending`  — submitted in THIS browser: read-only, awaiting a review that
 *    this prototype does not perform.
 *  - `approved` — an APPROVAL-INDUCED completion (D3-D): the report was the
 *    user's live step, the verdict is approved, and folding it into the session
 *    completed level 3. The calm approved archive, read-only, next step = Path.
 *  - `archive`  — the sequence already carried the user past level 3 BEFORE any
 *    approval (the canonical profile). The report is not live work; whatever this
 *    browser holds is shown read-only. A local `approved` here does NOT rename the
 *    level and shows no «Одобрено» — the canonical completion owns the level
 *    (DD-300, base-completed vs approval-induced distinction).
 */
export type ReportMode = "editing" | "revision" | "pending" | "archive" | "approved";

export interface ReportExperience {
  definition: ReportDefinition;
  draft: ReportDraftV3;
  lifecycle: ReportLifecycle;
  mode: ReportMode;
  /** True in `editing` and `revision` — the places edits are accepted. */
  editable: boolean;
  filledCount: number;
  totalCount: number;
  summaryFilled: boolean;
  /** e.g. «Заполнено 3 из 5 записей». Never a percentage, never a score. */
  readinessLabel: string;
  /** What is still missing, or null once ready. */
  remainingLabel: string | null;
  /** e.g. «Можно отправить на проверку», shown only when ready in `editing`. */
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

  /* ---------------- revision cycle (D3-C) ---------------- */

  /** The verdict of the current iteration, or null before any verdict. */
  review: ReportReview | null;
  /** Flagged sections resolved to human-labelled targets, in ledger order. */
  reviewTargets: ReviewTarget[];
  /** True when a real content change landed after the verdict. */
  changedSinceReview: boolean;
  /** The resubmit rule: readiness ∧ change after verdict, in `revision` mode. */
  canResubmit: boolean;
  /** The calm line above the resubmit CTA — one truth at a time. */
  revisionStateLabel: string | null;

  /* ---------------- approved (D3-D) ---------------- */

  /**
   * True ONLY for an APPROVAL-INDUCED completion (`mode === "approved"`): base
   * availability was current/available, the verdict is approved, and folding the
   * approval into the session completed the level. A canonical completion (base
   * already completed) is `false` here even with a stored approved — the level is
   * the sequence's, not the verdict's (DD-300).
   */
  approvalInduced: boolean;
  /** e.g. «Отчёт принят. Уровень 3 завершён.» — only in approved mode, else null. */
  approvedHeadline: string | null;
  /** The next curriculum step when it is a checkpoint: its number + $-requirement. */
  nextStepCheckpoint: { levelNumber: number; requirement: string } | null;
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
    case "revision-requested":
      return "Нужна доработка";
    case "ready-to-resubmit":
      return "Готов к повторной отправке";
    case "approved":
      return "Одобрено";
  }
}

function buildRemainingLabel(draft: ReportDraftV3, total: number): string | null {
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

export function deriveReportLifecycle(draft: ReportDraftV3): ReportLifecycle {
  // Terminal verdict wins over every computed reading.
  if (draft.status === "approved") return "approved";
  if (draft.status === "revision-requested") {
    // The stored status is the same; what changed is a computed fact about the
    // draft. «Нужна доработка» and «Готов к повторной отправке» are two readings
    // of one record, never two records.
    return canResubmitV3(draft) ? "ready-to-resubmit" : "revision-requested";
  }
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
  draft: ReportDraftV3;
  marker: PathProgress;
  session: LessonSessionProgress;
}): ReportExperience {
  const levelNumber = definition.level.number;
  const lifecycle = deriveReportLifecycle(draft);

  /* --------- the mandatory architectural boundary (DD-300) --------- */

  // BASE availability — the canonical marker + THIS lesson session, BEFORE any
  // approved-report augmentation. Under the canonical profile (Артём on L18) this
  // is already `completed`; under the report scenario it is `available`.
  const baseAvailability = resolveRouteAvailability(levelNumber, marker, session);

  // EFFECTIVE — after folding THIS report's approval into the session, through the
  // shared augmentation helper (never a bespoke rule). The next level opens via
  // the same resolver, so the augmented session is what `nextLevelLocked` reads.
  const augmentedSession = sessionWithApprovedReports(session, {
    version: 3,
    reports: [draft],
  });
  const approvedVerdict = draft.status === "approved";

  // Approval-INDUCED completion, the precise distinction: the level was NOT
  // already completed by the sequence, the verdict is approved, so the approval
  // is what completes it. A canonical completion (base already completed) is
  // deliberately NOT approval-induced — never rename the sequence's level.
  const approvalInduced = baseAvailability !== "completed" && approvedVerdict;

  const isRevisionLifecycle =
    lifecycle === "revision-requested" || lifecycle === "ready-to-resubmit";

  // The canonical sequence wins over the browser-local record: if it has already
  // carried the user past this level, the report is history, whatever the local
  // marker says (DD-271). Approval-induced completion is the one case where the
  // local verdict legitimately advances the level — and it is decided from the
  // base/effective distinction above, never from the final availability alone.
  const mode: ReportMode = approvalInduced
    ? "approved"
    : baseAvailability === "completed"
      ? "archive"
      : lifecycle === "pending-review"
        ? "pending"
        : baseAvailability !== "available"
          ? "archive"
          : isRevisionLifecycle
            ? "revision"
            : "editing";

  const total = definition.entryCount;
  const filled = filledEntryCount(draft);

  const nextLevelNumber = levelNumber < 100 ? levelNumber + 1 : null;
  const nextLevel = nextLevelNumber !== null ? getLevel(nextLevelNumber) : null;

  // THE derivation that matters: is the next level actually locked right now?
  // We ask the one resolver that owns the answer, reading the AUGMENTED session —
  // so once the report is approved the resolver reports the next level open, and
  // the blocked note disappears (DD-297). Before approval nothing is augmented,
  // so this is identical to the D3-C behaviour.
  const nextLevelLocked =
    nextLevelNumber !== null &&
    resolveRouteAvailability(nextLevelNumber, marker, augmentedSession) === "locked";

  const blockedNote =
    nextLevelLocked && nextLevel
      ? `Уровень ${nextLevel.number} «${nextLevel.title}» откроется после одобрения отчёта.`
      : null;

  // The next step's checkpoint requirement (target only — never a balance), for
  // the approved screen's «следующий шаг». Present whenever the next level is a
  // checkpoint, regardless of mode; the component reads it only when approved.
  const nextStepCheckpoint =
    nextLevel && nextLevel.kind === "checkpoint" && nextLevel.checkpoint
      ? {
          levelNumber: nextLevel.number,
          requirement: `Баланс Pocket от ${formatThresholdUsd(nextLevel.checkpoint.thresholdUsd)}`,
        }
      : null;

  const approvedHeadline =
    mode === "approved" ? `Отчёт принят. Уровень ${levelNumber} завершён.` : null;

  const changed = hasChangeSinceReviewV3(draft);
  const resubmitAllowed = mode === "revision" && canResubmitV3(draft);

  // One truth at a time above the CTA: what stands between the user and the
  // resubmit — nothing, a missing change, or missing content. Calm words, no
  // «ошибка», no percentages (DD-274 applied to revision).
  const revisionStateLabel =
    mode !== "revision"
      ? null
      : resubmitAllowed
        ? "Есть изменения после вердикта — можно отправить на проверку повторно."
        : "Внесите изменения после комментария проверки.";

  return {
    definition,
    draft,
    lifecycle,
    mode,
    editable: mode === "editing" || mode === "revision",
    filledCount: filled,
    totalCount: total,
    summaryFilled: hasSummary(draft),
    readinessLabel: `Заполнено ${filled} из ${total} ${entriesWord(total)}`,
    remainingLabel: buildRemainingLabel(draft, total),
    readyLabel:
      mode === "editing" && isReportReady(draft) ? "Можно отправить на проверку" : null,
    canSubmit: mode === "editing" && isReportReady(draft),
    statusLabel: reportStatusLabel(lifecycle),
    nextLevelNumber,
    nextLevelTitle: nextLevel?.title ?? null,
    nextLevelLocked,
    blockedNote,
    review: draft.review,
    reviewTargets: reviewTargets(definition, draft.review),
    changedSinceReview: changed,
    canResubmit: resubmitAllowed,
    revisionStateLabel,
    approvalInduced,
    approvedHeadline,
    nextStepCheckpoint,
  };
}
