/**
 * LEARNER-OPERATIONS-V1 — operational analytics.
 *
 * EVERY NUMBER HERE IS A COUNT OR A DURATION OVER FACTS THIS DOMAIN OWNS.
 * There is no forecast, no trend extrapolation, no churn probability and no
 * "customer health score", because no authority for any of those exists. A
 * number with nothing behind it is worse than no number: it looks like
 * knowledge and gets decided on.
 *
 * RETENTION AND RECOVERY ARE LABELLED OBSERVATIONAL. The reopen rate and the
 * service-recovery counts describe what HAPPENED. They are not evidence that
 * operations caused a retention outcome, because nothing here establishes
 * causation, and the response says so in a field the CRM renders rather than
 * leaving the caller to assume.
 *
 * SLA STATE IS DERIVED AT READ TIME, exactly as it is everywhere else in this
 * domain. The breach counts below recompute from the clock rather than reading
 * a stored flag, so an aggregate can never disagree with the row an operator
 * opens from it.
 */
import { LEARNER_OPS_ACTIVE_STATUSES } from "@/lib/learner-ops/contract";
import { computeSlaView } from "@/lib/learner-ops/sla";
import { prisma } from "@/lib/prisma";

/** Bound on how many live rows the derived-SLA pass will walk. */
const SLA_SCAN_CAP = 2_000;

export type LearnerOpsAnalytics = Awaited<ReturnType<typeof getAnalytics>>;

export async function getAnalytics() {
  const now = new Date();

  const [byStatus, byType, byPriority, byQueue, byOwner, escalations, qa, voc] = await Promise.all([
    prisma.learnerOpsCase.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.learnerOpsCase.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.learnerOpsCase.groupBy({
      by: ["priority"],
      where: { status: { in: [...LEARNER_OPS_ACTIVE_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.learnerOpsCase.groupBy({
      by: ["queueId"],
      where: { status: { in: [...LEARNER_OPS_ACTIVE_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.learnerOpsCase.groupBy({
      by: ["assignedStaffId"],
      where: { status: { in: [...LEARNER_OPS_ACTIVE_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.learnerOpsEscalation.groupBy({ by: ["class"], _count: { _all: true } }),
    prisma.learnerOpsQaReview.groupBy({ by: ["result"], _count: { _all: true } }),
    prisma.learnerOpsVocSignal.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  // The live set, walked once to derive SLA state and age. Bounded, and the
  // response says whether the bound was reached rather than silently truncating.
  const live = await prisma.learnerOpsCase.findMany({
    where: { status: { in: [...LEARNER_OPS_ACTIVE_STATUSES] } },
    select: {
      id: true,
      type: true,
      openedAt: true,
      status: true,
      pausedMs: true,
      clockPausedAt: true,
      firstResponseDueAt: true,
      resolutionDueAt: true,
      firstRespondedAt: true,
      resolvedAt: true,
      assignedStaffId: true,
      slaPolicy: {
        select: {
          key: true,
          priority: true,
          firstResponseTargetMinutes: true,
          resolutionTargetMinutes: true,
          pausesOnWaitingLearner: true,
          pausesOnWaitingInternal: true,
          pausesOnWaitingExternal: true,
          origin: true,
        },
      },
    },
    orderBy: [{ openedAt: "asc" }],
    take: SLA_SCAN_CAP,
  });

  let firstResponseBreached = 0;
  let resolutionBreached = 0;
  let awaitingFirstResponse = 0;
  let ageSumMs = 0;
  let oldestMs = 0;

  for (const row of live) {
    const sla = computeSlaView(row, row.slaPolicy, now);
    if (sla.firstResponse.state === "breached") firstResponseBreached += 1;
    if (sla.resolution.state === "breached") resolutionBreached += 1;
    if (row.firstRespondedAt === null) awaitingFirstResponse += 1;
    const age = now.getTime() - row.openedAt.getTime();
    ageSumMs += age;
    if (age > oldestMs) oldestMs = age;
  }

  const queues = await prisma.learnerOpsQueue.findMany({ select: { id: true, key: true, name: true } });
  const queueByKey = new Map(queues.map((q) => [q.id, q]));

  const owners = await prisma.staffProfile.findMany({
    where: { id: { in: byOwner.map((row) => row.assignedStaffId).filter((v): v is string => v !== null) } },
    select: { id: true, displayName: true },
  });
  const ownerById = new Map(owners.map((o) => [o.id, o.displayName]));

  // Resolution timing over CLOSED work. Reopened cases are included with their
  // most recent resolution instant, which is the honest reading of "how long
  // did it take to resolve" for a case that came back.
  const resolvedRows = await prisma.learnerOpsCase.findMany({
    where: { resolvedAt: { not: null } },
    select: { openedAt: true, resolvedAt: true, pausedMs: true },
    orderBy: [{ resolvedAt: "desc" }],
    take: SLA_SCAN_CAP,
  });
  const resolutionDurations = resolvedRows
    .map((row) =>
      row.resolvedAt ? Math.max(0, row.resolvedAt.getTime() - row.openedAt.getTime() - row.pausedMs) : 0,
    )
    .sort((a, b) => a - b);

  const reopened = await prisma.learnerOpsCase.count({ where: { reopenCount: { gt: 0 } } });
  const total = await prisma.learnerOpsCase.count();
  const unassigned = await prisma.learnerOpsCase.count({
    where: { status: { in: [...LEARNER_OPS_ACTIVE_STATUSES] }, assignedStaffId: null },
  });

  const taxonomy = await prisma.learnerOpsCase.groupBy({
    by: ["reasonCodeId"],
    _count: { _all: true },
  });
  const reasonCodes = await prisma.learnerOpsReasonCode.findMany({
    select: { id: true, code: true, label: true, category: true },
  });
  const reasonById = new Map(reasonCodes.map((r) => [r.id, r]));

  return {
    generatedAt: now.toISOString(),
    /**
     * The bound was reached, so the derived figures describe the oldest
     * SLA_SCAN_CAP live cases rather than all of them. Said plainly rather than
     * presenting a truncated number as a total.
     */
    truncated: live.length >= SLA_SCAN_CAP,
    backlog: {
      total,
      open: live.length,
      unassigned,
      awaitingFirstResponse,
      averageAgeMs: live.length > 0 ? Math.round(ageSumMs / live.length) : 0,
      oldestAgeMs: oldestMs,
    },
    sla: {
      firstResponseBreached,
      resolutionBreached,
      medianResolutionMs:
        resolutionDurations.length > 0
          ? resolutionDurations[Math.floor(resolutionDurations.length / 2)] ?? 0
          : null,
      resolvedSampleSize: resolutionDurations.length,
    },
    byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
    byType: byType.map((row) => ({ type: row.type, count: row._count._all })),
    byPriority: byPriority.map((row) => ({ priority: row.priority, count: row._count._all })),
    byQueue: byQueue.map((row) => ({
      queueKey: queueByKey.get(row.queueId)?.key ?? "—",
      queueName: queueByKey.get(row.queueId)?.name ?? "—",
      count: row._count._all,
    })),
    byOwner: byOwner.map((row) => ({
      staffId: row.assignedStaffId,
      displayName: row.assignedStaffId ? (ownerById.get(row.assignedStaffId) ?? "—") : null,
      count: row._count._all,
    })),
    taxonomy: taxonomy
      .map((row) => ({
        code: row.reasonCodeId ? (reasonById.get(row.reasonCodeId)?.code ?? "—") : "unclassified",
        label: row.reasonCodeId ? (reasonById.get(row.reasonCodeId)?.label ?? "—") : "Без классификации",
        category: row.reasonCodeId ? (reasonById.get(row.reasonCodeId)?.category ?? "—") : "unclassified",
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    escalations: escalations.map((row) => ({ class: row.class, count: row._count._all })),
    qa: {
      byResult: qa.map((row) => ({ result: row.result, count: row._count._all })),
      // Coverage over work that is eligible for QA, which is completed work
      // only — measuring against all cases would understate it by counting work
      // nobody could have reviewed yet.
      reviewedCases: await prisma.learnerOpsCase.count({ where: { qaReviews: { some: {} } } }),
      completedCases: await prisma.learnerOpsCase.count({
        where: { status: { in: ["resolved", "closed"] } },
      }),
    },
    voc: voc.map((row) => ({ status: row.status, count: row._count._all })),
    /**
     * OBSERVATIONAL, NOT PREDICTIVE — and labelled so in the payload because the
     * CRM renders this label beside the figures. A reopen rate says how often
     * work came back. It does not say why, and nothing here claims it predicts
     * retention or that operations caused any retention outcome.
     */
    observational: {
      classification: "observational" as const,
      note: "Наблюдаемые факты, не прогноз. Причинно-следственная связь не доказана.",
      reopenedCases: reopened,
      reopenRate: total > 0 ? reopened / total : 0,
      complaints: byType.find((row) => row.type === "complaint")?._count._all ?? 0,
      serviceRecovery: byType.find((row) => row.type === "service_recovery")?._count._all ?? 0,
    },
  };
}
