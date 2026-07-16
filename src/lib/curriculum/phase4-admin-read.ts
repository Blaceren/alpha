import type {
  AssessmentVersion,
  ContentAsset,
  ContentLocalization,
  ContentVersion,
  LevelResourceBinding,
  QuestionDefinition,
  QuestionLocalization,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Phase4HttpError } from "./phase4-http";

function missing(reference: string): never {
  throw new Phase4HttpError("NOT_FOUND", 404, [{ code: "NOT_FOUND", reference }]);
}

export async function assertAdminLevelScope(curriculumVersionId: number, levelDefinitionId: number) {
  const level = await prisma.levelDefinition.findFirst({
    where: { id: levelDefinitionId, curriculumVersionId },
    select: { id: true, curriculumVersionId: true, levelNumber: true, stableCode: true },
  });
  if (!level) missing("level");
  return level;
}

export function safeContentVersion(value: ContentVersion) {
  return {
    id: value.id,
    versionNumber: value.versionNumber,
    status: value.status,
    videoDurationSeconds: value.videoDurationSeconds,
    changeNotes: value.changeNotes,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    publishedAt: value.publishedAt,
    archivedAt: value.archivedAt,
  };
}

export function safeContentLocalization(value: ContentLocalization) {
  return {
    id: value.id, locale: value.locale, title: value.title, subtitle: value.subtitle,
    learningObjectiveExtension: value.learningObjectiveExtension, summary: value.summary,
    transcript: value.transcript, body: value.body, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

export function safeContentAsset(value: ContentAsset) {
  return {
    id: value.id, kind: value.kind, assetCode: value.assetCode, locale: value.locale,
    url: value.url, mimeType: value.mimeType, sizeBytes: value.sizeBytes,
    durationSeconds: value.durationSeconds, checksum: value.checksum, sortOrder: value.sortOrder,
    createdAt: value.createdAt,
  };
}

export function safeBinding(value: LevelResourceBinding | null) {
  return value ? {
    contentVersionId: value.contentVersionId,
    assessmentVersionId: value.assessmentVersionId,
    updatedAt: value.updatedAt,
  } : null;
}

export async function listAdminContentVersions(curriculumVersionId: number, levelDefinitionId: number) {
  await assertAdminLevelScope(curriculumVersionId, levelDefinitionId);
  const rows = await prisma.contentVersion.findMany({
    where: { curriculumVersionId, levelDefinitionId },
    orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
  });
  return rows.map(safeContentVersion);
}

export async function getAdminContentVersion(curriculumVersionId: number, levelDefinitionId: number, contentVersionId: number) {
  await assertAdminLevelScope(curriculumVersionId, levelDefinitionId);
  const row = await prisma.contentVersion.findFirst({
    where: { id: contentVersionId, curriculumVersionId, levelDefinitionId },
    include: {
      localizations: { orderBy: [{ locale: "asc" }, { id: "asc" }] },
      assets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      resourceBindings: true,
    },
  });
  if (!row) missing("contentVersion");
  return {
    ...safeContentVersion(row),
    localizations: row.localizations.map(safeContentLocalization),
    assets: row.assets.map(safeContentAsset),
    binding: safeBinding(row.resourceBindings[0] ?? null),
  };
}

export async function assertAdminContentVersionScope(curriculumVersionId: number, levelDefinitionId: number, contentVersionId: number) {
  await getAdminContentVersion(curriculumVersionId, levelDefinitionId, contentVersionId);
}

export async function assertAdminContentLocalizationScope(curriculumVersionId: number, levelDefinitionId: number, contentVersionId: number, localizationId: number) {
  await assertAdminContentVersionScope(curriculumVersionId, levelDefinitionId, contentVersionId);
  const row = await prisma.contentLocalization.findFirst({ where: { id: localizationId, contentVersionId }, select: { id: true } });
  if (!row) missing("localization");
}

export async function assertAdminContentAssetScope(curriculumVersionId: number, levelDefinitionId: number, contentVersionId: number, assetId: number) {
  await assertAdminContentVersionScope(curriculumVersionId, levelDefinitionId, contentVersionId);
  const row = await prisma.contentAsset.findFirst({ where: { id: assetId, contentVersionId }, select: { id: true } });
  if (!row) missing("asset");
}

export function safeAssessmentVersion(value: AssessmentVersion) {
  return {
    id: value.id, versionNumber: value.versionNumber, status: value.status,
    passPercent: value.passPercent, maxAttempts: value.maxAttempts,
    showExplanation: value.showExplanation, changeNotes: value.changeNotes,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    publishedAt: value.publishedAt, archivedAt: value.archivedAt,
  };
}

export function safeQuestion(value: QuestionDefinition) {
  return {
    id: value.id, questionNumber: value.questionNumber, stableKey: value.stableKey,
    type: value.type, skillTag: value.skillTag, status: value.status, options: value.options,
    correctAnswerConfigured: value.correctAnswer !== null && value.correctAnswer !== undefined,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

export function safeQuestionLocalization(value: QuestionLocalization) {
  return {
    id: value.id, locale: value.locale, prompt: value.prompt, optionLabels: value.optionLabels,
    explanation: value.explanation, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

export async function listAdminAssessmentVersions(curriculumVersionId: number, levelDefinitionId: number) {
  await assertAdminLevelScope(curriculumVersionId, levelDefinitionId);
  const rows = await prisma.assessmentVersion.findMany({
    where: { curriculumVersionId, levelDefinitionId },
    orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
  });
  return rows.map(safeAssessmentVersion);
}

export async function getAdminAssessmentVersion(curriculumVersionId: number, levelDefinitionId: number, assessmentVersionId: number) {
  await assertAdminLevelScope(curriculumVersionId, levelDefinitionId);
  const row = await prisma.assessmentVersion.findFirst({
    where: { id: assessmentVersionId, curriculumVersionId, levelDefinitionId },
    include: {
      questions: {
        orderBy: [{ questionNumber: "asc" }, { id: "asc" }],
        include: { localizations: { orderBy: [{ locale: "asc" }, { id: "asc" }] } },
      },
      resourceBindings: true,
    },
  });
  if (!row) missing("assessmentVersion");
  return {
    ...safeAssessmentVersion(row),
    questions: row.questions.map((question) => ({
      ...safeQuestion(question),
      localizations: question.localizations.map(safeQuestionLocalization),
    })),
    binding: safeBinding(row.resourceBindings[0] ?? null),
  };
}

export async function assertAdminAssessmentVersionScope(curriculumVersionId: number, levelDefinitionId: number, assessmentVersionId: number) {
  await getAdminAssessmentVersion(curriculumVersionId, levelDefinitionId, assessmentVersionId);
}

export async function assertAdminQuestionScope(curriculumVersionId: number, levelDefinitionId: number, assessmentVersionId: number, questionId: number) {
  await assertAdminAssessmentVersionScope(curriculumVersionId, levelDefinitionId, assessmentVersionId);
  const row = await prisma.questionDefinition.findFirst({ where: { id: questionId, assessmentVersionId }, select: { id: true } });
  if (!row) missing("question");
}

export async function assertAdminQuestionLocalizationScope(curriculumVersionId: number, levelDefinitionId: number, assessmentVersionId: number, questionId: number, localizationId: number) {
  await assertAdminQuestionScope(curriculumVersionId, levelDefinitionId, assessmentVersionId, questionId);
  const row = await prisma.questionLocalization.findFirst({ where: { id: localizationId, questionId }, select: { id: true } });
  if (!row) missing("localization");
}
