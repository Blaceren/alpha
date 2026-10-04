"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/features/auth/use-session";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "@/lib/auth/return-to";
import "./session-states.css";

/** Where «Войти снова» leads: the login page, and back to this very page after it. */
export function loginAgainHref(pathWithSearch: string | null): string {
  const next = sanitizeReturnTo(pathWithSearch);
  return next === DEFAULT_RETURN_TO ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

/** A call to the Academy's own Backend proxy (`/api/backend/…`) on this origin. */
export function isBackendProxyCall(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/backend/");
  } catch {
    return false;
  }
}

/**
 * ANY 401 FROM THE BACKEND ENDS THE SESSION ON SCREEN (2026-10-04, launch
 * audit).
 *
 * The session machine has had an `expire` all along and nothing called it:
 * every screen met the 401 on its own and said so in its own words («Требуется
 * вход», «Сессия закончилась. Войдите снова…», a generic failure) with no way
 * back to the login. The clients are many — tools, the test, the report,
 * support, the profile — and all of them reach the Backend through the
 * same-origin proxy, so this watches that one prefix instead of asking each
 * client to report. Responses pass through untouched: each screen still shows
 * its own state, and the notice is added on top. The provider itself is frozen
 * with the authenticating half, so this sits beside it, inside it.
 */
export function SessionExpiryWatch() {
  const { state, expire } = useSession();

  useEffect(() => {
    if (typeof window.fetch !== "function") return;
    const original = window.fetch;
    const observed: typeof window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (response.status === 401 && isBackendProxyCall(input)) expire();
      return response;
    };
    window.fetch = observed;
    return () => {
      if (window.fetch === observed) window.fetch = original;
    };
  }, [expire]);

  return state.status === "EXPIRED" ? <SessionExpiredNotice /> : null;
}

/**
 * The one way back. It never renders on the server — the expired state only
 * exists after a request made in the browser — so the address it returns to is
 * read from the window once.
 */
export function SessionExpiredNotice() {
  const [href] = useState(() =>
    loginAgainHref(typeof window === "undefined" ? null : window.location.pathname + window.location.search),
  );
  return (
    <div className="session-expired" role="alert">
      <p className="session-expired__title">Сеанс завершён</p>
      <p className="session-expired__text">Войдите снова — после входа откроется эта же страница.</p>
      <a className="session-expired__cta" href={href}>
        Войти снова
      </a>
    </div>
  );
}
