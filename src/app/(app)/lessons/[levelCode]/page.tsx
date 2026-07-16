import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getLessonEntry } from "@/features/lesson/data/lesson-fixtures";
import { parseLevelCode } from "@/features/lesson/model/lesson";
import { lessonAvailability } from "@/features/lesson/model/lesson-state-machine";
import {
  resolveLessonScenario,
  scenarioProgress,
  scenarioSession,
} from "@/features/lesson/model/lesson-scenarios";
import { LessonWorkspace } from "@/features/lesson/components/lesson-workspace";
import { LessonLockedScreen } from "@/features/lesson/components/lesson-locked-screen";
import { LessonUnknown } from "@/features/lesson/components/lesson-unknown";
import "@/features/lesson/lesson.css";

export const metadata: Metadata = {
  title: "Урок — Alfa Trade Academy",
  description: "Видеоурок и проверка понимания одного уровня пути.",
};

/**
 * Урок (/lessons/[levelCode]) — the canonical lesson route (ROUTE_MAP §1).
 * `[levelCode]` is the stable curriculum code: level.001…level.100.
 *
 * Deterministic dev scenarios via ?scenario=initial|watching|threshold-49|
 * threshold-50|testing|incorrect|completed|locked|unlocked. Unknown → initial.
 * The query is a development adapter and is never surfaced in the UI.
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
  const progress = scenarioProgress(scenario);

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
  const availability = lessonAvailability(levelNumber, progress);

  // Not reached yet — the sequence explainer, whatever the level's kind is.
  if (availability === "locked") {
    const level = entry?.kind === "full" ? entry.lesson.level : entry?.stub.level;
    return (
      <AppShell userName="Артём" activeId="lessons">
        <div className="lesson-page">
          {level ? (
            <LessonLockedScreen
              level={level}
              progress={progress}
              note={entry?.kind === "stub" ? entry.stub.note : undefined}
            />
          ) : (
            <LessonUnknown />
          )}
        </div>
      </AppShell>
    );
  }

  // Reached, but D2B authored no lesson for it (e.g. L19 is a practical level).
  if (!entry || entry.kind === "stub") {
    return (
      <AppShell userName="Артём" activeId="lessons">
        <div className="lesson-page">
          <LessonUnknown
            title={entry?.stub.level.title}
            levelNumber={levelNumber}
            note={entry?.stub.note}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell userName="Артём" activeId="lessons">
      <LessonWorkspace
        lesson={entry.lesson}
        initialSession={scenarioSession(entry.lesson, scenario)}
        progress={progress}
      />
    </AppShell>
  );
}
