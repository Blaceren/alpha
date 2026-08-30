"use client";

import * as React from "react";
import Link from "next/link";
import { MORE_MENU, PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { Icon } from "@/components/ui/icon";

/**
 * Mobile bottom navigation.
 *
 * FIVE SLOTS, AND THE FIFTH IS "ЕЩЁ" ONCE THERE ARE MORE THAN FIVE SECTIONS.
 * That is the canonical `MOBILE_NAV` shape and it is here now because a sixth
 * section shipped.
 *
 * WHAT HAPPENED, BECAUSE IT IS THE REASON THIS FILE CHANGED TWICE. This bar
 * used to render "Ещё" as a DISABLED button — its own id was not in the built
 * list — so the menu it existed to open could never open and every section
 * inside it, Поддержка included, was unreachable. LEARNER-OPERATIONS-V1 removed
 * it and left a note: an overflow control that opens nothing is worse than no
 * overflow control, and when a sixth section ships "Ещё" comes back as a real
 * control.
 *
 * COMMUNITY-V1 shipped the sixth section and did not bring it back. The bar
 * rendered all six built sections, its content measured 366px, and at a 320px
 * viewport «Поддержка» sat from x=307 to x=366 — past the right edge, clipped
 * and untappable. Found at a real 320px layout viewport, not by inspection.
 *
 * So: four canonical sections, then a real "Ещё" that opens the built entries
 * of `MORE_MENU`. It is a disclosure widget, not a link, and it is only
 * rendered when there is something behind it — an overflow control with an
 * empty menu is the same defect wearing different clothes.
 *
 * Fixed, safe-area padded, >=54px targets, active marked with aria-current +
 * underline rather than colour alone. Профиль stays on the top-bar avatar and
 * also appears here, because on mobile the avatar is a small target.
 */

/** How many canonical sections keep a slot of their own. The fifth is "Ещё". */
const PRIMARY_SLOTS = 4;

/** Visual grouping only, matching the desktop bar. Not a route decision. */
const SECONDARY_IDS = new Set(["community", "support"]);

export function MobileBottomNavigation({ activeId = "home" }: { activeId?: string }) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);

  const built = PRIMARY_NAV.filter((item) => isBuiltRoute(item.id));
  const needsOverflow = built.length > PRIMARY_SLOTS + 1;
  const primary = needsOverflow ? built.slice(0, PRIMARY_SLOTS) : built;

  /**
   * What "Ещё" contains: the canonical `MORE_MENU` order, the built entries
   * only, plus any built primary section that lost its slot. The union is
   * deduplicated by id, so a section can never be both in the bar and in the
   * sheet, and can never be in neither.
   */
  const overflow = React.useMemo(() => {
    if (!needsOverflow) return [];
    const shown = new Set(primary.map((item) => item.id));
    const seen = new Set<string>();
    return [...built, ...MORE_MENU]
      .filter((item) => isBuiltRoute(item.id) && !shown.has(item.id))
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  }, [built, primary, needsOverflow]);

  React.useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const moreIsActive = overflow.some((item) => item.id === activeId);

  return (
    <nav className="bottomnav" aria-label="Мобильная навигация">
      {moreOpen ? (
        <div
          className="bottomnav__sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Ещё"
          ref={sheetRef}
        >
          <ul>
            {overflow.map((item) => (
              /* The same primary/secondary seam the desktop bar draws. It is a
                 grouping attribute only — the order, the ids and the
                 destinations are still the canonical ones. */
              <li key={item.id} data-group={SECONDARY_IDS.has(item.id) ? "secondary" : "primary"}>
                <Link
                  href={item.href}
                  aria-current={activeId === item.id ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon name={item.iconKey} className="ic" />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul>
        {primary.map((item) => (
          <li key={item.id}>
            <Link href={item.href} aria-current={activeId === item.id ? "page" : undefined}>
              <Icon name={item.iconKey} className="ic" />
              <span className="lbl">{item.label}</span>
            </Link>
          </li>
        ))}
        {needsOverflow ? (
          <li>
            <button
              type="button"
              ref={moreRef}
              className={moreIsActive ? "is-active" : undefined}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              onClick={() => setMoreOpen((open) => !open)}
            >
              <Icon name="more" className="ic" />
              <span className="lbl">Ещё</span>
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
