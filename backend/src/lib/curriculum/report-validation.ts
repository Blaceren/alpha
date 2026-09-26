import type { z } from "zod";
import { ReportDomainError } from "@/lib/curriculum/report-errors";
import type { ReportValidationIssue } from "@/lib/curriculum/report-errors";
import {
  reportAssignmentLocalizationPayloadSchema,
  reportCriterionLocalizationPayloadSchema,
  reportCriterionPayloadSchema,
  reportFieldDefinitionPayloadSchema,
  reportFieldLocalizationPayloadSchema,
  reportReasonLocalizationPayloadSchema,
  reportReasonPayloadSchema,
  reportScaleLocalizationPayloadSchema,
  reportScaleOptionPayloadSchema,
} from "@/lib/curriculum/report-schemas";

const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_COMMAND_DEPTH = 12;
const MAX_COMMAND_NODES = 5_000;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PROFIT_ONLY_CATEGORIES = new Set(["profit", "pnl", "roi", "return"]);

function zodIssues(prefix: string, error: z.ZodError): ReportValidationIssue[] {
  return error.issues.map((issue) => ({
    code: "REPORT_FIELD_INVALID",
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join("."),
    message: issue.message,
  }));
}

function assertBoundedSafeInput(input: unknown) {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new ReportDomainError("REPORT_INPUT_INVALID", "report command must be serializable");
  }
  if (serialized === undefined) {
    throw new ReportDomainError("REPORT_INPUT_INVALID", "report command must be serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_COMMAND_BYTES) {
    throw new ReportDomainError("REPORT_INPUT_INVALID", "report command is too large");
  }
  let nodes = 0;
  const visit = (value: unknown, depth: number, path: string) => {
    nodes += 1;
    if (nodes > MAX_COMMAND_NODES || depth > MAX_COMMAND_DEPTH) {
      throw new ReportDomainError("REPORT_INPUT_INVALID", "report command structure is too complex");
    }
    if (value === null || typeof value !== "object") return;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new ReportDomainError("REPORT_INPUT_INVALID", "symbol keys are forbidden");
      }
      if (DANGEROUS_KEYS.has(key.toLowerCase())) {
        throw new ReportDomainError("REPORT_INPUT_INVALID", `dangerous key at ${path}.${key}`);
      }
      visit((value as Record<string, unknown>)[key], depth + 1, `${path}.${key}`);
    }
  };
  visit(input, 0, "input");
}

export function parseReportCommand<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  assertBoundedSafeInput(input);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ReportDomainError(
      "REPORT_INPUT_INVALID",
      "report command input is invalid",
      zodIssues("input", parsed.error),
    );
  }
  return parsed.data;
}

type Localized = { locale: string };
type AssignmentLocalization = Localized & {
  id: number; title: string; instructions: string; successCriteriaSummary: string; submitLabel: string;
};
type FieldLocalization = Localized & {
  id: number; label: string; helpText: string; placeholder: string; choiceLabels: unknown;
};
type FieldDefinition = {
  id: number; stableKey: string; type: string; required: boolean; sortOrder: number;
  validationRules: unknown; choiceCodes: unknown; localizations: FieldLocalization[];
};
type CriterionLocalization = Localized & { id: number; title: string; description: string };
type Criterion = {
  id: number; stableKey: string; categoryCode: string; sortOrder: number; commentRequired: boolean;
  localizations: CriterionLocalization[];
};
type ScaleLocalization = Localized & { id: number; label: string; description: string };
type ScaleOption = { id: number; stableKey: string; ordinal: number; localizations: ScaleLocalization[] };
type ReasonLocalization = Localized & { id: number; title: string; guidance: string };
type Reason = { id: number; stableKey: string; sortOrder: number; active: boolean; localizations: ReasonLocalization[] };

export type ReportRubricPublicationSnapshot = {
  id: number;
  reportAssignmentVersionId: number;
  criteria: Criterion[];
  scaleOptions: ScaleOption[];
  rejectionReasons: Reason[];
};

export type ReportAssignmentPublicationSnapshot = {
  id: number;
  levelDefinitionId: number;
  curriculumVersionId: number;
  levelDefinition: { type: string; completionMethod: string; status: string; curriculumVersion: { status: string } };
  localizations: AssignmentLocalization[];
  fields: FieldDefinition[];
  rubric: ReportRubricPublicationSnapshot & { status: string };
};

function issue(code: string, path: string, message: string): ReportValidationIssue {
  return { code, path, message };
}

function duplicateIssues<T>(
  values: T[],
  key: (value: T) => string | number,
  code: string,
  path: (value: T) => string,
  label: string,
) {
  const issues: ReportValidationIssue[] = [];
  const seen = new Set<string | number>();
  for (const value of values) {
    const item = key(value);
    if (seen.has(item)) issues.push(issue(code, path(value), `${label} must be unique`));
    seen.add(item);
  }
  return issues;
}

function localeSet(items: Localized[]) {
  return new Set(items.map((item) => item.locale));
}

function intersectLocales(current: Set<string> | null, items: Localized[]) {
  const next = localeSet(items);
  if (current === null) return next;
  return new Set([...current].filter((locale) => next.has(locale)));
}

function validateField(field: FieldDefinition): ReportValidationIssue[] {
  const issues: ReportValidationIssue[] = [];
  const prefix = `fields.${field.id}`;
  const parsed = reportFieldDefinitionPayloadSchema.safeParse({
    stableKey: field.stableKey,
    type: field.type,
    required: field.required,
    sortOrder: field.sortOrder,
    validationRules: field.validationRules,
    choiceCodes: field.choiceCodes,
  });
  if (!parsed.success) issues.push(...zodIssues(prefix, parsed.error));
  if (field.localizations.length === 0) {
    issues.push(issue("REPORT_FIELD_LOCALIZATION_REQUIRED", `${prefix}.localizations`, "field localization is required"));
  }
  const choiceCodes = Array.isArray(field.choiceCodes) ? field.choiceCodes.filter((item): item is string => typeof item === "string") : [];
  for (const localization of field.localizations) {
    const localizationPrefix = `${prefix}.localizations.${localization.id}`;
    const localizationParsed = reportFieldLocalizationPayloadSchema.safeParse({
      locale: localization.locale,
      label: localization.label,
      helpText: localization.helpText,
      placeholder: localization.placeholder,
      choiceLabels: localization.choiceLabels,
    });
    if (!localizationParsed.success) issues.push(...zodIssues(localizationPrefix, localizationParsed.error));
    if (field.type === "single_choice" || field.type === "multi_choice") {
      const labels = localization.choiceLabels;
      if (labels === null || typeof labels !== "object" || Array.isArray(labels)) {
        issues.push(issue("REPORT_CHOICE_LABELS_REQUIRED", `${localizationPrefix}.choiceLabels`, "choice labels are required"));
      } else {
        const labelKeys = Object.keys(labels as Record<string, unknown>).sort();
        if (JSON.stringify(labelKeys) !== JSON.stringify([...choiceCodes].sort())) {
          issues.push(issue("REPORT_CHOICE_LABELS_MISMATCH", `${localizationPrefix}.choiceLabels`, "choice labels must cover the exact stable choice codes"));
        }
      }
    } else if (localization.choiceLabels !== null) {
      issues.push(issue("REPORT_CHOICE_LABELS_FORBIDDEN", `${localizationPrefix}.choiceLabels`, "non-choice fields must not define choice labels"));
    }
  }
  issues.push(...duplicateIssues(field.localizations, (item) => item.locale, "REPORT_LOCALE_DUPLICATE", (item) => `${prefix}.localizations.${item.id}.locale`, "locale"));
  return issues;
}

export function validateReportRubricPublication(snapshot: ReportRubricPublicationSnapshot): ReportValidationIssue[] {
  const issues: ReportValidationIssue[] = [];
  if (snapshot.criteria.length === 0) issues.push(issue("REPORT_CRITERION_REQUIRED", "criteria", "at least one criterion is required"));
  if (snapshot.criteria.length > 50) issues.push(issue("REPORT_CRITERION_LIMIT", "criteria", "at most 50 criteria are allowed"));
  if (snapshot.scaleOptions.length === 0) issues.push(issue("REPORT_SCALE_REQUIRED", "scaleOptions", "at least one neutral scale option is required"));
  if (snapshot.scaleOptions.length > 20) issues.push(issue("REPORT_SCALE_LIMIT", "scaleOptions", "at most 20 scale options are allowed"));
  const activeReasons = snapshot.rejectionReasons.filter((reason) => reason.active);
  if (activeReasons.length === 0) issues.push(issue("REPORT_REASON_REQUIRED", "rejectionReasons", "at least one active rejection reason is required"));
  if (snapshot.rejectionReasons.length > 50) issues.push(issue("REPORT_REASON_LIMIT", "rejectionReasons", "at most 50 rejection reasons are allowed"));
  issues.push(...duplicateIssues(snapshot.criteria, (item) => item.stableKey, "REPORT_CRITERION_KEY_DUPLICATE", (item) => `criteria.${item.id}.stableKey`, "criterion stableKey"));
  issues.push(...duplicateIssues(snapshot.criteria, (item) => item.sortOrder, "REPORT_CRITERION_ORDER_DUPLICATE", (item) => `criteria.${item.id}.sortOrder`, "criterion sortOrder"));
  issues.push(...duplicateIssues(snapshot.scaleOptions, (item) => item.stableKey, "REPORT_SCALE_KEY_DUPLICATE", (item) => `scaleOptions.${item.id}.stableKey`, "scale stableKey"));
  issues.push(...duplicateIssues(snapshot.scaleOptions, (item) => item.ordinal, "REPORT_SCALE_ORDER_DUPLICATE", (item) => `scaleOptions.${item.id}.ordinal`, "scale ordinal"));
  issues.push(...duplicateIssues(snapshot.rejectionReasons, (item) => item.stableKey, "REPORT_REASON_KEY_DUPLICATE", (item) => `rejectionReasons.${item.id}.stableKey`, "reason stableKey"));
  issues.push(...duplicateIssues(snapshot.rejectionReasons, (item) => item.sortOrder, "REPORT_REASON_ORDER_DUPLICATE", (item) => `rejectionReasons.${item.id}.sortOrder`, "reason sortOrder"));

  let commonLocales: Set<string> | null = null;
  for (const criterion of snapshot.criteria) {
    const prefix = `criteria.${criterion.id}`;
    const parsed = reportCriterionPayloadSchema.safeParse({
      stableKey: criterion.stableKey,
      categoryCode: criterion.categoryCode,
      sortOrder: criterion.sortOrder,
      commentRequired: criterion.commentRequired,
    });
    if (!parsed.success) issues.push(...zodIssues(prefix, parsed.error));
    if (PROFIT_ONLY_CATEGORIES.has(criterion.categoryCode)) {
      issues.push(issue("REPORT_PROFIT_CRITERION_FORBIDDEN", `${prefix}.categoryCode`, "profit or return alone cannot be an approval criterion"));
    }
    if (criterion.localizations.length === 0) issues.push(issue("REPORT_CRITERION_LOCALIZATION_REQUIRED", `${prefix}.localizations`, "criterion localization is required"));
    for (const localization of criterion.localizations) {
      const parsedLocalization = reportCriterionLocalizationPayloadSchema.safeParse({
        locale: localization.locale,
        title: localization.title,
        description: localization.description,
      });
      if (!parsedLocalization.success) issues.push(...zodIssues(`${prefix}.localizations.${localization.id}`, parsedLocalization.error));
    }
    issues.push(...duplicateIssues(criterion.localizations, (item) => item.locale, "REPORT_LOCALE_DUPLICATE", (item) => `${prefix}.localizations.${item.id}.locale`, "locale"));
    commonLocales = intersectLocales(commonLocales, criterion.localizations);
  }
  for (const option of snapshot.scaleOptions) {
    const prefix = `scaleOptions.${option.id}`;
    const parsed = reportScaleOptionPayloadSchema.safeParse({
      stableKey: option.stableKey,
      ordinal: option.ordinal,
    });
    if (!parsed.success) issues.push(...zodIssues(prefix, parsed.error));
    if (option.localizations.length === 0) issues.push(issue("REPORT_SCALE_LOCALIZATION_REQUIRED", `${prefix}.localizations`, "scale localization is required"));
    for (const localization of option.localizations) {
      const parsedLocalization = reportScaleLocalizationPayloadSchema.safeParse({
        locale: localization.locale,
        label: localization.label,
        description: localization.description,
      });
      if (!parsedLocalization.success) issues.push(...zodIssues(`${prefix}.localizations.${localization.id}`, parsedLocalization.error));
    }
    issues.push(...duplicateIssues(option.localizations, (item) => item.locale, "REPORT_LOCALE_DUPLICATE", (item) => `${prefix}.localizations.${item.id}.locale`, "locale"));
    commonLocales = intersectLocales(commonLocales, option.localizations);
  }
  for (const reason of snapshot.rejectionReasons) {
    const prefix = `rejectionReasons.${reason.id}`;
    const parsed = reportReasonPayloadSchema.safeParse({
      stableKey: reason.stableKey,
      sortOrder: reason.sortOrder,
      active: reason.active,
    });
    if (!parsed.success) issues.push(...zodIssues(prefix, parsed.error));
    if (reason.active && reason.localizations.length === 0) issues.push(issue("REPORT_REASON_LOCALIZATION_REQUIRED", `${prefix}.localizations`, "active reason localization is required"));
    for (const localization of reason.localizations) {
      const parsedLocalization = reportReasonLocalizationPayloadSchema.safeParse({
        locale: localization.locale,
        title: localization.title,
        guidance: localization.guidance,
      });
      if (!parsedLocalization.success) issues.push(...zodIssues(`${prefix}.localizations.${localization.id}`, parsedLocalization.error));
    }
    issues.push(...duplicateIssues(reason.localizations, (item) => item.locale, "REPORT_LOCALE_DUPLICATE", (item) => `${prefix}.localizations.${item.id}.locale`, "locale"));
    if (reason.active) commonLocales = intersectLocales(commonLocales, reason.localizations);
  }
  if (commonLocales === null || commonLocales.size === 0) {
    issues.push(issue("REPORT_RUBRIC_COMMON_LOCALE_REQUIRED", "localizations", "criteria, scale, and active reasons require one common complete locale"));
  }
  return issues;
}

export function validateReportAssignmentPublication(snapshot: ReportAssignmentPublicationSnapshot): ReportValidationIssue[] {
  const issues: ReportValidationIssue[] = [];
  if (snapshot.levelDefinition.curriculumVersion.status !== "draft") {
    issues.push(issue("REPORT_PARENT_NOT_DRAFT", "curriculumVersion.status", "report definitions can be published only inside a draft curriculum"));
  }
  if (snapshot.levelDefinition.type !== "report" || snapshot.levelDefinition.completionMethod !== "report_approval") {
    issues.push(issue("REPORT_LEVEL_TYPE_INVALID", "levelDefinition.type", "report assignment requires a report/report_approval level"));
  }
  if (snapshot.levelDefinition.status !== "active") {
    issues.push(issue("REPORT_LEVEL_INACTIVE", "levelDefinition.status", "report level must be active"));
  }
  if (snapshot.localizations.length === 0) {
    issues.push(issue("REPORT_ASSIGNMENT_LOCALIZATION_REQUIRED", "localizations", "assignment localization is required"));
  }
  if (snapshot.fields.length === 0) issues.push(issue("REPORT_FIELD_REQUIRED", "fields", "at least one structured field is required"));
  if (snapshot.fields.length > 50) issues.push(issue("REPORT_FIELD_LIMIT", "fields", "at most 50 fields are allowed"));
  if (snapshot.rubric.reportAssignmentVersionId !== snapshot.id || snapshot.rubric.status !== "published") {
    issues.push(issue("REPORT_RUBRIC_MISMATCH", "rubric", "exact published rubric must belong to the assignment"));
  }

  let commonLocales: Set<string> | null = null;
  for (const localization of snapshot.localizations) {
    const parsed = reportAssignmentLocalizationPayloadSchema.safeParse({
      locale: localization.locale,
      title: localization.title,
      instructions: localization.instructions,
      successCriteriaSummary: localization.successCriteriaSummary,
      submitLabel: localization.submitLabel,
    });
    if (!parsed.success) issues.push(...zodIssues(`localizations.${localization.id}`, parsed.error));
  }
  issues.push(...duplicateIssues(snapshot.localizations, (item) => item.locale, "REPORT_LOCALE_DUPLICATE", (item) => `localizations.${item.id}.locale`, "locale"));
  commonLocales = intersectLocales(commonLocales, snapshot.localizations);
  issues.push(...duplicateIssues(snapshot.fields, (item) => item.stableKey, "REPORT_FIELD_KEY_DUPLICATE", (item) => `fields.${item.id}.stableKey`, "field stableKey"));
  issues.push(...duplicateIssues(snapshot.fields, (item) => item.sortOrder, "REPORT_FIELD_ORDER_DUPLICATE", (item) => `fields.${item.id}.sortOrder`, "field sortOrder"));
  for (const field of snapshot.fields) {
    issues.push(...validateField(field));
    commonLocales = intersectLocales(commonLocales, field.localizations);
  }
  if (commonLocales === null || commonLocales.size === 0) {
    issues.push(issue("REPORT_ASSIGNMENT_COMMON_LOCALE_REQUIRED", "localizations", "assignment and fields require one common complete locale"));
  } else {
    const rubricCompleteLocales = [...commonLocales].filter((locale) =>
      snapshot.rubric.criteria.every((criterion) => criterion.localizations.some((item) => item.locale === locale))
      && snapshot.rubric.scaleOptions.every((option) => option.localizations.some((item) => item.locale === locale))
      && snapshot.rubric.rejectionReasons.filter((reason) => reason.active)
        .every((reason) => reason.localizations.some((item) => item.locale === locale)),
    );
    if (rubricCompleteLocales.length === 0) {
      issues.push(issue("REPORT_GRAPH_COMMON_LOCALE_REQUIRED", "rubric.localizations", "assignment, fields, criteria, scale, and active reasons require one common complete locale"));
    }
  }
  return issues;
}
