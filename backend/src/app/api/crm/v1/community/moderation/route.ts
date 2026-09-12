/**
 * The Community moderation surface — STAFF ONLY.
 *
 * It lives under `/api/crm/v1/**`, which the Academy's proxy allow-list does not
 * and cannot forward. A learner origin has no route to this path, so a learner
 * cannot reach it even by guessing: the Academy answers its own 404 without
 * contacting the Backend at all.
 *
 * AUTHORITY. `community_moderate`, asserted by `requireCommunityModerator`
 * against the CRM session. Not `User.role`, not an email allow-list, not a
 * hardcoded id.
 *
 * WHAT THIS RETURNS THAT LEARNER ROUTES DO NOT: the reporter's identity, the
 * report reason and note, the removal reason, and removed bodies. All four are
 * moderation metadata. None of them appears in any learner-facing projection,
 * and the isolation is structural — the learner service module never selects
 * these fields.
 */
import {
  communityData,
  communityErrorResponse,
  parseJsonBody,
  requireCommunityModerator,
  validateId,
} from "@/lib/community/http";
import { CommunityError } from "@/lib/community/errors";
import { removeContent, resolveReport, restoreContent } from "@/lib/community/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QUEUE_LIMIT = 50;

export async function GET() {
  try {
    await requireCommunityModerator();

    const [reports, recentDiscussions, recentReplies, actions] = await Promise.all([
      prisma.communityContentReport.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        take: QUEUE_LIMIT,
        select: {
          id: true,
          reason: true,
          note: true,
          createdAt: true,
          reporter: { select: { id: true, name: true } },
          discussion: {
            select: {
              id: true,
              title: true,
              body: true,
              status: true,
              author: { select: { id: true, name: true } },
              space: { select: { code: true, title: true } },
            },
          },
          reply: {
            select: {
              id: true,
              body: true,
              status: true,
              author: { select: { id: true, name: true } },
              discussion: { select: { id: true, title: true, space: { select: { code: true, title: true } } } },
            },
          },
        },
      }),
      prisma.communityDiscussion.findMany({
        orderBy: { createdAt: "desc" },
        take: QUEUE_LIMIT,
        select: {
          id: true,
          title: true,
          body: true,
          status: true,
          createdAt: true,
          author: { select: { id: true, name: true } },
          space: { select: { code: true, title: true } },
        },
      }),
      prisma.communityReply.findMany({
        orderBy: { createdAt: "desc" },
        take: QUEUE_LIMIT,
        select: {
          id: true,
          body: true,
          status: true,
          createdAt: true,
          author: { select: { id: true, name: true } },
          discussion: { select: { id: true, title: true, space: { select: { code: true } } } },
        },
      }),
      prisma.communityModerationAction.findMany({
        orderBy: { createdAt: "desc" },
        take: QUEUE_LIMIT,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          reason: true,
          createdAt: true,
          staff: { select: { displayName: true } },
        },
      }),
    ]);

    return communityData({ reports, recentDiscussions, recentReplies, actions });
  } catch (error) {
    return communityErrorResponse(error, "moderation-read");
  }
}

export async function POST(request: Request) {
  let gate;
  try {
    gate = await requireCommunityModerator();
  } catch (error) {
    return communityErrorResponse(error, "moderation-gate");
  }

  try {
    const body = await parseJsonBody(request);
    const action = typeof body.action === "string" ? body.action : null;
    const reason =
      typeof body.reason === "string" && body.reason.trim() !== "" ? body.reason.trim().slice(0, 500) : null;

    switch (action) {
      case "discussion.remove":
        await removeContent({
          target: { kind: "discussion", id: validateId(String(body.id), "COMMUNITY_DISCUSSION_NOT_FOUND") },
          actor: { kind: "staff", staffId: gate.staffId, userId: gate.userId },
          reason,
        });
        break;
      case "discussion.restore":
        await restoreContent({
          target: { kind: "discussion", id: validateId(String(body.id), "COMMUNITY_DISCUSSION_NOT_FOUND") },
          staffId: gate.staffId,
        });
        break;
      case "reply.remove":
        await removeContent({
          target: { kind: "reply", id: validateId(String(body.id), "COMMUNITY_REPLY_NOT_FOUND") },
          actor: { kind: "staff", staffId: gate.staffId, userId: gate.userId },
          reason,
        });
        break;
      case "reply.restore":
        await restoreContent({
          target: { kind: "reply", id: validateId(String(body.id), "COMMUNITY_REPLY_NOT_FOUND") },
          staffId: gate.staffId,
        });
        break;
      case "report.actioned":
      case "report.dismissed":
        await resolveReport({
          reportId: validateId(String(body.id), "COMMUNITY_DISCUSSION_NOT_FOUND"),
          staffId: gate.staffId,
          outcome: action === "report.actioned" ? "actioned" : "dismissed",
        });
        break;
      default:
        throw new CommunityError("COMMUNITY_VALIDATION", "unknown_action");
    }

    return communityData({ ok: true });
  } catch (error) {
    return communityErrorResponse(error, "moderation-action");
  }
}
