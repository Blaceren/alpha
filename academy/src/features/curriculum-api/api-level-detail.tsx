import { AppShell } from "@/components/shell/app-shell";
import Link from "next/link";
import { getServerViewer } from "@/server/auth/server-session";
import { getLevelDetail } from "@/lib/curriculum/provider";
import type { AcademyLevelContent } from "@/lib/curriculum/academy-view";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import { LevelAssessment } from "@/features/assessment/level-assessment";
import { LevelCheckpoint } from "@/features/checkpoint/level-checkpoint";
import { LevelReport } from "@/features/report/level-report";
import { LevelManualCompletion } from "@/features/manual-completion/level-manual-completion";
import { LevelMentorReview } from "@/features/mentor-review/level-mentor-review";
import { completionMethodLabel, isManualCompletionMethod } from "@/lib/curriculum/completion-method";
import { LevelStart } from "@/features/level-start/level-start";
import { PocketRegistration } from "@/features/pocket-registration/pocket-registration";
import { PocketRegistrationConfirmed } from "@/features/pocket-registration/pocket-registration-confirmed";
import {
  shouldShowPocketRegistration,
  shouldShowPocketRegistrationConfirmed,
} from "@/features/pocket-registration/model/pocket-registration-visibility";
import { LessonMedia } from "@/features/lesson-media/lesson-media";
import "@/features/curriculum-api/curriculum-api.css";

const ASSESSMENT_LOCALE = "ru";
const REPORT_LOCALE = "ru";

const CONTENT_NOTE: Record<NonNullable<AcademyLevelContent["unavailableReason"]>, string> = {
  not_configured: "Учебный материал для этого уровня ещё не привязан.",
  locked: "Материал станет доступен, когда уровень будет открыт.",
  not_enrolled: "Материал доступен после зачисления на программу.",
  unsupported_type: "Этот тип уровня пока не отображается.",
  unavailable: "Материал сейчас недоступен.",
};

export async function ApiLevelDetail({ levelCode }: { levelCode: string }) {
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
        <div className="cur-api">{body}</div>
      </AppShell>
    );
  }

  const { summary, content, prerequisites, navigation } = result.detail;
  // A financial checkpoint is a module boundary, not a lesson. It has no
  // material by definition, so the "Материал" section is suppressed rather than
  // shown with a note about a type that "is not displayed yet" — which stopped
  // being true the moment this branch existed.
  const isCheckpoint = summary.typeInfo.type === "checkpoint";

  // The Pocket registration action (POCKETCTA-1). An `external_event` level is
  // completed by an authenticated Pocket postback, so the only thing the Academy
  // can offer is the affiliate link — and only while the requirement is actually
  // outstanding. `available` and `in_progress` are exactly the current-and-
  // incomplete states, so a completed, pending or locked level shows nothing, and
  // a learner with no enrolment is excluded explicitly rather than by implication.
  const showPocketRegistration = shouldShowPocketRegistration({
    isExternal: summary.typeInfo.isExternal,
    state: summary.state,
    contentUnavailableReason: content.unavailableReason,
  });

  return (
    <AppShell userName={name} activeId="lessons">
      <div className="cur-api">
        <article className="cur-detail" data-level={summary.levelCode} data-state={summary.state}>
          <header className="cur-detail__head">
            <p className="cur-detail__eyebrow">
              Уровень {summary.order} · {summary.typeInfo.label}
            </p>
            <h1 className="cur-detail__title">{summary.title}</h1>
            <p className="cur-detail__state" data-state={summary.state}>{summary.stateLabel}</p>
            <p className="cur-detail__objective">{summary.learningObjective}</p>
          </header>

          <section className="cur-detail__meta" aria-label="Параметры уровня">
            <dl>
              <div><dt>Тип</dt><dd>{summary.typeInfo.label}</dd></div>
              <div><dt>Способ завершения</dt><dd>{completionMethodLabel(summary.completionMethod)}</dd></div>
              <div><dt>XP за уровень</dt><dd>{summary.xpReward}</dd></div>
              <div><dt>Предыдущий уровень</dt><dd>{prerequisites.previousLevel ?? "—"}</dd></div>
              {prerequisites.checkpointLevel !== null ? (
                <div><dt>Контрольная точка</dt><dd>уровень {prerequisites.checkpointLevel}</dd></div>
              ) : null}
            </dl>
          </section>

          {isCheckpoint ? null : (
          <section className="cur-detail__content" aria-label="Материал уровня">
            <h2>Материал</h2>
            {content.available && content.metadata ? (
              <div className="cur-content">
                {/* The lesson video, when the published curriculum has one. It is
                    view-only: playback records nothing and completes nothing —
                    the assessment below remains this level's sole owner. */}
                <LessonMedia media={content.media} title={content.metadata.title} />
                <p className="cur-content__title">{content.metadata.title}</p>
                {content.metadata.subtitle ? <p className="cur-content__subtitle">{content.metadata.subtitle}</p> : null}
                <p className="cur-content__summary">{content.metadata.summary}</p>
                <ul className="cur-content__facts">
                  {content.metadata.videoDurationSeconds !== null ? (
                    <li>Видео: {Math.round(content.metadata.videoDurationSeconds / 60)} мин</li>
                  ) : null}
                  <li>Материал: {content.metadata.hasTranscript ? "есть расшифровка" : "без расшифровки"}</li>
                  <li>Локаль: {content.metadata.locale}</li>
                </ul>
                {content.media === null ? (
                  /* Honest media-pending surface (CI-3), now keyed on whether a
                     real playable asset exists rather than on a duration field —
                     a published duration with no source would have promised a
                     video the learner could not watch. */
                  <p className="cur-content__media-pending" data-media="pending">
                    Видеоурок готовится. Текстовый материал доступен, проверку можно пройти уже сейчас.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="cur-content__none">{CONTENT_NOTE[content.unavailableReason ?? "unavailable"]}</p>
            )}
            {/* The lesson MATERIAL remains view-only; the graded check below is the
                only submission surface, and it is server-authoritative. */}
            <p className="cur-detail__readonly">Материал — только просмотр. Прогресс сохраняется на сервере.</p>
          </section>
          )}

          {/* The legal level start (L2START-PLAYER-1). Offered only on a level
              the Backend reports as `available` — the one state in which the
              start owner will accept — and never on a financial checkpoint,
              which is resolved by an external authority rather than started.
              An in-progress or completed level shows nothing here: the material
              and the check below are already open. */}
          {summary.state === "available" && !isCheckpoint ? (
            <LevelStart stableCode={summary.levelCode} />
          ) : null}

          {/* The Pocket registration action (POCKETCTA-1). It obtains the external
              affiliate URL from the authenticated Backend referral-link owner and
              opens it; it completes nothing. Level 1 stays incomplete until the
              real Pocket postback arrives, which is the only owner that can
              complete it and unlock Level 2. */}
          {showPocketRegistration ? <PocketRegistration /> : null}

          {/* XP-L1-FEEDBACK (minimum viable). Once the Backend reports the
              external_event level completed, the learner is told in words that
              Pocket confirmed the registration — not left to infer it from a
              vanished button — and is offered the one next step. Server-derived
              state only; nothing is polled and nothing is written. */}
          {shouldShowPocketRegistrationConfirmed({
            isExternal: summary.typeInfo.isExternal,
            state: summary.state,
          }) ? (
            <PocketRegistrationConfirmed nextLevelCode={navigation.nextLevelCode} />
          ) : null}

          {/* Financial checkpoint (L4HG-1, L4VC-1). The Backend decides whether
              the condition can be verified at all and what the answer is; the
              Academy only renders that decision and offers at most one control
              to ask. There is no verify action while verification is
              unavailable, and no learner input of any kind — the request body
              carries a request identity and nothing else. */}
          {isCheckpoint && summary.checkpoint ? (
            <LevelCheckpoint
              levelNumber={summary.order}
              stableCode={summary.levelCode}
              checkpoint={summary.checkpoint}
            />
          ) : null}

          {/* Server-graded assessment (CI-3). Rendered for accessible lesson levels;
              a lesson without a configured assessment degrades to a bounded notice
              from the Backend. Pass/completion are derived from Backend responses.

              G3 narrows this by completion method. A `lesson` is not one thing:
              58 canonical levels are `lesson:assessment_pass` and 13 are
              `lesson:manual`. Rendering the assessment surface on a manual level
              showed a check that does not exist and offered no way to finish, so
              the two are now selected explicitly and are mutually exclusive. */}
          {summary.typeInfo.type === "lesson" &&
          summary.completionMethod === "assessment" &&
          summary.routeAccessible ? (
            <LevelAssessment
              stableCode={summary.levelCode}
              locale={ASSESSMENT_LOCALE}
              alreadyCompleted={summary.state === "completed"}
              nextLevelCode={navigation.nextLevelCode}
            />
          ) : null}

          {/* Manual practical completion (G3). The 13 canonical `lesson:manual`
              levels are finished by an explicit learner declaration against real
              instructional content — the platform cannot witness the exercise and
              does not pretend to. The control asks for a confirmation and then
              calls the shipped `level_completion` owner, which re-checks the
              enrollment, the owner, the current level and the started state and
              is idempotent on the request identity. Nothing about completion is
              decided here. */}
          {summary.typeInfo.type === "lesson" &&
          isManualCompletionMethod(summary.completionMethod) &&
          summary.routeAccessible ? (
            <LevelManualCompletion
              stableCode={summary.levelCode}
              xpReward={summary.xpReward}
              alreadyCompleted={summary.state === "completed"}
            />
          ) : null}

          {/* Server-authoritative L3 learner report (CI-4). Rendered for accessible
              report levels; the definition, draft, submit, revision and approval
              all come from the Backend. Completion/XP are never computed here. */}
          {summary.typeInfo.type === "report" && summary.routeAccessible ? (
            <LevelReport
              stableCode={summary.levelCode}
              locale={REPORT_LOCALE}
              nextLevelCode={navigation.nextLevelCode}
            />
          ) : null}

          {/* Mentor-reviewed practical (G3). The learner's only transition is
              `in_progress -> pending_review`; a reviewer, never the learner, moves
              it to `completed`. The canonical lifecycle has no artifact, no rubric
              and no rejection path, so this surface offers exactly one action and
              then shows the honest waiting state. */}
          {summary.typeInfo.type === "mentor-review" &&
          summary.completionMethod === "mentor-review" &&
          summary.routeAccessible ? (
            <LevelMentorReview
              stableCode={summary.levelCode}
              xpReward={summary.xpReward}
              levelState={summary.state}
            />
          ) : null}

          <nav className="cur-detail__nav" aria-label="Навигация по уровням">
            {navigation.previousLevelCode ? (
              <Link href={`/lessons/${encodeURIComponent(navigation.previousLevelCode)}`}>← Предыдущий</Link>
            ) : <span />}
            {navigation.nextLevelCode ? (
              <Link href={`/lessons/${encodeURIComponent(navigation.nextLevelCode)}`}>Следующий →</Link>
            ) : <span />}
          </nav>
        </article>
      </div>
    </AppShell>
  );
}
