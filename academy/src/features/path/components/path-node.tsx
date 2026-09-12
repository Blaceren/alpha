"use client";

import type { NodeAnchor } from "@/features/path/model/layout-engine";
import {
  stateLabel,
  type LevelVisualState,
} from "@/features/path/model/path-state";

/**
 * One level node on the Route Field. A real button (keyboard/AT reachable):
 * geometry + label text carry the state, never colour alone. The current node
 * gets aria-current="step".
 */
export function PathNode({
  anchor,
  state,
  selected,
  tabbable,
  onSelect,
}: {
  anchor: NodeAnchor;
  state: LevelVisualState;
  selected: boolean;
  tabbable: boolean;
  onSelect: (levelNumber: number) => void;
}) {
  const { level } = anchor;
  const isCurrent = state === "current" || state === "checkpoint-current";
  const isCheckpoint = level.kind === "checkpoint";
  const title = isCheckpoint ? "Контрольная точка" : level.title;
  const name = `Уровень ${level.number} — ${title}, ${stateLabel(state)}`;

  return (
    <button
      type="button"
      className={`pnode pn-${state}${isCheckpoint ? " pn-cp" : ""}`}
      style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
      data-level={level.number}
      data-selected={selected || undefined}
      tabIndex={tabbable ? 0 : -1}
      aria-current={isCurrent ? "step" : undefined}
      aria-label={name}
      onClick={() => onSelect(level.number)}
    >
      <span className="marker" aria-hidden="true" />
      {!isCheckpoint && (
        <span className={`pnode-label side-${anchor.labelSide}`} aria-hidden="true">
          <span className="n">{level.number}</span>
          <span className="t">{level.title}</span>
          <span className="s">{stateLabel(state)}</span>
        </span>
      )}
    </button>
  );
}
