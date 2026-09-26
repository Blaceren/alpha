"use client";

import * as React from "react";
import Link from "next/link";
import { MORE_MENU, PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { isVisibleSection } from "@/config/feature-visibility";
import { Icon } from "@/components/ui/icon";
import { useMobileMenu } from "@/components/shell/mobile-menu-state";

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
  /* The open state is shared with the top bar's avatar: on `/profile` both are
     visible at once and only one of them may declare the current page. */
  const { open: moreOpen, setOpen: setMoreOpen } = useMobileMenu();
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);

  const built = PRIMARY_NAV.filter((item) => isBuiltRoute(item.id) && isVisibleSection(item.id));

  /**
   * What "Ещё" contains: the canonical `MORE_MENU` order, the built and shown
   * entries only, plus any primary section that lost its slot. The union is
   * deduplicated by id, so a section can never be both in the bar and in the
   * sheet, and can never be in neither.
   */
  const overflow = React.useMemo(() => {
    const shown = new Set(PRIMARY_NAV.filter((i) => isBuiltRoute(i.id) && isVisibleSection(i.id))
      .slice(0, PRIMARY_SLOTS).map((i) => i.id));
    const seen = new Set<string>();
    return [...PRIMARY_NAV, ...MORE_MENU]
      .filter((item) => isBuiltRoute(item.id) && isVisibleSection(item.id) && !shown.has(item.id))
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  }, []);

  /**
   * WHETHER "ЕЩЁ" IS RENDERED IS A QUESTION ABOUT WHAT IS BEHIND IT.
   *
   * It used to be `built.length > PRIMARY_SLOTS + 1` — a count of PRIMARY_NAV
   * alone, which quietly assumed the primary list would always be the thing
   * that overflowed. `MORE_MENU` was never counted, and Профиль lives only
   * there. The moment the built primary sections fitted the bar exactly, the
   * control vanished and took Профиль with it — a section reachable from
   * nothing, which is the exact defect this bar was rebuilt to end.
   *
   * Withholding Community made that day arrive: five built sections, five
   * slots. So the predicate now asks what the control is for — is there
   * anything behind it — and the file's own description of "Ещё" becomes the
   * rule rather than a coincidence of list lengths.
   */
  const needsOverflow = overflow.length > 0;
  const primary = needsOverflow ? built.slice(0, PRIMARY_SLOTS) : built;

  /**
   * Closing the disclosure, and where focus goes when it closes.
   *
   * Escape and a press outside both close it, and both put focus back on the
   * control that opened it — a menu that closes and leaves focus on nothing has
   * dropped a keyboard user at the top of the document. `pointerdown` rather
   * than `click`, so the menu is already gone by the time the press completes
   * and the thing under it does not receive a stray activation.
   */
  React.useEffect(() => {
    if (!moreOpen) return;
    const close = (deferFocus: boolean) => {
      setMoreOpen(false);
      /* A press outside is followed by the browser's own focus handling for
         that press — which, on ordinary page content, blurs to `body`. Putting
         focus back in the same tick would simply be undone a moment later, so
         the restore waits for the press to finish. Escape has no such
         competition and is restored immediately. */
      if (deferFocus) requestAnimationFrame(() => moreRef.current?.focus());
      else moreRef.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (sheetRef.current?.contains(target)) return;
      if (moreRef.current?.contains(target)) return;
      close(true);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [moreOpen, setMoreOpen]);

  /**
   * Focus enters the sheet when it opens, so the next Tab is inside the menu
   * rather than somewhere behind it. It lands on the first destination, not on
   * the container, because the first destination is what the learner opened it
   * for.
   */
  React.useEffect(() => {
    if (!moreOpen) return;
    sheetRef.current?.querySelector<HTMLElement>("a")?.focus();
  }, [moreOpen]);

  /* The button's LOOK. Unchanged: it marks itself whenever the open section is
     anywhere behind it, so the bar never shows every slot inactive while the
     learner is plainly somewhere. */
  const moreIsActive = overflow.some((item) => item.id === activeId);

  /* The button's DECLARATION, which is a narrower thing than its look.
     `aria-current="true"` means "the current item in this set" — not "this is
     the current page", which the button is not. It is claimed only while the
     menu is CLOSED and only for the secondary group, and both halves matter:
       — closed, because once the menu opens the real «Сообщество» /
         «Поддержка» row is on screen carrying `aria-current="page"`, and two
         markers is one more answer than the question has;
       — secondary only, because «Профиль» also lives behind this button, and on
         /profile the avatar in the bar above already carries the marker. The
         button would be the second one.
     So on every other route the button declares nothing at all. */
  const moreOwnsCurrent =
    !moreOpen && overflow.some((item) => item.id === activeId && SECONDARY_IDS.has(item.id));

  return (
    <nav className="bottomnav" aria-label="Мобильная навигация">
      {moreOpen ? (
        <div
          className="bottomnav__sheet"
          role="dialog"
          /* DELIBERATELY NOT aria-modal. This is an in-flow disclosure, not a
             drawer: nothing behind it is inert, the bar underneath stays
             visible and clickable, and there is no scrim. Declaring it modal
             told assistive technology to ignore everything outside it — which
             hid the current-route marker on the bar and left seven routes
             announcing no current page at all while the sheet was open. */
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
              aria-current={moreOwnsCurrent ? "true" : undefined}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              onClick={() => setMoreOpen(!moreOpen)}
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
