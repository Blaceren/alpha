/**
 * Academy experience primitives — the small set both approved directions share.
 *
 * Home (Direction A) and Path (Direction B) have different dominant
 * compositions on purpose. What makes them one product is this shared layer:
 * the same state language, the same signal point, the same materials, the same
 * progression semantics. Anything that appears on both screens lives here, so
 * the two can never drift into two vocabularies.
 *
 * None of these components decides anything. They render decisions already made
 * by the Backend and shaped by `next-action.ts`.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { AcademyNextAction } from "@/lib/curriculum/next-action";
import type {
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";

/* ------------------------------------------------------------ signal -- */

/**
 * The current-position marker. Exactly one per screen, and only on an `act`
 * posture — a waiting learner has nothing to aim at, and a blocked one must not
 * be given a lit target. Sprinkling these would destroy the priority they exist
 * to create.
 */
export function SignalPoint() {
  return <span className="ax-signal" aria-hidden="true" />;
}

/* ------------------------------------------------------- action field -- */

/**
 * THE dominant object on Home (Direction A).
 *
 * Not a card: it is the page's primary surface, and its MATERIAL carries the
 * posture. `data-posture` is also what the acceptance pass and the tests assert
 * against, so the visual state and the machine state are the same fact.
 */
export function ActionField({
  action,
  coordinate,
  children,
}: {
  action: AcademyNextAction;
  coordinate?: ReactNode;
  children?: ReactNode;
}) {
  const lit = action.posture === "act";
  return (
    <div className="ax-fieldwrap">
      <section
        className="ax-field"
        data-posture={action.posture}
        data-kind={action.kind}
        aria-labelledby="ax-action-title"
      >
        {lit ? <SignalPoint /> : null}
        {coordinate ? <p className="ax-coord">{coordinate}</p> : null}
        <h1 className="ax-statement" id="ax-action-title">
          {action.title}
        </h1>
        <p className="ax-reason">{action.explanation}</p>
        {action.ctaLabel && action.href ? (
          <Link className={`ax-cta${lit ? "" : " ax-cta--quiet"}`} href={action.href}>
            {action.ctaLabel}
          </Link>
        ) : null}
        {children}
      </section>
    </div>
  );
}

/* ------------------------------------------------------ state marking -- */

/** Text-first state mark. Never colour-only — the label always carries the fact. */
export function StateMark({ level }: { level: AcademyLevelSummary }) {
  return (
    <span className="ax-mark" data-state={level.state}>
      {level.stateLabel}
    </span>
  );
}

/**
 * Structural milestone marker.
 *
 * Only the two families the curriculum treats as structural get one: the seven
 * mentor reviews and the twenty financial checkpoints. Every ordinary level gets
 * nothing, which is what keeps the list readable — a badge on all 100 rows is a
 * badge on none.
 */
export function MilestoneMark({ level }: { level: AcademyLevelSummary }) {
  if (level.completionMethod === "checkpoint") {
    return (
      <span className="ax-milestone" data-kind="checkpoint">
        контрольная точка
      </span>
    );
  }
  if (level.completionMethod === "mentor-review") {
    return (
      <span className="ax-milestone" data-kind="mentor-review">
        наставник
      </span>
    );
  }
  if (level.completionMethod === "report") {
    return <span className="ax-milestone">отчёт</span>;
  }
  if (level.completionMethod === "external-event") {
    return <span className="ax-milestone">регистрация</span>;
  }
  return null;
}

/* ---------------------------------------------------- progress trace -- */

/**
 * 100 levels as one compact orientation object (Home).
 *
 * Grouped by module so boundaries read without a legend, and deliberately not
 * navigation: Path owns navigation, this only answers "how far along am I".
 * Renders 100 segments and zero labels.
 */
export function ProgressTrace({
  modules,
  currentLevelCode,
  completed,
  total,
  nextMilestone,
}: {
  modules: readonly AcademyModuleSummary[];
  currentLevelCode: string | null;
  completed: number;
  total: number;
  nextMilestone: string | null;
}) {
  return (
    <div className="ax-trace">
      <div
        className="ax-trace__bar"
        role="img"
        aria-label={`Прогресс: завершено ${completed} из ${total} уровней`}
      >
        {modules.map((m) => {
          const hasCurrent = m.levels.some((l) => l.levelCode === currentLevelCode);
          const done = m.progress.total > 0 && m.progress.completed === m.progress.total;
          return (
            <div
              key={m.moduleCode}
              className="ax-trace__mod"
              data-state={done ? "completed" : hasCurrent ? "current" : "upcoming"}
            >
              {m.levels.map((l) => (
                <span
                  key={l.levelCode}
                  className="ax-trace__seg"
                  data-state={l.levelCode === currentLevelCode ? "current" : l.state}
                />
              ))}
            </div>
          );
        })}
      </div>
      <p className="ax-trace__meta">
        <span>
          Завершено {completed} из {total} уровней
        </span>
        {nextMilestone ? <span>Дальше: {nextMilestone}</span> : null}
      </p>
    </div>
  );
}

/* -------------------------------------------------------- context rail -- */

export function ContextRail({ items }: { items: ReadonlyArray<{ k: string; v: ReactNode }> }) {
  if (items.length === 0) return null;
  return (
    <div className="ax-rail">
      {items.map((it) => (
        <div className="ax-rail__item" key={it.k}>
          <p className="ax-rail__k">{it.k}</p>
          <p className="ax-rail__v">{it.v}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ states -- */

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="ax-empty">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

/**
 * Learner-facing failure. Deliberately carries no server text: a raw upstream
 * message is an internal concept leaking into learner language, and it is never
 * actionable for the person reading it.
 */
export function ErrorState({
  title = "Не удалось загрузить данные",
  message = "Проверьте соединение и попробуйте ещё раз. Если это повторится, напишите в поддержку.",
  children,
}: {
  title?: string;
  message?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ax-error" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {children}
    </div>
  );
}
