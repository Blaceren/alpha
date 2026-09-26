/**
 * LO-REVIEW-WORKITEM-UNREACHABLE-1 §6/§9 — the terminal invariants.
 *
 * SEPARATE FROM `review-work-items.ts` ON PURPOSE. The integration owner needs
 * `case.ts` to create and transition cases; `case.ts` needs this invariant
 * before it writes a terminal status. Keeping the two in one module would make
 * that a circular import — which happens to work today because both uses are at
 * call time, and would break the first time either side needed a value at
 * module load. This file imports neither, so the cycle cannot form.
 *
 * WHAT IT ENFORCES. `resolved` and `closed` on a review work item assert "this
 * review is finished", which is an educational fact Learner Operations does not
 * own. A generic case-status mutation is therefore refused while the canonical
 * object is still open.
 *
 * WHY IT IS NOT A PERMISSION CHECK. A reviewer holding every permission in the
 * contract still must not complete a level by tidying a queue. This is about
 * which OBJECT decides, not about who is asking — so it is deliberately
 * unconditional and applies to every caller including an administrator.
 *
 * HOW THE CANONICAL OWNER GETS THROUGH. It reconciles AFTER its own row has
 * moved, inside the same transaction: by the time this reads the anchor, the
 * report already says `approved` or the progress already says `completed`. The
 * ordering is the authorization, and it needs no exemption, no flag and no
 * privileged actor.
 */
import type { Prisma, LearnerOpsCaseStatus } from "@prisma/client";
import { LearnerOpsError } from "@/lib/learner-ops/errors";

type Tx = Prisma.TransactionClient;

/**
 * §6 / §9 — AN OPERATIONAL STATUS MAY NOT CLAIM AN EDUCATIONAL OUTCOME.
 *
 * `resolved` and `closed` on a review work item assert "this review is
 * finished". That is an educational fact, and Learner Operations does not own
 * it. So a generic case-status mutation is refused while the canonical object
 * is still open, and the canonical owner — which reconciles through
 * `reconcileAnchoredCase` above — is the only thing that can move it there.
 *
 * WHY IT IS NOT A PERMISSION CHECK. A reviewer holding every permission in the
 * contract still must not be able to complete a level by resolving a case,
 * because the level is completed by approving the report, not by tidying the
 * queue. This is about which OBJECT decides, not about who is asking.
 *
 * HOW THE CANONICAL OWNER GETS THROUGH. It reconciles AFTER the canonical row
 * has already moved, inside the same transaction — so by the time this reads
 * the anchor, the report says `approved` and the invariant is satisfied. The
 * ordering is the authorization.
 */
export async function assertReviewWorkItemMayBecomeTerminal(
  tx: Tx,
  caseId: string,
  nextStatus: LearnerOpsCaseStatus,
): Promise<void> {
  if (nextStatus !== "resolved" && nextStatus !== "closed") return;

  const row = await tx.learnerOpsCase.findUnique({
    where: { id: caseId },
    select: { type: true, reportSubmissionId: true, userLevelProgressId: true },
  });
  if (!row) return;

  if (row.type === "report_review" && row.reportSubmissionId !== null) {
    const submission = await tx.reportSubmission.findUnique({
      where: { id: row.reportSubmissionId },
      select: { status: true },
    });
    if (submission && submission.status !== "approved") {
      throw new LearnerOpsError(
        "LEARNER_OPS_CANONICAL_REVIEW_OPEN",
        `report ${row.reportSubmissionId} is ${submission.status}; only approving the report finishes this review`,
      );
    }
  }

  if (row.type === "mentor_review" && row.userLevelProgressId !== null) {
    const progress = await tx.userLevelProgress.findUnique({
      where: { id: row.userLevelProgressId },
      select: { status: true },
    });
    if (progress && progress.status !== "completed") {
      throw new LearnerOpsError(
        "LEARNER_OPS_CANONICAL_REVIEW_OPEN",
        `mentor review ${row.userLevelProgressId} is ${progress.status}; only canonical approval finishes this review`,
      );
    }
  }
}

/**
 * The same question, asked for the allowed-transition PROJECTION rather than
 * for a write. Returns the states that must be withheld from a screen because
 * the domain would refuse them — so LO-UI-TRANSITION-CHOICES-1 does not
 * regress into offering a resolve that cannot succeed.
 */
export async function terminalStatesBlockedByCanonicalReview(
  tx: Tx,
  caseId: string,
): Promise<boolean> {
  try {
    await assertReviewWorkItemMayBecomeTerminal(tx, caseId, "resolved");
    return false;
  } catch (error) {
    if (error instanceof LearnerOpsError && error.code === "LEARNER_OPS_CANONICAL_REVIEW_OPEN") {
      return true;
    }
    throw error;
  }
}
