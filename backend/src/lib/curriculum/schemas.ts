import { z } from "zod";

const idSchema = z.number().int().positive();
const trimmedRequired = z.string().trim().min(1);
const trimmedOptional = z.string().trim();

export const levelTypeSchema = z.enum([
  "external_event",
  "lesson",
  "scenario",
  "practice",
  "report",
  "mentor_review",
  "financial_checkpoint",
  "final_exam",
]);

export const definitionStatusSchema = z.enum(["active", "disabled"]);

// Phase 1: visibilityRule may only ever be null (or omitted).
const nullVisibilityRule = z.null().optional();

export const createCurriculumDraftSchema = z.strictObject({
  actorId: idSchema,
  code: trimmedRequired,
  name: trimmedRequired,
  versionNumber: idSchema,
  effectiveFrom: z.date().nullable().optional(),
  changeNotes: trimmedOptional.nullable().optional(),
});

export const updateCurriculumDraftSchema = z.strictObject({
  actorId: idSchema,
  curriculumVersionId: idSchema,
  patch: z
    .strictObject({
      name: trimmedRequired.optional(),
      effectiveFrom: z.date().nullable().optional(),
      changeNotes: trimmedOptional.nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "patch must contain at least one field",
    }),
});

export const deleteCurriculumDraftSchema = z.strictObject({
  actorId: idSchema,
  curriculumVersionId: idSchema,
});

export const createModuleDefinitionSchema = z.strictObject({
  actorId: idSchema,
  curriculumVersionId: idSchema,
  moduleNumber: idSchema,
  code: trimmedRequired,
  title: trimmedRequired,
  description: trimmedOptional.optional(),
  learningObjective: trimmedRequired,
  firstLevel: idSchema,
  lastLevel: idSchema,
  checkpointLevel: idSchema.nullable().optional(),
  status: definitionStatusSchema.optional(),
});

export const updateModuleDefinitionSchema = z.strictObject({
  actorId: idSchema,
  moduleDefinitionId: idSchema,
  patch: z.strictObject({
    moduleNumber: idSchema.optional(),
    code: trimmedRequired.optional(),
    title: trimmedRequired.optional(),
    description: trimmedOptional.optional(),
    learningObjective: trimmedRequired.optional(),
    firstLevel: idSchema.optional(),
    lastLevel: idSchema.optional(),
    checkpointLevel: idSchema.nullable().optional(),
    status: definitionStatusSchema.optional(),
  }),
});

export const deleteModuleDefinitionSchema = z.strictObject({
  actorId: idSchema,
  moduleDefinitionId: idSchema,
});

export const createLevelDefinitionSchema = z.strictObject({
  actorId: idSchema,
  curriculumVersionId: idSchema,
  moduleId: idSchema,
  levelNumber: idSchema,
  stableCode: trimmedRequired,
  type: levelTypeSchema,
  title: trimmedRequired,
  shortDescription: trimmedOptional.optional(),
  learningObjective: trimmedRequired,
  completionMethod: trimmedRequired,
  xpReward: z.number().int().min(0).optional(),
  requiredXp: z.number().int().min(0).optional(),
  requiredPreviousLevel: idSchema.nullable().optional(),
  requiredCheckpointLevel: idSchema.nullable().optional(),
  featureUnlockCode: trimmedRequired.nullable().optional(),
  visibilityRule: nullVisibilityRule,
  status: definitionStatusSchema.optional(),
});

export const updateLevelDefinitionSchema = z.strictObject({
  actorId: idSchema,
  levelDefinitionId: idSchema,
  patch: z.strictObject({
    moduleId: idSchema.optional(),
    levelNumber: idSchema.optional(),
    stableCode: trimmedRequired.optional(),
    type: levelTypeSchema.optional(),
    title: trimmedRequired.optional(),
    shortDescription: trimmedOptional.optional(),
    learningObjective: trimmedRequired.optional(),
    completionMethod: trimmedRequired.optional(),
    xpReward: z.number().int().min(0).optional(),
    requiredXp: z.number().int().min(0).optional(),
    requiredPreviousLevel: idSchema.nullable().optional(),
    requiredCheckpointLevel: idSchema.nullable().optional(),
    featureUnlockCode: trimmedRequired.nullable().optional(),
    status: definitionStatusSchema.optional(),
  }),
});

export const deleteLevelDefinitionSchema = z.strictObject({
  actorId: idSchema,
  levelDefinitionId: idSchema,
});

export type CreateCurriculumDraftInput = z.infer<typeof createCurriculumDraftSchema>;
export type UpdateCurriculumDraftInput = z.infer<typeof updateCurriculumDraftSchema>;
export type DeleteCurriculumDraftInput = z.infer<typeof deleteCurriculumDraftSchema>;
export type CreateModuleDefinitionInput = z.infer<typeof createModuleDefinitionSchema>;
export type UpdateModuleDefinitionInput = z.infer<typeof updateModuleDefinitionSchema>;
export type DeleteModuleDefinitionInput = z.infer<typeof deleteModuleDefinitionSchema>;
export type CreateLevelDefinitionInput = z.infer<typeof createLevelDefinitionSchema>;
export type UpdateLevelDefinitionInput = z.infer<typeof updateLevelDefinitionSchema>;
export type DeleteLevelDefinitionInput = z.infer<typeof deleteLevelDefinitionSchema>;
