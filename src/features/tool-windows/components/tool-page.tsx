import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ToolWindowDefinition } from "@/features/tool-windows/model/catalog";

/**
 * One tool's page, inside the Academy shell (owner decision 2026-09-21: the
 * same tab, and a way back to every other tool).
 *
 * «Все инструменты» comes first, so the way back is the first thing a learner
 * can reach on every tool, in every state. Then the head, as on Lessons, and
 * the tool's territory. The page decides nothing: what goes inside (the
 * working tool, its locked state, or its not-built state) is chosen by the
 * route from the Backend's verdict.
 */
export function ToolPage({
  tool,
  unlockLevel,
  children,
}: {
  tool: ToolWindowDefinition;
  unlockLevel: number;
  children: ReactNode;
}) {
  return (
    <div className="twp">
      <Link className="twp-back" href="/tools">
        <ArrowLeft aria-hidden="true" size={15} strokeWidth={2} />
        Все инструменты
      </Link>
      <div className="tw-head">
        <h1 className="tw-title">{tool.title}</h1>
        <span className="tw-count">{`Уровень ${unlockLevel}`}</span>
      </div>
      <p className="tw-orient">{tool.description}</p>
      <section className="tw-territory" aria-label={tool.title}>
        {children}
      </section>
      <p className="tw-footnote">Инструмент обучения, не торговый сигнал.</p>
    </div>
  );
}
