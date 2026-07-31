/**
 * The CRM Turnstile widget lifecycle (AFD-3A3).
 *
 * The widget is not a security control — the backend verifies every token
 * against Cloudflare and pins the expected action. What the CRM owns is the
 * CONTRACT around it: render once, hand the token to the form, clear it on
 * expiry/timeout/error, reset when asked, and remove the instance on unmount.
 * A leak in any of those is either a challenge the employee cannot solve or a
 * stale token the backend will refuse.
 */
import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { TurnstileWidget } from "@/features/auth/turnstile-widget";
import { TURNSTILE_CRM_LOGIN_ACTION, TURNSTILE_SCRIPT_URL } from "@/lib/auth/turnstile";
import {
  DUMMY_TOKEN,
  TEST_SITE_KEY,
  installTurnstileDouble,
  resetTurnstileDouble,
  type TurnstileDouble,
} from "@/test/turnstile-double";

let turnstile: TurnstileDouble;

beforeEach(() => {
  turnstile = installTurnstileDouble({ autoSolve: false });
});

afterEach(() => {
  resetTurnstileDouble();
  vi.restoreAllMocks();
});

function scriptTags() {
  return Array.from(document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`));
}

function widget(props: Partial<React.ComponentProps<typeof TurnstileWidget>> = {}) {
  return (
    <TurnstileWidget
      siteKey={TEST_SITE_KEY}
      action={TURNSTILE_CRM_LOGIN_ACTION}
      onToken={vi.fn()}
      onTokenLost={vi.fn()}
      resetSignal={0}
      {...props}
    />
  );
}

describe("TurnstileWidget — script loading", () => {
  it("renders without inserting a second script when the API is already present", async () => {
    render(widget());
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));
    expect(scriptTags()).toHaveLength(0);
  });

  it("inserts the official explicit-render script exactly once when the API is absent", async () => {
    turnstile.uninstall();

    const first = render(widget());
    await waitFor(() => expect(scriptTags()).toHaveLength(1));
    first.unmount();

    render(widget());
    // A second insertion would re-run the global registration and can orphan
    // live widgets.
    await waitFor(() => expect(scriptTags()).toHaveLength(1));
    expect(scriptTags()[0]?.getAttribute("src")).toContain("render=explicit");
  });

  it("reports an unavailable state when the script fails to load", async () => {
    turnstile.uninstall();
    render(widget());

    const tag = scriptTags()[0] as HTMLScriptElement;
    // Wrapped: the error handler sets state, and React wants that flushed
    // deterministically rather than after the assertion has already run.
    await act(async () => {
      tag.dispatchEvent(new Event("error"));
    });

    expect(await screen.findByTestId("turnstile-unavailable")).toBeInTheDocument();
  });

  it("reports an unavailable state when render itself throws", async () => {
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false, throwOnRender: true });

    render(widget());

    // A challenge that cannot initialise must be visible as such, never
    // swallowed into a form that looks ready but can never be submitted.
    expect(await screen.findByTestId("turnstile-unavailable")).toBeInTheDocument();
  });
});

describe("TurnstileWidget — the action", () => {
  it("stamps exactly the action it was given", async () => {
    render(widget());
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    expect(turnstile.latest().action).toBe("crm_login");
    expect(turnstile.latest().sitekey).toBe(TEST_SITE_KEY);
  });

  it("re-renders under a new action rather than keeping the old one", async () => {
    const view = render(widget());
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    view.rerender(widget({ action: "academy_login" }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    expect(turnstile.latest().action).toBe("academy_login");
  });
});

describe("TurnstileWidget — the token lifecycle", () => {
  it("hands a solved token to the caller", async () => {
    const onToken = vi.fn();
    render(widget({ onToken }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    await turnstile.solve();
    expect(onToken).toHaveBeenCalledWith(DUMMY_TOKEN);
  });

  it.each(["expire", "timeout", "fail"] as const)("reports a lost token on %s", async (event) => {
    const onTokenLost = vi.fn();
    render(widget({ onTokenLost }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    await turnstile[event]();
    expect(onTokenLost).toHaveBeenCalledTimes(1);
  });

  it("issues a genuinely fresh challenge when the reset signal is bumped", async () => {
    const view = render(widget({ resetSignal: 0 }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    view.rerender(widget({ resetSignal: 1 }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(2));
    // The previous instance is torn down, not left running alongside.
    expect(turnstile.liveWidgets()).toHaveLength(1);
  });

  it("removes the widget instance on unmount", async () => {
    const view = render(widget());
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    view.unmount();
    expect(turnstile.removed).toHaveLength(1);
    expect(turnstile.liveWidgets()).toHaveLength(0);
  });

  it("does not re-challenge when only the callbacks change identity", async () => {
    const view = render(widget({ onToken: vi.fn() }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    // A parent re-render produces new function identities on every keystroke.
    // Tearing the widget down for that would restart the challenge each time.
    view.rerender(widget({ onToken: vi.fn() }));
    view.rerender(widget({ onToken: vi.fn() }));
    expect(turnstile.renders).toHaveLength(1);
  });
});

describe("TurnstileWidget — accessibility and layout", () => {
  it("announces its loading state in a live region", () => {
    turnstile.uninstall();
    render(widget());

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Загружается проверка безопасности");
  });

  it("describes the challenge container for assistive technology", async () => {
    render(widget({ describedById: "external-description" }));
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    expect(screen.getByTestId("turnstile-container")).toHaveAttribute(
      "aria-describedby",
      "external-description",
    );
  });

  it("lets the challenge scroll rather than clipping it on a narrow viewport", async () => {
    render(widget());
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    // The widget iframe is ~300px wide and cannot be resized. At 390px with the
    // card's padding it fits, but a large text-size preference or the taller
    // interactive challenge must never cut it off — an unreachable checkbox is
    // an employee who cannot sign in.
    const container = screen.getByTestId("turnstile-container");
    expect(container.className).toContain("overflow-x-auto");
    expect(container.className).toContain("max-w-full");
  });

  it("marks an unavailable challenge as an alert, not as decoration", async () => {
    turnstile.uninstall();
    render(widget());
    await act(async () => {
      scriptTags()[0]?.dispatchEvent(new Event("error"));
    });

    const alert = await screen.findByTestId("turnstile-unavailable");
    expect(alert).toHaveAttribute("role", "alert");
  });
});
