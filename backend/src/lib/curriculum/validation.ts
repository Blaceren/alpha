import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import type {
  CurriculumDraftSnapshot,
  CurriculumValidationIssue,
  CurriculumValidationResult,
} from "@/lib/curriculum/types";

type ValidateOptions = {
  now?: Date;
};

// Pure publish-readiness validation. No DB access, no writes, collects every
// issue in one pass instead of throwing on the first problem.
export function validateCurriculumDraft(
  snapshot: CurriculumDraftSnapshot,
  options: ValidateOptions = {},
): CurriculumValidationResult {
  const now = options.now ?? new Date();
  const issues: CurriculumValidationIssue[] = [];
  const { version, modules, levels } = snapshot;

  const versionRef = `curriculumVersion:${version.id}`;

  function issue(
    code: string,
    entity: CurriculumValidationIssue["entity"],
    reference: string,
    message: string,
  ) {
    issues.push({ code, entity, reference, message });
  }

  // --- CurriculumVersion ---
  if (version.status !== "draft") {
    issue("VERSION_NOT_DRAFT", "curriculumVersion", versionRef, `status is "${version.status}", publish validation expects "draft"`);
  }
  if (version.versionNumber <= 0) {
    issue("VERSION_NUMBER_INVALID", "curriculumVersion", versionRef, `versionNumber must be > 0, got ${version.versionNumber}`);
  }
  if (!version.code.trim()) {
    issue("VERSION_CODE_EMPTY", "curriculumVersion", versionRef, "code must not be empty");
  }
  if (!version.name.trim()) {
    issue("VERSION_NAME_EMPTY", "curriculumVersion", versionRef, "name must not be empty");
  }
  if (version.status === "draft" && version.publishedAt !== null) {
    issue("DRAFT_HAS_PUBLISHED_AT", "curriculumVersion", versionRef, "draft version must not have publishedAt");
  }
  if (version.effectiveFrom !== null && version.effectiveFrom.getTime() > now.getTime()) {
    issue("EFFECTIVE_FROM_IN_FUTURE", "curriculumVersion", versionRef, "effectiveFrom is in the future; scheduled publication is not supported yet");
  }

  // --- Modules ---
  const activeModules = modules
    .filter((module) => module.status === "active")
    .sort((a, b) => a.moduleNumber - b.moduleNumber);

  for (const moduleDef of modules) {
    const ref = `module:${moduleDef.moduleNumber}`;

    if (moduleDef.status !== "active") {
      issue("DISABLED_MODULE_BLOCKS_PUBLICATION", "module", ref, "disabled module cannot be part of a published mandatory route");
    }
    if (!moduleDef.code.trim()) {
      issue("MODULE_CODE_EMPTY", "module", ref, "module code must not be empty");
    }
    if (moduleDef.firstLevel <= 0) {
      issue("MODULE_FIRST_LEVEL_INVALID", "module", ref, `firstLevel must be > 0, got ${moduleDef.firstLevel}`);
    }
    if (moduleDef.firstLevel > moduleDef.lastLevel) {
      issue("MODULE_RANGE_INVALID", "module", ref, `firstLevel ${moduleDef.firstLevel} > lastLevel ${moduleDef.lastLevel}`);
    }
    if (
      moduleDef.checkpointLevel !== null &&
      (moduleDef.checkpointLevel < moduleDef.firstLevel || moduleDef.checkpointLevel > moduleDef.lastLevel)
    ) {
      issue("MODULE_CHECKPOINT_OUT_OF_RANGE", "module", ref, `checkpointLevel ${moduleDef.checkpointLevel} is outside [${moduleDef.firstLevel}..${moduleDef.lastLevel}]`);
    }
  }

  if (activeModules.length === 0) {
    issue("NO_ACTIVE_MODULES", "curriculumVersion", versionRef, "at least one active module is required");
  } else {
    if (activeModules[0].moduleNumber !== 1) {
      issue("MODULE_NUMBERS_START_INVALID", "module", `module:${activeModules[0].moduleNumber}`, "active module numbering must start at 1");
    }
    for (let i = 1; i < activeModules.length; i += 1) {
      if (activeModules[i].moduleNumber !== activeModules[i - 1].moduleNumber + 1) {
        issue("MODULE_NUMBERS_NOT_SEQUENTIAL", "module", `module:${activeModules[i].moduleNumber}`, `module numbers must be sequential; ${activeModules[i - 1].moduleNumber} is followed by ${activeModules[i].moduleNumber}`);
      }
    }

    if (activeModules[0].firstLevel !== 1) {
      issue("MODULE_RANGES_START_NOT_ONE", "module", `module:${activeModules[0].moduleNumber}`, `first active module must start at level 1, got ${activeModules[0].firstLevel}`);
    }
    for (let i = 1; i < activeModules.length; i += 1) {
      const prev = activeModules[i - 1];
      const current = activeModules[i];
      if (current.firstLevel <= prev.lastLevel) {
        issue("MODULE_RANGES_OVERLAP", "module", `module:${current.moduleNumber}`, `range [${current.firstLevel}..${current.lastLevel}] overlaps module ${prev.moduleNumber} [${prev.firstLevel}..${prev.lastLevel}]`);
      } else if (current.firstLevel !== prev.lastLevel + 1) {
        issue("MODULE_RANGES_GAP", "module", `module:${current.moduleNumber}`, `range gap: module ${prev.moduleNumber} ends at ${prev.lastLevel}, module ${current.moduleNumber} starts at ${current.firstLevel}`);
      }
    }
  }

  // --- Levels ---
  const activeLevels = levels
    .filter((level) => level.status === "active")
    .sort((a, b) => a.levelNumber - b.levelNumber);
  const activeLevelsByNumber = new Map(activeLevels.map((level) => [level.levelNumber, level]));
  const modulesById = new Map(modules.map((module) => [module.id, module]));

  if (activeLevels.length === 0) {
    issue("NO_ACTIVE_LEVELS", "curriculumVersion", versionRef, "at least one active level is required");
  } else {
    if (activeLevels[0].levelNumber !== 1) {
      issue("LEVEL_NUMBERS_START_INVALID", "level", `level:${activeLevels[0].levelNumber}`, "active level numbering must start at 1");
    }
    for (let i = 1; i < activeLevels.length; i += 1) {
      if (activeLevels[i].levelNumber !== activeLevels[i - 1].levelNumber + 1) {
        issue("LEVEL_NUMBERS_NOT_SEQUENTIAL", "level", `level:${activeLevels[i].levelNumber}`, `level numbers must be sequential; ${activeLevels[i - 1].levelNumber} is followed by ${activeLevels[i].levelNumber}`);
      }
    }
  }

  for (const level of levels) {
    const ref = `level:${level.levelNumber} (${level.stableCode})`;

    if (level.status !== "active") {
      issue("DISABLED_LEVEL_BLOCKS_PUBLICATION", "level", ref, "disabled level cannot be part of a published mandatory route");
    }

    const parentModule = modulesById.get(level.moduleId);
    if (!parentModule) {
      issue("LEVEL_MODULE_MISSING", "level", ref, `moduleId ${level.moduleId} is not part of this snapshot`);
    } else if (
      level.levelNumber < parentModule.firstLevel ||
      level.levelNumber > parentModule.lastLevel
    ) {
      issue("LEVEL_OUT_OF_MODULE_RANGE", "level", ref, `levelNumber ${level.levelNumber} is outside module ${parentModule.moduleNumber} range [${parentModule.firstLevel}..${parentModule.lastLevel}]`);
    }

    const stableCodeMatch = STABLE_CODE_PATTERN.exec(level.stableCode);
    if (!stableCodeMatch) {
      issue("LEVEL_STABLE_CODE_INVALID", "level", ref, "stableCode must match v2.lNNN.<lowercase-kebab-slug>");
    } else if (Number(stableCodeMatch[1]) !== level.levelNumber) {
      issue("LEVEL_STABLE_CODE_NUMBER_MISMATCH", "level", ref, `stableCode number ${stableCodeMatch[1]} does not match levelNumber ${level.levelNumber}`);
    }

    if (!level.title.trim()) {
      issue("LEVEL_TITLE_EMPTY", "level", ref, "title must not be empty");
    }
    if (!level.learningObjective.trim()) {
      issue("LEVEL_OBJECTIVE_EMPTY", "level", ref, "learningObjective must not be empty");
    }
    if (level.xpReward < 0) {
      issue("LEVEL_XP_REWARD_NEGATIVE", "level", ref, `xpReward must be >= 0, got ${level.xpReward}`);
    }
    if (level.requiredXp < 0) {
      issue("LEVEL_REQUIRED_XP_NEGATIVE", "level", ref, `requiredXp must be >= 0, got ${level.requiredXp}`);
    }

    if (level.levelNumber === 1) {
      if (level.requiredPreviousLevel !== null) {
        issue("LEVEL_PREVIOUS_MUST_BE_NULL", "level", ref, "level 1 must not require a previous level");
      }
    } else if (level.requiredPreviousLevel !== level.levelNumber - 1) {
      issue("LEVEL_PREVIOUS_INVALID", "level", ref, `requiredPreviousLevel must be ${level.levelNumber - 1}, got ${level.requiredPreviousLevel}`);
    }

    if (level.requiredCheckpointLevel !== null) {
      if (level.requiredCheckpointLevel >= level.levelNumber) {
        issue("LEVEL_CHECKPOINT_FORWARD", "level", ref, `requiredCheckpointLevel ${level.requiredCheckpointLevel} must be < levelNumber ${level.levelNumber}`);
      }
      const checkpointLevel = activeLevelsByNumber.get(level.requiredCheckpointLevel);
      if (!checkpointLevel) {
        issue("LEVEL_CHECKPOINT_MISSING", "level", ref, `requiredCheckpointLevel ${level.requiredCheckpointLevel} does not reference an existing active level`);
      } else if (checkpointLevel.type !== "financial_checkpoint") {
        issue("LEVEL_CHECKPOINT_NOT_FINANCIAL", "level", ref, `requiredCheckpointLevel ${level.requiredCheckpointLevel} references type "${checkpointLevel.type}", expected financial_checkpoint`);
      }
    }

    if (level.visibilityRule !== null) {
      issue("LEVEL_VISIBILITY_RULE_NOT_NULL", "level", ref, "visibilityRule must be null in Phase 1");
    }
  }

  // Every number of every active module range must be covered by exactly one active level.
  for (const moduleDef of activeModules) {
    for (let number = moduleDef.firstLevel; number <= moduleDef.lastLevel; number += 1) {
      const matches = activeLevels.filter(
        (level) => level.levelNumber === number && level.moduleId === moduleDef.id,
      );
      if (matches.length === 0) {
        issue("LEVEL_RANGE_INCOMPLETE", "module", `module:${moduleDef.moduleNumber}`, `no active level for number ${number} in module range [${moduleDef.firstLevel}..${moduleDef.lastLevel}]`);
      } else if (matches.length > 1) {
        issue("LEVEL_NUMBER_DUPLICATE", "module", `module:${moduleDef.moduleNumber}`, `level number ${number} is defined more than once`);
      }
    }

    if (moduleDef.checkpointLevel !== null) {
      const checkpointLevel = activeLevelsByNumber.get(moduleDef.checkpointLevel);
      if (!checkpointLevel) {
        issue("MODULE_CHECKPOINT_LEVEL_MISSING", "module", `module:${moduleDef.moduleNumber}`, `checkpointLevel ${moduleDef.checkpointLevel} has no matching active level`);
      } else if (checkpointLevel.type !== "financial_checkpoint") {
        issue("MODULE_CHECKPOINT_NOT_FINANCIAL", "module", `module:${moduleDef.moduleNumber}`, `checkpointLevel ${moduleDef.checkpointLevel} references type "${checkpointLevel.type}", expected financial_checkpoint`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
