import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { getLevelDetail } from "@/lib/curriculum/provider";
import type { AcademyLevelContent } from "@/lib/curriculum/academy-view";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import { LevelAssessment } from "@/features/assessment/level-assessment";
import { LevelCheckpoint } from "@/features/checkpoint/level-checkpoint";
import { LevelReport } from "@/features/report/level-report";
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
              <div><dt>Способ завершения</dt><dd>{summary.completionSource}</dd></div>
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
                {content.metadata.videoDurationSeconds === null ? (
                  /* Honest media-pending surface. Compatible with a later branded
                     player; CI-3 does not introduce the player component. */
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

          {/* Financial checkpoint (L4HG-1). The Backend decides whether the
              condition can be verified at all; the Academy only renders that
              decision. There is no verify action while verification is
              unavailable, and no learner input of any kind. */}
          {isCheckpoint && summary.checkpoint ? (
            <LevelCheckpoint levelNumber={summary.order} checkpoint={summary.checkpoint} />
          ) : null}

          {/* Server-graded assessment (CI-3). Rendered for accessible lesson levels;
              a lesson without a configured assessment degrades to a bounded notice
              from the Backend. Pass/completion are derived from Backend responses. */}
          {summary.typeInfo.type === "lesson" && summary.routeAccessible ? (
            <LevelAssessment
              stableCode={summary.levelCode}
              locale={ASSESSMENT_LOCALE}
              alreadyCompleted={summary.state === "completed"}
              nextLevelCode={navigation.nextLevelCode}
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

          <nav className="cur-detail__nav" aria-label="Навигация по уровням">
            {navigation.previousLevelCode ? (
              <a href={`/lessons/${encodeURIComponent(navigation.previousLevelCode)}`}>← Предыдущий</a>
            ) : <span />}
            {navigation.nextLevelCode ? (
              <a href={`/lessons/${encodeURIComponent(navigation.nextLevelCode)}`}>Следующий →</a>
            ) : <span />}
          </nav>
        </article>
      </div>
    </AppShell>
  );
}
