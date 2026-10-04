import Link from "next/link";
import type { AcademyToolAccess } from "@/lib/curriculum/academy-view";
import { toolWindowByCode, toolWindowHref } from "@/features/tool-windows/model/catalog";

/**
 * WHAT THIS LEVEL OPENS.
 *
 * «Инструмент выдаётся после того, как ученик сделал ту же работу руками» — the
 * owner's rule for tools, and the reason a level page says which tool its
 * completion releases: the tool is the lesson's consequence, not a separate
 * catalogue the learner discovers later.
 *
 * THE VERDICT IS THE BACKEND'S. Which tool a level releases, and whether it is
 * open for this learner, both arrive in `toolAccess` on the curriculum read.
 * This component joins that verdict to the catalogue's names and decides
 * nothing: a tool the verdict does not attach to this level is not shown, and a
 * tool the verdict has not opened is never a link.
 */
export function LevelUnlocks({
  levelOrder,
  toolAccess,
}: {
  levelOrder: number;
  toolAccess: AcademyToolAccess | null;
}) {
  const released = (toolAccess?.tools ?? [])
    .filter((entry) => entry.unlockLevel === levelOrder)
    .map((entry) => ({ entry, tool: toolWindowByCode(entry.code) }))
    .filter((item): item is { entry: typeof item.entry; tool: NonNullable<typeof item.tool> } => item.tool !== null);

  if (released.length === 0) return null;

  return (
    <section className="ax-lvlsec" aria-label="Что открывает этот уровень" data-section="unlocks">
      <h2>{released.length === 1 ? "Этот уровень открывает инструмент" : "Этот уровень открывает инструменты"}</h2>
      <ul className="ld-unlocks">
        {released.map(({ entry, tool }) => (
          <li className="ld-unlock" key={tool.code} data-tool={tool.code} data-open={String(entry.unlocked)}>
            <div className="ld-unlock__text">
              <p className="ld-unlock__title">{tool.title}</p>
              <p className="ld-unlock__desc">{tool.description}</p>
            </div>
            {entry.unlocked && tool.built ? (
              <Link className="ld-unlock__open" href={toolWindowHref(tool.slug)}>
                Открыть
              </Link>
            ) : (
              <p className="ld-unlock__when">
                {entry.unlocked ? "Скоро" : "Откроется, когда уровень будет завершён"}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
