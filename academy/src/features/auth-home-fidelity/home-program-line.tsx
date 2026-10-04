import type { ProgramModule, ProgramPosition } from "@/lib/curriculum/program-points";
import { select } from "@/features/lessons-fidelity/ru-plural";
import { isPreparing } from "@/features/auth-home-fidelity/home-overview-model";

/**
 * THE PROGRAM LINE — Home's signature object (DD-337).
 *
 * The whole program as one line: a point for every level, broken into its
 * modules, the chapters named above. What is done is lit, the level in front
 * of the learner carries the Signal and its halo, what is ahead is an open
 * ring, and what the program has defined and not opened is drawn dashed. From
 * the current point a thin leader drops to the priority below it, so «where
 * am I» and «what now» read as one object — the same relation Path draws
 * between its rail and its focus, at the scale of the whole program.
 *
 * It is a picture, and says so: `role="img"` with one sentence for a screen
 * reader. The module list under the priority carries the same facts as text
 * and links, so nothing here needs to be focusable.
 */
export function HomeProgramLine({ position }: { position: ProgramPosition }) {
  const dense = position.total > 40;
  const preparing = position.total - position.open;
  const summary = [
    `Программа: ${position.total} ${select(position.total, { one: "уровень", few: "уровня", many: "уровней" })} в ${position.modules.length} ${select(position.modules.length, { one: "модуле", few: "модулях", many: "модулях" })}`,
    `пройдено ${position.completed}`,
    position.current ? `сейчас уровень ${position.current.point.order}` : null,
    preparing > 0 ? `ещё ${preparing} готовятся` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const chapters = position.modules.some((module) => module.chapter !== null);

  return (
    <figure
      className="hm-line"
      role="img"
      aria-label={`${summary}.`}
      data-dense={dense ? "1" : undefined}
      data-chapters={chapters ? "1" : undefined}
    >
      <ol className="hm-line__modules">
        {position.modules.map((module, index) => {
          const previous = position.modules[index - 1];
          const opensChapter =
            module.chapter !== null && (previous === undefined || previous.chapter?.number !== module.chapter.number);
          return (
            <li
              key={module.moduleCode}
              className="hm-mod"
              style={{ flexGrow: Math.max(module.points.length, 1), ["--hm-lit" as string]: litStop(module) }}
              data-focus={position.focusModule?.moduleCode === module.moduleCode ? "1" : undefined}
              data-chapter-start={opensChapter && index > 0 ? "1" : undefined}
              data-preparing={isPreparing(module) ? "1" : undefined}
            >
              {opensChapter && module.chapter ? (
                <span className="hm-mod__chapter">
                  Глава {module.chapter.number}
                  <span className="hm-mod__chapter-title"> · {module.chapter.title}</span>
                  {chapterPreparing(position, module.chapter.number) ? (
                    <span className="hm-mod__chapter-state"> · готовится</span>
                  ) : null}
                </span>
              ) : null}
              <span className="hm-mod__num">{String(module.order).padStart(2, "0")}</span>
              <span className="hm-mod__track">
                {module.points.map((point) => (
                  <span key={point.levelCode} className={`hm-pt hm-pt--${point.state}`} data-level={point.order} />
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

/**
 * How far along its own stretch a module's line is lit: to the centre of its
 * last done or current point. The points are equal boxes spread edge to edge,
 * so the centre of point i of n is half a box in, plus i/(n−1) of the rest.
 */
export function litStop(module: ProgramModule): string {
  const n = module.points.length;
  let last = -1;
  module.points.forEach((point, index) => {
    if (point.state === "done" || point.state === "current") last = index;
  });
  if (last < 0) return "0%";
  if (last === n - 1 && module.points[last]!.state === "done") return "100%";
  const share = n > 1 ? last / (n - 1) : 0.5;
  return `calc(var(--hm-pt-half) + (100% - 2 * var(--hm-pt-half)) * ${share.toFixed(4)})`;
}

/** Every level of the chapter is defined and not open yet. */
function chapterPreparing(position: ProgramPosition, chapter: number): boolean {
  const modules: ProgramModule[] = position.modules.filter((module) => module.chapter?.number === chapter);
  const points = modules.flatMap((module) => module.points);
  return points.length > 0 && points.every((point) => point.state === "preparing");
}
