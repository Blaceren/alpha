/**
 * THE WIRE BETWEEN A LEVEL'S TEST AND ITS LESSON PLAYER (2026-10-02).
 *
 * The test and the player are separate islands of one server-rendered page:
 * they share no parent that could hold a ref for both. Two things travel here,
 * and nothing else:
 *
 *   - «ПЕРЕСМОТРЕТЬ С 1:55». A test's разбор names the second of the lesson
 *     where the answer is; the request carries that second, which question it
 *     is about, and the element it came from — so a docked player can keep the
 *     question in view while the lesson plays.
 *   - THE VERDICTS OF THE LAST ATTEMPT (lesson hi-fi). After an attempt, which
 *     questions were answered right and which wrong, so the points on the
 *     lesson line can say so. The last verdicts are kept for a player that
 *     mounts after them.
 *
 * WHAT IT IS NOT. Not progress: nothing here is sent to the Backend, and a
 * verdict completes nothing. Not a store of anything but the last verdicts of
 * this page.
 *
 * `requestLessonRewatch` answers whether a player took the request, so the
 * caller can say something true when there was none to take it.
 */
export type LessonRewatchRequest = {
  seconds: number;
  /** The question the request is about, when it comes from one. */
  questionNumber?: number;
  /** The element the learner pressed; a docked player keeps it in view. */
  from?: HTMLElement | null;
};

export type LessonVerdict = "right" | "wrong";
/** Question number → the verdict of the last attempt. */
export type LessonVerdicts = ReadonlyMap<number, LessonVerdict>;

type RewatchListener = (request: LessonRewatchRequest) => void;
type VerdictListener = (verdicts: LessonVerdicts | null) => void;
type PublishedVerdicts = { levelCode: string; verdicts: LessonVerdicts | null };

const rewatchListeners = new Set<RewatchListener>();
const verdictListeners = new Set<{ levelCode: string; listener: VerdictListener }>();
let lastVerdicts: PublishedVerdicts | null = null;

/** A mounted lesson player subscribes; the returned function unsubscribes. */
export function subscribeLessonRewatch(listener: RewatchListener): () => void {
  rewatchListeners.add(listener);
  return () => {
    rewatchListeners.delete(listener);
  };
}

/** Ask the page's lesson player to play from `seconds`. False when there is none. */
export function requestLessonRewatch(
  seconds: number,
  options: { questionNumber?: number; from?: HTMLElement | null } = {},
): boolean {
  if (!Number.isFinite(seconds) || seconds < 0 || rewatchListeners.size === 0) return false;
  const request: LessonRewatchRequest = { seconds: Math.floor(seconds) };
  if (options.questionNumber !== undefined) request.questionNumber = options.questionNumber;
  if (options.from !== undefined) request.from = options.from;
  for (const listener of [...rewatchListeners]) listener(request);
  return true;
}

/**
 * The test of `levelCode` says how its last attempt went; null when there is
 * none to show (a new attempt began, or the test left the page). Verdicts are
 * always about ONE level: a player of another level never hears them, so a
 * client-side step to the next lesson cannot carry them along.
 */
export function publishLessonVerdicts(levelCode: string, verdicts: LessonVerdicts | null): void {
  lastVerdicts = { levelCode, verdicts };
  for (const entry of [...verdictListeners]) {
    if (entry.levelCode === levelCode) entry.listener(verdicts);
  }
}

/** The player of `levelCode` hears its verdicts, starting with the last ones published. */
export function subscribeLessonVerdicts(levelCode: string, listener: VerdictListener): () => void {
  const entry = { levelCode, listener };
  verdictListeners.add(entry);
  listener(lastVerdicts && lastVerdicts.levelCode === levelCode ? lastVerdicts.verdicts : null);
  return () => {
    verdictListeners.delete(entry);
  };
}
