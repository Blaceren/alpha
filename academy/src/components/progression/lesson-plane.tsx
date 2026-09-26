import type { HomeState } from "@/domain/home";
import { RouteNode } from "@/components/progression/route-node";
import { ModuleProgress } from "@/components/progression/module-progress";
import { PrimaryRouteAction } from "@/components/progression/primary-route-action";
import { levelCodeFor } from "@/features/lesson/model/lesson";

/**
 * The lesson context as an OPEN field carved from the current node — bounded on
 * top + left by route-derived edges, open toward the bottom-right (not a card).
 * The current node sits at the plane's top-left corner (wide). The route does not
 * pass through the text. The CTA is a separate control, not the whole plane.
 */
export function LessonPlane({ state }: { state: HomeState }) {
  const { lesson, route, primaryAction } = state;
  return (
    <section className="lesson-plane" aria-labelledby="lesson-title">
      <RouteNode className="node-wide" />
      <p className="action-ctx">Следующий шаг · Уровень {lesson.levelIndex}</p>
      <h1 className="lesson-title" id="lesson-title">
        {lesson.title}
      </h1>
      <p className="route-meta">
        Модуль {lesson.module.ordinal} «{lesson.module.name}» · пройдено{" "}
        {lesson.module.completed} из {lesson.module.total}
      </p>
      <ModuleProgress route={route} />
      <div className="cta-wrap">
        <PrimaryRouteAction
          label={primaryAction.label}
          href={`/lessons/${levelCodeFor(lesson.levelIndex)}`}
        />
      </div>
    </section>
  );
}
