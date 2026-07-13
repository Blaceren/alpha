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
import { Icon } from "@/components/ui/icon";

/**
 * Direction A — Product Portal.
 * A premium spatial centre of progress. Cinematic hero, the current step is the
 * central object, the path reads as a glowing portal into the next stages.
 * Low card fragmentation; strong (not heavy) first viewport.
 */
export function ProductPortalHome({ state }: { state: DashboardState }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {/* Cinematic hero */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface-1 p-6 shadow-glow sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,var(--path-glow),transparent)] opacity-70" />
        <div className="relative flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-ui text-sm text-ink-3">{state.user.greeting}</span>
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                Уровень {state.level.index} · {state.level.lessonName}
              </h1>
            </div>
            <RankBadge rank={state.rank} size="lg" />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <XPIndicator label={state.xp.label} emphasis />
            <LearningStreak streak={state.streak} />
          </div>

          <ModuleProgress module={state.module} />

          <PrimaryAction action={state.primaryAction} emphasis="high" />
        </div>
      </section>

      {/* Portal path */}
      <section className="rounded-3xl border border-line bg-[radial-gradient(120%_120%_at_50%_-10%,color-mix(in_srgb,var(--accent-primary)_10%,transparent),transparent_55%),var(--surface-1)] p-6 sm:p-7">
        <PathPreview nodes={state.path} variant="portal" />
      </section>

      {/* Reward + checkpoint + tools + Alex */}
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col gap-4 rounded-3xl border border-line bg-surface-1 p-6">
          <div className="flex items-center gap-2">
            <Icon name="sparkles" className="h-4 w-4 text-accent" />
            <h2 className="font-display text-sm font-semibold text-ink-2">
              Ближайшая награда
            </h2>
          </div>
          <ToolUnlockPreview tool={state.nearestReward} />
          <div className="grid gap-2 pt-1">
            {state.tools
              .filter((t) => t.state === "available")
              .map((tool) => (
                <ToolUnlockPreview key={tool.code} tool={tool} />
              ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <CheckpointPreview checkpoint={state.nextCheckpoint} />
          <AlexMessage message={state.alex} />
        </div>
      </div>
    </div>
  );
}
