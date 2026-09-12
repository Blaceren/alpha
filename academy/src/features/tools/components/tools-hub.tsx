import Link from "next/link";
import type { PathProgress } from "@/features/path/model/path-state";
import { getPathProgress, type PathScenario } from "@/features/path/model/path-state";
import { projectTools, type ToolView } from "@/features/tools/model/tools-projection";
import { fixtureToolAccess } from "@/features/tools/model/tool-access-fixture";

/**
 * Tools Hub (Phase D4-B) — direction «Structured Operational Spine», hub half
 * built on Direction A «Operational Ledger» (DD-308).
 *
 * One continuous vertical ledger threads the WHOLE tool progression on a single
 * luminous spine: each tool is a node marked by its unlock level. The current
 * working tool (the highest-level available one — Risk Calculator once L15 is
 * passed) is the live head of the ledger; every available tool carries its OWN
 * CTA copy (`ctaLabel`, never one hardcoded label); unlocked-but-unimplemented
 * tools are honest, CTA-less rows; locked tools are calm progression rows
 * carrying only «Откроется на уровне N». No cards, no grid, no KPI, no balance.
 *
 * Server-rendered and pure: unlock comes from the shared marker via the
 * canonical resolver (`projectTools`), which the server can know. A defensive
 * failure to resolve degrades to an honest fail-closed panel rather than a crash.
 */
export function ToolsHub({
  scenario = "active",
  progress,
}: {
  scenario?: PathScenario;
  /**
   * Canonical curriculum progress. When present it REPLACES the fixture
   * scenario marker — API mode must never derive a learner's unlocks from a
   * scenario constant. The resolver below is unchanged either way: it still
   * owns every lock decision, it is simply given real progress to read.
   */
  progress?: PathProgress | null;
}) {
  let tools: ToolView[] | null;
  try {
    /* Fixture mode gets a stated verdict, never a derived one. API mode does
       not reach this component. */
    tools = projectTools(progress ?? getPathProgress(scenario), fixtureToolAccess(scenario));
  } catch {
    tools = null;
  }

  if (tools === null || tools.length === 0) {
    return (
      <div className="th-page">
        <header className="th-head">
          <h1 className="th-h1">Инструменты</h1>
        </header>
        <section className="th-unavailable" role="status">
          <p className="th-unavailable-h">Список инструментов сейчас недоступен</p>
          <p className="th-unavailable-t">
            Не удалось определить, какие инструменты открыты. Обновите страницу — данные о прогрессе
            хранятся только в этом браузере и не были отправлены никуда.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="th-page">
      <header className="th-head">
        <h1 className="th-h1">Инструменты</h1>
        <p className="th-lead">
          Личные инструменты, которые вы ведёте <b>вручную</b> в этом браузере. Каждый открывается по
          мере прохождения пути и остаётся доступным дальше.
        </p>
      </header>

      <ol className="th-ledger" aria-label="Последовательность инструментов">
        {tools.map((tool) => (
          <ToolRow key={tool.code} tool={tool} />
        ))}
      </ol>

      <p className="th-note">Записи вводятся вручную и не синхронизируются с брокером.</p>
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolView }) {
  const stateClass = tool.current
    ? "is-current"
    : tool.unlocked
      ? "is-open"
      : "is-locked";

  return (
    <li className={`th-row ${stateClass}`}>
      <span className="th-node" aria-hidden="true">
        <span className="th-node-lvl mono">{tool.unlockLevel}</span>
      </span>

      <div className="th-body">
        <p className="th-row-top">
          <span className="th-title">{tool.title}</span>
          {tool.current && <span className="th-badge">рабочий инструмент</span>}
        </p>
        {tool.unlocked && <p className="th-desc">{tool.description}</p>}
        <p className={`th-status ${tool.available ? "is-open" : tool.unlocked ? "is-soon" : "is-locked"}`}>
          <span className="th-dot" aria-hidden="true" />
          {tool.statusLabel}
        </p>
        {/* The gate, where it is a separate fact from readiness. Fixture mode
            renders the same two dimensions as the shipped register, so the two
            cannot drift apart during development. */}
        {tool.requirementLabel ? (
          <p className="th-requirement">{tool.requirementLabel}</p>
        ) : null}
      </div>

      <div className="th-action">
        {tool.available && tool.href ? (
          <Link className="th-cta" href={tool.href}>
            {tool.ctaLabel}
            <span className="th-go" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="th-ic">
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </span>
          </Link>
        ) : null}
      </div>
    </li>
  );
}
