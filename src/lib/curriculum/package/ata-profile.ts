/**
 * PHASE-C — the ATA-100 PRODUCT PROFILE.
 *
 * ===================== GENERIC ENGINE vs PRODUCT PROFILE =====================
 * `validate.ts` answers "is this a valid curriculum package?" for a curriculum
 * of ANY size: continuity of stable codes, owned completion pairs, gate
 * contracts, content bodies, asset references, provenance. It knows nothing
 * about ATA having a hundred levels, and it must not — the 4-level approved
 * first slice is a legitimate package and has to keep passing.
 *
 * This file answers a different question: "is this THE ATA product?" Exactly 100
 * levels, exactly 20 modules, the canonical titles and codes, the committed
 * unlock vocabulary, the approved gate/practical structure. It is a LAYER over
 * the generic validator, never a replacement, and it is only ever applied to a
 * package that claims to be the full ATA curriculum.
 *
 * ===================== ISSUES vs GAPS, AND WHY BOTH =====================
 * The profile reports two kinds of finding, because they have different owners:
 *
 *   ISSUES — structural violations. A level whose stable code disagrees with the
 *            canonical source, a practical routed to the wrong owner, a
 *            checkpoint that is not the last level of its module. No amount of
 *            editorial work fixes these; they are always blocking.
 *
 *   GAPS   — editorial incompleteness. A lesson with no content yet, a
 *            `lesson:assessment_pass` level with no questions yet. These are the
 *            EXPECTED state of a draft mid-production and are blocking only for
 *            an `approved` package.
 *
 * Collapsing the two would mean a draft is either "failing" (and everyone learns
 * to ignore the failure) or "passing" (and nothing measures how far production
 * has actually got). Keeping them apart is what makes
 * `AtaCompletenessReport` a number worth reporting.
 *
 * ==================== NOTHING ABOUT THE ENVIRONMENT ====================
 * There is no staging, QA or attestation concept anywhere here. A production
 * package is environment-neutral: `external_event:pocket_postback` and
 * `financial_checkpoint:balance_check` are what the curriculum declares, and WHO
 * may witness those events on a staging deployment is the Phase-A
 * staging-attestation domain's business, not the curriculum's.
 */
import {
  MAX_LESSON_QUESTIONS,
  MIN_LESSON_QUESTIONS,
} from "@/lib/curriculum/assessment-validation";
import {
  contentBodyTeachingCharacters,
  type ContentBody,
} from "@/lib/curriculum/content-body";
import { DEFAULT_CURRICULUM_CODE } from "@/lib/curriculum/constants";
import { validatePracticalLevelMapping } from "@/lib/curriculum/practical-mapping";
import {
  ATA_CHECKPOINT_COUNT,
  ATA_CHECKPOINTS,
  ATA_COMMUNITY_UNLOCK_COUNT,
  ATA_LEVEL_COUNT,
  ATA_LEVELS,
  ATA_MENTOR_REVIEW_COUNT,
  ATA_MODULE_COUNT,
  ATA_MODULES,
  ATA_PRACTICAL_COUNT,
  ATA_TOOL_UNLOCK_COUNT,
  canonicalLevelCode,
  canonicalModuleCode,
  completionContractFor,
  gateIntegrationCode,
  type AtaLevelSource,
} from "@/lib/curriculum/product-ata-100";
import {
  COMMUNITY_CHANNELS,
  CURRICULUM_TOOLS,
  RANK_TRANSITIONS,
} from "@/lib/curriculum/product-vocabulary";
import {
  ATA_TOTAL_XP,
  ataXpRewardForLevel,
  ataXpRewardStatusForLevel,
  ataXpScheduleBuckets,
  ataXpScheduleTotal,
} from "@/lib/curriculum/product-xp-policy";
import {
  PRODUCTION_PROVENANCE,
  type CurriculumPackage,
  type PackageLevel,
  type ProvenanceRecord,
} from "@/lib/curriculum/package/schema";
import type { PackageIssue } from "@/lib/curriculum/package/validate";

/**
 * The package code that identifies the full ATA product curriculum.
 *
 * The profile is applied DELIBERATELY, not automatically on every import — the
 * generic engine must keep accepting a 4-level slice. This constant is how a
 * caller (the converter, CI, a future admin action) decides that a given package
 * claims to be the whole product and should therefore be held to the product
 * contract.
 */
export const ATA_100_PACKAGE_CODE = "ata-v2.canonical-100" as const;

/** Does this package claim to be the full ATA product curriculum? */
export function isAtaProduct100Package(pkg: Pick<CurriculumPackage, "packageCode">): boolean {
  return pkg.packageCode === ATA_100_PACKAGE_CODE;
}

/**
 * The prose floor for an editorially complete lesson.
 *
 * Higher than the generic validator's learner-empty floor on purpose: the
 * generic floor separates "content" from "nothing", this one separates "a
 * lesson" from "a paragraph". Still not a quality judgement — a human reviews
 * quality; this only refuses to CLAIM completeness for something too short to be
 * one.
 */
export const MIN_EDITORIAL_TEACHING_CHARACTERS = 1_200;

/**
 * Level kinds that require ORIGINAL editorial authoring: a written lesson, a
 * report brief, a practical instruction sheet.
 *
 * Checkpoints and the registration gate are deliberately absent. They carry
 * system copy, not teaching material — counting them as "editorially complete" is true
 * but says nothing about how much of the course has been written, which is why
 * `editorialCompletenessPercent` below is measured over THIS set and not over
 * all 100 levels. Reported over 100 the same package reads 23%; reported over
 * what actually needs writing it reads 2.5%. The second number is the one a
 * content plan can be built on.
 */
const EDITORIAL_REQUIRED_KINDS = new Set(["video_test", "practical", "report"]);

export type AtaCompletenessReport = {
  /** Levels the package declares. */
  totalLevels: number;
  /** Levels whose canonical structure is exactly right. */
  structurallyCompleteLevels: number;
  structuralCompletenessPercent: number;
  /** Levels that require original editorial authoring (lesson/practical/report). */
  editorialRequiredLevels: number;
  /** How many of those are actually authored to the approval bar. */
  editoriallyCompleteRequiredLevels: number;
  /** THE editorial number: authored / requiring authoring. */
  editorialCompletenessPercent: number;
  /**
   * All levels with no outstanding editorial gap, including the 21 gate levels
   * that never had an authoring requirement. Reported for completeness; not the
   * headline, because it flatters.
   */
  levelsWithNoEditorialGap: number;
  /** Levels that would pass approval today: structure + editorial + provenance. */
  productionReadyLevels: number;
  /** Levels whose stored content body already uses the v2 block model. */
  blocksV2ContentLevels: number;
  byKind: Record<string, { total: number; structural: number; editorial: number; productionReady: number }>;
  /**
   * CORRECTIONS §13 — the lifecycle matrix.
   *
   * The old report answered one question ("how much is written?") with numbers
   * that could not distinguish a bank nobody has written from a bank nobody has
   * reviewed. These count the states the product actually moves through, so
   * PROPOSED is never silently added to APPROVED and a schema shell is never
   * counted as editorial content.
   */
  lifecycle: AtaLifecycleMatrix;
};

export type AtaLifecycleMatrix = {
  /** Structure: 100 levels, 20 modules, unlocks — the Phase-C achievement. */
  structureReady: boolean;
  /** Canonical video_test levels in the curriculum. */
  videoLessons: number;
  /** Levels carrying a question bank of any approval state. */
  testBanksPresent: number;
  /** Questions actually present across those banks. */
  questionsPresent: number;
  /** Questions whose answer key is resolved. */
  correctAnswersPresent: number;
  /** Questions bound to exactly one take id. */
  takeMappingsPresent: number;
  /** Banks that exist and await review. NOT approved, NOT missing. */
  proposedTestBanks: number;
  /** Banks reproduced from an already-authored upstream source. */
  sourceBackedTestBanks: number;
  /** Banks a human approved as platform truth. */
  platformApprovedTestBanks: number;
  /** Banks nobody has written. */
  missingTestBanks: number;
  /** Banks where two accepted sources disagree. */
  conflictingTestBanks: number;
  /** Source cannot observe runtime import state; see the type. */
  platformImported: "UNKNOWN";
  /** Non-video levels (practical/report) whose editorial work is done. */
  nonVideoEditorialComplete: number;
  nonVideoEditorialRequired: number;
  /** Levels that would pass approval today. */
  productionReadyLevels: number;
  /** Non-gate levels whose XP reward is still a placeholder. */
  xpUnresolvedLevels: number;
  xpApprovedLevels: number;
  /** PHASE-F — the package's own reward sum. The approved product total is 10 000. */
  xpTotalReward: number;
  /** PHASE-F — does the package's schedule match the approved ATA policy exactly? */
  xpScheduleMatchesPolicy: boolean;
};

export type AtaProfileResult = {
  ok: boolean;
  /** Structural violations. Always blocking. */
  issues: PackageIssue[];
  /** Editorial incompleteness. Blocking only when the package claims `approved`. */
  gaps: PackageIssue[];
  report: AtaCompletenessReport;
};

function issue(list: PackageIssue[], code: string, path: string, message: string): void {
  list.push({ code, path, message });
}

function isProductionProvenance(record: ProvenanceRecord): boolean {
  return PRODUCTION_PROVENANCE.has(record.classification) && !record.approvalRequired;
}

/**
 * The XP status of a level, defaulting in the SAFE direction.
 *
 * `xpRewardStatus` is optional so that every already-shipped package keeps
 * validating byte-identically. Absence therefore has to mean something, and it
 * means "nobody declared" — which is `unresolved` for a normal level and
 * `approved` for a gate, whose zero the generic validator has always enforced
 * independently. Defaulting the other way would let silence pass as a decision.
 */
export function resolveXpRewardStatus(
  level: Pick<PackageLevel, "xpRewardStatus">,
  kind: string,
): "approved" | "unresolved" {
  if (level.xpRewardStatus) return level.xpRewardStatus;
  return kind === "registration" || kind === "checkpoint" ? "approved" : "unresolved";
}

/**
 * Is the committed unlock vocabulary internally consistent with the level
 * structure? Runs independently of any package, because it is a fact about the
 * PRODUCT, not about a document: a build that gets this wrong has broken the
 * unlock contract for every package at once.
 */
export function validateAtaUnlockVocabulary(): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const checkpointLevels = new Set(ATA_CHECKPOINTS.map((checkpoint) => checkpoint.levelNumber));

  if (CURRICULUM_TOOLS.length !== ATA_TOOL_UNLOCK_COUNT) {
    issue(issues, "ATA100_TOOL_UNLOCK_COUNT", "vocabulary.tools", `expected ${ATA_TOOL_UNLOCK_COUNT} curriculum tools`);
  }
  if (COMMUNITY_CHANNELS.length !== ATA_COMMUNITY_UNLOCK_COUNT) {
    issue(issues, "ATA100_COMMUNITY_UNLOCK_COUNT", "vocabulary.channels", `expected ${ATA_COMMUNITY_UNLOCK_COUNT} community unlocks`);
  }
  if (RANK_TRANSITIONS.length !== ATA_CHECKPOINT_COUNT) {
    issue(issues, "ATA100_RANK_COUNT", "vocabulary.ranks", `expected ${ATA_CHECKPOINT_COUNT} rank transitions`);
  }

  // Every unlock must be released BY a checkpoint level. An unlock hanging off a
  // non-checkpoint level would be an unlock nothing can ever grant.
  for (const tool of CURRICULUM_TOOLS) {
    if (!checkpointLevels.has(tool.unlockLevel)) {
      issue(issues, "ATA100_TOOL_UNLOCK_LEVEL_INVALID", `vocabulary.tools.${tool.code}`, "tool unlock level is not a checkpoint level");
    }
  }
  for (const channel of COMMUNITY_CHANNELS) {
    if (!checkpointLevels.has(channel.unlockLevel)) {
      issue(issues, "ATA100_COMMUNITY_UNLOCK_LEVEL_INVALID", `vocabulary.channels.${channel.code}`, "community unlock level is not a checkpoint level");
    }
  }
  for (const rank of RANK_TRANSITIONS) {
    if (!checkpointLevels.has(rank.unlockLevel)) {
      issue(issues, "ATA100_RANK_LEVEL_INVALID", `vocabulary.ranks.${rank.code}`, "rank transition level is not a checkpoint level");
    }
  }

  // The structural source and the vocabulary must agree on WHICH checkpoint
  // releases WHAT. Two lists, one truth.
  for (const checkpoint of ATA_CHECKPOINTS) {
    const tool = CURRICULUM_TOOLS.find((item) => item.unlockLevel === checkpoint.levelNumber) ?? null;
    if ((tool?.code ?? null) !== checkpoint.toolCode) {
      issue(
        issues,
        "ATA100_TOOL_UNLOCK_MISMATCH",
        `vocabulary.checkpoints.${checkpoint.levelNumber}`,
        "checkpoint tool unlock disagrees with the tool vocabulary",
      );
    }
    const channel = COMMUNITY_CHANNELS.find((item) => item.unlockLevel === checkpoint.levelNumber) ?? null;
    if ((channel?.code ?? null) !== checkpoint.channelCode) {
      issue(
        issues,
        "ATA100_COMMUNITY_UNLOCK_MISMATCH",
        `vocabulary.checkpoints.${checkpoint.levelNumber}`,
        "checkpoint community unlock disagrees with the channel vocabulary",
      );
    }
    const rank = RANK_TRANSITIONS.find((item) => item.unlockLevel === checkpoint.levelNumber) ?? null;
    if ((rank?.code ?? null) !== checkpoint.rankCode) {
      issue(
        issues,
        "ATA100_RANK_MISMATCH",
        `vocabulary.checkpoints.${checkpoint.levelNumber}`,
        "checkpoint rank disagrees with the rank vocabulary",
      );
    }
  }
  return issues;
}

/** Does this level's content body meet the editorial bar for its kind? */
function editorialContentSufficient(body: ContentBody): boolean {
  return contentBodyTeachingCharacters(body) >= MIN_EDITORIAL_TEACHING_CHARACTERS;
}

/**
 * The ATA-100 product contract.
 *
 * `pkg` must already have passed `validateCurriculumPackage`; this layer assumes
 * the generic invariants (schema, stable codes, owned pairs, gate contracts) and
 * checks only what makes a package THE ATA curriculum.
 */
export function validateAtaProduct100Package(pkg: CurriculumPackage): AtaProfileResult {
  const issues: PackageIssue[] = [];
  const gaps: PackageIssue[] = [];
  /** Product-decision gaps, kept out of the editorial tally. Merged below. */
  const xpGaps: PackageIssue[] = [];

  issues.push(...validateAtaUnlockVocabulary());

  if (pkg.curriculumCode !== DEFAULT_CURRICULUM_CODE) {
    issue(issues, "ATA100_CURRICULUM_CODE", "curriculumCode", `ATA product packages must declare ${DEFAULT_CURRICULUM_CODE}`);
  }

  /* ------------------------------ modules ------------------------------ */
  if (pkg.modules.length !== ATA_MODULE_COUNT) {
    issue(issues, "ATA100_MODULE_COUNT", "modules", `ATA product requires exactly ${ATA_MODULE_COUNT} modules, found ${pkg.modules.length}`);
  }

  const packageLevels = pkg.modules.flatMap((moduleDefinition) =>
    moduleDefinition.levels.map((level) => ({ level, moduleDefinition })),
  );

  if (packageLevels.length !== ATA_LEVEL_COUNT) {
    issue(issues, "ATA100_LEVEL_COUNT", "modules[].levels", `ATA product requires exactly ${ATA_LEVEL_COUNT} levels, found ${packageLevels.length}`);
  }

  /* --------------------- 1..100 continuity, exactly --------------------- */
  const byNumber = new Map<number, { level: PackageLevel; path: string }>();
  pkg.modules.forEach((moduleDefinition, mi) => {
    moduleDefinition.levels.forEach((level, li) => {
      const path = `modules[${mi}].levels[${li}]`;
      if (byNumber.has(level.levelNumber)) {
        issue(issues, "ATA100_LEVEL_NUMBER_DUPLICATE", `${path}.levelNumber`, `level ${level.levelNumber} appears more than once`);
        return;
      }
      byNumber.set(level.levelNumber, { level, path });
    });
  });
  for (let levelNumber = 1; levelNumber <= ATA_LEVEL_COUNT; levelNumber += 1) {
    if (!byNumber.has(levelNumber)) {
      issue(issues, "ATA100_LEVEL_NUMBER_GAP", `modules[].levels.${levelNumber}`, `level ${levelNumber} is missing from the ATA product package`);
    }
  }
  for (const [levelNumber, entry] of byNumber) {
    if (levelNumber < 1 || levelNumber > ATA_LEVEL_COUNT) {
      issue(issues, "ATA100_LEVEL_NUMBER_OUT_OF_RANGE", `${entry.path}.levelNumber`, `level ${levelNumber} is outside 1..${ATA_LEVEL_COUNT}`);
    }
  }

  /* --------------------------- module identity -------------------------- */
  const moduleByNumber = new Map(pkg.modules.map((item, index) => [item.moduleNumber, { item, index }]));
  for (const source of ATA_MODULES) {
    const found = moduleByNumber.get(source.moduleNumber);
    if (!found) {
      issue(issues, "ATA100_MODULE_MISSING", `modules.${source.moduleNumber}`, `module ${source.moduleNumber} is missing`);
      continue;
    }
    const path = `modules[${found.index}]`;
    const expectedCode = canonicalModuleCode(source.moduleNumber);
    if (found.item.moduleCode !== expectedCode) {
      issue(issues, "ATA100_MODULE_CODE_MISMATCH", `${path}.moduleCode`, `module ${source.moduleNumber} must use ${expectedCode}`);
    }
    if (found.item.title !== source.title) {
      issue(issues, "ATA100_MODULE_TITLE_MISMATCH", `${path}.title`, `module ${source.moduleNumber} title differs from the canonical source`);
    }
    const expectedCheckpoint = ATA_LEVELS.find(
      (level) => level.kind === "checkpoint" && level.levelNumber === source.endLevel,
    );
    if (!expectedCheckpoint) {
      issue(issues, "ATA100_MODULE_CHECKPOINT_SOURCE_MISSING", `${path}.checkpointLevelCode`, `module ${source.moduleNumber} does not end with a checkpoint in the canonical source`);
    } else if (found.item.checkpointLevelCode !== canonicalLevelCode(expectedCheckpoint)) {
      issue(
        issues,
        "ATA100_MODULE_CHECKPOINT_MISMATCH",
        `${path}.checkpointLevelCode`,
        `module ${source.moduleNumber} must point at ${canonicalLevelCode(expectedCheckpoint)}`,
      );
    }
  }

  /* ---------------------------- level identity --------------------------- */
  const structural = new Set<number>();
  const editorial = new Set<number>();
  const productionReady = new Set<number>();
  /*
   * Only a BLOCKING pending entry removes production readiness.
   *
   * A non-blocking entry is a recorded editorial decision — level 2 carries one,
   * because the Blueprint proposes a different bank for an assessment Backend has
   * already approved. Treating that note as though the approved content were
   * unusable would be as dishonest as hiding it: the work is done, a choice about
   * a proposal is outstanding, and `blocksReadiness` is the field that says which.
   */
  const pendingByLevelCode = new Set(
    pkg.pendingApprovals.filter((pending) => pending.blocksReadiness).map((pending) => pending.levelCode),
  );
  let blocksV2ContentLevels = 0;

  for (const source of ATA_LEVELS) {
    const found = byNumber.get(source.levelNumber);
    if (!found) continue;
    const { level, path } = found;
    const before = issues.length;
    const gapsBefore = gaps.length;

    const expectedCode = canonicalLevelCode(source);
    if (level.levelCode !== expectedCode) {
      issue(issues, "ATA100_STABLE_CODE_MISMATCH", `${path}.levelCode`, `level ${source.levelNumber} must use the canonical stable code ${expectedCode}`);
    }
    if (level.title !== source.title) {
      issue(issues, "ATA100_TITLE_MISMATCH", `${path}.title`, `level ${source.levelNumber} title differs from the canonical source`);
    }
    const expectedModuleCode = canonicalModuleCode(source.moduleNumber);
    const owningModule = pkg.modules.find((item) => item.levels.includes(level));
    if (owningModule && owningModule.moduleCode !== expectedModuleCode) {
      issue(issues, "ATA100_LEVEL_MODULE_MISMATCH", `${path}.levelCode`, `level ${source.levelNumber} belongs to ${expectedModuleCode}`);
    }

    const contract = completionContractFor(source);
    if (level.type !== contract.type || level.completionMethod !== contract.completionMethod) {
      issue(
        issues,
        "ATA100_COMPLETION_CONTRACT_MISMATCH",
        `${path}.completionMethod`,
        `level ${source.levelNumber} (${source.kind}) must be ${contract.type}:${contract.completionMethod}`,
      );
    }

    // The practical mapping is re-checked through its own owner so that a
    // hand-edited package cannot move one of the 20 practicals onto a different
    // completion owner while still satisfying the generic pair check.
    if (source.kind === "practical") {
      const mapping = validatePracticalLevelMapping(
        { mentorReview: source.mentorReview },
        { type: level.type, completionMethod: level.completionMethod },
      );
      if (mapping) {
        issue(issues, `ATA100_${mapping.code}`, `${path}.completionMethod`, mapping.message);
      }
    }

    // Gates. The generic validator already refuses a gate with the wrong source
    // or a self-completable method; the profile pins the INTEGRATION CODE, which
    // is what actually routes a checkpoint to its module.
    const expectedIntegration = gateIntegrationCode(source);
    if (expectedIntegration === null) {
      if (level.gate) {
        issue(issues, "ATA100_GATE_NOT_EXPECTED", `${path}.gate`, `level ${source.levelNumber} is not a gate level`);
      }
    } else if (!level.gate) {
      issue(issues, "ATA100_GATE_MISSING", `${path}.gate`, `level ${source.levelNumber} must declare a gate`);
    } else if (level.gate.integrationCode !== expectedIntegration) {
      issue(issues, "ATA100_GATE_INTEGRATION_MISMATCH", `${path}.gate.integrationCode`, `level ${source.levelNumber} must use integration code ${expectedIntegration}`);
    }

    // Zero-reward gates. The generic validator derives this from the completion
    // owner; the profile states it as a product fact so the two can never quietly
    // agree on the wrong answer.
    const isGate = source.kind === "registration" || source.kind === "checkpoint";
    if (isGate && level.xpReward !== 0) {
      issue(issues, "ATA100_GATE_XP_NONZERO", `${path}.xpReward`, `level ${source.levelNumber} is a gate and must award 0 XP`);
    }

    /*
     * CORRECTIONS §14 — the XP schedule is UNRESOLVED, and that is a fact the
     * package must carry rather than a silence it can be read through.
     *
     * A gate's zero is a real product decision, so a gate that declared
     * "unresolved" would be wrong in the other direction and is refused. For
     * every other level, an ABSENT declaration is read as unresolved, never as
     * approved: not deciding is not the same as deciding zero, and the shipped
     * approved slice — which predates this field — must not be retroactively
     * treated as having settled a schedule nobody ever wrote down.
     */
    if (isGate && resolveXpRewardStatus(level, source.kind) !== "approved") {
      issue(
        issues,
        "ATA100_GATE_XP_STATUS_INVALID",
        `${path}.xpRewardStatus`,
        `level ${source.levelNumber} is a gate: its zero reward is an approved product decision, not an unresolved one`,
      );
    }
    /*
     * PHASE-F — THE APPROVED SCHEDULE, LEVEL BY LEVEL.
     *
     * Reported as an ISSUE rather than a gap, and therefore blocking for a draft
     * too. An unresolved schedule was editorial incompleteness — nobody had
     * decided. A schedule that DISAGREES with the decision is a different thing:
     * the package would ship a curriculum whose levels pay something the product
     * did not approve, and no amount of authoring fixes that.
     *
     * The expected value comes from the policy, which is keyed on the completion
     * pair. Note what is NOT compared: the level number, the module, the rank or
     * the unlock level. A package cannot satisfy this check by accident.
     */
    const expectedReward = ataXpRewardForLevel(source);
    if (level.xpReward !== expectedReward) {
      issue(
        issues,
        "ATA100_XP_REWARD_MISMATCH",
        `${path}.xpReward`,
        `level ${source.levelNumber} (${source.kind}) must award ${expectedReward} XP under the approved ATA schedule, found ${level.xpReward}`,
      );
    }
    const expectedStatus = ataXpRewardStatusForLevel(source);
    if (resolveXpRewardStatus(level, source.kind) !== expectedStatus) {
      issue(
        issues,
        "ATA100_XP_REWARD_STATUS_MISMATCH",
        `${path}.xpRewardStatus`,
        `level ${source.levelNumber} must declare xpRewardStatus ${expectedStatus}`,
      );
    }

    if (!isGate && resolveXpRewardStatus(level, source.kind) === "unresolved") {
      // Collected separately, then merged into `gaps` after the per-level tally.
      // An unresolved XP schedule is a PRODUCT decision, not editorial work: a
      // fully written lesson is fully written whether or not anyone has decided
      // what it is worth. Counting it as an editorial gap would have made every
      // authored level read as unauthored, which is the kind of metric the audit
      // told us to stop producing.
      issue(
        xpGaps,
        "ATA100_XP_SCHEDULE_UNRESOLVED",
        `${path}.xpRewardStatus`,
        `level ${source.levelNumber} carries a placeholder XP reward: no accepted source defines an ATA XP schedule yet`,
      );
    }

    // Progression: strictly the previous level, and only that. §2's
    // `requiredPreviousLevel` is expressed in the package as exactly one
    // prerequisite level code.
    const expectedPrerequisites =
      source.levelNumber === 1
        ? []
        : [canonicalLevelCode(ATA_LEVELS[source.levelNumber - 2] as AtaLevelSource)];
    if (
      level.prerequisiteLevelCodes.length !== expectedPrerequisites.length ||
      level.prerequisiteLevelCodes.some((code, index) => code !== expectedPrerequisites[index])
    ) {
      issue(
        issues,
        "ATA100_PROGRESSION_MISMATCH",
        `${path}.prerequisiteLevelCodes`,
        source.levelNumber === 1
          ? "level 1 must have no prerequisite"
          : `level ${source.levelNumber} must require exactly ${expectedPrerequisites[0]}`,
      );
    }

    if (level.checkpointLevelCode !== null) {
      issue(issues, "ATA100_CHECKPOINT_PREREQUISITE_SET", `${path}.checkpointLevelCode`, "ATA levels must leave requiredCheckpointLevel null");
    }

    /* ------------------------ editorial contract ----------------------- */
    // §17 — what "content complete" means, per level kind. Reported as GAPS:
    // absent editorial work is the normal state of a draft and a hard failure
    // for an approved package.
    const contentBodies = level.content?.localizations ?? [];
    if (level.content && contentBodies.some((localization) => "format" in localization.body)) {
      blocksV2ContentLevels += 1;
    }

    const requireContent = source.kind === "video_test" || source.kind === "practical";
    if (requireContent) {
      if (!level.content) {
        issue(gaps, "ATA100_CONTENT_MISSING", `${path}.content`, `level ${source.levelNumber} (${source.kind}) requires learner content`);
      } else {
        if (level.content.status !== "published") {
          issue(gaps, "ATA100_CONTENT_NOT_PUBLISHED", `${path}.content.status`, `level ${source.levelNumber} content is not published`);
        }
        const localized = contentBodies.find((localization) => localization.locale === pkg.locale);
        if (!localized) {
          issue(gaps, "ATA100_CONTENT_LOCALE_MISSING", `${path}.content.localizations`, `level ${source.levelNumber} has no ${pkg.locale} content`);
        } else if (!editorialContentSufficient(localized.body)) {
          issue(
            gaps,
            "ATA100_CONTENT_NOT_AUTHORED",
            `${path}.content.localizations`,
            `level ${source.levelNumber} content is below the editorial bar of ${MIN_EDITORIAL_TEACHING_CHARACTERS} characters of teaching text`,
          );
        }
      }
    }

    if (source.kind === "video_test") {
      if (!level.assessment) {
        issue(gaps, "ATA100_ASSESSMENT_MISSING", `${path}.assessment`, `level ${source.levelNumber} completes through assessment_pass and requires an assessment`);
      } else if (
        level.assessment.questions.length < MIN_LESSON_QUESTIONS ||
        level.assessment.questions.length > MAX_LESSON_QUESTIONS
      ) {
        // The bounds are the shipped publication rule, imported rather than
        // restated: an assessment outside them cannot be published, so shipping
        // one would be shipping a level nobody can finish.
        issue(
          gaps,
          "ATA100_ASSESSMENT_QUESTION_COUNT",
          `${path}.assessment.questions`,
          `lesson assessments require ${MIN_LESSON_QUESTIONS}–${MAX_LESSON_QUESTIONS} questions`,
        );
      }
    }

    if (source.kind === "report") {
      if (!level.report) {
        issue(gaps, "ATA100_REPORT_MISSING", `${path}.report`, `level ${source.levelNumber} requires a report assignment`);
      } else {
        const localized = level.report.localizations.find((item) => item.locale === pkg.locale);
        if (!localized || localized.instructions.trim().length < 200) {
          issue(gaps, "ATA100_REPORT_INSTRUCTIONS_MISSING", `${path}.report.localizations`, `level ${source.levelNumber} requires authored report instructions`);
        }
      }
    }

    if (source.kind === "practical" && source.mentorReview && !level.content) {
      issue(gaps, "ATA100_MENTOR_INSTRUCTIONS_MISSING", `${path}.content`, `level ${source.levelNumber} is mentor-reviewed and requires practical instructions`);
    }

    /* ------------------------------ tallies ---------------------------- */
    const structurallyComplete = issues.length === before;
    const editoriallyComplete = gaps.length === gapsBefore;
    if (structurallyComplete) structural.add(source.levelNumber);
    if (editoriallyComplete) editorial.add(source.levelNumber);

    const provenanceRecords: ProvenanceRecord[] = [
      level.provenance,
      ...(level.content ? [level.content.provenance] : []),
      ...(level.assessment ? [level.assessment.provenance] : []),
      ...(level.report ? [level.report.provenance] : []),
      ...(level.gate ? [level.gate.provenance] : []),
    ];
    const provenanceClean = provenanceRecords.every(isProductionProvenance);
    if (
      structurallyComplete &&
      editoriallyComplete &&
      provenanceClean &&
      !pendingByLevelCode.has(level.levelCode)
    ) {
      productionReady.add(source.levelNumber);
    }
  }

  /* ------------------------------- report ------------------------------- */
  const byKind: AtaCompletenessReport["byKind"] = {};
  for (const source of ATA_LEVELS) {
    const bucket = (byKind[source.kind] ??= { total: 0, structural: 0, editorial: 0, productionReady: 0 });
    bucket.total += 1;
    if (structural.has(source.levelNumber)) bucket.structural += 1;
    if (editorial.has(source.levelNumber)) bucket.editorial += 1;
    if (productionReady.has(source.levelNumber)) bucket.productionReady += 1;
  }

  const editorialRequired = ATA_LEVELS.filter((level) => EDITORIAL_REQUIRED_KINDS.has(level.kind));
  const editorialRequiredComplete = editorialRequired.filter((level) =>
    editorial.has(level.levelNumber),
  ).length;

  const percent = (value: number, of: number) =>
    of === 0 ? 0 : Math.round((value / of) * 1000) / 10;

  /* ---------------------- lifecycle matrix — §13 ---------------------- */
  const pendingByLevelAndElement = new Map<string, Set<string>>();
  for (const pending of pkg.pendingApprovals) {
    const key = `${pending.levelCode}|${pending.element}`;
    const set = pendingByLevelAndElement.get(key) ?? new Set<string>();
    set.add(pending.classification);
    pendingByLevelAndElement.set(key, set);
  }
  const assessmentState = (levelCode: string): "PROPOSED" | "CONFLICTING" | "MISSING" | "APPROVED" => {
    const classifications = pendingByLevelAndElement.get(`${levelCode}|assessment`);
    if (!classifications) return "APPROVED";
    if (classifications.has("MISSING")) return "MISSING";
    if (classifications.has("PROPOSED")) return "PROPOSED";
    if (classifications.has("CONFLICTING")) return "CONFLICTING";
    return "APPROVED";
  };

  const videoLevels = ATA_LEVELS.filter((level) => level.kind === "video_test");
  const nonVideoEditorial = ATA_LEVELS.filter(
    (level) => EDITORIAL_REQUIRED_KINDS.has(level.kind) && level.kind !== "video_test",
  );

  let testBanksPresent = 0;
  let questionsPresent = 0;
  let correctAnswersPresent = 0;
  let takeMappingsPresent = 0;
  let proposed = 0;
  let sourceBacked = 0;
  let platformApproved = 0;
  let missingBanks = 0;
  let conflictingBanks = 0;
  let xpUnresolved = 0;
  let xpApproved = 0;
  let xpTotalReward = 0;
  /** PHASE-F — how many levels of each completion pair the PACKAGE actually pays. */
  const xpPaidByPair = new Map<string, { levels: number; subtotal: number }>();

  for (const source of ATA_LEVELS) {
    const found = byNumber.get(source.levelNumber);
    if (!found) continue;
    const { level } = found;

    if (resolveXpRewardStatus(level, source.kind) === "unresolved") xpUnresolved += 1;
    else xpApproved += 1;
    xpTotalReward += level.xpReward;
    const pair = `${level.type}:${level.completionMethod}`;
    const bucket = xpPaidByPair.get(pair) ?? { levels: 0, subtotal: 0 };
    bucket.levels += 1;
    bucket.subtotal += level.xpReward;
    xpPaidByPair.set(pair, bucket);

    if (source.kind !== "video_test") continue;
    if (level.assessment) {
      testBanksPresent += 1;
      questionsPresent += level.assessment.questions.length;
      correctAnswersPresent += level.assessment.questions.filter(
        (question) => question.correctOptionCodes.length > 0 || question.correctNumericValue !== null,
      ).length;
      takeMappingsPresent += level.assessment.questions.filter(
        (question) => (question.lessonTakeawayRef ?? "").length > 0,
      ).length;
      // Provenance answers "where did it come from"; the pending entry answers
      // "what is outstanding". Neither alone is the state, so both are read.
      if (level.assessment.provenance.confidence === "high" && level.assessment.provenance.approvalRequired) {
        sourceBacked += 1;
      }
      // APPROVED is a property of the bank itself, not of the absence of a note.
      if (isProductionProvenance(level.assessment.provenance) && level.assessment.status === "published") {
        platformApproved += 1;
      }
    }
    // A conflict is an OVERLAY, not a rung on the ladder: level 2's bank is both
    // platform-approved AND in disagreement with a proposal. Counting it only as
    // "conflicting" would erase the approval; counting it only as "approved"
    // would hide the open decision. It is counted in both.
    const state = assessmentState(level.levelCode);
    if (state === "PROPOSED") proposed += 1;
    else if (state === "MISSING") missingBanks += 1;
    if (state === "CONFLICTING") conflictingBanks += 1;
  }

  /*
   * PHASE-F — THE SCHEDULE AS A WHOLE.
   *
   * The per-level check above already refuses a wrong reward, so these are not
   * strictly redundant only in the sense that a checksum is not redundant: they
   * state the product decision in the shape the decision was WRITTEN in — «58
   * assessment levels × 100», «total exactly 10 000» — so a change that happened
   * to satisfy every level individually while altering the distribution or the
   * total still fails, and fails with the number a product owner recognises.
   *
   * The expected buckets are derived from the canonical structure by the policy;
   * `ATA_TOTAL_XP` is the one number stated by hand, and the policy's own derived
   * total is checked against it so the structure and the decision cannot drift
   * apart silently.
   */
  const scheduleBuckets = ataXpScheduleBuckets();
  const policyTotal = ataXpScheduleTotal();
  if (policyTotal !== ATA_TOTAL_XP) {
    issue(
      issues,
      "ATA100_XP_POLICY_TOTAL_INVALID",
      "vocabulary.xp",
      `the ATA XP policy sums to ${policyTotal} over the canonical structure, not the approved ${ATA_TOTAL_XP}`,
    );
  }
  for (const bucket of scheduleBuckets) {
    const paid = xpPaidByPair.get(bucket.pair) ?? { levels: 0, subtotal: 0 };
    if (paid.levels !== bucket.levels || paid.subtotal !== bucket.subtotal) {
      issue(
        issues,
        "ATA100_XP_SCHEDULE_BUCKET_MISMATCH",
        `modules[].levels.${bucket.pair}`,
        `${bucket.pair} must be ${bucket.levels} levels × ${bucket.xpReward} XP = ${bucket.subtotal}, found ${paid.levels} levels totalling ${paid.subtotal}`,
      );
    }
  }
  for (const pair of xpPaidByPair.keys()) {
    if (!scheduleBuckets.some((bucket) => bucket.pair === pair)) {
      issue(
        issues,
        "ATA100_XP_SCHEDULE_PAIR_UNPRICED",
        `modules[].levels.${pair}`,
        `${pair} is not priced by the approved ATA XP schedule`,
      );
    }
  }
  if (xpTotalReward !== ATA_TOTAL_XP) {
    issue(
      issues,
      "ATA100_XP_TOTAL_MISMATCH",
      "modules[].levels.xpReward",
      `the ATA product curriculum must award exactly ${ATA_TOTAL_XP} XP in total, found ${xpTotalReward}`,
    );
  }
  const xpScheduleMatchesPolicy =
    xpTotalReward === ATA_TOTAL_XP &&
    policyTotal === ATA_TOTAL_XP &&
    scheduleBuckets.every((bucket) => {
      const paid = xpPaidByPair.get(bucket.pair);
      return paid?.levels === bucket.levels && paid?.subtotal === bucket.subtotal;
    });

  const lifecycle: AtaLifecycleMatrix = {
    structureReady: structural.size === ATA_LEVEL_COUNT && pkg.modules.length === ATA_MODULE_COUNT,
    videoLessons: videoLevels.length,
    testBanksPresent,
    questionsPresent,
    correctAnswersPresent,
    takeMappingsPresent,
    proposedTestBanks: proposed,
    sourceBackedTestBanks: sourceBacked,
    platformApprovedTestBanks: platformApproved,
    missingTestBanks: missingBanks,
    conflictingTestBanks: conflictingBanks,
    platformImported: "UNKNOWN",
    nonVideoEditorialComplete: nonVideoEditorial.filter((level) => editorial.has(level.levelNumber)).length,
    nonVideoEditorialRequired: nonVideoEditorial.length,
    productionReadyLevels: productionReady.size,
    xpUnresolvedLevels: xpUnresolved,
    xpApprovedLevels: xpApproved,
    xpTotalReward,
    xpScheduleMatchesPolicy,
  };

  const report: AtaCompletenessReport = {
    totalLevels: packageLevels.length,
    structurallyCompleteLevels: structural.size,
    structuralCompletenessPercent: percent(structural.size, ATA_LEVEL_COUNT),
    editorialRequiredLevels: editorialRequired.length,
    editoriallyCompleteRequiredLevels: editorialRequiredComplete,
    editorialCompletenessPercent: percent(editorialRequiredComplete, editorialRequired.length),
    levelsWithNoEditorialGap: editorial.size,
    productionReadyLevels: productionReady.size,
    blocksV2ContentLevels,
    byKind,
    lifecycle,
  };

  // The XP gaps join `gaps` only now — after the per-level editorial tally has
  // been taken — so they gate approval without distorting "how much is written".
  gaps.push(...xpGaps);

  // An `approved` ATA-100 package must have neither. A `draft` may carry gaps —
  // that is what a draft IS — but never structural issues.
  //
  // Because the XP gaps are in `gaps`, §14's release gate follows for free: an
  // APPROVED full-ATA package cannot ship while the XP schedule is an undeclared
  // placeholder, while a DRAFT carries the unresolved state openly and stays
  // valid. The rule is a gate, not a comment.
  const ok = issues.length === 0 && (pkg.status !== "approved" || gaps.length === 0);
  return { ok, issues, gaps, report };
}

/** Counts that hold for the canonical source itself, independent of any package. */
export const ATA_PRODUCT_EXPECTATIONS = {
  levels: ATA_LEVEL_COUNT,
  modules: ATA_MODULE_COUNT,
  checkpoints: ATA_CHECKPOINT_COUNT,
  toolUnlocks: ATA_TOOL_UNLOCK_COUNT,
  communityUnlocks: ATA_COMMUNITY_UNLOCK_COUNT,
  practicals: ATA_PRACTICAL_COUNT,
  mentorReviews: ATA_MENTOR_REVIEW_COUNT,
  /** PHASE-F — the approved product total. */
  totalXp: ATA_TOTAL_XP,
} as const;
