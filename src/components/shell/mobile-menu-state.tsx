"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Whether the mobile «Ещё» disclosure is open — shared, because two parts of the
 * shell need the same answer.
 *
 * WHY THIS EXISTS AT ALL. `/profile` is reachable from two visible controls on
 * mobile: the avatar in the top bar, and the «Профиль» row inside «Ещё». When
 * the menu is open both are on screen, and only one of them may declare itself
 * the current page — two `aria-current="page"` in one document is two answers to
 * a question that has one.
 *
 * WHICH ONE YIELDS, AND WHY IT IS THE AVATAR. The sheet declares
 * `aria-modal="true"`. While it is open it is the exposed navigation, and
 * content outside it is not; marking the avatar there would put the only current
 * marker somewhere assistive technology has been told to ignore. So the sheet's
 * own row carries it while the menu is open, and the avatar carries it the rest
 * of the time.
 *
 * THE DESKTOP AVATAR NEVER YIELDS. It is a different instance in a different
 * bar, and the sheet cannot be on screen beside it — the bottom bar is
 * `display: none` above the nav breakpoint. A menu left open at 390px and then
 * widened to 1440px must not blank the desktop marker, which is why the
 * placement decides and not the state alone.
 */
type MobileMenuValue = { open: boolean; setOpen: (open: boolean) => void };

const MobileMenuContext = createContext<MobileMenuValue | null>(null);

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <MobileMenuContext.Provider value={value}>{children}</MobileMenuContext.Provider>;
}

/**
 * The disclosure state.
 *
 * OUTSIDE THE PROVIDER IT STILL WORKS. The navigation is a component in its own
 * right and is rendered on its own — by its own tests, and by anything that
 * wants a bar without the whole shell around it. A context that answered "closed
 * and cannot be opened" would leave those callers with a menu button that does
 * nothing, which is exactly the defect this shell has been cleaning up.
 *
 * Both hooks are called unconditionally, every render, so the order is fixed;
 * only which value is returned depends on whether a provider is above.
 */
export function useMobileMenu(): MobileMenuValue {
  const shared = useContext(MobileMenuContext);
  const [open, setOpen] = useState(false);
  const local = useMemo(() => ({ open, setOpen }), [open]);
  return shared ?? local;
}
