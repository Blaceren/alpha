"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { TURNSTILE_SCRIPT_URL, type TurnstileApi } from "@/lib/auth/turnstile";

/**
 * AFD-3A2 — the Cloudflare Turnstile widget.
 *
 * The token this produces is a CLAIM, not a proof. The Backend verifies it
 * against Cloudflare's Siteverify endpoint on every submission and fails closed
 * if that verification does not succeed. Nothing here is a security control.
 *
 * WHAT THE TOKEN NEVER TOUCHES
 * It is held in React state, handed to the caller, and posted in the JSON body
 * of one request. It is never written to the URL, `localStorage`,
 * `sessionStorage`, a cookie, a hidden form field that survives navigation, an
 * analytics call, or `console`. Turnstile tokens are single-use and expire after
 * five minutes, so a persisted one is useless at best and a replay hazard at
 * worst.
 *
 * WHY THE SCRIPT IS LOADED ONCE, GLOBALLY
 * `api.js` registers a global `window.turnstile`. Inserting it twice re-runs
 * that registration and can orphan live widgets, so insertion is keyed on the
 * exact `src` already in the document. The tag is deliberately NOT removed on
 * unmount — `window.turnstile` would remain defined but broken, and a second
 * visit to /register would render nothing.
 *
 * WHAT IS CLEANED UP
 * The widget INSTANCE. `turnstile.remove(id)` on unmount tears down the iframe
 * and its timers; without it, React Strict Mode's double-mount in development
 * leaves a duplicate challenge on the page.
 */

type LoadState = "loading" | "ready" | "failed";

export type TurnstileWidgetProps = {
  siteKey: string;
  /**
   * The action stamped on this challenge (AFD-3A3). Supplied by the form rather
   * than fixed here, because the widget is shared by registration and login and
   * the Backend refuses a token whose action does not match the surface it
   * arrived at. See `src/lib/auth/turnstile.ts` for the two values.
   */
  action: string;
  /** Called with a fresh token whenever the challenge is solved. */
  onToken: (token: string) => void;
  /**
   * Called when the current token is no longer usable — expired, errored, or
   * the interactive challenge timed out. The caller must clear its token.
   */
  onTokenLost: (reason: "expired" | "timeout" | "error") => void;
  /**
   * Bumping this integer resets the widget and issues a new challenge. The form
   * bumps it after any server-side failure that consumed the token.
   */
  resetSignal: number;
  /** Rendered as a description for assistive technology. */
  describedById?: string;
};

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  /*
   * A CHALLENGE THAT FAILED IS NOT THE SAME AS ONE STILL LOADING.
   *
   * `loadState` answers whether the widget could be put on the page at all —
   * a missing script, a render that threw. It says nothing about a challenge
   * that rendered and then failed, because Cloudflare reports that through
   * `error-callback`, which only cleared the token. The result was a form whose
   * submit went quiet with no message, no announcement and nothing to tell the
   * two situations apart: pending and failed looked and read identically.
   *
   * This is that missing fact, and it lives here rather than in the forms
   * because both forms already delegate the whole challenge to this component.
   * Nothing about the token, the callbacks, the site key or the verification
   * changes — the widget simply says what happened.
   */
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  /*
   * Held as "which attempt failed" rather than a bare boolean, so that a
   * deliberately renewed challenge is clean without an effect to clear it: a
   * bumped `resetSignal` no longer matches, and the message is simply gone.
   */
  const challengeFailed = failedAttempt === resetSignal;
  const statusId = useId();

  /**
   * The callbacks are held in a ref so the render effect below does not depend
   * on them. Without this, a parent re-render would produce new function
   * identities, tear the widget down and issue a brand-new challenge on every
   * keystroke in the email field.
   */
  const handlers = useRef({ onToken, onTokenLost });
  // Written in an effect, not during render: React forbids mutating a ref while
  // rendering, and this runs after every commit, so the ref is current by the
  // time any Turnstile callback can fire.
  useEffect(() => {
    handlers.current = { onToken, onTokenLost };
  });

  const markFailed = useCallback(() => setLoadState("failed"), []);
  const markReady = useCallback(() => setLoadState("ready"), []);

  useEffect(() => ensureScript(markReady, markFailed), [markReady, markFailed]);

  useEffect(() => {
    if (loadState !== "ready") return;
    const container = containerRef.current;
    const turnstile: TurnstileApi | undefined = window.turnstile;
    if (!container || !turnstile) return;

    let id: string | undefined;
    try {
      id = turnstile.render(container, {
        sitekey: siteKey,
        action,
        callback: (token: string) => {
          // A solved challenge retracts a previous failure. Clearing it here,
          // on the success path, is what makes recovery visible: the message
          // goes, and the submit control comes back with it.
          setFailedAttempt(null);
          handlers.current.onToken(token);
        },
        "error-callback": () => {
          setFailedAttempt(resetSignal);
          handlers.current.onTokenLost("error");
        },
        "expired-callback": () => handlers.current.onTokenLost("expired"),
        "timeout-callback": () => {
          // A challenge that ran out of time did not succeed, and the visitor
          // has exactly the same symptom as an outright error: a submit control
          // that will not move. It gets the same explanation.
          setFailedAttempt(resetSignal);
          handlers.current.onTokenLost("timeout");
        },
        theme: "auto",
        size: "flexible",
      });
    } catch {
      // A render failure is a challenge the visitor cannot solve. Reported as
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
        className="auth-captcha auth-captcha--failed"
        data-testid="turnstile-unavailable"
        role="alert"
      >
        Проверка безопасности не загрузилась. Обновите страницу или повторите позже.
      </div>
    );
  }

  return (
    <div className="auth-captcha" data-testid="turnstile-widget">
      <div
        ref={containerRef}
        className="auth-captcha__frame"
        data-testid="turnstile-container"
        aria-describedby={describedById ?? statusId}
      />
      <p id={statusId} className="auth-captcha__status" role="status" aria-live="polite">
        {loadState === "loading" ? "Загружается проверка безопасности…" : ""}
      </p>
      {/*
        Rendered only while a challenge has actually failed, so nothing is
        announced on the first render and the transition announces exactly once.
        `role="alert"` because the submit control has just gone unavailable and
        the reason is not otherwise on screen.
      */}
      {challengeFailed ? (
        <p className="auth-captcha__failure" data-testid="turnstile-challenge-failed" role="alert">
          Проверка безопасности не выполнена. Попробуйте ещё раз.
        </p>
      ) : null}
    </div>
  );
}
