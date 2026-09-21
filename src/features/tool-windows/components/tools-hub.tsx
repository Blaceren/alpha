import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import type { ToolWindowView } from "@/features/tool-windows/model/access";

/**
 * «Инструменты» — the six tools, in the order they open.
 *
 * Each row says the level that releases the tool, what it is for, and one
 * thing about its state: open (and a way into it), locked (and the level that
 * opens it), or earned but not built yet. The rows come already resolved; this
 * component compares no level and decides no lock.
 *
 * A TOOL OPENS IN A NEW TAB (owner decision 2026-09-21), so the learner can keep
 * it next to the Pocket chart. The link says so to a screen reader as well.
 */
export function ToolsHub({ tools }: { tools: readonly ToolWindowView[] }) {
  return (
    <div className="twh">
      <h1 className="twh__title">Инструменты</h1>
      <p className="twh__lead">
        Рабочие инструменты ATA. Доступ открывается по мере продвижения по пути. Каждый инструмент открывается в новой
        вкладке — её удобно держать рядом с графиком.
      </p>
      <ul className="twh__list">
        {tools.map((view) => (
          <ToolRow key={view.tool.code} view={view} />
        ))}
      </ul>
      <p className="twh__note">
        Инструменты обучения, не торговые сигналы. ATA не открывает сделки и не видит ваш счёт в Pocket.
      </p>
    </div>
  );
}

function ToolRow({ view }: { view: ToolWindowView }) {
  const { tool, state, href, unlockLevel } = view;
  return (
    <li className="twh-row" data-state={state}>
      <span className="twh-row__level" aria-hidden="true">
        L{String(unlockLevel).padStart(2, "0")}
      </span>
      <div>
        <h2 className="twh-row__title">{tool.title}</h2>
        <p className="twh-row__desc">{tool.description}</p>
      </div>
      <div className="twh-row__action">
        {state === "open" ? (
          <Link
            className="twh-open"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть ${tool.title} в новой вкладке`}
          >
            Открыть
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={2} />
          </Link>
        ) : state === "soon" ? (
          <span className="twh-soon">Скоро</span>
        ) : (
          <>
            <span className="twh-lock">
              <Lock aria-hidden="true" size={13} strokeWidth={2} />
              Откроется на уровне {unlockLevel}
            </span>
            {tool.built ? (
              <Link
                className="twh-peek"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Как будет выглядеть ${tool.title} — в новой вкладке`}
              >
                Как будет выглядеть
              </Link>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
