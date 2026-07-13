import type { DashboardState } from "@/domain/progression";
import type { ReactNode } from "react";
import { RankBadge } from "@/components/progression/RankBadge";
import { XPIndicator } from "@/components/progression/XPIndicator";
import { LearningStreak } from "@/components/progression/LearningStreak";
import { ModuleProgress } from "@/components/progression/ModuleProgress";
import { PrimaryAction } from "@/components/dashboard/PrimaryAction";
import { PathPreview } from "@/components/progression/PathPreview";
import { CheckpointPreview } from "@/components/progression/CheckpointPreview";
import { ToolUnlockPreview } from "@/components/progression/ToolUnlockPreview";
import { AlexMessage } from "@/components/dashboard/AlexMessage";
import { Icon } from "@/components/ui/icon";

/**
 * Direction B — Market Atlas.
 * Progress read as a professional map of the market and skills. Technical,
 * gridded, precise labels; the horizontal path is the main structural object;
 * tools read as working capabilities. Premium terminal feel — NOT a terminal,
 * no fake charts.
 */
export function MarketAtlasHome({ state }: { state: DashboardState }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      {/* Header row: coordinates + metric tiles */}
      <header className="flex flex-col gap-1">
        <span className="font-mono text-xs uppercase tracking-widest text-ink-3">
          {state.user.greeting} · Модуль {state.module.ordinal} / 20
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          {state.level.lessonName}
        </h1>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Ранг">
          <RankBadge rank={state.rank} size="sm" showLabel={false} />
          <span className="font-display text-sm font-semibold text-ink">
            {state.rank.label}
          </span>
        </Tile>
        <Tile label="Опыт">
          <XPIndicator label={state.xp.label} emphasis />
        </Tile>
        <Tile label="Дисциплина">
          <LearningStreak streak={state.streak} />
        </Tile>
        <Tile label="Текущий уровень">
          <span className="font-mono text-lg font-semibold text-ink tabular-nums">
            {state.level.index}
            <span className="text-ink-3">/100</span>
          </span>
        </Tile>
      </div>

      {/* Primary action + module progress */}
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <PrimaryAction action={state.primaryAction} emphasis="medium" />
        <div className="flex flex-col justify-center gap-3 rounded-2xl border border-line bg-surface-1 p-5">
          <ModuleProgress module={state.module} />
        </div>
      </div>

      {/* Path — main structural object, gridded */}
      <section className="rounded-2xl border border-line bg-[linear-gradient(0deg,var(--surface-1),var(--surface-1)),repeating-linear-gradient(90deg,var(--border-subtle)_0_1px,transparent_1px_72px)] p-5">
        <PathPreview
          nodes={state.path}
          variant="atlas"
          heading="Карта маршрута · уровни 15–21"
        />
      </section>

      {/* Capabilities + checkpoint + Alex */}
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-2xl border border-line bg-surface-1 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Icon name="tools" className="h-4 w-4 text-accent-2" />
            <h2 className="font-display text-sm font-semibold text-ink-2">
              Рабочие инструменты
            </h2>
          </div>
          <div className="flex flex-col gap-2">
            <ToolUnlockPreview tool={state.nearestReward} />
            {state.tools
              .filter((t) => t.code !== state.nearestReward.code)
              .map((tool) => (
                <ToolUnlockPreview key={tool.code} tool={tool} />
              ))}
          </div>
        </section>

        <div className="flex flex-col gap-3">
          <CheckpointPreview checkpoint={state.nextCheckpoint} />
          <AlexMessage message={state.alex} />
        </div>
      </div>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-1 p-4">
      <span className="font-mono text-[0.65rem] uppercase tracking-widest text-ink-3">
        {label}
      </span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
