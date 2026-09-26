/**
 * PHASE-G2 SUCCESSOR — THE AUTHORING CANDIDATE, as a first-class idea.
 *
 * ============================ WHAT WAS MISSING ============================
 * The platform had exactly one way to answer "which version of this level?" —
 * `pickWorkingVersion`, which prefers the version named by `LevelResourceBinding`
 * and otherwise takes the highest `versionNumber`. That is the RUNTIME answer:
 * the binding is what a learner follows.
 *
 * Authoring needs a different answer. Once a published v1 is bound and a draft
 * successor v2 exists, the level has two truthful versions at once, and every
 * authoring surface — the Studio workspace, validation, submit, approve — was
 * asking the runtime question and acting on the answer. The independent audit
 * measured the consequence: a successor repaired to perfection still failed
 * submission, because the validator judged the defective bound predecessor and
 * the candidate id the route already held was thrown away on the line before.
 *
 * ========================= WHAT THIS MODULE ADDS =========================
 * A name for the second answer, and one resolver that produces it. A caller that
 * knows which version it means says so; a caller that does not gets the accepted
 * runtime fallback, unchanged. There is no third behaviour and no default that
 * silently guesses a draft — "highest draft wins" would quietly move learners,
 * which is precisely what this design refuses.
 *
 * =========================== FAIL CLOSED, ALWAYS ===========================
 * A supplied id is verified against candidates ALREADY SCOPED to the level and
 * curriculum version. An id from another level is therefore absent from the list
 * and refused — the cross-level guard is a property of the query rather than a
 * check somebody has to remember. There is no branch here that resolves to a
 * version on the ABSENCE of information.
 *
 * IT SELECTS; IT NEVER ACTIVATES. Nothing in this module writes, and nothing here
 * touches `LevelResourceBinding`. Choosing a candidate to validate or preview has
 * no runtime consequence whatsoever — moving learners stays exactly where it was,
 * behind the admin-gated publish transaction.
 */
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";

/** The three authoring axes a level can carry. */
export type AuthoringCandidateAxis = "content" | "assessment" | "video_production";

/**
 * WHICH version the caller means, per axis. Every field optional.
 *
 * Optional is the whole ergonomics of this type: a submit route knows the axis it
 * is acting on and nothing about the other two, and forcing it to name all three
 * would make it invent answers. An omitted axis resolves exactly as it always did.
 */
export type AuthoringCandidateSelection = {
  contentVersionId?: number | null;
  assessmentVersionId?: number | null;
  videoProductionVersionId?: number | null;
};

const AXIS_LABEL: Record<AuthoringCandidateAxis, string> = {
  content: "ContentVersion",
  assessment: "AssessmentVersion",
  video_production: "VideoProductionVersion",
};

/**
 * WHICH VERSION IS THE LEVEL'S RUNTIME VERSION — the accepted rule, verbatim.
 *
 * Duplicated nowhere. `authoring-read` re-exports its own binding of this so the
 * overview keeps its existing import surface, and `authoring-validation-service`
 * no longer carries the private copy that let Content and Assessment resolve by
 * two different rules on one level.
 *
 * The binding wins; with no binding the highest `versionNumber` wins. Unchanged,
 * on purpose: this function is what learners depend on, and this phase changes
 * nothing a learner can observe.
 */
export function pickRuntimeVersion<T extends { id: number; versionNumber: number }>(
  candidates: readonly T[],
  boundId: number | null | undefined,
): T | null {
  if (candidates.length === 0) return null;
  if (boundId !== null && boundId !== undefined) {
    const bound = candidates.find((candidate) => candidate.id === boundId);
    if (bound) return bound;
  }
  return candidates.reduce((best, candidate) =>
    candidate.versionNumber > best.versionNumber ? candidate : best,
  );
}

/**
 * THE ONE RESOLVER. An explicit candidate if the caller named one, otherwise the
 * runtime version.
 *
 * `candidates` MUST already be filtered to the level being authored. Every caller
 * loads them with `where: { levelDefinitionId }`, which is what makes the refusal
 * below a genuine cross-level guard rather than a hopeful one.
 */
export function resolveCandidate<T extends { id: number; versionNumber: number }>(
  candidates: readonly T[],
  requestedId: number | null | undefined,
  boundId: number | null | undefined,
  axis: AuthoringCandidateAxis,
  levelDefinitionId: number,
): T | null {
  if (requestedId === null || requestedId === undefined) {
    return pickRuntimeVersion(candidates, boundId);
  }
  const chosen = candidates.find((candidate) => candidate.id === requestedId);
  if (!chosen) {
    // REFUSED, NOT IGNORED, and never quietly downgraded to the runtime version.
    // A caller that names a version it may not have is asking a question about
    // something else entirely; answering it about the bound predecessor would be
    // the same silent substitution this phase exists to remove.
    throw new AuthoringDomainError(
      "AUTHORING_CANDIDATE_INVALID",
      `${AXIS_LABEL[axis]} ${requestedId} does not belong to level ${levelDefinitionId}`,
      {
        issues: [
          {
            code: "AUTHORING_CANDIDATE_FOREIGN",
            path: `candidate.${axis}`,
            message: `${AXIS_LABEL[axis]} ${requestedId} is not a version of level ${levelDefinitionId}, so it cannot be authored, validated or approved as one`,
          },
        ],
      },
    );
  }
  return chosen;
}

/**
 * Fold one axis into a candidate selection, for a caller that knows exactly one.
 *
 * Submit and approve act on a single `(kind, id)` and know nothing about the
 * other two axes. This turns that into a selection without making the route
 * reason about which field name an axis maps to — a mapping that, written out at
 * each call site, is exactly where a content id eventually lands in the
 * assessment slot.
 */
export function candidateForAxis(
  axis: AuthoringCandidateAxis,
  id: number,
): AuthoringCandidateSelection {
  switch (axis) {
    case "content":
      return { contentVersionId: id };
    case "assessment":
      return { assessmentVersionId: id };
    case "video_production":
      return { videoProductionVersionId: id };
  }
}
