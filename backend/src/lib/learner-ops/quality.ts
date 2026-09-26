/**
 * LEARNER-OPERATIONS-V1 — QA, knowledge and VOC.
 *
 * Three small capabilities that share one property: they OBSERVE completed work
 * and never alter it.
 *
 * QA writes only to `LearnerOpsQaReview`. It cannot edit a message, delete a
 * note, change a status or reopen a case, so historical learner communication
 * stays exactly as it was sent — which is the only thing that makes it usable
 * as evidence later.
 *
 * KNOWLEDGE is staff-visible reference text. It is explicitly NOT an authority:
 * an article can describe what the product does and can never decide what a
 * learner's progression is. Nothing reads it to make a decision.
 *
 * VOC turns recurring friction into structured product evidence. Frequency is
 * DERIVED from the case links and never stored, so a signal's claimed weight
 * cannot drift from the cases that justify it. It is deliberately not an issue
 * tracker: there is no assignee workflow, no sprint, no state machine beyond
 * the five statuses, and the outward reference is a free-text string because
 * the product's issue tracker is not this system's business.
 */
import type {
  LearnerOpsKnowledgeStatus,
  LearnerOpsQaResult,
  LearnerOpsVocSeverity,
  LearnerOpsVocStatus,
  Prisma,
} from "@prisma/client";
import { LEARNER_OPS_AUDIT_ACTIONS } from "@/lib/learner-ops/contract";
import { learnerOpsFail } from "@/lib/learner-ops/errors";
import { prisma } from "@/lib/prisma";
import type { StaffActor } from "@/lib/learner-ops/case";

/* ------------------------------------------------------------------- QA */

/**
 * Record a quality review of a case.
 *
 * ONLY COMPLETED WORK MAY BE REVIEWED. Judging a case that is still open would
 * be judging a decision nobody has made yet, and it would let QA become a way
 * to pressure an in-flight case. The refusal is explicit rather than implicit.
 *
 * A case may be reviewed more than once — by a second reviewer, or later by the
 * same one. Each review is its own immutable row, and none supersedes another:
 * the history of what QA thought is itself operational evidence.
 */
export async function recordQaReview(input: {
  caseId: string;
  result: LearnerOpsQaResult;
  feedback?: string;
  coachingRequired: boolean;
  dimensions?: Record<string, string>;
  actor: StaffActor;
}) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.learnerOpsCase.findUnique({
      where: { id: input.caseId },
      select: { id: true, status: true, version: true },
    });
    if (!target) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");
    if (target.status !== "resolved" && target.status !== "closed") {
      learnerOpsFail(
        "LEARNER_OPS_QA_TARGET_NOT_COMPLETE",
        "only a resolved or closed case can be quality-reviewed",
      );
    }

    const review = await tx.learnerOpsQaReview.create({
      data: {
        caseId: input.caseId,
        reviewerStaffId: input.actor.staffId,
        result: input.result,
        coachingRequired: input.coachingRequired,
        ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
        ...(input.dimensions !== undefined
          ? { dimensions: input.dimensions as Prisma.InputJsonValue }
          : {}),
      },
      select: { id: true, createdAt: true },
    });

    // The case timeline records THAT a QA review happened. It does not record
    // the result, because the case row is operational state and the verdict
    // belongs to the QA record — copying it here would create a second answer.
    const nextVersion = target.version + 1;
    await tx.learnerOpsCase.update({
      where: { id: input.caseId },
      data: { version: nextVersion },
    });
    await tx.learnerOpsCaseEvent.create({
      data: {
        caseId: input.caseId,
        caseVersion: nextVersion,
        eventType: "qa_reviewed",
        actorStaffId: input.actor.staffId,
        metadata: { qaReviewId: review.id },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.actor.userId,
        action: LEARNER_OPS_AUDIT_ACTIONS.qaRecorded,
        entityType: "LearnerOpsQaReview",
        entityId: review.id,
        metadata: { caseId: input.caseId, result: input.result, coachingRequired: input.coachingRequired },
      },
    });

    return review;
  });
}

export async function listQaReviews(input: { caseId?: string; limit: number; cursor?: string }) {
  const rows = await prisma.learnerOpsQaReview.findMany({
    where: input.caseId ? { caseId: input.caseId } : {},
    select: {
      id: true,
      caseId: true,
      result: true,
      feedback: true,
      coachingRequired: true,
      dimensions: true,
      createdAt: true,
      reviewerStaff: { select: { displayName: true } },
      case: { select: { reference: true, type: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      caseReference: row.case.reference,
      caseType: row.case.type,
      result: row.result,
      feedback: row.feedback,
      coachingRequired: row.coachingRequired,
      dimensions: row.dimensions,
      reviewer: row.reviewerStaff.displayName,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/* ------------------------------------------------------------- knowledge */

export async function listKnowledge(input: {
  status?: LearnerOpsKnowledgeStatus;
  search?: string;
  limit: number;
  cursor?: string;
}) {
  const rows = await prisma.learnerOpsKnowledgeArticle.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      // SQLite `contains` is a LIKE with the term escaped by Prisma. The term
      // is length-bounded at the schema layer, so this cannot become a scan of
      // arbitrary size.
      ...(input.search ? { title: { contains: input.search } } : {}),
    },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      version: true,
      updatedAt: true,
      ownerStaff: { select: { displayName: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      version: row.version,
      owner: row.ownerStaff.displayName,
      updatedAt: row.updatedAt.toISOString(),
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getKnowledgeArticle(slug: string) {
  const row = await prisma.learnerOpsKnowledgeArticle.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      body: true,
      status: true,
      version: true,
      updatedAt: true,
      ownerStaff: { select: { displayName: true } },
    },
  });
  if (!row) learnerOpsFail("LEARNER_OPS_KNOWLEDGE_NOT_FOUND");
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    status: row.status,
    version: row.version,
    owner: row.ownerStaff.displayName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createKnowledgeArticle(input: {
  slug: string;
  title: string;
  body: string;
  status: LearnerOpsKnowledgeStatus;
  actor: StaffActor;
}) {
  const existing = await prisma.learnerOpsKnowledgeArticle.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (existing) learnerOpsFail("LEARNER_OPS_DUPLICATE", "an article with this slug already exists");

  return prisma.$transaction(async (tx) => {
    const created = await tx.learnerOpsKnowledgeArticle.create({
      data: {
        slug: input.slug,
        title: input.title,
        body: input.body,
        status: input.status,
        ownerStaffId: input.actor.staffId,
      },
      select: { id: true, slug: true, version: true },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actor.userId,
        action: LEARNER_OPS_AUDIT_ACTIONS.knowledgeChanged,
        entityType: "LearnerOpsKnowledgeArticle",
        entityId: created.id,
        metadata: { slug: created.slug, operation: "create", status: input.status },
      },
    });
    return created;
  });
}

/** Optimistic update. `version` increments on every accepted edit. */
export async function updateKnowledgeArticle(input: {
  slug: string;
  expectedVersion: number;
  title?: string;
  body?: string;
  status?: LearnerOpsKnowledgeStatus;
  actor: StaffActor;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.learnerOpsKnowledgeArticle.findUnique({
      where: { slug: input.slug },
      select: { id: true, version: true },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_KNOWLEDGE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      learnerOpsFail("LEARNER_OPS_VERSION_CONFLICT", `article is at version ${current.version}`);
    }

    const updated = await tx.learnerOpsKnowledgeArticle.updateMany({
      where: { id: current.id, version: input.expectedVersion },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        version: current.version + 1,
      },
    });
    if (updated.count !== 1) {
      learnerOpsFail("LEARNER_OPS_VERSION_CONFLICT", "the article changed while this request was in flight");
    }

    await tx.auditLog.create({
      data: {
        userId: input.actor.userId,
        action: LEARNER_OPS_AUDIT_ACTIONS.knowledgeChanged,
        entityType: "LearnerOpsKnowledgeArticle",
        entityId: current.id,
        metadata: { slug: input.slug, operation: "update", status: input.status ?? null },
      },
    });

    return { id: current.id, version: current.version + 1 };
  });
}

/* -------------------------------------------------------------------- VOC */

export async function createVocSignal(input: {
  theme: string;
  category: string;
  severity: LearnerOpsVocSeverity;
  actor: StaffActor;
}) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.learnerOpsVocSignal.create({
      data: {
        theme: input.theme,
        category: input.category,
        severity: input.severity,
        createdByStaffId: input.actor.staffId,
      },
      select: { id: true, theme: true },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actor.userId,
        action: LEARNER_OPS_AUDIT_ACTIONS.vocChanged,
        entityType: "LearnerOpsVocSignal",
        entityId: created.id,
        metadata: { operation: "create", category: input.category, severity: input.severity },
      },
    });
    return created;
  });
}

export async function updateVocSignal(input: {
  signalId: string;
  status?: LearnerOpsVocStatus;
  severity?: LearnerOpsVocSeverity;
  ownerStaffId?: string | null;
  resolutionReference?: string;
  resolutionNote?: string;
  actor: StaffActor;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.learnerOpsVocSignal.findUnique({
      where: { id: input.signalId },
      select: { id: true, status: true },
    });
    if (!current) learnerOpsFail("LEARNER_OPS_VOC_NOT_FOUND");

    if (input.ownerStaffId != null) {
      const owner = await tx.staffProfile.findUnique({
        where: { id: input.ownerStaffId },
        select: { id: true },
      });
      if (!owner) learnerOpsFail("LEARNER_OPS_STAFF_NOT_FOUND");
    }

    const terminal = input.status === "resolved" || input.status === "rejected";
    const updated = await tx.learnerOpsVocSignal.update({
      where: { id: input.signalId },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.ownerStaffId !== undefined ? { ownerStaffId: input.ownerStaffId } : {}),
        ...(input.resolutionReference !== undefined
          ? { resolutionReference: input.resolutionReference }
          : {}),
        ...(input.resolutionNote !== undefined ? { resolutionNote: input.resolutionNote } : {}),
        // The CHECK constraint requires resolvedAt to agree with the status, so
        // this is set and cleared here rather than left to the caller.
        ...(input.status !== undefined ? { resolvedAt: terminal ? new Date() : null } : {}),
      },
      select: { id: true, status: true },
    });

    await tx.auditLog.create({
      data: {
        userId: input.actor.userId,
        action: LEARNER_OPS_AUDIT_ACTIONS.vocChanged,
        entityType: "LearnerOpsVocSignal",
        entityId: input.signalId,
        metadata: { operation: "update", from: current.status, to: updated.status },
      },
    });

    return updated;
  });
}

/** Link a case as evidence. The unique index makes a double-link a no-op 409. */
export async function linkVocCase(input: { signalId: string; caseId: string; actor: StaffActor }) {
  const [signal, target] = await Promise.all([
    prisma.learnerOpsVocSignal.findUnique({ where: { id: input.signalId }, select: { id: true } }),
    prisma.learnerOpsCase.findUnique({ where: { id: input.caseId }, select: { id: true } }),
  ]);
  if (!signal) learnerOpsFail("LEARNER_OPS_VOC_NOT_FOUND");
  if (!target) learnerOpsFail("LEARNER_OPS_CASE_NOT_FOUND");

  const existing = await prisma.learnerOpsVocSignalCase.findUnique({
    where: { signalId_caseId: { signalId: input.signalId, caseId: input.caseId } },
    select: { id: true },
  });
  if (existing) learnerOpsFail("LEARNER_OPS_DUPLICATE", "this case is already linked to this signal");

  return prisma.learnerOpsVocSignalCase.create({
    data: { signalId: input.signalId, caseId: input.caseId, linkedByStaffId: input.actor.staffId },
    select: { id: true },
  });
}

export async function listVocSignals(input: {
  status?: LearnerOpsVocStatus;
  limit: number;
  cursor?: string;
}) {
  const rows = await prisma.learnerOpsVocSignal.findMany({
    where: input.status ? { status: input.status } : {},
    select: {
      id: true,
      theme: true,
      category: true,
      severity: true,
      status: true,
      resolutionReference: true,
      resolutionNote: true,
      createdAt: true,
      updatedAt: true,
      ownerStaff: { select: { displayName: true } },
      createdByStaff: { select: { displayName: true } },
      // Frequency is DERIVED here and stored nowhere.
      _count: { select: { cases: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id,
      theme: row.theme,
      category: row.category,
      severity: row.severity,
      status: row.status,
      evidenceCount: row._count.cases,
      owner: row.ownerStaff?.displayName ?? null,
      createdBy: row.createdByStaff.displayName,
      resolutionReference: row.resolutionReference,
      resolutionNote: row.resolutionNote,
      updatedAt: row.updatedAt.toISOString(),
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
