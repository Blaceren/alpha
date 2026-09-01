import { NextResponse } from "next/server";
import { z } from "zod";

export type ValidationDetail = {
  field: string;
  message: string;
};

export function validationErrorResponse(details: ValidationDetail[] = []) {
  return NextResponse.json(
    {
      error: "VALIDATION_ERROR",
      message: "Некорректные данные запроса",
      details,
    },
    { status: 400 },
  );
}

export function notFoundResponse(message = "Запись не найдена") {
  return NextResponse.json(
    {
      error: "NOT_FOUND",
      message,
    },
    { status: 404 },
  );
}

export async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function zodDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    message: issue.message,
  }));
}

export async function validateJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
) {
  const body = await parseJsonBody(request);
  const result = schema.safeParse(body);

  if (!result.success) {
    return {
      success: false as const,
      response: validationErrorResponse(zodDetails(result.error)),
      details: zodDetails(result.error),
    };
  }

  return {
    success: true as const,
    data: result.data as z.infer<T>,
  };
}

export function validateNumericParam(value: string, field = "id") {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    return {
      success: false as const,
      response: validationErrorResponse([
        { field, message: "Должно быть положительным числом" },
      ]),
    };
  }

  return {
    success: true as const,
    id,
  };
}

/**
 * THE PASSWORD RULE, AND NOTHING ELSE.
 *
 * Length is the only requirement. The three composition refinements that used
 * to sit on `registerSchema` — an uppercase letter, a lowercase letter, a digit
 * — are gone: they rejected long passphrases while accepting `Passw1`, and the
 * text that explained them was the most-read copy on the register page.
 *
 * The value is never trimmed and never normalised. A leading or trailing space
 * is part of the password, because the person typing it meant it to be.
 */
export const passwordSchema = z
  .string()
  .min(6, "Пароль должен быть не короче 6 символов");

export const loginSchema = z.object({
  email: z.string().trim().email("Введите корректный email").toLowerCase(),
  password: passwordSchema,
  captchaToken: z.string().trim().optional(),
});

/**
 * THE ONE PLACE A DISPLAY NAME IS DEFINED.
 *
 * `name` was optional with a floor of one character, and the register route
 * filled the gap with `Трейдер-####`. Two rules disagreed as a result: the
 * profile editor has always required 2..50, so a name the server generated
 * could be one the same server would refuse to accept as an edit. The name is
 * now required at the only moment it can be asked for honestly — registration —
 * and both surfaces read the same bounds.
 *
 * A display name, not a legal one. Trimmed before measuring, so whitespace
 * cannot buy length.
 */
export const nameSchema = z
  .string()
  .trim()
  .min(2, "Имя должно быть не короче 2 символов")
  .max(50, "Имя должно быть не длиннее 50 символов");

export const registerSchema = loginSchema.extend({
  name: nameSchema,
  referralCode: z.string().trim().min(1).max(100).optional(),
});

export const checkpointCheckSchema = z.object({}).strict();

export const simulatePostbackSchema = z.object({
  type: z.enum([
    "Registration",
    "Email Confirmation",
    "First Deposit",
    "Re-deposit",
    "Withdrawal",
  ]),
  amount: z.number().min(0, "Сумма не может быть отрицательной").optional(),
});

export const receivePostbackSchema = z
  .object({
    type: z.enum([
      "Registration",
      "Email Confirmation",
      "First Deposit",
      "Re-deposit",
      "Withdrawal",
      "Commission",
      "New Withdrawal",
      "Canceled Withdrawal",
      "Successful Withdrawal",
    ]).optional(),
    eventType: z.enum([
      "deposit",
      "trade",
      "balance",
      "account_connected",
      "account_rejected",
    ]).optional(),
    userId: z.number().int().positive().optional(),
    externalUserId: z.string().trim().min(1).optional(),
    externalAccountId: z.string().trim().min(1).max(100).optional(),
    trader_id: z.string().trim().min(1).optional(),
    traderId: z.string().trim().min(1).optional(),
    externalEventId: z.string().trim().min(1).optional(),
    amount: z.number().min(0, "Сумма не может быть отрицательной").optional(),
    currency: z.string().trim().min(1).max(16).optional(),
    status: z.string().trim().min(1).max(100).optional(),
    rejectionReason: z.string().trim().max(1000).optional(),
    click_id: z.string().trim().optional(),
    site_id: z.string().trim().optional(),
    cid: z.string().trim().optional(),
    ac: z.string().trim().optional(),
    sub_id1: z.string().trim().optional(),
    sub_id2: z.string().trim().optional(),
    sub_id3: z.string().trim().optional(),
    sub_id4: z.string().trim().optional(),
    sub_id5: z.string().trim().optional(),
    country: z.string().trim().optional(),
    promo: z.string().trim().optional(),
    device_type: z.string().trim().optional(),
    os_version: z.string().trim().optional(),
    browser: z.string().trim().optional(),
    link_type: z.string().trim().optional(),
    date_time: z.string().trim().optional(),
    visitor_id: z.string().trim().optional(),
    country_ip: z.string().trim().optional(),
    rawPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => value.type || value.eventType, {
    path: ["eventType"],
    message: "Нужно передать type или eventType",
  })
  .refine(
    (value) => value.userId || value.externalUserId || value.externalAccountId || value.trader_id || value.traderId,
    {
      path: ["userId"],
      message: "Нужно передать userId, externalUserId, externalAccountId или trader_id",
    },
  );

export const exchangeConnectSchema = z
  .object({
    externalAccountId: z.string().trim().max(100).optional(),
    email: z.string().trim().email("Введите корректный email").optional(),
    provider: z.enum(["sandbox", "manual", "real_placeholder"]).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.externalAccountId || value.email), {
    path: ["body"],
    message: "Нужно заполнить externalAccountId или email",
  });

export const exchangeVerifySchema = z.object({}).strict();

export const adminExchangeAccountUpdateSchema = z
  .object({
    status: z
      .enum(["not_connected", "pending", "connected", "rejected", "blocked"])
      .optional(),
    balance: z.number().min(0).optional(),
    depositAmount: z.number().min(0).optional(),
    tradesCount: z.number().int().min(0).optional(),
    rejectionReason: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    path: ["body"],
    message: "Нужно передать хотя бы одно поле",
  });

export const chatMessageSchema = z.object({
  channelId: z.number().int().positive().optional(),
  message: z
    .string()
    .trim()
    .min(1, "Сообщение не может быть пустым")
    .max(1000, "Сообщение не должно быть длиннее 1000 символов"),
});

export const notificationSettingsSchema = z.object({
  emailEnabled: z.boolean(),
  webPushEnabled: z.boolean(),
  telegramEnabled: z.boolean(),
});

export const openQuestionStatusSchema = z.object({
  status: z.enum(["не решено", "в обсуждении", "решено"]),
});

export const adminUserUpdateSchema = z
  .object({
    role: z.enum(["user", "admin", "support", "mentor", "moderator", "news_editor"]).optional(),
    status: z.enum(["active", "blocked"]).optional(),
    level: z.number().int().min(1).optional(),
    xp: z.number().int().min(0).optional(),
    mentorId: z.number().int().positive().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    path: ["body"],
    message: "Нужно передать хотя бы одно поле",
  });

export const adminTaskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    xpReward: z.number().int().min(0).optional(),
    rewardType: z.string().trim().min(1).optional(),
    isCheckpoint: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    path: ["body"],
    message: "Нужно передать хотя бы одно поле",
  });

export const adminRewardUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    type: z
      .enum([
        "lesson",
        "consultation",
        "guide",
        "xp",
        "chat_access",
        "analytics_access",
        "other",
      ])
      .optional(),
    status: z.string().trim().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    path: ["body"],
    message: "Нужно передать хотя бы одно поле",
  });

const adminNewsBaseSchema = z.object({
  title: z.string().trim().min(1),
  excerpt: z.string().trim().min(1),
  content: z.string().trim().min(1),
  category: z.string().trim().min(1),
  author: z.string().trim().min(1),
  coverImageUrl: z.string().trim().url().nullable().optional(),
  mediaUrl: z.string().trim().url().nullable().optional(),
  mediaType: z.enum(["image", "video"]).nullable().optional(),
  status: z.enum(["draft", "published"]),
  publishedAt: z.string().datetime().optional(),
});

export const adminNewsCreateSchema = adminNewsBaseSchema.extend({
  status: z.enum(["draft", "published"]).default("published"),
});

export const adminNewsUpdateSchema = adminNewsBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    path: ["body"],
    message: "Нужно передать хотя бы одно поле",
  });

export const supportMessageSchema = z
  .object({
    message: z
      .string()
      .trim()
      .max(2000, "Сообщение не должно быть длиннее 2000 символов")
      .optional(),
    fileAssetId: z.number().int().positive().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.message || value.fileAssetId), {
    path: ["body"],
    message: "Нужно заполнить сообщение или прикрепить файл",
  });

export const supportStaffMessageSchema = supportMessageSchema.extend({
  internalNote: z.boolean(),
});

export const supportDialogUpdateSchema = z
  .object({
    status: z.enum(["new", "in_progress", "waiting_user", "closed"]).optional(),
    assignedToId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    path: ["body"],
    message: "Нужно передать хотя бы одно поле",
  });

export const taskReportSubmitSchema = z
  .object({
    reportText: z
      .string()
      .trim()
      .max(5000, "Текст отчёта не должен быть длиннее 5000 символов")
      .optional(),
    reportUrl: z
      .string()
      .trim()
      .url("Введите корректную ссылку")
      .max(2048, "Ссылка слишком длинная")
      .optional(),
    fileName: z.string().trim().max(255, "Имя файла слишком длинное").optional(),
    fileAssetId: z.number().int().positive().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.reportText || value.reportUrl || value.fileAssetId), {
    path: ["body"],
    message: "Нужно заполнить текст, ссылку или прикрепить файл",
  });

export const taskReportReviewSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    reviewComment: z
      .string()
      .trim()
      .max(2000, "Комментарий не должен быть длиннее 2000 символов")
      .optional(),
  })
  .strict();

export const testerFeedbackSubmitSchema = z
  .object({
    type: z.enum(["bug", "ux", "question", "idea", "other"]),
    severity: z.enum(["low", "medium", "high", "blocker"]),
    title: z
      .string()
      .trim()
      .min(1, "Заголовок обязателен")
      .max(200, "Заголовок не должен быть длиннее 200 символов"),
    message: z
      .string()
      .trim()
      .min(1, "Сообщение обязательно")
      .max(5000, "Сообщение не должно быть длиннее 5000 символов"),
    pageUrl: z
      .string()
      .trim()
      .max(1000, "URL страницы не должен быть длиннее 1000 символов")
      .optional(),
    browserInfo: z
      .string()
      .trim()
      .max(2000, "Информация о браузере не должна быть длиннее 2000 символов")
      .optional(),
  })
  .strict();

export const adminTesterFeedbackUpdateSchema = z
  .object({
    status: z
      .enum(["new", "triaged", "in_progress", "resolved", "rejected", "closed"])
      .optional(),
    adminComment: z
      .string()
      .trim()
      .max(5000, "Комментарий не должен быть длиннее 5000 символов")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    path: ["body"],
    message: "Нужно передать хотя бы одно поле",
  });
