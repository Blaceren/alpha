/**
 * COMMUNITY-V1 — the moderation response contract.
 *
 * A response that does not validate is `malformed_response` and the surface
 * shows an error. There is no partial render and no fallback: a half-parsed
 * moderation queue looks like the real backlog with rows silently missing, and
 * a moderator would act on it believing they had seen everything.
 */
import { z } from "zod";

const personSchema = z.object({
  id: z.number().int(),
  name: z.string(),
});

const spaceSchema = z.object({
  code: z.string(),
  title: z.string(),
});

const contentStatusSchema = z.enum(["visible", "removed_by_author", "removed_by_moderator"]);

export const reportSchema = z.object({
  id: z.string(),
  reason: z.enum(["spam", "off_topic", "abuse", "other"]),
  note: z.string().nullable(),
  createdAt: z.string(),
  reporter: personSchema,
  discussion: z
    .object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      status: contentStatusSchema,
      author: personSchema,
      space: spaceSchema,
    })
    .nullable(),
  reply: z
    .object({
      id: z.string(),
      body: z.string(),
      status: contentStatusSchema,
      author: personSchema,
      discussion: z.object({
        id: z.string(),
        title: z.string(),
        space: spaceSchema,
      }),
    })
    .nullable(),
});

export const recentDiscussionSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  status: contentStatusSchema,
  createdAt: z.string(),
  author: personSchema,
  space: spaceSchema,
});

export const recentReplySchema = z.object({
  id: z.string(),
  body: z.string(),
  status: contentStatusSchema,
  createdAt: z.string(),
  author: personSchema,
  discussion: z.object({
    id: z.string(),
    title: z.string(),
    space: z.object({ code: z.string() }),
  }),
});

export const moderationActionSchema = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  staff: z.object({ displayName: z.string() }),
});

export const moderationQueueSchema = z.object({
  data: z.object({
    reports: z.array(reportSchema),
    recentDiscussions: z.array(recentDiscussionSchema),
    recentReplies: z.array(recentReplySchema),
    actions: z.array(moderationActionSchema),
  }),
});

export const moderationAckSchema = z.object({
  data: z.object({ ok: z.literal(true) }),
});

export const communityErrorSchema = z.object({
  code: z.string(),
  detail: z.string().nullable().optional(),
  requestId: z.string().optional(),
});

export type CommunityReport = z.infer<typeof reportSchema>;
export type CommunityRecentDiscussion = z.infer<typeof recentDiscussionSchema>;
export type CommunityRecentReply = z.infer<typeof recentReplySchema>;
export type CommunityModerationActionRow = z.infer<typeof moderationActionSchema>;
export type CommunityModerationQueue = z.infer<typeof moderationQueueSchema>["data"];
