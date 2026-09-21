import type { ReactNode } from "react";
import type { ToolWindowDefinition } from "@/features/tool-windows/model/catalog";
import { ToolCloseButton } from "./tool-close-button";

/**
 * The window every tool opens in: «ATA · <tool>», the level that releases it,
 * a close control, and the same footer on every tool.
 *
 * It owns no data and decides nothing: the page chooses what goes inside
 * (the working tool, its locked page, or its not-built-yet page).
 */
export function ToolWindowFrame({
  tool,
  unlockLevel,
  children,
}: {
  tool: ToolWindowDefinition;
  unlockLevel: number;
  children: ReactNode;
}) {
  return (
    <div className="tw-page">
      <div className="tw">
        <header className="tw-head">
          <span className="tw-head__brand" aria-hidden="true">
            ATA
          </span>
          <h1 className="tw-head__title">{tool.title}</h1>
          <span className="tw-chip" aria-label={`Открывается на уровне ${unlockLevel}`}>
            L{String(unlockLevel).padStart(2, "0")}
          </span>
          <ToolCloseButton />
        </header>
        <main className="tw-body">{children}</main>
        <footer className="tw-foot">Инструмент обучения, не торговый сигнал</footer>
      </div>
    </div>
  );
}
