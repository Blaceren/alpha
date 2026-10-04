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
import userEvent from "@testing-library/user-event";
import { TurnstileWidget } from "@/features/auth/turnstile-widget";
import {
  TURNSTILE_ORIGIN,
  TURNSTILE_REGISTER_ACTION,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_LOGIN_ACTION,
} from "@/lib/auth/turnstile";

/**
 * AFD-3A3 made the action a prop, because the widget is now shared by
 * registration and login and the Backend refuses a token whose action does not
 * match the surface it arrived at. These cases are about the widget LIFECYCLE,
 * which is identical either way, so they pin one action and a dedicated case
 * below proves the prop is honoured rather than ignored.
 */
const WIDGET_ACTION = TURNSTILE_REGISTER_ACTION;
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
        action={WIDGET_ACTION}
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
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
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
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
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
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    expect(await screen.findByTestId("turnstile-unavailable")).toBeInTheDocument();
  });
});

describe("TurnstileWidget — render options", () => {
  it("passes the runtime site key and the documented action", async () => {
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    const options = turnstile.latest();
    expect(options.sitekey).toBe(TEST_SITE_KEY);
    expect(options.action).toBe(TURNSTILE_REGISTER_ACTION);
  });

  it("asks Cloudflare to draw its box only when the visitor has to do something, in the page's one theme", async () => {
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    const options = turnstile.latest();
    // Owner, 2026-10-02: the box stood in the form on every visit, and white
    // on a system set to light — on a page that is dark-only.
    expect(options.appearance).toBe("interaction-only");
    expect(options.theme).toBe("dark");
    expect(options.size).toBe("flexible");
    expect(typeof options["before-interactive-callback"]).toBe("function");
    expect(typeof options["after-interactive-callback"]).toBe("function");
  });

  it("wires every token-destroying callback, not only success", async () => {
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
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
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={onToken} onTokenLost={vi.fn()} resetSignal={0} />,
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
        action={WIDGET_ACTION}
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
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    // A parent re-render produces fresh function identities. If the effect
    // depended on them, every keystroke in the email field would tear down the
    // challenge and issue a new one.
    view.rerender(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    expect(turnstile.renders).toHaveLength(1);
  });

  it("issues a fresh challenge when the reset signal is bumped", async () => {
    const view = render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    view.rerender(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={1} />,
    );

    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    // The old instance is torn down, so exactly one challenge is on the page.
    expect(turnstile.removed).toContain("widget-1");
    expect(turnstile.liveWidgets()).toEqual(["widget-2"]);
  });

  it("removes its widget instance on unmount", async () => {
    const view = render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
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
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
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
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Загружается проверка безопасности");
  });

  it("announces an unavailable challenge assertively", async () => {
    resetTurnstileDouble();
    installTurnstileDouble({ throwOnRender: true });
    render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={0} />,
    );

    // `role="alert"` so a screen-reader user is told the challenge is broken
    // rather than left waiting for a widget that will never appear.
    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-testid",
      "turnstile-unavailable",
    );
  });
});

describe("TurnstileWidget — the action is caller-owned (AFD-3A3)", () => {
  it("stamps exactly the action it was given, and re-renders when it changes", async () => {
    const view = render(
      <TurnstileWidget
        siteKey={TEST_SITE_KEY}
        action={TURNSTILE_REGISTER_ACTION}
        onToken={vi.fn()}
        onTokenLost={vi.fn()}
        resetSignal={0}
      />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    expect(turnstile.latest().action).toBe("academy_register");

    // A form that changes surface must not keep challenging under the old
    // action — the Backend would reject every token it produced.
    view.rerender(
      <TurnstileWidget
        siteKey={TEST_SITE_KEY}
        action={TURNSTILE_LOGIN_ACTION}
        onToken={vi.fn()}
        onTokenLost={vi.fn()}
        resetSignal={0}
      />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    expect(turnstile.latest().action).toBe("academy_login");
  });

  it("keeps the two actions distinct", () => {
    expect(TURNSTILE_REGISTER_ACTION).not.toBe(TURNSTILE_LOGIN_ACTION);
  });
});

/**
 * TFU-1 — a failed challenge must be distinguishable from a pending one.
 *
 * The frames that prompted this suite showed a page where "still loading" and
 * "failed" were the same picture: an empty status line and a submit control
 * that would not move, with nothing on screen or in the accessibility tree to
 * say which was which. These cases pin the difference.
 */
describe("TurnstileWidget — a failed challenge is legible", () => {
  const FAILURE_TEXT = "Проверка безопасности не выполнена.";

  async function mounted(props: Partial<{ onToken: () => void; onTokenLost: () => void }> = {}) {
    const view = render(
      <TurnstileWidget
        siteKey={TEST_SITE_KEY}
        action={WIDGET_ACTION}
        onToken={props.onToken ?? vi.fn()}
        onTokenLost={props.onTokenLost ?? vi.fn()}
        resetSignal={0}
      />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    return view;
  }

  it("says nothing on the first render", async () => {
    await mounted();

    // An alert on mount would be announced to every visitor who has done
    // nothing wrong, and would cry wolf by the time it mattered.
    expect(screen.queryByTestId("turnstile-challenge-failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the failure in words, exactly once, when the challenge errors", async () => {
    await mounted();

    await turnstile.fail("network-error");

    const alert = await screen.findByTestId("turnstile-challenge-failed");
    expect(alert).toHaveTextContent(FAILURE_TEXT);
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.getAllByTestId("turnstile-challenge-failed")).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("does not disguise the failure as loading", async () => {
    await mounted();
    await turnstile.fail("network-error");

    // The polite status line is what says "loading". If the failure were routed
    // through it, the two states would read identically again — which is the
    // defect this suite exists to prevent.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");
    expect(status).not.toHaveTextContent(FAILURE_TEXT);
    expect(screen.getByTestId("turnstile-challenge-failed")).not.toBe(status);
  });

  it("treats a timed-out challenge as a failure and an expired token as a lapse", async () => {
    const view = await mounted();
    await turnstile.timeout();
    expect(await screen.findByTestId("turnstile-challenge-failed")).toBeInTheDocument();
    view.unmount();

    // Expiry is different in kind: the challenge DID succeed, and Turnstile
    // refreshes it on its own. Announcing a failure there would be false.
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });
    await mounted();
    await turnstile.expire();
    expect(screen.queryByTestId("turnstile-challenge-failed")).not.toBeInTheDocument();
  });

  it("retracts the failure when the visitor solves the next challenge", async () => {
    const onToken = vi.fn();
    await mounted({ onToken });

    await turnstile.fail("network-error");
    expect(await screen.findByTestId("turnstile-challenge-failed")).toBeInTheDocument();

    // Recovery through the EXISTING mechanism — the widget's own re-solve. No
    // extra retry control was added, so this is the whole path back.
    await turnstile.solve();

    await waitFor(() =>
      expect(screen.queryByTestId("turnstile-challenge-failed")).not.toBeInTheDocument(),
    );
    // Gone from the tree, not merely hidden: a stale alert left behind would be
    // read out on the next focus move.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onToken).toHaveBeenCalledWith(DUMMY_TOKEN);
  });

  it("starts a deliberately renewed challenge without the old failure", async () => {
    const view = await mounted();
    await turnstile.fail("network-error");
    expect(await screen.findByTestId("turnstile-challenge-failed")).toBeInTheDocument();

    view.rerender(
      <TurnstileWidget
        siteKey={TEST_SITE_KEY}
        action={WIDGET_ACTION}
        onToken={vi.fn()}
        onTokenLost={vi.fn()}
        resetSignal={1}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByTestId("turnstile-challenge-failed")).not.toBeInTheDocument(),
    );
  });

  it("keeps reporting the lost token to the caller", async () => {
    const onTokenLost = vi.fn();
    await mounted({ onTokenLost });

    await turnstile.fail("network-error");

    // The message is additive. If showing it had displaced the callback, the
    // form would keep a dead token and submit it.
    expect(onTokenLost).toHaveBeenCalledWith("error");
  });
});

/**
 * THE CHECK'S ONE LINE (owner, 2026-10-02).
 *
 * Cloudflare's box is no longer in the form unless it has something to ask. In
 * its place stands one line, and these cases pin what it says in each state —
 * and that it never says two things at once.
 */
describe("TurnstileWidget — the line that stands where the box was", () => {
  async function mounted(resetSignal = 0) {
    const view = render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={resetSignal} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    return view;
  }
  const line = () => screen.getByRole("status");
  const root = () => screen.getByTestId("turnstile-widget");
  const frame = () => screen.getByTestId("turnstile-container").parentElement as HTMLElement;

  it("says the check is running, and gives the box no room", async () => {
    await mounted();
    expect(line()).toHaveTextContent("Проверяем браузер…");
    expect(root()).toHaveAttribute("data-phase", "checking");
    expect(frame()).not.toHaveAttribute("data-shown");
  });

  it("says the check has passed once a token arrives", async () => {
    await mounted();
    await turnstile.solve();
    expect(line()).toHaveTextContent("Браузер проверен.");
    expect(root()).toHaveAttribute("data-phase", "passed");
    expect(frame()).not.toHaveAttribute("data-shown");
  });

  it("opens the frame, and says what to do, only when Cloudflare asks for a press", async () => {
    await mounted();
    await turnstile.askForPress();
    expect(line()).toHaveTextContent("Нужно подтверждение: отметьте поле ниже.");
    expect(root()).toHaveAttribute("data-phase", "interactive");
    expect(frame()).toHaveAttribute("data-shown");

    // Solved by that press: the line says so, and the box — Cloudflare's own
    // «Успешно» is in it now — is not pulled from under the visitor's pointer.
    await turnstile.solve();
    expect(line()).toHaveTextContent("Браузер проверен.");
    expect(root()).toHaveAttribute("data-phase", "passed");
    expect(frame()).toHaveAttribute("data-shown");
  });

  it("keeps the frame open for that check when Cloudflare stops asking without a token", async () => {
    await mounted();
    await turnstile.askForPress();
    await turnstile.stopAsking();
    // The line no longer asks for a press; the box, with whatever Cloudflare shows in it, stays.
    expect(line()).toHaveTextContent("Проверяем браузер…");
    expect(frame()).toHaveAttribute("data-shown");
  });

  it("starts a renewed check with the frame closed, even after a press", async () => {
    const view = await mounted();
    await turnstile.askForPress();
    await turnstile.solve();
    expect(frame()).toHaveAttribute("data-shown");
    view.rerender(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={1} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    expect(line()).toHaveTextContent("Проверяем браузер…");
    expect(frame()).not.toHaveAttribute("data-shown");
  });

  it("closes the frame over a failed check, and opens it again if Turnstile's own retry asks for a press", async () => {
    await mounted();
    await turnstile.askForPress();
    await turnstile.fail("network-error");
    // One voice: the message, with its way back. Not Cloudflare's box as well.
    expect(root()).toHaveAttribute("data-phase", "failed");
    expect(screen.getByTestId("turnstile-challenge-failed")).toBeInTheDocument();
    expect(frame()).not.toHaveAttribute("data-shown");

    // Turnstile retries by itself, and this time asks for a press: the check is
    // alive again, so the failure is withdrawn and the box is shown.
    await turnstile.askForPress();
    expect(screen.queryByTestId("turnstile-challenge-failed")).not.toBeInTheDocument();
    expect(root()).toHaveAttribute("data-phase", "interactive");
    expect(line()).toHaveTextContent("Нужно подтверждение: отметьте поле ниже.");
    expect(frame()).toHaveAttribute("data-shown");
  });

  it("never takes Cloudflare's container out of the page: it is rendered in every state", async () => {
    await mounted();
    const container = () => screen.getByTestId("turnstile-container");
    // Checking, passed, asked for a press, failed: the element Turnstile was
    // rendered into is the same one, still in the document, never swapped out.
    const first = container();
    await turnstile.solve();
    expect(container()).toBe(first);
    await turnstile.askForPress();
    expect(container()).toBe(first);
    await turnstile.fail("network-error");
    expect(container()).toBe(first);
    expect(first.isConnected).toBe(true);
    expect(turnstile.removed).toEqual([]);
  });

  it("goes back to checking when a solved token lapses, instead of still claiming a pass", async () => {
    await mounted();
    await turnstile.solve();
    await turnstile.expire();
    expect(line()).toHaveTextContent("Проверяем браузер…");
    expect(root()).toHaveAttribute("data-phase", "checking");
  });

  it("starts a renewed challenge from «checking», whatever the last one came to", async () => {
    const view = await mounted();
    await turnstile.solve();
    expect(line()).toHaveTextContent("Браузер проверен.");
    view.rerender(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={vi.fn()} onTokenLost={vi.fn()} resetSignal={1} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    expect(line()).toHaveTextContent("Проверяем браузер…");
    expect(frame()).not.toHaveAttribute("data-shown");
  });

  it("is the element a form's button is described by", async () => {
    render(
      <TurnstileWidget
        siteKey={TEST_SITE_KEY}
        action={WIDGET_ACTION}
        onToken={vi.fn()}
        onTokenLost={vi.fn()}
        resetSignal={0}
        describedById="why-not-yet"
      />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    expect(line()).toHaveAttribute("id", "why-not-yet");
    expect(document.querySelectorAll("#why-not-yet")).toHaveLength(1);
  });
});

describe("TurnstileWidget — the visitor's own way back from a failed check", () => {
  async function failed() {
    const onToken = vi.fn();
    const onTokenLost = vi.fn();
    const view = render(
      <TurnstileWidget siteKey={TEST_SITE_KEY} action={WIDGET_ACTION} onToken={onToken} onTokenLost={onTokenLost} resetSignal={0} />,
    );
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    await turnstile.fail("network-error");
    return { view, onToken, onTokenLost };
  }

  it("offers «Повторить проверку» with the failure, because Cloudflare's box is not on the page to press", async () => {
    await failed();
    const alert = screen.getByTestId("turnstile-challenge-failed");
    expect(alert).toHaveTextContent("Проверка безопасности не выполнена.");
    // The sentence no longer tells the visitor to «try again» with nothing to try: the button does.
    expect(alert).not.toHaveTextContent("Попробуйте ещё раз");
    const retry = screen.getByRole("button", { name: "Повторить проверку" });
    expect(alert).toContainElement(retry);
    // Never a submit: a press must not post the form it stands in.
    expect(retry).toHaveAttribute("type", "button");
  });

  it("issues a brand-new challenge on a press, and takes the failure away", async () => {
    const { onToken } = await failed();
    await userEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));

    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    // The failed instance is torn down: exactly one challenge is on the page.
    expect(turnstile.removed).toEqual(["widget-1"]);
    expect(turnstile.liveWidgets()).toEqual(["widget-2"]);
    expect(screen.queryByTestId("turnstile-challenge-failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Проверяем браузер…");
    // The keyboard is not sent back to the top of the page with the button gone.
    expect(screen.getByRole("status")).toHaveFocus();

    await turnstile.solve();
    expect(onToken).toHaveBeenCalledWith(DUMMY_TOKEN);
    expect(screen.getByRole("status")).toHaveTextContent("Браузер проверен.");
  });

  it("can fail and be retried again", async () => {
    await failed();
    await userEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    await turnstile.fail("network-error");
    expect(await screen.findByTestId("turnstile-challenge-failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(3));
    expect(turnstile.liveWidgets()).toEqual(["widget-3"]);
  });
});

