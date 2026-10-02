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
 *
 * THE LESSON IS ON THIS PAGE (2026-10-02). The 30-level program is video
 * lessons with a test, and its levels are read top to bottom as one thing:
 * the video, what the lesson is about, then the test — whose разбор can send
 * the learner back up to a second of that same video. So a lesson's short text
 * is printed here rather than behind a link, the task surfaces appear only when
 * they can be used, and a level says which tool its completion opens. The
 * 100-level program's long reading lessons keep their own surface exactly as
 * they had it (`level-lesson-shape.ts` draws the line).
 *
 * ONE TASK AT A TIME. A level that has not been started shows the start control
 * and nothing else to press; the test, the report form and the completion
 * control appear once the Backend says the level is in progress. They used to be
 * rendered beside «Начать», and failed — an assessment cannot open an attempt
 * on a level that has not begun.
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
import {
  completionMethodLabel,
  isFormalReportMethod,
  isReportCompletionMethod,
  isSelfDeclaredCompletionMethod,
  type AcademyCompletionMethod,
} from "@/lib/curriculum/completion-method";
import { LevelStart, type LevelStartCopy } from "@/features/level-start/level-start";
import { PocketRegistration } from "@/features/pocket-registration/pocket-registration";
import { PocketRegistrationConfirmed } from "@/features/pocket-registration/pocket-registration-confirmed";
import {
  shouldShowPocketRegistration,
  shouldShowPocketRegistrationConfirmed,
} from "@/features/pocket-registration/model/pocket-registration-visibility";
import { LessonMedia } from "@/features/lesson-media/lesson-media";
import { MilestoneMark } from "@/features/academy-experience/primitives";
import { isInlineLessonBody } from "@/features/level-detail-fidelity/level-lesson-shape";
import { LevelLessonText } from "@/features/level-detail-fidelity/level-lesson-text";
import { LevelUnlocks } from "@/features/level-detail-fidelity/level-unlocks";
import "@/features/curriculum-api/curriculum-api.css";
import "@/features/academy-experience/experience.css";
import "@/features/level-detail-fidelity/level-detail-fidelity.css";
import "@/features/level-detail-fidelity/level-lesson.css";

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
 * What «Начать» begins, by what the level is.
 *
 * The control is one and the same; the sentence around it is true of the level
 * in front of the learner. A method this build does not know gets the neutral
 * line rather than a promise of a test.
 */
export function startCopyFor(method: AcademyCompletionMethod, hasVideo: boolean): LevelStartCopy {
  const watch = hasVideo ? " Видео можно смотреть уже сейчас." : "";
  switch (method) {
    case "assessment":
      return {
        title: "Начните урок",
        explain: `После начала откроется тест по уроку: нужно ответить верно на все вопросы, попытки не ограничены.${watch}`,
        action: "Начать урок",
      };
    case "lesson":
      return {
        title: "Начните урок",
        explain: `В этом уроке нет теста: после начала урок можно будет отметить пройденным.${watch}`,
        action: "Начать урок",
      };
    case "manual":
      return {
        title: "Начните уровень",
        explain: `Это практический уровень: задание выполняется самостоятельно. После начала его можно будет отметить выполненным.${watch}`,
        action: "Начать уровень",
      };
    case "report":
      return {
        title: "Начните уровень",
        explain: `После начала откроется форма отчёта. Отчёт проверяет наставник.${watch}`,
        action: "Начать уровень",
      };
    case "formal-report":
      return {
        title: "Начните уровень",
        explain: `После начала откроется форма отчёта. Черновик сохраняется, проверка автоматическая.${watch}`,
        action: "Начать уровень",
      };
    case "mentor-review":
      return {
        title: "Начните уровень",
        explain: `После начала работу можно будет отправить наставнику.${watch}`,
        action: "Начать уровень",
      };
    default:
      return {
        title: "Начать уровень",
        explain: "Уровень откроется. Прогресс сохраняется на сервере.",
        action: "Начать",
      };
  }
}

/**
 * Where the lesson goes after its video has been watched to the end — the
 * player offers it beside «Смотреть снова». Null when there is nothing to do
 * next on this page (the level is finished, or its task is not here).
 */
export function afterVideoAction(
  method: AcademyCompletionMethod,
  state: AcademyLevelSummary["state"],
): { label: string; href: string } | undefined {
  if (state !== "available" && state !== "in_progress") return undefined;
  if (state === "available") return { label: "Начать урок", href: "#task" };
  switch (method) {
    case "assessment":
      return { label: "Перейти к тесту", href: "#task" };
    case "lesson":
      return { label: "Отметить урок пройденным", href: "#task" };
    case "manual":
      return { label: "К заданию", href: "#task" };
    case "report":
    case "formal-report":
      return { label: "К отчёту", href: "#task" };
    default:
      return undefined;
  }
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
  const levelModule =
    enrolled?.modules.find((module) => module.moduleCode === result.detail.moduleCode) ?? null;
  const moduleTitle = levelModule?.title ?? null;

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

  const method = summary.completionMethod;
  /* The task surfaces need a level the Backend has STARTED (or finished). */
  const begun =
    summary.state === "in_progress" || summary.state === "pending_review" || summary.state === "completed";
  /* A FINISHED LEVEL SAYS SO ONCE. The completion moment states that the level
     is done, what it was worth and what is next. A test or a completion control
     under it could only repeat «уровень завершён» and offer the same link a
     second time — so on a completed level those two surfaces are not rendered.
     A report stays: what the learner wrote in it is still theirs to read. */
  const working = summary.state === "in_progress" || summary.state === "pending_review";
  const hasVideo = content.media !== null;
  /* A short lesson text is printed here; a long one keeps the reading surface. */
  const inlineBody = content.available && isInlineLessonBody(content.body) ? content.body : null;
  /* An external-event level is completed by an event, not by being started. */
  const showStart =
    summary.state === "available" && !summary.typeInfo.isCheckpoint && !summary.typeInfo.isExternal;
  /* What the program's author says the level gives. Printed with its label only
     when it is a RESULT — for a level whose objective is just its description
     (a lesson not produced yet) the description is printed once, as itself. */
  const objectiveIsResult =
    summary.kind !== null &&
    summary.learningObjective.trim() !== "" &&
    summary.learningObjective !== summary.shortDescription;
  /* «Урок» where the author calls the level a lesson; everywhere else — a
     report, a practice, a program that names no kinds — the section keeps the
     heading it always had. */
  const lessonTitle = summary.kind === "lesson" ? "Урок" : "Материал";

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

  /* A LEVEL THE PROGRAM HAS NOT OPENED YET. It has a title and one line, and
     nothing else exists: no lesson, no task, no parameters worth printing. The
     page says exactly that and leaves the two ways out. */
  if (summary.inProduction) {
    return (
      <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
        <div className="ax ld">
          <article data-level={summary.levelCode} data-state={summary.state} data-posture="waiting" data-production="true">
            <header className="ax-lvlhead">
              <LevelCoordinate summary={summary} module={levelModule} />
              <h1 className="ax-lvlhead__title">{summary.title}</h1>
              <p className="ax-lvlhead__row">
                <span className="ax-mark" data-state={summary.state}>
                  {summary.stateLabel}
                </span>
              </p>
              {summary.shortDescription ? (
                <p className="ax-lvlhead__obj">{summary.shortDescription}</p>
              ) : null}
            </header>
            <div className="ax-statestrip" data-posture="waiting">
              <span className="ax-statestrip__dot" aria-hidden="true" />
              <p className="ax-statestrip__text">{explainLevelState(summary)}</p>
            </div>
            <nav className="ax-lvlnav" aria-label="Навигация по уровням">
              {navigation.previousLevelCode ? (
                <Link href={`/lessons/${encodeURIComponent(navigation.previousLevelCode)}`}>← Предыдущий уровень</Link>
              ) : (
                <span />
              )}
              <Link href="/path">Вернуться к пути</Link>
              <span />
            </nav>
          </article>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
      <div className="ax ld">
        <article data-level={summary.levelCode} data-state={summary.state} data-posture={posture}>
          <header className="ax-lvlhead">
            <LevelCoordinate summary={summary} module={levelModule} />
            <h1 className="ax-lvlhead__title">{summary.title}</h1>
            <p className="ax-lvlhead__row">
              <span className="ax-mark" data-state={summary.state}>
                {summary.stateLabel}
              </span>
              <MilestoneMark level={summary} />
            </p>
            {objectiveIsResult ? (
              <p className="ax-lvlhead__obj">
                <span className="ax-lvlhead__objlabel">Результат урока</span>
                {summary.learningObjective}
              </p>
            ) : summary.kind === null && summary.learningObjective ? (
              /* A program without kinds keeps its objective exactly as it was. */
              <p className="ax-lvlhead__obj">{summary.learningObjective}</p>
            ) : !inlineBody && summary.shortDescription ? (
              /* No lesson text will be printed below, so the description is. */
              <p className="ax-lvlhead__obj">{summary.shortDescription}</p>
            ) : null}
          </header>

          {/* One line saying where this level stands and why — the same sentence
              Path prints on its row for this level. */}
          <div className="ax-statestrip" data-posture={posture}>
            <span className="ax-statestrip__dot" aria-hidden="true" />
            <p className="ax-statestrip__text">{explainLevelState(summary)}</p>
          </div>

          {/* A checkpoint is a module boundary and an external-event level is a
              task with no lesson: neither has material, and neither gets a
              section saying that a type "is not displayed yet". */}
          {isCheckpoint || (summary.typeInfo.isExternal && !content.available) ? null : (
            <section className="ax-lvlsec" aria-label="Материал уровня" data-section="lesson">
              <h2>{lessonTitle}</h2>
              {content.available && content.metadata ? (
                <div className="cur-content">
                  {/* View-only: playback records nothing and completes nothing. */}
                  <LessonMedia
                    media={content.media}
                    title={content.metadata.title}
                    endedAction={afterVideoAction(method, summary.state)}
                  />
                  {content.media === null ? (
                    <p className="cur-content__media-pending" data-media="pending">
                      {inlineBody
                        ? "Видео этого урока готовится. Описание урока — ниже."
                        : "Видеоурок готовится. Текстовый материал доступен, проверку можно пройти уже сейчас."}
                    </p>
                  ) : null}

                  {inlineBody ? (
                    <LevelLessonText body={inlineBody} />
                  ) : (
                    <>
                      {content.metadata.title !== summary.title ? (
                        <p className="cur-content__title">{content.metadata.title}</p>
                      ) : null}
                      {content.metadata.subtitle ? (
                        <p className="cur-content__subtitle">{content.metadata.subtitle}</p>
                      ) : null}
                      {content.metadata.summary ? (
                        <p className="cur-content__summary">{content.metadata.summary}</p>
                      ) : null}
                      {/* THE HANDOFF TO THE READING SURFACE.
                          This page owns state and the canonical task; a long
                          written lesson lives on its own surface, so the two
                          are not two copies of one another (§9). What is
                          offered here is the lesson's real SHAPE — how many
                          sections, and how far the learner has read — both
                          facts the Backend owns. Nothing is estimated: there is
                          no invented reading time, because the canonical
                          curriculum does not own one. */}
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
                    </>
                  )}
                </div>
              ) : (
                <p className="ax-lvlsec__note">{CONTENT_NOTE[content.unavailableReason ?? "unavailable"]}</p>
              )}
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

          {/* ONE TASK AT A TIME. Not started: the start control, worded for what
              this level is. Started or finished: the level's own surface. */}
          {showStart
            ? task(<LevelStart stableCode={summary.levelCode} copy={startCopyFor(method, hasVideo)} />, "start")
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

          {summary.typeInfo.type === "lesson" && method === "assessment" && working
            ? task(
                <LevelAssessment
                  stableCode={summary.levelCode}
                  locale={ASSESSMENT_LOCALE}
                  alreadyCompleted={summary.state === "completed"}
                  nextLevelCode={navigation.nextLevelCode}
                  hasLessonVideo={hasVideo}
                />,
                "assessment",
              )
            : null}

          {summary.typeInfo.type === "lesson" && isSelfDeclaredCompletionMethod(method) && working
            ? task(
                <LevelManualCompletion
                  stableCode={summary.levelCode}
                  xpReward={summary.xpReward}
                  alreadyCompleted={summary.state === "completed"}
                  variant={method === "lesson" ? "lesson" : "practice"}
                />,
                "manual",
              )
            : null}

          {summary.typeInfo.type === "report" && isReportCompletionMethod(method) && begun
            ? task(
                <LevelReport
                  stableCode={summary.levelCode}
                  locale={REPORT_LOCALE}
                  nextLevelCode={navigation.nextLevelCode}
                  acceptance={isFormalReportMethod(method) ? "formal" : "review"}
                  /* On a level the page already shows as completed, the way
                     onward is the completion moment's, said once. */
                  nextStep={summary.state === "completed" ? "elsewhere" : "here"}
                />,
                "report",
              )
            : null}

          {summary.typeInfo.type === "mentor-review" && method === "mentor-review" && begun
            ? task(
                <LevelMentorReview
                  stableCode={summary.levelCode}
                  xpReward={summary.xpReward}
                  levelState={summary.state}
                />,
                "mentor",
              )
            : null}

          <LevelUnlocks levelOrder={summary.order} toolAccess={enrolled?.toolAccess ?? null} />

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

/**
 * Where the level sits: chapter, module, number, and what its author calls it.
 *
 * The chapter and the module are printed only when the program has them and
 * this build could read them; a level of a program without chapters reads
 * exactly as it did.
 */
function LevelCoordinate({
  summary,
  module,
}: {
  summary: AcademyLevelSummary;
  module: { order: number; chapter: { number: number; title: string } | null } | null;
}) {
  return (
    <p className="ax-coord">
      {module?.chapter ? <>Глава {module.chapter.number} · </> : null}
      {module?.chapter ? <>Модуль {module.order} · </> : null}
      Уровень <b>{summary.order}</b> · {summary.kindLabel}
    </p>
  );
}
