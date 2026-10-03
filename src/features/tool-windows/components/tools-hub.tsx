import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import type { ToolWindowView } from "@/features/tool-windows/model/access";

/**
 * «Инструменты» — the six tools, in the order they open.
 *
 * Built as the Lessons index is: a quiet head, one territory, one row per
 * tool. An open tool is a single full-row link into its page, IN THE SAME TAB
 * (owner decision 2026-09-21); a locked or unbuilt one is text that says when
 * it opens. The rows come already resolved: this component compares no level
 * and decides no lock.
 */
export function ToolsHub({ tools }: { tools: readonly ToolWindowView[] }) {
  const openCount = tools.filter((view) => view.state === "open").length;
  return (
    // `tw-hifi`: the product hi-fi layer (DD-338) over the tools stylesheet.
    <div className="twh tw-hifi">
      <div className="tw-head">
        <h1 className="tw-title">Инструменты</h1>
        <span className="tw-count">{`Открыто ${openCount} из ${tools.length}`}</span>
      </div>
      <p className="tw-orient">Рабочие инструменты ATA. Доступ открывается по мере продвижения по пути.</p>
      <section className="tw-territory" aria-label="Инструменты по уровням">
        <ul className="twh-list">
          {tools.map((view) => (
            <li key={view.tool.code} className="twh-row" data-state={view.state}>
              <ToolRow view={view} />
            </li>
          ))}
        </ul>
      </section>
      <p className="tw-footnote">
        Инструменты обучения, не торговые сигналы. ATA не открывает сделки и не видит ваш счёт в Pocket.
      </p>
    </div>
  );
}

function ToolRow({ view }: { view: ToolWindowView }) {
  const { tool, state, href, unlockLevel } = view;
  const body = (
    <>
      <span className="twh-row__level" aria-hidden="true">
        L{String(unlockLevel).padStart(2, "0")}
      </span>
      <span className="twh-row__title">{tool.title}</span>
      <span className="twh-row__desc">{tool.description}</span>
    </>
  );

  if (state === "open") {
    return (
      <Link className="twh-row__open" href={href}>
        {body}
        <span className="twh-row__state">
          Открыть
          <ArrowRight aria-hidden="true" size={14} strokeWidth={2} />
        </span>
      </Link>
    );
  }

  return (
    <div className="twh-row__still">
      {body}
      {state === "soon" ? (
        <span className="twh-row__state twh-row__soon">Скоро</span>
      ) : (
        <span className="twh-row__state">
          <Lock aria-hidden="true" size={13} strokeWidth={2} />
          Откроется после уровня {unlockLevel}
        </span>
      )}
    </div>
  );
}
