import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getLessonEntry } from "@/features/lesson/data/lesson-fixtures";
import { parseLevelCode } from "@/features/lesson/model/lesson";
import { baseRouteAvailability } from "@/features/lesson/model/lesson-availability";
import {
  resolveLessonScenario,
  scenarioProgress,
  scenarioSession,
} from "@/features/lesson/model/lesson-scenarios";
import { LessonWorkspace } from "@/features/lesson/components/lesson-workspace";
import { LessonLockedScreen } from "@/features/lesson/components/lesson-locked-screen";
import { LessonUnknown } from "@/features/lesson/components/lesson-unknown";
import { LessonResolving } from "@/features/lesson/components/lesson-resolving";
import { LessonSessionGate } from "@/features/lesson/components/lesson-session-gate";
import "@/features/lesson/lesson.css";

export const metadata: Metadata = {
  title: "Урок — Alfa Trade Academy",
  description: "Видеоурок и проверка понимания одного уровня пути.",
};

/**
 * Урок (/lessons/[levelCode]) — the canonical lesson route (ROUTE_MAP §1).
 * `[levelCode]` is the stable curriculum code: level.001…level.100.
 *
 * Availability layers the curriculum sequence with THIS browser session
 * (D2B.1). The server can only know the sequence — it never reads
 * sessionStorage — so a level the sequence has not reached is handed to
 * `LessonSessionGate`, which resolves it on the client after hydration.
 *
 * `?scenario=…` remains a DEVELOPMENT AND TEST adapter only: it seeds a
 * deterministic entry state and is never produced by a user-facing link
 * (DD-255). Unknown → initial.
 *
 * D2B authors exactly one lesson (level 18). Any other level resolves to an
 * honest state — locked explainer or "not built yet" — never a 404 and never a
 * fabricated lesson.
 */
export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ levelCode: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { levelCode } = await params;
  const { scenario: rawScenario } = await searchParams;

  const levelNumber = parseLevelCode(levelCode);
  const scenario = resolveLessonScenario(rawScenario);
  const marker = scenarioProgress(scenario);

  if (levelNumber === null) {
    return (
      <AppShell userName="Артём" activeId="lessons">
        <div className="lesson-page">
          <LessonUnknown />
        </div>
      </AppShell>
    );
  }

  const entry = getLessonEntry(levelNumber);
  const level = entry?.kind === "full" ? entry.lesson.level : entry?.stub.level;
  const note = entry?.kind === "stub" ? entry.stub.note : undefined;

  /** What this level looks like once it IS reachable. */
  const openView =
    entry?.kind === "full" ? (
      <LessonWorkspace
        lesson={entry.lesson}
        initialSession={scenarioSession(entry.lesson, scenario)}
        progress={marker}
      />
    ) : (
      // Reached, but D2B built no lesson for it (level 19 is a practical level).
      <div className="lesson-page">
        <LessonUnknown title={level?.title} levelNumber={levelNumber} note={note} />
      </div>
    );

  // Not reached by the sequence — this session may still have opened it.
  if (baseRouteAvailability(levelNumber, marker) === "locked") {
    if (!level) {
      return (
        <AppShell userName="Артём" activeId="lessons">
          <div className="lesson-page">
            <LessonUnknown />
          </div>
        </AppShell>
      );
    }

    return (
      <AppShell userName="Артём" activeId="lessons">
        <LessonSessionGate
          levelNumber={levelNumber}
          marker={marker}
          resolving={
            <div className="lesson-page">
              <LessonResolving level={level} />
            </div>
          }
          locked={
            <div className="lesson-page">
              <LessonLockedScreen level={level} progress={marker} note={note} />
            </div>
          }
          unlocked={openView}
        />
      </AppShell>
    );
  }

  if (!entry) {
    return (
      <AppShell userName="Артём" activeId="lessons">
        <div className="lesson-page">
          <LessonUnknown levelNumber={levelNumber} />
        </div>
      </AppShell>
    );
  }

  return <AppShell userName="Артём" activeId="lessons">{openView}</AppShell>;
}
