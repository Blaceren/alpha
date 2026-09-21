import type { ToolWindowDefinition } from "@/features/tool-windows/model/catalog";

/** Open for this learner, but the window is not in this build yet. Said plainly. */
export function ToolSoon({ tool }: { tool: ToolWindowDefinition }) {
  return (
    <section className="tw-state" aria-labelledby="tool-soon-title">
      <p className="tw-label">Доступ открыт</p>
      <h2 className="tw-state__title" id="tool-soon-title">
        {tool.title} готовится
      </h2>
      <p className="tw-state__line">Окно инструмента ещё не выпущено. Доступ к нему у вас уже есть.</p>
    </section>
  );
}
