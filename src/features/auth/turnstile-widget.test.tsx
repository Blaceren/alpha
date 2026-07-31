/**
 * AFD-3A2 — the Turnstile widget contract.
 *
 * The iframe itself is Cloudflare's and cannot be rendered in jsdom. What this
 * suite pins is everything the Academy actually owns around it: the script is
 * inserted once, the widget renders with the right options, every
 * token-destroying callback is wired, a reset issues a genuinely new challenge,
 * the instance is removed on unmount, and no token is ever persisted anywhere a
 * later request could replay it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TurnstileWidget } from "@/features/auth/turnstile-widget";
import {
  TURNSTILE_ORIGIN,
  TURNSTILE_REGISTER_ACTION,
  TURNSTILE_SCRIPT_URL,
} from "@/lib/auth/turnstile";
import {
  installTurnstileDouble,
  resetTurnstileDouble,
  DUMMY_TOKEN,
  TEST_SITE_KEY,
  type TurnstileDouble,
} from "@/test/turnstile-double";

let turnstile: TurnstileDouble;

function scriptTags() {
  return Array.from(document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`));
}

beforeEach(() => {
  turnstile = installTurnstileDouble({ autoSolve: false });
});

afterEach(() => {
  resetTurnstileDouble();
  vi.restoreAllMocks();
});

describe("TurnstileWidget — script loading", () => {
  it("renders without inserting a second script when the API is already present", async () => {
    render(
      <TurnstileWidget
        siteKey={TEST_SITE_KEY}
        onToken={vi.fn()}
        onTokenLost={vi.fn()}
        resetSignal={0}
      />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    expect(scriptTags()).toHaveLength(0);
  });

  it("inserts the official script exactly once when the API is absent", async () => {
    turnstile.uninstall();

    const first = render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    await waitFor(() => expect(scriptTags()).toHaveLength(1));
    const tag = scriptTags()[0] as HTMLScriptElement;
    expect(tag.src).toBe(TURNSTILE_SCRIPT_URL);
    expect(tag.src.startsWith(`${TURNSTILE_ORIGIN}/`)).toBe(true);
    expect(tag.async).toBe(true);

    // Unmounting must NOT remove the tag: `window.turnstile` would stay defined
    // but broken, and a second visit to /register would render nothing.
    first.unmount();
    expect(scriptTags()).toHaveLength(1);
  });

  it("shows an unavailable state, not a silent pass, when the script fails", async () => {
    turnstile.uninstall();
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    const tag = await waitFor(() => {
      const found = scriptTags()[0];
      if (!found) throw new Error("script not inserted");
      return found;
    });
    tag.dispatchEvent(new Event("error"));

    expect(await screen.findByTestId("turnstile-unavailable")).toBeInTheDocument();
  });

  it("reports a render failure as unavailable", async () => {
    resetTurnstileDouble();
    installTurnstileDouble({ throwOnRender: true });

    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    expect(await screen.findByTestId("turnstile-unavailable")).toBeInTheDocument();
  });
});

describe("TurnstileWidget — render options", () => {
  it("passes the runtime site key and the documented action", async () => {
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    const options = turnstile.latest();
    expect(options.sitekey).toBe(TEST_SITE_KEY);
    expect(options.action).toBe(TURNSTILE_REGISTER_ACTION);
  });

  it("wires every token-destroying callback, not only success", async () => {
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    const options = turnstile.latest();
    // Omitting any of these leaves a dead token in the form's state, and the
    // user submits a challenge that expired minutes ago.
    expect(typeof options.callback).toBe("function");
    expect(typeof options["error-callback"]).toBe("function");
    expect(typeof options["expired-callback"]).toBe("function");
    expect(typeof options["timeout-callback"]).toBe("function");
  });
});

describe("TurnstileWidget — token lifecycle", () => {
  it("hands a solved token to the caller", async () => {
    const onToken = vi.fn();
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={onToken} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    await turnstile.solve();

    expect(onToken).toHaveBeenCalledWith(DUMMY_TOKEN);
  });

  it.each([
    ["expired", () => turnstile.expire()],
    ["timeout", () => turnstile.timeout()],
    ["error", () => turnstile.fail("network-error")],
  ])("reports a %s token as lost", async (reason, drive) => {
    const onTokenLost = vi.fn();
    render(
      <TurnstileWidget
        siteKey={TEST_SITE_KEY}
        onToken={vi.fn()}
        onTokenLost={onTokenLost}
        resetSignal={0}
      />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    await drive();

    expect(onTokenLost).toHaveBeenCalledWith(reason);
  });

  it("does not re-render the widget when only the callbacks change identity", async () => {
    const view = render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    // A parent re-render produces fresh function identities. If the effect
    // depended on them, every keystroke in the email field would tear down the
    // challenge and issue a new one.
    view.rerender(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    expect(turnstile.renders).toHaveLength(1);
  });

  it("issues a fresh challenge when the reset signal is bumped", async () => {
    const view = render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    view.rerender(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={1} />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    // The old instance is torn down, so exactly one challenge is on the page.
    expect(turnstile.removed).toContain("widget-1");
    expect(turnstile.liveWidgets()).toEqual(["widget-2"]);
  });

  it("removes its widget instance on unmount", async () => {
    const view = render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    view.unmount();

    expect(turnstile.removed).toEqual(["widget-1"]);
    expect(turnstile.liveWidgets()).toEqual([]);
  });
});

describe("TurnstileWidget — token never escapes memory", () => {
  it("writes the token to no URL, storage, cookie or log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    await turnstile.solve();

    expect(window.location.href).not.toContain(DUMMY_TOKEN);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(DUMMY_TOKEN);
    expect(document.body.innerHTML).not.toContain(DUMMY_TOKEN);
    for (const spy of [log, error, warn]) {
      const emitted = spy.mock.calls.flat().map(String).join(" ");
      expect(emitted).not.toContain(DUMMY_TOKEN);
    }
  });
});

describe("TurnstileWidget — accessibility", () => {
  it("announces loading through a live region", () => {
    turnstile.uninstall();
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Загружается проверка безопасности");
  });

  it("announces an unavailable challenge assertively", async () => {
    resetTurnstileDouble();
    installTurnstileDouble({ throwOnRender: true });
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    // `role="alert"` so a screen-reader user is told the challenge is broken
    // rather than left waiting for a widget that will never appear.
    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-testid",
      "turnstile-unavailable",
    );
  });
});
