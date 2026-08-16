/**
 * THE RICH LESSON — the reading surface, on canonical data (§6, §8, §9).
 *
 * WHAT IT IS FOR, AND HOW IT DIFFERS FROM LEVEL DETAIL.
 *   LEVEL DETAIL answers "where am I and what does this level want from me":
 *   state, task context, progression position, and the canonical control.
 *   THIS answers "teach me the thing": the written lesson itself, set for
 *   reading, with an outline, the learner's own position in it, and exactly one
 *   way back into the canonical task.
 *
 * It is deliberately NOT a second copy of Level Detail. It carries no task
 * control, no XP figure, no level parameters table, no prev/next level pager and
 * no completion of any kind. The one state sentence it shows is the SAME
 * sentence `explainLevelState` gives Home, Path and Level Detail — three
 * surfaces telling a learner three different things is the failure this whole
 * phase exists to prevent, and a fourth surface must not reintroduce it.
 *
 * THE TRANSITION IS AUTHORED, NOT INVENTED (§8, §11). Every published lesson
 * ends with a canonical `cta` block whose action already matches the level's
 * completion method — `start_assessment` on the 58 assessment levels,
 * `request_mentor_review` on the practical ones, `next_level` where the level is
 * finished by declaration. That block is rendered as written and points at the
 * level page, where the canonical control lives. Only when a body carries no CTA
 * at all does this surface derive one from the completion method, and even then
 * it is a LINK to the authority, never an action.
 *
 * NOTHING HERE IS FIXTURE-FED. The body, the sections, the exercises and their
 * estimated minutes, the tool links and the reading position all come from the
 * Backend. Fields the canonical curriculum does not own — a lesson-level reading
 * time, a teacher, a difficulty, a completion percentage — are absent rather
 * than estimated (§7).
 */
import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { getLevelDetail } from "@/lib/curriculum/provider";
import { explainLevelState } from "@/lib/curriculum/next-action";
import type { AcademyLevelDetail } from "@/lib/curriculum/academy-view";
import { collectResources, type LessonBody } from "@/lib/curriculum/lesson-body";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import { levelPosture } from "@/features/academy-experience/level-detail-screen";
import { LessonReading } from "@/features/lesson-reader/lesson-reading";
import { ctaHref } from "@/features/lesson-reader/lesson-blocks";
import "@/features/curriculum-api/curriculum-api.css";
import "@/features/academy-experience/experience.css";
import "@/features/lesson-reader/lesson-reader.css";

export const metadata: Metadata = {
  title: "Материал урока — Alfa Trade Academy",
};

/**
 * The transition sentence for a lesson whose body carries no CTA of its own.
 *
 * Derived from the canonical completion method — the same field that decides
 * which task component Level Detail renders — so the two can never disagree
 * about what finishes this level.
 */
function derivedTransition(detail: AcademyLevelDetail): { label: string; body: string } | null {
  switch (detail.summary.completionMethod) {
    case "assessment":
      return { label: "Перейти к проверке знаний", body: "Уровень завершает короткая проверка по этому материалу." };
    case "manual":
      return { label: "Перейти к заданию", body: "Уровень завершается вашей отметкой о выполнении." };
    case "report":
      return { label: "Перейти к отчёту", body: "Уровень завершается после того, как отчёт примет наставник." };
    case "mentor-review":
      return { label: "Перейти к отправке на проверку", body: "Уровень засчитывает наставник." };
    case "external-event":
      return { label: "Перейти к регистрации", body: "Уровень завершится после подтверждения от партнёра." };
    default:
      return null;
  }
}

/** Does the body already end with its own authored next step? */
function hasAuthoredCta(body: LessonBody): boolean {
  const all = [...body.sections.flatMap((section) => section.blocks), ...body.appendix];
  return all.some((block) => block.type === "cta");
}

export async function LessonReaderScreen({ levelCode }: { levelCode: string }) {
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

  const { summary, content, navigation } = result.detail;
  const levelHref = `/lessons/${encodeURIComponent(summary.levelCode)}`;
  const nextLevelHref = navigation.nextLevelCode
    ? `/lessons/${encodeURIComponent(navigation.nextLevelCode)}`
    : null;

  // No readable body: say so plainly and send the learner back to the level,
  // which still has its canonical state and its canonical control. This is the
  // honest state for a checkpoint (which has no material by definition), for a
  // locked level, and for a lesson whose content is not yet configured.
  if (!content.available || !content.body) {
    return (
      <AppShell userName={name} activeId="lessons">
        <div className="ax">
          <div className="lr">
            <p className="lr-back">
              <a href={levelHref}>← Уровень {summary.order}</a>
            </p>
            <CurriculumInfoState
              title="Материал недоступен"
              message="Для этого уровня пока нет учебного материала. Состояние уровня и его задание — на странице уровня."
            />
          </div>
        </div>
      </AppShell>
    );
  }

  const body = content.body;
  const meta = content.metadata;
  const posture = levelPosture(summary.state);
  const resources = collectResources(body);
  const transition = hasAuthoredCta(body) ? null : derivedTransition(result.detail);

  /**
   * Reading progress is writable only where the Backend accepts a write: a
   * `lesson` level the learner has actually started. Everywhere else the text
   * is fully readable and the controls are simply absent.
   */
  const canTrackReading = summary.typeInfo.type === "lesson" && summary.state === "in_progress";

  return (
    <AppShell userName={name} activeId="lessons">
      <div className="ax">
        <article className="lr" data-level={summary.levelCode} data-state={summary.state}>
          <p className="lr-back">
            <a href={levelHref}>← Уровень {summary.order}</a>
          </p>

          <header className="lr-head">
            <p className="ax-coord">
              Уровень <b>{summary.order}</b> · {summary.typeInfo.label}
            </p>
            {/* The localized content title when the published content has one,
                the level title otherwise. Never both — that is the duplication
                §9 warns about, two headings saying nearly the same thing. */}
            <h1 className="lr-title">{meta?.title ?? summary.title}</h1>
            {meta?.subtitle ? <p className="lr-subtitle">{meta.subtitle}</p> : null}
          </header>

          <section className="lr-objective" aria-label="Цель урока">
            <p className="lr-objective__label">Чему учит этот урок</p>
            <p className="lr-objective__text">{summary.learningObjective}</p>
            {meta?.learningObjectiveExtension ? (
              <p className="lr-objective__ext">{meta.learningObjectiveExtension}</p>
            ) : null}
          </section>

          {/* THE SHARED SENTENCE. Identical to Home, Path and Level Detail. */}
          <div className="ax-statestrip" data-posture={posture}>
            <span className="ax-statestrip__dot" aria-hidden="true" />
            <p className="ax-statestrip__text">{explainLevelState(summary)}</p>
          </div>

          <LessonReading
            body={body}
            stableCode={summary.levelCode}
            levelHref={levelHref}
            nextLevelHref={nextLevelHref}
            initialReading={
              content.reading
                ? {
                    revision: content.reading.revision,
                    completedSections: content.reading.completedSections,
                    activeSectionCode: content.reading.activeSectionCode,
                  }
                : null
            }
            canTrackReading={canTrackReading}
            playbackPositionSeconds={content.reading?.playbackPositionSeconds ?? 0}
          />

          {resources.length > 0 ? (
            <section className="lr-resources" aria-label="Материалы урока">
              <h2 className="lr-resources__title">Материалы</h2>
              <ul className="lr-resources__list">
                {resources.map((resource) => (
                  <li key={resource.url}>
                    <a href={resource.url} rel="noopener">
                      {resource.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Only when the author wrote no CTA of their own. */}
          {transition ? (
            <div className="lr-cta" data-derived="true">
              <p className="lr-cta__body">{transition.body}</p>
              <a
                className="lr-cta__link"
                href={ctaHref("start_assessment", null, levelHref, nextLevelHref)}
              >
                {transition.label}
              </a>
            </div>
          ) : null}

          <nav className="lr-foot" aria-label="Навигация">
            <a href={levelHref}>← Вернуться к уровню</a>
            <a href="/path">Открыть путь</a>
          </nav>
        </article>
      </div>
    </AppShell>
  );
}
