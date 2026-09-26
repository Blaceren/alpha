"use client";

import { useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { csrfFetch } from "@/lib/api";

type DailyReward = {
  id: number;
  rewardDate: string;
  streak: number;
  xpGranted: number;
};

export default function DailyRewardsPage() {
  const [items, setItems] = useState<DailyReward[]>([]);
  const [claimedToday, setClaimedToday] = useState(false);
  const [status, setStatus] = useState("");

  const currentStreak = useMemo(() => items[0]?.streak ?? 0, [items]);
  const streakProgress = currentStreak % 7 || (currentStreak > 0 ? 7 : 0);

  async function load() {
    const response = await fetch("/api/rewards/daily", { cache: "no-store" });
    if (!response.ok) return;
    const result = (await response.json()) as { items: DailyReward[]; claimedToday: boolean };
    setItems(result.items);
    setClaimedToday(result.claimedToday);
  }

  useEffect(() => {
    load();
  }, []);

  async function claim() {
    setStatus("Проверка...");
    const response = await csrfFetch("/api/rewards/daily", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const result = (await response.json().catch(() => ({}))) as { duplicate?: boolean };
    setStatus(result.duplicate ? "Награда за сегодня уже получена" : "Ежедневная награда получена");
    await load();
  }

  return (
    <ProtectedPage allowedRoles={["user"]}>
      <div className="space-y-6">
        <PageHeader
          kicker="Daily streak"
          title="Ежедневная награда"
          description="Награда выдаётся один раз в день. Каждый 7-й день серии даёт повышенный XP-бонус."
        />

        <section className="dashboard-primary app-card grid gap-6 p-6 md:p-7 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm text-[var(--text-muted)]">Текущая серия</p>
            <div className="mt-2 text-6xl font-black text-[var(--text-primary)]">{currentStreak}</div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">дней подряд</p>
            <button type="button" disabled={claimedToday} onClick={claim} className="btn btn-primary mt-5 disabled:opacity-50">
              {claimedToday ? "Уже получено" : "Получить награду"}
            </button>
            {status ? <p className="mt-3 text-sm text-[var(--text-secondary)]">{status}</p> : null}
          </div>
          <div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {Array.from({ length: 7 }).map((_, index) => {
                const day = index + 1;
                const active = day <= streakProgress;
                return (
                  <div key={day} data-done={active} className={`game-card rounded-2xl border p-3 text-center sm:p-4 ${active ? "border-blue-200 bg-blue-50 text-blue-800" : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]"}`}>
                    <div className="text-xs">День</div>
                    <div className="text-lg font-black">{day}</div>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-sm text-[var(--text-secondary)]">На 7-й день серия приносит усиленный XP-бонус.</p>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">История</h2>
            <StatusPill>{items.length} записей</StatusPill>
          </div>
          {items.length === 0 ? <EmptyState label="Истории ежедневных наград пока нет" /> : null}
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="reward-card app-card-flat flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span className="font-bold text-[var(--text-primary)]">{item.rewardDate}</span>
                <span className="text-[var(--text-secondary)]">серия {item.streak}</span>
                <span className="badge">+{item.xpGranted} XP</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ProtectedPage>
  );
}
