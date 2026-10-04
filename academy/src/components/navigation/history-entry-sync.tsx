"use client";

/**
 * BACK SHOWS THE SCREEN WHOSE ADDRESS IS IN THE BAR.
 *
 * THE BUG (owner, 2026-10-02). On the public home press «Практика и обратная
 * связь» — the address becomes `/#review`. Press «Войти» — `/login`. Press the
 * browser's Back: the address goes back to `/#review` and the screen stays on
 * the sign-in page. The same with every other section link, and — found while
 * looking — with a lesson's table of contents and with «Перейти к содержимому»
 * on every page of the product.
 *
 * WHY. A link to a place on the same page — `<a href="#review">` — is followed
 * by the BROWSER, not by the router: it adds an entry to the history, and that
 * entry carries no state (`history.state === null`). The router keeps what it
 * needs to restore a page in the entry's state; coming back to an entry without
 * one, it does nothing at all (`app-router.js`: «this case only happens when
 * pushState/replaceState was called outside of Next.js … return»). So the
 * address changes — the browser does that — and the screen does not.
 *
 * WHAT THIS DOES. It makes sure no entry of this document stays without the
 * router's state:
 *
 *   an in-page link was followed     the entry is handed to the router the way
 *   (same page, another fragment)    the framework documents — one
 *                                    `history.replaceState` with the same
 *                                    address; the router takes the address and
 *                                    writes its own state into the entry. No
 *                                    request, no scroll, nothing re-mounted.
 *
 *   Back or Forward arrived at an    the router is asked to show that address
 *   entry nobody handed over, and    (`router.replace`). This is the net under
 *   the screen is another page       the first case: an entry made before the
 *                                    page came alive, or one a browser made
 *                                    without telling.
 *
 * WHAT IT DOES NOT DO. It does not follow links, does not scroll, and does not
 * touch an entry that already has a state — the router's own, or one a page
 * wrote for itself (the reset link's token is taken out of the address by its
 * own page; this waits a turn so that such a page goes first).
 *
 * The in-page links themselves stay plain `<a href="#…">`: they work before the
 * page comes alive and without scripts at all, and the browser scrolls to them
 * in its own way. Only the bookkeeping is done here.
 *
 * It renders nothing.
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Two query strings that say the same thing, however they are written. */
function sameSearch(a: string, b: string): boolean {
  return new URLSearchParams(a).toString() === new URLSearchParams(b).toString();
}

export function HistoryEntrySync() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  /** The page the router has on screen. Read by the listeners, written after every commit. */
  const shown = useRef({ pathname, search });
  useEffect(() => {
    shown.current = { pathname, search };
  }, [pathname, search]);

  useEffect(() => {
    let timer: number | undefined;
    /** The address the router was last asked to show; one traversal asks once. */
    let asked: string | null = null;

    const sync = () => {
      timer = undefined;
      // The router's entry, or a page's own: it has a state, and it is not ours to touch.
      if (window.history.state !== null) return;

      const { pathname: path, search: query, hash } = window.location;
      const address = path + query + hash;

      if (path === shown.current.pathname && sameSearch(query, shown.current.search)) {
        // The same page: an in-page link was followed. Handing the entry over
        // is one documented call — the router takes the address and stamps the
        // entry with its own state.
        window.history.replaceState(null, "", address);
        return;
      }

      // Another page's entry, reached by Back or Forward, that the router never
      // saw: the address is right and the screen is not.
      if (asked === address) return;
      asked = address;
      router.replace(address);
    };

    /* Both events are listened to, and neither is acted on at once: `popstate`
       comes first and `hashchange` after it, and a page that reads the fragment
       for itself (the reset link) does so on `hashchange`. One turn later the
       page has had its say, and the two events have become one piece of work. */
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(sync, 0);
    };
    const onPopState = () => {
      asked = null;
      schedule();
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", schedule);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", schedule);
    };
  }, [router]);

  return null;
}
