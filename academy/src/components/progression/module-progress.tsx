import { Fragment } from "react";
import type { RouteNodeModel } from "@/domain/home";

/** Small learning-spine fragment: the current module's levels (16–20) as a
 *  compact progress line inside the lesson context. Secondary to the route. */
export function ModuleProgress({ route }: { route: RouteNodeModel[] }) {
  const levels = route.filter((n) => n.index >= 16 && n.index <= 20);
  return (
    <div className="modline" role="img" aria-label="Прогресс текущего модуля">
      {levels.map((n, i) => (
        <Fragment key={n.index}>
          {i > 0 && <s className={levels[i - 1]?.state === "completed" ? "done" : ""} />}
          <i
            className={
              n.state === "checkpoint"
                ? "cp"
                : n.state === "current"
                  ? "cur"
                  : n.state === "completed"
                    ? "done"
                    : ""
            }
          />
        </Fragment>
      ))}
    </div>
  );
}
