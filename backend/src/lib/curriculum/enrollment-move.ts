/**
 * PROGRAM STRUCTURE (2026-10-02) — move a learner to the published version.
 *
 * ============================ WHY THIS EXISTS ============================
 * A published curriculum version is immutable, and a learner is pinned to the
 * version they enrolled in — for ever, because nothing on the platform could
 * move them (`V2_PRODUCT_DECISIONS.md` §10: "Переход пользователя на другую
 * CurriculumVersion выполняется только отдельной аудируемой version-migration
 * командой; автоматической миграции нет"). That command was never written.
 *
 * So every change to a program — a new lesson, a video's question rewritten,
 * a chapter opening — reached new registrations only. With the 30-level program
 * that stops being tolerable: its second chapter is not produced yet, and the
 * day it is, the learners waiting on level 15 are exactly the people it is for.
 *
 * ============================== WHAT IT DOES ==============================
 * For ONE learner, in ONE transaction:
 *
 *   1. the active enrollment becomes `superseded` (history is kept whole);
 *   2. a new active enrollment is created on the PUBLISHED version;
 *   3. the levels the learner already completed are CARRIED where the two
 *      versions agree that they are the same level — same stable code, same
 *      type, same completion method — as a contiguous prefix from level 1.
 *      The first level that does not carry is where the learner stands;
 *   4. the learner's XP total is carried as one `migration_adjustment` row —
 *      XP is never taken away (§3), whatever happened to the levels it was
 *      earned on;
 *   5. one audit row says who did it, from what to what, and what carried.
 *
 * ========================== WHAT IT DOES NOT DO ==========================
 * It never completes a level the learner did not complete. A level whose
 * stable code or contract differs is a different level, and the prefix stops
 * there — moving between two differently-shaped programs therefore carries
 * nothing and the learner starts at level 1, with their XP.
 *
 * It never moves a learner who is WAITING ON A PERSON. A report or a
 * mentor-review level in `pending_review` belongs to a reviewer's queue;
 * superseding the enrollment under it would leave that reviewer a task that can
 * no longer be completed. The move is refused and says why.
 *
 * It does not move a FINISHED enrollment. A learner who completed every level
 * of their version has a `completed` enrollment, and reopening one is a product
 * decision this command does not take.
 *
 * It is not automatic, has no HTTP surface and takes no learner input. It is
 * run by an operator (`scripts/ops/moveLearnersToPublishedProgram.ts`), for
 * named learners or for everyone on a named version.
 *
 * ONE KNOWN CONSEQUENCE FOR ANALYTICS. `academy_activation` is keyed on the
 * enrollment, so a moved learner's first completion on the new enrollment is
 * recorded as an activation of THAT enrollment. No growth event is emitted by
 * the move itself: nobody enrolled, and nothing was completed.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { isCurriculumV2XpEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { CURRICULUM_AUDIT_ACTIONS, DEFAULT_CURRICULUM_CODE } from "./constants";
import { describeClosedTail } from "./closed-tail";
import { recordCurriculumXpInTransaction } from "./xp";

export type EnrollmentMoveOutcome =
  /** Moved: the learner now stands on the published version. */
  | "moved"
  /** Already on the published version. Nothing was written. */
  | "already_current"
  /** No active enrollment to move. Nothing was written. */
  | "no_active_enrollment"
  /** The learner is waiting on a reviewer. Nothing was written. */
  | "blocked_pending_review"
  /** There is no published version, or it is not a shape a learner can be put on. */
  | "target_unavailable";

export type EnrollmentMovePlan = {
  readonly outcome: EnrollmentMoveOutcome;
  readonly userId: number;
  readonly from: { enrollmentId: number; versionNumber: number; currentLevel: number; completedLevels: number } | null;
  readonly to: { versionNumber: number; currentLevel: number; carriedLevels: number } | null;
  /** The XP total carried forward. 0 when the learner had none or XP is off. */
  readonly xpCarried: number;
  /** Present after an applied move. */
  readonly newEnrollmentId: number | null;
};

export type MoveEnrollmentInput = {
  userId: number;
  /** The operator, when one is recorded as a User; null for a server-local command. */
  actorId?: number | null;
  /** Why, in the operator's words. Stored in the audit row, bounded. */
  reason: string;
  /** Plan only: read everything, decide, write nothing. */
  dryRun?: boolean;
  asOf?: Date;
  db?: Pick<PrismaClient, "$transaction">;
};

const REASON_PATTERN = /^[^\u0000-\u001f<>]{8,300}$/u;

type Tx = Prisma.TransactionClient;

async function planWithin(tx: Tx, userId: number): Promise<{
  plan: EnrollmentMovePlan;
  carried: Array<{ levelDefinitionId: number; startedAt: Date; completedAt: Date; fromProgressId: number }>;
  targetVersionId: number | null;
  targetLevelCount: number;
  xpTotal: number;
}> {
  const none = (outcome: EnrollmentMoveOutcome): Awaited<ReturnType<typeof planWithin>> => ({
    plan: { outcome, userId, from: null, to: null, xpCarried: 0, newEnrollmentId: null },
    carried: [],
    targetVersionId: null,
    targetLevelCount: 0,
    xpTotal: 0,
  });

  const active = await tx.userCurriculumEnrollment.findFirst({
    where: { userId, curriculumCode: DEFAULT_CURRICULUM_CODE, status: "active" },
    include: {
      curriculumVersion: { select: { id: true, versionNumber: true } },
      levelProgress: { include: { levelDefinition: true } },
    },
  });
  if (!active) return none("no_active_enrollment");

  const from = {
    enrollmentId: active.id,
    versionNumber: active.curriculumVersion.versionNumber,
    currentLevel: active.currentLevel,
    completedLevels: active.levelProgress.filter((row) => row.status === "completed").length,
  };

  const target = await tx.curriculumVersion.findFirst({
    where: { code: DEFAULT_CURRICULUM_CODE, status: "published" },
    include: { levels: true, modules: true },
  });
  if (!target || !target.publishedAt) {
    return { ...none("target_unavailable"), plan: { ...none("target_unavailable").plan, from } };
  }
  if (target.id === active.curriculumVersionId) {
    return { ...none("already_current"), plan: { ...none("already_current").plan, from } };
  }
  // The same shape rule a learner's read path applies to a published version.
  if (!describeClosedTail(target.levels, target.modules).ok || target.levels.length === 0) {
    return { ...none("target_unavailable"), plan: { ...none("target_unavailable").plan, from } };
  }
  if (active.levelProgress.some((row) => row.status === "pending_review")) {
    return { ...none("blocked_pending_review"), plan: { ...none("blocked_pending_review").plan, from } };
  }

  // What the learner completed, by the identity two versions can share.
  const completedByCode = new Map(
    active.levelProgress
      .filter((row) => row.status === "completed" && row.completedAt !== null)
      .map((row) => [row.levelDefinition.stableCode, row]),
  );
  const carried: Array<{ levelDefinitionId: number; startedAt: Date; completedAt: Date; fromProgressId: number }> = [];
  const ordered = [...target.levels].sort((left, right) => left.levelNumber - right.levelNumber);
  for (const level of ordered) {
    const before = completedByCode.get(level.stableCode);
    // A level that is not open in the target cannot be "already completed" on
    // it, whatever the learner did on the old version.
    if (
      !before ||
      level.status !== "active" ||
      before.levelDefinition.type !== level.type ||
      before.levelDefinition.completionMethod !== level.completionMethod
    ) {
      break;
    }
    carried.push({
      levelDefinitionId: level.id,
      startedAt: before.startedAt,
      completedAt: before.completedAt!,
      fromProgressId: before.id,
    });
  }

  const xpRows = await tx.xPTransaction.aggregate({
    where: { enrollmentId: active.id },
    _sum: { amount: true },
  });
  const xpTotal = xpRows._sum.amount ?? 0;

  return {
    plan: {
      outcome: "moved",
      userId,
      from,
      to: {
        versionNumber: target.versionNumber,
        currentLevel: carried.length + 1,
        carriedLevels: carried.length,
      },
      xpCarried: isCurriculumV2XpEnabled() ? xpTotal : 0,
      newEnrollmentId: null,
    },
    carried,
    targetVersionId: target.id,
    targetLevelCount: ordered.length,
    xpTotal,
  };
}

export async function moveEnrollmentToPublishedVersion(
  input: MoveEnrollmentInput,
): Promise<EnrollmentMovePlan> {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw new Error("userId must be a positive integer");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!REASON_PATTERN.test(reason)) {
    throw new Error("reason must be 8–300 characters of plain text");
  }
  const actorId = input.actorId ?? null;
  const asOf = input.asOf ?? new Date();
  const db = input.db ?? prisma;

  return db.$transaction(async (tx) => {
    const { plan, carried, targetVersionId, targetLevelCount, xpTotal } = await planWithin(tx, input.userId);
    if (plan.outcome !== "moved" || input.dryRun || targetVersionId === null || !plan.from || !plan.to) {
      return plan;
    }

    // 1. The old enrollment steps aside. CAS on `active`: a concurrent move, or
    //    a completion that just finished the program, loses here and the whole
    //    transaction rolls back.
    const superseded = await tx.userCurriculumEnrollment.updateMany({
      where: { id: plan.from.enrollmentId, status: "active" },
      data: { status: "superseded" },
    });
    if (superseded.count !== 1) throw new Error("the enrollment changed while it was being moved");

    // 2. The new one. `migrationSource` names where it came from, so the two
    //    rows can be read as one history without an audit lookup.
    //
    //    If EVERY level of the target carried, the learner has already finished
    //    it, and the summary says so in the one representation the completion
    //    owner uses for a finished program (`currentLevel = maxLevel + 1`,
    //    `completed`). An `active` enrollment standing past its last level is
    //    the shape the resolver reads as corrupt.
    const finished = carried.length === targetLevelCount;
    const created = await tx.userCurriculumEnrollment.create({
      data: {
        userId: input.userId,
        curriculumVersionId: targetVersionId,
        curriculumCode: DEFAULT_CURRICULUM_CODE,
        status: finished ? "completed" : "active",
        enrolledAt: asOf,
        highestCompletedLevel: carried.length,
        currentLevel: carried.length + 1,
        lastMeaningfulActionAt: null,
        completedAt: finished ? asOf : null,
        migrationSource: `enrollment:${plan.from.enrollmentId}`,
      },
    });

    // 3. The levels the two versions agree the learner has done.
    for (const level of carried) {
      await tx.userLevelProgress.create({
        data: {
          enrollmentId: created.id,
          curriculumVersionId: targetVersionId,
          levelDefinitionId: level.levelDefinitionId,
          status: "completed",
          startedAt: level.startedAt,
          lastProgressAt: level.completedAt,
          completedAt: level.completedAt,
          completionMethod: "version_move",
          completionEvidence: {
            kind: "enrollment_version_move",
            fromEnrollmentId: plan.from.enrollmentId,
            fromProgressId: level.fromProgressId,
          },
        },
      });
    }

    // 4. XP is the learner's. One adjustment row carries the total; it names no
    //    level, which is what `migration_adjustment` requires.
    let xpCarried = 0;
    // (The ledger accepts a new row only for an ACTIVE enrollment, so a learner
    // whose every level carried keeps their total on the superseded enrollment.)
    if (xpTotal > 0 && isCurriculumV2XpEnabled() && !finished) {
      await recordCurriculumXpInTransaction(tx, {
        enrollmentId: created.id,
        sourceType: "migration_adjustment",
        sourceId: `enrollment-move:${plan.from.enrollmentId}`,
        levelDefinitionId: null,
        amount: xpTotal,
        actorId,
      });
      xpCarried = xpTotal;
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: CURRICULUM_AUDIT_ACTIONS.enrollmentMoved,
        entityType: "UserCurriculumEnrollment",
        entityId: String(created.id),
        metadata: {
          actorId,
          userId: input.userId,
          fromEnrollmentId: plan.from.enrollmentId,
          fromVersionNumber: plan.from.versionNumber,
          fromCurrentLevel: plan.from.currentLevel,
          toEnrollmentId: created.id,
          toVersionNumber: plan.to.versionNumber,
          carriedLevels: carried.length,
          xpCarried,
          reason,
        },
      },
    });

    return { ...plan, xpCarried, newEnrollmentId: created.id };
  });
}
