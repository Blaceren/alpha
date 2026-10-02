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
 *
 * WHAT THE VISITOR SEES (owner, 2026-10-02: «окно капчи слишком выделяется и не
 * соответствует нам»). Cloudflare's box is a third-party frame: its grey ground,
 * its own type and its logo cannot be restyled, and it used to stand in the
 * form on every visit — white on a light-theme system, because the theme was
 * left to the visitor's OS on a page that is dark-only. Three things changed,
 * all of them options Cloudflare documents:
 *
 *   appearance: "interaction-only"  the box is drawn ONLY when the visitor has
 *                                   to do something; the check itself runs as
 *                                   before, unseen
 *   theme: "dark"                   the page has one theme, so the box has it too
 *   the two interactive callbacks   so this component knows when the box is up
 *
 * What stands in the form instead is ONE LINE in the page's own hand, where the
 * box used to be: «Проверяем браузер…», then «Браузер проверен». If Cloudflare
 * does ask for a press, the line says so — in its own words, not the box's,
 * which says «Подтвердите, что вы человек» itself — and the box appears under
 * it, inside the form's own frame. Nothing about the token, the action, the verification
 * or the callbacks that destroy a token has changed.
 *
 * THE BOX'S CONTAINER IS NEVER `display: none`. While it has nothing to ask,
 * Turnstile keeps its iframe rendered by itself — a single fixed pixel — and
 * that is how the check runs unseen. Our frame around it is zero high and stays
 * in the page (`auth-stage.css`); taking it out of the page would stop the
 * iframe being rendered, which a stand with test keys cannot show and a real
 * challenge may not survive.
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
  const [failedAttempt, setFailedAttempt] = useState<string | null>(null);
  /*
   * THE VISITOR'S OWN RETRY. While Cloudflare's box stood in the form, a failed
   * challenge could be pressed again in the box itself. The box is no longer
   * drawn unless it has something to ask, so a failure would be a dead end:
   * «Попробуйте ещё раз» with nothing to try. «Повторить проверку» bumps this
   * count, which — like the form's `resetSignal` — remounts the widget and
   * issues a brand-new challenge.
   */
  const [retry, setRetry] = useState(0);
  /** One challenge: the form's reset count and the visitor's retry count together. */
  const attempt = `${resetSignal}/${retry}`;
  /*
   * Held as "which attempt failed" rather than a bare boolean, so that a
   * deliberately renewed challenge is clean without an effect to clear it: a
   * new attempt no longer matches, and the message is simply gone.
   */
  const challengeFailed = failedAttempt === attempt;
  const statusId = useId();
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  /*
   * AFTER A RETRY THE FOCUS GOES TO THE LINE — but only once the line is there
   * to take it. At the moment of the press the challenge is still «failed», the
   * line is empty, and an empty line takes no room (`:empty { display: none }`),
   * so focusing it then does nothing and the keyboard falls back to the top of
   * the page with the button that just left. The flag is read after the render
   * that follows, when the line says «Проверяем браузер…».
   */
  const focusLineNext = useRef(false);
  useEffect(() => {
    if (!focusLineNext.current) return;
    focusLineNext.current = false;
    statusRef.current?.focus();
  });
  /*
   * WHICH ATTEMPT WAS SOLVED, AND WHICH ONE IS ASKING FOR A PRESS — held, like
   * the failure, as the attempt they belong to: a renewed challenge starts
   * clean without an effect to reset them.
   */
  const [solvedAttempt, setSolvedAttempt] = useState<string | null>(null);
  const [interactiveAttempt, setInteractiveAttempt] = useState<string | null>(null);
  const solved = solvedAttempt === attempt;
  const interactive = interactiveAttempt === attempt && !solved;
  /*
   * THE BOX, ONCE UP, STAYS UP FOR THAT CHECK. Cloudflare leaves its own
   * «Успешно» in the box after a press and keeps the iframe laid out; closing
   * our frame over it would pull the form up from under the visitor's pointer
   * and hide an iframe that is still alive (it renews its own token later). A
   * new check starts with the frame closed again. A check that has failed
   * closes it too: the message under the line is then the only voice.
   */
  const [boxAttempt, setBoxAttempt] = useState<string | null>(null);
  const boxUp = boxAttempt === attempt && !challengeFailed;

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
          setSolvedAttempt(attempt);
          setInteractiveAttempt(null);
          handlers.current.onToken(token);
        },
        "error-callback": () => {
          setFailedAttempt(attempt);
          setSolvedAttempt(null);
          handlers.current.onTokenLost("error");
        },
        "expired-callback": () => {
          // The token lapsed; Turnstile runs the check again by itself, so the
          // line goes back to «Проверяем…» rather than claiming a pass.
          setSolvedAttempt(null);
          handlers.current.onTokenLost("expired");
        },
        "timeout-callback": () => {
          // A challenge that ran out of time did not succeed, and the visitor
          // has exactly the same symptom as an outright error: a submit control
          // that will not move. It gets the same explanation.
          setFailedAttempt(attempt);
          setSolvedAttempt(null);
          handlers.current.onTokenLost("timeout");
        },
        "before-interactive-callback": () => {
          // A check that asks for a press is alive: if it had failed and
          // Turnstile tried again by itself, the failure is withdrawn — the
          // visitor is shown the box, not a message over a hidden one.
          setFailedAttempt(null);
          setInteractiveAttempt(attempt);
          setBoxAttempt(attempt);
        },
        "after-interactive-callback": () => setInteractiveAttempt(null),
        // The page is dark-only: «auto» drew a white box for every visitor
        // whose system is set to light.
        theme: "dark",
        size: "flexible",
        // Drawn only when the visitor has to do something.
        appearance: "interaction-only",
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
    // `attempt` — the form's `resetSignal` and the visitor's own retry — is in
    // the dependency list on purpose: a new attempt remounts the widget, which
    // is the most reliable way to obtain a genuinely fresh challenge across
    // every Turnstile version.
  }, [loadState, siteKey, action, attempt, markFailed]);

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

  /*
   * ONE LINE, FOUR THINGS IT CAN SAY. While a challenge has failed it says
   * nothing: the alert below is the message, and a second voice saying
   * «проверяем» over it would make the failure read as still pending.
   */
  const phase = challengeFailed
    ? "failed"
    : loadState === "loading"
      ? "loading"
      : solved
        ? "passed"
        : interactive
          ? "interactive"
          : "checking";
  const line =
    phase === "loading"
      ? "Загружается проверка безопасности…"
      : phase === "checking"
        ? "Проверяем браузер…"
        : phase === "interactive"
          ? "Нужно подтверждение: отметьте поле ниже."
          : phase === "passed"
            ? "Браузер проверен."
            : "";

  return (
    <div className="auth-captcha" data-testid="turnstile-widget" data-phase={phase}>
      <p
        ref={statusRef}
        id={describedById ?? statusId}
        className="auth-captcha__status"
        role="status"
        aria-live="polite"
        // Takes the focus after «Повторить проверку», whose button leaves the page.
        tabIndex={-1}
      >
        {line}
      </p>
      {/* Cloudflare's own frame. It takes no room unless the challenge asks
          the visitor for a press — and it is always in the page (see above). */}
      <div className="auth-captcha__frame" data-shown={boxUp || undefined}>
        <div ref={containerRef} className="auth-captcha__widget" data-testid="turnstile-container" />
      </div>
      {/*
        Rendered only while a challenge has actually failed, so nothing is
        announced on the first render and the transition announces exactly once.
        `role="alert"` because the submit control has just gone unavailable and
        the reason is not otherwise on screen.
      */}
      {challengeFailed ? (
        <div className="auth-captcha__failure" data-testid="turnstile-challenge-failed" role="alert">
          {/* «Попробуйте ещё раз» used to end this sentence; the button under
              it now says how. */}
          <span>Проверка безопасности не выполнена.</span>
          <button
            type="button"
            className="auth-captcha__retry"
            onClick={() => {
              // The button is about to leave the page with the message; the
              // line that will say «Проверяем браузер…» takes the focus.
              focusLineNext.current = true;
              setRetry((count) => count + 1);
            }}
          >
            Повторить проверку
          </button>
        </div>
      ) : null}
    </div>
  );
}
