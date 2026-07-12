import { NextResponse } from "next/server";
import { apiAuthErrorResponse, rateLimitedResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { canAccessChannel, getDefaultChatChannel, moderateMessage } from "@/lib/chatModeration";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { chatMessageSchema, validateJsonBody } from "@/lib/validation";

function getRankTitle(level: number) {
  if (level >= 17) return "Мастер";
  if (level >= 13) return "Профи";
  if (level >= 9) return "Трейдер";
  if (level >= 5) return "Практик";
  return "Новичок";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const defaultChannel = await getDefaultChatChannel();
    const requestedChannelId = Number(new URL(request.url).searchParams.get("channelId") ?? 0);
    const channelId = Number.isInteger(requestedChannelId) && requestedChannelId > 0 ? requestedChannelId : defaultChannel?.id;
    if (channelId && !(await canAccessChannel(user, channelId))) {
      return NextResponse.json({ error: "CHANNEL_LOCKED", message: "Канал пока заблокирован" }, { status: 403 });
    }
    const messages = await prisma.chatMessage.findMany({
      where: channelId ? { channelId, isHidden: false } : { isHidden: false },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ messages });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  const parsed = await validateJsonBody(request, chatMessageSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const user = await requireUser();
    const defaultChannel = await getDefaultChatChannel();
    const channelId = parsed.data.channelId ?? defaultChannel?.id ?? null;

    if (channelId && !(await canAccessChannel(user, channelId))) {
      return NextResponse.json(
        { error: "CHANNEL_LOCKED", message: "Канал пока заблокирован" },
        { status: 403 },
      );
    }

    const moderation = await moderateMessage({
      userId: user.id,
      channelId,
      message: parsed.data.message,
    });

    if (!moderation.ok) {
      await prisma.chatModerationLog.create({
        data: {
          userId: user.id,
          channelId,
          action: "message_blocked",
          reason: moderation.reason,
        },
      });
      return NextResponse.json(
        { error: "MESSAGE_BLOCKED", message: moderation.reason },
        { status: 400 },
      );
    }

    const limit = rateLimit(`chat:send:${user.id}:${channelId ?? "general"}`, {
      limit: 10,
      windowMs: 60 * 1000,
    });

    if (!limit.allowed) {
      await createAuditLog({
        userId: user.id,
        action: "RATE_LIMITED",
        entityType: "API_ROUTE",
        entityId: "/api/chat",
        metadata: { resetAt: limit.resetAt },
        request,
      });

      return rateLimitedResponse();
    }

    const explicitlySelectedAchievement = user.selectedAchievementId
      ? await prisma.userAchievement.findUnique({
          where: {
            userId_achievementId: {
              userId: user.id,
              achievementId: user.selectedAchievementId,
            },
          },
          include: { achievement: true },
        })
      : null;
    const displayedAchievement = explicitlySelectedAchievement ?? await prisma.userAchievement.findFirst({
      where: { userId: user.id },
      include: { achievement: true },
      orderBy: { grantedAt: "desc" },
    });

    const chatMessage = await prisma.chatMessage.create({
      data: {
        userId: user.id,
        channelId,
        userName: user.name,
        userLevel: user.level,
        userRank: getRankTitle(user.level),
        role: user.role,
        message: parsed.data.message,
        achievementTitle: displayedAchievement?.achievement.title,
      },
    });

    await createAuditLog({
      userId: user.id,
      action: "CHAT_MESSAGE_SENT",
      entityType: "ChatMessage",
      entityId: chatMessage.id,
      metadata: {
        messageLength: parsed.data.message.length,
        channelId,
      },
      request,
    });

    return NextResponse.json({ message: chatMessage }, { status: 201 });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
