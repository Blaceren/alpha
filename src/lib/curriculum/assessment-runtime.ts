import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type AssessmentAttempt,
  type PrismaClient,
  type QuestionType,
} from "@prisma/client";
import {
  isCurriculumV2AssessmentEnabled,
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
  isCurriculumV2XpEnabled,
} from "@/lib/env";
import { emitAssessmentCompletedEvent } from "@/lib/growth/product-events";
import { prisma } from "@/lib/prisma";
import {
  canonicalizeQuestion,
  localizationIsComplete,
  validateAssessmentPublication,
  type AssessmentPublicationSnapshot,
} from "./assessment-validation";
import {
  completeCurriculumLevelInTransaction,
  isCurriculumLevelCompletionError,
} from "./completion";
import {
  CURRICULUM_AUDIT_ACTIONS,
  DEFAULT_CURRICULUM_CODE,
  STABLE_CODE_PATTERN,
} from "./constants";
import { resolveUserCurriculumContext } from "./resolver";

const LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const MAX_TRANSACTION_ATTEMPTS = 3;

export type AssessmentRuntimeErrorCode =
  | "ASSESSMENT_RUNTIME_DISABLED"
  | "ASSESSMENT_USER_NOT_FOUND"
  | "ASSESSMENT_NOT_ENROLLED"
  | "ASSESSMENT_LEVEL_NOT_STARTED"
  | "ASSESSMENT_LEVEL_UNSUPPORTED"
  | "ASSESSMENT_NOT_CONFIGURED"
  | "ASSESSMENT_LOCALIZATION_UNAVAILABLE"
  | "ASSESSMENT_ATTEMPT_NOT_FOUND"
  | "ASSESSMENT_ATTEMPT_LIMIT_REACHED"
  | "ASSESSMENT_ATTEMPT_CONFLICT"
  | "ASSESSMENT_ATTEMPT_IMMUTABLE"
  | "ASSESSMENT_SUBMISSION_INVALID"
  | "ASSESSMENT_SUBMISSION_CONFLICT"
  | "ASSESSMENT_GRADING_UNSUPPORTED"
  | "ASSESSMENT_STATE_CORRUPT"
  | "ASSESSMENT_INTERNAL_ERROR";

export class AssessmentRuntimeError extends Error {
  readonly code: AssessmentRuntimeErrorCode;
  readonly retryableTransaction: boolean;

  constructor(
    code: AssessmentRuntimeErrorCode,
    message: string,
    retryableTransaction = false,
  ) {
    super(message);
    this.name = "AssessmentRuntimeError";
    this.code = code;
    this.retryableTransaction = retryableTransaction;
  }
}

export function isAssessmentRuntimeError(
  error: unknown,
): error is AssessmentRuntimeError {
  return error instanceof AssessmentRuntimeError;
}

type RuntimeDb = Pick<PrismaClient, "$transaction">;

export type AssessmentRuntimeOptions = {
  db?: RuntimeDb;
  evaluationTime?: Date;
};

export type StartAssessmentAttemptInput = {
  levelNumber?: number;
  stableCode?: string;
  locale: string;
};

export type SubmitAssessmentAttemptInput = {
  attemptId: number;
  requestId: string;
  answers: Array<{ questionKey: string; answer: unknown }>;
};

type SafeQuestion = {
  questionKey: string;
  questionNumber: number;
  type: QuestionType;
  skillTag: string | null;
  prompt: string;
  options: Array<{ code: string; label: string }>;
};

export type StartAssessmentAttemptResult = {
  kind: "ready";
  created: boolean;
  level: {
    levelNumber: number;
    stableCode: string;
    title: string;
    type: "lesson" | "final_exam";
  };
  attempt: {
    attemptId: number;
    attemptNumber: number;
    status: "in_progress";
    startedAt: Date;
  };
  assessment: {
    versionNumber: number;
    passPercent: number;
    maxAttempts: number | null;
    locale: string;
    questions: SafeQuestion[];
  };
};

export type SubmitAssessmentAttemptResult = {
  kind: "graded";
  created: boolean;
  attempt: {
    attemptId: number;
    attemptNumber: number;
    status: "passed" | "failed";
    submittedAt: Date;
    durationSeconds: number;
    totalQuestions: number;
    correctCount: number;
    scoreBasisPoints: number;
  };
  completion: null | {
    levelNumber: number;
    stableCode: string;
    xpAwarded: number;
    nextLevelNumber: number | null;
    terminal: boolean;
    completedAt: Date;
  };
};

function fail(
  code: AssessmentRuntimeErrorCode,
  message: string,
  retryableTransaction = false,
): never {
  throw new AssessmentRuntimeError(code, message, retryableTransaction);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function positiveId(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    fail("ASSESSMENT_SUBMISSION_INVALID", `${field} must be a positive integer`);
  }
  return Number(value);
}

function actorId(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    fail("ASSESSMENT_USER_NOT_FOUND", "active assessment actor was not found");
  }
  return Number(value);
}

function assertBaseFlags() {
  if (
    !isCurriculumV2ReadEnabled() ||
    !isCurriculumV2EnrollmentEnabled() ||
    !isCurriculumV2AssessmentEnabled()
  ) {
    fail("ASSESSMENT_RUNTIME_DISABLED", "assessment runtime is disabled");
  }
}

function assertXpFlag() {
  if (!isCurriculumV2XpEnabled()) {
    fail("ASSESSMENT_RUNTIME_DISABLED", "passing assessment completion is disabled");
  }
}

function evaluationTime(value?: Date) {
  const result = value ? new Date(value.getTime()) : new Date();
  if (Number.isNaN(result.getTime())) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "assessment evaluation time is invalid");
  }
  return result;
}

function parseStartInput(input: unknown) {
  if (!isRecord(input)) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "assessment start input is invalid");
  }
  const allowed = new Set(["levelNumber", "stableCode", "locale"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "assessment start input contains unsupported fields");
  }
  const hasNumber = input.levelNumber !== undefined;
  const hasCode = input.stableCode !== undefined;
  if (hasNumber === hasCode) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "exactly one level identity is required");
  }
  const levelNumber = hasNumber ? positiveId(input.levelNumber, "levelNumber") : undefined;
  const stableCode = hasCode && typeof input.stableCode === "string" ? input.stableCode.trim() : undefined;
  if (stableCode !== undefined && !STABLE_CODE_PATTERN.test(stableCode)) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "stableCode is invalid");
  }
  if (typeof input.locale !== "string") {
    fail("ASSESSMENT_SUBMISSION_INVALID", "locale is invalid");
  }
  const locale = input.locale.trim();
  if (locale !== input.locale || !LOCALE.test(locale)) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "locale must be normalized");
  }
  return { levelNumber, stableCode, locale };
}

function parseSubmitInput(input: unknown) {
  if (!isRecord(input) || !exactKeys(input, ["attemptId", "requestId", "answers"])) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "assessment submission input is invalid");
  }
  const attemptId = positiveId(input.attemptId, "attemptId");
  if (typeof input.requestId !== "string" || input.requestId !== input.requestId.trim() || !REQUEST_ID.test(input.requestId)) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "requestId is invalid");
  }
  if (!Array.isArray(input.answers) || input.answers.length === 0) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "answers must be a non-empty array");
  }
  const answers = input.answers.map((item) => {
    if (!isRecord(item) || !exactKeys(item, ["questionKey", "answer"]) || typeof item.questionKey !== "string") {
      fail("ASSESSMENT_SUBMISSION_INVALID", "answer entry is invalid");
    }
    const questionKey = item.questionKey.trim();
    if (questionKey !== item.questionKey || questionKey.length === 0) {
      fail("ASSESSMENT_SUBMISSION_INVALID", "questionKey is invalid");
    }
    return { questionKey, answer: item.answer };
  });
  return { attemptId, requestId: input.requestId, answers };
}

type PinnedContext = Extract<
  Awaited<ReturnType<typeof resolveUserCurriculumContext>>,
  { kind: "enrolled" | "completed" }
>;

async function loadContext(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  asOf: Date,
): Promise<PinnedContext> {
  const user = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, status: true },
  });
  if (!user || user.status !== "active") {
    fail("ASSESSMENT_USER_NOT_FOUND", "active assessment user was not found");
  }
  const context = await resolveUserCurriculumContext({
    userId: actorUserId,
    curriculumCode: DEFAULT_CURRICULUM_CODE,
    asOf,
    db: tx,
  });
  if (context.kind === "user_not_found") {
    fail("ASSESSMENT_USER_NOT_FOUND", "assessment user was not found");
  }
  if (context.kind === "candidate" || context.kind === "unavailable") {
    fail("ASSESSMENT_NOT_ENROLLED", "assessment user is not enrolled");
  }
  if (context.kind !== "enrolled" && context.kind !== "completed") {
    fail("ASSESSMENT_STATE_CORRUPT", "assessment enrollment state is corrupt");
  }
  return context;
}

function startLevel(context: PinnedContext, input: ReturnType<typeof parseStartInput>) {
  const level = context.levels.find((candidate) =>
    input.levelNumber !== undefined
      ? candidate.levelNumber === input.levelNumber
      : candidate.stableCode === input.stableCode,
  );
  if (!level) fail("ASSESSMENT_NOT_CONFIGURED", "assessment level is outside the pinned curriculum");
  const moduleDefinition = context.modules.find((candidate) => candidate.id === level.moduleId);
  if (!moduleDefinition || moduleDefinition.status !== "active" || level.status !== "active") {
    fail("ASSESSMENT_STATE_CORRUPT", "assessment level definition is inactive");
  }
  if (
    (level.type !== "lesson" && level.type !== "final_exam") ||
    level.completionMethod !== "assessment_pass"
  ) {
    fail("ASSESSMENT_LEVEL_UNSUPPORTED", "level is not owned by assessment runtime");
  }
  const progress = context.progress.find((candidate) => candidate.levelDefinitionId === level.id);
  if (
    context.kind !== "enrolled" ||
    context.enrollment.status !== "active" ||
    level.levelNumber !== context.enrollment.currentLevel ||
    !progress ||
    progress.status !== "in_progress" ||
    progress.completedAt !== null ||
    progress.completionEvidence !== null
  ) {
    fail("ASSESSMENT_LEVEL_NOT_STARTED", "assessment level is not actively started");
  }
  return { level, progress };
}

type AssessmentGraph = Prisma.AssessmentVersionGetPayload<{
  include: { questions: { include: { localizations: true } } };
}>;

function validateAssessmentGraph(
  context: PinnedContext,
  level: PinnedContext["levels"][number],
  assessment: AssessmentGraph,
  allowArchived: boolean,
) {
  if (
    assessment.levelDefinitionId !== level.id ||
    assessment.curriculumVersionId !== context.curriculumVersion.id ||
    (assessment.status !== "published" && (!allowArchived || assessment.status !== "archived")) ||
    !assessment.publishedAt
  ) {
    fail("ASSESSMENT_STATE_CORRUPT", "assessment ownership or publication state is corrupt");
  }
  const snapshot = {
    ...assessment,
    levelDefinition: {
      type: level.type,
      curriculumVersion: { status: context.curriculumVersion.status },
    },
  } as unknown as AssessmentPublicationSnapshot;
  const issues = validateAssessmentPublication(snapshot);
  if (issues.some((issue) => issue.code === "ASSESSMENT_GRADING_UNSUPPORTED" || issue.code === "ASSESSMENT_CHART_ASSET_UNRESOLVED")) {
    fail("ASSESSMENT_GRADING_UNSUPPORTED", "assessment uses an unsupported grading contract");
  }
  if (issues.length > 0) {
    fail("ASSESSMENT_STATE_CORRUPT", "published assessment no longer satisfies its contract");
  }
  return assessment;
}

async function loadAssessmentGraph(
  tx: Prisma.TransactionClient,
  context: PinnedContext,
  level: PinnedContext["levels"][number],
) {
  const binding = await tx.levelResourceBinding.findUnique({
    where: { levelDefinitionId: level.id },
    include: {
      assessmentVersion: {
        include: {
          questions: {
            include: { localizations: true },
            orderBy: [{ questionNumber: "asc" }, { id: "asc" }],
          },
        },
      },
    },
  });
  if (!binding || !binding.assessmentVersionId || !binding.assessmentVersion) {
    fail("ASSESSMENT_NOT_CONFIGURED", "published assessment is not pinned to this level");
  }
  const assessment = binding.assessmentVersion;
  if (
    binding.curriculumVersionId !== context.curriculumVersion.id ||
    assessment.id !== binding.assessmentVersionId ||
    assessment.levelDefinitionId !== level.id ||
    assessment.curriculumVersionId !== context.curriculumVersion.id ||
    assessment.status !== "published" ||
    !assessment.publishedAt
  ) {
    fail("ASSESSMENT_STATE_CORRUPT", "pinned assessment graph is corrupt");
  }
  validateAssessmentGraph(context, level, assessment, false);
  return binding;
}

async function loadHistoricalAssessmentGraph(
  tx: Prisma.TransactionClient,
  context: PinnedContext,
  level: PinnedContext["levels"][number],
  assessmentVersionId: number,
) {
  const assessment = await tx.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    include: {
      questions: {
        include: { localizations: true },
        orderBy: [{ questionNumber: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!assessment) {
    fail("ASSESSMENT_STATE_CORRUPT", "terminal attempt assessment snapshot is missing");
  }
  return validateAssessmentGraph(context, level, assessment, true);
}

type RuntimeQuestion = {
  id: number;
  stableKey: string;
  questionNumber: number;
  type: QuestionType;
  skillTag: string | null;
  correctAnswer: { code: string } | { codes: string[] } | { value: string };
  optionCodes: string[];
  safe: SafeQuestion;
};

function runtimeQuestions(assessment: AssessmentGraph, locale: string): RuntimeQuestion[] {
  const questions: RuntimeQuestion[] = [];
  for (const question of assessment.questions) {
    if (question.status !== "active") {
      fail("ASSESSMENT_STATE_CORRUPT", "published assessment contains an inactive question");
    }
    const localization = question.localizations.find((candidate) => candidate.locale === locale);
    if (!localization) {
      fail("ASSESSMENT_LOCALIZATION_UNAVAILABLE", "assessment localization is unavailable");
    }
    if (!localizationIsComplete(question, localization)) {
      fail("ASSESSMENT_STATE_CORRUPT", "assessment localization is corrupt");
    }
    const canonical = canonicalizeQuestion(
      question.type,
      question.options,
      question.correctAnswer,
      `question:${question.id}`,
    );
    if (question.type === "numeric" || question.type === "chart_choice") {
      fail("ASSESSMENT_GRADING_UNSUPPORTED", "assessment question grading is unsupported");
    }
    const optionLabels = localization.optionLabels as Record<string, unknown> | null;
    const options = (canonical.options ?? []).map(({ code }) => {
      const label = optionLabels?.[code];
      if (typeof label !== "string") {
        fail("ASSESSMENT_STATE_CORRUPT", "assessment option localization is corrupt");
      }
      return { code, label };
    });
    questions.push({
      id: question.id,
      stableKey: question.stableKey,
      questionNumber: question.questionNumber,
      type: question.type,
      skillTag: question.skillTag,
      correctAnswer: canonical.correctAnswer,
      optionCodes: (canonical.options ?? []).map(({ code }) => code),
      safe: {
        questionKey: question.stableKey,
        questionNumber: question.questionNumber,
        type: question.type,
        skillTag: question.skillTag,
        prompt: localization.prompt,
        options,
      },
    });
  }
  return questions;
}

function assessmentCommonLocale(assessment: AssessmentGraph) {
  const locales = assessment.questions[0]?.localizations
    .map((localization) => localization.locale)
    .filter((locale) =>
      assessment.questions.every((question) =>
        question.localizations.some((localization) => localization.locale === locale),
      ),
    )
    .sort();
  if (!locales?.[0]) {
    fail("ASSESSMENT_STATE_CORRUPT", "assessment has no common grading locale");
  }
  return locales[0];
}

function assertAttemptOwnership(
  attempt: AssessmentAttempt,
  context: PinnedContext,
  level: PinnedContext["levels"][number],
  assessment: AssessmentGraph,
) {
  if (
    attempt.userId !== context.userId ||
    attempt.enrollmentId !== context.enrollment.id ||
    attempt.curriculumVersionId !== context.curriculumVersion.id ||
    attempt.levelDefinitionId !== level.id ||
    attempt.assessmentVersionId !== assessment.id
  ) {
    fail("ASSESSMENT_STATE_CORRUPT", "assessment attempt ownership is corrupt");
  }
}

function assertInProgressShape(attempt: AssessmentAttempt) {
  if (
    attempt.status !== "in_progress" ||
    attempt.submittedAt !== null ||
    attempt.durationSeconds !== null ||
    attempt.totalQuestions !== null ||
    attempt.correctCount !== null ||
    attempt.scoreBasisPoints !== null ||
    attempt.submittedAnswers !== null ||
    attempt.answersFingerprint !== null ||
    attempt.submitRequestId !== null ||
    !REQUEST_ID.test(attempt.startRequestId)
  ) {
    fail("ASSESSMENT_STATE_CORRUPT", "active assessment attempt is corrupt");
  }
}

function terminalValues(attempt: AssessmentAttempt) {
  if (
    (attempt.status !== "passed" && attempt.status !== "failed") ||
    !attempt.submittedAt ||
    attempt.durationSeconds === null || attempt.durationSeconds < 0 ||
    attempt.totalQuestions === null || attempt.totalQuestions <= 0 ||
    attempt.correctCount === null || attempt.correctCount < 0 || attempt.correctCount > attempt.totalQuestions ||
    attempt.scoreBasisPoints === null || attempt.scoreBasisPoints < 0 || attempt.scoreBasisPoints > 10_000 ||
    attempt.submittedAnswers === null ||
    !attempt.answersFingerprint || !FINGERPRINT.test(attempt.answersFingerprint) ||
    !attempt.submitRequestId || !REQUEST_ID.test(attempt.submitRequestId)
  ) {
    fail("ASSESSMENT_STATE_CORRUPT", "terminal assessment attempt is corrupt");
  }
  const expectedDuration = Math.floor(
    (attempt.submittedAt.getTime() - attempt.startedAt.getTime()) / 1_000,
  );
  if (expectedDuration < 0 || attempt.durationSeconds !== expectedDuration) {
    fail("ASSESSMENT_STATE_CORRUPT", "terminal assessment duration is inconsistent");
  }
  return {
    submittedAt: attempt.submittedAt,
    durationSeconds: attempt.durationSeconds,
    totalQuestions: attempt.totalQuestions,
    correctCount: attempt.correctCount,
    scoreBasisPoints: attempt.scoreBasisPoints,
    submittedAnswers: attempt.submittedAnswers,
    answersFingerprint: attempt.answersFingerprint,
    submitRequestId: attempt.submitRequestId,
  };
}

function validateAttemptHistory(attempts: AssessmentAttempt[]) {
  let expected = 1;
  let active = 0;
  for (const attempt of attempts) {
    if (attempt.attemptNumber !== expected) {
      fail("ASSESSMENT_STATE_CORRUPT", "assessment attempt sequence is corrupt");
    }
    expected += 1;
    if (attempt.status === "in_progress") {
      active += 1;
      assertInProgressShape(attempt);
    } else {
      terminalValues(attempt);
    }
  }
  if (active > 1) {
    fail("ASSESSMENT_STATE_CORRUPT", "multiple active assessment attempts exist");
  }
}

function startResult(
  created: boolean,
  level: PinnedContext["levels"][number],
  attempt: AssessmentAttempt,
  assessment: AssessmentGraph,
  locale: string,
  questions: RuntimeQuestion[],
): StartAssessmentAttemptResult {
  return {
    kind: "ready",
    created,
    level: {
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      title: level.title,
      type: level.type as "lesson" | "final_exam",
    },
    attempt: {
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: "in_progress",
      startedAt: new Date(attempt.startedAt.getTime()),
    },
    assessment: {
      versionNumber: assessment.versionNumber,
      passPercent: assessment.passPercent,
      maxAttempts: assessment.maxAttempts,
      locale,
      questions: questions.map(({ safe }) => safe),
    },
  };
}

async function runStart(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  input: ReturnType<typeof parseStartInput>,
  now: Date,
) {
  const context = await loadContext(tx, actorUserId, now);
  const { level } = startLevel(context, input);
  const binding = await loadAssessmentGraph(tx, context, level);
  const assessment = binding.assessmentVersion!;
  const questions = runtimeQuestions(assessment, input.locale);

  const [attempts, otherActive] = await Promise.all([
    tx.assessmentAttempt.findMany({
      where: {
        enrollmentId: context.enrollment.id,
        assessmentVersionId: assessment.id,
      },
      orderBy: [{ attemptNumber: "asc" }, { id: "asc" }],
    }),
    tx.assessmentAttempt.findFirst({
      where: {
        enrollmentId: context.enrollment.id,
        levelDefinitionId: level.id,
        status: "in_progress",
        assessmentVersionId: { not: assessment.id },
      },
    }),
  ]);
  if (otherActive) {
    fail("ASSESSMENT_STATE_CORRUPT", "an active attempt targets a different pinned assessment");
  }
  attempts.forEach((attempt) => assertAttemptOwnership(attempt, context, level, assessment));
  validateAttemptHistory(attempts);
  const terminalCount = attempts.filter((attempt) => attempt.status !== "in_progress").length;
  const active = attempts.find((attempt) => attempt.status === "in_progress");
  if (active) {
    return startResult(false, level, active, assessment, input.locale, questions);
  }
  if (assessment.maxAttempts !== null && terminalCount >= assessment.maxAttempts) {
    fail("ASSESSMENT_ATTEMPT_LIMIT_REACHED", "assessment attempt limit was reached");
  }

  const attempt = await tx.assessmentAttempt.create({
    data: {
      userId: context.userId,
      enrollmentId: context.enrollment.id,
      curriculumVersionId: context.curriculumVersion.id,
      levelDefinitionId: level.id,
      assessmentVersionId: assessment.id,
      attemptNumber: terminalCount + 1,
      status: "in_progress",
      startedAt: now,
      startRequestId: `assessment-start:${randomUUID()}`,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: context.userId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentAttemptStarted,
      entityType: "AssessmentAttempt",
      entityId: String(attempt.id),
      metadata: {
        actorUserId: context.userId,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        levelNumber: level.levelNumber,
        stableCode: level.stableCode,
        assessmentVersionNumber: assessment.versionNumber,
      },
    },
  });
  return startResult(true, level, attempt, assessment, input.locale, questions);
}

function normalizeCode(answer: unknown, options: Set<string>) {
  if (!isRecord(answer) || !exactKeys(answer, ["code"]) || typeof answer.code !== "string") {
    fail("ASSESSMENT_SUBMISSION_INVALID", "single answer shape is invalid");
  }
  const code = answer.code.trim();
  if (code !== answer.code || !options.has(code)) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "answer option is invalid");
  }
  return { code };
}

function normalizeCodes(answer: unknown, options: Set<string>, permutation: boolean) {
  if (!isRecord(answer) || !exactKeys(answer, ["codes"]) || !Array.isArray(answer.codes) || answer.codes.length === 0) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "multiple answer shape is invalid");
  }
  const codes = answer.codes.map((code) => {
    if (typeof code !== "string" || code !== code.trim() || !options.has(code)) {
      fail("ASSESSMENT_SUBMISSION_INVALID", "answer option is invalid");
    }
    return code;
  });
  if (new Set(codes).size !== codes.length || (permutation && codes.length !== options.size)) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "answer options are duplicated or incomplete");
  }
  return { codes: permutation ? codes : [...codes].sort() };
}

type NormalizedAnswer = { code: string } | { codes: string[] };

function normalizeAnswers(
  supplied: ReturnType<typeof parseSubmitInput>["answers"],
  questions: RuntimeQuestion[],
) {
  if (supplied.length !== questions.length) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "submission must answer every assessment question exactly once");
  }
  const byKey = new Map<string, unknown>();
  for (const item of supplied) {
    if (byKey.has(item.questionKey)) {
      fail("ASSESSMENT_SUBMISSION_INVALID", "submission contains a duplicate question");
    }
    byKey.set(item.questionKey, item.answer);
  }
  const normalized: Record<string, NormalizedAnswer> = {};
  for (const question of questions) {
    if (!byKey.has(question.stableKey)) {
      fail("ASSESSMENT_SUBMISSION_INVALID", "submission is missing a question");
    }
    const answer = byKey.get(question.stableKey);
    const options = new Set(question.optionCodes);
    switch (question.type) {
      case "single_choice":
      case "true_false":
      case "scenario_choice":
        normalized[question.stableKey] = normalizeCode(answer, options);
        break;
      case "multiple_choice":
        normalized[question.stableKey] = normalizeCodes(answer, options, false);
        break;
      case "ordered_steps":
        normalized[question.stableKey] = normalizeCodes(answer, options, true);
        break;
      case "numeric":
      case "chart_choice":
        fail("ASSESSMENT_GRADING_UNSUPPORTED", "assessment question grading is unsupported");
    }
    byKey.delete(question.stableKey);
  }
  if (byKey.size !== 0) {
    fail("ASSESSMENT_SUBMISSION_INVALID", "submission contains an unknown question");
  }
  return normalized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function answersFingerprint(
  actorUserId: number,
  attempt: AssessmentAttempt,
  normalized: Record<string, NormalizedAnswer>,
) {
  const payload = {
    actorUserId,
    attemptId: attempt.id,
    enrollmentId: attempt.enrollmentId,
    curriculumVersionId: attempt.curriculumVersionId,
    levelDefinitionId: attempt.levelDefinitionId,
    assessmentVersionId: attempt.assessmentVersionId,
    answers: normalized,
  };
  return `sha256:${createHash("sha256").update(stableJson(payload), "utf8").digest("hex")}`;
}

function grade(
  questions: RuntimeQuestion[],
  normalized: Record<string, NormalizedAnswer>,
  passPercent: number,
) {
  let correctCount = 0;
  for (const question of questions) {
    if (stableJson(normalized[question.stableKey]) === stableJson(question.correctAnswer)) {
      correctCount += 1;
    }
  }
  const totalQuestions = questions.length;
  const scoreBasisPoints = Math.floor((correctCount * 10_000) / totalQuestions);
  const passed = correctCount * 100 >= passPercent * totalQuestions;
  return { correctCount, totalQuestions, scoreBasisPoints, passed };
}

function safeCompletion(
  result: Awaited<ReturnType<typeof completeCurriculumLevelInTransaction>>,
): NonNullable<SubmitAssessmentAttemptResult["completion"]> {
  return {
    levelNumber: result.levelNumber,
    stableCode: result.stableCode,
    xpAwarded: result.xpAwarded,
    nextLevelNumber: result.nextLevelNumber,
    terminal: result.terminal,
    completedAt: new Date(result.completedAt.getTime()),
  };
}

function submitResult(
  created: boolean,
  attempt: AssessmentAttempt,
  completion: SubmitAssessmentAttemptResult["completion"],
): SubmitAssessmentAttemptResult {
  const terminal = terminalValues(attempt);
  return {
    kind: "graded",
    created,
    attempt: {
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status as "passed" | "failed",
      submittedAt: new Date(terminal.submittedAt.getTime()),
      durationSeconds: terminal.durationSeconds,
      totalQuestions: terminal.totalQuestions,
      correctCount: terminal.correctCount,
      scoreBasisPoints: terminal.scoreBasisPoints,
    },
    completion,
  };
}

function assertTerminalMatches(
  attempt: AssessmentAttempt,
  input: ReturnType<typeof parseSubmitInput>,
  normalized: Record<string, NormalizedAnswer>,
  fingerprint: string,
  graded: ReturnType<typeof grade>,
  passPercent: number,
) {
  const terminal = terminalValues(attempt);
  const expectedStatus = graded.passed ? "passed" : "failed";
  const storedPassed = terminal.correctCount * 100 >= passPercent * terminal.totalQuestions;
  if (
    terminal.submitRequestId !== input.requestId ||
    terminal.answersFingerprint !== fingerprint ||
    stableJson(terminal.submittedAnswers) !== stableJson(normalized)
  ) {
    fail("ASSESSMENT_SUBMISSION_CONFLICT", "assessment submission identity or payload conflicts with the terminal attempt");
  }
  if (
    terminal.totalQuestions !== graded.totalQuestions ||
    terminal.correctCount !== graded.correctCount ||
    terminal.scoreBasisPoints !== graded.scoreBasisPoints ||
    attempt.status !== expectedStatus ||
    storedPassed !== (attempt.status === "passed")
  ) {
    fail("ASSESSMENT_STATE_CORRUPT", "terminal assessment result contradicts its immutable snapshot");
  }
}

async function terminalRetry(
  tx: Prisma.TransactionClient,
  attempt: AssessmentAttempt,
  actorUserId: number,
  input: ReturnType<typeof parseSubmitInput>,
  normalized: Record<string, NormalizedAnswer>,
  fingerprint: string,
  graded: ReturnType<typeof grade>,
  assessment: AssessmentGraph,
  levelXpReward: number,
) {
  assertTerminalMatches(attempt, input, normalized, fingerprint, graded, assessment.passPercent);
  if (attempt.status === "failed") {
    const xp = await tx.xPTransaction.findFirst({
      where: {
        enrollmentId: attempt.enrollmentId,
        levelDefinitionId: attempt.levelDefinitionId,
        sourceType: "assessment_pass",
        sourceId: `assessment-attempt:${attempt.id}`,
      },
    });
    if (xp) fail("ASSESSMENT_STATE_CORRUPT", "failed assessment attempt owns XP");
    return submitResult(false, attempt, null);
  }
  // Reward-conditional XP flag, mirroring runSubmit: a zero-reward level's passing
  // retry re-asserts completion without requiring the XP flag.
  if (levelXpReward > 0) assertXpFlag();
  const completion = await completeCurriculumLevelInTransaction(tx, {
    enrollmentId: attempt.enrollmentId,
    levelDefinitionId: attempt.levelDefinitionId,
    sourceType: "assessment_pass",
    sourceId: `assessment-attempt:${attempt.id}`,
    actorId: actorUserId,
    evaluationTime: terminalValues(attempt).submittedAt,
  });
  return submitResult(false, attempt, safeCompletion(completion));
}

async function runSubmit(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  input: ReturnType<typeof parseSubmitInput>,
  now: Date,
) {
  const attempt = await tx.assessmentAttempt.findUnique({ where: { id: input.attemptId } });
  if (!attempt || attempt.userId !== actorUserId) {
    fail("ASSESSMENT_ATTEMPT_NOT_FOUND", "assessment attempt was not found");
  }
  const context = await loadContext(tx, actorUserId, now);
  if (attempt.enrollmentId !== context.enrollment.id || attempt.curriculumVersionId !== context.curriculumVersion.id) {
    fail("ASSESSMENT_ATTEMPT_NOT_FOUND", "assessment attempt was not found in the pinned enrollment");
  }
  const level = context.levels.find((candidate) => candidate.id === attempt.levelDefinitionId);
  if (!level) fail("ASSESSMENT_STATE_CORRUPT", "assessment attempt level is outside the pinned curriculum");
  if ((level.type !== "lesson" && level.type !== "final_exam") || level.completionMethod !== "assessment_pass") {
    fail("ASSESSMENT_LEVEL_UNSUPPORTED", "assessment attempt level is unsupported");
  }
  const assessment = attempt.status === "in_progress"
    ? (await loadAssessmentGraph(tx, context, level)).assessmentVersion!
    : await loadHistoricalAssessmentGraph(tx, context, level, attempt.assessmentVersionId);
  assertAttemptOwnership(attempt, context, level, assessment);
  const questions = runtimeQuestions(assessment, assessmentCommonLocale(assessment));
  const normalized = normalizeAnswers(input.answers, questions);
  const fingerprint = answersFingerprint(actorUserId, attempt, normalized);
  const graded = grade(questions, normalized, assessment.passPercent);

  if (attempt.status !== "in_progress") {
    return terminalRetry(tx, attempt, actorUserId, input, normalized, fingerprint, graded, assessment, level.xpReward);
  }
  assertInProgressShape(attempt);
  const progress = context.progress.find((candidate) => candidate.levelDefinitionId === level.id);
  if (
    context.kind !== "enrolled" ||
    context.enrollment.status !== "active" ||
    level.levelNumber !== context.enrollment.currentLevel ||
    !progress || progress.status !== "in_progress" || progress.completedAt !== null
  ) {
    fail("ASSESSMENT_ATTEMPT_IMMUTABLE", "active assessment attempt cannot be submitted in the current level state");
  }
  // XP flag is required only when the level awards a positive reward (operator
  // platform rule). A zero-reward level completes without XP and without the flag.
  if (graded.passed && level.xpReward > 0) assertXpFlag();
  const durationSeconds = Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1_000);
  if (durationSeconds < 0) fail("ASSESSMENT_STATE_CORRUPT", "assessment attempt starts in the future");
  const status = graded.passed ? "passed" : "failed";
  const claim = await tx.assessmentAttempt.updateMany({
    where: {
      id: attempt.id,
      status: "in_progress",
      submittedAt: null,
      submitRequestId: null,
    },
    data: {
      status,
      submittedAt: now,
      durationSeconds,
      totalQuestions: graded.totalQuestions,
      correctCount: graded.correctCount,
      scoreBasisPoints: graded.scoreBasisPoints,
      submittedAnswers: normalized as Prisma.InputJsonValue,
      answersFingerprint: fingerprint,
      submitRequestId: input.requestId,
    },
  });
  if (claim.count !== 1) {
    fail("ASSESSMENT_ATTEMPT_CONFLICT", "assessment submission claim was lost", true);
  }

  // G4-GROWTH — a submitted attempt, PASSED OR FAILED.
  //
  // Both outcomes produce an event. Recording only passes would make the
  // assessment pass rate uncomputable, because its denominator — learners who
  // actually sat the assessment — would exist nowhere.
  await emitAssessmentCompletedEvent(tx, {
    attemptId: attempt.id,
    userId: attempt.userId,
    enrollmentId: attempt.enrollmentId,
    levelDefinitionId: level.id,
    levelNumber: level.levelNumber,
    attemptNumber: attempt.attemptNumber,
    passed: graded.passed,
    occurredAt: now,
  });
  await tx.auditLog.create({
    data: {
      userId: actorUserId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentAttemptGraded,
      entityType: "AssessmentAttempt",
      entityId: String(attempt.id),
      metadata: {
        actorUserId,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        levelNumber: level.levelNumber,
        stableCode: level.stableCode,
        status,
        totalQuestions: graded.totalQuestions,
        correctCount: graded.correctCount,
        scoreBasisPoints: graded.scoreBasisPoints,
      },
    },
  });
  let completion: SubmitAssessmentAttemptResult["completion"] = null;
  if (graded.passed) {
    try {
      completion = safeCompletion(await completeCurriculumLevelInTransaction(tx, {
        enrollmentId: attempt.enrollmentId,
        levelDefinitionId: attempt.levelDefinitionId,
        sourceType: "assessment_pass",
        sourceId: `assessment-attempt:${attempt.id}`,
        actorId: actorUserId,
        evaluationTime: now,
      }));
    } catch (error) {
      if (isCurriculumLevelCompletionError(error)) {
        if (error.retryableCas) {
          fail("ASSESSMENT_ATTEMPT_CONFLICT", "assessment completion claim was lost", true);
        }
        fail("ASSESSMENT_STATE_CORRUPT", "assessment completion contract rejected the passed attempt");
      }
      throw error;
    }
  }
  const saved = await tx.assessmentAttempt.findUnique({ where: { id: attempt.id } });
  if (!saved) fail("ASSESSMENT_STATE_CORRUPT", "graded assessment attempt disappeared");
  return submitResult(true, saved, completion);
}

function isKnownConflict(error: unknown) {
  return isRecord(error) && typeof error.code === "string" && error.code === "P2002";
}

function isTransientSqliteLock(error: unknown) {
  if (!isRecord(error)) return false;
  const text = `${String(error.code ?? "")} ${String(error.message ?? "")}`.toLowerCase();
  return text.includes("sqlite_busy") || text.includes("sqlite_locked") || text.includes("database is locked");
}

async function transactionWithRetry<T>(
  db: RuntimeDb,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(work);
    } catch (error) {
      const retryableDomain = isAssessmentRuntimeError(error) && error.retryableTransaction;
      const retryable = retryableDomain || isKnownConflict(error) || isTransientSqliteLock(error);
      if (retryable && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
      if (isAssessmentRuntimeError(error)) throw error;
      if (isKnownConflict(error)) {
        fail("ASSESSMENT_ATTEMPT_CONFLICT", "assessment concurrency conflict persisted");
      }
      fail("ASSESSMENT_INTERNAL_ERROR", "assessment runtime failed closed");
    }
  }
  return fail("ASSESSMENT_INTERNAL_ERROR", "assessment runtime retry budget was exhausted");
}

export async function startOwnAssessmentAttempt(
  authenticatedActorUserId: number,
  rawInput: StartAssessmentAttemptInput,
  options: AssessmentRuntimeOptions = {},
): Promise<StartAssessmentAttemptResult> {
  assertBaseFlags();
  const trustedActorUserId = actorId(authenticatedActorUserId);
  const input = parseStartInput(rawInput);
  const now = evaluationTime(options.evaluationTime);
  return transactionWithRetry(options.db ?? prisma, (tx) => runStart(tx, trustedActorUserId, input, now));
}

export async function submitOwnAssessmentAttempt(
  authenticatedActorUserId: number,
  rawInput: SubmitAssessmentAttemptInput,
  options: AssessmentRuntimeOptions = {},
): Promise<SubmitAssessmentAttemptResult> {
  assertBaseFlags();
  const trustedActorUserId = actorId(authenticatedActorUserId);
  const input = parseSubmitInput(rawInput);
  const now = evaluationTime(options.evaluationTime);
  return transactionWithRetry(options.db ?? prisma, (tx) => runSubmit(tx, trustedActorUserId, input, now));
}
