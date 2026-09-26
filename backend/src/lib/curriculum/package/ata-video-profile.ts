/**
 * PHASE-C CORRECTIONS — the ATA VIDEO_TEST product profile.
 *
 * ================== WHY THIS IS A THIRD LAYER, NOT A RULE IN validate.ts ==================
 * There are now three questions, and conflating any two of them is how a generic
 * engine acquires one customer's product rules:
 *
 *   validate.ts        "is this a valid curriculum package?"   — ANY curriculum
 *   ata-profile.ts     "is this THE ATA 100-level product?"    — structure
 *   THIS FILE          "is this THE ATA video+test contract?"  — 4 takes, 4 questions
 *
 * «Exactly four takes and exactly four questions» is an ATA VIDEO_TEST fact. It
 * is emphatically NOT a curriculum fact: the generic engine already supports
 * 4–7 questions (`MIN/MAX_LESSON_QUESTIONS`), the approved 4-level first slice
 * must keep passing untouched, and a future product with three takes per lesson
 * must not have to fork the validator. So the number lives here, applied
 * deliberately to packages that claim to be the ATA product, and nowhere else.
 *
 * ========================== WHAT IT CHECKS ==========================
 * §23 of the correction brief, in order:
 *   - exactly 58 lesson contracts
 *   - every canonical video_test level has one, and only those levels do
 *   - exactly 4 takes each, with IDs that match their own level
 *   - exactly 4 questions each
 *   - exactly one correct option per question
 *   - every question maps to exactly one take; every take covered exactly once
 *   - no duplicate question ids, no duplicate option codes
 *   - a plausible target duration
 *   - no obsolete learner-facing brand marker
 *
 * ISSUES vs GAPS, again. A contract that violates the 4/4 shape is an ISSUE —
 * broken structure, never fixed by editorial work. A contract that is merely
 * unapproved, unscripted, unrecorded or un-QA'd is NOT a gap and NOT an issue:
 * it is the honest state of a product mid-production, and the completeness
 * matrix reports it as a number rather than a failure.
 */
import {
  ATA_VIDEO_OPTIONS_PER_QUESTION,
  ATA_VIDEO_QUESTIONS_PER_LESSON,
  ATA_VIDEO_TAKES_PER_LESSON,
  calculateAssessmentFingerprint,
  calculateContractFingerprint,
  isProductionEvidenceStale,
  parseTakeId,
  takeIdFor,
  type VideoProductionContract,
  type VideoProductionContractsFile,
} from "@/lib/curriculum/video-production-contract";
import { ATA_LEVELS, canonicalLevelCode } from "@/lib/curriculum/product-ata-100";
import { findObsoleteBrand } from "@/lib/curriculum/product-vocabulary";
import type { PackageIssue } from "@/lib/curriculum/package/validate";

/** The canonical video_test levels, from the structural source. */
export function ataVideoTestLevelNumbers(): number[] {
  return ATA_LEVELS.filter((level) => level.kind === "video_test").map((level) => level.levelNumber);
}

/** Plausibility bounds for a lesson video. Not an editorial judgement. */
const MIN_TARGET_SECONDS = 60;
const MAX_TARGET_SECONDS = 60 * 60;

function issue(list: PackageIssue[], code: string, path: string, message: string): void {
  list.push({ code, path, message });
}

/* ------------------------------------------------------------------ *
 * Structural QA of the normalized contracts — §23
 * ------------------------------------------------------------------ */

export function validateAtaVideoContracts(file: VideoProductionContractsFile): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const expectedLevels = ataVideoTestLevelNumbers();
  const expected = new Set(expectedLevels);

  if (file.contracts.length !== expectedLevels.length) {
    issue(
      issues,
      "ATAVIDEO_CONTRACT_COUNT",
      "contracts",
      `expected ${expectedLevels.length} video contracts, found ${file.contracts.length}`,
    );
  }

  const seenLevels = new Set<number>();
  const seenQuestionIds = new Set<string>();

  file.contracts.forEach((contract, index) => {
    const at = `contracts[${index}]`;
    const level = contract.levelNumber;

    /* --- one contract per canonical video_test level, and no others --- */
    if (!expected.has(level)) {
      const source = ATA_LEVELS.find((item) => item.levelNumber === level);
      issue(
        issues,
        "ATAVIDEO_CONTRACT_ON_NON_VIDEO_LEVEL",
        `${at}.levelNumber`,
        source
          ? `L${level} is «${source.kind}» in the canonical structure and must not carry a video contract`
          : `L${level} is not a canonical ATA level`,
      );
    }
    if (seenLevels.has(level)) {
      issue(issues, "ATAVIDEO_CONTRACT_DUPLICATE", `${at}.levelNumber`, `L${level} has more than one contract`);
    }
    seenLevels.add(level);

    /* --- identity agrees with the structural source --- */
    const source = ATA_LEVELS.find((item) => item.levelNumber === level);
    if (source) {
      if (contract.levelCode !== canonicalLevelCode(source)) {
        issue(
          issues,
          "ATAVIDEO_LEVEL_CODE_MISMATCH",
          `${at}.levelCode`,
          `L${level} must use the canonical stable code ${canonicalLevelCode(source)}`,
        );
      }
      if (contract.title !== source.title) {
        issue(issues, "ATAVIDEO_TITLE_MISMATCH", `${at}.title`, `L${level} title differs from the canonical source`);
      }
      if (contract.moduleNumber !== source.moduleNumber) {
        issue(
          issues,
          "ATAVIDEO_MODULE_MISMATCH",
          `${at}.moduleNumber`,
          `L${level} belongs to module ${source.moduleNumber}`,
        );
      }
    }

    /* --- exactly four takes, IDs derived from the level --- */
    if (contract.takes.length !== ATA_VIDEO_TAKES_PER_LESSON) {
      issue(
        issues,
        "ATAVIDEO_TAKE_COUNT",
        `${at}.takes`,
        `L${level} has ${contract.takes.length} takes, expected ${ATA_VIDEO_TAKES_PER_LESSON}`,
      );
    }
    const takeIds = new Set<string>();
    contract.takes.forEach((take, takeIndex) => {
      const expectedId = takeIdFor(level, takeIndex + 1);
      if (take.takeId !== expectedId) {
        issue(
          issues,
          "ATAVIDEO_TAKE_ID_MISMATCH",
          `${at}.takes[${takeIndex}].takeId`,
          `expected ${expectedId}, found ${take.takeId}`,
        );
      }
      const parsed = parseTakeId(take.takeId);
      if (parsed && parsed.levelNumber !== level) {
        issue(
          issues,
          "ATAVIDEO_TAKE_ID_FOREIGN_LEVEL",
          `${at}.takes[${takeIndex}].takeId`,
          `${take.takeId} belongs to L${parsed.levelNumber}, not L${level}`,
        );
      }
      if (takeIds.has(take.takeId)) {
        issue(issues, "ATAVIDEO_TAKE_ID_DUPLICATE", `${at}.takes[${takeIndex}].takeId`, `${take.takeId} appears twice`);
      }
      takeIds.add(take.takeId);
    });

    /* --- exactly four questions, one correct option, one take each --- */
    if (contract.questions.length !== ATA_VIDEO_QUESTIONS_PER_LESSON) {
      issue(
        issues,
        "ATAVIDEO_QUESTION_COUNT",
        `${at}.questions`,
        `L${level} has ${contract.questions.length} questions, expected ${ATA_VIDEO_QUESTIONS_PER_LESSON}`,
      );
    }
    const coveredTakes = new Map<string, number>();
    contract.questions.forEach((question, questionIndex) => {
      const qAt = `${at}.questions[${questionIndex}]`;

      if (seenQuestionIds.has(question.questionId)) {
        issue(issues, "ATAVIDEO_QUESTION_ID_DUPLICATE", `${qAt}.questionId`, `${question.questionId} appears twice`);
      }
      seenQuestionIds.add(question.questionId);

      if (question.options.length !== ATA_VIDEO_OPTIONS_PER_QUESTION) {
        issue(
          issues,
          "ATAVIDEO_OPTION_COUNT",
          `${qAt}.options`,
          `expected ${ATA_VIDEO_OPTIONS_PER_QUESTION} options, found ${question.options.length}`,
        );
      }
      const optionCodes = new Set<string>();
      for (const option of question.options) {
        if (optionCodes.has(option.optionCode)) {
          issue(issues, "ATAVIDEO_OPTION_CODE_DUPLICATE", `${qAt}.options`, `option ${option.optionCode} appears twice`);
        }
        optionCodes.add(option.optionCode);
      }

      const correct = question.options.filter((option) => option.correct);
      if (correct.length !== 1) {
        issue(
          issues,
          "ATAVIDEO_CORRECT_ANSWER_UNRESOLVED",
          `${qAt}.options`,
          `expected exactly one correct option, found ${correct.length}`,
        );
      } else if (correct[0].optionCode !== question.correctOptionCode) {
        issue(
          issues,
          "ATAVIDEO_CORRECT_ANSWER_INCONSISTENT",
          `${qAt}.correctOptionCode`,
          `declares ${question.correctOptionCode} but option ${correct[0].optionCode} is marked correct`,
        );
      }

      const parsed = parseTakeId(question.takeId);
      if (!parsed || parsed.levelNumber !== level) {
        issue(
          issues,
          "ATAVIDEO_QUESTION_TAKE_FOREIGN",
          `${qAt}.takeId`,
          `${question.takeId} does not belong to L${level}`,
        );
      } else if (!takeIds.has(question.takeId)) {
        issue(
          issues,
          "ATAVIDEO_QUESTION_TAKE_UNKNOWN",
          `${qAt}.takeId`,
          `${question.takeId} is not one of this lesson's takes`,
        );
      }
      coveredTakes.set(question.takeId, (coveredTakes.get(question.takeId) ?? 0) + 1);
    });

    /* --- every take covered exactly once: the 1:1 mapping --- */
    for (const take of contract.takes) {
      const times = coveredTakes.get(take.takeId) ?? 0;
      if (times === 0) {
        issue(issues, "ATAVIDEO_TAKE_NOT_COVERED", `${at}.takes`, `${take.takeId} is not tested by any question`);
      } else if (times > 1) {
        issue(
          issues,
          "ATAVIDEO_TAKE_COVERED_TWICE",
          `${at}.questions`,
          `${take.takeId} is tested by ${times} questions; coverage must be one-to-one`,
        );
      }
    }

    /* --- duration plausibility --- */
    const { minSeconds, maxSeconds } = contract.targetDuration;
    if (minSeconds < MIN_TARGET_SECONDS || maxSeconds > MAX_TARGET_SECONDS || maxSeconds < minSeconds) {
      issue(
        issues,
        "ATAVIDEO_TARGET_DURATION_INVALID",
        `${at}.targetDuration`,
        `implausible target duration ${minSeconds}..${maxSeconds}s`,
      );
    }

    /* --- no obsolete brand in anything an editor or a learner will read --- */
    const brandScanned = [
      contract.title,
      contract.hook,
      contract.requiredTopicsText,
      contract.mainIdea ?? "",
      contract.learningObjective,
      ...contract.takes.map((take) => take.text),
      ...contract.questions.flatMap((question) => [question.prompt, ...question.options.map((o) => o.text)]),
      ...contract.visualBrief,
      ...contract.editorialStopList,
      ...contract.acceptanceChecklist,
    ];
    for (const value of brandScanned) {
      const brand = findObsoleteBrand(value);
      if (brand) {
        issue(
          issues,
          "ATAVIDEO_OBSOLETE_BRAND",
          `${at}`,
          `L${level} contains obsolete product brand ${brand}`,
        );
        break;
      }
    }

    /* --- production evidence must not outlive the contract it reviewed --- */
    if (isProductionEvidenceStale(contract)) {
      issue(
        issues,
        "ATAVIDEO_PRODUCTION_EVIDENCE_STALE",
        `${at}.production`,
        `L${level} carries production evidence reviewed against a different contract fingerprint`,
      );
    }
    for (const coverage of contract.production.takeCoverage) {
      if (!takeIds.has(coverage.takeId)) {
        issue(
          issues,
          "ATAVIDEO_COVERAGE_TAKE_UNKNOWN",
          `${at}.production.takeCoverage`,
          `${coverage.takeId} is not one of this lesson's takes`,
        );
      }
    }
  });

  /* --- every canonical video_test level must have a contract --- */
  for (const levelNumber of expectedLevels) {
    if (!seenLevels.has(levelNumber)) {
      issue(
        issues,
        "ATAVIDEO_CONTRACT_MISSING",
        `contracts.${levelNumber}`,
        `L${levelNumber} is a video_test level with no production contract`,
      );
    }
  }

  /* --- the file's own declared counts must be true --- */
  const actual = {
    lessons: file.contracts.length,
    takes: file.contracts.reduce((total, contract) => total + contract.takes.length, 0),
    questions: file.contracts.reduce((total, contract) => total + contract.questions.length, 0),
    correctAnswers: file.contracts.reduce(
      (total, contract) =>
        total + contract.questions.filter((question) => question.options.some((option) => option.correct)).length,
      0,
    ),
    takeQuestionMappings: file.contracts.reduce(
      (total, contract) =>
        total + contract.questions.filter((question) => parseTakeId(question.takeId) !== null).length,
      0,
    ),
  };
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (file.counts[key] !== actual[key]) {
      issue(
        issues,
        "ATAVIDEO_DECLARED_COUNT_WRONG",
        `counts.${key}`,
        `declares ${file.counts[key]} but the contracts contain ${actual[key]}`,
      );
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * Lifecycle matrix — §13
 * ------------------------------------------------------------------ */

/**
 * PLATFORM_IMPORTED is not a number.
 *
 * Whether a question bank reached the database is runtime state. A source
 * artifact that answered «0» would be asserting something it cannot observe, and
 * an artifact that answered «58» would be lying. UNKNOWN is the only honest
 * value a package can give, and the metric type says so out loud.
 */
export type UnknownFromSource = "UNKNOWN";

export type AtaVideoLifecycleReport = {
  /** How many canonical video_test levels the product has. */
  videoLessonsInCurriculum: number;
  videoContractsAvailable: number;
  takesAvailable: number;
  questionsAvailable: number;
  correctAnswersAvailable: number;
  takeQuestionMappings: number;
  /** Banks that exist as a proposal and are not yet platform-approved. */
  proposedTestBanks: number;
  /** Banks reproduced from an already-authored upstream source. */
  sourceBackedTestBanks: number;
  /** Banks a human has approved as platform truth. */
  platformApprovedTestBanks: number;
  finalScriptsReady: number;
  videosRecorded: number;
  videoQaPassed: number;
  platformImported: UnknownFromSource;
  /** Contracts whose production evidence no longer matches the contract. */
  staleProductionEvidence: number;
  /** Unresolved disagreements with another accepted source. */
  sourceConflicts: number;
};

export function buildAtaVideoLifecycleReport(
  file: VideoProductionContractsFile,
): AtaVideoLifecycleReport {
  const contracts = file.contracts;
  return {
    videoLessonsInCurriculum: ataVideoTestLevelNumbers().length,
    videoContractsAvailable: contracts.length,
    takesAvailable: contracts.reduce((total, contract) => total + contract.takes.length, 0),
    questionsAvailable: contracts.reduce((total, contract) => total + contract.questions.length, 0),
    correctAnswersAvailable: contracts.reduce(
      (total, contract) =>
        total + contract.questions.filter((question) => question.options.some((option) => option.correct)).length,
      0,
    ),
    takeQuestionMappings: contracts.reduce(
      (total, contract) =>
        total + contract.questions.filter((question) => parseTakeId(question.takeId) !== null).length,
      0,
    ),
    proposedTestBanks: contracts.filter((contract) => contract.sourceProvenance === "PROPOSED_CANON").length,
    sourceBackedTestBanks: contracts.filter((contract) => contract.sourceProvenance === "SOURCE_BACKED").length,
    platformApprovedTestBanks: contracts.filter((contract) => contract.approval === "APPROVED").length,
    finalScriptsReady: contracts.filter((contract) => contract.production.script === "SCRIPT_READY").length,
    videosRecorded: contracts.filter((contract) => contract.production.video === "VIDEO_RECORDED").length,
    videoQaPassed: contracts.filter((contract) => contract.production.qa === "QA_PASSED").length,
    platformImported: "UNKNOWN",
    staleProductionEvidence: contracts.filter(isProductionEvidenceStale).length,
    sourceConflicts: file.sourceConflicts.length,
  };
}

/** Current fingerprints for every contract, for reporting and for tests. */
export function contractFingerprints(
  file: VideoProductionContractsFile,
): Array<{ levelNumber: number; contractVersion: number; contractFingerprint: string; assessmentFingerprint: string }> {
  return file.contracts.map((contract: VideoProductionContract) => ({
    levelNumber: contract.levelNumber,
    contractVersion: contract.contractVersion,
    contractFingerprint: calculateContractFingerprint(contract),
    assessmentFingerprint: calculateAssessmentFingerprint(contract),
  }));
}
