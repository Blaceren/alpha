/**
 * G4-R1 — THE CANONICAL GROWTH ROUTE SET, DEFINED ONCE.
 *
 * WHAT WENT WRONG. The CRM has two supported runtime shells. `MockShell` renders
 * the Next.js page tree and takes its navigation from `config/navigation.ts`;
 * `ApiShell` — the shell every deployed environment uses, because PREPROD and
 * PROD both run `CRM_MODE=api` — renders NEITHER. In api mode `AppShell` discards
 * `children` entirely and `ApiModeLanding` decides what to show from the pathname
 * against a hard-coded list, with a hard-coded topbar beside it.
 *
 * G4 shipped `src/app/(crm)/growth/page.tsx`, added `/growth` to the MOCK
 * navigation, and added nothing to either api-mode list. The result was a
 * complete, working, authorised workspace that no deployed staff member could
 * reach: every Growth URL rendered `Раздел ещё не подключён`, while
 * `/affiliates` and `/users` worked in the same session. The file's own comment
 * records the identical thing happening to the affiliate workspaces in AFD-5A.
 *
 * WHY A REGISTRY RATHER THAN A SIXTH ENTRY IN EACH LIST. Adding Growth to both
 * hard-coded lists would fix today's five pages and guarantee the same omission
 * for the next section — two lists that must be edited together, with nothing
 * making them. This module is the single definition both shells consume: the
 * paths, the labels, the surface each path shows, and the permission rule that
 * decides whether a principal sees the section at all. A route added here
 * appears in both shells or in neither.
 *
 * THE PATHS ARE REAL ROUTES, NOT TAB STATE. The workspace used to hold its
 * surface in `React.useState`, so all five surfaces shared one URL: an operator
 * could not link to the Pocket view, a reload always returned to Overview, and
 * the browser's back button left the section. Each surface now has its own path
 * in both modes, and the tab strip navigates rather than mutating state.
 */

/** The five internal Growth surfaces, in the order the tab strip shows them. */
export const GROWTH_SURFACES = [
  "overview",
  "funnel",
  "acquisition",
  "pocket",
  "ingress",
] as const;

export type GrowthSurface = (typeof GROWTH_SURFACES)[number];

export type GrowthRoute = {
  readonly surface: GrowthSurface;
  /** The canonical path. One path set, shared by every supported CRM mode. */
  readonly path: string;
  readonly label: string;
};

/**
 * The root of the section. `/growth` is the Overview rather than a redirecting
 * index, so the section has one entry point and the navigation has one href.
 */
export const GROWTH_ROOT_PATH = "/growth";

export const GROWTH_ROUTES: readonly GrowthRoute[] = [
  { surface: "overview", path: GROWTH_ROOT_PATH, label: "Обзор" },
  { surface: "funnel", path: "/growth/funnel", label: "CRO-воронка" },
  { surface: "acquisition", path: "/growth/acquisition", label: "Качество трафика" },
  { surface: "pocket", path: "/growth/pocket-conversions", label: "Конверсии Pocket" },
  { surface: "ingress", path: "/growth/ingress-health", label: "Здоровье приёма" },
];

/**
 * Resolve a pathname to a Growth surface, or null if it is not one.
 *
 * EXACT MATCHING, in the same style as every other api-mode route: a nested path
 * nobody has built stays deferred rather than appearing to exist. `/growth/x`
 * and `/growth/funnel/y` are not Growth routes.
 */
export function resolveGrowthSurface(pathname: string | null): GrowthSurface | null {
  if (pathname === null) return null;
  const match = GROWTH_ROUTES.find((route) => route.path === pathname);
  return match ? match.surface : null;
}

/**
 * The permission rule for the whole section.
 *
 * DELIBERATELY THE SAME RULE THE BACKEND ENFORCES. Every Growth route calls
 * `requireAffiliateReader`, which is satisfied by `view_affiliate_analytics` OR
 * `manage_settings` — the identical pair `ApiShell` already uses for the
 * Аффилейты link. Navigation canon and the real authorization gate therefore
 * cannot disagree, and a role that would receive 403 never sees the entry.
 *
 * This makes the section VISIBLE, never AUTHORISED: the backend decides, and
 * hiding the link is a courtesy on top of a gate rather than the gate itself.
 */
export const GROWTH_SECTION_PERMISSIONS = [
  "view_affiliate_analytics",
  "manage_settings",
] as const;
