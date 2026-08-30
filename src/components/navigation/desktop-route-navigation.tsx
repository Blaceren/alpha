import Link from "next/link";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { isVisibleSection } from "@/config/feature-visibility";

/**
 * Desktop/tablet primary navigation.
 *
 * It renders the BUILT sections of the canonical `PRIMARY_NAV`, in canonical
 * order. It does not decide which sections exist, what they are called, where
 * they lead or what order they come in — `navigation.ts` and `built-routes.ts`
 * own all four, and this component reads them.
 *
 * THE ONE THING THIS FILE DECIDES IS VISUAL GROUPING. The learning route —
 * Главная · Путь · Уроки · Инструменты — is where a learner spends their time,
 * and Сообщество · Поддержка are where they go when they need something else.
 * Rendering six equal items made the bar read as an undifferentiated list and
 * gave the eye no anchor. They are now two groups inside ONE nav, separated by a
 * hairline: same element, same order, same DOM sequence, so the keyboard order
 * is unchanged and there is still exactly one navigation landmark.
 *
 * A SECTION IS NEVER LOST BY BEING UNGROUPED. Anything built that is not named
 * secondary is primary, so a section added to the canonical list appears without
 * this file being edited — the failure mode is "it shows up in the main group",
 * never "it disappears".
 */

/**
 * Visual grouping only. Not a route decision: these ids are still resolved
 * against `PRIMARY_NAV` for their label, href and order, and against
 * `built-routes.ts` for whether they answer at all.
 */
const SECONDARY_IDS = new Set(["community", "support"]);

export function DesktopRouteNavigation({ activeId = "home" }: { activeId?: string }) {
  /* Built AND shown. A section can exist, answer and still be out of the
     product today — see config/feature-visibility.ts. */
  const built = PRIMARY_NAV.filter((item) => isBuiltRoute(item.id) && isVisibleSection(item.id));
  const primary = built.filter((item) => !SECONDARY_IDS.has(item.id));
  const secondary = built.filter((item) => SECONDARY_IDS.has(item.id));

  const link = (item: (typeof built)[number]) => (
    <Link key={item.id} href={item.href} aria-current={activeId === item.id ? "page" : undefined}>
      {/* The label is wrapped so its box can be reserved at the ACTIVE weight —
          see `.rnav__label` — and the row cannot re-flow when the route changes. */}
      <span className="rnav__label" data-label={item.label}>
        <span>{item.label}</span>
      </span>
    </Link>
  );

  return (
    <nav className="rnav" aria-label="Основная навигация">
      <span className="rnav__group">{primary.map(link)}</span>
      {secondary.length > 0 ? (
        <>
          <span className="rnav__rule" aria-hidden="true" />
          <span className="rnav__group rnav__group--secondary">{secondary.map(link)}</span>
        </>
      ) : null}
    </nav>
  );
}
