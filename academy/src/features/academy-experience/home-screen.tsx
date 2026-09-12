/**
 * HOME — Direction A, "Одна задача" / Single Task Field.
 *
 * The page has one job: answer «что мне делать сейчас?». So it has one dominant
 * object — the Action Field — and everything else is composed around it as
 * context, in this order: programme coordinate → action statement → reason →
 * primary control → supporting context → compact 100-level trace.
 *
 * There is no card grid here and there must never be one. A [progress card]
 * [next lesson card] [XP card] layout is the rejected direction wearing the
 * approved name.
 *
 * WHAT THIS FILE DOES NOT DO. It contains no progression logic. The situation
 * comes from `deriveNextAction`, which reads canonical Backend state; this file
 * chooses the composition and nothing else. If Home and Path ever disagreed, it
 * would be a bug in the shared derivation, not a difference of opinion between
 * two screens — which is exactly the property we wanted.
 */
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { deriveNextAction } from "@/lib/curriculum/next-action";
import type { AcademyCurriculumView } from "@/lib/curriculum/academy-view";
import {
  ActionField,
  ContextRail,
  ErrorState,
  ProgressTrace,
} from "@/features/academy-experience/primitives";
import { CurriculumErrorState } from "@/features/curriculum-api/curriculum-states";
import { readLevelMentorFeedback } from "@/server/learner-ops/server-read";
import { readReportState } from "@/server/curriculum/report-state-read";
import "@/features/academy-experience/experience.css";
import { completionMethodLabel } from "@/lib/curriculum/completion-method";

type Enrolled = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

/**
 * The next structural milestone ahead of the learner.
 *
 * Only checkpoints and mentor reviews count: those are the two families the
 * curriculum itself treats as structural, and naming the next ordinary lesson
 * as a "milestone" would be noise dressed up as orientation.
 */
function nextMilestone(view: Enrolled, currentOrder: number): string | null {
  const ahead = view.modules
    .flatMap((m) => m.levels)
    .filter((l) => l.order > currentOrder)
    .sort((a, b) => a.order - b.order);
  const found = ahead.find(
    (l) => l.completionMethod === "checkpoint" || l.completionMethod === "mentor-review",
  );
  if (!found) return null;
  const what =
    found.completionMethod === "checkpoint" ? "контрольная точка" : "проверка наставника";
  return `${what} — уровень ${found.order}`;
}

export async function ExperienceHome() {
  const [viewer, result] = await Promise.all([getServerViewer(), getCurriculumView()]);
  const name = viewer?.name ?? "Ученик";

  if (!result.ok) {
    return (
      <AppShell userName={name} activeId="home">
        <div className="ax">
          <CurriculumErrorState error={result.error} />
        </div>
      </AppShell>
    );
  }

  /**
   * The next action, derived once — with one extra canonical read where, and
   * only where, the progression state is genuinely ambiguous (§16).
   *
   * A report level that is `in_progress` is either "not written yet" or "came
   * back with corrections", and the progression engine calls both the same
   * thing. So the report owner is asked, but ONLY for that level and only while
   * the learner is standing on it: one extra request on one of a hundred levels,
   * never on an ordinary Home.
   */
  const provisional = deriveNextAction(result.view);
  const ambiguousReport =
    provisional.level !== null &&
    provisional.level.completionMethod === "report" &&
    provisional.level.state === "in_progress";
  const action = ambiguousReport
    ? deriveNextAction(result.view, { reportState: await readReportState(provisional.level!.levelCode) })
    : provisional;

  // Not enrolled / no published programme: the Action Field still carries the
  // answer, because "there is nothing to do yet, and here is why" is also an
  // answer. A blank page would not be.
  if (result.view.state !== "enrolled" && result.view.state !== "completed") {
    return (
      <AppShell userName={name} activeId="home">
        <div className="ax">
          <ActionField action={action} />
        </div>
      </AppShell>
    );
  }

  const view = result.view as Enrolled;
  const level = action.level;
  const levelModule = action.module;

  /**
   * "Наставник ответил" as ONE LINE of context, and only where it changes what
   * the learner should do (§4).
   *
   * Read only when the derived action is already a waiting review — that is the
   * single situation in which a reply is news, and it keeps this off the round
   * trip on every other Home. The BODY of the reply is deliberately not here:
   * the complete feedback lives with the task, and Home is not a message inbox.
   */
  const awaitingReview = action.kind === "wait-mentor-review" || action.kind === "wait-report-review";
  const feedback = awaitingReview && level ? await readLevelMentorFeedback(level.levelCode) : null;

  const coordinate =
    levelModule && level ? (
      <>
        Модуль {levelModule.order} · уровень <b>{level.order}</b> из {view.progress.totalLevels}
        {level.typeInfo.label ? <> · {level.typeInfo.label}</> : null}
      </>
    ) : (
      <>Программа: {view.curriculum.title}</>
    );

  const rail: Array<{ k: string; v: React.ReactNode }> = [];
  if (levelModule) {
    rail.push({
      k: "Текущий модуль",
      v: (
        <>
          {levelModule.title}
          <br />
          <span style={{ color: "var(--ax-ink-muted)", fontSize: 14 }}>
            {levelModule.progress.completed} из {levelModule.progress.total} уровней завершено
          </span>
        </>
      ),
    });
  }
  if (level) {
    rail.push({ k: "Как завершается", v: completionMethodLabel(level.completionMethod) });
    if (level.xpReward > 0) rail.push({ k: "Опыт за уровень", v: `+${level.xpReward} XP` });
  }
  if (view.progress.xp.available) {
    rail.push({ k: "Опыт", v: `${view.progress.xp.currentXp} XP` });
  }

  return (
    <AppShell userName={name} activeId="home">
      <div className="ax">
        <ActionField action={action} coordinate={coordinate}>
          {feedback ? (
            <p className="ax-field__aside" data-kind="mentor-feedback">
              Наставник ответил по этому уровню. Решение ещё не принято — ответ можно прочитать на
              странице уровня.
            </p>
          ) : null}
        </ActionField>

        <ContextRail items={rail} />

        <ProgressTrace
          modules={view.modules}
          currentLevelCode={level?.levelCode ?? view.progress.currentLevelCode}
          completed={view.progress.completedLevels}
          total={view.progress.totalLevels}
          nextMilestone={level ? nextMilestone(view, level.order) : null}
        />
      </div>
    </AppShell>
  );
}

/** Route-level failure surface, shared with error.tsx. */
export function ExperienceHomeError() {
  return (
    <div className="ax">
      <ErrorState />
    </div>
  );
}
