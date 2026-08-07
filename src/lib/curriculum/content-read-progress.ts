import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type UserLessonProgress } from "@prisma/client";
import { z } from "zod";
import {
  isCurriculumV2ContentEnabled,
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { STABLE_CODE_PATTERN } from "./constants";
import { contentBodySectionCodes } from "./content-body";
import {
  contentAssetPayloadSchema,
  contentLocalizationPayloadSchema,
  normalizedLocaleSchema,
} from "./content-schemas";
import { resolveUserCurriculumLevelStates } from "./level-state";
import { resolveUserCurriculumContext } from "./resolver";

const MAX_INT = 2_147_483_647;
const MAX_PROGRESS_DATA_BYTES = 8 * 1024;
const MAX_PLAYBACK_WITHOUT_DURATION = 86_400;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const SECTION_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const READABLE_LEVEL_TYPES = new Set(["lesson", "report", "mentor_review", "final_exam"]);
const REVIEWABLE_LEVEL_TYPES = new Set(["report", "mentor_review"]);

type TransactionClient = Prisma.TransactionClient;
type Selector = { levelNumber: number; stableCode?: never } | { stableCode: string; levelNumber?: never };

export type ContentReadSafeReason =
  | "content_not_configured"
  | "localization_unavailable"
  | "level_not_accessible"
  | "level_not_started"
  | "definition_inactive"
  | "unsupported_level_type"
  | "binding_corrupt"
  | "content_corrupt"
  | "lesson_progress_corrupt";

export type SafeLessonProgress = {
  status: "in_progress" | "completed";
  revision: number;
  playbackPositionSeconds: number;
  completedSections: string[];
  progressData: { activeSectionCode: string | null } | null;
  startedAt: string;
  lastProgressAt: string;
  completedAt: string | null;
};

export type SafeResolvedContent = {
  level: {
    levelNumber: number;
    stableCode: string;
    type: "lesson" | "report" | "mentor_review" | "final_exam";
    title: string;
    shortDescription: string;
    learningObjective: string;
  };
  content: {
    versionNumber: number;
    videoDurationSeconds: number | null;
    publishedAt: string;
    localization: {
      locale: string;
      title: string;
      subtitle: string;
      learningObjectiveExtension: string;
      summary: string;
      transcript: string | null;
      body: z.infer<typeof contentLocalizationPayloadSchema>["body"];
    };
    assets: Array<z.infer<typeof contentAssetPayloadSchema>>;
  };
  progress: SafeLessonProgress | null;
};

export type ResolveUserLevelContentInput = {
  actorUserId: number;
  locale: string;
  db?: TransactionClient;
} & Selector;

export type ResolveUserLevelContentResult =
  | { kind: "disabled" }
  | { kind: "user_not_found" }
  | { kind: "not_enrolled" }
  | { kind: "unavailable"; reason: ContentReadSafeReason }
  | { kind: "locked"; reason: "level_not_accessible" }
  | ({ kind: "available" } & SafeResolvedContent)
  | ({ kind: "completed" } & SafeResolvedContent)
  | { kind: "corrupt"; reason: ContentReadSafeReason };

export type LessonProgressErrorCode =
  | "CONTENT_READ_DISABLED"
  | "CONTENT_USER_NOT_FOUND"
  | "CONTENT_NOT_ENROLLED"
  | "CONTENT_LEVEL_NOT_FOUND"
  | "CONTENT_LEVEL_LOCKED"
  | "CONTENT_NOT_CONFIGURED"
  | "CONTENT_LOCALIZATION_UNAVAILABLE"
  | "CONTENT_STATE_CORRUPT"
  | "LESSON_PROGRESS_DISABLED"
  | "INPUT_INVALID"
  | "NOT_STARTED"
  | "CONFLICT"
  | "STALE"
  | "IMMUTABLE"
  | "VERSION_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

export class LessonProgressDomainError extends Error {
  readonly code: LessonProgressErrorCode;

  constructor(code: LessonProgressErrorCode, message: string) {
    super(message);
    this.name = "LessonProgressDomainError";
    this.code = code;
  }
}

export function isLessonProgressDomainError(
  error: unknown,
  code?: LessonProgressErrorCode,
): error is LessonProgressDomainError {
  return error instanceof LessonProgressDomainError && (!code || error.code === code);
}

const selectorSchema = z.union([
  z.strictObject({ levelNumber: z.number().int().positive().max(MAX_INT) }),
  z.strictObject({ stableCode: z.string().trim().regex(STABLE_CODE_PATTERN) }),
]);

const progressDataSchema = z
  .strictObject({ activeSectionCode: z.string().trim().max(64).regex(SECTION_CODE_PATTERN).nullable() })
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_PROGRESS_DATA_BYTES,
    "progressData is too large",
  );

const saveSchema = z
  .strictObject({
    actorUserId: z.number().int().positive().max(MAX_INT),
    levelNumber: z.number().int().positive().max(MAX_INT).optional(),
    stableCode: z.string().trim().regex(STABLE_CODE_PATTERN).optional(),
    requestId: z.string().trim().regex(REQUEST_ID_PATTERN),
    expectedRevision: z.number().int().nonnegative().max(MAX_INT - 1),
    playbackPositionSeconds: z.number().int().nonnegative().max(MAX_INT),
    completedSections: z.array(z.string().trim().max(64).regex(SECTION_CODE_PATTERN)).max(100),
    progressData: progressDataSchema.nullable().optional(),
  })
  .refine((value) => Number(value.levelNumber !== undefined) + Number(value.stableCode !== undefined) === 1, {
    message: "exactly one level selector is required",
  });

export type SaveOwnLessonProgressInput = z.input<typeof saveSchema>;
export type SaveOwnLessonProgressResult = {
  kind: "saved";
  created: boolean;
  retry: boolean;
  acceptedRevision: number;
  appliedAt: string;
  progress: SafeLessonProgress;
};

type ResolvedScope = {
  userStatus: "active" | "blocked";
  enrollmentId: number;
  enrollmentStatus: "active" | "completed";
  curriculumVersionId: number;
  level: {
    id: number;
    levelNumber: number;
    stableCode: string;
    type: string;
    title: string;
    shortDescription: string;
    learningObjective: string;
    status: string;
  };
  access: "available" | "in_progress" | "pending_review" | "completed";
};

type BoundContent = {
  scope: ResolvedScope;
  content: NonNullable<Awaited<ReturnType<typeof loadBoundContent>>>;
};

function allFlagsEnabled() {
  return (
    isCurriculumV2ReadEnabled() &&
    isCurriculumV2EnrollmentEnabled() &&
    isCurriculumV2ContentEnabled()
  );
}

function safeDate(value: Date) {
  return value.toISOString();
}

function parseSelector(input: { levelNumber?: number; stableCode?: string }): Selector | null {
  const parsed = selectorSchema.safeParse(
    input.levelNumber !== undefined
      ? { levelNumber: input.levelNumber, ...(input.stableCode !== undefined ? { stableCode: input.stableCode } : {}) }
      : { stableCode: input.stableCode },
  );
  return parsed.success ? (parsed.data as Selector) : null;
}

async function resolveScopeWithin(
  tx: TransactionClient,
  actorUserId: number,
  selector: Selector,
  evaluationTime: Date,
): Promise<ResolvedScope | ResolveUserLevelContentResult> {
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, status: true } });
  if (!user || user.status !== "active") return { kind: "user_not_found" };

  const context = await resolveUserCurriculumContext({ userId: actorUserId, asOf: evaluationTime, db: tx });
  if (context.kind === "disabled") return { kind: "disabled" };
  if (context.kind === "user_not_found") return { kind: "user_not_found" };
  if (context.kind === "candidate" || context.kind === "unavailable") return { kind: "not_enrolled" };
  if (context.kind === "corrupt") return { kind: "corrupt", reason: "content_corrupt" };
  if (context.kind !== "enrolled" && context.kind !== "completed") return { kind: "not_enrolled" };

  const level = context.levels.find((item) =>
    "levelNumber" in selector
      ? item.levelNumber === selector.levelNumber
      : item.stableCode === selector.stableCode,
  );
  if (!level) return { kind: "unavailable", reason: "level_not_accessible" };
  const moduleDefinition = context.modules.find((item) => item.id === level.moduleId);
  if (!moduleDefinition || level.status !== "active" || moduleDefinition.status !== "active") {
    return { kind: "unavailable", reason: "definition_inactive" };
  }
  if (!READABLE_LEVEL_TYPES.has(level.type)) {
    return { kind: "unavailable", reason: "unsupported_level_type" };
  }

  let access: ResolvedScope["access"] | null = null;
  if (context.kind === "completed") {
    const durable = context.progress.find((item) => item.levelDefinitionId === level.id);
    if (durable?.status === "completed") access = "completed";
  } else {
    const states = await resolveUserCurriculumLevelStates({ userId: actorUserId, asOf: evaluationTime, db: tx });
    if (states.kind === "corrupt") return { kind: "corrupt", reason: "content_corrupt" };
    if (states.kind !== "resolved") return { kind: "not_enrolled" };
    const state = states.levels.find((item) => item.levelDefinition.id === level.id);
    if (!state) return { kind: "corrupt", reason: "content_corrupt" };
    if (state.state === "available" || state.state === "in_progress" || state.state === "completed") {
      access = state.state;
    } else if (state.state === "pending_review" && REVIEWABLE_LEVEL_TYPES.has(level.type)) {
      access = "pending_review";
    } else if (state.state === "locked" || state.state === "xp_eligible") {
      return { kind: "locked", reason: "level_not_accessible" };
    }
  }
  if (!access) return { kind: "unavailable", reason: "level_not_accessible" };

  return {
    userStatus: user.status,
    enrollmentId: context.enrollment.id,
    enrollmentStatus: context.enrollment.status as "active" | "completed",
    curriculumVersionId: context.curriculumVersion.id,
    level: {
      id: level.id,
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      type: level.type,
      title: level.title,
      shortDescription: level.shortDescription,
      learningObjective: level.learningObjective,
      status: level.status,
    },
    access,
  };
}

async function loadBoundContent(tx: TransactionClient, scope: ResolvedScope) {
  return tx.levelResourceBinding.findUnique({
    where: { levelDefinitionId: scope.level.id },
    include: {
      contentVersion: {
        include: {
          localizations: true,
          assets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      },
    },
  });
}

function validateBoundContent(
  scope: ResolvedScope,
  binding: Awaited<ReturnType<typeof loadBoundContent>>,
): BoundContent | ResolveUserLevelContentResult {
  if (!binding || binding.contentVersionId === null || !binding.contentVersion) {
    return { kind: "unavailable", reason: "content_not_configured" };
  }
  const content = binding.contentVersion;
  if (
    binding.curriculumVersionId !== scope.curriculumVersionId ||
    binding.levelDefinitionId !== scope.level.id ||
    content.id !== binding.contentVersionId ||
    content.curriculumVersionId !== scope.curriculumVersionId ||
    content.levelDefinitionId !== scope.level.id
  ) {
    return { kind: "corrupt", reason: "binding_corrupt" };
  }
  if (content.status !== "published" || !content.publishedAt) {
    return { kind: "corrupt", reason: "content_corrupt" };
  }
  return { scope, content: binding } as BoundContent;
}

function parseProgressData(value: Prisma.JsonValue | null): SafeLessonProgress["progressData"] | undefined {
  if (value === null) return null;
  const parsed = progressDataSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mapLessonProgress(row: UserLessonProgress, sectionCodes: Set<string>): SafeLessonProgress | null {
  if (
    (row.status !== "in_progress" && row.status !== "completed") ||
    !Number.isSafeInteger(row.revision) || row.revision < 0 ||
    !Number.isSafeInteger(row.playbackPositionSeconds) || row.playbackPositionSeconds < 0 ||
    (row.status === "completed") !== Boolean(row.completedAt)
  ) return null;
  if (!Array.isArray(row.completedSections)) return null;
  const completedSections = row.completedSections;
  if (
    completedSections.some((item) => typeof item !== "string" || !sectionCodes.has(item)) ||
    new Set(completedSections).size !== completedSections.length
  ) return null;
  const progressData = parseProgressData(row.progressData);
  if (progressData === undefined) return null;
  if (progressData?.activeSectionCode && !sectionCodes.has(progressData.activeSectionCode)) return null;
  return {
    status: row.status,
    revision: row.revision,
    playbackPositionSeconds: row.playbackPositionSeconds,
    completedSections: [...completedSections] as string[],
    progressData,
    startedAt: safeDate(row.startedAt),
    lastProgressAt: safeDate(row.lastProgressAt),
    completedAt: row.completedAt ? safeDate(row.completedAt) : null,
  };
}

async function resolveContentWithin(
  tx: TransactionClient,
  input: Omit<ResolveUserLevelContentInput, "db">,
  evaluationTime: Date,
): Promise<ResolveUserLevelContentResult> {
  const selector = parseSelector(input);
  const locale = normalizedLocaleSchema.safeParse(input.locale);
  if (
    !selector ||
    !locale.success ||
    locale.data !== input.locale.trim() ||
    !Number.isSafeInteger(input.actorUserId) ||
    input.actorUserId < 1
  ) {
    return { kind: "unavailable", reason: "level_not_accessible" };
  }
  const scope = await resolveScopeWithin(tx, input.actorUserId, selector, evaluationTime);
  if ("kind" in scope) return scope;
  const checked = validateBoundContent(scope, await loadBoundContent(tx, scope));
  if ("kind" in checked) return checked;
  const content = checked.content.contentVersion!;
  const parsedLocalizations = content.localizations.map((localization) =>
    contentLocalizationPayloadSchema.safeParse({
      locale: localization.locale,
      title: localization.title,
      subtitle: localization.subtitle,
      learningObjectiveExtension: localization.learningObjectiveExtension,
      summary: localization.summary,
      transcript: localization.transcript,
      body: localization.body,
    }),
  );
  if (parsedLocalizations.some((item) => !item.success)) {
    return { kind: "corrupt", reason: "content_corrupt" };
  }
  const parsedLocalization = parsedLocalizations.find(
    (item) => item.success && item.data.locale === locale.data,
  );
  if (!parsedLocalization?.success) {
    return { kind: "unavailable", reason: "localization_unavailable" };
  }
  const parsedAssets = content.assets.map((asset) => contentAssetPayloadSchema.safeParse({
    kind: asset.kind,
    assetCode: asset.assetCode,
    locale: asset.locale,
    url: asset.url,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    durationSeconds: asset.durationSeconds,
    checksum: asset.checksum,
    sortOrder: asset.sortOrder,
  }));
  if (!parsedLocalization.success || parsedAssets.some((item) => !item.success)) {
    return { kind: "corrupt", reason: "content_corrupt" };
  }
  // PHASE-C. The anchor vocabulary comes from `contentBodySectionCodes`, never
  // from `body.sections` directly: v1 and v2 bodies both have sections, but only
  // the shared reader is guaranteed to stay correct when the format evolves. A
  // caller that reaches into the raw body works today and silently accepts any
  // section code the moment a new format lands.
  const sectionCodes = new Set(
    parsedLocalizations.flatMap((item) =>
      item.success ? contentBodySectionCodes(item.data.body) : [],
    ),
  );
  const progressRow = await tx.userLessonProgress.findUnique({
    where: { enrollmentId_contentVersionId: { enrollmentId: scope.enrollmentId, contentVersionId: content.id } },
  });
  let progress: SafeLessonProgress | null = null;
  if (progressRow) {
    if (
      progressRow.userId !== input.actorUserId ||
      progressRow.enrollmentId !== scope.enrollmentId ||
      progressRow.curriculumVersionId !== scope.curriculumVersionId ||
      progressRow.levelDefinitionId !== scope.level.id ||
      progressRow.contentVersionId !== content.id
    ) return { kind: "corrupt", reason: "lesson_progress_corrupt" };
    progress = mapLessonProgress(progressRow, sectionCodes);
    if (!progress) return { kind: "corrupt", reason: "lesson_progress_corrupt" };
  }
  const safe: SafeResolvedContent = {
    level: {
      levelNumber: scope.level.levelNumber,
      stableCode: scope.level.stableCode,
      type: scope.level.type as SafeResolvedContent["level"]["type"],
      title: scope.level.title,
      shortDescription: scope.level.shortDescription,
      learningObjective: scope.level.learningObjective,
    },
    content: {
      versionNumber: content.versionNumber,
      videoDurationSeconds: content.videoDurationSeconds,
      publishedAt: safeDate(content.publishedAt!),
      localization: parsedLocalization.data,
      assets: parsedAssets
        .map((item) => item.success ? item.data : neverValue())
        .filter((asset) => asset.locale === null || asset.locale === locale.data),
    },
    progress,
  };
  return scope.access === "completed" ? { kind: "completed", ...safe } : { kind: "available", ...safe };
}

function neverValue(): never {
  throw new Error("unreachable parsed content state");
}

export async function resolveUserLevelContent(
  input: ResolveUserLevelContentInput,
): Promise<ResolveUserLevelContentResult> {
  if (!allFlagsEnabled()) return { kind: "disabled" };
  const evaluationTime = new Date();
  const { db, ...data } = input;
  if (db) return resolveContentWithin(db, data, evaluationTime);
  return prisma.$transaction((tx) => resolveContentWithin(tx, data, evaluationTime));
}

type NormalizedSave = {
  playbackPositionSeconds: number;
  completedSections: string[];
  progressData: { activeSectionCode: string | null } | null;
};

function normalizeSave(
  data: z.output<typeof saveSchema>,
  sectionCodes: Set<string>,
  videoDurationSeconds: number | null,
): NormalizedSave {
  const completedSections = [...new Set(data.completedSections)].sort();
  if (completedSections.some((code) => !sectionCodes.has(code))) {
    throw new LessonProgressDomainError("INPUT_INVALID", "completedSections contains an unknown section");
  }
  const progressData = data.progressData ?? null;
  if (progressData?.activeSectionCode && !sectionCodes.has(progressData.activeSectionCode)) {
    throw new LessonProgressDomainError("INPUT_INVALID", "progressData contains an unknown section");
  }
  const maximum = videoDurationSeconds ?? MAX_PLAYBACK_WITHOUT_DURATION;
  return {
    playbackPositionSeconds: Math.min(data.playbackPositionSeconds, maximum),
    completedSections,
    progressData,
  };
}

function fingerprint(
  actorUserId: number,
  scope: ResolvedScope,
  contentVersionId: number,
  normalized: NormalizedSave,
) {
  const canonical = JSON.stringify({
    actorUserId,
    enrollmentId: scope.enrollmentId,
    curriculumVersionId: scope.curriculumVersionId,
    levelDefinitionId: scope.level.id,
    contentVersionId,
    payload: normalized,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function sameReceipt(
  receipt: {
    userId: number; enrollmentId: number; curriculumVersionId: number; levelDefinitionId: number;
    contentVersionId: number; payloadFingerprint: string; revision: number;
  },
  actorUserId: number,
  scope: ResolvedScope,
  contentVersionId: number,
  payloadFingerprint: string,
  expectedRevision: number,
) {
  return (
    receipt.userId === actorUserId && receipt.enrollmentId === scope.enrollmentId &&
    receipt.curriculumVersionId === scope.curriculumVersionId && receipt.levelDefinitionId === scope.level.id &&
    receipt.contentVersionId === contentVersionId && receipt.payloadFingerprint === payloadFingerprint &&
    receipt.revision === expectedRevision + 1
  );
}

function progressJson(value: NormalizedSave["progressData"]): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  return value === null ? Prisma.DbNull : value;
}

async function currentSafeProgress(
  tx: TransactionClient,
  progressId: number,
  sectionCodes: Set<string>,
) {
  const current = await tx.userLessonProgress.findUnique({ where: { id: progressId } });
  const mapped = current ? mapLessonProgress(current, sectionCodes) : null;
  if (!current || !mapped) throw new LessonProgressDomainError("CONTENT_STATE_CORRUPT", "lesson progress is corrupt");
  return { current, mapped };
}

async function saveWithin(
  tx: TransactionClient,
  data: z.output<typeof saveSchema>,
  evaluationTime: Date,
): Promise<SaveOwnLessonProgressResult> {
  const selector = parseSelector(data);
  if (!selector) throw new LessonProgressDomainError("INPUT_INVALID", "level selector is invalid");
  const scopeResult = await resolveScopeWithin(tx, data.actorUserId, selector, evaluationTime);
  if ("kind" in scopeResult) {
    if (scopeResult.kind === "user_not_found") throw new LessonProgressDomainError("CONTENT_USER_NOT_FOUND", "user does not exist");
    if (scopeResult.kind === "not_enrolled") throw new LessonProgressDomainError("CONTENT_NOT_ENROLLED", "active enrollment is required");
    if (scopeResult.kind === "locked") throw new LessonProgressDomainError("CONTENT_LEVEL_LOCKED", "level is locked");
    if (scopeResult.kind === "unavailable" && scopeResult.reason === "level_not_accessible") throw new LessonProgressDomainError("CONTENT_LEVEL_NOT_FOUND", "level is unavailable");
    throw new LessonProgressDomainError("CONTENT_STATE_CORRUPT", "content state is unavailable");
  }
  const scope = scopeResult;
  const checked = validateBoundContent(scope, await loadBoundContent(tx, scope));
  if ("kind" in checked) {
    if (checked.kind === "unavailable" && checked.reason === "content_not_configured") {
      throw new LessonProgressDomainError("CONTENT_NOT_CONFIGURED", "content is not configured");
    }
    throw new LessonProgressDomainError("CONTENT_STATE_CORRUPT", "content binding is corrupt");
  }
  const content = checked.content.contentVersion!;
  const allLocalizations = content.localizations.map((localization) => contentLocalizationPayloadSchema.safeParse({
    locale: localization.locale, title: localization.title, subtitle: localization.subtitle,
    learningObjectiveExtension: localization.learningObjectiveExtension, summary: localization.summary,
    transcript: localization.transcript, body: localization.body,
  }));
  if (allLocalizations.length === 0 || allLocalizations.some((item) => !item.success)) {
    throw new LessonProgressDomainError("CONTENT_STATE_CORRUPT", "content localization is corrupt");
  }
  const sectionCodes = new Set(allLocalizations.flatMap((item) => item.success ? contentBodySectionCodes(item.data.body) : []));
  const normalized = normalizeSave(data, sectionCodes, content.videoDurationSeconds);
  const payloadFingerprint = fingerprint(data.actorUserId, scope, content.id, normalized);

  const receipt = await tx.userLessonProgressSaveReceipt.findUnique({
    where: { userId_requestId: { userId: data.actorUserId, requestId: data.requestId } },
  });
  if (receipt) {
    if (!sameReceipt(receipt, data.actorUserId, scope, content.id, payloadFingerprint, data.expectedRevision)) {
      throw new LessonProgressDomainError("IDEMPOTENCY_CONFLICT", "requestId is already owned by different input");
    }
    const { mapped } = await currentSafeProgress(tx, receipt.lessonProgressId, sectionCodes);
    return {
      kind: "saved", created: false, retry: true, acceptedRevision: receipt.revision,
      appliedAt: safeDate(receipt.appliedAt), progress: mapped,
    };
  }

  if (scope.userStatus !== "active" || scope.enrollmentStatus !== "active") {
    throw new LessonProgressDomainError("IMMUTABLE", "completed enrollment is immutable");
  }
  if (scope.level.type !== "lesson") throw new LessonProgressDomainError("VERSION_MISMATCH", "autosave supports lesson levels only");
  if (scope.access === "completed") throw new LessonProgressDomainError("IMMUTABLE", "completed level is immutable");
  if (scope.access !== "in_progress") throw new LessonProgressDomainError("NOT_STARTED", "lesson level has not been started");

  const durable = await tx.userLevelProgress.findUnique({
    where: { enrollmentId_levelDefinitionId: { enrollmentId: scope.enrollmentId, levelDefinitionId: scope.level.id } },
  });
  if (!durable) throw new LessonProgressDomainError("NOT_STARTED", "lesson level has not been started");
  if (durable.status === "completed") throw new LessonProgressDomainError("IMMUTABLE", "completed level is immutable");
  if (durable.status !== "in_progress") throw new LessonProgressDomainError("NOT_STARTED", "lesson is not in progress");

  const existing = await tx.userLessonProgress.findUnique({
    where: { enrollmentId_contentVersionId: { enrollmentId: scope.enrollmentId, contentVersionId: content.id } },
  });
  if (!existing) {
    if (data.expectedRevision !== 0) throw new LessonProgressDomainError("STALE", "expected revision is stale");
    const created = await tx.userLessonProgress.create({
      data: {
        userId: data.actorUserId, enrollmentId: scope.enrollmentId, curriculumVersionId: scope.curriculumVersionId,
        levelDefinitionId: scope.level.id, contentVersionId: content.id, status: "in_progress",
        startedAt: evaluationTime, lastProgressAt: evaluationTime, completedAt: null,
        playbackPositionSeconds: normalized.playbackPositionSeconds,
        completedSections: normalized.completedSections,
        progressData: progressJson(normalized.progressData), lastRequestId: data.requestId, revision: 1,
      },
    });
    const newReceipt = await tx.userLessonProgressSaveReceipt.create({
      data: {
        lessonProgressId: created.id, userId: data.actorUserId, enrollmentId: scope.enrollmentId,
        curriculumVersionId: scope.curriculumVersionId, levelDefinitionId: scope.level.id,
        contentVersionId: content.id, requestId: data.requestId, revision: 1,
        payloadFingerprint, appliedAt: evaluationTime,
      },
    });
    const mapped = mapLessonProgress(created, sectionCodes);
    if (!mapped) throw new LessonProgressDomainError("CONTENT_STATE_CORRUPT", "created progress is corrupt");
    return { kind: "saved", created: true, retry: false, acceptedRevision: 1, appliedAt: safeDate(newReceipt.appliedAt), progress: mapped };
  }

  if (
    existing.userId !== data.actorUserId || existing.enrollmentId !== scope.enrollmentId ||
    existing.curriculumVersionId !== scope.curriculumVersionId || existing.levelDefinitionId !== scope.level.id ||
    existing.contentVersionId !== content.id
  ) throw new LessonProgressDomainError("VERSION_MISMATCH", "lesson progress belongs to another pinned scope");
  if (existing.status === "completed" || existing.completedAt) throw new LessonProgressDomainError("IMMUTABLE", "completed lesson progress is immutable");
  const existingSafe = mapLessonProgress(existing, sectionCodes);
  if (!existingSafe) throw new LessonProgressDomainError("CONTENT_STATE_CORRUPT", "lesson progress is corrupt");
  if (existing.revision !== data.expectedRevision) throw new LessonProgressDomainError("STALE", "expected revision is stale");
  if (existingSafe.completedSections.some((code) => !normalized.completedSections.includes(code))) {
    throw new LessonProgressDomainError("CONFLICT", "completed sections are monotonic");
  }
  if (
    existing.playbackPositionSeconds === normalized.playbackPositionSeconds &&
    JSON.stringify(existingSafe.completedSections) === JSON.stringify(normalized.completedSections) &&
    JSON.stringify(existingSafe.progressData) === JSON.stringify(normalized.progressData)
  ) throw new LessonProgressDomainError("CONFLICT", "autosave contains no changes");

  const nextRevision = existing.revision + 1;
  const updated = await tx.userLessonProgress.updateMany({
    where: { id: existing.id, revision: existing.revision },
    data: {
      playbackPositionSeconds: normalized.playbackPositionSeconds,
      completedSections: normalized.completedSections,
      progressData: progressJson(normalized.progressData),
      lastRequestId: data.requestId,
      lastProgressAt: evaluationTime,
      revision: nextRevision,
    },
  });
  if (updated.count !== 1) throw new LessonProgressDomainError("STALE", "compare-and-set lost the revision race");
  const newReceipt = await tx.userLessonProgressSaveReceipt.create({
    data: {
      lessonProgressId: existing.id, userId: data.actorUserId, enrollmentId: scope.enrollmentId,
      curriculumVersionId: scope.curriculumVersionId, levelDefinitionId: scope.level.id,
      contentVersionId: content.id, requestId: data.requestId, revision: nextRevision,
      payloadFingerprint, appliedAt: evaluationTime,
    },
  });
  const { mapped } = await currentSafeProgress(tx, existing.id, sectionCodes);
  return { kind: "saved", created: false, retry: false, acceptedRevision: nextRevision, appliedAt: safeDate(newReceipt.appliedAt), progress: mapped };
}

function isP2002(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export type LessonProgressCommandDb = Pick<PrismaClient, "$transaction">;

export async function saveOwnLessonProgress(
  input: unknown,
  db: LessonProgressCommandDb = prisma,
): Promise<SaveOwnLessonProgressResult> {
  if (!isCurriculumV2ReadEnabled()) {
    throw new LessonProgressDomainError("CONTENT_READ_DISABLED", "curriculum read is disabled");
  }
  if (!isCurriculumV2EnrollmentEnabled() || !isCurriculumV2ContentEnabled()) {
    throw new LessonProgressDomainError("LESSON_PROGRESS_DISABLED", "lesson progress is disabled");
  }
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) throw new LessonProgressDomainError("INPUT_INVALID", "lesson progress input is invalid");
  const run = () => db.$transaction((tx) => saveWithin(tx, parsed.data, new Date()));
  try {
    return await run();
  } catch (error) {
    if (isLessonProgressDomainError(error)) throw error;
    if (isP2002(error)) {
      try {
        return await run();
      } catch (recoveryError) {
        if (isLessonProgressDomainError(recoveryError)) throw recoveryError;
        throw new LessonProgressDomainError("INTERNAL_ERROR", "lesson progress recovery failed");
      }
    }
    throw new LessonProgressDomainError("INTERNAL_ERROR", "lesson progress operation failed");
  }
}
