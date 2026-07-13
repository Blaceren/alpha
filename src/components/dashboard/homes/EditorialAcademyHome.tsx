import type { DashboardState } from "@/domain/progression";
import { RankBadge } from "@/components/progression/RankBadge";
import { XPIndicator } from "@/components/progression/XPIndicator";
import { LearningStreak } from "@/components/progression/LearningStreak";
import { ModuleProgress } from "@/components/progression/ModuleProgress";
import { PrimaryAction } from "@/components/dashboard/PrimaryAction";
import { PathPreview } from "@/components/progression/PathPreview";
import { CheckpointPreview } from "@/components/progression/CheckpointPreview";
import { ToolUnlockPreview } from "@/components/progression/ToolUnlockPreview";
import { AlexMessage } from "@/components/dashboard/AlexMessage";

/**
 * Direction C — Editorial Academy.
 * A premium educational environment: the lesson, the expert and one clear next
 * step dominate. Strong typography, more air, less glow, Alex more visible; the
 * path is a compact editorial progression strip.
 */
export function EditorialAcademyHome({ state }: { state: DashboardState }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      {/* Editorial masthead */}
      <header className="flex flex-col gap-3 border-b border-line pb-6">
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-xs uppercase tracking-widest text-ink-3">
            Модуль {state.module.ordinal} · «{state.module.name}»
          </span>
          <RankBadge rank={state.rank} size="sm" />
        </div>
        <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[2.5rem]">
          {state.level.lessonName}
        </h1>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="text-ink-3">Уровень {state.level.index}</span>
          <XPIndicator label={state.xp.label} />
          <LearningStreak streak={state.streak} />
        </div>
      </header>

      {/* Alex feature — the expert is prominent */}
      <AlexMessage message={state.alex} prominence="feature" />

      {/* One clear next step */}
      <PrimaryAction action={state.primaryAction} emphasis="medium" />

      {/* Module progress + compact editorial path strip */}
      <div className="flex flex-col gap-5">
        <ModuleProgress module={state.module} />
        <div className="rounded-2xl border border-line bg-surface-1 p-5">
          <PathPreview nodes={state.path} variant="strip" />
        </div>
      </div>

      {/* Quiet editorial footer: checkpoint + tools */}
      <div className="grid gap-4 sm:grid-cols-2">
        <CheckpointPreview checkpoint={state.nextCheckpoint} tone="quiet" />
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-1 p-4">
          <h2 className="mb-1 font-display text-sm font-semibold text-ink-2">
            Инструменты
          </h2>
          <ToolUnlockPreview tool={state.nearestReward} />
          {state.tools
            .filter((t) => t.state === "available")
            .map((tool) => (
              <ToolUnlockPreview key={tool.code} tool={tool} />
            ))}
        </div>
      </div>
    </div>
  );
}
