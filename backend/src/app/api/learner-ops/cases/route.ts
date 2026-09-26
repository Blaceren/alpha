/**
 * THE LEARNER'S OWN SUPPORT SURFACE.
 *
 * WHAT THIS ROUTE CANNOT DO, BY CONSTRUCTION.
 *
 * It cannot read another learner's case: `userId` comes from the session and
 * appears in every WHERE clause. There is no query parameter that names a
 * learner, so there is nothing to tamper with.
 *
 * It cannot read an internal note. This module does not import
 * `LearnerOpsNote`, does not select it, and has no join that could reach it.
 * The projection returned here is built from `LearnerOpsMessage` alone.
 *
 * It cannot choose a queue, a priority, a reason code or a type. A learner
 * describes a problem; classification and routing are operational decisions
 * made by staff. The learner create schema has exactly two fields.
 */
import {
  isLearnerGateFailure,
  learnerOpsData,
  learnerOpsErrorResponse,
  parseJsonBody,
  requireLearnerOpsLearner,
} from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { createCase } from "@/lib/learner-ops/case";
import { learnerOpsCaseLevel } from "@/lib/learner-ops/learner-projection";
import { learnerCreateCaseSchema } from "@/lib/learner-ops/schemas";
import { LEARNER_OPS_ACTIVE_STATUSES } from "@/lib/learner-ops/contract";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** How many open support requests one learner may hold at once. */
const MAX_OPEN_LEARNER_CASES = 5;

export async function GET(request: Request) {
  const gate = await requireLearnerOpsLearner(request, { mutation: false });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    const rows = await prisma.learnerOpsCase.findMany({
      where: { userId: gate.userId },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        subject: true,
        openedAt: true,
        lastActivityAt: true,
        resolvedAt: true,
        // THE CANONICAL ANCHOR, PROJECTED AS A COORDINATE — never as an id.
        //
        // A `mentor_review` case names the learner's own progress row and a
        // `report_review` case names their own report; both resolve to one
        // level of the programme they are enrolled on. Without the coordinate a
        // client holding this list can tell that SOME review has a reply but
        // not WHICH level it belongs to, and the only remaining way to find out
        // would be to parse the subject prose. So the level is projected here.
        //
        // Nothing new is disclosed. The learner already sees every one of these
        // fields on the level itself, and the subject line beside them already
        // names the level in words. What is deliberately NOT projected is the
        // anchor's identity: no `userLevelProgressId`, no `reportSubmissionId`,
        // no status of the canonical object — a progression verdict must be
        // read from the progression owner, never inferred from an operational
        // mirror of it.
        userLevelProgress: {
          select: { levelDefinition: { select: { levelNumber: true, stableCode: true, title: true } } },
        },
        reportSubmission: {
          select: { levelDefinition: { select: { levelNumber: true, stableCode: true, title: true } } },
        },
      },
      orderBy: [{ lastActivityAt: "desc" }],
      take: 50,
    });

    return learnerOpsData({
      items: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        type: row.type,
        // The learner sees the operational status vocabulary directly. It is
        // deliberately NOT mapped onto progression words: "waiting_learner" is
        // an operational fact about a conversation, and dressing it in
        // educational language would blur two different authorities.
        status: row.status,
        subject: row.subject,
        openedAt: row.openedAt.toISOString(),
        lastActivityAt: row.lastActivityAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        level: learnerOpsCaseLevel(row),
      })),
    });
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner support cases GET");
  }
}

export async function POST(request: Request) {
  const gate = await requireLearnerOpsLearner(request, { mutation: true });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    const parsed = learnerCreateCaseSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");

    // A bounded number of open requests per learner. This is a flood control,
    // not a product rule about how much help somebody may ask for — a learner
    // whose requests are being answered never meets it.
    const open = await prisma.learnerOpsCase.count({
      where: { userId: gate.userId, status: { in: [...LEARNER_OPS_ACTIVE_STATUSES] } },
    });
    if (open >= MAX_OPEN_LEARNER_CASES) {
      throw new LearnerOpsError(
        "LEARNER_OPS_DUPLICATE",
        "у вас уже есть открытые обращения — дождитесь ответа",
      );
    }

    const created = await createCase({
      userId: gate.userId,
      type: "support_request",
      queueKey: "support",
      subject: parsed.data.subject,
      details: parsed.data.details,
      // No actor: the learner is not a staff actor and never appears in a staff
      // attribution column.
      actor: null,
    });

    return learnerOpsData({ id: created.id, reference: created.reference }, 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner support cases POST");
  }
}
