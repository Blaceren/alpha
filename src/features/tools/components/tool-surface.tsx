import Link from "next/link";
import { getPathProgress, type PathScenario } from "@/features/path/model/path-state";
import { projectTool } from "@/features/tools/model/tools-projection";
import { TRADING_JOURNAL_CODE } from "@/features/tools/model/tool-catalog";
import { TradingJournalWorkspace } from "@/features/tools/components/trading-journal-workspace";

/**
 * One tool surface (Phase D4-B). Dispatches on the RESOLVED tool view — never on
 * a raw query — so a locked or unimplemented tool can never render working
 * functionality, and an unknown code degrades honestly.
 */
export function ToolSurface({
  toolCode,
  scenario = "active",
}: {
  toolCode: string;
  scenario?: PathScenario;
}) {
  const tool = projectTool(toolCode, getPathProgress(scenario));

  // Unknown code → the calm not-found convention (no generic crash).
  if (!tool) return <ToolUnknown />;

  // Locked → target level, no form, no data.
  if (!tool.unlocked) {
    return <ToolLocked title={tool.title} unlockLevel={tool.unlockLevel} />;
  }

  // Unlocked but the surface is not built (Risk Calculator) → calm coming-soon.
  if (!tool.available) {
    return <ToolComingSoon title={tool.title} unlockLevel={tool.unlockLevel} />;
  }

  // Available → the real workspace. Only Trading Journal is available in D4-B.
  if (tool.code === TRADING_JOURNAL_CODE) {
    return <TradingJournalWorkspace />;
  }

  // Available in the catalog but with no built surface wired here — treat as
  // coming-soon rather than crash (defensive; unreachable in D4-B).
  return <ToolComingSoon title={tool.title} unlockLevel={tool.unlockLevel} />;
}

function ToolBack() {
  return (
    <Link className="ts-back" href="/tools">
      <span aria-hidden="true">←</span> Инструменты
    </Link>
  );
}

export function ToolLocked({ title, unlockLevel }: { title: string; unlockLevel: number }) {
  return (
    <div className="ts-page">
      <ToolBack />
      <div className="ts-state is-locked" role="status">
        <span className="ts-node mono" aria-hidden="true">
          {unlockLevel}
        </span>
        <h1 className="ts-h1">{title}</h1>
        <p className="ts-lead">Инструмент ещё закрыт.</p>
        <p className="ts-line">Откроется на уровне {unlockLevel}.</p>
        <div className="ts-exits">
          <Link className="ts-link" href="/path">
            Посмотреть Путь
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ToolComingSoon({ title, unlockLevel }: { title: string; unlockLevel: number }) {
  return (
    <div className="ts-page">
      <ToolBack />
      <div className="ts-state is-soon" role="status">
        <span className="ts-node mono" aria-hidden="true">
          {unlockLevel}
        </span>
        <h1 className="ts-h1">{title}</h1>
        <p className="ts-lead">Открыт по прогрессу · инструмент готовится.</p>
        <p className="ts-line">
          Уровень {unlockLevel} пройден — этот инструмент уже открыт, но его рабочая поверхность пока
          готовится. Здесь ничего вводить не нужно.
        </p>
        <div className="ts-exits">
          <Link className="ts-link" href="/tools">
            К списку инструментов
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ToolUnknown() {
  return (
    <div className="ts-page">
      <ToolBack />
      <div className="ts-state is-unknown" role="status">
        <h1 className="ts-h1">Инструмент не найден</h1>
        <p className="ts-line">Такого инструмента нет. Вернитесь к списку инструментов.</p>
        <div className="ts-exits">
          <Link className="ts-link" href="/tools">
            К списку инструментов
          </Link>
        </div>
      </div>
    </div>
  );
}
