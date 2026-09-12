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
import { getReportDefinition } from "@/features/report-level/data/report-fixtures";
import { ReportWorkspace } from "@/features/report-level/components/report-workspace";
import { resolveReportVerdictAdapter } from "@/features/report-level/model/report-review";
import { resolvePathScenario } from "@/features/path/model/path-state";
import { getAcademyConfig } from "@/config/academy-config";
import { ExperienceLevelDetail } from "@/features/academy-experience/level-detail-screen";
import "@/features/lesson/lesson.css";
import "@/features/report-level/report-level.css";
import { shellViewerName } from "@/server/auth/server-session";

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
  searchParams: Promise<{ scenario?: string; verdict?: string }>;
}) {
  const { levelCode } = await params;

  // API mode: the [levelCode] is the Backend stable code; render server data.
  if (getAcademyConfig().mode === "api") {
    return <ExperienceLevelDetail levelCode={levelCode} />;
  }

  const { scenario: rawScenario, verdict: rawVerdict } = await searchParams;

  const levelNumber = parseLevelCode(levelCode);
  const scenario = resolveLessonScenario(rawScenario);
  const marker = scenarioProgress(scenario);

  if (levelNumber === null) {
    return (
      <AppShell userName={await shellViewerName()} activeId="lessons">
        <div className="lesson-page">
          <LessonUnknown />
        </div>
      </AppShell>
    );
  }

  /**
   * Report levels (D3-B) — the report IS the level, so it lives on this very
   * route; `/reports/[reportCode]` is never created and `report.NNN` is never an
   * address (DD-264).
   *
   * A report reads a PATH scenario, not a lesson scenario, because what matters
   * to it is where the sequential marker stands — `?scenario=report` puts the
   * user ON level 3, which is the only marker under which the report story is
   * coherent (DD-271). Anything else, including no query at all, resolves to the
   * canonical marker, under which level 3 is simply already behind the user.
   *
   * The workspace itself decides nothing: it renders what
   * `report-experience.ts` derives, including whether the next level is locked.
   */
  const reportDefinition = getReportDefinition(levelNumber);
  if (reportDefinition) {
    return (
      <AppShell userName={await shellViewerName()} activeId="lessons">
        <ReportWorkspace
          definition={reportDefinition}
          scenario={resolvePathScenario(rawScenario)}
          /* `?verdict=` is the DEVELOPMENT AND TEST verdict adapter (DD-286,
             DD-298), the `?scenario` precedent applied to the review: typed,
             fail-closed (only `revision-requested` and `approved` resolve; every
             alias and "rejected" → null), never produced by a user-facing link. */
          verdictAdapter={resolveReportVerdictAdapter(rawVerdict)}
        />
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
        <AppShell userName={await shellViewerName()} activeId="lessons">
          <div className="lesson-page">
            <LessonUnknown />
          </div>
        </AppShell>
      );
    }

    return (
      <AppShell userName={await shellViewerName()} activeId="lessons">
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
      <AppShell userName={await shellViewerName()} activeId="lessons">
        <div className="lesson-page">
          <LessonUnknown levelNumber={levelNumber} />
        </div>
      </AppShell>
    );
  }

  return <AppShell userName={await shellViewerName()} activeId="lessons">{openView}</AppShell>;
}
