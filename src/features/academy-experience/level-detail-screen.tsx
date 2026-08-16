/**
 * LEVEL DETAIL, in the approved Academy language.
 *
 * WHAT CHANGED AND WHAT DID NOT. Every canonical decision on this page is
 * untouched: the same provider call, the same visibility predicates, the same
 * task components with the same props, in the same mutually exclusive order.
 * This phase found the wiring correct — assessment, checkpoint, report, manual
 * completion, mentor review and the Pocket registration CTA were already reading
 * canonical state and were already truthful. What was wrong was that they sat on
 * their own surface inside a product that had moved on, so a learner walking
 * Home → Path → level crossed into what looked like a different application.
 *
 * COMPOSITION, NOT A SECOND HOME. Home owns the programme-wide next action and
 * gets one dominant Action Field. This page owns ONE level, so it leads with the
 * level's own identity and state and then hands the floor to the canonical task
 * surface. Cloning the Action Field here would put two competing primary objects
 * on the same journey and leave the learner unsure which one is in charge.
 *
 * THE STATE SENTENCE IS SHARED. `explainLevelState` is the same function Path
 * calls for its rows, so a locked row and the page it opens cannot explain
 * themselves differently — the property Wave 1 established between Home and Path,
 * extended to the third surface.
 */
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { getLevelDetail } from "@/lib/curriculum/provider";
import type { AcademyLevelContent, AcademyLevelSummary } from "@/lib/curriculum/academy-view";
import { explainLevelState } from "@/lib/curriculum/next-action";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import { LevelAssessment } from "@/features/assessment/level-assessment";
import { LevelCheckpoint } from "@/features/checkpoint/level-checkpoint";
import { LevelReport } from "@/features/report/level-report";
import { LevelManualCompletion } from "@/features/manual-completion/level-manual-completion";
import { LevelMentorReview } from "@/features/mentor-review/level-mentor-review";
import { isManualCompletionMethod } from "@/lib/curriculum/completion-method";
import { LevelStart } from "@/features/level-start/level-start";
import { PocketRegistration } from "@/features/pocket-registration/pocket-registration";
import { PocketRegistrationConfirmed } from "@/features/pocket-registration/pocket-registration-confirmed";
import {
  shouldShowPocketRegistration,
  shouldShowPocketRegistrationConfirmed,
} from "@/features/pocket-registration/model/pocket-registration-visibility";
import { LessonMedia } from "@/features/lesson-media/lesson-media";
import { MilestoneMark } from "@/features/academy-experience/primitives";
import "@/features/curriculum-api/curriculum-api.css";
import "@/features/academy-experience/experience.css";

const ASSESSMENT_LOCALE = "ru";
const REPORT_LOCALE = "ru";

const CONTENT_NOTE: Record<NonNullable<AcademyLevelContent["unavailableReason"]>, string> = {
  not_configured: "Учебный материал для этого уровня ещё не привязан.",
  locked: "Материал станет доступен, когда уровень будет открыт.",
  not_enrolled: "Материал доступен после зачисления на программу.",
  unsupported_type: "Этот тип уровня пока не отображается.",
  unavailable: "Материал сейчас недоступен.",
};

/**
 * The level's posture, in the same four-value vocabulary the Action Field uses.
 *
 * Derived from the canonical state and nothing else — this cannot unlock or
 * complete anything, it only decides which material the surface wears so that
 * "waiting" never looks like "blocked" on this page either.
 */
export function levelPosture(
  state: AcademyLevelSummary["state"],
): "act" | "waiting" | "blocked" | "done" {
  switch (state) {
    case "completed":
      return "done";
    case "pending_review":
    case "checkpoint_unverified":
      return "waiting";
    case "available":
    case "in_progress":
      return "act";
    default:
      return "blocked";
  }
}

export async function ExperienceLevelDetail({ levelCode }: { levelCode: string }) {
  const viewer = await getServerViewer();
  const name = viewer?.name ?? "Ученик";
  const result = await getLevelDetail(levelCode);

  if (!result.ok) {
    const body =
      result.error.category === "LEVEL_NOT_FOUND" ? (
        <CurriculumInfoState title="Уровень не найден" message="Такого уровня нет в текущей программе." />
      ) : (
        <CurriculumErrorState error={result.error} />
      );
    return (
      <AppShell userName={name} activeId="lessons">
        <div className="ax">{body}</div>
      </AppShell>
    );
  }

  const { summary, content, prerequisites, navigation } = result.detail;
  const posture = levelPosture(summary.state);

  // A financial checkpoint is a module boundary, not a lesson. It has no
  // material by definition, so the "Материал" section is suppressed rather than
  // shown with a note about a type that "is not displayed yet".
  const isCheckpoint = summary.typeInfo.type === "checkpoint";

  // Unchanged predicate: an `external_event` level is completed by an
  // authenticated Pocket postback, so the only thing the Academy can offer is
  // the affiliate link, and only while the requirement is actually outstanding.
  const showPocketRegistration = shouldShowPocketRegistration({
    isExternal: summary.typeInfo.isExternal,
    state: summary.state,
    contentUnavailableReason: content.unavailableReason,
  });

  /** Host for a canonical task component. Presentation only. */
  const task = (node: React.ReactNode, key: string) => (
    <section className="ax-lvlsec" key={key}>
      <div className="ax-task" data-posture={posture}>
        {node}
      </div>
    </section>
  );

  return (
    <AppShell userName={name} activeId="lessons">
      <div className="ax">
        <article data-level={summary.levelCode} data-state={summary.state} data-posture={posture}>
          <header className="ax-lvlhead">
            <p className="ax-coord">
              Уровень <b>{summary.order}</b> · {summary.typeInfo.label}
            </p>
            <h1 className="ax-lvlhead__title">{summary.title}</h1>
            <p className="ax-lvlhead__row">
              <span className="ax-mark" data-state={summary.state}>
                {summary.stateLabel}
              </span>
              <MilestoneMark level={summary} />
            </p>
            {summary.learningObjective ? (
              <p className="ax-lvlhead__obj">{summary.learningObjective}</p>
            ) : null}
          </header>

          {/* One line saying where this level stands and why — the same sentence
              Path prints on its row for this level. */}
          <div className="ax-statestrip" data-posture={posture}>
            <span className="ax-statestrip__dot" aria-hidden="true" />
            <p className="ax-statestrip__text">{explainLevelState(summary)}</p>
          </div>

          {isCheckpoint ? null : (
            <section className="ax-lvlsec" aria-label="Материал уровня">
              <h2>Материал</h2>
              {content.available && content.metadata ? (
                <div className="cur-content">
                  {/* View-only: playback records nothing and completes nothing. */}
                  <LessonMedia media={content.media} title={content.metadata.title} />
                  <p className="cur-content__title">{content.metadata.title}</p>
                  {content.metadata.subtitle ? (
                    <p className="cur-content__subtitle">{content.metadata.subtitle}</p>
                  ) : null}
                  <p className="cur-content__summary">{content.metadata.summary}</p>
                  <ul className="cur-content__facts">
                    {content.metadata.videoDurationSeconds !== null ? (
                      <li>Видео: {Math.round(content.metadata.videoDurationSeconds / 60)} мин</li>
                    ) : null}
                    <li>Материал: {content.metadata.hasTranscript ? "есть расшифровка" : "без расшифровки"}</li>
                  </ul>
                  {content.media === null ? (
                    <p className="cur-content__media-pending" data-media="pending">
                      Видеоурок готовится. Текстовый материал доступен, проверку можно пройти уже сейчас.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="ax-lvlsec__note">{CONTENT_NOTE[content.unavailableReason ?? "unavailable"]}</p>
              )}
              <p className="ax-lvlsec__note" style={{ marginTop: 14 }}>
                Материал — только просмотр. Прогресс сохраняется на сервере.
              </p>
            </section>
          )}

          {/* Every block below is the SAME condition and the SAME component as
              before; only the surface they sit on changed. */}
          {summary.state === "available" && !isCheckpoint
            ? task(<LevelStart stableCode={summary.levelCode} />, "start")
            : null}

          {showPocketRegistration ? task(<PocketRegistration />, "pocket") : null}

          {shouldShowPocketRegistrationConfirmed({
            isExternal: summary.typeInfo.isExternal,
            state: summary.state,
          })
            ? task(<PocketRegistrationConfirmed nextLevelCode={navigation.nextLevelCode} />, "pocket-ok")
            : null}

          {isCheckpoint && summary.checkpoint
            ? task(
                <LevelCheckpoint
                  levelNumber={summary.order}
                  stableCode={summary.levelCode}
                  checkpoint={summary.checkpoint}
                />,
                "checkpoint",
              )
            : null}

          {summary.typeInfo.type === "lesson" &&
          summary.completionMethod === "assessment" &&
          summary.routeAccessible
            ? task(
                <LevelAssessment
                  stableCode={summary.levelCode}
                  locale={ASSESSMENT_LOCALE}
                  alreadyCompleted={summary.state === "completed"}
                  nextLevelCode={navigation.nextLevelCode}
                />,
                "assessment",
              )
            : null}

          {summary.typeInfo.type === "lesson" &&
          isManualCompletionMethod(summary.completionMethod) &&
          summary.routeAccessible
            ? task(
                <LevelManualCompletion
                  stableCode={summary.levelCode}
                  xpReward={summary.xpReward}
                  alreadyCompleted={summary.state === "completed"}
                />,
                "manual",
              )
            : null}

          {summary.typeInfo.type === "report" && summary.routeAccessible
            ? task(
                <LevelReport
                  stableCode={summary.levelCode}
                  locale={REPORT_LOCALE}
                  nextLevelCode={navigation.nextLevelCode}
                />,
                "report",
              )
            : null}

          {summary.typeInfo.type === "mentor-review" &&
          summary.completionMethod === "mentor-review" &&
          summary.routeAccessible
            ? task(
                <LevelMentorReview
                  stableCode={summary.levelCode}
                  xpReward={summary.xpReward}
                  levelState={summary.state}
                />,
                "mentor",
              )
            : null}

          <section className="ax-lvlsec" aria-label="Параметры уровня">
            <h2>Параметры уровня</h2>
            <dl className="ax-lvlmeta">
              <div>
                <dt>Способ завершения</dt>
                <dd>{summary.completionSourceLabel}</dd>
              </div>
              <div>
                <dt>Опыт за уровень</dt>
                <dd>{summary.xpReward > 0 ? `+${summary.xpReward} XP` : "—"}</dd>
              </div>
              <div>
                <dt>Предыдущий уровень</dt>
                <dd>{prerequisites.previousLevel ?? "—"}</dd>
              </div>
              {prerequisites.checkpointLevel !== null ? (
                <div>
                  <dt>Контрольная точка</dt>
                  <dd>уровень {prerequisites.checkpointLevel}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <nav className="ax-lvlnav" aria-label="Навигация по уровням">
            {navigation.previousLevelCode ? (
              <a href={`/lessons/${encodeURIComponent(navigation.previousLevelCode)}`}>← Предыдущий уровень</a>
            ) : (
              <span />
            )}
            <a href="/path">Вернуться к пути</a>
            {navigation.nextLevelCode ? (
              <a href={`/lessons/${encodeURIComponent(navigation.nextLevelCode)}`}>Следующий уровень →</a>
            ) : (
              <span />
            )}
          </nav>
        </article>
      </div>
    </AppShell>
  );
}
