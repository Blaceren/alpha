"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiLoadState } from "@/components/ApiLoadState";
import { ProtectedPage } from "@/components/ProtectedPage";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import type { MockReward, RewardStatus } from "@/data/mockRewards";
import { getRewards } from "@/lib/api";

const rewardStatusClasses: Record<RewardStatus, string> = {
  получено: "border-emerald-200 bg-emerald-50 text-emerald-800",
  доступно: "border-blue-200 bg-blue-50 text-blue-800",
  заблокировано: "border-slate-200 bg-slate-100 text-slate-600",
};

export default function RewardsPage() {
  const [rewards, setRewards] = useState<MockReward[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    getRewards().then((result) => {
      setRewards(result.data);
      setIsFallback(result.isFallback);
      setIsLoading(false);
    });
  }, []);

  return (
    <ProtectedPage allowedRoles={["user", "admin", "support", "mentor"]}>
      <div className="space-y-6">
        <PageHeader
          kicker="Награды"
          title="Список наград"
          description="Награды связаны с цепочкой заданий: XP, уроки, чек-листы, консультации, закрытые чаты и аналитика."
          action={<Link href="/rewards/daily" className="btn btn-primary">Ежедневная награда</Link>}
        />
        <ApiLoadState isLoading={isLoading} isFallback={isFallback} />
        {rewards.length === 0 ? <EmptyState label="Наград пока нет" /> : null}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rewards.map((reward) => (
            <section key={reward.id} className="reward-card app-card-interactive app-card-flat p-5">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--primary-soft)] text-xl font-black text-[var(--reward)] shadow-[var(--shadow-sm)]">
                *
              </div>
              <h2 className="text-lg font-black text-[var(--text-primary)]">{reward.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{reward.description}</p>
              <p className="mt-4 text-sm text-[var(--text-muted)]">Связано с заданием #{reward.relatedTaskId}</p>
              <StatusPill className={`mt-4 ${rewardStatusClasses[reward.status]}`}>
                {reward.status}
              </StatusPill>
            </section>
          ))}
        </div>
      </div>
    </ProtectedPage>
  );
}
