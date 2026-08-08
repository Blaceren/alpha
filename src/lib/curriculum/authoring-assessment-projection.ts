/**
 * PHASE-G0 CORRECTION — projecting the DURABLE assessment bank into the shape
 * the accepted Phase-C fingerprint function already consumes.
 *
 * THE DEFECT THIS CLOSES. G0 stored an `assessmentFingerprint` on
 * VideoProductionVersion, but it was computed from the video contract's OWN
 * embedded questions. Both sides of every coherence comparison were therefore
 * derived from the same JSON document, so editing the real question bank —
 * the rows a learner is actually graded against — could never make video
 * evidence stale. The independent audit proved it: changing the correct answer
 * of a linked AssessmentVersion left `productionEvidenceStale` false.
 *
 * NO SECOND HASH. This module computes nothing. It reads rows and returns the
 * exact input object `calculateAssessmentFingerprint` already accepts, and that
 * accepted function does the hashing. If the fingerprint definition ever
 * changes, it changes in one place and this projection follows automatically.
 *
 * WHAT THE BANK PROJECTION DELIBERATELY CONTAINS.
 *   • `levelCode`  — the level's durable stableCode.
 *   • `takes`      — the T{level}.1..4 IDENTITIES the accepted contract defines,
 *                    with EMPTY text. This is the important design decision:
 *                    take TEXT is a video-production artifact that lives in the
 *                    contract payload and is already covered by
 *                    `contractFingerprint`. Including it here would mean
 *                    rewriting a shot's wording marked the QUESTION BANK as
 *                    changed, which is false and would train reviewers to
 *                    ignore the warning. Leaving it out makes this fingerprint a
 *                    pure function of the durable bank, which is the whole point.
 *   • `questions`  — prompt, option texts, option codes, the correct answer and
 *                    the take binding, read from QuestionDefinition and its
 *                    canonical QuestionLocalization.
 *
 * FAIL CLOSED. A bank that cannot be projected — wrong cardinality, a missing
 * canonical localization, an option set that does not match the accepted
 * four-option contract — raises rather than producing a fingerprint over
 * partial data. A fingerprint computed from an incomplete read would silently
 * declare coherence that was never checked.
 */
import { Prisma } from "@prisma/client";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import {
  ATA_VIDEO_OPTIONS_PER_QUESTION,
  ATA_VIDEO_QUESTIONS_PER_LESSON,
  ATA_VIDEO_TAKES_PER_LESSON,
  calculateAssessmentFingerprint,
  takeIdFor,
} from "@/lib/curriculum/video-production-contract";

type DbClient = Prisma.TransactionClient;

/** The locale the ATA bank is authored in. The fingerprint is over this one. */
export const CANONICAL_ASSESSMENT_LOCALE = "ru";

const OPTION_CODES = ["a", "b", "c", "d"] as const;
type OptionCode = (typeof OPTION_CODES)[number];

function isOrdinal(value: number): value is Ordinal {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function fail(message: string): never {
  throw new AuthoringDomainError("AUTHORING_ASSESSMENT_PROJECTION_INVALID", message);
}

function readOptionCodes(raw: unknown, reference: string): OptionCode[] {
  if (!Array.isArray(raw)) fail(`${reference}: options must be an array`);
  const codes = raw.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${reference}: each option must be an object`);
    }
    const code = (entry as { code?: unknown }).code;
    if (typeof code !== "string") fail(`${reference}: option code must be a string`);
    if (!(OPTION_CODES as readonly string[]).includes(code)) {
      fail(`${reference}: option code "${code}" is outside the accepted a|b|c|d contract`);
    }
    return code as OptionCode;
  });
  if (codes.length !== ATA_VIDEO_OPTIONS_PER_QUESTION) {
    fail(`${reference}: expected ${ATA_VIDEO_OPTIONS_PER_QUESTION} options, found ${codes.length}`);
  }
  if (new Set(codes).size !== codes.length) fail(`${reference}: duplicate option code`);
  return codes;
}

function readCorrectCode(raw: unknown, reference: string, codes: readonly OptionCode[]): OptionCode {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`${reference}: correctAnswer must be an object`);
  }
  const code = (raw as { code?: unknown }).code;
  if (typeof code !== "string") fail(`${reference}: correctAnswer.code must be a string`);
  if (!codes.includes(code as OptionCode)) {
    fail(`${reference}: correctAnswer "${code}" is not one of this question's options`);
  }
  return code as OptionCode;
}

function readOptionLabels(raw: unknown, reference: string, codes: readonly OptionCode[]): Map<OptionCode, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`${reference}: optionLabels must be an object keyed by option code`);
  }
  const labels = new Map<OptionCode, string>();
  for (const code of codes) {
    const text = (raw as Record<string, unknown>)[code];
    if (typeof text !== "string" || text.trim().length === 0) {
      fail(`${reference}: optionLabels["${code}"] is missing`);
    }
    labels.set(code, text);
  }
  return labels;
}

/** The accepted contract fixes both cardinalities at four. */
type Ordinal = 1 | 2 | 3 | 4;

export type AssessmentBankProjection = {
  levelCode: string;
  takes: { takeId: string; ordinal: Ordinal; text: string }[];
  questions: {
    questionId: string;
    ordinal: Ordinal;
    prompt: string;
    takeId: string;
    correctOptionCode: OptionCode;
    options: { optionCode: OptionCode; text: string; correct: boolean }[];
  }[];
};

/**
 * Read one AssessmentVersion and return the accepted fingerprint input.
 *
 * `levelNumber` and `levelCode` come from the LevelDefinition the bank belongs
 * to, not from the caller, so a caller cannot shift a bank onto another level's
 * take identities and manufacture a matching fingerprint.
 */
export async function projectAssessmentBank(
  tx: DbClient,
  assessmentVersionId: number,
): Promise<AssessmentBankProjection> {
  const version = await tx.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    select: {
      id: true,
      levelDefinition: { select: { levelNumber: true, stableCode: true } },
      questions: {
        where: { status: "active" },
        orderBy: { questionNumber: "asc" },
        select: {
          id: true,
          questionNumber: true,
          stableKey: true,
          options: true,
          correctAnswer: true,
          localizations: {
            where: { locale: CANONICAL_ASSESSMENT_LOCALE },
            select: { prompt: true, optionLabels: true },
          },
        },
      },
    },
  });

  if (!version) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `AssessmentVersion ${assessmentVersionId} does not exist`,
    );
  }

  const levelNumber = version.levelDefinition.levelNumber;
  const levelCode = version.levelDefinition.stableCode;

  if (version.questions.length !== ATA_VIDEO_QUESTIONS_PER_LESSON) {
    fail(
      `AssessmentVersion ${assessmentVersionId}: expected ${ATA_VIDEO_QUESTIONS_PER_LESSON} active questions, found ${version.questions.length}`,
    );
  }

  const questions = version.questions.map((question) => {
    const reference = `question ${question.stableKey}`;
    const ordinal = question.questionNumber;
    if (!isOrdinal(ordinal)) {
      fail(`${reference}: questionNumber ${ordinal} is outside the 1..${ATA_VIDEO_QUESTIONS_PER_LESSON} contract`);
    }
    const codes = readOptionCodes(question.options, reference);
    const correctOptionCode = readCorrectCode(question.correctAnswer, reference, codes);
    const localization = question.localizations[0];
    if (!localization) {
      fail(`${reference}: no "${CANONICAL_ASSESSMENT_LOCALE}" localization to fingerprint`);
    }
    const labels = readOptionLabels(localization.optionLabels, reference, codes);
    return {
      questionId: question.stableKey,
      ordinal,
      prompt: localization.prompt,
      // The take binding is DERIVED from the accepted contract, never stored
      // twice: T{level}.{ordinal} is what `takeIdFor` already defines.
      takeId: takeIdFor(levelNumber, ordinal),
      correctOptionCode,
      options: codes.map((code) => ({
        optionCode: code,
        text: labels.get(code)!,
        correct: code === correctOptionCode,
      })),
    };
  });

  const ordinals = questions.map((q) => q.ordinal).sort((a, b) => a - b);
  if (new Set(ordinals).size !== ordinals.length) {
    fail(`AssessmentVersion ${assessmentVersionId}: duplicate questionNumber`);
  }

  const takes = ([1, 2, 3, 4] as const).slice(0, ATA_VIDEO_TAKES_PER_LESSON).map((ordinal) => ({
    takeId: takeIdFor(levelNumber, ordinal),
    ordinal,
    // Deliberately empty — see the module header. Take TEXT belongs to the
    // video contract and is covered by `contractFingerprint`.
    text: "",
  }));

  return { levelCode, takes, questions };
}

/**
 * The DURABLE bank fingerprint.
 *
 * The accepted Phase-C function, applied to the accepted projection. This
 * module contributes the read; it contributes no cryptography.
 */
export async function calculateBankFingerprint(
  tx: DbClient,
  assessmentVersionId: number,
): Promise<string> {
  const projection = await projectAssessmentBank(tx, assessmentVersionId);
  return calculateAssessmentFingerprint(projection);
}
