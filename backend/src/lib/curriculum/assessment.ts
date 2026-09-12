import type {
  AssessmentVersion,
  LevelResourceBinding,
  QuestionDefinition,
  QuestionLocalization,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { createAuditLog } from "@/lib/audit";
import { staffRoleGrantsCurriculumCapability } from "@/lib/curriculum/authoring-authorization";
import {
  isAtaVideoProfileLevel,
  isCanonicalTakeId,
  isTakeIdForLevel,
  takeSlotViolation,
} from "@/lib/curriculum/authoring-level-profile";
import { AssessmentDomainError, isAssessmentDomainError } from "@/lib/curriculum/assessment-errors";
import type { AssessmentDomainErrorCode } from "@/lib/curriculum/assessment-errors";
import {
  archiveAssessmentVersionSchema,
  clearAssessmentBindingSchema,
  createAssessmentQuestionSchema,
  createAssessmentVersionSchema,
  createQuestionLocalizationSchema,
  deleteAssessmentQuestionSchema,
  deleteAssessmentVersionSchema,
  deleteQuestionLocalizationSchema,
  publishAssessmentVersionSchema,
  setAssessmentBindingSchema,
  updateAssessmentQuestionSchema,
  updateAssessmentVersionSchema,
  updateQuestionLocalizationSchema,
} from "@/lib/curriculum/assessment-schemas";
import {
  assertLocalizationComplete,
  canonicalizeQuestion,
  parseAssessmentCommand,
  validateAssessmentPublication,
} from "@/lib/curriculum/assessment-validation";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import {
  guardAggregateChildMutation,
  guardAggregateSelfMutation,
} from "@/lib/curriculum/authoring-mutation-guard";
import { assertEditoriallyApproved } from "@/lib/curriculum/authoring-lifecycle";
import { isAuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { isCurriculumV2AssessmentEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;
type AssessmentContext = Prisma.AssessmentVersionGetPayload<{
  include: { levelDefinition: { include: { curriculumVersion: true } } };
}>;
type AssessmentSnapshot = Prisma.AssessmentVersionGetPayload<{
  include: {
    levelDefinition: { include: { curriculumVersion: true } };
    questions: { include: { localizations: true } };
    resourceBindings: true;
  };
}>;

export type PublishAssessmentVersionResult = {
  published: AssessmentVersion;
  replaced: AssessmentVersion | null;
  bindingMoved: boolean;
  recovered: boolean;
};

export type ClearAssessmentBindingResult = {
  binding: LevelResourceBinding | null;
  deleted: boolean;
};

function assertAssessmentEnabled() {
  if (!isCurriculumV2AssessmentEnabled()) {
    throw new AssessmentDomainError("ASSESSMENT_DISABLED", "V2 assessment mutations are disabled");
  }
}

/**
 * RUNTIME / STRUCTURAL authority: `UserRole=admin`, exactly as accepted.
 * Publication, archival and binding keep this and only this.
 */
async function assertAssessmentAdmin(actorId: number, tx: DbClient) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.role !== "admin" || actor.status !== "active") {
    throw new AssessmentDomainError(
      "ASSESSMENT_ACTOR_FORBIDDEN",
      "assessment mutation requires an active admin actor",
    );
  }
}

/**
 * PHASE-G1 — SUBSTANTIVE AUTHORING authority: `UserRole=admin` OR a stored
 * StaffProfile role granting `curriculum_author`. The same two alternatives the
 * accepted HTTP bridge offers, resolved from the same accepted permission
 * matrix, so a question prompt written in the Studio is not refused by the
 * layer beneath it. Publication and binding are deliberately NOT widened.
 */
async function assertAssessmentAuthor(actorId: number, tx: DbClient) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    include: { staffProfile: { select: { staffRole: true } } },
  });
  if (!actor || actor.status !== "active") {
    throw new AssessmentDomainError(
      "ASSESSMENT_ACTOR_FORBIDDEN",
      "assessment mutation requires an active actor",
    );
  }
  if (actor.role === "admin") return;
  if (staffRoleGrantsCurriculumCapability(actor.staffProfile?.staffRole, "author")) return;
  throw new AssessmentDomainError(
    "ASSESSMENT_ACTOR_FORBIDDEN",
    "assessment mutation requires an admin or a curriculum-authoring staff actor",
  );
}

/**
 * PHASE-G1 TAKE-SLOT CORRECTION — where a question's take identity is decided.
 *
 * TWO PROFILES, ONE FUNCTION. An ATA video lesson's bank is four FIXED SLOTS:
 * the question at `questionNumber` N is the content of `T{level}.N` and nothing
 * else, because the accepted assessment projection derives that binding
 * positionally and the video contract's evidence is fingerprinted over it. A
 * reassignment is therefore not a thing an editor can ask for — it would make
 * the durable bank and the video evidence describe different lessons.
 *
 * Everything OUTSIDE that profile keeps the generic vocabulary untouched: an
 * ordinary assessment's `stableKey` is a free lowercase key, and the only rule
 * that applies is the one that has always applied — a value SHAPED like a take
 * may not name another level.
 *
 * The slot rule itself is stated once, in `authoring-level-profile`. This
 * function decides only WHICH rule the bank is under.
 */
function assertTakeIdentity(
  level: { levelNumber: number; stableCode: string; type: string },
  stableKey: string,
  questionNumber: number,
) {
  if (!isAtaVideoProfileLevel(level)) {
    // Generic profile: shape is the schema's business, level ownership is ours.
    if (!isCanonicalTakeId(stableKey)) return;
    if (isTakeIdForLevel(stableKey, level.levelNumber)) return;
    throw new AssessmentDomainError(
      "ASSESSMENT_INPUT_INVALID",
      "take identifier belongs to another level",
      [
        {
          code: "ASSESSMENT_FIELD_INVALID",
          entity: "assessment",
          reference: "input.stableKey",
          message: `take ${stableKey} does not belong to level ${level.levelNumber}`,
        },
      ],
    );
  }

  const violation = takeSlotViolation(stableKey, level.levelNumber, questionNumber);
  if (violation === null) return;
  throw new AssessmentDomainError("ASSESSMENT_INPUT_INVALID", violation, [
    {
      code: "ASSESSMENT_TAKE_SLOT_INVALID",
      entity: "assessment",
      reference: "input.stableKey",
      message: violation,
    },
  ]);
}

/**
 * ATA question slots are not renumbered.
 *
 * `questionNumber` is half of the take identity, so allowing an editor to move a
 * question from slot 2 to slot 1 would be Take reassignment wearing a different
 * field name — the exact hidden path this correction exists to close. The four
 * slots are fixed; what an editor changes is the content inside one.
 */
function assertNoAtaRenumber(
  level: { levelNumber: number; stableCode: string; type: string },
  currentQuestionNumber: number,
  patchedQuestionNumber: number | undefined,
) {
  if (patchedQuestionNumber === undefined) return;
  if (patchedQuestionNumber === currentQuestionNumber) return;
  if (!isAtaVideoProfileLevel(level)) return;
  const message =
    `question ${currentQuestionNumber} cannot be renumbered to ${patchedQuestionNumber}: ` +
    `an ATA lesson has four fixed take slots (${[1, 2, 3, 4]
      .map((n) => `T${level.levelNumber}.${n}`)
      .join(", ")}) and a question is the content of its slot`;
  throw new AssessmentDomainError("ASSESSMENT_INPUT_INVALID", message, [
    {
      code: "ASSESSMENT_TAKE_SLOT_INVALID",
      entity: "assessment",
      reference: "input.questionNumber",
      message,
    },
  ]);
}

function assertParentDraft(status: "draft" | "published" | "archived") {
  if (status === "published") {
    throw new AssessmentDomainError(
      "ASSESSMENT_PUBLISHED_IMMUTABLE",
      "published curriculum assessment resources are immutable",
    );
  }
  if (status === "archived") {
    throw new AssessmentDomainError(
      "ASSESSMENT_ARCHIVED_IMMUTABLE",
      "archived curriculum assessment resources are immutable",
    );
  }
}

function assertDraftAssessment(assessment: Pick<AssessmentVersion, "status">) {
  if (assessment.status === "published") {
    throw new AssessmentDomainError(
      "ASSESSMENT_PUBLISHED_IMMUTABLE",
      "published assessment is immutable; create a new version",
    );
  }
  if (assessment.status === "archived") {
    throw new AssessmentDomainError(
      "ASSESSMENT_ARCHIVED_IMMUTABLE",
      "archived assessment is immutable",
    );
  }
  if (assessment.status !== "draft") {
    throw new AssessmentDomainError("ASSESSMENT_VERSION_NOT_DRAFT", "assessment is not a draft");
  }
}

async function loadLevel(levelDefinitionId: number, tx: DbClient) {
  const level = await tx.levelDefinition.findUnique({
    where: { id: levelDefinitionId },
    include: { curriculumVersion: true },
  });
  if (!level) throw new AssessmentDomainError("ASSESSMENT_LEVEL_NOT_FOUND", "level does not exist");
  assertParentDraft(level.curriculumVersion.status);
  return level;
}

async function loadAssessment(id: number, tx: DbClient): Promise<AssessmentContext> {
  const assessment = await tx.assessmentVersion.findUnique({
    where: { id },
    include: { levelDefinition: { include: { curriculumVersion: true } } },
  });
  if (!assessment) {
    throw new AssessmentDomainError("ASSESSMENT_VERSION_NOT_FOUND", "assessment version does not exist");
  }
  if (assessment.curriculumVersionId !== assessment.levelDefinition.curriculumVersionId) {
    throw new AssessmentDomainError("ASSESSMENT_VERSION_MISMATCH", "assessment ownership is inconsistent");
  }
  assertParentDraft(assessment.levelDefinition.curriculumVersion.status);
  return assessment;
}

async function loadSnapshot(id: number, tx: DbClient): Promise<AssessmentSnapshot> {
  const assessment = await tx.assessmentVersion.findUnique({
    where: { id },
    include: {
      levelDefinition: { include: { curriculumVersion: true } },
      questions: {
        orderBy: [{ questionNumber: "asc" }, { id: "asc" }],
        include: { localizations: { orderBy: { locale: "asc" } } },
      },
      resourceBindings: true,
    },
  });
  if (!assessment) {
    throw new AssessmentDomainError("ASSESSMENT_VERSION_NOT_FOUND", "assessment version does not exist");
  }
  if (assessment.curriculumVersionId !== assessment.levelDefinition.curriculumVersionId) {
    throw new AssessmentDomainError("ASSESSMENT_VERSION_MISMATCH", "assessment ownership is inconsistent");
  }
  assertParentDraft(assessment.levelDefinition.curriculumVersion.status);
  return assessment;
}

async function loadQuestion(id: number, tx: DbClient) {
  const question = await tx.questionDefinition.findUnique({ where: { id } });
  if (!question) {
    throw new AssessmentDomainError("ASSESSMENT_QUESTION_NOT_FOUND", "question does not exist");
  }
  const assessment = await loadAssessment(question.assessmentVersionId, tx);
  assertDraftAssessment(assessment);
  return { question, assessment };
}

async function writeAssessmentAudit(
  tx: DbClient,
  input: {
    actorId: number;
    action: string;
    entityType: "AssessmentVersion" | "QuestionDefinition" | "QuestionLocalization" | "LevelResourceBinding";
    entityId: number;
    metadata: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: String(input.entityId),
      metadata: input.metadata,
    },
  });
}

function mapConstraintError(
  error: unknown,
  conflict: AssessmentDomainErrorCode,
  notFound: AssessmentDomainErrorCode,
): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002" || error.code === "P2003") {
      throw new AssessmentDomainError(conflict, "assessment constraint conflict");
    }
    if (error.code === "P2025") {
      throw new AssessmentDomainError(notFound, "assessment record does not exist");
    }
  }
  throw error;
}

async function runSanitized<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isAssessmentDomainError(error)) throw error;
    // PHASE-G0 CORRECTION — see the identical note in content.ts. An authoring
    // refusal is a product answer and must not be flattened into a 500.
    if (isAuthoringDomainError(error)) throw error;
    throw new AssessmentDomainError("ASSESSMENT_INTERNAL_ERROR", "assessment operation failed");
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function valuesEqual(left: unknown, right: unknown) {
  if ((left === null && right === Prisma.DbNull) || (right === null && left === Prisma.DbNull)) return true;
  return left === right || (
    left !== null && right !== null && typeof left === "object" && typeof right === "object" &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

function patchHasChanges(existing: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.entries(patch).some(([key, value]) => !valuesEqual(existing[key], value));
}

function jsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  return value === null ? Prisma.DbNull : value as Prisma.InputJsonValue;
}

export async function createAssessmentVersion(input: unknown): Promise<AssessmentVersion> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(createAssessmentVersionSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const level = await loadLevel(data.levelDefinitionId, tx);
    const maximum = await tx.assessmentVersion.aggregate({
      where: { levelDefinitionId: level.id },
      _max: { versionNumber: true },
    });
    let created: AssessmentVersion;
    try {
      created = await tx.assessmentVersion.create({
        data: {
          levelDefinitionId: level.id,
          curriculumVersionId: level.curriculumVersionId,
          versionNumber: (maximum._max.versionNumber ?? 0) + 1,
          passPercent: data.passPercent,
          maxAttempts: data.maxAttempts ?? null,
          showExplanation: data.showExplanation ?? false,
          changeNotes: data.changeNotes ?? null,
          createdById: data.actorId,
        },
      });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_VERSION_CONFLICT", "ASSESSMENT_LEVEL_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentVersionCreated,
      entityType: "AssessmentVersion",
      entityId: created.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: created.id,
        curriculumVersionId: created.curriculumVersionId,
        levelDefinitionId: created.levelDefinitionId,
        versionNumber: created.versionNumber,
      },
    });
    return created;
  }));
}

export async function updateAssessmentVersion(input: unknown): Promise<AssessmentVersion> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(updateAssessmentVersionSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const assessment = await loadAssessment(data.assessmentVersionId, tx);
    assertDraftAssessment(assessment);
    // PHASE-G0 CORRECTION — the aggregate authoring boundary. See
    // authoring-mutation-guard.ts. Refuses a submitted or approved bank,
    // refuses a stale writer, moves the revision and records the
    // server-resolved actor as the substantive author, in this transaction.
    await guardAggregateChildMutation(tx, {
      kind: "assessment",
      aggregateId: assessment.id,
      expectedRevision: data.expectedRevision,
      actorId: data.actorId,
    });
    const patch = stripUndefined(data.patch);
    if (!patchHasChanges(assessment as unknown as Record<string, unknown>, patch)) {
      throw new AssessmentDomainError("ASSESSMENT_NO_CHANGES", "assessment update has no changes");
    }
    let updated: AssessmentVersion;
    try {
      updated = await tx.assessmentVersion.update({ where: { id: assessment.id }, data: patch });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_VERSION_CONFLICT", "ASSESSMENT_VERSION_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentVersionUpdated,
      entityType: "AssessmentVersion",
      entityId: updated.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: updated.id,
        levelDefinitionId: updated.levelDefinitionId,
        versionNumber: updated.versionNumber,
      },
    });
    return updated;
  }));
}

export async function deleteAssessmentVersion(input: unknown): Promise<AssessmentVersion> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(deleteAssessmentVersionSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const assessment = await loadAssessment(data.assessmentVersionId, tx);
    assertDraftAssessment(assessment);
    // PHASE-G0 CORRECTION — deleting the aggregate cannot bump its own
    // revision, but the editorial state and expected revision are still
    // checked so an approved bank can never be erased outright.
    await guardAggregateSelfMutation(tx, {
      kind: "assessment",
      aggregateId: assessment.id,
      expectedRevision: data.expectedRevision,
    });
    const [questions, bindings, attempts] = await Promise.all([
      tx.questionDefinition.count({ where: { assessmentVersionId: assessment.id } }),
      tx.levelResourceBinding.count({ where: { assessmentVersionId: assessment.id } }),
      tx.assessmentAttempt.count({ where: { assessmentVersionId: assessment.id } }),
    ]);
    if (questions + bindings + attempts > 0) {
      throw new AssessmentDomainError("ASSESSMENT_NOT_EMPTY", "only an empty unbound draft can be deleted");
    }
    let deleted: AssessmentVersion;
    try {
      deleted = await tx.assessmentVersion.delete({ where: { id: assessment.id } });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_NOT_EMPTY", "ASSESSMENT_VERSION_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentVersionDeleted,
      entityType: "AssessmentVersion",
      entityId: deleted.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: deleted.id,
        levelDefinitionId: deleted.levelDefinitionId,
        versionNumber: deleted.versionNumber,
      },
    });
    return deleted;
  }));
}

export async function createAssessmentQuestion(input: unknown): Promise<QuestionDefinition> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(createAssessmentQuestionSchema, input);
  const canonical = canonicalizeQuestion(data.type, data.options, data.correctAnswer);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const assessment = await loadAssessment(data.assessmentVersionId, tx);
    assertDraftAssessment(assessment);
    assertTakeIdentity(assessment.levelDefinition, data.stableKey, data.questionNumber);
    // PHASE-G0 CORRECTION — the aggregate authoring boundary. See
    // authoring-mutation-guard.ts. Refuses a submitted or approved bank,
    // refuses a stale writer, moves the revision and records the
    // server-resolved actor as the substantive author, in this transaction.
    await guardAggregateChildMutation(tx, {
      kind: "assessment",
      aggregateId: assessment.id,
      expectedRevision: data.expectedRevision,
      actorId: data.actorId,
    });
    let created: QuestionDefinition;
    try {
      created = await tx.questionDefinition.create({
        data: {
          assessmentVersionId: assessment.id,
          questionNumber: data.questionNumber,
          stableKey: data.stableKey,
          type: data.type,
          skillTag: data.skillTag ?? null,
          options: jsonInput(canonical.options),
          correctAnswer: canonical.correctAnswer,
        },
      });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_QUESTION_CONFLICT", "ASSESSMENT_VERSION_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentQuestionCreated,
      entityType: "QuestionDefinition",
      entityId: created.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: created.assessmentVersionId,
        questionDefinitionId: created.id,
        questionNumber: created.questionNumber,
        stableKey: created.stableKey,
      },
    });
    return created;
  }));
}

export async function updateAssessmentQuestion(input: unknown): Promise<QuestionDefinition> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(updateAssessmentQuestionSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const { question, assessment } = await loadQuestion(data.questionDefinitionId, tx);
    assertNoAtaRenumber(assessment.levelDefinition, question.questionNumber, data.patch.questionNumber);
    // The pair AFTER this write is what has to be legal. Checking only the
    // patched half would let `questionNumber` and `stableKey` be moved apart one
    // call at a time. A patch that touches NEITHER is left alone on purpose: an
    // imported or legacy bank that is already out of slot must still be editable
    // enough to be repaired, and the validator, readiness and the handoff all
    // keep refusing it until it is.
    if (data.patch.stableKey !== undefined || data.patch.questionNumber !== undefined) {
      assertTakeIdentity(
        assessment.levelDefinition,
        data.patch.stableKey ?? question.stableKey,
        data.patch.questionNumber ?? question.questionNumber,
      );
    }
    // PHASE-G0 CORRECTION — the aggregate authoring boundary. See
    // authoring-mutation-guard.ts. Refuses a submitted or approved bank,
    // refuses a stale writer, moves the revision and records the
    // server-resolved actor as the substantive author, in this transaction.
    await guardAggregateChildMutation(tx, {
      kind: "assessment",
      aggregateId: assessment.id,
      expectedRevision: data.expectedRevision,
      actorId: data.actorId,
    });
    const type = data.patch.type ?? question.type;
    const canonical = canonicalizeQuestion(
      type,
      data.patch.options === undefined ? question.options : data.patch.options,
      data.patch.correctAnswer === undefined ? question.correctAnswer : data.patch.correctAnswer,
      `question:${question.id}`,
    );
    const patch: Record<string, unknown> = stripUndefined({
      questionNumber: data.patch.questionNumber,
      stableKey: data.patch.stableKey,
      type: data.patch.type,
      skillTag: data.patch.skillTag,
      options: data.patch.options === undefined && data.patch.type === undefined ? undefined : jsonInput(canonical.options),
      correctAnswer: data.patch.correctAnswer === undefined && data.patch.type === undefined && data.patch.options === undefined
        ? undefined
        : canonical.correctAnswer,
    });
    if (!patchHasChanges(question as unknown as Record<string, unknown>, patch)) {
      throw new AssessmentDomainError("ASSESSMENT_NO_CHANGES", "question update has no changes");
    }
    let updated: QuestionDefinition;
    try {
      updated = await tx.questionDefinition.update({ where: { id: question.id }, data: patch });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_QUESTION_CONFLICT", "ASSESSMENT_QUESTION_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentQuestionUpdated,
      entityType: "QuestionDefinition",
      entityId: updated.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: updated.assessmentVersionId,
        questionDefinitionId: updated.id,
        questionNumber: updated.questionNumber,
        stableKey: updated.stableKey,
      },
    });
    return updated;
  }));
}

export async function deleteAssessmentQuestion(input: unknown): Promise<QuestionDefinition> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(deleteAssessmentQuestionSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const { question, assessment } = await loadQuestion(data.questionDefinitionId, tx);
    // PHASE-G0 CORRECTION — the aggregate authoring boundary. See
    // authoring-mutation-guard.ts. Refuses a submitted or approved bank,
    // refuses a stale writer, moves the revision and records the
    // server-resolved actor as the substantive author, in this transaction.
    await guardAggregateChildMutation(tx, {
      kind: "assessment",
      aggregateId: assessment.id,
      expectedRevision: data.expectedRevision,
      actorId: data.actorId,
    });
    if (await tx.questionLocalization.count({ where: { questionId: question.id } })) {
      throw new AssessmentDomainError(
        "ASSESSMENT_QUESTION_CONFLICT",
        "question localizations must be deleted first",
      );
    }
    let deleted: QuestionDefinition;
    try {
      deleted = await tx.questionDefinition.delete({ where: { id: question.id } });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_QUESTION_CONFLICT", "ASSESSMENT_QUESTION_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentQuestionDeleted,
      entityType: "QuestionDefinition",
      entityId: deleted.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: deleted.assessmentVersionId,
        questionDefinitionId: deleted.id,
        questionNumber: deleted.questionNumber,
        stableKey: deleted.stableKey,
      },
    });
    return deleted;
  }));
}

export async function createQuestionLocalization(input: unknown): Promise<QuestionLocalization> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(createQuestionLocalizationSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const { question, assessment } = await loadQuestion(data.questionDefinitionId, tx);
    // PHASE-G0 CORRECTION — the aggregate authoring boundary. See
    // authoring-mutation-guard.ts. Refuses a submitted or approved bank,
    // refuses a stale writer, moves the revision and records the
    // server-resolved actor as the substantive author, in this transaction.
    await guardAggregateChildMutation(tx, {
      kind: "assessment",
      aggregateId: assessment.id,
      expectedRevision: data.expectedRevision,
      actorId: data.actorId,
    });
    assertLocalizationComplete(question, data);
    let created: QuestionLocalization;
    try {
      created = await tx.questionLocalization.create({
        data: {
          questionId: question.id,
          locale: data.locale,
          prompt: data.prompt,
          optionLabels: jsonInput(data.optionLabels),
          explanation: data.explanation,
        },
      });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_LOCALIZATION_CONFLICT", "ASSESSMENT_QUESTION_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentLocalizationCreated,
      entityType: "QuestionLocalization",
      entityId: created.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: question.assessmentVersionId,
        questionDefinitionId: question.id,
        questionLocalizationId: created.id,
        stableKey: question.stableKey,
        locale: created.locale,
      },
    });
    return created;
  }));
}

export async function updateQuestionLocalization(input: unknown): Promise<QuestionLocalization> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(updateQuestionLocalizationSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const localization = await tx.questionLocalization.findUnique({ where: { id: data.questionLocalizationId } });
    if (!localization) {
      throw new AssessmentDomainError("ASSESSMENT_LOCALIZATION_NOT_FOUND", "localization does not exist");
    }
    const { question, assessment } = await loadQuestion(localization.questionId, tx);
    // PHASE-G0 CORRECTION — the aggregate authoring boundary. See
    // authoring-mutation-guard.ts. Refuses a submitted or approved bank,
    // refuses a stale writer, moves the revision and records the
    // server-resolved actor as the substantive author, in this transaction.
    await guardAggregateChildMutation(tx, {
      kind: "assessment",
      aggregateId: assessment.id,
      expectedRevision: data.expectedRevision,
      actorId: data.actorId,
    });
    const merged = {
      prompt: data.patch.prompt ?? localization.prompt,
      optionLabels: data.patch.optionLabels === undefined ? localization.optionLabels : data.patch.optionLabels,
    };
    assertLocalizationComplete(question, merged);
    const patch = stripUndefined({
      locale: data.patch.locale,
      prompt: data.patch.prompt,
      optionLabels: data.patch.optionLabels === undefined ? undefined : jsonInput(data.patch.optionLabels),
      explanation: data.patch.explanation,
    });
    if (!patchHasChanges(localization as unknown as Record<string, unknown>, patch)) {
      throw new AssessmentDomainError("ASSESSMENT_NO_CHANGES", "localization update has no changes");
    }
    let updated: QuestionLocalization;
    try {
      updated = await tx.questionLocalization.update({ where: { id: localization.id }, data: patch });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_LOCALIZATION_CONFLICT", "ASSESSMENT_LOCALIZATION_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentLocalizationUpdated,
      entityType: "QuestionLocalization",
      entityId: updated.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: question.assessmentVersionId,
        questionDefinitionId: question.id,
        questionLocalizationId: updated.id,
        stableKey: question.stableKey,
        locale: updated.locale,
      },
    });
    return updated;
  }));
}

export async function deleteQuestionLocalization(input: unknown): Promise<QuestionLocalization> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(deleteQuestionLocalizationSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAuthor(data.actorId, tx);
    const localization = await tx.questionLocalization.findUnique({ where: { id: data.questionLocalizationId } });
    if (!localization) {
      throw new AssessmentDomainError("ASSESSMENT_LOCALIZATION_NOT_FOUND", "localization does not exist");
    }
    const { question, assessment } = await loadQuestion(localization.questionId, tx);
    // PHASE-G0 CORRECTION — the aggregate authoring boundary. See
    // authoring-mutation-guard.ts. Refuses a submitted or approved bank,
    // refuses a stale writer, moves the revision and records the
    // server-resolved actor as the substantive author, in this transaction.
    await guardAggregateChildMutation(tx, {
      kind: "assessment",
      aggregateId: assessment.id,
      expectedRevision: data.expectedRevision,
      actorId: data.actorId,
    });
    let deleted: QuestionLocalization;
    try {
      deleted = await tx.questionLocalization.delete({ where: { id: localization.id } });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_LOCALIZATION_CONFLICT", "ASSESSMENT_LOCALIZATION_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentLocalizationDeleted,
      entityType: "QuestionLocalization",
      entityId: deleted.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: question.assessmentVersionId,
        questionDefinitionId: question.id,
        questionLocalizationId: deleted.id,
        stableKey: question.stableKey,
        locale: deleted.locale,
      },
    });
    return deleted;
  }));
}

async function publishInTransaction(
  data: ReturnType<typeof publishAssessmentVersionSchema.parse>,
): Promise<PublishAssessmentVersionResult> {
  return prisma.$transaction(async (tx) => {
    await assertAssessmentAdmin(data.actorId, tx);
    const assessment = await loadSnapshot(data.assessmentVersionId, tx);
    assertDraftAssessment(assessment);
    const issues = validateAssessmentPublication(assessment);
    if (issues.length > 0) {
      throw new AssessmentDomainError(
        "ASSESSMENT_PUBLICATION_INVALID",
        "assessment failed publication validation",
        issues,
      );
    }

    // PHASE-G0 PUBLISH GATE — the same invariant, in the same position and for
    // the same reason as the content path. A bank whose answer keys nobody
    // reviewed must not become the thing a learner is graded against, and the
    // two resources gate independently: an approved lesson does not carry its
    // assessment into the runtime with it.
    assertEditoriallyApproved(assessment, "assessment");
    const expected = data.expectedPublishedAssessmentVersionId ?? null;
    const current = await tx.assessmentVersion.findFirst({
      where: { levelDefinitionId: assessment.levelDefinitionId, status: "published" },
    });
    if (!current && expected !== null) {
      throw new AssessmentDomainError("ASSESSMENT_REPLACEMENT_MISMATCH", "there is no published assessment matching the expected replacement");
    }
    if (current && expected === null) {
      throw new AssessmentDomainError("ASSESSMENT_REPLACEMENT_REQUIRED", "an explicit expected published assessment ID is required");
    }
    if (current && expected !== current.id) {
      throw new AssessmentDomainError("ASSESSMENT_REPLACEMENT_MISMATCH", "the expected published assessment ID is stale");
    }

    const now = new Date();
    let replaced: AssessmentVersion | null = null;
    let bindingMoved = false;
    if (current) {
      replaced = await tx.assessmentVersion.update({
        where: { id: current.id },
        data: { status: "archived", archivedAt: now },
      });
    }
    const published = await tx.assessmentVersion.update({
      where: { id: assessment.id },
      data: { status: "published", publishedAt: now },
    });
    const binding = await tx.levelResourceBinding.findUnique({
      where: { levelDefinitionId: assessment.levelDefinitionId },
    });
    if (replaced && binding?.assessmentVersionId === replaced.id) {
      await tx.levelResourceBinding.update({
        where: { id: binding.id },
        data: { assessmentVersionId: published.id },
      });
      bindingMoved = true;
    }

    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentVersionPublished,
      entityType: "AssessmentVersion",
      entityId: published.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: published.id,
        curriculumVersionId: published.curriculumVersionId,
        levelDefinitionId: published.levelDefinitionId,
        versionNumber: published.versionNumber,
        replacedAssessmentVersionId: replaced?.id ?? null,
      },
    });
    if (replaced) {
      await writeAssessmentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.assessmentVersionReplaced,
        entityType: "AssessmentVersion",
        entityId: replaced.id,
        metadata: {
          actorId: data.actorId,
          assessmentVersionId: replaced.id,
          levelDefinitionId: replaced.levelDefinitionId,
          versionNumber: replaced.versionNumber,
          replacedByAssessmentVersionId: published.id,
        },
      });
    }
    if (bindingMoved && binding) {
      await writeAssessmentAudit(tx, {
        actorId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.assessmentBound,
        entityType: "LevelResourceBinding",
        entityId: binding.id,
        metadata: {
          actorId: data.actorId,
          levelResourceBindingId: binding.id,
          levelDefinitionId: assessment.levelDefinitionId,
          assessmentVersionId: published.id,
          replacedAssessmentVersionId: replaced?.id ?? null,
        },
      });
    }
    return { published, replaced, bindingMoved, recovered: false };
  });
}

async function recoverPublicationConflict(
  data: ReturnType<typeof publishAssessmentVersionSchema.parse>,
): Promise<PublishAssessmentVersionResult> {
  const published = await prisma.assessmentVersion.findUnique({ where: { id: data.assessmentVersionId } });
  if (!published || published.status !== "published") {
    const current = published ? await prisma.assessmentVersion.findFirst({
      where: { levelDefinitionId: published.levelDefinitionId, status: "published" },
    }) : null;
    const expected = data.expectedPublishedAssessmentVersionId ?? null;
    if (current && expected === null) {
      throw new AssessmentDomainError("ASSESSMENT_REPLACEMENT_REQUIRED", "published assessment already exists");
    }
    if (current && expected !== current.id) {
      throw new AssessmentDomainError("ASSESSMENT_REPLACEMENT_MISMATCH", "published assessment changed");
    }
    throw new AssessmentDomainError("ASSESSMENT_VERSION_CONFLICT", "assessment publication conflict");
  }
  const current = await prisma.assessmentVersion.findFirst({
    where: { levelDefinitionId: published.levelDefinitionId, status: "published" },
  });
  if (current?.id !== published.id) {
    throw new AssessmentDomainError("ASSESSMENT_VERSION_CONFLICT", "published assessment could not be verified");
  }
  const expected = data.expectedPublishedAssessmentVersionId ?? null;
  const replaced = expected === null ? null : await prisma.assessmentVersion.findUnique({ where: { id: expected } });
  if (expected !== null && (!replaced || replaced.levelDefinitionId !== published.levelDefinitionId || replaced.status !== "archived")) {
    throw new AssessmentDomainError("ASSESSMENT_REPLACEMENT_MISMATCH", "replacement state could not be verified");
  }
  const binding = await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: published.levelDefinitionId } });
  return {
    published,
    replaced,
    bindingMoved: replaced !== null && binding?.assessmentVersionId === published.id,
    recovered: true,
  };
}

export async function publishAssessmentVersion(input: unknown): Promise<PublishAssessmentVersionResult> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(publishAssessmentVersionSchema, input);
  try {
    return await publishInTransaction(data);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return runSanitized(() => recoverPublicationConflict(data));
    }
    if (isAssessmentDomainError(error, "ASSESSMENT_PUBLICATION_INVALID")) {
      await createAuditLog({
        userId: data.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.assessmentPublicationRejected,
        entityType: "AssessmentVersion",
        entityId: data.assessmentVersionId,
        metadata: {
          actorId: data.actorId,
          assessmentVersionId: data.assessmentVersionId,
          issueCodes: error.issues.map((item) => item.code),
        },
      });
      throw error;
    }
    if (isAssessmentDomainError(error)) throw error;
    // PHASE-G0 PUBLISH GATE — the approval refusal is a PRODUCT answer and must
    // reach the caller intact. It is not an internal fault, and flattening it
    // into a 500 would tell an editor nothing about why their lesson did not go
    // live. Same reasoning as the sanitizer pass-through above.
    if (isAuthoringDomainError(error)) throw error;
    throw new AssessmentDomainError("ASSESSMENT_INTERNAL_ERROR", "assessment operation failed");
  }
}

export async function archiveAssessmentVersion(input: unknown): Promise<AssessmentVersion> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(archiveAssessmentVersionSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAdmin(data.actorId, tx);
    const assessment = await loadAssessment(data.assessmentVersionId, tx);
    if (assessment.status === "archived") {
      throw new AssessmentDomainError("ASSESSMENT_ARCHIVED_IMMUTABLE", "assessment is already archived");
    }
    if (assessment.status !== "published") {
      throw new AssessmentDomainError("ASSESSMENT_VERSION_NOT_DRAFT", "only published assessment can be archived");
    }
    if (await tx.levelResourceBinding.findFirst({ where: { assessmentVersionId: assessment.id } })) {
      throw new AssessmentDomainError(
        "ASSESSMENT_BINDING_CONFLICT",
        "bound published assessment must be replaced or unbound before archive",
      );
    }
    const archived = await tx.assessmentVersion.update({
      where: { id: assessment.id },
      data: { status: "archived", archivedAt: new Date() },
    });
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentVersionArchived,
      entityType: "AssessmentVersion",
      entityId: archived.id,
      metadata: {
        actorId: data.actorId,
        assessmentVersionId: archived.id,
        levelDefinitionId: archived.levelDefinitionId,
        versionNumber: archived.versionNumber,
      },
    });
    return archived;
  }));
}

export async function setLevelAssessmentBinding(input: unknown): Promise<LevelResourceBinding> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(setAssessmentBindingSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAdmin(data.actorId, tx);
    const level = await loadLevel(data.levelDefinitionId, tx);
    const assessment = await tx.assessmentVersion.findUnique({ where: { id: data.assessmentVersionId } });
    if (!assessment) {
      throw new AssessmentDomainError("ASSESSMENT_VERSION_NOT_FOUND", "assessment version does not exist");
    }
    if (assessment.levelDefinitionId !== level.id || assessment.curriculumVersionId !== level.curriculumVersionId) {
      throw new AssessmentDomainError("ASSESSMENT_VERSION_MISMATCH", "assessment does not belong to the level");
    }
    if (assessment.status !== "published") {
      throw new AssessmentDomainError("ASSESSMENT_BINDING_CONFLICT", "only published assessment can be bound");
    }
    const existing = await tx.levelResourceBinding.findUnique({ where: { levelDefinitionId: level.id } });
    if (existing?.assessmentVersionId === assessment.id) {
      throw new AssessmentDomainError("ASSESSMENT_NO_CHANGES", "assessment binding has no changes");
    }
    let binding: LevelResourceBinding;
    try {
      binding = existing ? await tx.levelResourceBinding.update({
        where: { id: existing.id },
        data: { assessmentVersionId: assessment.id },
      }) : await tx.levelResourceBinding.create({
        data: {
          levelDefinitionId: level.id,
          curriculumVersionId: level.curriculumVersionId,
          assessmentVersionId: assessment.id,
          createdById: data.actorId,
        },
      });
    } catch (error) {
      mapConstraintError(error, "ASSESSMENT_BINDING_CONFLICT", "ASSESSMENT_BINDING_NOT_FOUND");
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentBound,
      entityType: "LevelResourceBinding",
      entityId: binding.id,
      metadata: {
        actorId: data.actorId,
        levelResourceBindingId: binding.id,
        levelDefinitionId: binding.levelDefinitionId,
        contentVersionId: binding.contentVersionId,
        assessmentVersionId: binding.assessmentVersionId,
      },
    });
    return binding;
  }));
}

export async function clearLevelAssessmentBinding(input: unknown): Promise<ClearAssessmentBindingResult> {
  assertAssessmentEnabled();
  const data = parseAssessmentCommand(clearAssessmentBindingSchema, input);
  return runSanitized(() => prisma.$transaction(async (tx) => {
    await assertAssessmentAdmin(data.actorId, tx);
    const level = await loadLevel(data.levelDefinitionId, tx);
    const existing = await tx.levelResourceBinding.findUnique({ where: { levelDefinitionId: level.id } });
    if (!existing || existing.assessmentVersionId === null) {
      throw new AssessmentDomainError("ASSESSMENT_BINDING_NOT_FOUND", "assessment binding does not exist");
    }
    const previousAssessmentVersionId = existing.assessmentVersionId;
    let result: ClearAssessmentBindingResult;
    if (existing.contentVersionId === null) {
      await tx.levelResourceBinding.delete({ where: { id: existing.id } });
      result = { binding: null, deleted: true };
    } else {
      const binding = await tx.levelResourceBinding.update({
        where: { id: existing.id },
        data: { assessmentVersionId: null },
      });
      result = { binding, deleted: false };
    }
    await writeAssessmentAudit(tx, {
      actorId: data.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.assessmentUnbound,
      entityType: "LevelResourceBinding",
      entityId: existing.id,
      metadata: {
        actorId: data.actorId,
        levelResourceBindingId: existing.id,
        levelDefinitionId: existing.levelDefinitionId,
        contentVersionId: existing.contentVersionId,
        assessmentVersionId: previousAssessmentVersionId,
        bindingDeleted: result.deleted,
      },
    });
    return result;
  }));
}
