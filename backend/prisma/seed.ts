import "dotenv/config";
import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient, type RewardType, type StaffRole, type UserRole } from "@prisma/client";
import { mockChatMessages } from "../src/data/mockChat";
import { mockCheckpoints } from "../src/data/mockCheckpoints";
import { mockCohorts } from "../src/data/mockCohorts";
import { mockCrmUsers } from "../src/data/mockCrmUsers";
import { mockExchangeIntegration } from "../src/data/mockExchangeIntegration";
import { mockNews } from "../src/data/mockNews";
import { mockOpenQuestions } from "../src/data/mockOpenQuestions";
import { mockPostbacks } from "../src/data/mockPostbacks";
import { mockRewards } from "../src/data/mockRewards";
import { mockUser } from "../src/data/mockUser";
import { progressionLevels, progressionTasks } from "./progressionData";

if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_PRODUCTION_SEED !== "true"
) {
  console.error(
    "Refusing to run prisma seed in production without ALLOW_PRODUCTION_SEED=true.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

const rewardTypesByTask = new Map<number, RewardType>([
  [1, "xp"],
  [2, "lesson"],
  [3, "guide"],
  [4, "chat_access"],
  [5, "consultation"],
  [7, "analytics_access"],
]);

function parseDate(value: string) {
  return new Date(value.replace(" ", "T"));
}

function parseMessageTime(value: string) {
  return new Date(`2026-06-27T${value}:00`);
}

async function createUser(input: {
  email: string;
  passwordHash: string;
  role: UserRole;
  name: string;
  level?: number;
  xp?: number;
  currentTask?: string | null;
}) {
  return prisma.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      status: "active",
      name: input.name,
      level: input.level ?? 1,
      xp: input.xp ?? 0,
      currentTask: input.currentTask ?? null,
      emailVerifiedAt: new Date("2026-06-27"),
    },
  });
}

async function resetDatabase() {
  await prisma.testerFeedback.deleteMany();
  await prisma.xpEvent.deleteMany();
  await prisma.promocodeRedemption.deleteMany();
  await prisma.promocode.deleteMany();
  await prisma.userAchievement.deleteMany();
  await prisma.achievement.deleteMany();
  await prisma.dailyLoginReward.deleteMany();
  await prisma.mentorChatMessage.deleteMany();
  await prisma.mentorChatDialog.deleteMany();
  await prisma.chatModerationLog.deleteMany();
  await prisma.chatMute.deleteMany();
  await prisma.moderatorChannelAssignment.deleteMany();
  await prisma.mentorChannelAssignment.deleteMany();
  await prisma.chatModerationRule.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.chatChannel.deleteMany();
  await prisma.supportMessage.deleteMany();
  await prisma.fileAsset.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.supportDialog.deleteMany();
  await prisma.taskReport.deleteMany();
  await prisma.newsPost.deleteMany();
  await prisma.crmUserCohort.deleteMany();
  await prisma.cohort.deleteMany();
  await prisma.postbackEvent.deleteMany();
  await prisma.exchangeAccount.deleteMany();
  await prisma.checkpoint.deleteMany();
  await prisma.userReward.deleteMany();
  await prisma.reward.deleteMany();
  await prisma.userTaskProgress.deleteMany();
  await prisma.task.deleteMany();
  await prisma.level.deleteMany();
  await prisma.openQuestion.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.referralBonusConfig.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.notificationSettings.deleteMany();
  await prisma.staffProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);
  const uploadsDir = path.resolve(
    process.cwd(),
    process.env.LOCAL_UPLOADS_DIR ?? path.join("storage", "uploads"),
  );

  await fs.rm(uploadsDir, { recursive: true, force: true });
  await fs.mkdir(uploadsDir, { recursive: true });
  await resetDatabase();

  const user = await createUser({
    email: "user@test.com",
    passwordHash,
    role: "user",
    name: mockUser.name,
    level: mockUser.level,
    xp: mockUser.xp.current,
    currentTask: mockUser.currentTask,
  });
  await prisma.xpEvent.create({
    data: { userId: user.id, amount: mockUser.xp.current, source: "seed", sourceId: "baseline" },
  });
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await prisma.dailyLoginReward.create({
    data: { userId: user.id, rewardDate: yesterday, streak: 1, xpGranted: 25 },
  });
  const admin = await createUser({ email: "admin@test.com", passwordHash, role: "admin", name: "Админ" });
  await createUser({ email: "support@test.com", passwordHash, role: "support", name: "Саппорт" });
  const mentor = await createUser({ email: "mentor@test.com", passwordHash, role: "mentor", name: "Ментор" });
  const moderator = await createUser({ email: "moderator@test.com", passwordHash, role: "moderator", name: "Модератор" });
  await createUser({ email: "news@test.com", passwordHash, role: "news_editor", name: "Редактор новостей" });

  const STAFF_ROLE_BY_USER_ROLE: Partial<Record<UserRole, StaffRole>> = {
    admin: "crm_admin",
    support: "support",
    mentor: "mentor",
    moderator: "moderator",
    news_editor: "content_manager",
  };
  const staffAccounts = await prisma.user.findMany({
    where: { role: { in: ["admin", "support", "mentor", "moderator", "news_editor"] } },
    select: { id: true, name: true, role: true },
  });
  for (const staff of staffAccounts) {
    const staffRole = STAFF_ROLE_BY_USER_ROLE[staff.role];
    if (!staffRole) continue;
    const displayName = staff.name.trim() || "Сотрудник";
    await prisma.staffProfile.upsert({
      where: { userId: staff.id },
      update: {},
      create: { userId: staff.id, displayName, staffRole },
    });
  }

  const referralUsers = await Promise.all(
    mockUser.referrals.users.map((referral) =>
      createUser({
        email: `${referral.id}-${referral.name}@example.com`,
        passwordHash,
        role: "user",
        name: referral.name,
        level: referral.level,
        xp: referral.earnedXp,
      }),
    ),
  );

  for (const [index, referral] of mockUser.referrals.users.entries()) {
    await prisma.referral.create({
      data: {
        inviterUserId: user.id,
        invitedUserId: referralUsers[index].id,
        xpEarned: referral.earnedXp,
        invitedXpEarned: 50,
        bonusGrantedAt: new Date("2026-06-27"),
      },
    });
  }

  await prisma.referralBonusConfig.create({
    data: { slug: "default", inviterXp: 100, invitedXp: 50 },
  });

  await prisma.notificationSettings.create({
    data: {
      userId: user.id,
      emailEnabled: mockUser.notifications.email,
      webPushEnabled: mockUser.notifications.webPush,
      telegramEnabled: mockUser.notifications.telegramBot,
    },
  });

  await prisma.level.createMany({
    data: progressionLevels.map((level) => ({
      number: level.number,
      title: `Уровень ${level.number}`,
      requiredXp: level.requiredXp,
      status: level.number === 1 ? "текущий" : "заблокирован",
    })),
  });

  for (const task of progressionTasks) {
    const createdTask = await prisma.task.create({
      data: {
        code: task.code,
        stepNumber: task.stepNumber,
        title: task.title,
        description: task.description,
        rewardType: `${task.xpReward} XP`,
        actionLabel: task.actionLabel,
        xpReward: task.xpReward,
        isCheckpoint: task.isCheckpoint,
        requiresReport: task.requiresReport,
        kind: task.kind,
        completionMethod: task.completionMethod,
        balanceThreshold: task.balanceThreshold,
      },
    });

    await prisma.userTaskProgress.create({
      data: {
        userId: user.id,
        taskId: createdTask.id,
        status: task.stepNumber <= 5 ? "completed" : task.stepNumber === 6 ? "active" : "locked",
      },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { currentTask: progressionTasks[5].title },
  });

  const receivedRewardStatus = mockRewards[0]?.status ?? "получено";
  for (const reward of mockRewards) {
    const createdReward = await prisma.reward.create({
      data: {
        title: reward.title,
        description: reward.description,
        type: rewardTypesByTask.get(reward.relatedTaskId) ?? "other",
        status: reward.status,
        relatedTaskId: reward.relatedTaskId,
      },
    });

    if (reward.status === receivedRewardStatus) {
      await prisma.userReward.create({
        data: {
          userId: user.id,
          rewardId: createdReward.id,
          status: receivedRewardStatus,
          receivedAt: new Date("2026-06-27"),
        },
      });
    }
  }

  const checkpoint = mockCheckpoints[0];
  await prisma.checkpoint.create({
    data: {
      userId: user.id,
      title: checkpoint.title,
      stepId: checkpoint.stepId,
      requiredBalance: checkpoint.requiredBalance,
      currentBalance: checkpoint.currentBalance,
      status: checkpoint.status,
    },
  });

  const exchangeAccount = await prisma.exchangeAccount.create({
    data: {
      userId: user.id,
      provider: "sandbox",
      referralLink: mockExchangeIntegration.referralLink,
      exchangeAccountId: mockExchangeIntegration.exchangeAccountId,
      externalAccountId: mockExchangeIntegration.exchangeAccountId,
      traderId: mockExchangeIntegration.exchangeAccountId,
      clickId: "seed-click-user",
      attribution: {
        click_id: "seed-click-user",
        trader_id: mockExchangeIntegration.exchangeAccountId,
        country: "RU",
        device_type: "desktop",
      },
      status: "connected",
      registrationStatus: mockExchangeIntegration.registrationStatus,
      emailConfirmed: mockExchangeIntegration.emailConfirmed,
      firstDepositConfirmed: mockExchangeIntegration.firstDepositConfirmed,
      balance: mockExchangeIntegration.currentBalance,
      depositAmount: mockExchangeIntegration.totalDeposits,
      tradesCount: 1,
      totalDeposits: mockExchangeIntegration.totalDeposits,
      totalWithdrawals: mockExchangeIntegration.totalWithdrawals,
      verifiedAt: new Date("2026-06-27"),
      lastVerifiedAt: new Date("2026-06-27"),
    },
  });

  await prisma.postbackEvent.createMany({
    data: mockPostbacks.map((postback) => ({
      exchangeAccountId: exchangeAccount.id,
      type: postback.type,
      eventType: postback.type,
      normalizedEventType: postback.type,
      externalAccountId: mockExchangeIntegration.exchangeAccountId,
      traderId: mockExchangeIntegration.exchangeAccountId,
      clickId: "seed-click-user",
      amount: postback.amount,
      currency: "USD",
      status: postback.status,
      rawPayload: postback.rawPayload,
      payload: { source: "seed", type: postback.type },
      attribution: {
        click_id: "seed-click-user",
        trader_id: mockExchangeIntegration.exchangeAccountId,
      },
      createdAt: parseDate(postback.date),
    })),
  });

  const generalChannel = await prisma.chatChannel.create({
    data: {
      slug: "general",
      title: "Общий канал",
      description: "Базовый community channel для участников",
      requiredLevel: 1,
      retentionDays: 3,
    },
  });
  await prisma.chatChannel.create({
    data: {
      slug: "level-5",
      title: "Канал уровня 5+",
      description: "Канал открывается после 5 уровня",
      requiredLevel: 5,
      retentionDays: 3,
    },
  });
  await prisma.mentorChannelAssignment.create({ data: { channelId: generalChannel.id, mentorId: mentor.id } });
  await prisma.moderatorChannelAssignment.create({ data: { channelId: generalChannel.id, moderatorId: moderator.id } });
  await prisma.chatModerationRule.create({ data: { type: "stop_word", value: "скам" } });

  const firstAchievement = await prisma.achievement.create({
    data: {
      slug: "first-report",
      title: "Первый отчёт",
      description: "Пользователь отправил первый отчёт по сделкам",
      rarity: "common",
      iconKey: "report",
    },
  });
  await prisma.achievement.create({
    data: {
      slug: "early-tester",
      title: "Ранний тестер",
      description: "Участник closed testing",
      rarity: "rare",
      iconKey: "tester",
    },
  });
  await prisma.userAchievement.create({
    data: { userId: user.id, achievementId: firstAchievement.id, grantedById: admin.id, source: "seed" },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { selectedAchievementId: firstAchievement.id },
  });

  await prisma.promocode.create({
    data: {
      code: "MVP100",
      type: "xp_bonus",
      value: { xp: 100 },
      maxUses: 100,
      perUserLimit: 1,
      createdById: admin.id,
    },
  });

  const cohorts = await Promise.all(
    mockCohorts.map((cohort) =>
      prisma.cohort.create({
        data: {
          slug: cohort.id,
          name: cohort.title,
          description: cohort.description,
          conditions: cohort.conditions,
          action: cohort.action,
          usersCount: cohort.usersCount,
        },
      }),
    ),
  );
  const cohortBySlug = new Map(cohorts.map((cohort) => [cohort.slug, cohort]));

  for (const crmUser of mockCrmUsers) {
    const cohort = cohortBySlug.get(crmUser.cohort);
    if (!cohort) continue;

    await prisma.crmUserCohort.create({
      data: {
        userId: crmUser.email === mockUser.email ? user.id : null,
        cohortId: cohort.id,
        name: crmUser.name,
        email: crmUser.email,
        level: crmUser.level,
        currentStep: crmUser.currentStep,
        exchangeStatus: crmUser.exchangeStatus,
        depositStatus: crmUser.depositStatus,
        balance: crmUser.balance,
        lastActiveAt: parseDate(crmUser.lastActiveAt),
      },
    });
  }

  await prisma.newsPost.createMany({
    data: mockNews.map((post) => ({
      slug: post.id,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      category: post.category,
      author: post.author,
      status: "published",
      publishedAt: parseDate(post.date),
    })),
  });

  await prisma.chatMessage.createMany({
    data: mockChatMessages.map((message) => ({
      channelId: generalChannel.id,
      userId: message.userName === mockUser.name ? user.id : null,
      userName: message.userName,
      userLevel: message.userLevel,
      userRank: message.userRank,
      role: message.role,
      message: message.message,
      achievementTitle: message.userName === mockUser.name ? firstAchievement.title : null,
      createdAt: parseMessageTime(message.time),
    })),
  });

  await prisma.mentorChatDialog.create({
    data: {
      userId: user.id,
      mentorId: mentor.id,
      status: mockExchangeIntegration.firstDepositConfirmed ? "open" : "locked",
      unlockReason: "Доступ открывается после First Deposit / шага 4",
      lastMessage: "Добро пожаловать в чат с ментором",
      lastMessageAt: new Date("2026-06-27T12:00:00"),
      messages: {
        create: {
          senderUserId: mentor.id,
          senderRole: "mentor",
          message: "Добро пожаловать в чат с ментором",
        },
      },
    },
  });

  await prisma.openQuestion.createMany({
    data: mockOpenQuestions.map((question) => ({
      id: question.id,
      title: question.title,
      description: question.description,
      status: question.status,
      priority: question.priority,
      owner: question.owner,
      note: question.note,
    })),
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
