/**
 * COMMUNITY-V1 — the domain operations.
 *
 * ============================ WHAT THIS NEVER DOES ============================
 * There is no import of, and no call into, the progression owner. Nothing here
 * writes `UserLevelProgress`, `UserCurriculumEnrollment`, `XPTransaction`,
 * `XpEvent`, `User.level` or `User.xp`. Posting, replying, being replied to and
 * being moderated all leave a learner's position on the path exactly where they
 * found it. Community is not progression authority, and the way that is
 * guaranteed is that this module cannot express it.
 *
 * It also never touches Pocket, affiliate, checkpoint or Learner Operations
 * records, and never reads `LearnerOpsNote`. Community and the internal
 * operational record share a database and nothing else.
 *
 * ============================== ORDERING ==============================
 * Discussions are ordered by `lastActivityAt` descending — "where the
 * conversation is" — and never by a trending formula, a score, or any learner
 * attribute. There is no vanity metric to rank by, because none is stored.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { rateLimit } from "@/lib/rateLimit";
import { CommunityError } from "./errors";
import {
  BODY_MAX,
  REPLY_MAX,
  toCommunityAuthor,
  toCommunityBody,
  toRemovedAuthor,
  type CommunityAuthor,
  type CommunityBody,
  type ReportReason,
  validateBody,
  validateReportNote,
  validateReportReason,
  validateTitle,
} from "./content";

type Db = PrismaClient | Prisma.TransactionClient;

/** How many discussions one space list returns. Deliberately not paginated in V1. */
export const SPACE_PAGE_SIZE = 30;
/** How many replies one thread returns. */
export const THREAD_REPLY_LIMIT = 200;

/**
 * The window in which an identical body from the same author to the same target
 * is treated as the SAME submission rather than a second one.
 *
 * This is what makes a double-tapped "Опубликовать", a retried request after a
 * flaky connection, and an impatient reload safe: the learner gets their
 * existing row back and a success, not a duplicate they then have to delete.
 * It is not an anti-abuse system — that is what the rate limit below is — it is
 * ordinary write hygiene.
 */
const DUPLICATE_WINDOW_MS = 60_000;

const AUTHOR_SELECT = {
  id: true,
  name: true,
  staffProfile: { select: { staffRole: true } },
} as const;

export type CommunityDiscussionSummary = {
  readonly id: string;
  readonly title: string;
  readonly author: CommunityAuthor;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly replyCount: number;
  readonly isRemoved: boolean;
};

export type CommunityReplyView = {
  readonly id: string;
  readonly author: CommunityAuthor;
  readonly body: CommunityBody;
  readonly createdAt: string;
  readonly canRemove: boolean;
  readonly canReport: boolean;
};

export type CommunityThread = {
  readonly id: string;
  readonly spaceCode: string;
  readonly title: string;
  readonly author: CommunityAuthor;
  readonly body: CommunityBody;
  readonly createdAt: string;
  readonly canRemove: boolean;
  readonly canReport: boolean;
  readonly replies: readonly CommunityReplyView[];
};

type ViewerContext = {
  readonly viewerId: number;
  readonly viewerIsModerator: boolean;
  /** The viewer's own module, used only for their own author chip. */
  readonly viewerModuleNumber: number | null;
};

/**
 * Author module context, resolved for a PAGE of rows in one query.
 *
 * Why not per row: a space list of 30 discussions by 30 authors would be 30
 * enrollment reads. Why not skipped: "Модуль 3" beside a name is the difference
 * between a peer and a stranger, and it is the one piece of progress context
 * this product is allowed to show.
 */
async function loadAuthorModules(
  db: Db,
  authorIds: readonly number[],
): Promise<Map<number, number | null>> {
  const unique = [...new Set(authorIds)];
  if (unique.length === 0) return new Map();

  const enrollments = await db.userCurriculumEnrollment.findMany({
    where: { userId: { in: unique }, curriculumCode: "ata-v2", status: "active" },
    select: {
      userId: true,
      currentLevel: true,
      curriculumVersion: {
        select: {
          modules: { select: { moduleNumber: true, firstLevel: true, lastLevel: true } },
        },
      },
    },
  });

  const map = new Map<number, number | null>();
  for (const enrollment of enrollments) {
    const found = enrollment.curriculumVersion.modules.find(
      (m) => enrollment.currentLevel >= m.firstLevel && enrollment.currentLevel <= m.lastLevel,
    );
    map.set(enrollment.userId, found ? found.moduleNumber : null);
  }
  return map;
}

/* --------------------------------------------------------------- reading */

export async function listSpaceDiscussions(
  spaceId: number,
  viewer: ViewerContext,
  options: { readonly db?: Db } = {},
): Promise<readonly CommunityDiscussionSummary[]> {
  const db = options.db ?? defaultPrisma;

  const discussions = await db.communityDiscussion.findMany({
    where: { spaceId },
    orderBy: { lastActivityAt: "desc" },
    take: SPACE_PAGE_SIZE,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      lastActivityAt: true,
      author: { select: AUTHOR_SELECT },
      // The count is READ FROM THE ROWS, never from a stored counter, so the
      // number beside a discussion cannot disagree with the thread behind it.
      _count: { select: { replies: { where: { status: "visible" } } } },
    },
  });

  const modules = await loadAuthorModules(db, discussions.map((d) => d.author.id));

  return discussions.map((discussion) => ({
    id: discussion.id,
    // A removed discussion keeps its position in the list but not its words,
    // and not its author either.
    title: discussion.status === "visible" ? discussion.title : "Обсуждение удалено",
    author:
      discussion.status === "visible"
        ? toCommunityAuthor(discussion.author, {
            viewerId: viewer.viewerId,
            moduleNumber: modules.get(discussion.author.id) ?? null,
          })
        : toRemovedAuthor(discussion.author, viewer.viewerId),
    createdAt: discussion.createdAt.toISOString(),
    lastActivityAt: discussion.lastActivityAt.toISOString(),
    replyCount: discussion._count.replies,
    isRemoved: discussion.status !== "visible",
  }));
}

export async function getThread(
  discussionId: string,
  viewer: ViewerContext,
  options: { readonly db?: Db } = {},
): Promise<CommunityThread & { readonly spaceId: number }> {
  const db = options.db ?? defaultPrisma;

  const discussion = await db.communityDiscussion.findUnique({
    where: { id: discussionId },
    select: {
      id: true,
      spaceId: true,
      title: true,
      body: true,
      status: true,
      createdAt: true,
      author: { select: AUTHOR_SELECT },
      space: { select: { code: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        take: THREAD_REPLY_LIMIT,
        select: {
          id: true,
          body: true,
          status: true,
          createdAt: true,
          author: { select: AUTHOR_SELECT },
        },
      },
    },
  });

  if (!discussion) throw new CommunityError("COMMUNITY_DISCUSSION_NOT_FOUND");

  const authorIds = [discussion.author.id, ...discussion.replies.map((r) => r.author.id)];
  const modules = await loadAuthorModules(db, authorIds);

  const author = (source: (typeof discussion)["author"]) =>
    toCommunityAuthor(source, {
      viewerId: viewer.viewerId,
      moduleNumber: modules.get(source.id) ?? null,
    });

  const visible = discussion.status === "visible";

  return {
    id: discussion.id,
    spaceId: discussion.spaceId,
    spaceCode: discussion.space.code,
    title: visible ? discussion.title : "Обсуждение удалено",
    author: visible ? author(discussion.author) : toRemovedAuthor(discussion.author, viewer.viewerId),
    body: toCommunityBody(discussion),
    createdAt: discussion.createdAt.toISOString(),
    canRemove: visible && (viewer.viewerIsModerator || discussion.author.id === viewer.viewerId),
    canReport: visible && discussion.author.id !== viewer.viewerId,
    replies: discussion.replies.map((reply) => ({
      id: reply.id,
      author:
        reply.status === "visible"
          ? author(reply.author)
          : toRemovedAuthor(reply.author, viewer.viewerId),
      body: toCommunityBody(reply),
      createdAt: reply.createdAt.toISOString(),
      canRemove:
        reply.status === "visible" &&
        (viewer.viewerIsModerator || reply.author.id === viewer.viewerId),
      canReport: reply.status === "visible" && reply.author.id !== viewer.viewerId,
    })),
  };
}

/* --------------------------------------------------------------- writing */

function enforceRateLimit(key: string, limit: number, windowMs: number) {
  if (!rateLimit(key, { limit, windowMs }).allowed) {
    throw new CommunityError("COMMUNITY_RATE_LIMITED");
  }
}

export async function createDiscussion(input: {
  readonly spaceId: number;
  readonly authorId: number;
  readonly title: unknown;
  readonly body: unknown;
  readonly db?: Db;
}): Promise<{ readonly id: string; readonly deduplicated: boolean }> {
  const db = input.db ?? defaultPrisma;
  const title = validateTitle(input.title);
  const body = validateBody(input.body, BODY_MAX);

  // An identical submission inside the window is the SAME submission.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const existing = await db.communityDiscussion.findFirst({
    where: { spaceId: input.spaceId, authorId: input.authorId, title, body, createdAt: { gte: since } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, deduplicated: true };

  enforceRateLimit(`community:discussion:${input.authorId}`, 5, 10 * 60 * 1000);

  const created = await db.communityDiscussion.create({
    data: { spaceId: input.spaceId, authorId: input.authorId, title, body },
    select: { id: true },
  });
  return { id: created.id, deduplicated: false };
}

export async function createReply(input: {
  readonly discussionId: string;
  readonly authorId: number;
  readonly body: unknown;
  readonly db?: PrismaClient;
}): Promise<{ readonly id: string; readonly deduplicated: boolean }> {
  const db = input.db ?? defaultPrisma;
  const body = validateBody(input.body, REPLY_MAX);

  const discussion = await db.communityDiscussion.findUnique({
    where: { id: input.discussionId },
    select: { id: true, status: true, authorId: true, spaceId: true, title: true, space: { select: { code: true } } },
  });
  if (!discussion) throw new CommunityError("COMMUNITY_DISCUSSION_NOT_FOUND");
  // A removed discussion accepts no new replies. Allowing them would grow a
  // thread nobody can read.
  if (discussion.status !== "visible") throw new CommunityError("COMMUNITY_CONTENT_REMOVED");

  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const existing = await db.communityReply.findFirst({
    where: { discussionId: input.discussionId, authorId: input.authorId, body, createdAt: { gte: since } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, deduplicated: true };

  enforceRateLimit(`community:reply:${input.authorId}`, 15, 10 * 60 * 1000);

  // The reply and the activity stamp move together, so a list can never show a
  // thread as quiet while a reply sits inside it.
  const created = await db.$transaction(async (tx) => {
    const reply = await tx.communityReply.create({
      data: { discussionId: input.discussionId, authorId: input.authorId, body },
      select: { id: true },
    });
    await tx.communityDiscussion.update({
      where: { id: input.discussionId },
      data: { lastActivityAt: new Date() },
    });
    return reply;
  });

  // OUTSIDE the transaction, and never to oneself. A notification is not part
  // of the reply's atomicity: a failed notification must not roll back a
  // learner's answer.
  if (discussion.authorId !== input.authorId) {
    await createNotification({
      userId: discussion.authorId,
      type: "community_reply",
      title: "Новый ответ в вашем обсуждении",
      message: discussion.title,
      metadata: { spaceCode: discussion.space.code, discussionId: discussion.id },
    });
  }

  return { id: created.id, deduplicated: false };
}

/* ------------------------------------------------------------- reporting */

export async function reportContent(input: {
  readonly reporterId: number;
  readonly discussionId?: string;
  readonly replyId?: string;
  readonly reason: unknown;
  readonly note?: unknown;
  readonly db?: Db;
}): Promise<{ readonly id: string }> {
  const db = input.db ?? defaultPrisma;
  const reason: ReportReason = validateReportReason(input.reason);
  const note = validateReportNote(input.note);

  if ((input.discussionId ? 1 : 0) + (input.replyId ? 1 : 0) !== 1) {
    throw new CommunityError("COMMUNITY_VALIDATION", "target_required");
  }

  // Reporting one's own content is not a moderation signal, it is a mistake.
  if (input.discussionId) {
    const target = await db.communityDiscussion.findUnique({
      where: { id: input.discussionId },
      select: { authorId: true, status: true },
    });
    if (!target) throw new CommunityError("COMMUNITY_DISCUSSION_NOT_FOUND");
    if (target.status !== "visible") throw new CommunityError("COMMUNITY_CONTENT_REMOVED");
    if (target.authorId === input.reporterId) {
      throw new CommunityError("COMMUNITY_VALIDATION", "own_content");
    }
  } else {
    const target = await db.communityReply.findUnique({
      where: { id: input.replyId },
      select: { authorId: true, status: true },
    });
    if (!target) throw new CommunityError("COMMUNITY_REPLY_NOT_FOUND");
    if (target.status !== "visible") throw new CommunityError("COMMUNITY_CONTENT_REMOVED");
    if (target.authorId === input.reporterId) {
      throw new CommunityError("COMMUNITY_VALIDATION", "own_content");
    }
  }

  enforceRateLimit(`community:report:${input.reporterId}`, 10, 60 * 60 * 1000);

  const existing = await db.communityContentReport.findFirst({
    where: {
      reporterId: input.reporterId,
      discussionId: input.discussionId ?? null,
      replyId: input.replyId ?? null,
    },
    select: { id: true },
  });
  // Already reported reads as success to the reporter. Telling them "you
  // already reported this" is fine; making them wonder whether it registered is
  // not.
  if (existing) return { id: existing.id };

  const created = await db.communityContentReport.create({
    data: {
      reporterId: input.reporterId,
      discussionId: input.discussionId ?? null,
      replyId: input.replyId ?? null,
      reason,
      note,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/* ------------------------------------------------------------ moderation */

export type ModerationActor =
  | { readonly kind: "author"; readonly userId: number }
  | { readonly kind: "staff"; readonly staffId: string; readonly userId: number };

/**
 * Remove a discussion or a reply.
 *
 * AUTHORITY IS RESOLVED BEFORE THIS IS CALLED — the HTTP gate has already
 * asserted `community_moderate` for a staff actor. What this enforces is
 * OWNERSHIP: an `author` actor may only remove their own row, and the check is
 * a condition of the write rather than a branch around it.
 */
export async function removeContent(input: {
  readonly target: { readonly kind: "discussion"; readonly id: string } | { readonly kind: "reply"; readonly id: string };
  readonly actor: ModerationActor;
  readonly reason?: string | null;
  readonly db?: PrismaClient;
}): Promise<void> {
  const db = input.db ?? defaultPrisma;
  const staffId = input.actor.kind === "staff" ? input.actor.staffId : null;
  const status = staffId ? "removed_by_moderator" : "removed_by_author";

  if (input.target.kind === "discussion") {
    const row = await db.communityDiscussion.findUnique({
      where: { id: input.target.id },
      select: { id: true, authorId: true, status: true, title: true, space: { select: { code: true } } },
    });
    if (!row) throw new CommunityError("COMMUNITY_DISCUSSION_NOT_FOUND");
    if (!staffId && row.authorId !== input.actor.userId) {
      throw new CommunityError("COMMUNITY_FORBIDDEN");
    }
    if (row.status !== "visible") return;

    await db.communityDiscussion.update({
      where: { id: row.id },
      data: {
        status,
        removedAt: new Date(),
        removedByStaffId: staffId,
        removalReason: input.reason ?? null,
      },
    });

    if (staffId) {
      await recordModerationAction(db, staffId, "discussion.remove", "discussion", row.id, input.reason);
      await notifyRemoval(row.authorId, row.title, row.space.code, row.id);
    }
    return;
  }

  const row = await db.communityReply.findUnique({
    where: { id: input.target.id },
    select: {
      id: true,
      authorId: true,
      status: true,
      discussion: { select: { id: true, title: true, space: { select: { code: true } } } },
    },
  });
  if (!row) throw new CommunityError("COMMUNITY_REPLY_NOT_FOUND");
  if (!staffId && row.authorId !== input.actor.userId) {
    throw new CommunityError("COMMUNITY_FORBIDDEN");
  }
  if (row.status !== "visible") return;

  await db.communityReply.update({
    where: { id: row.id },
    data: {
      status,
      removedAt: new Date(),
      removedByStaffId: staffId,
      removalReason: input.reason ?? null,
    },
  });

  if (staffId) {
    await recordModerationAction(db, staffId, "reply.remove", "reply", row.id, input.reason);
    await notifyRemoval(row.authorId, row.discussion.title, row.discussion.space.code, row.discussion.id);
  }
}

/** Restore is staff-only: a learner's withdrawal is theirs to keep. */
export async function restoreContent(input: {
  readonly target: { readonly kind: "discussion"; readonly id: string } | { readonly kind: "reply"; readonly id: string };
  readonly staffId: string;
  readonly db?: PrismaClient;
}): Promise<void> {
  const db = input.db ?? defaultPrisma;
  const data = { status: "visible" as const, removedAt: null, removedByStaffId: null, removalReason: null };

  if (input.target.kind === "discussion") {
    const row = await db.communityDiscussion.findUnique({
      where: { id: input.target.id },
      select: { id: true, status: true },
    });
    if (!row) throw new CommunityError("COMMUNITY_DISCUSSION_NOT_FOUND");
    if (row.status === "visible") return;
    await db.communityDiscussion.update({ where: { id: row.id }, data });
    await recordModerationAction(db, input.staffId, "discussion.restore", "discussion", row.id, null);
    return;
  }

  const row = await db.communityReply.findUnique({
    where: { id: input.target.id },
    select: { id: true, status: true },
  });
  if (!row) throw new CommunityError("COMMUNITY_REPLY_NOT_FOUND");
  if (row.status === "visible") return;
  await db.communityReply.update({ where: { id: row.id }, data });
  await recordModerationAction(db, input.staffId, "reply.restore", "reply", row.id, null);
}

export async function resolveReport(input: {
  readonly reportId: string;
  readonly staffId: string;
  readonly outcome: "actioned" | "dismissed";
  readonly db?: PrismaClient;
}): Promise<void> {
  const db = input.db ?? defaultPrisma;
  const report = await db.communityContentReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, status: true },
  });
  if (!report) throw new CommunityError("COMMUNITY_VALIDATION", "report_not_found");
  if (report.status !== "open") return;

  await db.communityContentReport.update({
    where: { id: report.id },
    data: { status: input.outcome, resolvedAt: new Date(), resolvedByStaffId: input.staffId },
  });
  await recordModerationAction(db, input.staffId, `report.${input.outcome}`, "report", report.id, null);
}

async function recordModerationAction(
  db: Db,
  staffId: string,
  action: string,
  targetType: string,
  targetId: string,
  reason: string | null | undefined,
) {
  await db.communityModerationAction.create({
    data: { staffId, action, targetType, targetId, reason: reason ?? null },
  });
}

/**
 * Tell the author their content was removed.
 *
 * The reason the moderator typed is NOT sent. It is internal moderation
 * metadata written for the next moderator, not a message to the learner, and
 * forwarding it would publish an internal note through a notification.
 */
async function notifyRemoval(
  authorId: number,
  discussionTitle: string,
  spaceCode: string,
  discussionId: string,
) {
  await createNotification({
    userId: authorId,
    type: "community_moderation",
    title: "Ваше сообщение скрыто модератором",
    message: discussionTitle,
    metadata: { spaceCode, discussionId },
  });
}
