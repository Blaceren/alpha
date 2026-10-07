/**
 * Leave the page for `path` with a full document load, replacing this history
 * entry (2026-10-07 audit).
 *
 * After «Выйти» a router navigation kept the app's in-memory page cache: Back
 * on a shared computer could bring the previous learner's pages out of it. A
 * full load starts the next page from nothing. Its own module so a test can
 * replace it — jsdom cannot navigate.
 */
export function hardReplace(path: string): void {
  window.location.replace(path);
}
