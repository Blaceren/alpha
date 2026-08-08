import { z } from "zod";
import { expectedRevisionSchema } from "@/lib/curriculum/authoring-mutation-guard";

const MAX_INT = 2_147_483_647;
const NORMALIZED_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const STABLE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_TAG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const actorId = z.number().int().positive().max(MAX_INT);
const entityId = z.number().int().positive().max(MAX_INT);
const passPercent = z.number().int().min(1).max(100);
const maxAttempts = z.number().int().positive().max(MAX_INT).nullable();
const changeNotes = z.string().trim().max(4_000).nullable();
const questionNumber = z.number().int().positive().max(MAX_INT);

export const assessmentQuestionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "true_false",
  "ordered_steps",
  "scenario_choice",
  "numeric",
  "chart_choice",
]);

export const assessmentLocaleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(35)
  .regex(NORMALIZED_LOCALE, "locale must be a normalized language tag");


/**
 * PHASE-G0 CORRECTION — the mandatory aggregate revision, identical in meaning
 * and transport to the content side. Required on every substantive mutation
 * beneath an AssessmentVersion: prompts, option labels, option sets, correct
 * answers, explanations, the take mapping, and question creation/deletion are
 * all substantive, because approving question 3 while question 1's answer key
 * moved underneath is exactly the failure the aggregate guard exists to stop.
 */
const expectedRevision = expectedRevisionSchema;

const versionPatch = z
  .strictObject({
    passPercent: passPercent.optional(),
    maxAttempts: maxAttempts.optional(),
    showExplanation: z.boolean().optional(),
    changeNotes: changeNotes.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "patch must contain at least one field",
  });

export const createAssessmentVersionSchema = z.strictObject({
  actorId,
  levelDefinitionId: entityId,
  passPercent,
  maxAttempts: maxAttempts.optional(),
  showExplanation: z.boolean().optional(),
  changeNotes: changeNotes.optional(),
});

export const updateAssessmentVersionSchema = z.strictObject({
  actorId,
  assessmentVersionId: entityId,
  expectedRevision,
  patch: versionPatch,
});

export const deleteAssessmentVersionSchema = z.strictObject({
  actorId,
  assessmentVersionId: entityId,
  expectedRevision,
});

const questionFields = {
  questionNumber,
  stableKey: z.string().trim().regex(STABLE_KEY),
  type: assessmentQuestionTypeSchema,
  skillTag: z.string().trim().regex(SKILL_TAG).nullable().optional(),
  options: z.unknown(),
  correctAnswer: z.unknown(),
} as const;

export const createAssessmentQuestionSchema = z.strictObject({
  actorId,
  expectedRevision,
  assessmentVersionId: entityId,
  ...questionFields,
});

export const updateAssessmentQuestionSchema = z.strictObject({
  actorId,
  expectedRevision,
  questionDefinitionId: entityId,
  patch: z
    .strictObject({
      questionNumber: questionFields.questionNumber.optional(),
      stableKey: questionFields.stableKey.optional(),
      type: questionFields.type.optional(),
      skillTag: questionFields.skillTag.optional(),
      options: questionFields.options.optional(),
      correctAnswer: questionFields.correctAnswer.optional(),
    })
    .refine((value) => Object.values(value).some((item) => item !== undefined), {
      message: "patch must contain at least one field",
    }),
});

export const deleteAssessmentQuestionSchema = z.strictObject({
  actorId,
  expectedRevision,
  questionDefinitionId: entityId,
});

const prompt = z.string().trim().min(1).max(8_000);
const explanation = z.string().trim().min(1).max(8_000).nullable();
const optionLabels = z.record(z.string(), z.string().trim().min(1).max(1_000)).nullable();

export const createQuestionLocalizationSchema = z.strictObject({
  actorId,
  expectedRevision,
  questionDefinitionId: entityId,
  locale: assessmentLocaleSchema,
  prompt,
  optionLabels,
  explanation,
});

export const updateQuestionLocalizationSchema = z.strictObject({
  actorId,
  expectedRevision,
  questionLocalizationId: entityId,
  patch: z
    .strictObject({
      locale: assessmentLocaleSchema.optional(),
      prompt: prompt.optional(),
      optionLabels: optionLabels.optional(),
      explanation: explanation.optional(),
    })
    .refine((value) => Object.values(value).some((item) => item !== undefined), {
      message: "patch must contain at least one field",
    }),
});

export const deleteQuestionLocalizationSchema = z.strictObject({
  actorId,
  expectedRevision,
  questionLocalizationId: entityId,
});

export const publishAssessmentVersionSchema = z.strictObject({
  actorId,
  assessmentVersionId: entityId,
  expectedPublishedAssessmentVersionId: entityId.nullable().optional(),
});

export const archiveAssessmentVersionSchema = z.strictObject({
  actorId,
  assessmentVersionId: entityId,
});

export const setAssessmentBindingSchema = z.strictObject({
  actorId,
  levelDefinitionId: entityId,
  assessmentVersionId: entityId,
});

export const clearAssessmentBindingSchema = z.strictObject({
  actorId,
  levelDefinitionId: entityId,
});
