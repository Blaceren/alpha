import type { HomeScenario, RouteNodeModel } from "@/domain/home";
import { ModuleBoundary } from "@/components/progression/module-boundary";
import { RouteContinuation } from "@/components/progression/route-continuation";

/**
 * The Route Field — the primary composition object. A luminous route through the
 * screen (SVG, decorative, aria-hidden). Geometry differs by scenario and by
 * breakpoint (wide vs narrow groups toggled in CSS). It is NOT a stock chart.
 * The meaning (levels, current step, checkpoint, reward) is duplicated as text in
 * the module progress, the plane/gate content, and the screen-reader route list.
 */
export function RouteField({
  scenario,
  route,
  currentLevel,
  nextLevel,
  checkpointLevel,
}: {
  scenario: HomeScenario;
  route: RouteNodeModel[];
  currentLevel: number;
  nextLevel: number;
  checkpointLevel: number;
}) {
  return (
    <>
      <svg className="routebg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {scenario === "active" ? (
          <>
            <g className="r-wide">
              {/* completed route rises up the empty left column to the current node (~27%, 32%).
                  The plane's own top+left borders (CSS) are the route-derived edges. */}
              <path className="route-line rc-glow" d="M0 82 C 10 78, 16 58, 27 32" />
              <path className="route-line rc-completed" d="M0 82 C 10 78, 16 58, 27 32" vectorEffect="non-scaling-stroke" />
              {/* upcoming continues up-right toward the checkpoint boundary */}
              <path className="route-line rc-upcoming" d="M27 32 C 46 26, 64 19, 82 12" vectorEffect="non-scaling-stroke" />
              <RouteContinuation d="M82 12 C 88 10, 92 8, 98 6" />
              <ModuleBoundary x={11} y1={52} y2={90} />
            </g>
            <g className="r-narrow">
              {/* route lives in the top zone and arrives at the node (~7%, 17%); clears the plane below */}
              <path className="route-line rc-glow" d="M-8 36 C 2 28, 5 22, 7 17" />
              <path className="route-line rc-completed" d="M-8 36 C 2 28, 5 22, 7 17" vectorEffect="non-scaling-stroke" />
              <RouteContinuation d="M7 17 C 22 11, 44 6, 74 1" />
            </g>
          </>
        ) : (
          <>
            <g className="r-wide">
              <path className="route-line rc-glow" d="M2 96 C 20 90, 38 82, 49 58" />
              <path className="route-line rc-completed" d="M2 96 C 20 90, 38 82, 49 58" vectorEffect="non-scaling-stroke" />
              <RouteContinuation d="M52 40 C 64 34, 80 30, 96 28" />
            </g>
            <g className="r-narrow">
              {/* arrives at the gate through the top band (stays above the heading below) */}
              <path className="route-line rc-glow" d="M-8 23 C 12 22, 28 22, 44 22" />
              <path className="route-line rc-completed" d="M-8 23 C 12 22, 28 22, 44 22" vectorEffect="non-scaling-stroke" />
              <RouteContinuation d="M56 22 C 70 21, 84 20, 98 19" />
            </g>
          </>
        )}
      </svg>

      {/* Screen-reader alternative to the visual route (a11y baseline). */}
      <nav className="sr-only" aria-label="Твой путь обучения">
        <p>Текущий уровень: {currentLevel}. Следующий шаг: уровень {nextLevel}.</p>
        <ul>
          {route.map((n) => (
            <li key={n.index}>
              Уровень {n.index}: {n.label} —{" "}
              {n.state === "current"
                ? "текущий"
                : n.state === "completed"
                  ? "завершён"
                  : n.state === "checkpoint"
                    ? "контрольная точка"
                    : n.state === "upcoming"
                      ? "следующий"
                      : "закрыт"}
              .
            </li>
          ))}
        </ul>
        <p>Следующая контрольная точка: уровень {checkpointLevel}.</p>
      </nav>
    </>
  );
}
