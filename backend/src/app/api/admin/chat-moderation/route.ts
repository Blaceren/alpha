import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, requireModeratorAccess } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { validateJsonBody } from "@/lib/validation";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rule.create"), value: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("rule.toggle"), id: z.number().int().positive(), isActive: z.boolean() }),
  z.object({ action: z.literal("mute.create"), userId: z.number().int().positive(), channelId: z.number().int().positive().nullable().optional(), reason: z.string().trim().min(1).max(500), durationMinutes: z.number().int().positive().nullable().optional() }),
  z.object({ action: z.literal("message.hide"), messageId: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("message.delete"), messageId: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("mute.remove"), userId: z.number().int().positive(), channelId: z.number().int().positive().nullable().optional() }),
  z.object({ action: z.literal("assignment.create"), userId: z.number().int().positive(), channelId: z.number().int().positive(), role: z.enum(["mentor", "moderator"]) }),
]);

export async function GET(request: Request) {
  try {
    await requireModeratorAccess();
    const [rules, mutes, messages, logs] = await Promise.all([
      prisma.chatModerationRule.findMany({ orderBy: { id: "asc" } }),
      prisma.chatMute.findMany({ include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.chatMessage.findMany({ where: { isHidden: false }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.chatModerationLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return NextResponse.json({ rules, mutes, messages, logs });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  let moderator;
  try {
    moderator = await requireModeratorAccess();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
  const parsed = await validateJsonBody(request, actionSchema);
  if (!parsed.success) return parsed.response;

  let entityId: number;
  if (parsed.data.action === "rule.create") {
    const rule = await prisma.chatModerationRule.create({ data: { type: "stop_word", value: parsed.data.value } });
    entityId = rule.id;
  } else if (parsed.data.action === "rule.toggle") {
    const rule = await prisma.chatModerationRule.update({ where: { id: parsed.data.id }, data: { isActive: parsed.data.isActive } });
    entityId = rule.id;
  } else if (parsed.data.action === "mute.create") {
    const mute = await prisma.chatMute.create({
      data: {
        userId: parsed.data.userId,
        channelId: parsed.data.channelId ?? null,
        reason: parsed.data.reason,
        expiresAt: parsed.data.durationMinutes ? new Date(Date.now() + parsed.data.durationMinutes * 60_000) : null,
      },
    });
    await prisma.chatModerationLog.create({ data: { moderatorId: moderator.id, userId: parsed.data.userId, channelId: parsed.data.channelId ?? null, action: "mute", reason: parsed.data.reason } });
    entityId = mute.id;
  } else if (parsed.data.action === "mute.remove") {
    await prisma.chatMute.deleteMany({ where: { userId: parsed.data.userId, channelId: parsed.data.channelId ?? null } });
    await prisma.chatModerationLog.create({ data: { moderatorId: moderator.id, userId: parsed.data.userId, channelId: parsed.data.channelId ?? null, action: "unmute", reason: "Inline moderation" } });
    entityId = parsed.data.userId;
  } else if (parsed.data.action === "message.delete") {
    const message = await prisma.chatMessage.findUnique({ where: { id: parsed.data.messageId } });
    if (!message) return NextResponse.json({ error: "MESSAGE_NOT_FOUND" }, { status: 404 });
    await prisma.chatModerationLog.create({ data: { moderatorId: moderator.id, userId: message.userId, channelId: message.channelId, messageId: null, action: "message_deleted", reason: parsed.data.reason } });
    await prisma.chatMessage.delete({ where: { id: message.id } });
    entityId = message.id;
  } else if (parsed.data.action === "assignment.create") {
    const assignee = await prisma.user.findFirst({ where: { id: parsed.data.userId, role: parsed.data.role, status: "active" } });
    if (!assignee) return NextResponse.json({ error: "ASSIGNEE_NOT_FOUND" }, { status: 400 });
    if (parsed.data.role === "mentor") {
      const assignment = await prisma.mentorChannelAssignment.upsert({ where: { channelId_mentorId: { channelId: parsed.data.channelId, mentorId: parsed.data.userId } }, update: {}, create: { channelId: parsed.data.channelId, mentorId: parsed.data.userId } });
      entityId = assignment.id;
    } else {
      const assignment = await prisma.moderatorChannelAssignment.upsert({ where: { channelId_moderatorId: { channelId: parsed.data.channelId, moderatorId: parsed.data.userId } }, update: {}, create: { channelId: parsed.data.channelId, moderatorId: parsed.data.userId } });
      entityId = assignment.id;
    }
  } else {
    const message = await prisma.chatMessage.update({ where: { id: parsed.data.messageId }, data: { isHidden: true } });
    await prisma.chatModerationLog.create({ data: { moderatorId: moderator.id, userId: message.userId, channelId: message.channelId, messageId: message.id, action: "message_hidden", reason: parsed.data.reason } });
    entityId = message.id;
  }

  await createAuditLog({ userId: moderator.id, action: "CHAT_MODERATION_ACTION", entityType: "ChatModeration", entityId, metadata: parsed.data, request });
  return NextResponse.json({ ok: true, id: entityId });
}

export async function DELETE(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  let moderator;
  try {
    moderator = await requireModeratorAccess();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("id"));
  const type = params.get("type");
  if (!Number.isInteger(id) || id <= 0 || (type !== "rule" && type !== "mute")) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (type === "rule") await prisma.chatModerationRule.delete({ where: { id } });
  else await prisma.chatMute.delete({ where: { id } });
  await createAuditLog({ userId: moderator.id, action: type === "rule" ? "CHAT_RULE_DELETED" : "CHAT_MUTE_REMOVED", entityType: type, entityId: id, request });
  return NextResponse.json({ ok: true });
}
