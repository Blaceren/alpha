/**
 * WHAT THE ACADEMY SHOWS ITS LEARNERS RIGHT NOW.
 *
 * This is a PRESENTATION authority, and it is deliberately not the same
 * question as `built-routes.ts`. That file answers "does this section exist and
 * respond" — a fact about the codebase. This one answers "is this section part
 * of the product a learner sees today" — a product decision that can be taken
 * and untaken without anything being built or unbuilt.
 *
 * Keeping them apart matters. Community IS built: its route renders, its BFF
 * proxies answer, its Backend endpoints, its data and `community_moderate`
 * are all untouched and keep working for moderation. Writing `community` out of
 * the built list would have been a lie about the codebase and would have taken
 * the surface's own tests down with it.
 *
 * ONE SWITCH, NOT A SCATTER OF `false`. Because the decision is temporary,
 * every consumer reads this file: the desktop bar, the mobile bar and its
 * «Ещё» sheet, the secondary-group active state, the route itself, the
 * notification register and the shell's unread mark. Turning Community back on
 * is this one line, and nothing else has to be remembered.
 *
 * NO ENVIRONMENT VARIABLE. A runtime flag would make what a learner sees depend
 * on server configuration that is not in this repository and not in the release
 * artifact — two deployments of the same commit could disagree about what the
 * product is. The decision is part of the build, so it is reviewable, testable
 * and immutable per release.
 */

/**
 * Community is temporarily out of the learner-facing product.
 *
 * Reversal is this constant and nothing else. Nothing was deleted: not the
 * route, not the components, not the proxy, not the data.
 */
export const COMMUNITY_ENABLED = false;

/** Sections withheld from the product today, by id. */
const HIDDEN_SECTION_IDS: ReadonlySet<string> = new Set(
  COMMUNITY_ENABLED ? [] : ["community"],
);

/** Is this section part of the product a learner is shown today? */
export function isVisibleSection(id: string): boolean {
  return !HIDDEN_SECTION_IDS.has(id);
}

/**
 * Notification types that belong to a withheld section.
 *
 * The register and the shell's unread mark both filter on this, so a hidden
 * event cannot be shown in one place and counted in the other. The rows are
 * only ever filtered OUT of a view — nothing is deleted, marked read, or
 * written anywhere.
 */
const HIDDEN_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(
  COMMUNITY_ENABLED ? [] : ["community_reply", "community_moderation"],
);

/** Should this notification type be shown to the learner today? */
export function isVisibleNotificationType(type: string | null | undefined): boolean {
  return !HIDDEN_NOTIFICATION_TYPES.has(type ?? "");
}
