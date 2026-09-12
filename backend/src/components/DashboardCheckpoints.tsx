"use client";

import { useEffect, useState } from "react";
import { checkCheckpoint } from "@/lib/api";
import {
  getCheckpointStatusLabel,
  getProgressMessage,
  getProgressStatusLabel,
} from "@/utils/checkpointUtils";
import type { Checkpoint, ProgressStatus } from "@/types/checkpoints";

export function DashboardCheckpoints() {
  const [state, setState] = useState<{
    checkpoint: Checkpoint;
    exchange: { balance: number; lastCheckedAt: string };
    progressStatus: ProgressStatus;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (result: {
          user?: {
            checkpoint?: (Checkpoint & { updatedAt?: string }) | null;
            progressStatus?: ProgressStatus;
          } | null;
        } | null) => {
          if (!result?.user?.checkpoint) {
            return;
          }

          setState({
            checkpoint: result.user.checkpoint,
            exchange: {
              balance: result.user.checkpoint.currentBalance,
              lastCheckedAt: result.user.checkpoint.updatedAt ?? "Проверка ещё не выполнялась",
            },
            progressStatus: result.user.progressStatus ?? "active",
          });
        },
      )
      .catch(() => setError("Не удалось загрузить checkpoint"));
  }, []);

  async function checkProgress() {
    if (!state) return;
    setError("");
    const result = await checkCheckpoint(state.checkpoint.id);
    if (!result.data) {
      setError(result.error ?? "Не удалось проверить checkpoint");
      return;
    }
    const nextState = result.data;

    setState(nextState);
  }

  if (!state) {
    return <section className="app-card p-5"><h2 className="section-title">Контрольные точки</h2><p className="mt-3 text-sm text-[var(--text-secondary)]">{error || "Контрольная точка ещё не назначена."}</p></section>;
  }

  return (
    <section className="app-card p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="section-title">Контрольные точки</h2>
          <div className="mt-4 grid gap-3 text-sm text-[var(--text-secondary)] md:grid-cols-2 [&>p]:rounded-lg [&>p]:border [&>p]:border-[var(--border)] [&>p]:bg-[var(--surface-elevated)] [&>p]:p-3">
            <p>Название: {state.checkpoint.title}</p>
            <p>Требуемый баланс: ${state.checkpoint.requiredBalance}</p>
            <p>Последний проверенный баланс: ${state.checkpoint.currentBalance}</p>
            <p>Статус checkpoint: {getCheckpointStatusLabel(state.checkpoint.status)}</p>
            <p>Статус прогресса: {getProgressStatusLabel(state.progressStatus)}</p>
            <p>Дата проверки: {state.exchange.lastCheckedAt}</p>
          </div>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            {getProgressMessage(state.progressStatus)}
          </p>
          {error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
          <button type="button" onClick={checkProgress} className="btn btn-secondary">
            Проверить прогресс
          </button>
        </div>
      </div>
    </section>
  );
}
