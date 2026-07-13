import type { Metadata } from "next";
import { CONCEPTS } from "@/config/concepts";
import { LogoPlaceholder } from "@/components/shell/LogoPlaceholder";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: "Art Directions · Alfa Trade Academy" };

/**
 * Internal comparison board for the three D1A art directions.
 * Development-only — not part of the production sitemap. No winner is declared.
 */
export default function ConceptsBoard() {
  return (
    <main className="mx-auto min-h-dvh max-w-5xl overflow-x-clip px-5 py-10 sm:px-8 sm:py-14">
      <div className="mb-10 flex flex-col gap-4">
        <LogoPlaceholder />
        <div className="flex flex-col gap-2">
          <span className="font-mono text-xs uppercase tracking-widest text-ink-3">
            Phase D1A · Art-Direction Board
          </span>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
            Три направления Главной
          </h1>
          <p className="max-w-2xl font-ui text-ink-2">
            Три качественно разных арт-направления одной и той же Главной. У всех
            одинаковый продуктовый контент и один и тот же synthetic-пользователь
            (уровень 18, «Поддержка и сопротивление»). Различаются композиция,
            глубина, типографика, материалы, характер пути, плотность и роль Alex
            Curie. Победитель не выбирается на этом этапе.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CONCEPTS.map((c, i) => (
          <a
            key={c.id}
            href={c.href}
            className="group flex flex-col gap-4 rounded-2xl border border-line bg-surface-1 p-5 transition-colors duration-150 hover:bg-surface-2"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-ink-3">
                Direction {String.fromCharCode(65 + i)}
              </span>
              <Icon
                name="arrowRight"
                className="h-4 w-4 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
              />
            </div>
            <h2 className="font-display text-xl font-semibold text-ink">{c.name}</h2>
            <p className="font-ui text-sm leading-relaxed text-ink-2">{c.idea}</p>
            <span className="mt-auto inline-flex items-center gap-1.5 font-ui text-sm text-accent">
              Открыть направление
            </span>
          </a>
        ))}
      </div>

      <p className="mt-10 font-ui text-xs text-ink-3">
        Эти маршруты (/concepts, /concepts/*) — development-only и не входят в
        production sitemap.
      </p>
    </main>
  );
}
