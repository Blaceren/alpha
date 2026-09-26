import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView, getLevelDetail } from "@/lib/curriculum/provider";
import type { AcademyLevelDetail } from "@/lib/curriculum/academy-view";
import type { LessonBody } from "@/lib/curriculum/lesson-body";
import { CurriculumErrorState } from "@/features/curriculum-api/curriculum-states";
import { levelPosture } from "@/features/academy-experience/level-detail-screen";
import { ReaderBody } from "@/features/reader-fidelity/reader-body";
import { ReaderUnavailable } from "@/features/reader-fidelity/reader-unavailable";
import { AVAILABILITY, availabilityOf, boundaryOf } from "@/features/reader-fidelity/reader-state";
import "@/features/reader-fidelity/reader-fidelity.css";

export const metadata: Metadata = {
  title: "Материал урока — Alfa Trade Academy",
};

/** An authored CTA at the end of the material already carries the action. */
function hasAuthoredCta(body: LessonBody): boolean {
  const all = [...body.sections.flatMap((section) => section.blocks), ...body.appendix];
  return all.some((block) => block.type === "cta");
}

/**
 * THE READER — the data boundary.
 *
 * TWO READS, AND BOTH ARE NEEDED. The level detail carries the published body,
 * the reading position and the level's own state; the curriculum view carries
 * the module this level belongs to. The frozen opening states the address —
 * «МОДУЛЬ 09 · ЧТЕНИЕ ГРАФИКА · УРОВЕНЬ 42» — and the module's number and title
 * are not on the detail payload. Deriving them from the module code string
 * would be inventing an identity the curriculum already owns.
 *
 * A MISSING MODULE IS NOT A FAILURE. If the lookup finds nothing the address
 * simply carries what is known; the material is still readable, and refusing to
 * render a lesson because its kicker is short would be the wrong trade.
 */
export async function ReaderFidelityScreen({ levelCode }: { levelCode: string }) {
  const [viewer, result, curriculum] = await Promise.all([
    getServerViewer(),
    getLevelDetail(levelCode),
    getCurriculumView(),
  ]);
  const name = viewer?.name ?? "Ученик";

  if (!result.ok) {
    /* An address that names no level of this programme is the frozen `invalid`
       class — a page that does not exist, not a service failure. Everything
       else is the product's own bounded error screen. */
    if (result.error.category === "LEVEL_NOT_FOUND") {
      return (
        <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
          <ReaderUnavailable availability="invalid" />
        </AppShell>
      );
    }
    return (
      <AppShell userName={name} activeId="lessons" notificationPresence={<UnreadPresence />}>
        <div className="ax">
          <CurriculumErrorState error={result.error} />
        </div>
      </AppShell>
    );
  }

  const detail: AcademyLevelDetail = result.detail;
  const { summary, content, navigation } = detail;
  const levelHref = `/lessons/${encodeURIComponent(summary.levelCode)}`;

  const availability = availabilityOf(detail);
  if (availability) {
    return (
      <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
        <ReaderUnavailable
          availability={availability}
          levelHref={levelHref}
          identity={{
            moduleOrder: moduleOf(curriculum, detail)?.order ?? null,
            levelOrder: summary.order,
            typeLabel: summary.typeInfo.label,
            /* A locked level never discloses its title: the learner has not
               reached it, and naming it would disclose what the lock withholds. */
            title: availability === "locked" ? null : summary.title,
          }}
        />
      </AppShell>
    );
  }

  const body = content.body!;
  const meta = content.metadata;
  const owningModule = moduleOf(curriculum, detail);

  return (
    <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
      <ReaderBody
        body={body}
        stableCode={summary.levelCode}
        levelHref={levelHref}
        levelOrder={summary.order}
        nextLevelHref={
          navigation.nextLevelCode
            ? `/lessons/${encodeURIComponent(navigation.nextLevelCode)}`
            : null
        }
        moduleOrder={owningModule?.order ?? 0}
        moduleTitle={owningModule?.title ?? ""}
        /* The localized content title when the published content has one, the
           level title otherwise. Never both — two headings saying nearly the
           same thing is the duplication the composition avoids. */
        title={meta?.title ?? summary.title}
        subtitle={meta?.subtitle ?? null}
        objective={summary.learningObjective}
        objectiveExt={meta?.learningObjectiveExtension ?? null}
        initialReading={
          content.reading
            ? {
                revision: content.reading.revision,
                completedSections: content.reading.completedSections,
                activeSectionCode: content.reading.activeSectionCode,
              }
            : null
        }
        /* Reading progress is writable only where the Backend accepts a write:
           a `lesson` level the learner has actually started. Everywhere else
           the text is fully readable and the controls are simply absent. */
        canTrackReading={summary.typeInfo.type === "lesson" && summary.state === "in_progress"}
        playbackPositionSeconds={content.reading?.playbackPositionSeconds ?? 0}
        posture={levelPosture(summary.state)}
        boundary={boundaryOf(summary)}
        completionMethod={summary.completionMethod}
        hasAuthoredCta={hasAuthoredCta(body)}
      />
    </AppShell>
  );
}

function moduleOf(
  curriculum: Awaited<ReturnType<typeof getCurriculumView>>,
  detail: AcademyLevelDetail,
): { order: number; title: string } | null {
  if (!curriculum.ok) return null;
  const view = curriculum.view;
  if (view.state !== "enrolled" && view.state !== "completed") return null;
  const found = view.modules.find((m) => m.moduleCode === detail.moduleCode);
  return found ? { order: found.order, title: found.title } : null;
}

export { AVAILABILITY };
