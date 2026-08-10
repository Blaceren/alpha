/**
 * REVIEW-SURFACE CORRECTION — WHICH VERSION IS THE EDITORIAL WORK ITEM?
 *
 * ============================== WHAT WAS MISSING ==============================
 * PHASE-G2 SUCCESSOR separated two questions that had shared one name:
 *
 *   pickRuntimeVersion  — which version does a LEARNER receive?
 *   resolveCandidate    — which version did the CALLER name?
 *
 * Both are answered per request. Neither answers the question a global surface
 * has to answer with nobody to ask: **which version of this level is somebody
 * currently supposed to be working on?** The overview, the work queue and
 * readiness all needed that answer and had only `pickRuntimeVersion` to hand, so
 * they described the runtime version and called it the editorial state.
 *
 * The consequence was measured on a real level. L2's Content v1 is published and
 * bound; its authored successor v79 was submitted for review. The queue reported
 * `contentSubmittedLevels: 0`, listed no content work at all, and the reviewer
 * who had to approve v79 could not find it from any staff surface — the id was
 * only recoverable from a markdown handoff written by the author.
 *
 * ========================= WHAT THIS MODULE DOES NOT DO =========================
 * IT DOES NOT TOUCH RUNTIME SELECTION. `pickRuntimeVersion` is not called here,
 * not wrapped, and not changed. A level with a published v1 and a submitted v2
 * keeps serving v1, and every runtime-oriented counter keeps describing v1. This
 * module ADDS a second, separately-named truth beside that one; it never
 * overwrites it. Publication remains the only thing that moves learners, and it
 * remains an admin-gated transaction this module has no part in.
 *
 * ============================== THE RULE ==============================
 * Deterministic, derived from the lifecycle columns already stored, with NO new
 * durable pointer — the source proves none is needed, because `editorialState`
 * already distinguishes every case the brief enumerates.
 *
 *   1. Consider every version of the axis that the runtime axis has not archived.
 *   2. Rank them by whose desk they are on:
 *         submitted_for_review  — blocking a REVIEWER
 *         changes_requested     — blocking an AUTHOR
 *         approved              — blocking an ADMIN (approved, not yet published)
 *         draft                 — work in progress
 *   3. The best rank wins. Within `draft`, the highest `versionNumber` wins: a
 *      newer draft supersedes an older one and nothing is waiting on either.
 *   4. Within any of the three ACTIVE ranks, a tie is genuine ambiguity — two
 *      versions of one level submitted for review is not a state anything should
 *      resolve by position or by id order. It is reported as ambiguous, the
 *      candidate is withheld, and the queue raises it for a human. FAIL CLOSED.
 *
 * THE RUNTIME VERSION IS A CANDIDATE LIKE ANY OTHER. An earlier shape of this
 * rule excluded it and ranked "the successors", which is wrong in both
 * directions and was caught on the real L2 fixture. A level with no successor
 * would have had no candidate at all; worse, `pickRuntimeVersion` returns the
 * HIGHEST version when nothing is bound — and no `LevelResourceBinding` in the
 * corpus binds an assessment — so on the assessment axis "everything except the
 * runtime version" is precisely the set of OLDER versions, and excluding the
 * runtime one handed the queue the superseded predecessor. Ranking by desk over
 * the whole set has no such asymmetry: it does not care which version the
 * runtime happens to serve, only which one somebody is waiting on.
 *
 * WHY NOT "HIGHEST versionNumber". Because it silently prefers an abandoned newer
 * draft over the successor a reviewer is actually holding, and because it is the
 * runtime tiebreak — reusing it here would rebuild the exact conflation this
 * module exists to remove.
 */
import type { EditorialState } from "@prisma/client";

/** The minimum a version must expose to be ranked. */
export type EditorialCandidateInput = {
  id: number;
  versionNumber: number;
  editorialState: EditorialState;
  /** `null` for video production, which has no runtime axis. */
  runtimeStatus?: string | null;
};

export type EditorialCandidateResolution<T extends EditorialCandidateInput> = {
  /** Null ONLY when the state is ambiguous, or the axis has no versions at all. */
  candidate: T | null;
  /** True when the chosen candidate is the level's runtime version. */
  isRuntimeVersion: boolean;
  ambiguous: boolean;
  /** The competing ids, ascending. Empty unless `ambiguous`. */
  ambiguousVersionIds: number[];
  /** Which desk the candidate is on, or null when there is nothing to work on. */
  waitingOn: EditorialWaitingOn | null;
};

export type EditorialWaitingOn = "reviewer" | "author" | "publisher" | "none";

/**
 * Rank order. Lower is more urgent. `draft` is last because nobody is blocked by
 * it, and it is the only rank whose ties are resolved rather than reported.
 */
const RANK: Record<EditorialState, number> = {
  submitted_for_review: 0,
  changes_requested: 1,
  approved: 2,
  draft: 3,
};

const WAITING_ON: Record<EditorialState, EditorialWaitingOn> = {
  submitted_for_review: "reviewer",
  changes_requested: "author",
  approved: "publisher",
  draft: "author",
};

/** The ranks where a tie is ambiguity rather than a tiebreak. */
const ACTIVE_RANKS: ReadonlySet<EditorialState> = new Set<EditorialState>([
  "submitted_for_review",
  "changes_requested",
  "approved",
]);

/**
 * Resolve the editorial candidate for ONE axis of ONE level.
 *
 * `versions` MUST already be scoped to the level. `runtimeVersionId` is the id
 * `pickRuntimeVersion` returned for the same axis — passed in rather than
 * recomputed, so the two answers are guaranteed to be about the same list.
 */
export function pickEditorialCandidate<T extends EditorialCandidateInput>(
  versions: readonly T[],
  runtimeVersionId: number | null,
): EditorialCandidateResolution<T> {
  const none: EditorialCandidateResolution<T> = {
    candidate: null,
    isRuntimeVersion: false,
    ambiguous: false,
    ambiguousVersionIds: [],
    waitingOn: null,
  };
  if (versions.length === 0) return none;

  // An archived version is off the board on the runtime axis, and there is no
  // editorial work to do on something the product has retired.
  const live = versions.filter((row) => (row.runtimeStatus ?? null) !== "archived");
  if (live.length === 0) return none;

  const bestRank = Math.min(...live.map((row) => RANK[row.editorialState]));
  const contenders = live.filter((row) => RANK[row.editorialState] === bestRank);
  const state = contenders[0].editorialState;

  if (contenders.length > 1 && ACTIVE_RANKS.has(state)) {
    // FAIL CLOSED. Choosing here would send a reviewer to one of two equally
    // truthful versions with nothing recording that the other exists.
    return {
      candidate: null,
      isRuntimeVersion: false,
      ambiguous: true,
      ambiguousVersionIds: contenders.map((row) => row.id).sort((a, b) => a - b),
      waitingOn: WAITING_ON[state],
    };
  }

  const chosen = contenders.reduce((best, row) =>
    row.versionNumber > best.versionNumber ? row : best,
  );
  return {
    candidate: chosen,
    isRuntimeVersion: chosen.id === runtimeVersionId,
    ambiguous: false,
    ambiguousVersionIds: [],
    waitingOn: WAITING_ON[chosen.editorialState],
  };
}
