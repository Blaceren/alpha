"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import "./navigation-progress.css";

/** Past this the bar gives up on its own, whatever happened to the navigation. */
const GIVE_UP_MS = 15_000;

/**
 * THE PAGE IS ON ITS WAY (2026-10-04, launch audit).
 *
 * The App Router holds the current page until the next one is ready — on
 * purpose: the group's loading boundary that blanked the shell is gone (see
 * `navigation-transition.test.ts`). What was missing is any sign that the click
 * was taken: up to the Backend's 10-second timeout the old page simply stayed,
 * and learners clicked again. A thin line now runs across the top of the
 * window from an internal link's click until the address changes.
 *
 * It replaces nothing and hides nothing: the current page and its shell stay
 * exactly as they were. The state is derived — the bar is lit while the address
 * is still the one the click left from — so no effect has to switch it off.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const here = `${pathname}?${search}`;
  const hereRef = useRef(here);
  const [leftFrom, setLeftFrom] = useState<string | null>(null);

  useEffect(() => {
    hereRef.current = here;
  }, [here]);

  useEffect(() => {
    /* The capture phase sees the click before a <Link> takes it over. */
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // The same page, or only its #fragment: nothing is loading.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setLeftFrom(hereRef.current);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const active = leftFrom !== null && leftFrom === here;

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setLeftFrom(null), GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  return <div className="nav-progress" data-active={active ? "true" : "false"} aria-hidden="true" />;
}
