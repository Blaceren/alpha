import { DEFAULT_RETURN_TO } from "@/lib/auth/return-to";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/api/client", () => ({
  login: vi.fn(),
  fetchSession: vi.fn(),
}));

import * as api from "@/lib/api/client";
import { LoginForm } from "@/features/auth/login-form";
import { makeError } from "@/lib/api/errors";
import { TURNSTILE_LOGIN_ACTION } from "@/lib/auth/turnstile";
import {
  DUMMY_TOKEN,
  TEST_SITE_KEY,
  installTurnstileDouble,
  resetTurnstileDouble,
  type TurnstileDouble,
} from "@/test/turnstile-double";

const loginMock = vi.mocked(api.login);
const sessionMock = vi.mocked(api.fetchSession);

let turnstile: TurnstileDouble;

const ok = { ok: true as const, data: { user: { id: 1, name: "A", role: "user" } }, requestId: null };

beforeEach(() => {
  replace.mockClear();
  loginMock.mockReset();
  sessionMock.mockReset();
  searchParams = new URLSearchParams();
  // Auto-solving mirrors the ordinary case: a visitor who passes the challenge
  // without an interactive puzzle. Cases that care about the pre-token state
  // install their own double with `autoSolve: false`.
  turnstile = installTurnstileDouble();
});

afterEach(() => {
  resetTurnstileDouble();
});

/** Render, fill the credentials and wait for the challenge to be solved. */
async function fillAndSolve(email = "a@b.co", password = "secret1") {
  render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} />);
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Пароль"), password);
  await waitFor(() => expect(screen.getByRole("button", { name: "Войти" })).toBeEnabled());
}

function submit() {
  return userEvent.click(screen.getByRole("button", { name: "Войти" }));
}

/** The body the form handed to the API client on its Nth attempt. */
function sentPayload(index = 0) {
  return loginMock.mock.calls[index]?.[0] as
    | { email: string; password: string; captchaToken?: string }
    | undefined;
}

describe("LoginForm — the existing contract, preserved", () => {
  it("logs in, confirms the session and redirects to a validated internal returnTo", async () => {
    searchParams = new URLSearchParams("next=/lessons/L2");
    loginMock.mockResolvedValue(ok);
    sessionMock.mockResolvedValue(ok);

    await fillAndSolve();
    await submit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/lessons/L2"));
    expect(sessionMock).toHaveBeenCalled();
  });

  it("redirects to root when returnTo is an external URL (open-redirect blocked)", async () => {
    searchParams = new URLSearchParams("next=https://evil.example.com");
    loginMock.mockResolvedValue(ok);
    sessionMock.mockResolvedValue(ok);

    await fillAndSolve();
    await submit();

    // Asserted against the CONSTANT, not a literal: the destination moved from
    // "/" to "/home" when "/" became Public Home, and a literal here would
    // have to be chased every time that product decision changes. What the
    // test is actually about — an external returnTo is discarded in favour of
    // the safe default — is unchanged.
    await waitFor(() => expect(replace).toHaveBeenCalledWith(DEFAULT_RETURN_TO));
  });

  it("shows a generic, enumeration-safe error on invalid credentials", async () => {
    loginMock.mockResolvedValue({ ok: false, error: makeError("INVALID_CREDENTIALS", { status: 401 }) });

    await fillAndSolve("nobody@b.co", "wrong1");
    await submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Неверный email или пароль.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows a retryable message with a request id when the Backend is unavailable", async () => {
    loginMock.mockResolvedValue({ ok: false, error: makeError("BACKEND_UNAVAILABLE", { requestId: "req-77" }) });

    await fillAndSolve();
    await submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Сервис временно недоступен");
    expect(alert).toHaveTextContent("req-77");
  });

  it("shows a rate-limit message on 429", async () => {
    loginMock.mockResolvedValue({ ok: false, error: makeError("RATE_LIMITED", { status: 429 }) });

    await fillAndSolve();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Слишком много попыток");
  });

  it("uses password input semantics and autocomplete for password managers", () => {
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} />);
    const password = screen.getByLabelText("Пароль");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
  });
});

describe("LoginForm — the Turnstile challenge (AFD-3A3)", () => {
  it("renders the widget with the LOGIN action, never the registration one", async () => {
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} />);
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    expect(turnstile.latest().action).toBe(TURNSTILE_LOGIN_ACTION);
    expect(turnstile.latest().action).toBe("academy_login");
    // A token minted for registration is refused by the Backend, so minting one
    // here would be a login form that cannot log anybody in.
    expect(turnstile.latest().action).not.toBe("academy_register");
    expect(turnstile.latest().sitekey).toBe(TEST_SITE_KEY);
  });

  it("keeps submission disabled until the challenge is solved", async () => {
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });

    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret1");

    const button = screen.getByRole("button", { name: "Войти" });
    expect(button).toBeDisabled();
    // The widget renders its own live region, so the prompt is located through
    // the button's own description rather than by picking one of two statuses.
    const describedBy = button.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)).toHaveTextContent(
      "Пройдите проверку безопасности",
    );

    await turnstile.solve();
    expect(screen.getByRole("button", { name: "Войти" })).toBeEnabled();
  });

  it("sends the token in the exact DTO field and nothing else", async () => {
    loginMock.mockResolvedValue(ok);
    sessionMock.mockResolvedValue(ok);

    await fillAndSolve();
    await submit();

    await waitFor(() => expect(loginMock).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload?.captchaToken).toBe(DUMMY_TOKEN);
    // The legacy sentinel the Backend's own internal page used to fabricate.
    expect(payload?.captchaToken).not.toBe("dev-captcha-ok");
    expect(Object.keys(payload ?? {}).sort()).toEqual(["captchaToken", "email", "password"]);
  });

  it("clears the token when the challenge expires, times out or errors", async () => {
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} />);

    for (const lose of [() => turnstile.expire(), () => turnstile.timeout(), () => turnstile.fail()]) {
      await turnstile.solve();
      await waitFor(() => expect(screen.getByRole("button", { name: "Войти" })).toBeEnabled());
      await lose();
      await waitFor(() => expect(screen.getByRole("button", { name: "Войти" })).toBeDisabled());
    }
  });

  it("renews the challenge after invalid credentials, because the token was already spent", async () => {
    // The Backend verifies the challenge BEFORE comparing the password, so a
    // wrong password still consumes the token. Reusing it could only produce
    // `timeout-or-duplicate` — and the person would be told twice that a correct
    // password was wrong.
    loginMock.mockResolvedValue({ ok: false, error: makeError("INVALID_CREDENTIALS", { status: 401 }) });

    await fillAndSolve();
    const rendersBefore = turnstile.renders.length;
    await submit();

    await screen.findByRole("alert");
    await waitFor(() => expect(turnstile.renders.length).toBeGreaterThan(rendersBefore));
    // A fresh challenge means a fresh, different token on the retry.
    await turnstile.solve("second-token");
    await submit();
    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(2));
    expect(sentPayload(1)?.captchaToken).toBe("second-token");
  });

  it("renews the challenge after a CAPTCHA rejection", async () => {
    loginMock.mockResolvedValue({
      ok: false,
      error: makeError("VALIDATION_ERROR", { status: 400, code: "CAPTCHA_FAILED" }),
    });

    await fillAndSolve();
    const rendersBefore = turnstile.renders.length;
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Проверка не пройдена");
    await waitFor(() => expect(turnstile.renders.length).toBeGreaterThan(rendersBefore));
  });

  it("reports a provider outage as an outage, not as a failed challenge", async () => {
    loginMock.mockResolvedValue({
      ok: false,
      error: makeError("BACKEND_UNAVAILABLE", { status: 503, code: "CAPTCHA_UNAVAILABLE" }),
    });

    await fillAndSolve();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Сервис проверки временно недоступен");
  });

  it("reports a broken platform configuration distinctly", async () => {
    loginMock.mockResolvedValue({
      ok: false,
      error: makeError("BACKEND_UNAVAILABLE", { status: 503, code: "CAPTCHA_CONFIGURATION_ERROR" }),
    });

    await fillAndSolve();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Обратитесь к поддержке");
  });

  it("keeps a blocked account distinct from a wrong password", async () => {
    loginMock.mockResolvedValue({
      ok: false,
      error: makeError("FORBIDDEN", { status: 403, code: "ACCOUNT_BLOCKED" }),
    });

    await fillAndSolve();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Аккаунт заблокирован");
  });

  it("suppresses a duplicate submission so the single-use token is not burned twice", async () => {
    let resolveLogin: (value: typeof ok) => void = () => undefined;
    loginMock.mockImplementation(
      () => new Promise((resolve) => { resolveLogin = resolve as never; }),
    );
    sessionMock.mockResolvedValue(ok);

    await fillAndSolve();
    const button = screen.getByRole("button", { name: "Войти" });
    await userEvent.click(button);
    await userEvent.click(button).catch(() => undefined);

    expect(loginMock).toHaveBeenCalledTimes(1);
    resolveLogin(ok);
  });

  it("renders an unavailable state and blocks submission when no site key is configured", async () => {
    render(<LoginForm turnstileSiteKey={null} />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret1");

    expect(screen.getByTestId("captcha-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Войти" })).toBeDisabled();
    expect(turnstile.renders).toHaveLength(0);
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("treats a malformed site key as unavailable, never as a pass", async () => {
    render(<LoginForm turnstileSiteKey={"not-a-site-key"} />);
    expect(screen.getByTestId("captcha-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Войти" })).toBeDisabled();
  });

  it("never persists the token in browser storage or the URL", async () => {
    loginMock.mockResolvedValue(ok);
    sessionMock.mockResolvedValue(ok);

    await fillAndSolve();
    await submit();
    await waitFor(() => expect(loginMock).toHaveBeenCalled());

    expect(JSON.stringify(localStorage)).not.toContain(DUMMY_TOKEN);
    expect(JSON.stringify(sessionStorage)).not.toContain(DUMMY_TOKEN);
    expect(window.location.href).not.toContain(DUMMY_TOKEN);
    expect(document.cookie).not.toContain(DUMMY_TOKEN);
    // Nor in the rendered DOM, where a copy would survive in the page source.
    expect(document.body.innerHTML).not.toContain(DUMMY_TOKEN);
  });

  it("never logs the token", async () => {
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }

    loginMock.mockResolvedValue({ ok: false, error: makeError("INVALID_CREDENTIALS", { status: 401 }) });
    await fillAndSolve();
    await submit();
    await screen.findByRole("alert");

    expect(logged.join("\n")).not.toContain(DUMMY_TOKEN);
    vi.restoreAllMocks();
  });

  it("keeps the email but clears the password after a wrong password", async () => {
    loginMock.mockResolvedValue({ ok: false, error: makeError("INVALID_CREDENTIALS", { status: 401 }) });

    await fillAndSolve("keep@b.co", "wrong1");
    await submit();
    await screen.findByRole("alert");

    expect(screen.getByLabelText("Email")).toHaveValue("keep@b.co");
    expect(screen.getByLabelText("Пароль")).toHaveValue("");
  });

  it("describes the blocked submit button for assistive technology", async () => {
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} />);

    const button = screen.getByRole("button", { name: "Войти" });
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      "Пройдите проверку безопасности",
    );
  });
});
