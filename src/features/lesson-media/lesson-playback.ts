/**
 * «ПЕРЕСМОТРЕТЬ С 1:55» — the one message a level page passes between two of
 * its parts (2026-10-02).
 *
 * A test's разбор names the second of the lesson where the answer is. The test
 * and the player are separate islands of one server-rendered page: they share
 * no parent that could hold a ref for both. This module is the wire between
 * them — a request to rewatch from a second, and the player's subscription to
 * such requests. Nothing else travels on it.
 *
 * WHAT IT IS NOT. Not progress: a rewatch records nothing, completes nothing
 * and is never sent to the Backend. Not a store: there is no state here to
 * read back, only a request that is delivered or is not.
 *
 * `requestLessonRewatch` answers whether a player took the request, so the
 * caller can say something true when there was none to take it.
 */
export type LessonRewatchRequest = { seconds: number };

type Listener = (request: LessonRewatchRequest) => void;

const listeners = new Set<Listener>();

/** A mounted lesson player subscribes; the returned function unsubscribes. */
export function subscribeLessonRewatch(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Ask the page's lesson player to play from `seconds`. False when there is none. */
export function requestLessonRewatch(seconds: number): boolean {
  if (!Number.isFinite(seconds) || seconds < 0 || listeners.size === 0) return false;
  for (const listener of [...listeners]) listener({ seconds: Math.floor(seconds) });
  return true;
}
