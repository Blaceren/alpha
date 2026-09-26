/**
 * PATH — Direction B, "Учебная ось" / Learning Spine.
 *
 * The page has a different job from Home: answer «где я в программе из 20
 * модулей и 100 уровней?». So it has a different dominant object — a persistent
 * vertical axis of 20 module nodes — and one module in detail beside it.
 *
 * WHAT THIS REPLACES. The deployed Path rendered all 100 levels flat, at equal
 * visual weight, in twenty ungrouped lists. That is not navigable: a learner on
 * level 15 had to read 100 rows to find themselves. The spine makes the twenty
 * modules the primary zoom level and shows exactly one module's levels.
 *
 * THE SPINE IS CONTENT, NOT CHROME. It carries real curriculum topology — node
 * state is derived from canonical level progression, never from route state —
 * and it changes zoom by route rather than being one sidebar reused everywhere.
 * That is the property that keeps it from becoming the rejected sidebar.
 *
 * AGREEMENT WITH HOME. The actionable level is taken from the SAME
 * `deriveNextAction` Home uses, so the row Path highlights and the statement
 * Home shows are one decision rendered twice, never two computations.
 */
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { deriveNextAction, explainLevelState } from "@/lib/curriculum/next-action";
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";
import { MilestoneMark, StateMark } from "@/features/academy-experience/primitives";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import "@/features/academy-experience/experience.css";

type Enrolled = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

export type ModuleNodeState = "completed" | "current" | "upcoming" | "locked";

/**
 * A module node's state, derived only from its levels.
 *
 * Deliberately not a fifth authority: `completed` means every level is
 * completed, `current` means the learner's actionable level is inside it, and a
 * module whose every level is locked is `locked`. Anything else is `upcoming`.
 */
export function moduleNodeState(
  module: AcademyModuleSummary,
  currentLevelCode: string | null,
): ModuleNodeState {
  if (module.levels.length > 0 && module.progress.completed === module.progress.total) {
    return "completed";
  }
  if (currentLevelCode && module.levels.some((l) => l.levelCode === currentLevelCode)) {
    return "current";
  }
  if (module.levels.length > 0 && module.levels.every((l) => l.state === "locked")) {
    return "locked";
  }
  return "upcoming";
}

function LevelRow({
  level,
  isCurrent,
}: {
  level: AcademyLevelSummary;
  isCurrent: boolean;
}) {
  const why = explainLevelState(level);
  const whyId = `why-${level.levelCode}`;
  return (
    <li className="ax-lvl" data-state={level.state} data-current={isCurrent} data-level={level.levelCode}>
      <span className="ax-lvl__n">{level.order}</span>
      <span>
        {level.routeAccessible ? (
          <Link className="ax-lvl__t" href={level.href} aria-describedby={whyId}>
            {level.title}
          </Link>
        ) : (
          <span className="ax-lvl__t" aria-describedby={whyId}>
            {level.title}
          </span>
        )}{" "}
        <MilestoneMark level={level} />
      </span>
      <StateMark level={level} />
      {/* Every level says why it is in the state it is in — a locked row that
          only says «Заблокирован» is the defect §7 names. */}
      <p className="ax-lvl__why" id={whyId}>
        {why}
      </p>
    </li>
  );
}

export async function ExperiencePath({ moduleParam }: { moduleParam?: string }) {
  const [viewer, result] = await Promise.all([getServerViewer(), getCurriculumView()]);
  const name = viewer?.name ?? "Ученик";

  const shell = (children: React.ReactNode) => (
    <AppShell userName={name} activeId="path">
      <div className="ax">{children}</div>
    </AppShell>
  );

  if (!result.ok) return shell(<CurriculumErrorState error={result.error} />);
  if (result.view.state === "unavailable") {
    return shell(
      <CurriculumInfoState title="Программа готовится" message="Активная учебная программа пока не опубликована." />,
    );
  }
  if (result.view.state === "candidate") {
    return shell(
      <CurriculumInfoState
        title={result.view.curriculum.title}
        message="Вы ещё не зачислены на программу. Зачисление появится позже."
      />,
    );
  }

  const view = result.view as Enrolled;
  const action = deriveNextAction(view);
  const actionableCode = action.level?.levelCode ?? view.progress.currentLevelCode;

  // Which module is open: an explicit choice wins, otherwise the one holding the
  // learner's actionable level, otherwise the first.
  const selected =
    view.modules.find((m) => m.moduleCode === moduleParam) ??
    view.modules.find((m) => m.levels.some((l) => l.levelCode === actionableCode)) ??
    view.modules[0];

  return shell(
    <>
      <p className="ax-coord">
        {view.curriculum.title} · {view.modules.length} модулей ·{" "}
        <b>
          {view.progress.completedLevels} из {view.progress.totalLevels}
        </b>{" "}
        уровней завершено
      </p>

      <div className="ax-spine">
        <nav className="ax-spine__rail" aria-label="Модули программы">
          {view.modules.map((m) => {
            const state = moduleNodeState(m, actionableCode);
            const isOpen = selected && m.moduleCode === selected.moduleCode;
            return (
              <Link
                key={m.moduleCode}
                className="ax-node"
                href={`/path?module=${encodeURIComponent(m.moduleCode)}`}
                data-state={state}
                data-module={m.moduleCode}
                aria-current={isOpen ? "true" : undefined}
                title={`Модуль ${m.order}: ${m.title}`}
              >
                <span className="ax-node__num">
                  {String(m.order).padStart(2, "0")}
                </span>
                <span className="ax-node__dot" aria-hidden="true" />
                <span className="ax-visually-hidden" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  {m.title} — {state === "completed" ? "завершён" : state === "current" ? "текущий" : state === "locked" ? "закрыт" : "впереди"}
                </span>
              </Link>
            );
          })}
        </nav>

        <section className="ax-spine__body" aria-live="polite">
          {selected ? (
            <>
              <h1 className="ax-mod__title">
                Модуль {selected.order} — {selected.title}
              </h1>
              <p className="ax-mod__meta">
                {selected.progress.completed} из {selected.progress.total} уровней завершено
              </p>
              {selected.learningObjective ? (
                <p className="ax-mod__obj">{selected.learningObjective}</p>
              ) : null}

              <p className="ax-section-title">Уровни модуля</p>
              <ul className="ax-levels">
                {selected.levels.map((l) => (
                  <LevelRow key={l.levelCode} level={l} isCurrent={l.levelCode === actionableCode} />
                ))}
              </ul>
            </>
          ) : (
            <p className="ax-reason">В программе пока нет модулей.</p>
          )}
        </section>
      </div>
    </>,
  );
}
