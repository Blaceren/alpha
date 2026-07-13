import type { PathNodeModel } from "@/domain/progression";
import { PathNode } from "@/components/progression/PathNode";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

type PathVariant = "portal" | "atlas" | "strip";

/**
 * Horizontal path fragment. Same data across directions; the variant changes
 * its character:
 *  - portal: cinematic, glowing connecting line, larger nodes
 *  - atlas:  technical map — gridded track, precise mono index scale
 *  - strip:  compact editorial progression strip
 * Touch-scrollable on mobile; no horizontal page overflow.
 */
export function PathPreview({
  nodes,
  variant = "portal",
  heading = "Твой путь",
  className,
}: {
  nodes: PathNodeModel[];
  variant?: PathVariant;
  heading?: string;
  className?: string;
}) {
  const nodeSize = variant === "strip" ? "sm" : variant === "portal" ? "lg" : "md";

  return (
    <section aria-label="Путь обучения" className={cn("relative", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-ink-2">
          {heading}
        </h2>
        <a
          href="/path"
          className="inline-flex items-center gap-1 font-ui text-xs text-accent hover:brightness-110"
        >
          К текущему уровню <Icon name="arrowRight" className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="relative overflow-x-auto pb-1 [scrollbar-width:thin]">
        {/* connecting line */}
        <div
          className={cn(
            "pointer-events-none absolute left-0 right-0 top-[38px]",
            variant === "portal"
              ? "h-[3px] bg-[linear-gradient(90deg,transparent,var(--path-glow),transparent)]"
              : variant === "atlas"
                ? "h-px bg-[repeating-linear-gradient(90deg,var(--path-line)_0_10px,transparent_10px_18px)]"
                : "h-px bg-path-line",
          )}
          style={{ top: nodeSize === "lg" ? 40 : nodeSize === "sm" ? 30 : 35 }}
        />
        <ol
          className={cn(
            "relative flex min-w-max items-start",
            variant === "strip" ? "gap-1" : "gap-2",
            variant === "atlas" && "rounded-xl",
          )}
        >
          {nodes.map((node) => (
            <li key={node.code}>
              <PathNode node={node} size={nodeSize} />
            </li>
          ))}
        </ol>
      </div>

      {/* Screen-reader alternative to the visual path (a11y baseline). */}
      <ul className="sr-only">
        {nodes.map((node) => (
          <li key={`sr-${node.code}`}>
            Уровень {node.index}: {node.reward ?? node.label ?? "уровень"} —{" "}
            {node.state === "active"
              ? "текущий"
              : node.state === "completed"
                ? "завершён"
                : node.state === "checkpoint"
                  ? "контрольная точка"
                  : "закрыт"}
          </li>
        ))}
      </ul>
    </section>
  );
}
