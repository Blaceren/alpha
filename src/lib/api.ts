"use client";

import type { MockChatMessage } from "@/data/mockChat";
import type { MockCohort } from "@/data/mockCohorts";
import type { MockCrmUser } from "@/data/mockCrmUsers";
import type { MockLevel } from "@/data/mockLevels";
import type { MockNewsItem } from "@/data/mockNews";
import type { OpenQuestion } from "@/data/mockOpenQuestions";
import type { MockReward } from "@/data/mockRewards";
import { mockUser } from "@/data/mockUser";
import type {
  Checkpoint,
  ExchangeStatus,
  ProgressStatus,
} from "@/types/checkpoints";
import type {
  ExchangeIntegration,
  ExchangePostback,
  PostbackType,
} from "@/types/exchange";
import type { MockTask, TaskStatus } from "@/types/tasks";
import { getNextLevelXp } from "@/utils/levelUtils";

export type ApiResult<T> = {
  data: T;
  isFallback: boolean;
  error?: string;
};

export type ApiMe = typeof mockUser;

let cachedCsrfToken: string | null = null;

type ApiTask = {
  code: string | null;
  stepNumber: number;
  title: string;
  description: string;
  rewardType: string;
  actionLabel: string;
  requiresReport: boolean;
  kind: string;
  completionMethod: string;
  balanceThreshold: number | null;
  progress?: Array<{ status: string }>;
  reports?: Array<{ status: "pending" | "approved" | "rejected" }>;
};

type ApiTaskResponse = {
  tasks: ApiTask[];
};

type ApiLevel = {
  number: number;
  title: string;
  requiredXp: number;
  status: string;
};

type ApiReward = {
  id: number;
  title: string;
  description: string;
  status: string;
  relatedTaskId: number | null;
  users?: Array<{
    status: string;
    receivedAt: string | null;
  }>;
};

type ApiNewsPost = {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  author: string;
  publishedAt: string;
  coverImageUrl?: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
};

type ApiCrmUser = MockCrmUser;

type ApiChatMessage = {
  id: number;
  userId?: number | null;
  userName: string;
  userLevel: number;
  userRank: string;
  role: string;
  message: string;
  createdAt: string;
};

type ApiCohort = {
  slug: string;
  name: string;
  description: string;
  conditions: string;
  action: string;
  usersCount: number;
};

type ApiExchangeAccount = {
  exchangeAccountId: string;
  referralLink: string;
  status?: string;
  traderId?: string | null;
  registrationStatus: boolean;
  emailConfirmed: boolean;
  firstDepositConfirmed: boolean;
  totalDeposits: number;
  totalWithdrawals: number;
  balance: number;
  postbackEvents?: Array<{
    id: number;
    type: PostbackType;
    amount: number;
    status: string;
    rawPayload: string;
    createdAt: string;
  }>;
};

type ApiOpenQuestion = OpenQuestion;

export type ApiNotification = {
  id: number;
  userId: number;
  type:
    | "support_reply"
    | "task_report_approved"
    | "task_report_rejected"
    | "reward_granted"
    | "level_up"
    | "checkpoint_frozen"
    | "checkpoint_restored"
    | "postback_received"
    | "exchange_connected"
    | "exchange_rejected"
    | "exchange_blocked"
    | "system";
  title: string;
  message: string;
  metadata: unknown;
  readAt: string | null;
  createdAt: string;
};

type ApiUser = {
  id?: number;
  profile?: {
    id: number;
    name: string;
    email: string;
  };
  name: string;
  email: string;
  level: number;
  xp: number;
  rank?: string;
  currentTask: string | null;
  rewards?: Array<{
    id: number;
    rewardId: number;
    title: string;
    description: string;
    status: string;
    relatedTaskId: number | null;
    receivedAt: string | null;
  }>;
  referrals?: ApiMe["referrals"] | null;
  notificationSettings?: ApiMe["notifications"] | null;
  exchangeAccount?: ApiExchangeAccount | null;
  checkpoint?: {
    status: string;
  } | null;
  progressStatus?: string;
  fallbackFields?: {
    referrals?: boolean;
    notificationSettings?: boolean;
  };
};

async function getJson<T>(endpoint: string, fallback: T): Promise<ApiResult<T>> {
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`API ${endpoint} вернул ${response.status}`);
    }

    return {
      data: (await response.json()) as T,
      isFallback: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "API недоступно";

    console.warn(`${message}. Данные не подменяются локальным mock.`);

    return {
      data: fallback,
      isFallback: true,
      error: message,
    };
  }
}

async function getCsrfToken() {
  if (cachedCsrfToken) {
    return cachedCsrfToken;
  }

  const response = await fetch("/api/csrf", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API /api/csrf вернул ${response.status}`);
  }

  const result = (await response.json()) as { csrfToken: string };
  cachedCsrfToken = result.csrfToken;

  return cachedCsrfToken;
}

export async function csrfFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const method = init.method?.toUpperCase() ?? "GET";
  const needsCsrf = ["POST", "PATCH", "PUT", "DELETE"].includes(method);
  const csrfToken = needsCsrf ? await getCsrfToken() : null;
  const headers = new Headers(init.headers);

  if (csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

function formatApiDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU").format(new Date(value));
}

function formatApiTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatApiDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function toTaskStatus(status: string): TaskStatus {
  if (
    status === "completed" ||
    status === "active" ||
    status === "locked" ||
    status === "frozen"
  ) {
    return status;
  }

  return "locked";
}

function toLevelStatus(status: string): MockLevel["status"] {
  if (status === "пройден" || status === "passed" || status === "completed") {
    return "пройден";
  }

  if (status === "текущий" || status === "current" || status === "active") {
    return "текущий";
  }

  return "заблокирован";
}

function toRewardStatus(status: string): MockReward["status"] {
  if (status === "получено" || status === "received" || status === "claimed") {
    return "получено";
  }

  if (status === "доступно" || status === "available") {
    return "доступно";
  }

  return "заблокировано";
}

function toMockTasks(tasks: ApiTask[]) {
  return tasks.map((task) => ({
    id: task.stepNumber,
    code: task.code,
    title: task.title,
    description: task.description,
    reward: task.rewardType,
    status: toTaskStatus(task.progress?.[0]?.status ?? "locked"),
    actionLabel: task.actionLabel,
    kind: task.kind,
    completionMethod: task.completionMethod,
    balanceThreshold: task.balanceThreshold,
    requiresReport: task.requiresReport,
    reportStatus: task.reports?.[0]?.status ?? null,
  }));
}

function toMockChatMessage(message: ApiChatMessage): MockChatMessage {
  return {
    id: message.id,
    userId: message.userId,
    userName: message.userName,
    userLevel: message.userLevel,
    userRank: message.userRank,
    role: message.role as MockChatMessage["role"],
    mentorBadge: message.role === "mentor" ? "Ментор" : undefined,
    message: message.message,
    time: formatApiTime(message.createdAt),
  };
}

function toExchangePostback(
  event: NonNullable<ApiExchangeAccount["postbackEvents"]>[number],
): ExchangePostback {
  return {
    id: event.id,
    type: event.type,
    date: formatApiDateTime(event.createdAt),
    amount: event.amount,
    status: "обработано" as ExchangePostback["status"],
    rawPayload: event.rawPayload,
  };
}

function toExchangeIntegration(
  exchangeAccount: ApiExchangeAccount,
): ExchangeIntegration {
  return {
    exchangeAccountId: exchangeAccount.exchangeAccountId,
    referralLink: exchangeAccount.referralLink,
    registrationStatus: exchangeAccount.registrationStatus,
    emailConfirmed: exchangeAccount.emailConfirmed,
    firstDepositConfirmed: exchangeAccount.firstDepositConfirmed,
    totalDeposits: exchangeAccount.totalDeposits,
    totalWithdrawals: exchangeAccount.totalWithdrawals,
    currentBalance: exchangeAccount.balance,
    postbackHistory: (exchangeAccount.postbackEvents ?? []).map(
      toExchangePostback,
    ),
  };
}

export async function getMe() {
  const result = await getJson<{
    user: ApiUser | null;
  }>("/api/me", { user: null });

  if (!result.data.user) {
    return {
      data: {
        ...mockUser,
        id: "user-unavailable",
        name: "Пользователь",
        email: "",
        level: 1,
        xp: { current: 0, target: getNextLevelXp(1) },
        currentTask: "Нет данных",
        freezeStatus: "active",
        referrals: { link: "", invitedCount: 0, earnedXp: 0, users: [] },
        notifications: { email: false, webPush: false, telegramBot: false },
        exchange: {
          account: "не подключён",
          depositConfirmed: false,
          balance: 0,
          currency: "USD",
        },
        progressSteps: [],
        rewardHistory: [],
      },
      isFallback: true,
      error: result.error ?? "Пользователь не найден",
    };
  }

  return {
    data: {
      ...mockUser,
      id: result.data.user.id ? `user-${result.data.user.id}` : mockUser.id,
      name: result.data.user.name,
      email: result.data.user.email,
      level: result.data.user.level,
      xp: {
        current: result.data.user.xp,
        target: getNextLevelXp(result.data.user.level),
      },
      currentTask: result.data.user.currentTask ?? "Нет активного задания",
      freezeStatus:
        result.data.user.progressStatus === "frozen"
          ? "frozen"
          : "active",
      referrals: result.data.user.referrals ?? {
        link: "",
        invitedCount: 0,
        earnedXp: 0,
        users: [],
      },
      notifications:
        result.data.user.notificationSettings ?? {
          email: false,
          webPush: false,
          telegramBot: false,
        },
      exchange: result.data.user.exchangeAccount
        ? {
            account: result.data.user.exchangeAccount.exchangeAccountId,
            depositConfirmed:
              result.data.user.exchangeAccount.firstDepositConfirmed,
            balance: result.data.user.exchangeAccount.balance,
            currency: mockUser.exchange.currency,
          }
        : {
            account: "не подключён",
            depositConfirmed: false,
            balance: 0,
            currency: "USD",
          },
    },
    isFallback: result.isFallback,
    error: result.error,
  } satisfies ApiResult<ApiMe>;
}

export async function getNewsItem(id: string) {
  try {
    const response = await fetch(`/api/news/${id}`, {
      cache: "no-store",
    });

    if (response.status === 404) {
      return {
        data: null,
        isFallback: false,
        error: "Новость не найдена",
      } satisfies ApiResult<MockNewsItem | null>;
    }

    if (!response.ok) {
      throw new Error(`API /api/news/${id} вернул ${response.status}`);
    }

    const result = (await response.json()) as { newsItem: ApiNewsPost };
    const post = result.newsItem;

    return {
      data: {
        id: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        date: formatApiDate(post.publishedAt),
        category: post.category,
        author: post.author,
        coverImageUrl: post.coverImageUrl,
        mediaUrl: post.mediaUrl,
        mediaType: post.mediaType,
      },
      isFallback: false,
    } satisfies ApiResult<MockNewsItem | null>;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "API новости недоступно";

    console.warn(message);

    return {
      data: null,
      isFallback: true,
      error: message,
    } satisfies ApiResult<MockNewsItem | null>;
  }
}

export async function getTasks() {
  const result = await getJson<ApiTaskResponse>("/api/tasks", {
    tasks: [],
  });

  if (result.isFallback) {
    return {
      data: [],
      isFallback: true,
      error: result.error,
    } satisfies ApiResult<MockTask[]>;
  }

  return {
    data: toMockTasks(result.data.tasks),
    isFallback: false,
  } satisfies ApiResult<MockTask[]>;
}

export async function completeTask(taskId: number) {
  try {
    const response = await csrfFetch(`/api/tasks/${taskId}/complete`, {
      method: "POST",
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      throw new Error(
        errorBody.error ?? `API complete task вернул ${response.status}`,
      );
    }

    const result = (await response.json()) as ApiTaskResponse;

    return {
      data: toMockTasks(result.tasks),
      isFallback: false,
    } satisfies ApiResult<MockTask[]>;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "API выполнения задания недоступно";

    console.warn(`${message}. Использован локальный fallback.`);

    return {
      data: [],
      isFallback: true,
      error: message,
    } satisfies ApiResult<MockTask[]>;
  }
}

export async function verifyTask(taskId: number) {
  try {
    const response = await csrfFetch(`/api/tasks/${taskId}/verify`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as ApiTaskResponse & {
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? `API verify task вернул ${response.status}`);
    }
    return {
      data: toMockTasks(body.tasks),
      isFallback: false,
    } satisfies ApiResult<MockTask[]>;
  } catch (error) {
    return {
      data: [],
      isFallback: true,
      error: error instanceof Error ? error.message : "Проверка задания недоступна",
    } satisfies ApiResult<MockTask[]>;
  }
}

export async function getLevels() {
  const result = await getJson<{ levels: ApiLevel[] }>("/api/levels", {
    levels: [],
  });

  if (result.isFallback) {
    return { data: [], isFallback: true, error: result.error };
  }

  return {
    data: result.data.levels.map((level) => ({
      id: level.number,
      title: level.title,
      requiredXp: level.requiredXp,
      status: toLevelStatus(level.status),
    })),
    isFallback: false,
  } satisfies ApiResult<MockLevel[]>;
}

export async function getRewards() {
  const result = await getJson<{ rewards: ApiReward[] }>("/api/rewards", {
    rewards: [],
  });

  if (result.isFallback) {
    return { data: [], isFallback: true, error: result.error };
  }

  return {
    data: result.data.rewards.map((reward) => ({
      id: reward.id,
      title: reward.title,
      description: reward.description,
      status: toRewardStatus(reward.users?.[0]?.status ?? reward.status),
      relatedTaskId: reward.relatedTaskId ?? 0,
    })),
    isFallback: false,
  } satisfies ApiResult<MockReward[]>;
}

export async function updateNotificationSettings(settings: ApiMe["notifications"]) {
  try {
    const response = await csrfFetch("/api/me/notification-settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        emailEnabled: settings.email,
        webPushEnabled: settings.webPush,
        telegramEnabled: settings.telegramBot,
      }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      throw new Error(
        errorBody.error ?? `API notification settings вернул ${response.status}`,
      );
    }

    const result = (await response.json()) as {
      notificationSettings: ApiMe["notifications"];
    };

    return {
      data: result.notificationSettings,
      isFallback: false,
    } satisfies ApiResult<ApiMe["notifications"]>;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "API настроек уведомлений недоступно";

    console.warn(`${message}. Использован локальный fallback.`);

    return {
      data: settings,
      isFallback: true,
      error: message,
    } satisfies ApiResult<ApiMe["notifications"]>;
  }
}

export async function getNotifications() {
  return getJson<{ items: ApiNotification[]; unreadCount: number }>(
    "/api/notifications",
    { items: [], unreadCount: 0 },
  );
}

export async function markNotificationRead(notificationId: number) {
  try {
    const response = await csrfFetch(`/api/notifications/${notificationId}/read`, {
      method: "PATCH",
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      throw new Error(
        errorBody.error ?? `API notification read вернул ${response.status}`,
      );
    }

    return {
      data: (await response.json()) as {
        notification: ApiNotification;
        unreadCount: number;
      },
      isFallback: false,
    } satisfies ApiResult<{
      notification: ApiNotification;
      unreadCount: number;
    }>;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "API чтения уведомления недоступно";

    console.warn(`${message}. Использован локальный fallback.`);

    return {
      data: null,
      isFallback: true,
      error: message,
    } satisfies ApiResult<null>;
  }
}

export async function markAllNotificationsRead() {
  try {
    const response = await csrfFetch("/api/notifications/read-all", {
      method: "PATCH",
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      throw new Error(
        errorBody.error ?? `API notifications read-all вернул ${response.status}`,
      );
    }

    return {
      data: (await response.json()) as {
        unreadCount: number;
        updatedCount: number;
      },
      isFallback: false,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "API чтения всех уведомлений недоступно";

    console.warn(`${message}. Использован локальный fallback.`);

    return {
      data: null,
      isFallback: true,
      error: message,
    } satisfies ApiResult<null>;
  }
}

export async function uploadFile(file: File, purpose: string) {
  try {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("purpose", purpose);

    const response = await csrfFetch("/api/files/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      throw new Error(
        errorBody.error ??
          errorBody.message ??
          `API upload вернул ${response.status}`,
      );
    }

    return {
      data: (await response.json()) as {
        file: {
          id: number;
          originalName: string;
          mimeType: string;
          sizeBytes: number;
          purpose: string;
        };
      },
      isFallback: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "API загрузки файла недоступно";

    console.warn(message);

    return {
      data: null,
      isFallback: true,
      error: message,
    } satisfies ApiResult<null>;
  }
}

export async function getNews() {
  const result = await getJson<{ news: ApiNewsPost[] }>("/api/news", {
    news: [],
  });

  if (result.isFallback) {
    return { data: [], isFallback: true, error: result.error };
  }

  return {
    data: result.data.news.map((post) => ({
      id: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      date: formatApiDate(post.publishedAt),
      category: post.category,
      author: post.author,
      coverImageUrl: post.coverImageUrl,
      mediaUrl: post.mediaUrl,
      mediaType: post.mediaType,
    })),
    isFallback: false,
  } satisfies ApiResult<MockNewsItem[]>;
}

export async function getChatMessages() {
  const result = await getJson<{ messages: ApiChatMessage[] }>("/api/chat", {
    messages: [],
  });

  if (result.isFallback) {
    return {
      data: [],
      isFallback: true,
      error: result.error,
    };
  }

  return {
    data: result.data.messages.map(toMockChatMessage),
    isFallback: false,
  } satisfies ApiResult<MockChatMessage[]>;
}

export async function sendChatMessage(message: string, channelId?: number) {
  try {
    const response = await csrfFetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, channelId }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      throw new Error(errorBody.error ?? `API chat POST вернул ${response.status}`);
    }

    const result = (await response.json()) as { message: ApiChatMessage };

    return {
      data: toMockChatMessage(result.message),
      isFallback: false,
    } satisfies ApiResult<MockChatMessage>;
  } catch (error) {
    const text =
      error instanceof Error ? error.message : "API отправки чата недоступно";

    console.warn(text);

    return {
      data: null,
      isFallback: true,
      error: text,
    } satisfies ApiResult<null>;
  }
}

export async function checkCheckpoint(checkpointId: number, balance?: number) {
  try {
    const response = await csrfFetch(`/api/checkpoints/${checkpointId}/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(balance === undefined ? {} : { balance }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      throw new Error(errorBody.error ?? `API checkpoint вернул ${response.status}`);
    }

    const result = (await response.json()) as {
      checkpoint: Checkpoint & { updatedAt?: string };
      progressStatus: ProgressStatus;
    };

    return {
      data: {
        checkpoint: result.checkpoint,
        exchange: {
          accountStatus: "подключён",
          depositConfirmed: result.checkpoint.status === "completed",
          balance: result.checkpoint.currentBalance,
          lastCheckedAt: result.checkpoint.updatedAt
            ? formatApiDateTime(result.checkpoint.updatedAt)
            : new Date().toLocaleString("ru-RU"),
        } satisfies ExchangeStatus,
        progressStatus: result.progressStatus,
      },
      isFallback: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "API checkpoint недоступно";

    console.warn(`${message}. Использован локальный fallback.`);

    return {
      data: null,
      isFallback: true,
      error: message,
    } satisfies ApiResult<null>;
  }
}

export async function simulateExchangePostbackApi(type: PostbackType) {
  try {
    const response = await csrfFetch("/api/exchange/postbacks/simulate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      throw new Error(errorBody.error ?? `API postback вернул ${response.status}`);
    }

    const result = (await response.json()) as {
      exchangeAccount: ApiExchangeAccount;
      tasks: ApiTask[];
    };

    return {
      data: {
        integration: toExchangeIntegration(result.exchangeAccount),
        tasks: toMockTasks(result.tasks),
      },
      isFallback: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "API postback недоступно";

    console.warn(`${message}. Использован локальный fallback.`);

    return {
      data: null,
      isFallback: true,
      error: message,
    } satisfies ApiResult<null>;
  }
}

export async function getCrmCohorts() {
  const result = await getJson<{ cohorts: ApiCohort[] }>("/api/crm/cohorts", {
    cohorts: [],
  });

  if (result.isFallback) {
    return { data: [], isFallback: true, error: result.error };
  }

  return {
    data: result.data.cohorts.map((cohort) => ({
      id: cohort.slug,
      title: cohort.name,
      description: cohort.description,
      usersCount: cohort.usersCount,
      conditions: cohort.conditions,
      action: cohort.action,
    })),
    isFallback: false,
  } satisfies ApiResult<MockCohort[]>;
}

export async function getCrmUsers() {
  const result = await getJson<{ users: ApiCrmUser[] }>("/api/crm/users", {
    users: [],
  });

  if (result.isFallback) {
    return { data: [], isFallback: true, error: result.error };
  }

  return {
    data: result.data.users.map((user) => ({
      ...user,
      lastActiveAt: formatApiDateTime(user.lastActiveAt),
    })),
    isFallback: false,
  } satisfies ApiResult<MockCrmUser[]>;
}

export async function getOpenQuestions() {
  const result = await getJson<{ questions: ApiOpenQuestion[] }>(
    "/api/open-questions",
    { questions: [] },
  );

  if (result.isFallback) {
    return {
      data: [],
      isFallback: true,
      error: result.error,
    };
  }

  return {
    data: result.data.questions,
    isFallback: false,
  } satisfies ApiResult<OpenQuestion[]>;
}

export async function updateOpenQuestionStatus(
  questionId: number,
  status: OpenQuestion["status"],
) {
  try {
    const response = await csrfFetch(`/api/open-questions/${questionId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      throw new Error(
        errorBody.error ?? `API open question PATCH вернул ${response.status}`,
      );
    }

    const result = (await response.json()) as { question: OpenQuestion };

    return {
      data: result.question,
      isFallback: false,
    } satisfies ApiResult<OpenQuestion>;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "API обновления вопроса недоступно";

    console.warn(`${message}. Использован локальный fallback.`);

    return {
      data: null,
      isFallback: true,
      error: message,
    } satisfies ApiResult<null>;
  }
}
