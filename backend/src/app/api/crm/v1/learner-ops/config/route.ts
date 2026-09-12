/**
 * The operational configuration an operator's UI needs: queues, reason codes,
 * SLA policies and the assignable staff directory.
 *
 * SLA POLICIES CARRY THEIR PROVENANCE. Every row returns `origin`, and the CRM
 * renders "PREPROD fixture" beside any target stamped
 * `preprod_acceptance_fixture`. The product owner has supplied no business SLA
 * durations, and a fixture displayed as policy would be an invented business
 * rule.
 *
 * THE STAFF DIRECTORY IS FILTERED BY CAPABILITY, not by role name: it lists the
 * staff who actually hold `learner_ops_handle`, resolved through the one
 * permission resolver. Offering an assignee who cannot act on the case would be
 * an assignment that silently does nothing.
 */
import { learnerOpsData, learnerOpsErrorResponse, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { canHandleLearnerOps, resolveEffectivePermissions } from "@/lib/crm/roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    await requireLearnerOpsStaff(["learner_ops_view"]);

    const [queues, reasonCodes, slaPolicies, staff] = await Promise.all([
      prisma.learnerOpsQueue.findMany({
        where: { isActive: true },
        select: { key: true, name: true, description: true },
        orderBy: { key: "asc" },
      }),
      prisma.learnerOpsReasonCode.findMany({
        where: { isActive: true },
        select: { code: true, category: true, label: true },
        orderBy: [{ category: "asc" }, { code: "asc" }],
      }),
      prisma.learnerOpsSlaPolicy.findMany({
        where: { isActive: true },
        select: {
          key: true,
          name: true,
          priority: true,
          firstResponseTargetMinutes: true,
          resolutionTargetMinutes: true,
          pausesOnWaitingLearner: true,
          pausesOnWaitingInternal: true,
          pausesOnWaitingExternal: true,
          origin: true,
        },
        orderBy: { priority: "asc" },
      }),
      prisma.staffProfile.findMany({
        select: { id: true, displayName: true, staffRole: true },
        orderBy: { displayName: "asc" },
      }),
    ]);

    return learnerOpsData({
      queues,
      reasonCodes,
      slaPolicies,
      assignableStaff: staff
        .filter((row) => canHandleLearnerOps(resolveEffectivePermissions(row.staffRole)))
        .map((row) => ({ staffId: row.id, displayName: row.displayName, role: row.staffRole })),
    });
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops config GET");
  }
}
