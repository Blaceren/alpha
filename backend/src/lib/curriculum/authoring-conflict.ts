/**
 * PHASE-G1 — the Blueprint-proposal vs approved-bank comparison (§15, §16).
 *
 * WHAT THIS IS FOR. L2 carries seven recorded field-level disagreements between
 * the Blueprint's PROPOSED_CANON question bank and the assessment that is
 * already approved and bound in Backend. G0 deliberately did not resolve them:
 * the package keeps the approved bank as platform truth, the contract keeps the
 * proposal, and promoting one over the other is an editorial decision nobody has
 * made. What was missing was a way for a reviewer to SEE the disagreement.
 *
 * IT IS DERIVED FROM SERVER TRUTH, NOT FROM THE SOURCE FILE. The proposal is
 * read from the durable `VideoProductionVersion.contractPayload` and the current
 * value from the durable `AssessmentVersion` rows, through the SAME accepted
 * `projectAssessmentBank` the coherence fingerprint uses. Nothing here opens
 * `curriculum/canonical/ata-video-production-contracts.v1.json` at request time,
 * and nothing here re-implements how a bank is read.
 *
 * READ-ONLY IN G1, AND THAT IS A DECISION. The Backend contains no conflict
 * RESOLUTION domain — there is no accepted command that promotes a proposal over
 * an approved bank, decides which wording wins, or records that a human chose.
 * Inventing one merely so the UI had a button would be exactly the "resolution
 * invented for UI completeness" §16 forbids. So this module compares and stops,
 * and there is deliberately no bulk action anywhere above it: resolving L2 is
 * classified as G2 product work.
 *
 * WHICH FIELDS. `prompt` and `correctAnswerText`, per question ordinal — the two
 * the accepted `sourceConflicts` records name, and the two that change what a
 * learner is asked and what counts as right. Option ORDER and distractor wording
 * are not compared: they differ harmlessly between a brief and a shipped bank,
 * and reporting them would bury the seven that matter.
 */
import { Prisma } from "@prisma/client";
import {
  projectAssessmentBank,
  type AssessmentBankProjection,
} from "@/lib/curriculum/authoring-assessment-projection";
import { isAuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import type { VideoProductionContract } from "@/lib/curriculum/video-production-contract";

type DbClient = Prisma.TransactionClient;

export const BLUEPRINT_CONFLICT_FIELDS = ["prompt", "correctAnswerText"] as const;
export type BlueprintConflictField = (typeof BLUEPRINT_CONFLICT_FIELDS)[number];

export type BlueprintConflict = {
  /** Zero-based question ordinal, matching the accepted `sourceConflicts` paths. */
  questionIndex: number;
  field: BlueprintConflictField;
  /** `questions[0].prompt` — the exact accepted path grammar. */
  path: string;
  /** What the platform serves today: the approved, bound bank. */
  currentApprovedValue: string;
  /** What the Blueprint proposes instead. */
  blueprintProposalValue: string;
};

export type BlueprintComparison = {
  assessmentVersionId: number;
  videoProductionVersionId: number;
  levelNumber: number;
  /** Null when the bank cannot be projected — reported, never guessed around. */
  comparable: boolean;
  unprojectableReason: string | null;
  conflicts: BlueprintConflict[];
};

function correctOptionText(contract: VideoProductionContract, index: number): string {
  const question = contract.questions[index];
  if (!question) return "";
  const option = question.options.find((entry) => entry.optionCode === question.correctOptionCode);
  return option?.text ?? "";
}

function bankCorrectOptionText(bank: AssessmentBankProjection, index: number): string {
  const question = bank.questions[index];
  if (!question) return "";
  const option = question.options.find((entry) => entry.optionCode === question.correctOptionCode);
  return option?.text ?? "";
}

/**
 * Compare on the EXACT stored strings.
 *
 * No trimming beyond what the schemas already applied, no case folding and no
 * whitespace collapsing. A reviewer looking at this surface is deciding which
 * sentence ships; normalising the two sides would hide a difference that is
 * precisely what they were asked to judge.
 */
function differs(a: string, b: string): boolean {
  return a !== b;
}

export async function compareBlueprintProposal(
  tx: DbClient,
  input: { contract: VideoProductionContract; assessmentVersionId: number; videoProductionVersionId: number },
): Promise<BlueprintComparison> {
  const base = {
    assessmentVersionId: input.assessmentVersionId,
    videoProductionVersionId: input.videoProductionVersionId,
    levelNumber: input.contract.levelNumber,
  };

  let bank: AssessmentBankProjection;
  try {
    bank = await projectAssessmentBank(tx, input.assessmentVersionId);
  } catch (error) {
    if (!isAuthoringDomainError(error)) throw error;
    return {
      ...base,
      comparable: false,
      unprojectableReason: error.code,
      conflicts: [],
    };
  }

  const conflicts: BlueprintConflict[] = [];
  const count = Math.min(input.contract.questions.length, bank.questions.length);

  for (let index = 0; index < count; index += 1) {
    const proposal = input.contract.questions[index];
    const current = bank.questions[index];

    if (differs(current.prompt, proposal.prompt)) {
      conflicts.push({
        questionIndex: index,
        field: "prompt",
        path: `questions[${index}].prompt`,
        currentApprovedValue: current.prompt,
        blueprintProposalValue: proposal.prompt,
      });
    }

    const currentAnswer = bankCorrectOptionText(bank, index);
    const proposedAnswer = correctOptionText(input.contract, index);
    if (differs(currentAnswer, proposedAnswer)) {
      conflicts.push({
        questionIndex: index,
        field: "correctAnswerText",
        path: `questions[${index}].correctAnswerText`,
        currentApprovedValue: currentAnswer,
        blueprintProposalValue: proposedAnswer,
      });
    }
  }

  // Ordered by path so two reads of an unchanged database produce the identical
  // list — the same determinism the handoff bundle depends on.
  conflicts.sort((a, b) =>
    a.questionIndex === b.questionIndex
      ? a.field.localeCompare(b.field)
      : a.questionIndex - b.questionIndex,
  );

  return { ...base, comparable: true, unprojectableReason: null, conflicts };
}

/** The count alone, for the overview. Same comparison, no strings on the wire. */
export async function countBlueprintConflicts(
  tx: DbClient,
  input: { contract: VideoProductionContract; assessmentVersionId: number },
): Promise<number> {
  const comparison = await compareBlueprintProposal(tx, {
    contract: input.contract,
    assessmentVersionId: input.assessmentVersionId,
    videoProductionVersionId: 0,
  });
  return comparison.conflicts.length;
}
