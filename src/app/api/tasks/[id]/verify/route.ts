import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { getBalanceProvider } from "@/lib/exchange/balanceProvider";
import { prisma } from "@/lib/prisma";
import { completeProgressionTask } from "@/lib/taskProgression";
import { notFoundResponse, validateNumericParam } from "@/lib/validation";

type Props = { params: Promise<{ id: string }> };

async function tasksForUser(userId: number) {
  return prisma.task.findMany({
    include: {
      progress: { where: { userId } },
      reports: { where: { userId }, select: { status: true } },
    },
    orderBy: { stepNumber: "asc" },
  });
}

export async function POST(request: Request, { params }: Props) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const user = await requireUser();
    const { id } = await params;
    const step = validateNumericParam(id, "id");
    if (!step.success) return step.response;

    const task = await prisma.task.findUnique({ where: { stepNumber: step.id } });
    if (!task) return notFoundResponse("Задание не найдено");
    const account = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });

    let verified = false;
    let message = "Условие задания пока не выполнено";

    if (task.completionMethod === "pocket_postback") {
      verified = Boolean(
        account?.clickId &&
        account.traderId &&
        account.registrationStatus &&
        account.status === "connected",
      );
      message = verified ? "Регистрация Pocket подтверждена" : "Ожидаем Registration postback от Pocket";
    } else if (task.completionMethod === "deposit_postback") {
      verified = Boolean(
        account?.firstDepositConfirmed ||
        (account?.depositAmount ?? 0) > 0 ||
        (account?.totalDeposits ?? 0) > 0,
      );
      message = verified ? "Первый депозит подтверждён" : "Ожидаем депозитный postback от Pocket";
    } else if (task.completionMethod === "balance_check" && task.balanceThreshold) {
      if (!account?.traderId) {
        return NextResponse.json(
          { error: "TRADER_ID_REQUIRED", message: "Для проверки баланса нужен trader_id из Pocket postback" },
          { status: 400 },
        );
      }
      const result = await getBalanceProvider(account.provider).verifyCheckpoint(user.id, task.balanceThreshold);
      if (!result.ok && typeof result.balance !== "number") {
        return NextResponse.json(
          { error: "BALANCE_PROVIDER_UNAVAILABLE", message: result.message ?? "Проверка баланса недоступна. Повторите позже или обратитесь в поддержку." },
          { status: 503 },
        );
      }
      verified = result.ok && (result.balance ?? 0) >= task.balanceThreshold;
      message = result.message ?? message;
    } else {
      return NextResponse.json({ error: "Задание не поддерживает автоматическую проверку" }, { status: 400 });
    }

    if (!verified) return NextResponse.json({ ok: false, message }, { status: 409 });

    const completion = await completeProgressionTask(user.id, task.id);
    return NextResponse.json({
      ok: completion.completed,
      alreadyCompleted: completion.alreadyCompleted,
      xpAwarded: completion.xpAwarded,
      message,
      tasks: await tasksForUser(user.id),
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
