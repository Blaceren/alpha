import type { ToolWindowDefinition } from "@/features/tool-windows/model/catalog";

/** Open for this learner, but the tool is not in this build yet. Said plainly. */
export function ToolSoon({ tool }: { tool: ToolWindowDefinition }) {
  return (
    <div className="tw-quiet">
      <p className="tw-quiet__mark">Доступ открыт</p>
      <h2 className="tw-quiet__title">{`${tool.title} готовится`}</h2>
      <p className="tw-quiet__line">Инструмент ещё не выпущен. Доступ к нему у вас уже есть.</p>
    </div>
  );
}
