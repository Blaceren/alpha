import { MORE_MENU, PRIMARY_NAV, type NavItem } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { isVisibleSection } from "@/config/feature-visibility";

/**
 * WHAT THE MOBILE BAR SHOWS — the one decision, read by the bar and by the
 * avatar above it.
 *
 * Four canonical sections keep a slot of their own. Whatever else is built and
 * shown — the primary sections past the fourth, then the canonical `MORE_MENU`
 * — goes behind «Ещё», deduplicated by id so a section is never in both places
 * and never in neither.
 *
 * ONE DESTINATION IS NOT A MENU (2026-10-03). Support moved into the profile
 * (owner: «что бы написать в поддержку можно было только из профиля»), and with
 * Community withheld that left «Ещё» opening a sheet with a single row,
 * «Профиль». A menu of one is a detour: the row takes the fifth slot itself, and
 * «Ещё» comes back the day a second destination does.
 *
 * Pure, so the avatar in the top bar can ask whether the bar below it carries
 * the profile — on `/profile` only one control may say it is the current page.
 */
export const PRIMARY_SLOTS = 4;

export type MobileBarLayout = {
  /** Sections with a slot of their own, in canonical order. */
  readonly slots: readonly NavItem[];
  /** What «Ещё» opens. Empty when the bar has no «Ещё». */
  readonly overflow: readonly NavItem[];
};

const shownItem = (item: NavItem) => isBuiltRoute(item.id) && isVisibleSection(item.id);

export function mobileBarLayout(): MobileBarLayout {
  const shown = PRIMARY_NAV.filter(shownItem);
  const primary = shown.slice(0, PRIMARY_SLOTS);
  const inBar = new Set(primary.map((item) => item.id));
  const seen = new Set<string>();
  const rest = [...PRIMARY_NAV, ...MORE_MENU]
    .filter((item) => shownItem(item) && !inBar.has(item.id))
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));

  if (rest.length === 0) return { slots: primary, overflow: [] };
  if (rest.length === 1) return { slots: [...primary, rest[0]!], overflow: [] };
  return { slots: primary, overflow: rest };
}

/** Does the bar carry this section as a slot of its own? */
export function mobileBarCarries(id: string): boolean {
  return mobileBarLayout().slots.some((item) => item.id === id);
}
