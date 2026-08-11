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
 *   everything else -> no resource requirement here
 *
 * ONLY `assessment_pass` IS GATED, AND THAT IS A DELIBERATE LIMIT. The rule
 * enforced here is exactly the one the runtime already enforces: `assessment-
 * runtime` refuses a level whose binding is absent, foreign, or names a bank
 * that is not `published` with a `publishedAt`. So this gate adds no new product
 * rule — it moves an existing runtime requirement earlier, to the last moment
 * something can still be done about it.
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
    if (!ASSESSMENT_BACKED.has(level.completionMethod)) continue;

    const ref = `level:${level.levelNumber}`;
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
