"use client";

import { useEffect, useState } from "react";
import { ApiLoadState } from "@/components/ApiLoadState";
import { ProtectedPage } from "@/components/ProtectedPage";
import { Badge, Card, PageHeader, ProgressBar, StatusPill } from "@/components/ui";
import { levelRankGroups } from "@/data/mockLevelRanks";
import type { MockLevel, LevelStatus } from "@/data/mockLevels";
import { mockUser } from "@/data/mockUser";
import { getLevels, getMe, type ApiMe } from "@/lib/api";
import {
  getLevelProgressPercent,
  getRankBadge,
  getRankTitle,
  getXpToNextLevel,
} from "@/utils/levelUtils";

const statusClass: Record<LevelStatus, string> = {
  пройден: "border-emerald-200 bg-emerald-50 text-emerald-800",
  текущий: "border-blue-200 bg-blue-50 text-blue-800",
  заблокирован: "border-slate-200 bg-slate-100 text-slate-600",
};

export default function LevelsPage() {
  const [levels, setLevels] = useState<MockLevel[]>([]);
  const [user, setUser] = useState<ApiMe>({ ...mockUser, name: "Пользователь", email: "", level: 1, xp: { current: 0, target: 300 } });
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const nextLevelXp = user.xp.target;
  const xpToNextLevel = getXpToNextLevel(user.xp.current, nextLevelXp);
  const progressPercent = getLevelProgressPercent(user.xp.current, nextLevelXp);
  const currentRank = getRankTitle(user.level);
  const currentBadge = getRankBadge(user.level);

  useEffect(() => {
    Promise.all([getLevels(), getMe()]).then(([levelsResult, userResult]) => {
      setLevels(levelsResult.data);
      setUser(userResult.data);
      setIsFallback(levelsResult.isFallback || userResult.isFallback);
      setIsLoading(false);
    });
  }, []);

  return (
    <ProtectedPage allowedRoles={["user", "admin", "support", "mentor"]}>
      <div className="space-y-6">
        <PageHeader
          kicker="Уровни"
          title="Система уровней"
          description="Всего 16 уровней. Уровень растёт за выполнение заданий и активность рефералов, но никогда не понижается."
        />

        <ApiLoadState isLoading={isLoading} isFallback={isFallback} />

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <Card className="dashboard-primary">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-[var(--text-muted)]">Текущий уровень</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-5xl font-black text-[var(--text-primary)]">{user.level}</span>
                  <div>
                    <div className="font-black text-[var(--text-primary)]">{currentRank}</div>
                    <div className="text-sm text-[var(--text-secondary)]">{currentBadge} · бейдж уровня</div>
                  </div>
                </div>
              </div>
              <Badge>{progressPercent}%</Badge>
            </div>
            <div className="mt-6">
              <div className="mb-2 flex justify-between gap-3 text-sm text-[var(--text-secondary)]">
                <span>{user.xp.current} / {nextLevelXp} XP</span>
                <span>до следующего: {xpToNextLevel} XP</span>
              </div>
              <ProgressBar value={progressPercent} />
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="shadow-none">
              <h2 className="font-black text-[var(--text-primary)]">Правило прогресса</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                Уровень никогда не понижается. Если баланс упал, прогресс может заморозиться, но уровень остаётся.
              </p>
            </Card>
            <Card className="shadow-none">
              <h2 className="font-black text-[var(--text-primary)]">Реферальный XP</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                Приглашение друга даёт XP. Когда приглашённый друг повышает уровень, пригласивший тоже получает XP.
              </p>
            </Card>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">Ранги</h2>
            <StatusPill>бейджи-заглушки</StatusPill>
          </div>
          <div className="grid gap-4 md:grid-cols-5">
            {levelRankGroups.map((rank) => (
              <div key={rank.title} className="app-card-interactive app-card-flat p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] font-black text-[var(--primary)]">
                  {rank.title.slice(0, 1)}
                </div>
                <div className="font-black text-[var(--text-primary)]">{rank.title}</div>
                <div className="mt-2 text-sm text-[var(--text-secondary)]">Уровни {rank.levels}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title mb-4">Все уровни</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {levels.map((level) => (
              <div key={level.id} className="game-card app-card-flat p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-[var(--text-muted)]">Уровень {level.id}</div>
                    <h3 className="mt-2 text-lg font-black text-[var(--text-primary)]">{level.title}</h3>
                  </div>
                  <span className="text-2xl">{level.status === "пройден" ? "✓" : level.status === "текущий" ? "•" : "○"}</span>
                </div>
                <p className="mt-3 text-sm text-[var(--text-secondary)]">Нужно XP: {level.requiredXp}</p>
                <div className={`mt-4 inline-flex rounded-full border px-3 py-1 text-xs font-bold ${statusClass[level.status]}`}>
                  {level.status}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ProtectedPage>
  );
}
