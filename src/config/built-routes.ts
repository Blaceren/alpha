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
export const BUILT_ROUTE_IDS = new Set(["home", "path", "lessons", "tools", "support"]);

export function isBuiltRoute(id: string): boolean {
  return BUILT_ROUTE_IDS.has(id);
}
