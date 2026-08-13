import { Prisma, type PrismaClient, type UserCurriculumEnrollment } from "@prisma/client";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { emitCurriculumEnrollmentEvent } from "@/lib/growth/product-events";
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

/**
 * A3 — who asked for this enrollment.
 *
 * Two actors, deliberately modelled as a discriminated union rather than as
 * "actorId, or null for the system". A nullable id is a shape in which
 * forgetting to pass one silently becomes a system enrollment, and the whole
 * point of this type is that the SYSTEM actor cannot be reached by omission —
 * it has to be named.
 *
 * `admin` is the shipped operator command and its authorization is completely
 * unchanged: an active `admin` user, resolved from the database inside the
 * transaction.
 *
 * `system` is server-only. It has no user behind it, so there is no role to
 * check and, critically, NO CLIENT-PROVIDED ACTOR to trust: the only way to
 * reach it is `enrollActiveCurriculumForNewUser`, which takes no actor
 * parameter at all.
 */
export type EnrollmentActor =
  | { readonly kind: "admin"; readonly actorId: number }
  | { readonly kind: "system"; readonly provenance: SystemEnrollmentProvenance };

/**
 * Why the platform enrolled somebody on its own authority. A closed vocabulary:
 * an audit reader can tell registration auto-enrollment from any future system
 * path without parsing prose.
 */
export type SystemEnrollmentProvenance = "system_registration";

export type EnrollActiveCurriculumForNewUserInput = {
  userId: number;
  asOf?: Date;
  db?: EnrollmentCommandDb;
  /** Defaults to `system_registration`, the only member today. */
  provenance?: SystemEnrollmentProvenance;
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
  input: { userId: number; actor: EnrollmentActor; asOf: Date },
): Promise<EnrollUserInPublishedCurriculumResult> {
  // The admin authorization below is UNCHANGED from the shipped command: an
  // active `admin`, resolved from the database inside this transaction. The
  // system branch does not weaken it — it is a different actor with no user
  // identity at all, and the two cannot be confused because a caller has to
  // name which one it is.
  let auditActorId: number | null = null;
  if (input.actor.kind === "admin") {
    const actor = await tx.user.findUnique({
      where: { id: input.actor.actorId },
      select: { id: true, role: true, status: true },
    });
    if (!actor || actor.role !== "admin" || actor.status !== "active") {
      throw new EnrollmentDomainError(
        "ENROLLMENT_ACTOR_FORBIDDEN",
        "enrollment actor must be an active admin",
      );
    }
    auditActorId = actor.id;
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

  // G4-GROWTH — the enrollment step of the CRO funnel, in this transaction.
  await emitCurriculumEnrollmentEvent(tx, {
    enrollmentId: enrollment.id,
    userId: targetUser.id,
    occurredAt: input.asOf,
  });

  await tx.auditLog.create({
    data: {
      // NULL for a system enrollment: there is no user who did it, and naming
      // the learner here would say they enrolled themselves.
      userId: auditActorId,
      action: CURRICULUM_AUDIT_ACTIONS.userEnrolled,
      entityType: "UserCurriculumEnrollment",
      entityId: String(enrollment.id),
      // Identities, a curriculum and a provenance. No email, no name, no IP,
      // no referral code — nothing that identifies the learner beyond the id
      // every other curriculum audit already carries.
      metadata: {
        actorId: auditActorId,
        // A closed vocabulary, so an audit reader can tell an operator
        // enrollment from an automatic one without parsing prose.
        provenance:
          input.actor.kind === "system" ? input.actor.provenance : "admin_command",
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
  return enrollInPublishedCurriculum({
    userId,
    actor: { kind: "admin", actorId },
    asOf,
    db,
  });
}

/**
 * The one enrollment body both actors share.
 *
 * Flags, transaction shape, history validation, pinning, concurrent-conflict
 * recovery and audit are identical whoever asked. Only the actor differs, and
 * only where it must: the admin authorization check and the audit provenance.
 */
async function enrollInPublishedCurriculum({
  userId,
  actor,
  asOf,
  db,
}: {
  userId: number;
  actor: EnrollmentActor;
  asOf: Date;
  db: EnrollmentCommandDb;
}): Promise<EnrollUserInPublishedCurriculumResult> {
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
      runEnrollmentTransaction(tx, { userId, actor, asOf }),
    );
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;

    const recovered = await recoverConcurrentEnrollment(db, userId);
    if (recovered) return recovered;
    throw error;
  }
}

/**
 * A3 — enroll a learner in the active published ata-v2 curriculum, on the
 * platform's own authority.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE ADMIN COMMAND
 * Automatic enrollment at registration is not an operator action, and modelling
 * it as one would mean either inventing a fake admin actor or relaxing
 * `ENROLLMENT_ACTOR_FORBIDDEN` so that "no actor" passes. The first lies in the
 * audit trail; the second turns the admin authorization into something an
 * omission can bypass. A named system actor does neither: the admin rule is
 * byte-for-byte what it was, and this path is reachable only from server code.
 *
 * WHAT A CALLER CANNOT DO
 * There is NO actor parameter. A caller cannot nominate who is enrolling, and
 * therefore cannot present a learner-supplied id as an authority. It cannot
 * choose a curriculum either: the target is resolved as the active published
 * `ata-v2` version and pinned onto the enrollment, exactly as the admin command
 * resolves and pins it.
 *
 * IDEMPOTENCY AND CONCURRENCY
 * A learner who already has an active enrollment gets it back with
 * `created: false` — the same answer the admin command gives. Two concurrent
 * registrations for one learner resolve through the shipped
 * `recoverConcurrentEnrollment` path, so the loser of the unique-index race
 * returns the winner's enrollment instead of failing.
 *
 * FLAGS STILL GOVERN. With `CURRICULUM_V2_ENROLLMENT_ENABLED` or
 * `CURRICULUM_V2_READ_ENABLED` absent this throws `ENROLLMENT_DISABLED` /
 * `CURRICULUM_READ_DISABLED` and writes nothing at all — which is what makes it
 * safe to call from a registration flow while the flags are off.
 *
 * NOT WIRED INTO REGISTRATION IN THIS PHASE — see the Phase A report.
 */
export async function enrollActiveCurriculumForNewUser({
  userId,
  asOf = new Date(),
  db = prisma,
  provenance = "system_registration",
}: EnrollActiveCurriculumForNewUserInput): Promise<EnrollUserInPublishedCurriculumResult> {
  return enrollActiveCurriculumForNewUserOwningTransaction({
    userId,
    asOf,
    db,
    provenance,
  });
}

async function enrollActiveCurriculumForNewUserOwningTransaction({
  userId,
  asOf,
  db,
  provenance,
}: {
  userId: number;
  asOf: Date;
  db: EnrollmentCommandDb;
  provenance: SystemEnrollmentProvenance;
}): Promise<EnrollUserInPublishedCurriculumResult> {
  const result = await enrollInPublishedCurriculum({
    userId,
    actor: { kind: "system", provenance },
    asOf,
    db,
  });

  // L1OWNER-1, same settlement the admin command performs: a learner who
  // registered with Pocket before enrolling has a durable identity and a debt
  // this enrollment can now settle. Idempotent, and a failure never fails the
  // enrollment.
  try {
    await reconcilePocketRegistrationLevelCompletion(userId);
  } catch {
    /* enrolment stands; reconciliation is retryable */
  }

  return result;
}

/**
 * PHASE-F — the SAME system enrollment, inside a transaction the CALLER owns.
 *
 * =========================== WHY THIS EXISTS ===========================
 * Registration auto-enrollment has to be part of the registration transaction,
 * not a second operation after it. The alternative — register, commit, then
 * enroll — has a failure mode with no good answer: the learner exists, the
 * enrollment does not, and the platform has already told them they are signed
 * up. `enrollActiveCurriculumForNewUser` cannot be reused for that, because it
 * OPENS a transaction and Prisma has no nested one; calling it from inside the
 * registration transaction would either deadlock on SQLite or commit
 * independently, which is the very split this is meant to avoid.
 *
 * So the shared body is exposed here with the caller's `tx`. Everything the
 * standalone command does is unchanged: same flags, same history validation,
 * same active-curriculum resolution, same pinning, same audit with the same
 * `system_registration` provenance, and the same absence of any actor parameter.
 *
 * ========================= WHAT THE CALLER INHERITS =========================
 * ATOMICITY, and therefore FAIL-CLOSED BEHAVIOUR. A throw from here aborts the
 * caller's transaction, so a broken curriculum configuration produces NO USER
 * rather than a user with no enrollment. That is the intended direction: a
 * registration that cannot deliver the product it promises should not appear to
 * have succeeded.
 *
 * ==================== WHAT IS DELIBERATELY NOT HERE ====================
 *   - The P2002 recovery path. It re-reads in a NEW transaction, which is
 *     meaningless inside an aborted one. It is also unreachable for this caller:
 *     the learner was created moments ago in this same transaction, so no
 *     concurrent enrollment for that id can exist. A unique conflict here is a
 *     real fault and must surface as one.
 *   - The Pocket reconciliation. It settles a registration that happened BEFORE
 *     enrollment, and a user created in this transaction has no Pocket identity
 *     to settle. Running it would also be a post-commit action inside a
 *     pre-commit scope.
 */
export async function enrollActiveCurriculumForNewUserInTransaction(
  tx: Prisma.TransactionClient,
  input: { userId: number; asOf?: Date; provenance?: SystemEnrollmentProvenance },
): Promise<EnrollUserInPublishedCurriculumResult> {
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
  return runEnrollmentTransaction(tx, {
    userId: input.userId,
    actor: { kind: "system", provenance: input.provenance ?? "system_registration" },
    asOf: input.asOf ?? new Date(),
  });
}
