/**
 * PathLayoutEngine (Phase D2A) — deterministic geometry for one module window.
 *
 * The visible Route Field never renders all 100 levels: the natural window is
 * one module (4–6 levels + its closing checkpoint gate) plus dim continuation
 * stubs toward the neighbouring modules. All coordinates are percentages of the
 * canvas (0–100 × 0–100); DOM nodes and the SVG connection layer share the same
 * coordinate space, so they stay aligned at any size.
 *
 * No randomness, no animation loop: same input → same layout, always.
 * Every bend is explained by the level sequence (deterministic step offsets),
 * the module boundary, the checkpoint gate or the tool branch.
 */

import type { CurriculumLevel, CurriculumModule } from "@/domain/curriculum";
import {
  levelProgressState,
  type PathProgress,
} from "@/features/path/model/path-state";

export interface PathPoint {
  x: number;
  y: number;
}

export interface NodeAnchor extends PathPoint {
  level: CurriculumLevel;
  /** Which side the title label sits on (deterministic, avoids collisions). */
  labelSide: "above" | "below";
  isGate: boolean;
}

export type ConnectionKind = "completed" | "upcoming" | "future" | "distant";

export interface ConnectionSegment {
  from: PathPoint;
  to: PathPoint;
  kind: ConnectionKind;
}

export interface BoundaryAnchor {
  x: number;
  y1: number;
  y2: number;
}

export interface BranchAnchor {
  from: PathPoint;
  to: PathPoint;
  /** Tool name shown at the branch tip. */
  label: string;
}

export interface ModuleLayout {
  module: CurriculumModule;
  nodes: NodeAnchor[];
  connections: ConnectionSegment[];
  /** Module entry boundary (start of the module). */
  boundary: BoundaryAnchor;
  /** Checkpoint gate anchor (vertical) at the module end. */
  gate: { x: number; y1: number; y2: number; node: NodeAnchor };
  /** Tool-unlock branch off the gate, when the checkpoint unlocks a tool. */
  branch?: BranchAnchor;
  /** Dim stub entering from the previous module (absent on module 1). */
  entryStub?: ConnectionSegment;
  /** Dim continuation toward the next module (absent on module 20). */
  exitStub?: ConnectionSegment;
}

/** Deterministic vertical step offsets — the route's believable "walk". */
const WALK = [0, 5, -3, 4, -2, 3];

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Layout invariant violated: ${what}`);
  return value;
}

const X_FIRST = 11;
const X_GATE = 82;
const Y_START = 74;
const Y_END = 32;

/** Compute the layout for one module under the given progress. */
export function computeModuleLayout(
  module: CurriculumModule,
  progress: PathProgress,
): ModuleLayout {
  const n = module.levels.length; // 4–6, last level is the checkpoint
  const stepX = (X_GATE - X_FIRST) / (n - 1);
  const stepY = (Y_START - Y_END) / (n - 1);

  const nodes: NodeAnchor[] = module.levels.map((level, i) => {
    const isGate = level.kind === "checkpoint";
    return {
      level,
      x: X_FIRST + stepX * i,
      y: Y_START - stepY * i - (isGate ? 0 : (WALK[i % WALK.length] ?? 0) * 0.6),
      labelSide: i % 2 === 0 ? "below" : "above",
      isGate,
    };
  });

  const connections: ConnectionSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = must(nodes[i], `node ${i}`);
    const to = must(nodes[i + 1], `node ${i + 1}`);
    connections.push({
      from,
      to,
      kind: segmentKind(from.level.number, to.level.number, progress),
    });
  }

  const gateNode = must(nodes.at(-1), "gate node");
  const gate = { x: gateNode.x, y1: gateNode.y - 24, y2: gateNode.y + 20, node: gateNode };

  const branch: BranchAnchor | undefined = module.checkpoint.toolUnlock
    ? {
        from: { x: gateNode.x, y: gateNode.y },
        to: { x: gateNode.x + 8, y: gateNode.y - 17 },
        label: module.checkpoint.toolUnlock.name,
      }
    : undefined;

  const boundary: BoundaryAnchor = {
    x: X_FIRST - 7,
    y1: Y_START - 16,
    y2: Y_START + 14,
  };

  const entryStub: ConnectionSegment | undefined =
    module.index > 1
      ? {
          from: { x: -4, y: Y_START + 8 },
          to: must(nodes[0], "first node"),
          kind: levelProgressState(module.startLevel - 1, progress) === "completed"
            ? "completed"
            : "distant",
        }
      : undefined;

  const exitStub: ConnectionSegment | undefined =
    module.index < 20
      ? {
          from: gateNode,
          to: { x: 104, y: gateNode.y - 10 },
          kind: "distant",
        }
      : undefined;

  return { module, nodes, connections, boundary, gate, branch, entryStub, exitStub };
}

function segmentKind(fromLevel: number, toLevel: number, progress: PathProgress): ConnectionKind {
  const from = levelProgressState(fromLevel, progress);
  const to = levelProgressState(toLevel, progress);
  if (to === "completed" || to === "current") return "completed";
  if (from === "current") return "upcoming";
  return "future";
}
