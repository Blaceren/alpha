import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { getBalanceProvider } from "@/lib/exchange/balanceProvider";
import { resolveFirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";
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
      // FDCONF-1 — THIS WAS THE FORBIDDEN INFERENCE, IN A TASK GATE.
      //
      // It read `firstDepositConfirmed || depositAmount > 0 || totalDeposits > 0`,
      // so a learner completed a first-deposit task because a CUMULATIVE TOTAL
      // was non-zero — a total that a redeposit, a legacy simulation or an admin
      // edit can move without any first deposit ever having happened. And it
      // could not see a canonical first deposit at all, so the learners who
      // genuinely deposited through the Pocket ingress failed the very task that
      // deposit was supposed to complete.
      //
      // One question, one authority, no arithmetic.
      const firstDeposit = await resolveFirstDepositConfirmation(prisma, user.id);
      verified = firstDeposit.confirmed;
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
