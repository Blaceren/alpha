/**
 * The sections that exist as REAL routes.
 *
 * WHY THIS IS ONE LIST AND NOT TWO. It used to be a `BUILT_ROUTES` constant
 * copied into `desktop-route-navigation.tsx` and `mobile-bottom-navigation.tsx`.
 * Two copies of "what is built" drift the moment one section ships, and that is
 * exactly what happened: LEARNER-OPERATIONS-V1 built `/support`, both copies
 * still said it was not built, and the learner support surface became a page
 * that renders perfectly and that nothing in the product can reach.
 *
 * `navigation.ts` remains the canonical ORDER and LABELS. This is the separate
 * question of which of those sections actually answer today.
 */
/**
 * ACADEMY-EXPERIENCE-COMPLETION-1 adds `notifications` and `profile`. Both
 * routes now exist and answer; leaving them out here would reproduce exactly the
 * failure this file was created to stop — a page that renders perfectly and that
 * nothing in the product can reach.
 */
export const BUILT_ROUTE_IDS = new Set([
  "home",
  "path",
  "lessons",
  "tools",
  "support",
  "notifications",
  "profile",
]);

export function isBuiltRoute(id: string): boolean {
  return BUILT_ROUTE_IDS.has(id);
}
