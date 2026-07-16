import { z } from "zod";

const MAX_INT = 2_147_483_647;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const UNSAFE_TEXT = /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:/i;
const STABLE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NORMALIZED_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

function safeText(max: number, label: string) {
  return z.string().trim().min(1, `${label} must not be empty`).max(max, `${label} is too long`)
    .refine((value) => !UNSAFE_TEXT.test(value), `${label} contains unsafe markup or URI content`);
}

function optionalSafeText(max: number, label: string) {
  return z.string().trim().max(max, `${label} is too long`)
    .refine((value) => value.length === 0 || !UNSAFE_TEXT.test(value), `${label} contains unsafe markup or URI content`);
}

export const reportEntityIdSchema = z.number().int().positive().max(MAX_INT);
export const reportActorIdSchema = reportEntityIdSchema;
export const reportStableKeySchema = z.string().trim().min(1).max(64).regex(STABLE_KEY);
export const reportLocaleSchema = z.string().trim().toLowerCase().max(35)
  .regex(NORMALIZED_LOCALE, "locale must be an explicit normalized BCP-47 tag");
const sortOrder = z.number().int().nonnegative().max(MAX_INT);
const changeNotes = z.string().trim().max(4_000).nullable();
const expectedBindingRevision = z.number().int().nonnegative().max(MAX_INT);

const textRules = z.strictObject({
  version: z.literal(1),
  minLength: z.number().int().nonnegative().max(16_000).optional(),
  maxLength: z.number().int().positive().max(16_000).optional(),
}).refine((rules) => rules.minLength === undefined || rules.maxLength === undefined || rules.minLength <= rules.maxLength, {
  message: "minLength must not exceed maxLength",
});

const integerRules = z.strictObject({
  version: z.literal(1),
  minValue: z.number().int().min(-MAX_SAFE_INTEGER).max(MAX_SAFE_INTEGER).optional(),
  maxValue: z.number().int().min(-MAX_SAFE_INTEGER).max(MAX_SAFE_INTEGER).optional(),
}).refine((rules) => rules.minValue === undefined || rules.maxValue === undefined || rules.minValue <= rules.maxValue, {
  message: "minValue must not exceed maxValue",
});

const urlRules = z.strictObject({
  version: z.literal(1),
  allowedSchemes: z.tuple([z.literal("https")]),
});

const booleanRules = z.strictObject({ version: z.literal(1) });
const choiceRules = z.strictObject({
  version: z.literal(1),
  maxSelections: z.number().int().positive().max(50).optional(),
});

export const reportValidationRulesSchema = z.union([
  textRules, integerRules, urlRules, booleanRules, choiceRules,
]);

const choiceCodesSchema = z.array(reportStableKeySchema).min(2).max(50)
  .refine((codes) => new Set(codes).size === codes.length, "choice codes must be unique");

export const reportFieldDefinitionPayloadSchema = z.strictObject({
  stableKey: reportStableKeySchema,
  type: z.enum(["short_text", "long_text", "url", "integer", "boolean", "single_choice", "multi_choice"]),
  required: z.boolean(),
  sortOrder,
  validationRules: reportValidationRulesSchema.nullable(),
  choiceCodes: choiceCodesSchema.nullable(),
}).superRefine((field, context) => {
  const rules = field.validationRules;
  const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
  if (field.type === "single_choice" || field.type === "multi_choice") {
    if (field.choiceCodes === null) issue("choiceCodes", "choice fields require stable choice codes");
    if (rules !== null && !("maxSelections" in rules)) issue("validationRules", "choice fields require choice rules");
    if (field.type === "single_choice" && rules !== null && "maxSelections" in rules && rules.maxSelections !== undefined && rules.maxSelections !== 1) {
      issue("validationRules", "single_choice maxSelections must be one");
    }
    if (field.type === "multi_choice" && rules !== null && "maxSelections" in rules && rules.maxSelections !== undefined && field.choiceCodes !== null && rules.maxSelections > field.choiceCodes.length) {
      issue("validationRules", "maxSelections exceeds the number of choice codes");
    }
    return;
  }
  if (field.choiceCodes !== null) issue("choiceCodes", "non-choice fields must not define choice codes");
  if (rules === null) return;
  if ((field.type === "short_text" || field.type === "long_text") && !("minLength" in rules || "maxLength" in rules)) {
    issue("validationRules", "text fields require text rules");
  } else if (field.type === "integer" && !("minValue" in rules || "maxValue" in rules)) {
    issue("validationRules", "integer fields require integer rules");
  } else if (field.type === "url" && !("allowedSchemes" in rules)) {
    issue("validationRules", "URL fields require the approved HTTPS rule");
  } else if (field.type === "boolean" && Object.keys(rules).some((key) => key !== "version")) {
    issue("validationRules", "boolean fields support only the version marker");
  }
});

const assignmentLocalizationFields = {
  locale: reportLocaleSchema,
  title: safeText(300, "title"),
  instructions: safeText(12_000, "instructions"),
  successCriteriaSummary: optionalSafeText(4_000, "successCriteriaSummary"),
  submitLabel: optionalSafeText(120, "submitLabel"),
} as const;

const fieldLocalizationFields = {
  locale: reportLocaleSchema,
  label: safeText(300, "label"),
  helpText: optionalSafeText(4_000, "helpText"),
  placeholder: optionalSafeText(500, "placeholder"),
  choiceLabels: z.record(reportStableKeySchema, safeText(300, "choice label")).nullable(),
} as const;

const criterionFields = {
  stableKey: reportStableKeySchema,
  categoryCode: reportStableKeySchema,
  sortOrder,
  commentRequired: z.boolean(),
} as const;

const criterionLocalizationFields = {
  locale: reportLocaleSchema,
  title: safeText(300, "title"),
  description: safeText(4_000, "description"),
} as const;

const scaleOptionFields = {
  stableKey: reportStableKeySchema,
  ordinal: sortOrder,
} as const;

const scaleLocalizationFields = {
  locale: reportLocaleSchema,
  label: safeText(300, "label"),
  description: optionalSafeText(2_000, "description"),
} as const;

const reasonFields = {
  stableKey: reportStableKeySchema,
  sortOrder,
  active: z.boolean(),
} as const;

const reasonLocalizationFields = {
  locale: reportLocaleSchema,
  title: safeText(300, "title"),
  guidance: optionalSafeText(4_000, "guidance"),
} as const;

function nonEmptyPatch<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape).refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "patch must contain at least one field",
  });
}

export const createReportAssignmentSchema = z.strictObject({ actorId: reportActorIdSchema, levelDefinitionId: reportEntityIdSchema, changeNotes: changeNotes.optional() });
export const updateReportAssignmentSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentVersionId: reportEntityIdSchema, patch: nonEmptyPatch({ changeNotes: changeNotes.optional() }) });
export const deleteReportAssignmentSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentVersionId: reportEntityIdSchema });

export const createReportAssignmentLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentVersionId: reportEntityIdSchema, ...assignmentLocalizationFields });
export const updateReportAssignmentLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentLocalizationId: reportEntityIdSchema, patch: nonEmptyPatch({
  locale: assignmentLocalizationFields.locale.optional(), title: assignmentLocalizationFields.title.optional(), instructions: assignmentLocalizationFields.instructions.optional(),
  successCriteriaSummary: assignmentLocalizationFields.successCriteriaSummary.optional(), submitLabel: assignmentLocalizationFields.submitLabel.optional(),
}) });
export const deleteReportAssignmentLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentLocalizationId: reportEntityIdSchema });

export const createReportFieldSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentVersionId: reportEntityIdSchema, ...reportFieldDefinitionPayloadSchema.shape });
export const updateReportFieldSchema = z.strictObject({ actorId: reportActorIdSchema, reportFieldDefinitionId: reportEntityIdSchema, patch: nonEmptyPatch({
  stableKey: reportStableKeySchema.optional(), type: reportFieldDefinitionPayloadSchema.shape.type.optional(), required: z.boolean().optional(), sortOrder: sortOrder.optional(),
  validationRules: reportValidationRulesSchema.nullable().optional(), choiceCodes: choiceCodesSchema.nullable().optional(),
}) });
export const deleteReportFieldSchema = z.strictObject({ actorId: reportActorIdSchema, reportFieldDefinitionId: reportEntityIdSchema });

export const createReportFieldLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportFieldDefinitionId: reportEntityIdSchema, ...fieldLocalizationFields });
export const updateReportFieldLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportFieldLocalizationId: reportEntityIdSchema, patch: nonEmptyPatch({
  locale: fieldLocalizationFields.locale.optional(), label: fieldLocalizationFields.label.optional(), helpText: fieldLocalizationFields.helpText.optional(),
  placeholder: fieldLocalizationFields.placeholder.optional(), choiceLabels: fieldLocalizationFields.choiceLabels.optional(),
}) });
export const deleteReportFieldLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportFieldLocalizationId: reportEntityIdSchema });

export const createReportRubricSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentVersionId: reportEntityIdSchema, changeNotes: changeNotes.optional() });
export const updateReportRubricSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricVersionId: reportEntityIdSchema, patch: nonEmptyPatch({ changeNotes: changeNotes.optional() }) });
export const deleteReportRubricSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricVersionId: reportEntityIdSchema });

export const createReportCriterionSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricVersionId: reportEntityIdSchema, ...criterionFields });
export const updateReportCriterionSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricCriterionId: reportEntityIdSchema, patch: nonEmptyPatch({
  stableKey: criterionFields.stableKey.optional(), categoryCode: criterionFields.categoryCode.optional(), sortOrder: criterionFields.sortOrder.optional(), commentRequired: z.boolean().optional(),
}) });
export const deleteReportCriterionSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricCriterionId: reportEntityIdSchema });
export const createReportCriterionLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricCriterionId: reportEntityIdSchema, ...criterionLocalizationFields });
export const updateReportCriterionLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricCriterionLocalizationId: reportEntityIdSchema, patch: nonEmptyPatch({
  locale: criterionLocalizationFields.locale.optional(), title: criterionLocalizationFields.title.optional(), description: criterionLocalizationFields.description.optional(),
}) });
export const deleteReportCriterionLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricCriterionLocalizationId: reportEntityIdSchema });

export const createReportScaleOptionSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricVersionId: reportEntityIdSchema, ...scaleOptionFields });
export const updateReportScaleOptionSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricScaleOptionId: reportEntityIdSchema, patch: nonEmptyPatch({ stableKey: scaleOptionFields.stableKey.optional(), ordinal: scaleOptionFields.ordinal.optional() }) });
export const deleteReportScaleOptionSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricScaleOptionId: reportEntityIdSchema });
export const createReportScaleLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricScaleOptionId: reportEntityIdSchema, ...scaleLocalizationFields });
export const updateReportScaleLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricScaleOptionLocalizationId: reportEntityIdSchema, patch: nonEmptyPatch({ locale: scaleLocalizationFields.locale.optional(), label: scaleLocalizationFields.label.optional(), description: scaleLocalizationFields.description.optional() }) });
export const deleteReportScaleLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricScaleOptionLocalizationId: reportEntityIdSchema });

export const createReportReasonSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricVersionId: reportEntityIdSchema, ...reasonFields });
export const updateReportReasonSchema = z.strictObject({ actorId: reportActorIdSchema, reportRejectionReasonId: reportEntityIdSchema, patch: nonEmptyPatch({ stableKey: reasonFields.stableKey.optional(), sortOrder: reasonFields.sortOrder.optional(), active: z.boolean().optional() }) });
export const deleteReportReasonSchema = z.strictObject({ actorId: reportActorIdSchema, reportRejectionReasonId: reportEntityIdSchema });
export const createReportReasonLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRejectionReasonId: reportEntityIdSchema, ...reasonLocalizationFields });
export const updateReportReasonLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRejectionReasonLocalizationId: reportEntityIdSchema, patch: nonEmptyPatch({ locale: reasonLocalizationFields.locale.optional(), title: reasonLocalizationFields.title.optional(), guidance: reasonLocalizationFields.guidance.optional() }) });
export const deleteReportReasonLocalizationSchema = z.strictObject({ actorId: reportActorIdSchema, reportRejectionReasonLocalizationId: reportEntityIdSchema });

export const publishReportRubricSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricVersionId: reportEntityIdSchema, expectedPublishedReportRubricVersionId: reportEntityIdSchema.nullable().optional(), expectedBindingRevision: expectedBindingRevision.nullable().optional() });
export const archiveReportRubricSchema = z.strictObject({ actorId: reportActorIdSchema, reportRubricVersionId: reportEntityIdSchema });
export const publishReportAssignmentSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentVersionId: reportEntityIdSchema, reportRubricVersionId: reportEntityIdSchema, expectedPublishedReportAssignmentVersionId: reportEntityIdSchema.nullable().optional(), expectedBindingRevision: expectedBindingRevision.nullable().optional() });
export const archiveReportAssignmentSchema = z.strictObject({ actorId: reportActorIdSchema, reportAssignmentVersionId: reportEntityIdSchema });
export const setReportBindingSchema = z.strictObject({ actorId: reportActorIdSchema, levelDefinitionId: reportEntityIdSchema, reportAssignmentVersionId: reportEntityIdSchema, reportRubricVersionId: reportEntityIdSchema, expectedBindingRevision: expectedBindingRevision.nullable().optional() });
export const clearReportBindingSchema = z.strictObject({ actorId: reportActorIdSchema, levelDefinitionId: reportEntityIdSchema, expectedBindingRevision });

export const reportAssignmentLocalizationPayloadSchema = z.strictObject(assignmentLocalizationFields);
export const reportFieldLocalizationPayloadSchema = z.strictObject(fieldLocalizationFields);
export const reportCriterionPayloadSchema = z.strictObject(criterionFields);
export const reportCriterionLocalizationPayloadSchema = z.strictObject(criterionLocalizationFields);
export const reportScaleOptionPayloadSchema = z.strictObject(scaleOptionFields);
export const reportScaleLocalizationPayloadSchema = z.strictObject(scaleLocalizationFields);
export const reportReasonPayloadSchema = z.strictObject(reasonFields);
export const reportReasonLocalizationPayloadSchema = z.strictObject(reasonLocalizationFields);
