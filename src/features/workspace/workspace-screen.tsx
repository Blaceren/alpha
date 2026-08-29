import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { getLevelDetail } from "@/lib/curriculum/provider";
import { explainLevelState } from "@/lib/curriculum/next-action";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import { LevelReport } from "@/features/report/level-report";
import { LevelMentorReview } from "@/features/mentor-review/level-mentor-review";
import { MentorFeedbackPanel } from "@/features/mentor-review/mentor-feedback";
import { readLevelMentorFeedback } from "@/server/learner-ops/server-read";

const REPORT_LOCALE = "ru";

/**
 * WORKSPACE — the level-scoped execution surface at
 * `/path/[levelCode]/workspace`.
 *
 * WHAT IT IS, AND THE THREE THINGS IT IS NOT (product decision 5).
 *   * It is scoped to ONE level, named in the path. There is no global learner
 *     cabinet here: no cross-level inbox, no aggregate of every draft the
 *     learner has ever opened, no "my work" dashboard. A surface like that would
 *     need an aggregation the Backend does not expose and this phase is not
 *     authorised to build.
 *   * It is not a Lesson Reader mode. The Reader is for reading the material;
 *     this is for doing the work and receiving the review. They stay separate
 *     routes with separate contracts.
 *   * It is not a new Backend domain. There is no Workspace table, no Workspace
 *     model and no Workspace endpoint. Every byte it renders comes from report,
 *     mentor-review and progression contracts that already existed and are
 *     already proven — it is a composition, not a domain (product decision 6).
 *
 * THE PROGRESSION GATE IS THE POINT OF THE ROUTE.
 * `summary.routeAccessible` is the canonical accessibility answer the rest of
 * the product already uses — Path rows, Lessons Index and Level Detail all gate
 * on this same field. A workspace is directly deep-linkable by construction
 * (someone will paste the URL, or return to a bookmark after the level has been
 * re-locked), so it re-asks that question server-side on every request instead
 * of assuming the caller arrived through a legitimate link. Failing this gate
 * renders the level's own canonical explanation, not a generic denial.
 *
 * MENTOR FEEDBACK IS NOT MENTOR APPROVAL.
 * `MentorFeedbackPanel` renders the reviewer's learner-visible words. It is
 * context beside the task and carries no authority: it cannot complete a level,
 * cannot approve a submission and cannot alter progression. Approval lives
 * behind `/api/curriculum/v2/mentor-reviews/[progressId]/approve`, which is a
 * mentor-initiated Backend route with no Academy BFF handler at all — it is not
 * reachable from this surface, and this phase does not make it reachable.
 *
 * IT WRITES NOTHING ITSELF. The submit/resubmit state machine, duplicate-submit
 * protection, durable draft authority and post-mutation refetch of canonical
 * truth all live inside `LevelReport` / `LevelMentorReview`, unchanged. This
 * surface mounts them; it does not reimplement or wrap their mutations, which is
 * why it cannot weaken them.
 */
export async function WorkspaceScreen({ levelCode }: { levelCode: string }) {
  const viewer = await getServerViewer();
  const name = viewer?.name ?? "Ученик";

  const result = await getLevelDetail(levelCode);

  if (!result.ok) {
    const body =
      result.error.category === "LEVEL_NOT_FOUND" ? (
        <CurriculumInfoState
          title="Уровень не найден"
          message="Такого уровня нет в текущей программе."
        />
      ) : (
        <CurriculumErrorState error={result.error} />
      );
    // activeId stays "lessons": the accepted route map nests workspace under
    // Уроки, so the shell must not lose its active item on an error state.
    return (
      <AppShell userName={name} activeId="lessons">
        <div className="ax">{body}</div>
      </AppShell>
    );
  }

  const { summary, navigation } = result.detail;

  /**
   * The gate. A level that is not route-accessible has no workspace, and the
   * learner is told why in the SAME words Path and Level Detail would use —
   * `explainLevelState` is shared precisely so a locked row and the page behind
   * it cannot explain themselves differently.
   */
  if (!summary.routeAccessible) {
    return (
      <AppShell userName={name} activeId="lessons">
        <div className="ax ws">
          <CurriculumInfoState
            title="Уровень пока недоступен"
            message={explainLevelState(summary)}
          />
          <p className="ws-backlink">
            <Link href="/path">Вернуться к пути</Link>
          </p>
        </div>
      </AppShell>
    );
  }

  /**
   * Which execution task this level actually has.
   *
   * Only the two families that have a learner-executable task in this product
   * get a workspace. An assessment is taken in its own runtime, a checkpoint is
   * a financial boundary the Academy does not execute, and an external event is
   * completed by an authenticated provider postback — offering any of them a
   * "workspace" would be a surface promising work the learner cannot do here.
   */
  const kind = summary.typeInfo.type;
  const isReport = kind === "report";
  const isMentorReview = kind === "mentor-review" && summary.completionMethod === "mentor-review";

  /**
   * The reviewer's own words, for the two families that can have them.
   *
   * Read exactly as Level Detail reads it, including the degradation: a failure
   * answers null and the task still renders. Feedback is context beside a
   * canonical task and must never be able to take the task's page down with it.
   */
  const feedback = isReport || isMentorReview ? await readLevelMentorFeedback(summary.levelCode) : null;

  return (
    <AppShell userName={name} activeId="lessons">
      <div className="ax ws">
        <header className="ws-head">
          <p className="ws-eyebrow">Рабочая область уровня</p>
          <h1 className="ws-title">{summary.title}</h1>
          <p className="ws-state">{explainLevelState(summary)}</p>
        </header>

        {feedback ? <MentorFeedbackPanel feedback={feedback} levelState={summary.state} /> : null}

        {isReport ? (
          <section className="ws-task" aria-label="Отчёт по уровню">
            <LevelReport
              stableCode={summary.levelCode}
              locale={REPORT_LOCALE}
              nextLevelCode={navigation.nextLevelCode}
            />
          </section>
        ) : null}

        {isMentorReview ? (
          <section className="ws-task" aria-label="Проверка ментором">
            <LevelMentorReview
              stableCode={summary.levelCode}
              xpReward={summary.xpReward}
              levelState={summary.state}
            />
          </section>
        ) : null}

        {!isReport && !isMentorReview ? (
          <CurriculumInfoState
            title="У этого уровня нет рабочей области"
            message="Этот уровень завершается другим способом. Откройте его на странице уровня."
          />
        ) : null}

        <p className="ws-backlink">
          <Link href={`/lessons/${encodeURIComponent(summary.levelCode)}`}>
            Открыть страницу уровня
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
