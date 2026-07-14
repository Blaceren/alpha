import type {
  CurriculumVersion,
  LevelDefinition,
  ModuleDefinition,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { CURRICULUM_AUDIT_ACTIONS, STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import { CurriculumDomainError } from "@/lib/curriculum/errors";
import type { CurriculumDomainErrorCode } from "@/lib/curriculum/errors";
import {
  createCurriculumDraftSchema,
  createLevelDefinitionSchema,
  createModuleDefinitionSchema,
  deleteCurriculumDraftSchema,
  deleteLevelDefinitionSchema,
  deleteModuleDefinitionSchema,
  updateCurriculumDraftSchema,
  updateLevelDefinitionSchema,
  updateModuleDefinitionSchema,
} from "@/lib/curriculum/schemas";
import {
  assertAdminActor,
  assertCurriculumEditable,
  writeAuditInTransaction,
} from "@/lib/curriculum/service";
import type { CurriculumValidationIssue } from "@/lib/curriculum/types";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;
type InputEntity = CurriculumValidationIssue["entity"];

// Draft authoring commands. Write-time validation covers local correctness of
// a single object; full sequence/range/checkpoint consistency stays a
// publish-time concern (validateCurriculumDraft).

function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
  entity: InputEntity,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CurriculumDomainError(
      "CURRICULUM_INPUT_INVALID",
      `invalid ${entity} command input`,
      result.error.issues.map((issue) => ({
        code: "INPUT_INVALID",
        entity,
        reference: issue.path.join(".") || "input",
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function stripUndefined<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

// After stripUndefined only explicitly-provided keys remain (explicit null is
// kept, an omitted field is gone). Module/Level patches carry no Date fields,
// so a direct comparison correctly distinguishes "not passed" from
// "explicitly null" from "cleared string".
function patchHasChanges<T extends Record<string, unknown>>(
  existing: T,
  patch: Partial<T>,
): boolean {
  return Object.entries(patch).some(
    ([key, value]) => existing[key as keyof T] !== value,
  );
}

function throwInputIssues(entity: InputEntity, issues: CurriculumValidationIssue[]) {
  if (issues.length > 0) {
    throw new CurriculumDomainError(
      "CURRICULUM_INPUT_INVALID",
      `invalid ${entity} state`,
      issues,
    );
  }
}

function mapKnownPrismaError(
  error: unknown,
  mapping: { conflict: CurriculumDomainErrorCode; notFound?: CurriculumDomainErrorCode },
): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new CurriculumDomainError(mapping.conflict, "unique constraint conflict");
    }
    if (error.code === "P2003") {
      throw new CurriculumDomainError(mapping.conflict, "relation constraint conflict");
    }
    if (error.code === "P2025") {
      throw new CurriculumDomainError(
        mapping.notFound ?? "CURRICULUM_NOT_FOUND",
        "record does not exist",
      );
    }
  }
  throw error;
}

async function loadEditableVersion(
  curriculumVersionId: number,
  tx: DbClient,
): Promise<CurriculumVersion> {
  const version = await tx.curriculumVersion.findUnique({
    where: { id: curriculumVersionId },
  });
  if (!version) {
    throw new CurriculumDomainError(
      "CURRICULUM_NOT_FOUND",
      `CurriculumVersion ${curriculumVersionId} does not exist`,
    );
  }
  assertCurriculumEditable(version);
  return version;
}

// ---------- final-state invariants (single-object, write-time) ----------

function moduleStateIssues(state: {
  moduleNumber: number;
  code: string;
  title: string;
  learningObjective: string;
  firstLevel: number;
  lastLevel: number;
  checkpointLevel: number | null;
}): CurriculumValidationIssue[] {
  const issues: CurriculumValidationIssue[] = [];
  const ref = `module:${state.moduleNumber}`;

  if (!state.code.trim()) {
    issues.push({ code: "MODULE_CODE_EMPTY", entity: "module", reference: ref, message: "code must not be empty" });
  }
  if (!state.title.trim()) {
    issues.push({ code: "MODULE_TITLE_EMPTY", entity: "module", reference: ref, message: "title must not be empty" });
  }
  if (!state.learningObjective.trim()) {
    issues.push({ code: "MODULE_OBJECTIVE_EMPTY", entity: "module", reference: ref, message: "learningObjective must not be empty" });
  }
  if (state.firstLevel > state.lastLevel) {
    issues.push({ code: "MODULE_RANGE_INVALID", entity: "module", reference: ref, message: `firstLevel ${state.firstLevel} > lastLevel ${state.lastLevel}` });
  }
  if (
    state.checkpointLevel !== null &&
    (state.checkpointLevel < state.firstLevel || state.checkpointLevel > state.lastLevel)
  ) {
    issues.push({ code: "MODULE_CHECKPOINT_OUT_OF_RANGE", entity: "module", reference: ref, message: `checkpointLevel ${state.checkpointLevel} is outside [${state.firstLevel}..${state.lastLevel}]` });
  }

  return issues;
}

function levelStateIssues(state: {
  levelNumber: number;
  stableCode: string;
  title: string;
  learningObjective: string;
  requiredPreviousLevel: number | null;
  requiredCheckpointLevel: number | null;
}): CurriculumValidationIssue[] {
  const issues: CurriculumValidationIssue[] = [];
  const ref = `level:${state.levelNumber}`;

  const match = STABLE_CODE_PATTERN.exec(state.stableCode);
  if (!match) {
    issues.push({ code: "LEVEL_STABLE_CODE_INVALID", entity: "level", reference: ref, message: "stableCode must match v2.lNNN.<lowercase-kebab-slug>" });
  } else if (Number(match[1]) !== state.levelNumber) {
    issues.push({ code: "LEVEL_STABLE_CODE_NUMBER_MISMATCH", entity: "level", reference: ref, message: `stableCode number ${match[1]} does not match levelNumber ${state.levelNumber}` });
  }
  if (!state.title.trim()) {
    issues.push({ code: "LEVEL_TITLE_EMPTY", entity: "level", reference: ref, message: "title must not be empty" });
  }
  if (!state.learningObjective.trim()) {
    issues.push({ code: "LEVEL_OBJECTIVE_EMPTY", entity: "level", reference: ref, message: "learningObjective must not be empty" });
  }
  if (state.requiredPreviousLevel !== null && state.requiredPreviousLevel >= state.levelNumber) {
    issues.push({ code: "LEVEL_PREVIOUS_INVALID", entity: "level", reference: ref, message: `requiredPreviousLevel ${state.requiredPreviousLevel} must be < levelNumber ${state.levelNumber}` });
  }
  if (state.requiredCheckpointLevel !== null && state.requiredCheckpointLevel >= state.levelNumber) {
    issues.push({ code: "LEVEL_CHECKPOINT_FORWARD", entity: "level", reference: ref, message: `requiredCheckpointLevel ${state.requiredCheckpointLevel} must be < levelNumber ${state.levelNumber}` });
  }

  return issues;
}

// ---------- CurriculumVersion commands ----------

export async function createCurriculumDraft(input: unknown): Promise<CurriculumVersion> {
  const data = parseInput(createCurriculumDraftSchema, input, "curriculumVersion");

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);

    let created: CurriculumVersion;
    try {
      created = await tx.curriculumVersion.create({
        data: {
          code: data.code,
          name: data.name,
          versionNumber: data.versionNumber,
          effectiveFrom: data.effectiveFrom ?? null,
          changeNotes: data.changeNotes ?? null,
          createdById: data.actorId,
        },
      });
    } catch (error) {
      mapKnownPrismaError(error, { conflict: "CURRICULUM_CONFLICT" });
    }

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.draftCreated,
      entityId: created.id,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: created.id,
        code: created.code,
        versionNumber: created.versionNumber,
      },
    });

    return created;
  });
}

export async function updateCurriculumDraft(input: unknown): Promise<CurriculumVersion> {
  const data = parseInput(updateCurriculumDraftSchema, input, "curriculumVersion");
  data.patch = stripUndefined(data.patch);
  const changedFields = Object.keys(data.patch);

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);
    const version = await loadEditableVersion(data.curriculumVersionId, tx);

    // A body with values identical to the current entity must not create a
    // fake audit entry (approved contract: typed CURRICULUM_NO_CHANGES).
    const noChanges = Object.entries(data.patch).every(([key, value]) => {
      const current = version[key as keyof CurriculumVersion];
      if (value instanceof Date || current instanceof Date) {
        const nextTime = value instanceof Date ? value.getTime() : value;
        const currentTime = current instanceof Date ? current.getTime() : current;
        return nextTime === currentTime;
      }
      return current === value;
    });
    if (noChanges) {
      throw new CurriculumDomainError(
        "CURRICULUM_NO_CHANGES",
        `patch does not change CurriculumVersion ${version.id}`,
      );
    }

    const updated = await tx.curriculumVersion.update({
      where: { id: version.id },
      data: data.patch,
    });

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.draftUpdated,
      entityId: updated.id,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: updated.id,
        code: updated.code,
        versionNumber: updated.versionNumber,
        changedFields,
      },
    });

    return updated;
  });
}

export async function deleteEmptyCurriculumDraft(input: unknown): Promise<void> {
  const data = parseInput(deleteCurriculumDraftSchema, input, "curriculumVersion");

  await prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);
    const version = await loadEditableVersion(data.curriculumVersionId, tx);

    const [moduleCount, levelCount] = await Promise.all([
      tx.moduleDefinition.count({ where: { curriculumVersionId: version.id } }),
      tx.levelDefinition.count({ where: { curriculumVersionId: version.id } }),
    ]);

    if (moduleCount > 0 || levelCount > 0) {
      throw new CurriculumDomainError(
        "CURRICULUM_NOT_EMPTY",
        `CurriculumVersion ${version.id} still has ${moduleCount} module(s) and ${levelCount} level(s)`,
      );
    }

    await tx.curriculumVersion.delete({ where: { id: version.id } });

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.draftDeleted,
      entityId: version.id,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: version.id,
        code: version.code,
        versionNumber: version.versionNumber,
      },
    });
  });
}

// ---------- ModuleDefinition commands ----------

export async function createModuleDefinition(input: unknown): Promise<ModuleDefinition> {
  const data = parseInput(createModuleDefinitionSchema, input, "module");

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);
    const version = await loadEditableVersion(data.curriculumVersionId, tx);

    throwInputIssues(
      "module",
      moduleStateIssues({
        moduleNumber: data.moduleNumber,
        code: data.code,
        title: data.title,
        learningObjective: data.learningObjective,
        firstLevel: data.firstLevel,
        lastLevel: data.lastLevel,
        checkpointLevel: data.checkpointLevel ?? null,
      }),
    );

    let created: ModuleDefinition;
    try {
      created = await tx.moduleDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleNumber: data.moduleNumber,
          code: data.code,
          title: data.title,
          description: data.description ?? "",
          learningObjective: data.learningObjective,
          firstLevel: data.firstLevel,
          lastLevel: data.lastLevel,
          checkpointLevel: data.checkpointLevel ?? null,
          status: data.status ?? "active",
        },
      });
    } catch (error) {
      mapKnownPrismaError(error, { conflict: "MODULE_CONFLICT" });
    }

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.moduleCreated,
      entityId: version.id,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: version.id,
        moduleDefinitionId: created.id,
        code: created.code,
        moduleNumber: created.moduleNumber,
      },
    });

    return created;
  });
}

export async function updateModuleDefinition(input: unknown): Promise<ModuleDefinition> {
  const data = parseInput(updateModuleDefinitionSchema, input, "module");
  data.patch = stripUndefined(data.patch);
  const changedFields = Object.keys(data.patch);

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);

    const existing = await tx.moduleDefinition.findUnique({
      where: { id: data.moduleDefinitionId },
    });
    if (!existing) {
      throw new CurriculumDomainError(
        "MODULE_NOT_FOUND",
        `ModuleDefinition ${data.moduleDefinitionId} does not exist`,
      );
    }
    await loadEditableVersion(existing.curriculumVersionId, tx);

    if (!patchHasChanges(existing, data.patch)) {
      throw new CurriculumDomainError(
        "MODULE_NO_CHANGES",
        `patch does not change ModuleDefinition ${existing.id}`,
      );
    }

    const next = { ...existing, ...data.patch };
    throwInputIssues(
      "module",
      moduleStateIssues({
        moduleNumber: next.moduleNumber,
        code: next.code,
        title: next.title,
        learningObjective: next.learningObjective,
        firstLevel: next.firstLevel,
        lastLevel: next.lastLevel,
        checkpointLevel: next.checkpointLevel,
      }),
    );

    let updated: ModuleDefinition;
    try {
      updated = await tx.moduleDefinition.update({
        where: { id: existing.id },
        data: data.patch,
      });
    } catch (error) {
      mapKnownPrismaError(error, { conflict: "MODULE_CONFLICT", notFound: "MODULE_NOT_FOUND" });
    }

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.moduleUpdated,
      entityId: existing.curriculumVersionId,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: existing.curriculumVersionId,
        moduleDefinitionId: updated.id,
        code: updated.code,
        moduleNumber: updated.moduleNumber,
        changedFields,
      },
    });

    return updated;
  });
}

export async function deleteEmptyModuleDefinition(input: unknown): Promise<void> {
  const data = parseInput(deleteModuleDefinitionSchema, input, "module");

  await prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);

    const existing = await tx.moduleDefinition.findUnique({
      where: { id: data.moduleDefinitionId },
    });
    if (!existing) {
      throw new CurriculumDomainError(
        "MODULE_NOT_FOUND",
        `ModuleDefinition ${data.moduleDefinitionId} does not exist`,
      );
    }
    await loadEditableVersion(existing.curriculumVersionId, tx);

    const levelCount = await tx.levelDefinition.count({
      where: { moduleId: existing.id },
    });
    if (levelCount > 0) {
      throw new CurriculumDomainError(
        "MODULE_NOT_EMPTY",
        `ModuleDefinition ${existing.id} still has ${levelCount} level(s)`,
      );
    }

    await tx.moduleDefinition.delete({ where: { id: existing.id } });

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.moduleDeleted,
      entityId: existing.curriculumVersionId,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: existing.curriculumVersionId,
        moduleDefinitionId: existing.id,
        code: existing.code,
        moduleNumber: existing.moduleNumber,
      },
    });
  });
}

// ---------- LevelDefinition commands ----------

async function loadModuleForVersion(
  moduleId: number,
  curriculumVersionId: number,
  tx: DbClient,
): Promise<ModuleDefinition> {
  const moduleDef = await tx.moduleDefinition.findUnique({ where: { id: moduleId } });
  if (!moduleDef) {
    throw new CurriculumDomainError(
      "MODULE_NOT_FOUND",
      `ModuleDefinition ${moduleId} does not exist`,
    );
  }
  if (moduleDef.curriculumVersionId !== curriculumVersionId) {
    throw new CurriculumDomainError(
      "MODULE_VERSION_MISMATCH",
      `ModuleDefinition ${moduleId} belongs to CurriculumVersion ${moduleDef.curriculumVersionId}, not ${curriculumVersionId}`,
    );
  }
  return moduleDef;
}

export async function createLevelDefinition(input: unknown): Promise<LevelDefinition> {
  const data = parseInput(createLevelDefinitionSchema, input, "level");

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);
    const version = await loadEditableVersion(data.curriculumVersionId, tx);
    await loadModuleForVersion(data.moduleId, version.id, tx);

    throwInputIssues(
      "level",
      levelStateIssues({
        levelNumber: data.levelNumber,
        stableCode: data.stableCode,
        title: data.title,
        learningObjective: data.learningObjective,
        requiredPreviousLevel: data.requiredPreviousLevel ?? null,
        requiredCheckpointLevel: data.requiredCheckpointLevel ?? null,
      }),
    );

    let created: LevelDefinition;
    try {
      created = await tx.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: data.moduleId,
          levelNumber: data.levelNumber,
          stableCode: data.stableCode,
          type: data.type,
          title: data.title,
          shortDescription: data.shortDescription ?? "",
          learningObjective: data.learningObjective,
          completionMethod: data.completionMethod,
          xpReward: data.xpReward ?? 0,
          requiredXp: data.requiredXp ?? 0,
          requiredPreviousLevel: data.requiredPreviousLevel ?? null,
          requiredCheckpointLevel: data.requiredCheckpointLevel ?? null,
          featureUnlockCode: data.featureUnlockCode ?? null,
          status: data.status ?? "active",
        },
      });
    } catch (error) {
      mapKnownPrismaError(error, { conflict: "LEVEL_CONFLICT", notFound: "LEVEL_NOT_FOUND" });
    }

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.levelCreated,
      entityId: version.id,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: version.id,
        levelDefinitionId: created.id,
        code: created.stableCode,
        levelNumber: created.levelNumber,
      },
    });

    return created;
  });
}

export async function updateLevelDefinition(input: unknown): Promise<LevelDefinition> {
  const data = parseInput(updateLevelDefinitionSchema, input, "level");
  data.patch = stripUndefined(data.patch);
  const changedFields = Object.keys(data.patch);

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);

    const existing = await tx.levelDefinition.findUnique({
      where: { id: data.levelDefinitionId },
    });
    if (!existing) {
      throw new CurriculumDomainError(
        "LEVEL_NOT_FOUND",
        `LevelDefinition ${data.levelDefinitionId} does not exist`,
      );
    }
    await loadEditableVersion(existing.curriculumVersionId, tx);

    if (!patchHasChanges(existing, data.patch)) {
      throw new CurriculumDomainError(
        "LEVEL_NO_CHANGES",
        `patch does not change LevelDefinition ${existing.id}`,
      );
    }

    if (data.patch.moduleId !== undefined) {
      await loadModuleForVersion(data.patch.moduleId, existing.curriculumVersionId, tx);
    }

    const next = { ...existing, ...data.patch };
    throwInputIssues(
      "level",
      levelStateIssues({
        levelNumber: next.levelNumber,
        stableCode: next.stableCode,
        title: next.title,
        learningObjective: next.learningObjective,
        requiredPreviousLevel: next.requiredPreviousLevel,
        requiredCheckpointLevel: next.requiredCheckpointLevel,
      }),
    );

    let updated: LevelDefinition;
    try {
      updated = await tx.levelDefinition.update({
        where: { id: existing.id },
        data: data.patch,
      });
    } catch (error) {
      mapKnownPrismaError(error, { conflict: "LEVEL_CONFLICT", notFound: "LEVEL_NOT_FOUND" });
    }

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.levelUpdated,
      entityId: existing.curriculumVersionId,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: existing.curriculumVersionId,
        levelDefinitionId: updated.id,
        code: updated.stableCode,
        levelNumber: updated.levelNumber,
        changedFields,
      },
    });

    return updated;
  });
}

export async function deleteLevelDefinition(input: unknown): Promise<void> {
  const data = parseInput(deleteLevelDefinitionSchema, input, "level");

  await prisma.$transaction(async (tx) => {
    await assertAdminActor(data.actorId, tx);

    const existing = await tx.levelDefinition.findUnique({
      where: { id: data.levelDefinitionId },
    });
    if (!existing) {
      throw new CurriculumDomainError(
        "LEVEL_NOT_FOUND",
        `LevelDefinition ${data.levelDefinitionId} does not exist`,
      );
    }
    await loadEditableVersion(existing.curriculumVersionId, tx);

    await tx.levelDefinition.delete({ where: { id: existing.id } });

    await writeAuditInTransaction(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.levelDeleted,
      entityId: existing.curriculumVersionId,
      metadata: {
        actorId: data.actorId,
        curriculumVersionId: existing.curriculumVersionId,
        levelDefinitionId: existing.id,
        code: existing.stableCode,
        levelNumber: existing.levelNumber,
      },
    });
  });
}
