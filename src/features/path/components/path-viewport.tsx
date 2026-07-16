"use client";

import { useEffect, useRef } from "react";
import { formatThresholdUsd } from "@/domain/curriculum";
import type { VisiblePathWindow } from "@/features/path/model/visible-window";
import {
  levelVisualState,
  type PathProgress,
} from "@/features/path/model/path-state";
import { PathNode } from "@/features/path/components/path-node";

/**
 * The Route Field viewport: one module window. The SVG connection layer and the
 * DOM node buttons share the same percentage coordinate space (layout engine),
 * so they stay aligned at every size. On narrow screens the canvas is wider
 * than the viewport and pans natively (touch-action keeps page scroll natural);
 * the current/selected node is auto-centred.
 */
export function PathViewport({
  window: win,
  progress,
  selectedLevel,
  onSelectLevel,
  onSelectModule,
  onKeyDown,
}: {
  window: VisiblePathWindow;
  progress: PathProgress;
  selectedLevel: number;
  onSelectLevel: (levelNumber: number) => void;
  onSelectModule: (moduleIndex: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { layout, prevModule, nextModule } = win;
  const { module } = layout;

  // Auto-centre the selected (or current) node inside the pannable canvas.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const node = scroller.querySelector<HTMLElement>(`[data-level="${selectedLevel}"]`);
    if (!node) return;
    const target = node.offsetLeft - scroller.clientWidth / 2;
    const reduce = window_matchMediaSafe("(prefers-reduced-motion: reduce)");
    scroller.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
  }, [selectedLevel, win.moduleIndex]);

  const gate = layout.gate;
  const cp = module.checkpoint;

  return (
    <div className="path-field">
      <div className="path-scroll" ref={scrollRef}>
        <div
          className="path-canvas"
          role="group"
          aria-label={`Карта пути — модуль ${module.index} «${module.title}»`}
          onKeyDown={onKeyDown}
        >
          {/* connection layer (decorative duplicate of the semantic outline) */}
          <svg className="path-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {layout.entryStub && <Seg s={layout.entryStub} />}
            {layout.connections.map((s, i) => (
              <Seg key={i} s={s} />
            ))}
            {layout.exitStub && <Seg s={layout.exitStub} />}
            {/* module boundary at the entry */}
            <line
              className="pline pl-boundary"
              x1={layout.boundary.x} y1={layout.boundary.y1}
              x2={layout.boundary.x} y2={layout.boundary.y2}
              vectorEffect="non-scaling-stroke"
            />
            {/* checkpoint gate: two offset planes + aperture */}
            <line className="pline pl-gate" x1={gate.x} y1={gate.y1} x2={gate.x} y2={gate.y2} vectorEffect="non-scaling-stroke" />
            <line className="pline pl-gate-back" x1={gate.x + 2.6} y1={gate.y1 + 6} x2={gate.x + 2.6} y2={gate.y2 - 4} vectorEffect="non-scaling-stroke" />
            <ellipse className="pl-aperture" cx={gate.x + 1.2} cy={(gate.y1 + gate.y2) / 2} rx={2.6} ry={(gate.y2 - gate.y1) / 2 - 4} vectorEffect="non-scaling-stroke" />
            {layout.branch && (
              <line
                className="pline pl-branch"
                x1={layout.branch.from.x} y1={layout.branch.from.y}
                x2={layout.branch.to.x} y2={layout.branch.to.y}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* level nodes */}
          {layout.nodes.map((anchor) => (
            <PathNode
              key={anchor.level.number}
              anchor={anchor}
              state={levelVisualState(anchor.level, progress)}
              selected={anchor.level.number === selectedLevel}
              tabbable={anchor.level.number === selectedLevel}
              onSelect={onSelectLevel}
            />
          ))}

          {/* gate condition (quiet; detail carries the rest) */}
          <div className="gate-info" style={{ left: `${gate.x + 1}%`, top: `${gate.y2 + 4}%` }}>
            <p className="k">Контрольная точка · Уровень {cp.level}</p>
            <p className="cond">
              Баланс Pocket от <b>{formatThresholdUsd(cp.thresholdUsd)}</b>
            </p>
          </div>

          {/* tool branch label */}
          {layout.branch && (
            <div
              className="branch-label"
              style={{ left: `${layout.branch.to.x}%`, top: `${layout.branch.to.y}%` }}
            >
              <p className="k">Откроется</p>
              <p className="v">{layout.branch.label}</p>
            </div>
          )}
        </div>
      </div>

      {/* neighbour module edges — a quiet footer row OUTSIDE the pannable
          canvas, so they never collide with node/branch labels or get clipped */}
      <div className="field-footer">
        {prevModule ? (
          <button
            type="button"
            className="mod-edge"
            onClick={() => onSelectModule(prevModule.index)}
          >
            <span className="arr" aria-hidden="true">←</span>
            Модуль {prevModule.index} · {prevModule.title}
          </button>
        ) : (
          <span />
        )}
        {nextModule ? (
          <button
            type="button"
            className="mod-edge"
            onClick={() => onSelectModule(nextModule.index)}
          >
            Модуль {nextModule.index} · {nextModule.title}
            <span className="arr" aria-hidden="true">→</span>
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function Seg({ s }: { s: { from: { x: number; y: number }; to: { x: number; y: number }; kind: string } }) {
  return (
    <line
      className={`pline pl-${s.kind}`}
      x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y}
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** matchMedia guard (jsdom-safe). */
function window_matchMediaSafe(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : true;
}
