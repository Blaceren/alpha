"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiLoadState } from "@/components/ApiLoadState";
import { DashboardCheckpoints } from "@/components/DashboardCheckpoints";
import { DashboardExchangeStatus } from "@/components/DashboardExchangeStatus";
import { DashboardNotifications } from "@/components/DashboardNotifications";
import { DashboardTaskProgress } from "@/components/DashboardTaskProgress";
import { ProtectedPage } from "@/components/ProtectedPage";
import type { MockReward } from "@/data/mockRewards";
import type { MockTask } from "@/types/tasks";
import { mockUser } from "@/data/mockUser";
import { getMe, getRewards, getTasks, type ApiMe } from "@/lib/api";
import {
  getLevelProgressPercent,
  getRankBadge,
  getRankTitle,
} from "@/utils/levelUtils";

type LeaderboardPreviewItem = {
  rank: number;
  displayName: string;
  xp: number;
  isCurrent: boolean;
};

const emptyUser = {
  ...mockUser,
  id: "user-loading",
  name: "Пользователь",
  email: "",
  level: 1,
  xp: { current: 0, target: 300 },
  currentTask: "Загрузка...",
  freezeStatus: "active",
  referrals: { link: "", invitedCount: 0, earnedXp: 0, users: [] },
  exchange: { account: "не подключён", depositConfirmed: false, balance: 0, currency: "USD" },
  notifications: { email: false, webPush: false, telegramBot: false },
};

export default function DashboardPage() {
  const [user, setUser] = useState<ApiMe>(emptyUser);
  const [tasks, setTasks] = useState<MockTask[]>([]);
  const [rewards, setRewards] = useState<MockReward[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardPreviewItem[]>([]);
  const [dailyStreak, setDailyStreak] = useState(0);
  const [showWelcome, setShowWelcome] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    setShowWelcome(new URLSearchParams(window.location.search).get("welcome") === "1");
    Promise.all([getMe(), getTasks(), getRewards()]).then(
      ([userResult, tasksResult, rewardsResult]) => {
        setUser(userResult.data);
        setTasks(tasksResult.data);
        setRewards(rewardsResult.data);
        setIsFallback(
          userResult.isFallback ||
            tasksResult.isFallback ||
            rewardsResult.isFallback,
        );
        setIsLoading(false);
      },
    );

    fetch("/api/leaderboard?period=all-time", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { items: [] })
      .then((result: { items?: LeaderboardPreviewItem[] }) => setLeaderboard(result.items ?? []))
      .catch(() => setLeaderboard([]));
    fetch("/api/rewards/daily", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { items: [] })
      .then((result: { items?: Array<{ streak: number }> }) => setDailyStreak(result.items?.[0]?.streak ?? 0))
      .catch(() => setDailyStreak(0));
  }, []);

  const rank = getRankTitle(user.level);
  const badge = getRankBadge(user.level);
  const progressPercent = getLevelProgressPercent(
    user.xp.current,
    user.xp.target,
  );
  const activeTask = tasks.find((task) => task.status === "active");
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const lockedTasks = tasks.filter((task) => task.status === "locked" || task.status === "frozen");
  const nextReward = rewards.find((reward) => reward.status !== "получено") ?? rewards[0];
  const currentLeaderboardEntry = leaderboard.find((item) => item.isCurrent);

  return (
    <ProtectedPage allowedRoles={["user", "admin", "support", "mentor"]}>
      <div className="space-y-7">
        {showWelcome ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Аккаунт готов. Начните с активного задания — прогресс, отчёты и награды сохраняются автоматически.
            <Link href="/tasks" className="ml-2 font-bold underline">Открыть первый шаг</Link>
          </section>
        ) : null}
        <section className="app-workspace grid lg:grid-cols-[5rem_minmax(0,1fr)]">
          <aside className="workspace-rail hidden flex-col items-center gap-4 p-4 lg:flex">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--primary)] text-sm font-black text-white shadow-[var(--blue-glow)]">
              TQ
            </div>
            {["К", "З", "У", "Н", "Б", "Ч"].map((item, index) => (
              <div
                key={item}
                className={`grid h-10 w-10 place-items-center rounded-xl text-xs font-black ${
                  index === 0 ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--text-muted)]"
                }`}
              >
                {item}
              </div>
            ))}
          </aside>

          <div className="min-w-0">
            <div className="preview-topbar flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="page-kicker">Кабинет</p>
                <h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-[var(--text-primary)] md:text-5xl">
                  С возвращением, {user.name}
                </h1>
                <p className="mt-2 max-w-3xl text-[var(--text-secondary)]">
                  Главный экран прогресса: активный шаг, XP, награды, биржа и контрольные точки в одном рабочем поле.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="badge">Уровень {user.level}</span>
                <span className="status-pill">{rank}</span>
                <span className="status-pill">Биржа: {user.exchange.account}</span>
              </div>
            </div>

            <div className="dashboard-console-grid grid gap-5 p-5 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="dashboard-primary app-card-flat p-5 md:p-6">
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="grid h-16 w-16 place-items-center rounded-[1.25rem] bg-[var(--primary)] text-3xl font-black text-white shadow-[var(--blue-glow)]">
                      {String(badge).slice(0, 1)}
                    </div>
                    <h2 className="mt-5 text-2xl font-black text-[var(--text-primary)]">Advanced Trend Strategy</h2>
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">
                      {user.xp.current} / {user.xp.target} XP - прогресс {progressPercent}%
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 md:min-w-[24rem]">
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <p className="text-xs font-bold uppercase text-[var(--text-muted)]">Активный шаг</p>
                      <p className="mt-2 font-black text-[var(--text-primary)]">{activeTask?.title ?? user.currentTask}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <p className="text-xs font-bold uppercase text-[var(--text-muted)]">Следующая награда</p>
                      <p className="mt-2 font-black text-[var(--text-primary)]">{nextReward?.title ?? "Награда"}</p>
                    </div>
                  </div>
                </div>

                <div className="progress-track mt-6">
                  <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-4">
                  <Link href="/tasks" className="metric-tile app-card-interactive app-card-flat p-4 pl-5">
                    <div className="text-3xl font-black text-[var(--text-primary)]">{completedTasks}/{tasks.length}</div>
                    <div className="text-xs font-semibold text-[var(--text-muted)]">заданий выполнено</div>
                  </Link>
                  <Link href="/leaderboard" className="metric-tile app-card-interactive app-card-flat p-4 pl-5">
                    <div className="text-3xl font-black text-[var(--text-primary)]">{currentLeaderboardEntry ? `#${currentLeaderboardEntry.rank}` : "—"}</div>
                    <div className="text-xs font-semibold text-[var(--text-muted)]">место в рейтинге</div>
                  </Link>
                  <Link href="/rewards/daily" className="metric-tile app-card-interactive app-card-flat p-4 pl-5">
                    <div className="text-3xl font-black text-[var(--text-primary)]">{dailyStreak}</div>
                    <div className="text-xs font-semibold text-[var(--text-muted)]">дней streak</div>
                  </Link>
                  <Link href="/tasks" className="metric-tile app-card-interactive app-card-flat p-4 pl-5">
                    <div className="text-3xl font-black text-[var(--text-primary)]">{lockedTasks.length}</div>
                    <div className="text-xs font-semibold text-[var(--text-muted)]">закрытых шагов</div>
                  </Link>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/tasks" className="btn btn-primary">
                    Открыть задания
                  </Link>
                  <Link href="/rewards" className="btn btn-secondary">
                    Смотреть награды
                  </Link>
                  <Link href="/levels" className="btn btn-ghost">Уровни</Link>
                  <Link href="/leaderboard" className="btn btn-ghost">Рейтинг</Link>
                  <Link href="/profile" className="btn btn-ghost">Профиль и промокоды</Link>
                  <Link href="/news" className="btn btn-ghost">Новости</Link>
                  <Link href="/chat" className="btn btn-ghost">Сообщество</Link>
                  <Link href="/feedback" className="btn btn-ghost">Сообщить о проблеме</Link>
                </div>
              </div>

              <div className="grid gap-5">
                <div className="premium-preview app-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="page-kicker">Market lab</p>
                      <h2 className="mt-2 text-2xl font-black text-[var(--text-primary)]">Sandbox market preview</h2>
                    </div>
                    <span className="status-pill text-[var(--success)]">+0.32%</span>
                  </div>
                  <div className="chart-line chart-tall mt-5" />
                </div>

                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-1">
                  <div className="app-card-flat p-5">
                    <Link href="/leaderboard" className="page-kicker">Leaderboard</Link>
                    <div className="mt-4 space-y-3">
                      {leaderboard.slice(0, 3).map((item) => (
                        <div key={`${item.rank}-${item.displayName}`} className="flex items-center justify-between gap-3">
                          <span className="font-bold text-[var(--text-primary)]">{item.rank}. {item.displayName}</span>
                          <span className="text-sm text-[var(--text-secondary)]">{item.xp} XP</span>
                        </div>
                      ))}
                      {leaderboard.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Рейтинг пока пуст</p> : null}
                    </div>
                  </div>
                  <div className="app-card-flat p-5">
                    <p className="page-kicker">Статус прогресса</p>
                    <p className="mt-3 text-lg font-black text-[var(--text-primary)]">
                      {user.freezeStatus === "frozen" ? "Прогресс заморожен" : "Прогресс активен"}
                    </p>
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">
                      Уровень и XP не понижаются даже при заморозке checkpoint.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <ApiLoadState isLoading={isLoading} isFallback={isFallback} />

        <DashboardTaskProgress
          initialTasks={tasks}
          currentTaskFallback={user.currentTask}
          freezeStatus={user.freezeStatus}
        />

        <DashboardCheckpoints />

        <section className="grid gap-5 xl:grid-cols-[1fr_0.82fr]">
          <div className="story-panel p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="page-kicker">Награды</p>
                <h2 className="section-title mt-2">История наград</h2>
              </div>
              <span className="status-pill">{rewards.length} записей</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {rewards.map((reward) => (
                <div key={reward.id} className="reward-card app-card-flat p-4">
                  <div className="font-bold text-[var(--text-primary)]">{reward.title}</div>
                  <div className="mt-2 text-sm text-[var(--text-secondary)]">
                    Задание #{reward.relatedTaskId}
                  </div>
                  <div className="mt-3 status-pill">Статус: {reward.status}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="app-card p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="page-kicker">Рефералы</p>
                <h2 className="section-title mt-2">Реферальный блок</h2>
              </div>
              <span className="badge">+{user.referrals.earnedXp} XP</span>
            </div>
            <div className="mt-4 grid gap-4">
              <div>
                <div className="text-sm text-[var(--text-muted)]">Реферальная ссылка</div>
                <div className="mt-1 break-all font-bold text-[var(--text-primary)]">{user.referrals.link}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="app-card-flat p-4">
                  <div className="text-2xl font-black text-[var(--text-primary)]">{user.referrals.invitedCount}</div>
                  <div className="text-sm text-[var(--text-secondary)]">приглашённых</div>
                </div>
                <div className="app-card-flat p-4">
                  <div className="text-2xl font-black text-[var(--text-primary)]">{user.referrals.earnedXp}</div>
                  <div className="text-sm text-[var(--text-secondary)]">XP с рефералов</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <DashboardExchangeStatus exchange={user.exchange} />

        <DashboardNotifications initialSettings={user.notifications} />
      </div>
    </ProtectedPage>
  );
}
