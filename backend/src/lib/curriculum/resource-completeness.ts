/**
 * PUBLICATION RESOURCE COMPLETENESS — the gate that makes an unusable curriculum
 * unpublishable.
 *
 * WHAT WENT WRONG WITHOUT IT. `validateCurriculumDraft` reads a snapshot of
 * `{version, modules, levels}` and nothing else, so it can prove the SHAPE of a
 * curriculum — numbering, ranges, prerequisites, stable codes — while knowing
 * nothing about whether any level can actually be completed. `ata-v2@v3` passed
 * every one of those 39 checks and published with 58 `assessment_pass` levels
 * that had no assessment bound to them. The result is a curriculum that is
 * simultaneously valid, published, immutable and impossible to progress through:
 * level 2 can never be completed, so levels 3..100 are unreachable, and
 * `assertParentDraft` means no accepted operation can ever repair it.
 *
 * SO THE MISSING CHECK IS REACHABILITY OF THE COMPLETION OWNER, and it is
 * checked HERE — on the way into `published`, in the same transaction, from
 * durable state — rather than at import time, because a draft is allowed to be
 * incomplete while it is being assembled. Publication is the moment
 * incompleteness stops being a work-in-progress and becomes a defect.
 *
 * TYPE-AWARE, DELIBERATELY. A `financial_checkpoint` has no ContentVersion and
 * must never be required to have one; the accepted G2 curriculum has 22 such
 * levels (20 checkpoints, 1 external event, 1 report) and they are correct. The
 * rule is per completion method, not per level:
 *
 *   assessment_pass -> exactly one binding naming a runtime-valid published
 *                      assessment that belongs to this level and this version
 *   report_approval -> a LevelReportBinding whose assignment and rubric both
 *                      belong to this level/version and whose rubric is published
 *   balance_check   -> a LevelCheckpointRequirement whose integrationCode is the
 *                      level's own, with a positive integer threshold
 *   everything else -> no resource requirement here
 *
 * EVERY RULE HERE MIRRORS ONE THE RUNTIME ALREADY ENFORCES, and none is a new
 * product rule. `assessment-runtime` refuses a level whose binding is absent,
 * foreign, or names a bank that is not `published` with a `publishedAt`.
 * `report-submission` resolves the assignment and rubric through
 * `LevelReportBinding` and refuses without one. `checkpoint-verification`
 * returns `CHECKPOINT_REQUIREMENT_UNCONFIGURED` without a requirement row. All
 * three move an existing runtime requirement earlier, to the last moment
 * something can still be done about it.
 *
 * THE REPORT AND CHECKPOINT RULES SHIPPED WITH THEIR MATERIALIZATION, IN ONE
 * CHANGE, AND THAT PAIRING IS THE POINT. Before package revision 2 neither owner
 * could exist: the package had no field for a rubric or a threshold, so adding
 * these rules on their own would have made every version of this product
 * unpublishable — a gate with no reachable passing state is a deadlock, not a
 * safety property. The importer now materializes both from the package, so the
 * gate has something to pass.
 *
 * `manual` and `mentor_review` levels are NOT required to carry content, because
 * nothing in the current contract requires it: `manual-completion` never reads a
 * content binding, and a level completes without one. Requiring it here would be
 * inventing a product rule under the cover of a defect correction, and it would
 * refuse curricula the accepted regression suites publish today. Whether a
 * content-less lesson is desirable is a real product question; it is not this
 * one, and it is recorded for the owning team rather than decided here.
 *
 * WHAT THIS DOES NOT DO. It does not check that an external provider is
 * configured, or that a flag is on. Those are deployment facts that change after
 * publication and would make publication depend on runtime configuration. This
 * checks only what the curriculum itself must carry.
 */
import type { Prisma } from "@prisma/client";

import type { CurriculumValidationIssue } from "@/lib/curriculum/types";

/** Completion methods whose level must carry a runtime-valid assessment. */
const ASSESSMENT_BACKED = new Set(["assessment_pass"]);

/** Completion methods whose level must carry a runtime-valid report owner. */
const REPORT_BACKED = new Set(["report_approval"]);

/** Completion methods whose level must carry a checkpoint requirement. */
const CHECKPOINT_BACKED = new Set(["balance_check"]);

export async function validateCurriculumResourceCompleteness(
  tx: Prisma.TransactionClient,
  curriculumVersionId: number,
): Promise<CurriculumValidationIssue[]> {
  const issues: CurriculumValidationIssue[] = [];

  const levels = await tx.levelDefinition.findMany({
    where: { curriculumVersionId, status: "active" },
    orderBy: { levelNumber: "asc" },
  });

  for (const level of levels) {
    const ref = `level:${level.levelNumber}`;

    if (REPORT_BACKED.has(level.completionMethod)) {
      const binding = await tx.levelReportBinding.findUnique({
        where: { levelDefinitionId: level.id },
      });
      if (!binding) {
        issues.push({
          code: "LEVEL_REPORT_BINDING_MISSING",
          entity: "level",
          reference: ref,
          message: `level ${level.levelNumber} (${level.stableCode}) completes by report_approval but has no report binding`,
        });
        continue;
      }
      if (binding.curriculumVersionId !== curriculumVersionId) {
        issues.push({
          code: "LEVEL_REPORT_BINDING_FOREIGN",
          entity: "level",
          reference: ref,
          message: `level ${level.levelNumber} (${level.stableCode}) is bound to a report that belongs to another curriculum version`,
        });
        continue;
      }
      const assignment = await tx.reportAssignmentVersion.findUnique({
        where: { id: binding.reportAssignmentVersionId },
      });
      if (
        !assignment ||
        assignment.levelDefinitionId !== level.id ||
        assignment.curriculumVersionId !== curriculumVersionId
      ) {
        issues.push({
          code: "LEVEL_REPORT_BINDING_FOREIGN",
          entity: "level",
          reference: ref,
          message: `level ${level.levelNumber} (${level.stableCode}) is bound to a report assignment that does not belong to it`,
        });
        continue;
      }
      const rubric = await tx.reportRubricVersion.findUnique({
        where: { id: binding.reportRubricVersionId },
      });
      if (!rubric || rubric.reportAssignmentVersionId !== assignment.id) {
        issues.push({
          code: "LEVEL_REPORT_RUBRIC_FOREIGN",
          entity: "level",
          reference: ref,
          message: `level ${level.levelNumber} (${level.stableCode}) is bound to a rubric that does not belong to its report assignment`,
        });
      } else if (rubric.status !== "published" || !rubric.publishedAt) {
        // A mentor reviews against a PUBLISHED rubric. An unpublished one can be
        // bound and then leaves every submission unreviewable.
        issues.push({
          code: "LEVEL_REPORT_RUBRIC_NOT_PUBLISHED",
          entity: "level",
          reference: ref,
          message: `level ${level.levelNumber} (${level.stableCode}) is bound to rubric version ${rubric.versionNumber}, which is "${rubric.status}" — a review needs a published rubric`,
        });
      }
      continue;
    }

    if (CHECKPOINT_BACKED.has(level.completionMethod)) {
      const requirement = await tx.levelCheckpointRequirement.findUnique({
        where: { levelDefinitionId: level.id },
      });
      if (!requirement) {
        issues.push({
          code: "LEVEL_CHECKPOINT_REQUIREMENT_MISSING",
          entity: "level",
          reference: ref,
          message: `level ${level.levelNumber} (${level.stableCode}) completes by balance_check but has no checkpoint requirement`,
        });
        continue;
      }
      // The requirement must name the level's OWN integration, which the level
      // records in `featureUnlockCode` at import. A requirement pointing at
      // another module's checkpoint would verify the wrong threshold.
      if (level.featureUnlockCode && requirement.integrationCode !== level.featureUnlockCode) {
        issues.push({
          code: "LEVEL_CHECKPOINT_REQUIREMENT_FOREIGN",
          entity: "level",
          reference: ref,
          message: `level ${level.levelNumber} (${level.stableCode}) declares integration ${level.featureUnlockCode} but its requirement names ${requirement.integrationCode}`,
        });
        continue;
      }
      if (!Number.isSafeInteger(requirement.thresholdMinorUnits) || requirement.thresholdMinorUnits <= 0) {
        issues.push({
          code: "LEVEL_CHECKPOINT_THRESHOLD_INVALID",
          entity: "level",
          reference: ref,
          message: `level ${level.levelNumber} (${level.stableCode}) has a non-positive checkpoint threshold`,
        });
      }
      continue;
    }

    if (!ASSESSMENT_BACKED.has(level.completionMethod)) continue;

    const binding = await tx.levelResourceBinding.findUnique({
      where: { levelDefinitionId: level.id },
    });

    if (!binding?.assessmentVersionId) {
      issues.push({
        code: "LEVEL_ASSESSMENT_BINDING_MISSING",
        entity: "level",
        reference: ref,
        message: `level ${level.levelNumber} (${level.stableCode}) completes by assessment_pass but has no assessment binding`,
      });
      continue;
    }

    const assessment = await tx.assessmentVersion.findUnique({
      where: { id: binding.assessmentVersionId },
    });
    if (
      !assessment ||
      assessment.levelDefinitionId !== level.id ||
      assessment.curriculumVersionId !== curriculumVersionId
    ) {
      issues.push({
        code: "LEVEL_ASSESSMENT_BINDING_FOREIGN",
        entity: "level",
        reference: ref,
        message: `level ${level.levelNumber} (${level.stableCode}) is bound to an assessment that does not belong to it`,
      });
    } else if (assessment.status !== "published" || !assessment.publishedAt) {
      issues.push({
        code: "LEVEL_ASSESSMENT_NOT_PUBLISHED",
        entity: "level",
        reference: ref,
        message: `level ${level.levelNumber} (${level.stableCode}) is bound to assessment version ${assessment.versionNumber}, which is "${assessment.status}" — the runtime serves only a published assessment`,
      });
    }
  }

  return issues;
}
