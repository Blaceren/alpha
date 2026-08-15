/**
 * One of the learner's own cases, with its learner-visible thread.
 *
 * `userId` is in the WHERE clause, so naming somebody else's case id returns
 * the same 404 a nonexistent one does — the route is not an existence oracle.
 */
import {
  isLearnerGateFailure,
  learnerOpsData,
  learnerOpsErrorResponse,
  requireLearnerOpsLearner,
} from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const gate = await requireLearnerOpsLearner(request, { mutation: false });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    const { caseId } = await params;
    const row = await prisma.learnerOpsCase.findFirst({
      // BOTH predicates, always. Ownership is part of the lookup, never a
      // check performed afterwards on a row already fetched.
      where: { id: caseId, userId: gate.userId },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        subject: true,
        details: true,
        openedAt: true,
        lastActivityAt: true,
        resolvedAt: true,
        // `notes` is NOT selected. It is not selectable here: this module does
        // not name that relation anywhere.
        messages: {
          select: {
            id: true,
            authorKind: true,
            body: true,
            createdAt: true,
            authorStaff: { select: { displayName: true } },
          },
          orderBy: [{ createdAt: "asc" }],
          take: 200,
        },
      },
    });
    if (!row) throw new LearnerOpsError("LEARNER_OPS_CASE_NOT_FOUND");

    return learnerOpsData({
      id: row.id,
      reference: row.reference,
      type: row.type,
      status: row.status,
      subject: row.subject,
      details: row.details,
      openedAt: row.openedAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      messages: row.messages.map((message) => ({
        id: message.id,
        authorKind: message.authorKind,
        // Staff are shown by display name — never by email, never by user id.
        authorName: message.authorKind === "staff" ? (message.authorStaff?.displayName ?? "Поддержка") : "Вы",
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner support case GET");
  }
}
