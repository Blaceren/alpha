"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TaskReportForm } from "@/components/TaskReportForm";
import { taskStatusLabels } from "@/data/mockTasks";
import { completeTask, csrfFetch, verifyTask } from "@/lib/api";
import type { MockTask, TaskStatus } from "@/types/tasks";

type TaskChainProps = {
  initialTasks: MockTask[];
};

const statusClasses: Record<TaskStatus, string> = {
  completed: "border-transparent bg-[var(--success-soft)] text-[var(--success)]",
  active: "border-transparent bg-[var(--primary-soft)] text-[var(--primary)]",
  locked: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]",
  frozen: "border-transparent bg-[var(--accent-soft)] text-[var(--accent)]",
};

function getTaskAccent(status: TaskStatus) {
  if (status === "completed") return "✓";
  if (status === "active") return "•";
  if (status === "frozen") return "!";
  return "○";
}

export function TaskChain({ initialTasks }: TaskChainProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [showExistingAccountHelp, setShowExistingAccountHelp] = useState(false);
  const [checkpoint, setCheckpoint] = useState<{ stepId: number; status: string } | null>(null);
  const [isPocketRegistrationConfirmed, setIsPocketRegistrationConfirmed] = useState(false);
  const [actionError, setActionError] = useState("");
  const [openingPocketTaskId, setOpeningPocketTaskId] = useState<number | null>(null);

  const updateReportStatus = useCallback((taskId: number, reportStatus: MockTask["reportStatus"]) => {
    setTasks((currentTasks) =>
      currentTasks.map((task) => (task.id === taskId ? { ...task, reportStatus } : task)),
    );
  }, []);

  useEffect(() => {
    setTasks(initialTasks);
    fetch("/api/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result: { user?: {
        checkpoint?: { stepId: number; status: string } | null;
        exchangeAccount?: { status?: string; registrationStatus?: boolean; traderId?: string | null } | null;
      } } | null) => {
        setCheckpoint(result?.user?.checkpoint ?? null);
        const exchangeAccount = result?.user?.exchangeAccount;
        setIsPocketRegistrationConfirmed(Boolean(
          exchangeAccount?.registrationStatus ||
            exchangeAccount?.status === "connected" ||
            exchangeAccount?.traderId,
        ));
      })
      .catch(() => {
        setCheckpoint(null);
        setIsPocketRegistrationConfirmed(false);
      });
  }, [initialTasks]);

  async function completeActiveTask(task: MockTask) {
    if (checkpoint?.status === "frozen") return;
    setActionError("");
    if (task.completionMethod === "pocket_postback") {
      if (openingPocketTaskId === task.id) return;

      setOpeningPocketTaskId(task.id);
      const response = await csrfFetch("/api/exchange/referral-link", { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as {
        referralUrl?: string;
        message?: string;
        error?: string;
      };

      if (!response.ok || !result.referralUrl) {
        setOpeningPocketTaskId(null);
        setActionError(result.message ?? result.error ?? "Не удалось создать ссылку Pocket");
        return;
      }

      window.location.assign(result.referralUrl);
      return;
    }
    const result = ["deposit_postback", "balance_check"].includes(task.completionMethod ?? "")
      ? await verifyTask(task.id)
      : await completeTask(task.id);
    if (result.isFallback || !result.data.length) {
      setActionError(result.error ?? "Не удалось выполнить задание");
      return;
    }
    setTasks(result.data);
  }

  const progressFrozen = checkpoint?.status === "frozen";
  const completedCount = useMemo(() => tasks.filter((task) => task.status === "completed").length, [tasks]);
  const activeTask = tasks.find((task) => task.status === "active");

  return (
    <div className="space-y-5">
      <section className="dashboard-primary app-card grid gap-4 p-5 md:grid-cols-3 [&>div]:rounded-2xl [&>div]:border [&>div]:border-[var(--border)] [&>div]:bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] [&>div]:p-5">
        <div>
          <p className="text-xs font-bold uppercase text-[var(--text-muted)]">Выполнено</p>
          <p className="mt-2 text-4xl font-black text-[var(--text-primary)]">{completedCount}/{tasks.length}</p>
          <div className="progress-track mt-4">
            <div className="progress-fill" style={{ width: `${Math.round((completedCount / tasks.length) * 100)}%` }} />
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-[var(--text-muted)]">Активный шаг</p>
          <p className="mt-2 text-lg font-black text-[var(--text-primary)]">{activeTask?.title ?? "Нет активного шага"}</p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Следующее действие в цепочке обучения</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-[var(--text-muted)]">Checkpoint</p>
          <p className="mt-2 text-lg font-black text-[var(--text-primary)]">
            {progressFrozen ? "Прогресс заморожен" : "Прогресс активен"}
          </p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Уровень и награды не сбрасываются</p>
        </div>
      </section>

      {progressFrozen ? (
        <section className="rounded-2xl border border-[color-mix(in_srgb,var(--accent)_32%,var(--border))] bg-[var(--accent-soft)] p-5 text-[var(--text-primary)]">
          <strong>Прогресс заморожен.</strong> Восстановите требуемый баланс и повторите проверку checkpoint.
        </section>
      ) : null}

      {actionError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{actionError}</p> : null}

      <div className="relative space-y-4 before:absolute before:bottom-8 before:left-6 before:top-8 before:w-px before:bg-[linear-gradient(var(--primary),var(--border-strong))] md:before:left-7">
        {tasks.map((task) => {
          const isLocked = task.status === "locked" || task.status === "frozen";
          const isCompleted = task.status === "completed";
          const isPocketRegistrationTask = task.code === "lvl_01_pocket_registration";
          const reportBlocksCompletion = task.requiresReport && task.reportStatus !== "approved";
          const isOpeningPocket = openingPocketTaskId === task.id;
          const isDisabled =
            isLocked ||
            isCompleted ||
            progressFrozen ||
            reportBlocksCompletion ||
            isOpeningPocket ||
            (isPocketRegistrationTask && isPocketRegistrationConfirmed);
          const isCheckpointTask = task.id === checkpoint?.stepId;
          const buttonLabel = isLocked
            ? isCheckpointTask
              ? task.actionLabel
              : "Заблокировано"
            : isCompleted
              ? "Выполнено"
              : task.actionLabel;

          return (
            <section key={task.id} className={`game-card app-card-flat relative ${isLocked ? "p-4 pl-5 md:p-5" : "p-5 pl-6 md:p-6"}`} data-state={task.status}>
              <div className={`flex flex-col lg:flex-row lg:items-start lg:justify-between ${isLocked ? "gap-3" : "gap-5"}`}>
                <div className="flex gap-4">
                  <div className={`relative z-10 flex shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] font-black text-[var(--primary)] ${isLocked ? "h-10 w-10 text-base shadow-none" : "h-14 w-14 text-xl shadow-[var(--blue-glow)]"}`}>
                    {getTaskAccent(task.status)}
                  </div>
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="status-pill">Шаг {task.id}</span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClasses[task.status]}`}>
                        {taskStatusLabels[task.status]}
                      </span>
                      {task.requiresReport ? <span className="badge">нужен отчёт</span> : null}
                      {isCheckpointTask ? <span className="badge">checkpoint</span> : null}
                    </div>
                    <div>
                      <h2 className={`font-black tracking-[-0.02em] text-[var(--text-primary)] ${isLocked ? "text-lg" : "text-2xl"}`}>{task.title}</h2>
                      <p className={`mt-2 max-w-3xl text-[var(--text-secondary)] ${isLocked ? "line-clamp-1 text-sm" : ""}`}>{task.description}</p>
                    </div>
                    <div className="text-sm text-[var(--text-secondary)]">
                      Награда: <span className="font-black text-[var(--text-primary)]">{task.reward}</span>
                    </div>

                    {isPocketRegistrationTask ? (
                      <div className="space-y-3">
                        <button type="button" onClick={() => setShowExistingAccountHelp((current) => !current)} className="btn btn-secondary">
                          Что делать, если у меня уже есть аккаунт?
                </button>
                        {showExistingAccountHelp ? (
                          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
                            Используйте отдельный сценарий для существующего аккаунта — там перечислены доступные шаги без выдуманной автоматизации.
                            <Link href="/exchange/existing-account" className="btn btn-secondary mt-3 w-fit">Открыть инструкцию</Link>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {task.requiresReport ? (
                      <TaskReportForm taskId={task.id} reportStatus={task.reportStatus ?? null} onStatusChange={updateReportStatus} />
                    ) : null}
                  </div>
                </div>

                {task.kind === "lesson" && task.code && !isLocked && !isCompleted && !progressFrozen ? (
                  <Link href={`/tasks/${task.code}`} className="btn btn-primary min-w-44">
                    Начать урок
                  </Link>
                ) : isPocketRegistrationTask && isPocketRegistrationConfirmed ? (
                  <span className="status-pill shrink-0 text-[var(--success)]">
                    Pocket подтверждён
                  </span>
                ) : isLocked && !isCheckpointTask ? (
                  <span className="status-pill shrink-0">Заблокировано</span>
                ) : (
                  <button
                    type="button"
                    disabled={isDisabled}
                    onClick={() => completeActiveTask(task)}
                    className="btn btn-primary min-w-44 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {buttonLabel}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
