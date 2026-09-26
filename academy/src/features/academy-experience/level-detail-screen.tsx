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
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getLevelDetail } from "@/lib/curriculum/provider";
import type { AcademyLevelContent, AcademyLevelSummary } from "@/lib/curriculum/academy-view";
import { deriveNextAction, explainLevelState } from "@/lib/curriculum/next-action";
import { LevelCompletion } from "@/features/academy-experience/level-completion";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import { LevelAssessment } from "@/features/assessment/level-assessment";
import { LevelCheckpoint } from "@/features/checkpoint/level-checkpoint";
import { LevelReport } from "@/features/report/level-report";
import { LevelManualCompletion } from "@/features/manual-completion/level-manual-completion";
import { LevelMentorReview } from "@/features/mentor-review/level-mentor-review";
import { MentorFeedbackPanel } from "@/features/mentor-review/mentor-feedback";
import { readLevelMentorFeedback } from "@/server/learner-ops/server-read";
import { completionMethodLabel, isManualCompletionMethod } from "@/lib/curriculum/completion-method";
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
import "@/features/level-detail-fidelity/level-detail-fidelity.css";

const ASSESSMENT_LOCALE = "ru";
const REPORT_LOCALE = "ru";

const CONTENT_NOTE: Record<NonNullable<AcademyLevelContent["unavailableReason"]>, string> = {
  not_configured: "Учебный материал для этого уровня ещё не привязан.",
  locked: "Материал станет доступен, когда уровень будет открыт.",
  not_enrolled: "Материал доступен после зачисления на программу.",
  unsupported_type: "Этот тип уровня пока не отображается.",
  unavailable: "Материал сейчас недоступен.",
};

/** Russian plural for "раздел". Grammar, not a product decision. */
function sectionWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "раздел";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "раздела";
  return "разделов";
}

/**
 * How many of THIS lesson's sections the learner has marked read.
 *
 * Intersected with the body's own section codes rather than trusting the stored
 * list length: a published body can lose a section between versions, and a count
 * of "прочитано 7 из 5" is the kind of small lie that costs a learner's trust in
 * everything else on the page.
 */
function readSectionCount(content: AcademyLevelContent): number {
  if (!content.body || !content.reading) return 0;
  const read = new Set(content.reading.completedSections);
  return content.body.sections.filter((section) => read.has(section.code)).length;
}

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
    /* On this route the bounded state IS the page — there is no level header
       above it to own the document's heading — so it declares `h1`. Everywhere
       else these screens stay `h2` inside a surface that already has one. */
    const body =
      result.error.category === "LEVEL_NOT_FOUND" ? (
        <CurriculumInfoState
          headingLevel="h1"
          title="Уровень не найден"
          message="Такого уровня нет в текущей программе."
        />
      ) : (
        <CurriculumErrorState headingLevel="h1" error={result.error} />
      );
    return (
      <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
        <div className="ax ld">{body}</div>
      </AppShell>
    );
  }

  const { summary, content, prerequisites, navigation } = result.detail;
  const posture = levelPosture(summary.state);

  /**
   * The completion moment's inputs, all canonical, all already read.
   *
   * `deriveNextAction` is the SAME call Home makes on the SAME view, so the
   * sentence a learner reads after finishing a level is the sentence Home will
   * show them when they go back to it.
   */
  const enrolled = result.view.state === "enrolled" || result.view.state === "completed" ? result.view : null;
  const nextAction = enrolled ? deriveNextAction(result.view) : null;
  const moduleTitle =
    enrolled?.modules.find((module) => module.moduleCode === result.detail.moduleCode)?.title ?? null;

  /**
   * The reviewer's own words, when there are any (§1).
   *
   * Read only for the two level families that HAVE a canonical review — asking
   * Learner Operations about an assessment level would be a round trip that can
   * only ever answer null. Failure is not propagated: `readLevelMentorFeedback`
   * degrades to null, and the page renders exactly as it did before this
   * feature existed. Feedback is context beside a canonical task; it must never
   * be able to take the task's page down with it.
   */
  const feedback =
    summary.completionMethod === "mentor-review" || summary.completionMethod === "report"
      ? await readLevelMentorFeedback(summary.levelCode)
      : null;

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

  /**
   * Host for a canonical task component. Presentation only.
   *
   * `id="task"` is the anchor the lesson's own CTA links to, so "Перейти к
   * тесту" at the end of the reading lands on the canonical control rather than
   * at the top of a page the learner then has to scan. Only the FIRST task host
   * takes the id — the blocks below are mutually exclusive in practice, and two
   * elements sharing an id would make the anchor ambiguous.
   */
  let taskAnchorUsed = false;
  const task = (node: React.ReactNode, key: string) => {
    const id = taskAnchorUsed ? undefined : "task";
    taskAnchorUsed = true;
    return (
      <section className="ax-lvlsec" key={key} id={id}>
        <div className="ax-task" data-posture={posture}>
          {node}
        </div>
      </section>
    );
  };

  return (
    <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
      <div className="ax ld">
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
                  {/* THE HANDOFF TO THE READING SURFACE.
                      This page owns state and the canonical task; the written
                      lesson lives on its own surface, so the two are not two
                      copies of one another (§9). What is offered here is the
                      lesson's real SHAPE — how many sections, and how far the
                      learner has read — both facts the Backend owns. Nothing is
                      estimated: there is no invented reading time, because the
                      canonical curriculum does not own one. */}
                  {content.body ? (
                    <div className="cur-content__material">
                      <p className="cur-content__shape">
                        {content.body.sections.length} {sectionWord(content.body.sections.length)}
                        {content.reading && content.reading.completedSections.length > 0 ? (
                          <> · прочитано {readSectionCount(content)}</>
                        ) : null}
                        {content.metadata.hasTranscript ? <> · есть расшифровка</> : null}
                      </p>
                      <Link
                        className="cur-content__open"
                        href={`/lessons/${encodeURIComponent(summary.levelCode)}/material`}
                      >
                        {content.reading && content.reading.completedSections.length > 0
                          ? "Продолжить материал"
                          : "Открыть материал урока"}
                      </Link>
                    </div>
                  ) : (
                    <p className="ax-lvlsec__note">
                      Учебный текст для этого уровня пока не опубликован.
                    </p>
                  )}
                  {content.metadata.videoDurationSeconds !== null ? (
                    <p className="ax-lvlsec__note">
                      Видео: {Math.round(content.metadata.videoDurationSeconds / 60)} мин
                    </p>
                  ) : null}
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

          {/* THE COMPLETION MOMENT. Rendered only when the canonical state is
              `completed`, above the task surface — which for a finished level
              only ever states that it is finished. */}
          {summary.state === "completed" && enrolled && nextAction ? (
            <section className="ax-lvlsec" key="done">
              <LevelCompletion
                level={summary}
                progress={enrolled.progress}
                nextAction={nextAction}
                moduleTitle={moduleTitle}
              />
            </section>
          ) : null}

          {/* The reviewer's reply, immediately above the control it is about.
              Order matters: read the reply, read what it does and does not
              decide, THEN meet the canonical task surface. Putting it below the
              control would let a learner press something before learning that a
              decision is still outstanding. */}
          {feedback ? (
            <section className="ax-lvlsec" key="feedback">
              <MentorFeedbackPanel feedback={feedback} levelState={summary.state} />
            </section>
          ) : null}

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
                <dd>{completionMethodLabel(summary.completionMethod)}</dd>
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
            {/* XP is a system counter: it motivates, and it opens nothing. It sat
                as a third equal column beside the condition that actually closes
                the level, which read as progress-by-accumulation. Same server
                value, same wording, moved to the quiet note this section already
                uses for secondary lines. */}
            <p className="ax-lvlsec__note">
              Опыт за уровень: {summary.xpReward > 0 ? `+${summary.xpReward} XP` : "—"}
            </p>
          </section>

          <nav className="ax-lvlnav" aria-label="Навигация по уровням">
            {navigation.previousLevelCode ? (
              <Link href={`/lessons/${encodeURIComponent(navigation.previousLevelCode)}`}>← Предыдущий уровень</Link>
            ) : (
              <span />
            )}
            <Link href="/path">Вернуться к пути</Link>
            {navigation.nextLevelCode ? (
              <Link href={`/lessons/${encodeURIComponent(navigation.nextLevelCode)}`}>Следующий уровень →</Link>
            ) : (
              <span />
            )}
          </nav>
        </article>
      </div>
    </AppShell>
  );
}
