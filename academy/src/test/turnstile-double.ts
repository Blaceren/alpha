/**
 * A test double for `window.turnstile` (AFD-3A2).
 *
 * The real widget is a cross-origin iframe served by Cloudflare, so jsdom can
 * never render it. What the Academy actually owns is the CONTRACT around it:
 * render once, hand the token to the form, clear it on expiry/timeout/error,
 * reset after a consumed failure, and remove the instance on unmount. This
 * double implements exactly that surface so those behaviours can be driven
 * deterministically.
 *
 * It uses Cloudflare's PUBLISHED test site key, which is documentation, not a
 * credential. No SECRET of any kind appears here — the secret lives only in the
 * Backend and is never readable from this package.
 */
import { act } from "@testing-library/react";
import type { TurnstileRenderOptions } from "@/lib/auth/turnstile";

/** Cloudflare's published "always passes / visible" test site key. */
export const TEST_SITE_KEY = "1x00000000000000000000AA";

/** Cloudflare's published "always fails / visible" test site key. */
export const FAILING_TEST_SITE_KEY = "2x00000000000000000000AB";

/** Dummy tokens minted by test site keys have this documented shape. */
export const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export type TurnstileDouble = {
  /** Options passed to every `render` call, oldest first. */
  readonly renders: TurnstileRenderOptions[];
  /** Widget ids passed to `remove`, in order. */
  readonly removed: string[];
  /** Widget ids passed to `reset`, in order. */
  readonly reset: string[];
  /** Live widget ids that have not been removed. */
  liveWidgets(): string[];
  /** Options of the most recent render. Throws when nothing has rendered. */
  latest(): TurnstileRenderOptions;
  /** Drive the success callback of the most recent widget. */
  solve(token?: string): Promise<void>;
  /** Drive `expired-callback` on the most recent widget. */
  expire(): Promise<void>;
  /** Drive `timeout-callback` on the most recent widget. */
  timeout(): Promise<void>;
  /** Drive `error-callback` on the most recent widget. */
  fail(code?: string): Promise<void>;
  /** Remove `window.turnstile` so the "script never loaded" path can be tested. */
  uninstall(): void;
};

export type InstallOptions = {
  /**
   * Solve the challenge as soon as it renders. Defaults to `true` so the many
   * tests that only care about form behaviour do not each have to re-solve it.
   */
  autoSolve?: boolean;
  /** Make `render` throw, standing in for a widget that cannot initialise. */
  throwOnRender?: boolean;
};

export function installTurnstileDouble(options: InstallOptions = {}): TurnstileDouble {
  const autoSolve = options.autoSolve ?? true;
  const renders: TurnstileRenderOptions[] = [];
  const removed: string[] = [];
  const reset: string[] = [];
  const byId = new Map<string, TurnstileRenderOptions>();
  let counter = 0;

  const latest = (): TurnstileRenderOptions => {
    const last = renders[renders.length - 1];
    if (!last) throw new Error("turnstile.render was never called");
    return last;
  };

  // Every callback runs inside `act` so React state updates are flushed before
  // the assertion that follows, exactly as they would be in a browser.
  const drive = async (fn: () => void) => {
    await act(async () => {
      fn();
      await Promise.resolve();
    });
  };

  window.turnstile = {
    render(_container: HTMLElement, opts: TurnstileRenderOptions) {
      if (options.throwOnRender) throw new Error("render failed");
      counter += 1;
      const id = `widget-${counter}`;
      renders.push(opts);
      byId.set(id, opts);
      if (autoSolve) {
        // Asynchronous, like a real challenge: the token never exists during
        // the render pass itself.
        queueMicrotask(() => {
          void drive(() => opts.callback(DUMMY_TOKEN));
        });
      }
      return id;
    },
    reset(widgetId?: string) {
      if (widgetId) reset.push(widgetId);
    },
    remove(widgetId?: string) {
      if (widgetId) {
        removed.push(widgetId);
        byId.delete(widgetId);
      }
    },
  };

  return {
    renders,
    removed,
    reset,
    liveWidgets: () => [...byId.keys()],
    latest,
    solve: (token = DUMMY_TOKEN) => drive(() => latest().callback(token)),
    expire: () => drive(() => latest()["expired-callback"]()),
    timeout: () => drive(() => latest()["timeout-callback"]()),
    fail: (code?: string) => drive(() => latest()["error-callback"](code)),
    uninstall: () => {
      delete window.turnstile;
    },
  };
}

/** Remove the double and any script tag it caused to be inserted. */
export function resetTurnstileDouble(): void {
  delete window.turnstile;
  document
    .querySelectorAll('script[src^="https://challenges.cloudflare.com"]')
    .forEach((node) => node.remove());
}
