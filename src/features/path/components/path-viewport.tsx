"use client";

import { useEffect, useRef, useState } from "react";
import { formatThresholdUsd } from "@/domain/curriculum";
import type { VisiblePathWindow } from "@/features/path/model/visible-window";
import {
  levelVisualState,
  type PathProgress,
} from "@/features/path/model/path-state";
import { PathNode } from "@/features/path/components/path-node";

/**
 * The Route Field viewport: one module window (Phase D2A, presentation refined
 * in D2A-R1). The SVG connection layer and the DOM node buttons share the same
 * percentage coordinate space (layout engine), so they stay aligned at every
 * size. On narrow screens the canvas is wider than the viewport and pans
 * natively; edge fades + a one-off affordance make that pan discoverable, and a
 * compact checkpoint summary lives OUTSIDE the pannable area so the nearest
 * gate is never something the user has to pan (or guess) to read.
 */
export function PathViewport({
  window: win,
  progress,
  selectedLevel,
  detailOpen,
  onSelectLevel,
  onSelectModule,
  onKeyDown,
}: {
  window: VisiblePathWindow;
  progress: PathProgress;
  selectedLevel: number;
  detailOpen: boolean;
  onSelectLevel: (levelNumber: number) => void;
  onSelectModule: (moduleIndex: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { layout, prevModule, nextModule } = win;
  const { module } = layout;

  /** Pan affordance is shown until the user first interacts with the field. */
  const [panned, setPanned] = useState(false);
  /** True only while the canvas actually overflows (narrow viewports). */
  const [pannable, setPannable] = useState(false);

  // Auto-centre the selected (or current) node inside the pannable canvas.
  // NOTE: this programmatic scroll must not count as a user interaction, or the
  // pan affordance would vanish before the user ever touched the field.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const overflows = scroller.scrollWidth > scroller.clientWidth + 1;
    setPannable(overflows);
    if (!overflows) return;
    const node = scroller.querySelector<HTMLElement>(`[data-level="${selectedLevel}"]`);
    if (!node) return;
    const target = node.offsetLeft - scroller.clientWidth / 2;
    const reduce = prefersReducedMotion();
    scroller.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
  }, [selectedLevel, win.moduleIndex]);

  const gate = layout.gate;
  const cp = module.checkpoint;
  const selectedAnchor = layout.nodes.find((n) => n.level.number === selectedLevel);

  return (
    <div className="path-field" data-pannable={pannable || undefined}>
      {/* stage = the pannable area; the fades/affordance anchor to IT (never to
          the field, whose top may hold the checkpoint summary on short screens) */}
      <div className="path-stage">
      <div
        className="path-scroll"
        ref={scrollRef}
        onPointerDown={() => setPanned(true)}
        onWheel={() => setPanned(true)}
        onTouchStart={() => setPanned(true)}
      >
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
            {/* module boundary at the entry — the workspace's left wall */}
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
            {/* context leader: the selected node is the source of the detail
                panel — the thread runs from the node to the panel's edge. */}
            {detailOpen && selectedAnchor && (
              <line
                className="pline pl-leader"
                x1={selectedAnchor.x} y1={selectedAnchor.y}
                x2={101} y2={selectedAnchor.y}
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

          {/* gate marker inside the field (the readable summary lives below) */}
          <div className="gate-tag" style={{ left: `${gate.x + 1}%`, top: `${gate.y2 + 4}%` }}>
            <p className="k">Контрольная точка</p>
            <p className="n">Уровень {cp.level}</p>
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

        {/* Pan affordance: edge fades + a restrained one-off mark. Both exist
            only while the canvas overflows; the mark softens away after the
            first interaction of the session (never a permanent "swipe" label). */}
        {pannable && (
          <>
            <span className="pan-fade pan-fade-l" aria-hidden="true" />
            <span className="pan-fade pan-fade-r" aria-hidden="true" />
            <span className="pan-hint" data-panned={panned || undefined} aria-hidden="true">
              <i />
              <i />
            </span>
          </>
        )}
      </div>

      {/* Compact checkpoint summary — always fully visible, never inside the
          pannable canvas, so the threshold and reward never get edge-clipped. */}
      <div className="cp-summary">
        <span className="cps-mark" aria-hidden="true" />
        <p className="cps-main">
          Ближайшая контрольная точка · <b>Уровень {cp.level}</b> — баланс Pocket от{" "}
          <b>{formatThresholdUsd(cp.thresholdUsd)}</b>
        </p>
        <p className="cps-reward">
          Откроется: <b>{cp.rank.label}</b>
          {cp.toolUnlock ? <> · <b>{cp.toolUnlock.name}</b></> : null}
        </p>
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
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : true;
}
