/**
 * POCKETCTA-1 — the Level 1 Pocket registration action.
 *
 * Covers the action, the loading state, the double-click guard, the external
 * target and how it is opened, the refusal of an unusable URL, the error path,
 * the manual re-check, focus revalidation, and the contract that matters most:
 * nothing here completes a level, writes progress, or invents a URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock("@/lib/pocket-registration/referral-link-client", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/pocket-registration/referral-link-client")
  >("@/lib/pocket-registration/referral-link-client");
  return { ...actual, requestReferralLink: vi.fn() };
});

import * as client from "@/lib/pocket-registration/referral-link-client";
import { PocketRegistration } from "@/features/pocket-registration/pocket-registration";
import { makeError } from "@/lib/api/errors";

const requestMock = vi.mocked(client.requestReferralLink);

const EXTERNAL_URL =
  "https://affiliate.example.invalid/register?utm_campaign=820107&cid=962747&click_id=tq-a&clickid=tq-a&landing=Landing_1";

const linked = (url = EXTERNAL_URL) => ({ ok: true as const, url, requestId: null });

let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockReset();
  requestMock.mockReset();
  openSpy = vi.fn();
  vi.stubGlobal("open", openSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const registerButton = () =>
  screen.getByRole("button", { name: /Зарегистрироваться в Pocket|Готовим ссылку/ });
const recheckButton = () => screen.getByRole("button", { name: /Проверить регистрацию|Проверяем/ });

describe("PocketRegistration — the action", () => {
  it("shows the required primary label", () => {
    render(<PocketRegistration />);
    expect(screen.getByRole("button", { name: "Зарегистрироваться в Pocket" })).toBeEnabled();
  });

  it("offers exactly two controls: register and re-check", () => {
    render(<PocketRegistration />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(recheckButton()).toBeEnabled();
  });

  it("obtains the URL from the server and opens it in a new tab", async () => {
    requestMock.mockResolvedValue(linked());
    const user = userEvent.setup();
    render(<PocketRegistration />);

    await user.click(registerButton());

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    // No argument carries a URL, a clickid or a learner: the request has no input.
    expect(requestMock).toHaveBeenCalledWith();
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith(EXTERNAL_URL, "_blank", "noopener,noreferrer");
  });

  it("opens an external https target — never loopback or an internal port", async () => {
    requestMock.mockResolvedValue(linked());
    const user = userEvent.setup();
    render(<PocketRegistration />);
    await user.click(registerButton());
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    const opened = String(openSpy.mock.calls[0]![0]);
    expect(opened.startsWith("https://")).toBe(true);
    expect(opened).not.toMatch(/127\.0\.0\.1|localhost|::1/);
    expect(opened).not.toMatch(/:3100|:3050|:3010/);
    expect(opened).not.toContain("example.test");
    expect(opened).not.toMatch(/[?&]ow=/);
    expect(opened).not.toMatch(/playerid/i);
  });

  it("uses noopener and noreferrer so the affiliate page gets no handle back", async () => {
    requestMock.mockResolvedValue(linked());
    const user = userEvent.setup();
    render(<PocketRegistration />);
    await user.click(registerButton());
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    const features = String(openSpy.mock.calls[0]![2]);
    expect(features).toContain("noopener");
    expect(features).toContain("noreferrer");
  });

  it("shows a bounded loading state while the link is in flight", async () => {
    let release: (value: ReturnType<typeof linked>) => void = () => {};
    requestMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    render(<PocketRegistration />);

    await user.click(registerButton());

    // The disabled state is announced, not merely styled.
    await waitFor(() => expect(registerButton()).toBeDisabled());
    expect(registerButton()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Готовим ссылку…" })).toBeInTheDocument();

    await act(async () => { release(linked()); });
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
  });

  it("deduplicates rapid clicks — one request, one window", async () => {
    let release: (value: ReturnType<typeof linked>) => void = () => {};
    requestMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    render(<PocketRegistration />);

    const button = registerButton();
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(requestMock).toHaveBeenCalledTimes(1);
    await act(async () => { release(linked()); });
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
  });
});

describe("PocketRegistration — failure never unlocks anything", () => {
  it("shows a retryable message and opens nothing on failure", async () => {
    requestMock.mockResolvedValue({ ok: false, error: makeError("BACKEND_UNAVAILABLE") });
    const user = userEvent.setup();
    render(<PocketRegistration />);

    await user.click(registerButton());

    expect(await screen.findByText(/Сервер сейчас недоступен/)).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    // No navigation to a placeholder, and the action stays available for a retry.
    await waitFor(() => expect(registerButton()).toBeEnabled());
  });

  it("does not open a malformed or unusable URL", async () => {
    // The client already refuses these; if one ever reached the component it must
    // still not become a navigation.
    requestMock.mockResolvedValue({ ok: false, error: makeError("MALFORMED_RESPONSE") });
    const user = userEvent.setup();
    render(<PocketRegistration />);

    await user.click(registerButton());

    expect(await screen.findByText(/Сервер ответил неожиданно/)).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("tells an unauthenticated learner to sign in, and opens nothing", async () => {
    requestMock.mockResolvedValue({ ok: false, error: makeError("UNAUTHENTICATED") });
    const user = userEvent.setup();
    render(<PocketRegistration />);
    await user.click(registerButton());
    expect(await screen.findByText(/Нужно войти в аккаунт/)).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("never claims the level is complete", async () => {
    requestMock.mockResolvedValue(linked());
    const user = userEvent.setup();
    render(<PocketRegistration />);
    await user.click(registerButton());
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    // Opening the page is not registering, and the component says so.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/уровень пройден|уровень завершён|Уровень открыт/i);
    expect(text).toMatch(/Проверить регистрацию/);
  });
});

describe("PocketRegistration — the manual re-check", () => {
  it("re-reads authoritative server state and stays pending", async () => {
    const user = userEvent.setup();
    render(<PocketRegistration />);

    await user.click(recheckButton());

    // The answer comes from the server render, not from local state.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Nothing was written and no link was requested.
    expect(requestMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("deduplicates rapid re-check clicks", async () => {
    const user = userEvent.setup();
    render(<PocketRegistration />);

    const button = recheckButton();
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(recheckButton()).toBeDisabled());
  });

  it("reports a neutral pending message rather than a failure", async () => {
    vi.useFakeTimers();
    try {
      render(<PocketRegistration />);
      const button = recheckButton();
      await act(async () => { button.click(); });
      await act(async () => { vi.advanceTimersByTime(1300); });
      expect(screen.getByRole("status").textContent ?? "").toMatch(/пока не подтверждена/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PocketRegistration — focus revalidation", () => {
  it("does not revalidate on return before the learner has left", async () => {
    render(<PocketRegistration />);

    await act(async () => { window.dispatchEvent(new Event("focus")); });

    // Nothing has been opened, so there is nothing new to find.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("revalidates at most once per return event", async () => {
    requestMock.mockResolvedValue(linked());
    const user = userEvent.setup();
    render(<PocketRegistration />);
    await user.click(registerButton());
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    refresh.mockReset();

    // One return to the tab fires BOTH events; they must collapse into one.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not poll — no revalidation happens on its own", async () => {
    vi.useFakeTimers();
    try {
      requestMock.mockResolvedValue(linked());
      render(<PocketRegistration />);
      await act(async () => { registerButton().click(); });
      await act(async () => { await Promise.resolve(); });
      refresh.mockReset();

      await act(async () => { vi.advanceTimersByTime(120_000); });

      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PocketRegistration — accessibility and keyboard", () => {
  it("both controls are real buttons, reachable and operable by keyboard", async () => {
    requestMock.mockResolvedValue(linked());
    const user = userEvent.setup();
    render(<PocketRegistration />);

    for (const button of screen.getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
    }

    await user.tab();
    expect(registerButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    await user.tab();
    expect(recheckButton()).toHaveFocus();
  });

  it("announces status through a live region", async () => {
    requestMock.mockResolvedValue({ ok: false, error: makeError("NETWORK_ERROR") });
    const user = userEvent.setup();
    render(<PocketRegistration />);

    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();

    await user.click(registerButton());

    await waitFor(() => expect(status.textContent ?? "").toMatch(/Не удалось связаться/));
    // The answer is a programmatic focus target without joining the tab order.
    expect(status).toHaveAttribute("tabindex", "-1");
  });

  it("is labelled as a section so it is navigable by heading", () => {
    render(<PocketRegistration />);
    expect(screen.getByRole("heading", { name: "Регистрация в Pocket" })).toBeInTheDocument();
  });
});

describe("the referral URL guard", () => {
  it("accepts a real external https affiliate URL", () => {
    expect(client.isSafeExternalReferralUrl(EXTERNAL_URL)).toBe(true);
  });

  it("refuses loopback, internal ports, non-https schemes and junk", () => {
    for (const bad of [
      "http://affiliate.example.invalid/register",
      "https://127.0.0.1/register",
      "https://localhost/register",
      "https://[::1]/register",
      "https://affiliate.example.invalid:3100/register",
      "https://affiliate.example.invalid:3050/register",
      "https://affiliate.example.invalid:3010/register",
      "https://user:pass@affiliate.example.invalid/register",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "//affiliate.example.invalid/register",
      "not a url",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(client.isSafeExternalReferralUrl(bad), String(bad)).toBe(false);
    }
  });
});
