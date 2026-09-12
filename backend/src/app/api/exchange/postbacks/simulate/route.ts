import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireAdmin,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { buildSimulatedPostbackAccountUpdate } from "@/lib/exchange/postbackProcessor";
import type { SimulatedPostbackType } from "@/lib/exchange/postbackProcessor";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  notFoundResponse,
  simulatePostbackSchema,
  validateJsonBody,
} from "@/lib/validation";

type AllowedPostbackType = SimulatedPostbackType;

function getDefaultAmount(type: AllowedPostbackType) {
  if (type === "First Deposit") return 500;
  if (type === "Re-deposit") return 300;
  if (type === "Withdrawal") return 200;
  return 0;
}

async function getTasksWithProgress(userId: number) {
  return prisma.task.findMany({
    include: {
      progress: {
        where: { userId },
      },
    },
    orderBy: { stepNumber: "asc" },
  });
}

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  const parsed = await validateJsonBody(request, simulatePostbackSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const postbackType = parsed.data.type;
  let currentUser;

  try {
    currentUser = await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const limit = rateLimit(`postback:simulate:${currentUser.id}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });

  if (!limit.allowed) {
    await createAuditLog({
      userId: currentUser.id,
      action: "RATE_LIMITED",
      entityType: "API_ROUTE",
      entityId: "/api/exchange/postbacks/simulate",
      metadata: { resetAt: limit.resetAt },
      request,
    });

    return rateLimitedResponse();
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    include: {
      exchangeAccount: true,
    },
  });

  if (!user?.exchangeAccount) {
    return notFoundResponse("Биржевой аккаунт не найден");
  }

  const amount = parsed.data.amount ?? getDefaultAmount(postbackType);

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.postbackEvent.create({
      data: {
        exchangeAccountId: user.exchangeAccount!.id,
        type: postbackType,
        eventType: postbackType,
        amount,
        status: "обработано",
        rawPayload: JSON.stringify({
          event: postbackType,
          amount,
          source: "mock-api",
        }),
        payload: {
          event: postbackType,
          amount,
          source: "mock-api",
        },
      },
    });

    const data = buildSimulatedPostbackAccountUpdate(postbackType, amount);

    const exchangeAccount = await tx.exchangeAccount.update({
      where: { id: user.exchangeAccount!.id },
      data,
      include: {
        postbackEvents: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (postbackType === "First Deposit") {
      const depositTask = await tx.task.findUnique({ where: { stepNumber: 4 } });
      const nextTask = await tx.task.findUnique({ where: { stepNumber: 5 } });

      if (depositTask) {
        await tx.userTaskProgress.update({
          where: {
            userId_taskId: {
              userId: user.id,
              taskId: depositTask.id,
            },
          },
          data: { status: "completed" },
        });
      }

      if (nextTask) {
        const nextProgress = await tx.userTaskProgress.findUnique({
          where: {
            userId_taskId: {
              userId: user.id,
              taskId: nextTask.id,
            },
          },
        });

        if (nextProgress?.status === "locked") {
          await tx.userTaskProgress.update({
            where: {
              userId_taskId: {
                userId: user.id,
                taskId: nextTask.id,
              },
            },
            data: { status: "active" },
          });
        }
      }
    }

    return { event, exchangeAccount };
  });

  await createAuditLog({
    userId: user.id,
    action: "POSTBACK_SIMULATED",
    entityType: "PostbackEvent",
    entityId: result.event.id,
    metadata: {
      type: result.event.type,
      amount: result.event.amount,
      status: result.event.status,
    },
    request,
  });

  return NextResponse.json({
    postback: result.event,
    exchangeAccount: result.exchangeAccount,
    tasks: await getTasksWithProgress(user.id),
  });
}
