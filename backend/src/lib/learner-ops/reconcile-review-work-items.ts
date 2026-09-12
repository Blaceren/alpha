/**
 * LO-REVIEW-WORKITEM-UNREACHABLE-1 §12 — repair of MISSING DERIVED state.
 *
 * WHAT THIS IS FOR, STATED PRECISELY SO IT IS NOT MISREAD.
 * Canonical educational reviews that reached `pending_review` BEFORE the
 * integration existed have no operational mirror, and never will: the work item
 * is created by the canonical transition, and theirs already happened. This
 * rebuilds the missing mirror by calling the SAME `ensure` owner the runtime
 * calls — not a parallel implementation, not raw SQL, and not a special case
 * for any particular row.
 *
 * WHAT IT IS NOT. It is not repair of canonical truth. It reads
 * `ReportSubmission` and `UserLevelProgress` and writes NEITHER. It cannot
 * approve, reject, complete, advance or rewind anything: the only write path it
 * has is "create the operational case that should already exist, in the state
 * the canonical object is already in". If the canonical object is wrong, this
 * tool leaves it wrong, which is the correct behaviour for something that
 * exists to mirror it.
 *
 * WHY IT IS GENERIC AND NOT A ONE-OFF FOR SUBMISSION 8. A script hardcoded to
 * one row would have to be written again for the mentor learner, again for
 * whatever else predates the fix, and would carry no proof that the general
 * invariant holds. This asks the invariant directly — "every pending canonical
 * review has exactly one anchored work item" — and closes the gaps it finds. It
 * is also the query §11 asks for, which is why `inspect` returns the full
 * picture rather than just a count.
 *
 * BOUNDED BY DEFAULT. `apply: false` is the default and reports without
 * writing, so the proposed set can be read before anything happens — §13
 * requires exactly that before a global run.
 *
 * IDEMPOTENT. It creates only what is missing. A second run finds nothing.
 */
import { prisma } from "@/lib/prisma";
import {
  ensureReportReviewWorkItem,
  ensureMentorReviewWorkItem,
  reconcileReportReviewOperationalState,
  reconcileMentorReviewOperationalState,
} from "@/lib/learner-ops/review-work-items";

export type ReviewReconciliationRow = {
  readonly kind: "report" | "mentor";
  /** The canonical object's id — a report submission, or a progress row. */
  readonly canonicalId: number;
  readonly userId: number;
  readonly levelNumber: number;
  readonly canonicalState: string;
  readonly hasWorkItem: boolean;
};

export type ReviewReconciliationReport = {
  readonly applied: boolean;
  readonly pendingReports: number;
  readonly pendingMentorReviews: number;
  readonly reportsMissingWorkItem: number;
  readonly mentorReviewsMissingWorkItem: number;
  readonly reportsRepaired: number;
  readonly mentorReviewsRepaired: number;
  /** Operational cases whose canonical object has vanished. Should always be 0. */
  readonly orphanedWorkItems: number;
  readonly rows: readonly ReviewReconciliationRow[];
};

/**
 * The canonical states that MUST have an operational mirror.
 *
 * `rejected` is included on purpose: a report awaiting the learner's
 * resubmission is still live operational work — somebody is waiting, the SLA
 * clock is paused rather than stopped, and the case is how ATA knows to chase
 * it. Excluding it would leave a silent class of abandoned reviews.
 */
const REPORT_STATES_NEEDING_WORK_ITEM = ["pending_review", "rejected"] as const;

export async function reconcileReviewWorkItems(
  options: { apply?: boolean } = {},
): Promise<ReviewReconciliationReport> {
  const apply = options.apply === true;
  const rows: ReviewReconciliationRow[] = [];
  let reportsRepaired = 0;
  let mentorReviewsRepaired = 0;

  const reports = await prisma.reportSubmission.findMany({
    where: { status: { in: [...REPORT_STATES_NEEDING_WORK_ITEM] } },
    select: {
      id: true,
      userId: true,
      status: true,
      levelDefinition: { select: { levelNumber: true, title: true } },
      learnerOpsCases: { select: { id: true } },
    },
    orderBy: { id: "asc" },
  });

  for (const report of reports) {
    const hasWorkItem = report.learnerOpsCases.length > 0;
    rows.push({
      kind: "report",
      canonicalId: report.id,
      userId: report.userId,
      levelNumber: report.levelDefinition.levelNumber,
      canonicalState: report.status,
      hasWorkItem,
    });
    if (hasWorkItem || !apply) continue;

    // ONE TRANSACTION PER CANONICAL OBJECT. A single transaction over every row
    // would make one unexpected refusal discard every repair before it, and
    // these are independent facts — there is no invariant that spans two
    // different learners' reviews.
    await prisma.$transaction(async (tx) => {
      await ensureReportReviewWorkItem(tx, {
        submissionId: report.id,
        userId: report.userId,
        levelNumber: report.levelDefinition.levelNumber,
        levelTitle: report.levelDefinition.title,
        // No human performed this. Recording a member of staff would be a lie
        // about who acted, and the timeline says "system" instead.
        actor: null,
      });
      // Put it straight into the state the canonical object is ALREADY in, so a
      // repaired case is indistinguishable from one the runtime created.
      await reconcileReportReviewOperationalState(tx, {
        submissionId: report.id,
        canonicalState: report.status === "rejected" ? "rejected" : "pending_review",
        actor: null,
        reason: "reconcile:missing_work_item",
      });
    });
    reportsRepaired += 1;
  }

  const mentorReviews = await prisma.userLevelProgress.findMany({
    where: { status: "pending_review" },
    select: {
      id: true,
      status: true,
      levelDefinition: { select: { levelNumber: true, title: true, type: true, completionMethod: true } },
      enrollment: { select: { userId: true } },
      learnerOpsCases: { select: { id: true } },
    },
    orderBy: { id: "asc" },
  });

  for (const progress of mentorReviews) {
    // A report level's progress row is ALSO `pending_review` while its report
    // is being reviewed, and that review's mirror is anchored to the report,
    // not to the progress row. Creating a second mentor_review case for it
    // would be a duplicate of the same piece of work under a different name.
    if (progress.levelDefinition.completionMethod !== "mentor_review") continue;

    const hasWorkItem = progress.learnerOpsCases.length > 0;
    rows.push({
      kind: "mentor",
      canonicalId: progress.id,
      userId: progress.enrollment.userId,
      levelNumber: progress.levelDefinition.levelNumber,
      canonicalState: progress.status,
      hasWorkItem,
    });
    if (hasWorkItem || !apply) continue;

    await prisma.$transaction(async (tx) => {
      await ensureMentorReviewWorkItem(tx, {
        userLevelProgressId: progress.id,
        userId: progress.enrollment.userId,
        levelNumber: progress.levelDefinition.levelNumber,
        levelTitle: progress.levelDefinition.title,
        actor: null,
      });
      await reconcileMentorReviewOperationalState(tx, {
        userLevelProgressId: progress.id,
        canonicalState: "pending_review",
        actor: null,
        reason: "reconcile:missing_work_item",
      });
    });
    mentorReviewsRepaired += 1;
  }

  // §11's OTHER direction: an operational review case whose canonical object no
  // longer exists. The anchor is a foreign key with a CHECK forbidding a NULL
  // on these types, so this should be structurally impossible — it is counted
  // rather than assumed, because "impossible" is a claim worth measuring.
  const orphanedWorkItems = await prisma.learnerOpsCase.count({
    where: {
      OR: [
        { type: "report_review", reportSubmissionId: null },
        { type: "mentor_review", userLevelProgressId: null },
      ],
    },
  });

  return {
    applied: apply,
    pendingReports: reports.length,
    pendingMentorReviews: rows.filter((row) => row.kind === "mentor").length,
    reportsMissingWorkItem: rows.filter((row) => row.kind === "report" && !row.hasWorkItem).length,
    mentorReviewsMissingWorkItem: rows.filter((row) => row.kind === "mentor" && !row.hasWorkItem).length,
    reportsRepaired,
    mentorReviewsRepaired,
    orphanedWorkItems,
    rows,
  };
}
