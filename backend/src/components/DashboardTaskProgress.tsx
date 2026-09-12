"use client";

import Link from "next/link";
import type { MockTask } from "@/types/tasks";

type DashboardTaskProgressProps = {
  initialTasks: MockTask[];
  currentTaskFallback: string;
  freezeStatus: string;
};

export function DashboardTaskProgress({
  initialTasks,
  currentTaskFallback,
  freezeStatus,
}: DashboardTaskProgressProps) {
  const tasks = initialTasks;

  const completedSteps = tasks.filter((task) => task.status === "completed");
  const activeTask = tasks.find((task) => task.status === "active");
  const lockedSteps = tasks.filter(
    (task) => task.status === "locked" || task.status === "frozen",
  );
  const chainProgress = `выполнено ${completedSteps.length} из ${tasks.length}`;

  return (
    <>
      <section className="dashboard-primary app-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="section-title">Прогресс по цепочке заданий</h2>
            <p className="mt-2 text-[var(--text-secondary)]">{chainProgress}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Текущий активный шаг: {activeTask?.title ?? "нет активного шага"}
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Статус заморозки:{" "}
              {freezeStatus === "frozen" ? "Прогресс заморожен" : "Прогресс активен"}
            </p>
          </div>
          <Link href="/tasks" className="btn btn-secondary">
            Открыть задания
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="premium-preview app-card p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <h2 className="section-title">Текущий активный шаг</h2>
            <span className="status-pill">В процессе</span>
          </div>
          <p className="mt-4 text-[var(--text-secondary)]">
            {activeTask
              ? `${activeTask.title}: ${activeTask.description}`
              : currentTaskFallback}
          </p>
        </section>

        <section className="app-card p-5">
          <h2 className="section-title">Следующие закрытые шаги</h2>
          <div className="mt-4 space-y-3">
            {lockedSteps.map((step) => (
              <div
                key={step.id}
                className="game-card rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3"
                data-state={step.status}
              >
                <div className="font-bold text-[var(--text-primary)]">{step.title}</div>
                <div className="mt-1 text-sm text-[var(--text-muted)]">
                  {step.status === "frozen" ? "Заморожено" : "Заблокировано"}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
