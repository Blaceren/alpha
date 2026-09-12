import { prisma } from "@/lib/prisma";

export async function getDefaultChatChannel() {
  return prisma.chatChannel.findFirst({
    where: { slug: "general" },
  });
}

export async function canAccessChannel(user: { id: number; level: number; role: string }, channelId: number) {
  if (user.role === "admin") return true;
  const channel = await prisma.chatChannel.findUnique({ where: { id: channelId } });
  if (!channel || !channel.isActive) return false;

  if (user.role === "mentor") {
    const assignment = await prisma.mentorChannelAssignment.findUnique({
      where: { channelId_mentorId: { channelId, mentorId: user.id } },
    });
    return Boolean(assignment);
  }

  if (user.role === "moderator") {
    const assignment = await prisma.moderatorChannelAssignment.findUnique({
      where: { channelId_moderatorId: { channelId, moderatorId: user.id } },
    });
    return Boolean(assignment);
  }

  if (user.role !== "user") return false;
  if (channel.requiredLevel && user.level < channel.requiredLevel) return false;
  if (channel.requiredCheckpoint) {
    const completed = await prisma.userTaskProgress.findFirst({
      where: { userId: user.id, status: "completed", task: { code: channel.requiredCheckpoint } },
      select: { id: true },
    });
    if (!completed) return false;
  }
  if (channel.requiredAchievement) {
    const achievement = await prisma.userAchievement.findFirst({
      where: { userId: user.id, achievement: { slug: channel.requiredAchievement, isActive: true } },
      select: { id: true },
    });
    if (!achievement) return false;
  }
  return true;
}

export async function moderateMessage(input: {
  userId: number;
  channelId?: number | null;
  message: string;
}) {
  const latestMessage = await prisma.chatMessage.findFirst({
    where: { userId: input.userId, channelId: input.channelId ?? null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latestMessage && Date.now() - latestMessage.createdAt.getTime() < 2_000) {
    return { ok: false, reason: "Подождите 2 секунды перед следующим сообщением" };
  }

  const activeMute = await prisma.chatMute.findFirst({
    where: {
      userId: input.userId,
      OR: [{ channelId: input.channelId ?? null }, { channelId: null }],
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      ],
    },
  });

  if (activeMute) {
    return { ok: false, reason: "Пользователь временно заглушен" };
  }

  if (/(?:https?:\/\/|www\.|t\.me\/)/i.test(input.message)) {
    return { ok: false, reason: "Ссылки в community chat пока запрещены" };
  }

  const rules = await prisma.chatModerationRule.findMany({
    where: { type: "stop_word", isActive: true },
  });
  const normalized = input.message.toLowerCase();

  for (const rule of rules) {
    if (normalized.includes(rule.value.toLowerCase())) {
      return { ok: false, reason: "Сообщение содержит запрещённое слово" };
    }
  }

  return { ok: true };
}
