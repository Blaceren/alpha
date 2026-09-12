"use client";

import { useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { EmptyState, PageHeader, StatusPill, Tabs } from "@/components/ui";

type LeaderboardItem = {
  rank: number;
  displayName: string;
  level: number;
  xp: number;
  isCurrent: boolean;
};

const periods = [
  { id: "daily", label: "День" },
  { id: "weekly", label: "Неделя" },
  { id: "monthly", label: "Месяц" },
  { id: "all-time", label: "Всё время" },
];

export default function LeaderboardPage() {
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [period, setPeriod] = useState("all-time");

  useEffect(() => {
    fetch(`/api/leaderboard?period=${encodeURIComponent(period)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { items: LeaderboardItem[] }) => setItems(result.items ?? []))
      .catch(() => setItems([]));
  }, [period]);

  const topUsers = items.slice(0, 3);
  const currentUser = useMemo(() => items.find((item) => item.isCurrent), [items]);

  return (
    <ProtectedPage allowedRoles={["user", "admin"]}>
      <div className="space-y-6">
        <PageHeader
          kicker="Рейтинг"
          title="Лидерборд"
          description="Рейтинг участников по XP и уровню. Заблокированные и служебные аккаунты исключаются на backend."
        />

        <Tabs className="w-full sm:w-auto">
          {periods.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPeriod(item.id)}
              className={item.id === period ? "btn btn-primary min-h-9 px-3 py-1.5 text-xs" : "btn btn-ghost min-h-9 px-3 py-1.5 text-xs"}
            >
              {item.label}
            </button>
          ))}
        </Tabs>

        <section className="grid gap-4 md:grid-cols-3">
          {topUsers.map((item) => (
            <article key={`${item.rank}-${item.displayName}`} className="podium-card app-card p-5" data-rank={item.rank}>
              <div className="flex items-center justify-between">
                <span className="text-3xl font-black text-[var(--primary)]">#{item.rank}</span>
                <StatusPill>Уровень {item.level}</StatusPill>
              </div>
              <h2 className="mt-4 text-xl font-black text-[var(--text-primary)]">{item.displayName}</h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{item.xp} XP</p>
            </article>
          ))}
        </section>

        {currentUser ? (
          <div className="dashboard-primary app-card-flat flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-bold text-[var(--text-secondary)]">Ваше место</p>
              <p className="text-lg font-black text-[var(--text-primary)]">
                #{currentUser.rank} · {currentUser.displayName}
              </p>
            </div>
            <StatusPill>{currentUser.xp} XP</StatusPill>
          </div>
        ) : null}

        {items.length === 0 ? <EmptyState label="Рейтинг пока пуст" /> : null}

        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
              <tr>
                <th className="p-4">#</th>
                <th className="p-4">Пользователь</th>
                <th className="p-4">Уровень</th>
                <th className="p-4">XP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={`${item.rank}-${item.displayName}`}
                  className={`border-t border-[var(--border)] ${item === currentUser ? "bg-[var(--primary-soft)]" : ""}`}
                >
                  <td className="p-4 font-black text-[var(--primary)]">{item.rank}</td>
                  <td className="p-4 font-bold text-[var(--text-primary)]">{item.displayName}</td>
                  <td className="p-4 text-[var(--text-secondary)]">{item.level}</td>
                  <td className="p-4 text-[var(--text-secondary)]">{item.xp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ProtectedPage>
  );
}
