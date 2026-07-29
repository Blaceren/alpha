import { Prisma, type PrismaClient, type UserCurriculumEnrollment } from "@prisma/client";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { reconcilePocketRegistrationLevelCompletion } from "./pocket-registration-completion";
import { CURRICULUM_AUDIT_ACTIONS, DEFAULT_CURRICULUM_CODE } from "./constants";
import {
  resolvePublishedCurriculum,
  validatePinnedEnrollmentSnapshot,
  type EnrollmentResolutionGraph,
} from "./resolver";

export type EnrollmentDomainErrorCode =
  | "ENROLLMENT_DISABLED"
  | "CURRICULUM_READ_DISABLED"
  | "ENROLLMENT_ACTOR_FORBIDDEN"
  | "ENROLLMENT_USER_NOT_FOUND"
  | "ENROLLMENT_USER_INACTIVE"
  | "ENROLLMENT_TARGET_UNAVAILABLE"
  | "ENROLLMENT_TARGET_CORRUPT"
  | "ENROLLMENT_HISTORY_CORRUPT"
  | "ENROLLMENT_ALREADY_COMPLETED";

export class EnrollmentDomainError extends Error {
  readonly code: EnrollmentDomainErrorCode;

  constructor(code: EnrollmentDomainErrorCode, message: string) {
    super(message);
    this.name = "EnrollmentDomainError";
    this.code = code;
  }
}

export function isEnrollmentDomainError(error: unknown): error is EnrollmentDomainError {
  return error instanceof EnrollmentDomainError;
}

export type EnrollmentCommandDb = Pick<PrismaClient, "$transaction">;

export type EnrollUserInPublishedCurriculumInput = {
  userId: number;
  actorId: number;
  asOf?: Date;
  db?: EnrollmentCommandDb;
};

export type EnrollUserInPublishedCurriculumResult = {
  kind: "enrolled";
  created: boolean;
  enrollment: UserCurriculumEnrollment;
};

const enrollmentGraphInclude = {
  curriculumVersion: { include: { modules: true, levels: true } },
  levelProgress: { include: { levelDefinition: true } },
} as const;

function historyCorrupt(reason: string): EnrollmentDomainError {
  return new EnrollmentDomainError(
    "ENROLLMENT_HISTORY_CORRUPT",
    `ata-v2 enrollment history is corrupt: ${reason}`,
  );
}

function enrollmentOnly(snapshot: EnrollmentResolutionGraph): UserCurriculumEnrollment {
  const { curriculumVersion, levelProgress, ...enrollment } = snapshot;
  void curriculumVersion;
  void levelProgress;
  return enrollment;
}

function assertValidPinnedHistory(snapshot: EnrollmentResolutionGraph) {
  const corruption = validatePinnedEnrollmentSnapshot(
    snapshot,
    DEFAULT_CURRICULUM_CODE,
  );
  if (corruption) throw historyCorrupt(corruption.reason);
}

async function loadHistory(tx: Prisma.TransactionClient, userId: number) {
  return tx.userCurriculumEnrollment.findMany({
    where: { userId, curriculumCode: DEFAULT_CURRICULUM_CODE },
    include: enrollmentGraphInclude,
    orderBy: [{ enrolledAt: "desc" }, { id: "desc" }],
  });
}

function existingActiveFromHistory(
  history: EnrollmentResolutionGraph[],
): UserCurriculumEnrollment | null {
  const active = history.filter((enrollment) => enrollment.status === "active");
  if (active.length > 1) throw historyCorrupt("duplicate_active_enrollment");
  if (active.length === 0) return null;

  assertValidPinnedHistory(active[0]);
  return enrollmentOnly(active[0]);
}

async function runEnrollmentTransaction(
  tx: Prisma.TransactionClient,
  input: { userId: number; actorId: number; asOf: Date },
): Promise<EnrollUserInPublishedCurriculumResult> {
  const actor = await tx.user.findUnique({
    where: { id: input.actorId },
    select: { id: true, role: true, status: true },
  });
  if (!actor || actor.role !== "admin" || actor.status !== "active") {
    throw new EnrollmentDomainError(
      "ENROLLMENT_ACTOR_FORBIDDEN",
      "enrollment actor must be an active admin",
    );
  }

  const targetUser = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, status: true },
  });
  if (!targetUser) {
    throw new EnrollmentDomainError(
      "ENROLLMENT_USER_NOT_FOUND",
      "enrollment target user does not exist",
    );
  }
  if (targetUser.status !== "active") {
    throw new EnrollmentDomainError(
      "ENROLLMENT_USER_INACTIVE",
      "enrollment target user is not active",
    );
  }

  const history = await loadHistory(tx, targetUser.id);
  const existingActive = existingActiveFromHistory(history);
  if (existingActive) {
    return { kind: "enrolled", created: false, enrollment: existingActive };
  }

  const completed = history.find((enrollment) => enrollment.status === "completed");
  if (completed) {
    assertValidPinnedHistory(completed);
    throw new EnrollmentDomainError(
      "ENROLLMENT_ALREADY_COMPLETED",
      "completed ata-v2 enrollment blocks ordinary re-enrollment",
    );
  }

  if (history[0]?.status === "superseded") {
    throw historyCorrupt("superseded_without_active_replacement");
  }
  if (history.length > 0) {
    throw historyCorrupt("unexpected_enrollment_status");
  }

  const target = await resolvePublishedCurriculum({
    curriculumCode: DEFAULT_CURRICULUM_CODE,
    asOf: input.asOf,
    db: tx,
  });
  if (target.kind === "disabled") {
    throw new EnrollmentDomainError(
      "CURRICULUM_READ_DISABLED",
      "curriculum read resolver is disabled",
    );
  }
  if (target.kind === "unavailable") {
    throw new EnrollmentDomainError(
      "ENROLLMENT_TARGET_UNAVAILABLE",
      `ata-v2 enrollment target is unavailable: ${target.reason}`,
    );
  }
  if (target.kind === "corrupt") {
    throw new EnrollmentDomainError(
      "ENROLLMENT_TARGET_CORRUPT",
      `ata-v2 enrollment target is corrupt: ${target.reason}`,
    );
  }

  const enrollment = await tx.userCurriculumEnrollment.create({
    data: {
      userId: targetUser.id,
      curriculumVersionId: target.curriculumVersion.id,
      curriculumCode: DEFAULT_CURRICULUM_CODE,
      status: "active",
      enrolledAt: input.asOf,
      highestCompletedLevel: 0,
      currentLevel: 1,
      lastMeaningfulActionAt: null,
      completedAt: null,
      migrationSource: null,
    },
  });

  await tx.auditLog.create({
    data: {
      userId: actor.id,
      action: CURRICULUM_AUDIT_ACTIONS.userEnrolled,
      entityType: "UserCurriculumEnrollment",
      entityId: String(enrollment.id),
      metadata: {
        actorId: actor.id,
        targetUserId: targetUser.id,
        enrollmentId: enrollment.id,
        curriculumVersionId: target.curriculumVersion.id,
        curriculumCode: DEFAULT_CURRICULUM_CODE,
        versionNumber: target.curriculumVersion.versionNumber,
      },
    },
  });

  return { kind: "enrolled", created: true, enrollment };
}

function isPrismaUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function recoverConcurrentEnrollment(
  db: EnrollmentCommandDb,
  userId: number,
): Promise<EnrollUserInPublishedCurriculumResult | null> {
  return db.$transaction(async (tx) => {
    const history = await loadHistory(tx, userId);
    const existingActive = existingActiveFromHistory(history);
    return existingActive
      ? { kind: "enrolled", created: false, enrollment: existingActive }
      : null;
  });
}

export async function enrollUserInPublishedCurriculum(
  input: EnrollUserInPublishedCurriculumInput,
): Promise<EnrollUserInPublishedCurriculumResult> {
  const result = await enrollUserInPublishedCurriculumCore(input);

  // L1OWNER-1 — the other half of the registration ordering.
  //
  // A learner may legally register with Pocket BEFORE enrolling: the referral
  // link needs only a session. That registration binds a durable identity but
  // cannot complete a curriculum that does not exist yet, so it returns
  // `pending_enrollment`. This is where that debt is settled.
  //
  // It runs AFTER the enrolment transaction has committed, and it is fully
  // idempotent: a learner with no identity is a no-op, and a learner who
  // registered after enrolling has already been completed by the postback
  // itself. A failure here never fails the enrolment — the enrolment is real
  // either way, and an identical postback replay or the operator reconciliation
  // command will settle it.
  try {
    await reconcilePocketRegistrationLevelCompletion(input.userId);
  } catch {
    /* enrolment stands; reconciliation is retryable */
  }

  return result;
}

async function enrollUserInPublishedCurriculumCore({
  userId,
  actorId,
  asOf = new Date(),
  db = prisma,
}: EnrollUserInPublishedCurriculumInput): Promise<EnrollUserInPublishedCurriculumResult> {
  if (!isCurriculumV2EnrollmentEnabled()) {
    throw new EnrollmentDomainError(
      "ENROLLMENT_DISABLED",
      "controlled curriculum enrollment is disabled",
    );
  }
  if (!isCurriculumV2ReadEnabled()) {
    throw new EnrollmentDomainError(
      "CURRICULUM_READ_DISABLED",
      "curriculum read resolver is disabled",
    );
  }

  try {
    return await db.$transaction((tx) =>
      runEnrollmentTransaction(tx, { userId, actorId, asOf }),
    );
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;

    const recovered = await recoverConcurrentEnrollment(db, userId);
    if (recovered) return recovered;
    throw error;
  }
}
