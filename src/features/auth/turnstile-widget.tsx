"use client";

import * as React from "react";
import { TURNSTILE_SCRIPT_URL, type TurnstileApi } from "@/lib/auth/turnstile";

/**
 * AFD-3A3 — the Cloudflare Turnstile widget for CRM staff login.
 *
 * The token this produces is a CLAIM, not a proof. The CRM forwards it to the
 * backend, which verifies it against Cloudflare's Siteverify endpoint on every
 * submission and fails closed if that verification does not succeed. Nothing
 * here is a security control, and nothing here grants a CRM permission — those
 * come from `GET /api/crm/v1/session` after the backend has authenticated the
 * account, exactly as before.
 *
 * WHAT THE TOKEN NEVER TOUCHES
 * React state, then the JSON body of one request. Never the URL, never
 * `localStorage`, never `sessionStorage`, never a cookie, never `console`.
 * Turnstile tokens are single-use and expire after five minutes, so a persisted
 * one is useless at best and a replay hazard at worst.
 *
 * WHY THE SCRIPT IS LOADED ONCE, GLOBALLY
 * `api.js` registers a global `window.turnstile`. Inserting it twice re-runs
 * that registration and can orphan live widgets, so insertion is keyed on the
 * exact `src` already in the document. The tag is deliberately NOT removed on
 * unmount — `window.turnstile` would remain defined but broken, and a second
 * visit to /login would render nothing.
 *
 * WHAT IS CLEANED UP
 * The widget INSTANCE. `turnstile.remove(id)` on unmount tears down the iframe
 * and its timers; without it, React Strict Mode's double-mount in development
 * leaves a duplicate challenge on the page.
 */

type LoadState = "loading" | "ready" | "failed";

export interface TurnstileWidgetProps {
  siteKey: string;
  /** The action stamped on this challenge. The backend pins it per surface. */
  action: string;
  /** Called with a fresh token whenever the challenge is solved. */
  onToken: (token: string) => void;
  /**
   * Called when the current token is no longer usable — expired, errored, or the
   * interactive challenge timed out. The caller must clear its token.
   */
  onTokenLost: (reason: "expired" | "timeout" | "error") => void;
  /**
   * Bumping this integer resets the widget and issues a new challenge. The form
   * bumps it after any attempt that consumed the token.
   */
  resetSignal: number;
  /** Rendered as a description for assistive technology. */
  describedById?: string;
}

/** Insert `api.js` at most once per document. */
function ensureScript(onReady: () => void, onFailure: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;

  if (window.turnstile) {
    onReady();
    return () => undefined;
  }

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${TURNSTILE_SCRIPT_URL}"]`,
  );
  const script = existing ?? document.createElement("script");
  const load = () => onReady();
  const error = () => onFailure();

  script.addEventListener("load", load);
  script.addEventListener("error", error);

  if (!existing) {
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  return () => {
    script.removeEventListener("load", load);
    script.removeEventListener("error", error);
  };
}

export function TurnstileWidget({
  siteKey,
  action,
  onToken,
  onTokenLost,
  resetSignal,
  describedById,
}: TurnstileWidgetProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>("loading");
  const statusId = React.useId();

  /**
   * The callbacks are held in a ref so the render effect below does not depend
   * on them. Without this, a parent re-render would produce new function
   * identities, tear the widget down and issue a brand-new challenge on every
   * keystroke in the email field.
   */
  const handlers = React.useRef({ onToken, onTokenLost });
  // Written in an effect, not during render: React forbids mutating a ref while
  // rendering, and this runs after every commit, so the ref is current by the
  // time any Turnstile callback can fire.
  React.useEffect(() => {
    handlers.current = { onToken, onTokenLost };
  });

  const markFailed = React.useCallback(() => setLoadState("failed"), []);
  const markReady = React.useCallback(() => setLoadState("ready"), []);

  React.useEffect(() => ensureScript(markReady, markFailed), [markReady, markFailed]);

  React.useEffect(() => {
    if (loadState !== "ready") return;
    const container = containerRef.current;
    const turnstile: TurnstileApi | undefined = window.turnstile;
    if (!container || !turnstile) return;

    let id: string | undefined;
    try {
      id = turnstile.render(container, {
        sitekey: siteKey,
        action,
        callback: (token: string) => handlers.current.onToken(token),
        "error-callback": () => handlers.current.onTokenLost("error"),
        "expired-callback": () => handlers.current.onTokenLost("expired"),
        "timeout-callback": () => handlers.current.onTokenLost("timeout"),
        theme: "auto",
        size: "flexible",
      });
    } catch {
      // A render failure is a challenge the employee cannot solve. Reported as
      // unavailable rather than swallowed, so submission stays blocked.
      //
      // Deferred to a microtask so the state change does not happen
      // synchronously inside the effect body, which would cascade a render.
      queueMicrotask(markFailed);
      return;
    }

    widgetIdRef.current = id ?? null;

    return () => {
      const currentId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (currentId === null) return;
      try {
        turnstile.remove(currentId);
      } catch {
        // Already gone (fast unmount, or the script tore itself down). Nothing
        // to clean up and nothing worth reporting.
      }
    };
    // `resetSignal` is in the dependency list on purpose: a bump remounts the
    // widget, which is the most reliable way to obtain a genuinely fresh
    // challenge across every Turnstile version.
  }, [loadState, siteKey, action, resetSignal, markFailed]);

  if (loadState === "failed") {
    return (
      <div
        role="alert"
        data-testid="turnstile-unavailable"
        className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-text-primary"
      >
        Проверка безопасности не загрузилась. Обновите страницу или повторите позже.
      </div>
    );
  }

  return (
    <div data-testid="turnstile-widget" className="min-w-0">
      <div
        ref={containerRef}
        data-testid="turnstile-container"
        // The widget is a third-party iframe about 300px wide. The container
        // SCROLLS rather than clips: at 390px with the card's padding the frame
        // fits, but a compact viewport, a large text-size preference or the
        // interactive challenge's taller layout must never cut it off — an
        // unreachable checkbox is an employee who cannot sign in.
        className="max-w-full overflow-x-auto"
        aria-describedby={describedById ?? statusId}
      />
      <p id={statusId} role="status" aria-live="polite" className="mt-1 text-2xs text-text-muted">
        {loadState === "loading" ? "Загружается проверка безопасности…" : ""}
      </p>
    </div>
  );
}
