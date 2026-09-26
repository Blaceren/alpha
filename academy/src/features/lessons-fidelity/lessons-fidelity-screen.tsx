import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import type { AcademyCurriculumView } from "@/lib/curriculum/academy-view";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import {
  LessonsCorpus,
  type CorpusMaterial,
  type SearchCapability,
} from "@/features/lessons-fidelity/lessons-corpus";
import { countPhrase } from "@/features/lessons-fidelity/ru-plural";
import "@/features/lessons-fidelity/lessons-fidelity.css";

/**
 * LESSONS — the reference corpus, restored.
 *
 * VISUAL AUTHORITY: LessonsATA @ e311a849bcd12b086de68d6cb41f908e8b99f910 —
 * `hifi/index.html`, `hifi/styles.css`, `hifi/script.js` and `hifi/ru-plural.js`.
 * One tonal territory: a head that states what this page is, and a register of
 * material grouped by module.
 *
 * DATA AUTHORITY: the product. The corpus is derived exactly as the deployed
 * Lessons already derives it — a level is a candidate when it is
 * `routeAccessible` and not locked — and every title, module, code and
 * destination comes from `/api/backend/curriculum/current`. The frozen
 * artifact's V2/V4 fixtures and its ten `?scenario=` cases are not here.
 *
 * WHAT LESSONS IS, AND IS NOT. Path answers «где я в программе?». Lessons
 * answers «что я уже могу перечитать?». So this page deliberately shows LESS
 * than Path: locked future material is not listed here at all, because being
 * locked is Path's point and not this page's.
 *
 * WHAT THE FROZEN ARTIFACT LEFT OPEN, AND HOW IT IS HANDLED:
 *
 *   * REFERENCE ELIGIBILITY is marked in the frozen source as a PRODUCT/API
 *     CONTRACT HOLD — the artifact used an "interim safe derivation" and said
 *     so. The product's own rule settles it, unchanged from what is deployed.
 *
 *   * SEARCH CAPABILITY is a VM input whose safe default the frozen handoff
 *     fixes as `hidden`, with the rollout threshold recorded as NEEDS PRODUCT.
 *     The control is implemented and capability-conditional; the value stays at
 *     the safe default. See `lessons-corpus.tsx`.
 *
 *   * THE RESUME LINE — «Сохранена позиция — раздел N из M» — is not rendered.
 *     Reading position lives on the per-level detail payload, not on the
 *     progression summary this page reads, so showing it would mean fetching
 *     every material's detail to draw one line on some of them. The frozen
 *     markup for it is preserved in the stylesheet; it returns when the index
 *     payload carries the position.
 *
 *   * THE LOADING LINE is a QA-only state in the frozen artifact, reached by
 *     `?state=loading`. This page renders on the server, so the corpus is
 *     either there or the read failed — and a read failure is the product's own
 *     bounded error screen, not a quiet line.
 *
 * The prototype's own topbar and its `qa-harness` are not carried across, for
 * the same reasons as on every other restored surface.
 */
type Enrolled = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

/**
 * The product's value for the frozen capability input. Deliberately a named
 * constant at the top of the file rather than a literal in the markup: it is a
 * product decision waiting to be made, and it should be visible as one.
 */
export const LESSONS_SEARCH_CAPABILITY: SearchCapability = "hidden";

export function corpusOf(view: Enrolled): CorpusMaterial[] {
  return view.modules.flatMap((module) =>
    module.levels
      .filter((level) => level.routeAccessible && level.state !== "locked")
      .map((level) => ({
        levelCode: level.levelCode,
        order: level.order,
        title: level.title,
        href: level.href,
        moduleOrder: module.order,
        moduleTitle: module.title,
        /* Reached, listed, but its content cannot be opened right now. The
           frozen surface has a state for exactly this and it is not a link. */
        unavailable: !level.typeInfo.supported,
      })),
  );
}

export async function LessonsFidelityScreen() {
  const [viewer, result] = await Promise.all([getServerViewer(), getCurriculumView()]);
  const name = viewer?.name ?? "Ученик";

  const bare = (children: React.ReactNode) => (
    <AppShell userName={name} activeId="lessons" notificationPresence={<UnreadPresence />}>
      <div className="ax">{children}</div>
    </AppShell>
  );

  if (!result.ok) return bare(<CurriculumErrorState error={result.error} />);
  if (result.view.state === "unavailable") {
    return bare(
      <CurriculumInfoState
        title="Программа готовится"
        message="Активная учебная программа пока не опубликована."
      />,
    );
  }
  if (result.view.state === "candidate") {
    return bare(
      <CurriculumInfoState
        title={result.view.curriculum.title}
        message="Материалы откроются после зачисления на программу."
      />,
    );
  }

  const materials = corpusOf(result.view);

  return (
    <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
      <div className="lsn">
        <section className="lessons-head" aria-labelledby="lessons-title">
          <div className="lessons-head__row">
            <h1 id="lessons-title">Уроки</h1>
            {materials.length > 0 ? (
              <p className="lessons-head__count" id="corpus-count">
                {countPhrase(materials.length)}
              </p>
            ) : null}
          </div>
          {/* ACCESS, not OPENED — a material can be legitimately accessible
              without the Reader ever having been opened on it. */}
          <p className="lessons-head__orient" id="orient">
            Материалы, к которым у вас уже есть доступ. Возвращайтесь, когда нужно освежить тему
            или восстановить контекст.
          </p>
        </section>

        <LessonsCorpus materials={materials} capability={LESSONS_SEARCH_CAPABILITY} />
      </div>
    </AppShell>
  );
}
