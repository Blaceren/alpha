/**
 * LEARNER-OPERATIONS-V1 — escalation.
 *
 * AN ESCALATION DOES NOT MOVE THE CASE. This is the whole design.
 *
 * The case keeps its owner, its queue and its timeline. `LearnerOpsEscalation`
 * records that a second authority was pulled in, why, to whom, and what came
 * back. The case's status becomes `escalated` so the queue shows it, and when
 * the escalation resolves the case returns to `in_progress` under the SAME
 * owner it always had — there is nothing to restore because nothing was taken.
 *
 * The alternative — reassigning the case to the escalation target — is what
 * makes escalations disappear: the original owner loses it from "my work", the
 * learner's timeline splits across two records, and nobody is accountable for
 * the outcome. That is the failure mode this shape exists to prevent.
 *
 * EDUCATIONAL ESCALATION IS NOT AN EDUCATIONAL DECISION. Escalating a case with
 * class `educational_methodology` routes a QUESTION to someone qualified to
 * answer it. It writes no progression, no report review and no rubric. The
 * answer, when it arrives, is a resolution string and a learner-visible message
 * — and if it changes a learner's educational state, that change is made by the
 * canonical Academy owner through its own command, not here.
 */
import type { LearnerOpsEscalationClass } from "@prisma/client";
import { LEARNER_OPS_AUDIT_ACTIONS } from "@/lib/learner-ops/contract";
import { learnerOpsFail } from "@/lib/learner-ops/errors";
import { prisma } from "@/lib/prisma";
import type { StaffActor } from "@/lib/learner-ops/case";
import { transitionCase } from "@/lib/learner-ops/case";

export async function raiseEscalation(input: {
  caseId: string;
  class: LearnerOpsEscalationClass;
  reason: string;
  targetQueueKey?: string;
  targetStaffId?: string;
  actor: StaffActor;
}) {
  const created = await prisma.$transaction(async (tx) => {
    const current = await tx.learnerOpsCase.findUnique({
      where: { id: input.caseId },
      select: { id: true, status: true, version: true },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");

    let targetQueueId: string | null = null;
    if (input.targetQueueKey !== undefined) {
      const queue = await tx.learnerOpsQueue.findUnique({
        where: { key: input.targetQueueKey },
        select: { id: true, isActive: true },
      });
      if (!queue || !queue.isActive) learnerOpsFail("LEARNER_OPS_QUEUE_NOT_FOUND");
      targetQueueId = queue.id;
    }
    if (input.targetStaffId !== undefined) {
      const staff = await tx.staffProfile.findUnique({
        where: { id: input.targetStaffId },
        select: { id: true },
      });
      if (!staff) learnerOpsFail("LEARNER_OPS_STAFF_NOT_FOUND");
    }
    // The database CHECK requires at least one target. Refusing here gives the
    // operator a sentence instead of a constraint violation.
    if (targetQueueId === null && input.targetStaffId === undefined) {
      learnerOpsFail(
        "LEARNER_OPS_INPUT_INVALID",
        "an escalation must name a target queue or a target staff member",
      );
    }

    const escalation = await tx.learnerOpsEscalation.create({
      data: {
        caseId: input.caseId,
        class: input.class,
        raisedByStaffId: input.actor.staffId,
        targetQueueId,
        ...(input.targetStaffId !== undefined ? { targetStaffId: input.targetStaffId } : {}),
        reason: input.reason,
      },
      select: { id: true, raisedAt: true },
    });

    await tx.auditLog.create({
      data: {
        userId: input.actor.userId,
        action: LEARNER_OPS_AUDIT_ACTIONS.escalationRaised,
        entityType: "LearnerOpsEscalation",
        entityId: escalation.id,
        metadata: {
          caseId: input.caseId,
          class: input.class,
          targetQueueKey: input.targetQueueKey ?? null,
          targetStaffId: input.targetStaffId ?? null,
        },
      },
    });

    return { escalation, caseStatus: current.status, caseVersion: current.version };
  });

  // The status change is a separate call so it goes through the ONE transition
  // primitive — its legality table, its event write and its pause bookkeeping
  // are not reimplemented here. A case already `escalated` stays as it is.
  if (created.caseStatus !== "escalated") {
    await transitionCase({
      caseId: input.caseId,
      expectedVersion: created.caseVersion,
      nextStatus: "escalated",
      actor: input.actor,
      reason: `escalation:${input.class}`,
    });
  }

  return created.escalation;
}

export async function resolveEscalation(input: {
  escalationId: string;
  resolution: string;
  returnToOwner: boolean;
  actor: StaffActor;
}) {
  const resolved = await prisma.$transaction(async (tx) => {
    const current = await tx.learnerOpsEscalation.findUnique({
      where: { id: input.escalationId },
      select: {
        id: true,
        caseId: true,
        resolvedAt: true,
        case: { select: { status: true, version: true } },
      },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_ESCALATION_NOT_FOUND");
    if (current.resolvedAt !== null) learnerOpsFail("LEARNER_OPS_ESCALATION_ALREADY_RESOLVED");

    const now = new Date();
    // CAS on `resolvedAt IS NULL` — two people resolving the same escalation at
    // once produces one winner and one 400, never two resolutions.
    const updated = await tx.learnerOpsEscalation.updateMany({
      where: { id: input.escalationId, resolvedAt: null },
      data: {
        resolvedAt: now,
        resolution: input.resolution,
        resolvedByStaffId: input.actor.staffId,
        returnedToOwnerAt: input.returnToOwner ? now : null,
      },
    });
    if (updated.count !== 1) learnerOpsFail("LEARNER_OPS_ESCALATION_ALREADY_RESOLVED");

    await tx.auditLog.create({
      data: {
        userId: input.actor.userId,
        action: LEARNER_OPS_AUDIT_ACTIONS.escalationResolved,
        entityType: "LearnerOpsEscalation",
        entityId: input.escalationId,
        metadata: { caseId: current.caseId, returnedToOwner: input.returnToOwner },
      },
    });

    return current;
  });

  // Return the case to its owner. The owner column was never changed, so this
  // is only a status move.
  if (input.returnToOwner && resolved.case.status === "escalated") {
    await transitionCase({
      caseId: resolved.caseId,
      expectedVersion: resolved.case.version,
      nextStatus: "in_progress",
      actor: input.actor,
      reason: "escalation_resolved",
    });
  }

  return { id: resolved.id, caseId: resolved.caseId };
}

export async function listEscalations(caseId: string) {
  const rows = await prisma.learnerOpsEscalation.findMany({
    where: { caseId },
    orderBy: [{ raisedAt: "desc" }],
    select: {
      id: true,
      class: true,
      reason: true,
      raisedAt: true,
      resolvedAt: true,
      resolution: true,
      returnedToOwnerAt: true,
      raisedByStaff: { select: { displayName: true } },
      resolvedByStaff: { select: { displayName: true } },
      targetQueue: { select: { key: true, name: true } },
      targetStaff: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    class: row.class,
    reason: row.reason,
    raisedAt: row.raisedAt.toISOString(),
    raisedBy: row.raisedByStaff.displayName,
    targetQueue: row.targetQueue ? { key: row.targetQueue.key, name: row.targetQueue.name } : null,
    targetStaff: row.targetStaff?.displayName ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedByStaff?.displayName ?? null,
    resolution: row.resolution,
    returnedToOwnerAt: row.returnedToOwnerAt?.toISOString() ?? null,
  }));
}
