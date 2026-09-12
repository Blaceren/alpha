import type { AcademyLevelSummary, AcademyModuleSummary } from "@/lib/curriculum/academy-view";

/**
 * Path focus-state mapping — the frozen surface's four state kinds, derived from
 * REAL progression.
 *
 * The frozen PuthATA prototype renders these from synthetic fixtures whose own
 * header calls them "DESIGN QA — SYNTHETIC FIXTURE". Nothing from that fixture
 * set is imported here. What is carried across is the STATE VOCABULARY —
 * `current`, `waiting`, `revision`, `checkpoint` — because the stylesheet keys
 * `.focus__state--*` and `.level-node--wf-*` off exactly those four words, and
 * the composition is meaningless without them.
 *
 * Each kind is decided from canonical fields the Backend already provides:
 * `level.state` and `level.completionMethod`. Nothing here re-decides
 * progression, and nothing reads legacy `User.level` or XP.
 */
export type PathFocusKind = "current" | "waiting" | "revision" | "checkpoint";

/**
 * The two formal rows.
 *
 * The frozen prototype addresses the learner informally in both waiting states
 * («сейчас от тебя ничего не требуется»). The product's accepted copy contract
 * uses the formal «вас», and that correction is preserved here rather than
 * being undone by the restoration — these are the two accepted formal Path rows.
 *
 * They are the only two body lines this surface authors. Every other line on the
 * page comes from real curriculum data.
 */
export const PATH_WAITING_EXTERNAL =
  "Сейчас от вас ничего не требуется — уровень завершится после подтверждения со стороны провайдера.";
export const PATH_WAITING_REVIEW =
  "Сейчас от вас ничего не требуется — путь продолжится после решения проверки.";

/** The state kind for the level currently in focus. */
export function focusKind(level: AcademyLevelSummary): PathFocusKind {
  if (level.state === "checkpoint_unverified") return "checkpoint";
  if (level.state === "pending_review") return "waiting";
  if (level.completionMethod === "external-event" && level.state !== "completed") {
    return "waiting";
  }
  return "current";
}

/**
 * The formal waiting line for this level, or null when the learner has something
 * to do. Returning null is meaningful: it is what keeps the surface from telling
 * an actionable learner that nothing is required of them.
 */
export function waitingLine(level: AcademyLevelSummary): string | null {
  if (level.state === "pending_review") return PATH_WAITING_REVIEW;
  if (level.completionMethod === "external-event" && level.state !== "completed") {
    return PATH_WAITING_EXTERNAL;
  }
  return null;
}

/** Node state along the rail, exactly as the frozen strip classifies it. */
export type PathNodeState = "done" | "current" | "next" | "locked";

export function nodeState(
  level: AcademyLevelSummary,
  currentOrder: number | null,
): PathNodeState {
  if (level.state === "completed") return "done";
  if (currentOrder !== null && level.order === currentOrder) return "current";
  if (currentOrder !== null && level.order === currentOrder + 1) return "next";
  if (level.state === "locked") return "locked";
  return currentOrder !== null && level.order < currentOrder ? "done" : "locked";
}

export const NODE_STATE_WORD: Record<PathNodeState, string> = {
  done: "пройден",
  current: "текущий",
  next: "следующий",
  locked: "закрыт",
};

/** Module ribbon segment state, derived only from that module's own levels. */
export type ModuleSegState = "done" | "current" | "future";

export function moduleSegState(
  module: AcademyModuleSummary,
  currentModuleOrder: number | null,
): ModuleSegState {
  if (currentModuleOrder === null) {
    return module.progress.total > 0 && module.progress.completed === module.progress.total
      ? "done"
      : "future";
  }
  if (module.order < currentModuleOrder) return "done";
  if (module.order === currentModuleOrder) return "current";
  return "future";
}

export const MODULE_SEG_WORD: Record<ModuleSegState, string> = {
  done: "пройден",
  current: "текущий",
  future: "впереди",
};

/**
 * The node's state chip text. The frozen strip appends the workflow word to the
 * current node when the focus is not simply "current" — so a node reads
 * "текущий · на проверке" rather than contradicting the detail beside it.
 */
export function nodeStateText(state: PathNodeState, kind: PathFocusKind, stateLabel: string): string {
  if (state === "current" && kind !== "current") {
    return `${NODE_STATE_WORD[state]} · ${stateLabel.toLowerCase()}`;
  }
  return NODE_STATE_WORD[state];
}

/** `L07` — the frozen code format. */
export function levelCodeLabel(order: number): string {
  return `L${String(order).padStart(2, "0")}`;
}

/** `Модуль 03 / 20` — the frozen kicker format. */
export function moduleKicker(order: number, total: number): string {
  return `Модуль ${String(order).padStart(2, "0")} / ${total}`;
}
