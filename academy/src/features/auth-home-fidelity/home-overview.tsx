import Link from "next/link";
import type { ReactNode } from "react";
import type { ProgramPosition } from "@/lib/curriculum/program-points";
import type { ToolWindowView } from "@/features/tool-windows/model/access";
import type { NotificationRow } from "@/features/notifications-fidelity/notifications-state";
import {
  POINT_WORD,
  closedRowWord,
  currentShare,
  greetingLine,
  homeFacts,
  homeListRows,
  isPreparing,
  levelRange,
  nextModule,
  stepAside,
  toolRack,
  whereLine,
  type StepAside,
} from "@/features/auth-home-fidelity/home-overview-model";
import { HomeProgramLine } from "@/features/auth-home-fidelity/home-program-line";
import { HomeNews } from "@/features/auth-home-fidelity/home-news";
import "@/features/auth-home-fidelity/home-hifi.css";

/**
 * HOME, HI-FI — direction B «Линия программы» (DD-337).
 *
 * One axis, top to bottom: the greeting and where the learner is; the program
 * line with the learner's point lit; the current priority hanging from that
 * point in the Decision Frame Path already uses; then the module the learner is
 * in, as a list of its levels, beside the tools they have and what changed in
 * their work. The priority is still the page's h1 and still its only call to
 * act — everything around it is a place to look, not a second thing to do.
 *
 * `priority` is the frozen field, passed in whole: its postures, its single
 * handoff, its authority, its retry. Without a curriculum (a failed read, no
 * enrollment, no program) the page is the greeting and the priority alone,
 * because every other block would have to guess.
 */
export function HomeOverview({
  name,
  position,
  tools,
  news,
  priority,
}: {
  name: string | null;
  position: ProgramPosition | null;
  tools: readonly ToolWindowView[] | null;
  news: readonly NotificationRow[] | null;
  priority: ReactNode;
}) {
  const where = position ? whereLine(position) : null;
  const facts = position ? homeFacts(position, tools) : [];
  const aside = position ? stepAside(position, tools) : null;
  const share = position ? currentShare(position) : null;

  return (
    <div className="hm" data-hm-root>
      <header className="hm-head">
        <div className="hm-head__who">
          <p className="hm-greeting">{greetingLine(name)}</p>
          {where ? <p className="hm-where">{where}</p> : null}
        </div>
        {facts.length > 0 ? (
          <dl className="hm-facts">
            {facts.map((fact) => (
              <div className="hm-fact" key={fact.key} data-fact={fact.key}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>

      {position ? (
        <div className="hm-route">
          <div className="hm-route__head">
            <span className="hm-route__label">Программа</span>
            <Link className="hm-route__all" href="/path">
              Весь путь
            </Link>
          </div>
          <HomeProgramLine position={position} />
        </div>
      ) : null}

      <section
        className="hm-now"
        aria-label="Текущий приоритет"
        data-attached={position?.current ? "1" : undefined}
        data-aside={aside ? "1" : undefined}
        style={share !== null ? { ["--hm-x" as string]: `${(share * 100).toFixed(2)}%` } : undefined}
      >
        <span className="hm-now__corner hm-now__corner--tl" aria-hidden="true" />
        <span className="hm-now__corner hm-now__corner--br" aria-hidden="true" />
        <div className="hm-now__main">{priority}</div>
        {aside ? <HomeStepAside aside={aside} /> : null}
      </section>

      {position ? (
        <div className="hm-lower">
          <HomeModule position={position} />
          <div className="hm-side">
            {tools ? <HomeTools tools={tools} /> : null}
            <HomeNews rows={news} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Beside the priority: what this step gives and what it opens. */
function HomeStepAside({ aside }: { aside: StepAside }) {
  if (aside.kind === "rest") {
    return (
      <aside className="hm-now__aside" aria-label="Пока уровни готовятся">
        <p className="hm-aside__lead">Пока уровни готовятся, пройденное остаётся с вами.</p>
        <ul className="hm-aside__links">
          <li>
            <Link className="hm-more" href="/lessons">
              Пересмотреть уроки
            </Link>
          </li>
          <li>
            <Link className="hm-more" href="/tools">
              Открыть инструменты
            </Link>
          </li>
        </ul>
      </aside>
    );
  }
  return (
    <aside className="hm-now__aside" aria-label="Что даст этот шаг">
      <dl className="hm-aside__facts">
        {aside.reward !== null ? (
          <div className="hm-aside__fact" data-fact="reward">
            <dt>За уровень</dt>
            <dd className="hm-aside__reward">+{aside.reward} XP</dd>
          </div>
        ) : null}
        {aside.opens.length > 0 ? (
          <div className="hm-aside__fact" data-fact="opens">
            <dt>Откроется</dt>
            <dd>{aside.opens.join(", ")}</dd>
          </div>
        ) : null}
        {aside.next ? (
          <div className="hm-aside__fact" data-fact="next">
            <dt>Дальше</dt>
            <dd>
              Уровень {aside.next.order} · {aside.next.title}
              {aside.next.preparing ? <span className="hm-aside__quiet"> — готовится</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </aside>
  );
}

/** The module the learner is in: its levels, each with its place. */
function HomeModule({ position }: { position: ProgramPosition }) {
  const focus = position.focusModule;
  if (!focus) return null;
  const range = levelRange(focus);
  const following = nextModule(position);
  const followingRange = following ? levelRange(following) : null;

  return (
    <section className="hm-module" aria-labelledby="hm-module-title">
      <header className="hm-block__head">
        <p className="hm-block__kicker">
          Модуль {focus.order} из {position.modules.length}
          {range ? ` · ${range}` : ""}
        </p>
        <h2 className="hm-block__title" id="hm-module-title">
          {focus.title}
        </h2>
        <p className="hm-block__count">
          {isPreparing(focus) ? "готовится" : `пройдено ${focus.completed} из ${focus.points.length}`}
        </p>
      </header>
      {/* THE FIVE ROWS (DD-348, owner 2026-10-06): three walked levels, the one
          the learner stands on, the next — across module edges. A walked row
          opens its lesson («Открыть урок»), the learner's row starts it
          («Начать», also while it is being prepared — that page says so), and
          a closed row is dim and says why, with nothing to press. The spine is
          lit as far as the learner has walked. */}
      <ol className="hm-levels">
        {homeListRows(position).map((row) => {
          const { point, module, role } = row;
          const href = role === "walked" ? point.href : role === "here" ? point.href ?? point.pageHref : null;
          const body = (
            <>
              <span className="hm-level__mark" aria-hidden="true" />
              <span className="hm-level__code">L{String(point.order).padStart(2, "0")}</span>
              <span className="hm-level__title">{point.title}</span>
              <span className="hm-level__kind">
                {point.kindLabel}
                {row.foreign ? <span className="hm-level__module"> · модуль {module.order}</span> : null}
              </span>
              {href && role === "walked" ? (
                <span className="hm-level__go hm-level__go--open">Открыть урок</span>
              ) : href && role === "here" ? (
                <span className="hm-level__go hm-level__go--start">Начать</span>
              ) : (
                <span className="hm-level__state">
                  {role === "walked" ? POINT_WORD.done : closedRowWord(row)}
                </span>
              )}
            </>
          );
          return (
            <li
              key={point.levelCode}
              className={[
                "hm-level",
                `hm-level--${point.state}`,
                `hm-level--${role}`,
                row.edge ? "hm-level--edge" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              {...(role === "here" ? { "aria-current": "step" as const } : {})}
            >
              {href ? (
                <Link className="hm-level__row" href={href}>
                  {body}
                </Link>
              ) : (
                <span className="hm-level__row">{body}</span>
              )}
            </li>
          );
        })}
      </ol>
      {following ? (
        <p className="hm-module__next">
          Дальше: модуль {following.order} «{following.title}»
          {followingRange ? ` · ${followingRange}` : ""}
        </p>
      ) : null}
    </section>
  );
}

/** The tools the learner has, and the next one the program opens. */
function HomeTools({ tools }: { tools: readonly ToolWindowView[] }) {
  const rack = toolRack(tools);
  return (
    <section className="hm-tools" aria-labelledby="hm-tools-title">
      <header className="hm-block__head">
        <h2 className="hm-block__title" id="hm-tools-title">
          Инструменты
        </h2>
        <p className="hm-block__count">
          открыто {rack.open.length} из {rack.total}
        </p>
      </header>
      {rack.open.length > 0 ? (
        <ul className="hm-tools__list">
          {rack.open.map((view) => (
            <li key={view.tool.code}>
              <Link className="hm-tool" href={view.href}>
                <span className="hm-tool__name">{view.tool.title}</span>
                <span className="hm-tool__what">{view.tool.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : rack.next ? null : (
        <p className="hm-block__quiet">Инструменты откроются по ходу программы.</p>
      )}
      {rack.next ? (
        <p className="hm-tools__next">
          <span className="hm-tools__next-name">{rack.next.tool.title}</span> откроется после уровня{" "}
          {rack.next.unlockLevel}
        </p>
      ) : null}
      <Link className="hm-more" href="/tools">
        Все инструменты
      </Link>
    </section>
  );
}
