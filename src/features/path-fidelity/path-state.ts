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
/* There was a third, for an external-event level: «Сейчас от вас ничего не
   требуется — уровень завершится после подтверждения со стороны провайдера».
   In the program learners have (2026-10-04, launch audit) that level is the
   registration in the trading environment, and the learner is the one who has
   to act — the Home said «Пройдите регистрацию» while the Path said nothing was
   required. It is the current level now, with the level page's own link. */
export const PATH_WAITING_REVIEW =
  "Сейчас от вас ничего не требуется — путь продолжится после решения проверки.";
/**
 * The third waiting row (2026-10-02): the level in focus is one the program has
 * defined and not opened yet. Same shape as the two above, and the same
 * promise — nothing is asked of the learner, and the reason is named.
 */
export const PATH_WAITING_PRODUCTION =
  "Сейчас от вас ничего не требуется — уровень откроется, когда урок будет готов.";

/** The state kind for the level currently in focus. */
export function focusKind(level: AcademyLevelSummary): PathFocusKind {
  /* A level in production is waiting on the Academy, not on the learner: the
     frozen `waiting` treatment (an open ring, no lit point) is exactly that. */
  if (level.inProduction) return "waiting";
  if (level.state === "checkpoint_unverified") return "checkpoint";
  if (level.state === "pending_review") return "waiting";
  return "current";
}

/**
 * The formal waiting line for this level, or null when the learner has something
 * to do. Returning null is meaningful: it is what keeps the surface from telling
 * an actionable learner that nothing is required of them.
 */
export function waitingLine(level: AcademyLevelSummary): string | null {
  if (level.inProduction) return PATH_WAITING_PRODUCTION;
  if (level.state === "pending_review") return PATH_WAITING_REVIEW;
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
export function nodeStateText(
  state: PathNodeState,
  kind: PathFocusKind,
  stateLabel: string,
  /** The level is defined and not open yet. */
  inProduction = false,
): string {
  /* «текущий» says the learner is working on it. On a level that is not open
     that is the one thing that is not true, so the node says what is. The
     same holds for «следующий» (2026-10-04, launch audit): past the last open
     level the one after the current was called «следующий» while it is not
     produced either — a level that is not open yet says so, whatever its
     place. */
  if (inProduction && state !== "done") return stateLabel.toLowerCase();
  if (state === "current" && kind !== "current") {
    return `${NODE_STATE_WORD[state]} · ${stateLabel.toLowerCase()}`;
  }
  return NODE_STATE_WORD[state];
}

/**
 * Why the path does not continue past the level in focus — said ABOUT THE
 * LEVEL THAT FOLLOWS, by number.
 *
 * The line used to be that level's own lock sentence, printed bare under the
 * level in focus: «Сначала нужно завершить предыдущие уровни.» Read there, it
 * says the learner must finish earlier levels before the one they are standing
 * on. The frozen line names its subject («Уровень 5 … станет доступен после…»),
 * and so does this.
 *
 * Null when there is nothing true to add: the next level is already open, or
 * the level in focus is itself not open yet.
 */
export function followingLevelLine(
  focus: AcademyLevelSummary,
  following: AcademyLevelSummary | null,
  /** The following level's own canonical sentence, for the reasons not rephrased here. */
  explain: (level: AcademyLevelSummary) => string,
): string | null {
  if (!following || focus.inProduction) return null;
  if (following.state !== "locked") return null;
  if (following.inProduction) return `Уровень ${following.order} ещё готовится и откроется позже.`;
  if (following.lockReason === "sequence" || following.lockReason === "not_current") {
    return `Уровень ${following.order} откроется, когда этот уровень будет завершён.`;
  }
  return `Уровень ${following.order}: ${explain(following)}`;
}

/**
 * Does a chapter end after this module?
 *
 * From the program's own chapters when it has them. A program without chapters
 * keeps the frozen ribbon's rhythm — a taller tick after every fifth module —
 * which is what the 100-level program was drawn with.
 */
export function endsChapter(modules: readonly AcademyModuleSummary[], index: number): boolean {
  const current = modules[index];
  const next = modules[index + 1];
  if (!current) return false;
  if (modules.some((m) => m.chapter !== null)) {
    return next !== undefined && current.chapter?.number !== next.chapter?.number;
  }
  return current.order % 5 === 0;
}

/** `Глава 2 · Чтение графика` — the chapter line above a module, or null. */
export function chapterKicker(module: AcademyModuleSummary): string | null {
  return module.chapter ? `Глава ${module.chapter.number} · ${module.chapter.title}` : null;
}

/** `L07` — the frozen code format. */
export function levelCodeLabel(order: number): string {
  return `L${String(order).padStart(2, "0")}`;
}

/** `Модуль 03 / 20` — the frozen kicker format. */
export function moduleKicker(order: number, total: number): string {
  return `Модуль ${String(order).padStart(2, "0")} / ${total}`;
}
