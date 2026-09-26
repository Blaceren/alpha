import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./login-form";
import { RETURN_PATH_KEY } from "@/domain/identity/return-path";
import { TURNSTILE_CRM_LOGIN_ACTION } from "@/lib/auth/turnstile";
import {
  DUMMY_TOKEN,
  TEST_SITE_KEY,
  installTurnstileDouble,
  resetTurnstileDouble,
  type TurnstileDouble,
} from "@/test/turnstile-double";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

const VALID_EMAIL = "mentor@example.com";
const VALID_PASSWORD = "secret123";

let turnstile: TurnstileDouble;

beforeEach(() => {
  replace.mockClear();
  window.sessionStorage.clear();
  // AFD-3A3: staff login now requires a solved challenge. Auto-solving mirrors
  // the ordinary case — a visitor who passes without an interactive puzzle —
  // so the pre-existing cases below assert the same behaviour they always did.
  turnstile = installTurnstileDouble();
});

afterEach(() => {
  resetTurnstileDouble();
  vi.restoreAllMocks();
});

function ok() {
  return vi.fn().mockResolvedValue({ status: "success" as const });
}
function fail(code: string, requestId?: string) {
  return vi.fn().mockResolvedValue({
    status: "failed" as const,
    code,
    ...(requestId ? { requestId } : {}),
  });
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  email = VALID_EMAIL,
  password = VALID_PASSWORD,
) {
  if (email) await user.type(screen.getByLabelText(/рабочий email/i), email);
  if (password) await user.type(screen.getByLabelText(/^пароль$/i), password);
  // Wait for the challenge to be solved. A locally-invalid submission is meant
  // to be refused before the request, so those cases pass empty credentials and
  // the wait still resolves — the widget solves independently of the fields.
  await waitFor(() => expect(turnstile.renders.length).toBeGreaterThan(0));
  await user.click(screen.getByRole("button", { name: /войти/i }));
}

describe("LoginForm — idle", () => {
  it("renders a semantic labelled form", () => {
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);

    const email = screen.getByLabelText(/рабочий email/i);
    const password = screen.getByLabelText(/^пароль$/i);

    expect(email).toHaveAttribute("type", "email");
    expect(password).toHaveAttribute("type", "password");
    // Password-manager compatibility is a real requirement, not a nicety.
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: /войти/i })).toHaveAttribute("type", "submit");
  });

  it("shows no error before submission", () => {
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the session-expired notice only when told to", () => {
    const { unmount } = render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    expect(screen.queryByText(/сессия завершена/i)).not.toBeInTheDocument();
    unmount();

    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} sessionExpired />);
    expect(screen.getByText(/сессия завершена/i)).toBeInTheDocument();
  });
});

describe("LoginForm — submission", () => {
  it("calls the client with the trimmed email and the password", async () => {
    const user = userEvent.setup();
    const loginImpl = ok();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={loginImpl} />);

    await user.type(screen.getByLabelText(/рабочий email/i), `  ${VALID_EMAIL}  `);
    await user.type(screen.getByLabelText(/^пароль$/i), VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: /войти/i }));

    // AFD-3A3 added a third argument — the options bag carrying the solved
    // Turnstile token. The first two are unchanged, which is the point.
    await waitFor(() =>
      expect(loginImpl).toHaveBeenCalledWith(VALID_EMAIL, VALID_PASSWORD, {
        captchaToken: DUMMY_TOKEN,
      }),
    );
  });

  it("submits on Enter from the password field", async () => {
    const user = userEvent.setup();
    const loginImpl = ok();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={loginImpl} />);

    await user.type(screen.getByLabelText(/рабочий email/i), VALID_EMAIL);
    await user.type(screen.getByLabelText(/^пароль$/i), `${VALID_PASSWORD}{Enter}`);

    await waitFor(() => expect(loginImpl).toHaveBeenCalledTimes(1));
  });

  it("does not send a second request while the first is in flight", async () => {
    const user = userEvent.setup();
    let release: (v: { status: "success" }) => void = () => {};
    const loginImpl = vi.fn().mockReturnValue(
      new Promise<{ status: "success" }>((resolve) => {
        release = resolve;
      }),
    );
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={loginImpl} />);

    await user.type(screen.getByLabelText(/рабочий email/i), VALID_EMAIL);
    await user.type(screen.getByLabelText(/^пароль$/i), VALID_PASSWORD);
    const button = screen.getByRole("button", { name: /войти/i });
    await user.click(button);

    expect(screen.getByRole("button", { name: /выполняется вход/i })).toBeDisabled();
    await user.click(button);
    expect(loginImpl).toHaveBeenCalledTimes(1);

    release({ status: "success" });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("announces submission in a live region", async () => {
    const user = userEvent.setup();
    let release: (v: { status: "success" }) => void = () => {};
    const loginImpl = vi.fn().mockReturnValue(
      new Promise<{ status: "success" }>((resolve) => {
        release = resolve;
      }),
    );
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={loginImpl} />);
    await submit(user);

    expect(screen.getByText(/проверяем учётные данные/i)).toBeInTheDocument();
    release({ status: "success" });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });
});

describe("LoginForm — local validation", () => {
  it("rejects a malformed email without a request", async () => {
    const user = userEvent.setup();
    const loginImpl = ok();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={loginImpl} />);
    await submit(user, "not-an-email", VALID_PASSWORD);

    expect(loginImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/проверьте email и пароль/i);
  });

  it("rejects a short password without a request", async () => {
    const user = userEvent.setup();
    const loginImpl = ok();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={loginImpl} />);
    await submit(user, VALID_EMAIL, "12345");

    expect(loginImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("LoginForm — every error state", () => {
  it.each([
    ["invalid_credentials", /неверные данные для входа/i],
    ["inactive", /доступ приостановлен/i],
    ["email_not_verified", /email не подтверждён/i],
    ["not_staff", /нет доступа к crm/i],
    ["rate_limited", /слишком много попыток/i],
    ["upstream_unavailable", /сервис недоступен/i],
    ["server_error", /ошибка сервиса входа/i],
    ["invalid_input", /проверьте email и пароль/i],
  ])("renders CRM copy for %s", async (code, pattern) => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail(code)} />);
    await submit(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(pattern);
  });

  it("does not render backend prose", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user);

    const alert = await screen.findByRole("alert");
    // The backend's own copy is "Неверный email или пароль" — CRM copy is chosen
    // in the CRM, so that exact string must not appear.
    expect(alert.textContent ?? "").not.toContain("Неверный email или пароль");
  });

  it("reads identically for a wrong password and an unknown account", async () => {
    // Both are backend 401 → invalid_credentials. Any divergence here would be
    // account enumeration.
    const user = userEvent.setup();
    const { unmount } = render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    const first = (await screen.findByRole("alert")).textContent;
    unmount();

    const user2 = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user2, "nobody@example.com", VALID_PASSWORD);
    expect((await screen.findByRole("alert")).textContent).toBe(first);
  });

  it("shows a requestId as a support reference when present", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("not_staff", "req-42")} />);
    await submit(user);
    expect(await screen.findByText(/req-42/)).toBeInTheDocument();
  });

  it("moves focus to the error summary", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("re-enables the form after a failure", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: /войти/i })).toBeEnabled();
    expect(screen.getByLabelText(/рабочий email/i)).toBeEnabled();
  });
});

describe("LoginForm — password handling", () => {
  it("clears the password after a failure", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");

    expect(screen.getByLabelText(/^пароль$/i)).toHaveValue("");
  });

  it("clears the password after success", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await submit(user);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(screen.getByLabelText(/^пароль$/i)).toHaveValue("");
  });

  it("keeps the email so a retry does not require retyping it", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");

    expect(screen.getByLabelText(/рабочий email/i)).toHaveValue(VALID_EMAIL);
  });

  it("never writes the password to storage", async () => {
    const user = userEvent.setup();
    const localSet = vi.spyOn(window.localStorage, "setItem");
    const sessionSet = vi.spyOn(window.sessionStorage, "setItem");

    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalled());

    for (const spy of [localSet, sessionSet]) {
      for (const call of spy.mock.calls) {
        expect(String(call[1])).not.toContain(VALID_PASSWORD);
      }
    }
  });
});

describe("LoginForm — redirect", () => {
  it("replaces to the default landing path when nothing was remembered", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/users"));
  });

  it("returns to the remembered protected route", async () => {
    window.sessionStorage.setItem(RETURN_PATH_KEY, "/users/77");
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/users/77"));
  });

  it("ignores a poisoned return path", async () => {
    window.sessionStorage.setItem(RETURN_PATH_KEY, "https://evil.test/steal");
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/users"));
  });

  it("never redirects back to /login", async () => {
    window.sessionStorage.setItem(RETURN_PATH_KEY, "/login?reason=session_required");
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/users"));
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining("/login"));
  });

  it("does not redirect on failure", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("LoginForm — the Turnstile challenge (AFD-3A3)", () => {
  it("renders the widget with the CRM action, never an Academy one", async () => {
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    expect(turnstile.latest().action).toBe(TURNSTILE_CRM_LOGIN_ACTION);
    expect(turnstile.latest().action).toBe("crm_login");
    // A token minted on the Academy is refused by the backend, so minting one
    // here would be a staff login form that cannot sign anybody in.
    expect(turnstile.latest().action).not.toBe("academy_login");
    expect(turnstile.latest().action).not.toBe("academy_register");
    expect(turnstile.latest().sitekey).toBe(TEST_SITE_KEY);
  });

  it("loads the official script exactly once", async () => {
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await waitFor(() => expect(turnstile.renders).toHaveLength(1));

    // The double installs `window.turnstile`, so no tag is needed at all — the
    // contract being asserted is that the widget never inserts a SECOND one.
    const tags = document.querySelectorAll('script[src^="https://challenges.cloudflare.com"]');
    expect(tags.length).toBeLessThanOrEqual(1);
  });

  it("keeps submission disabled until the challenge is solved", async () => {
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });
    const user = userEvent.setup();

    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await user.type(screen.getByLabelText(/рабочий email/i), VALID_EMAIL);
    await user.type(screen.getByLabelText(/^пароль$/i), VALID_PASSWORD);

    const button = screen.getByRole("button", { name: /войти/i });
    expect(button).toBeDisabled();
    const describedBy = button.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)).toHaveTextContent(
      "Пройдите проверку безопасности",
    );

    await turnstile.solve();
    expect(screen.getByRole("button", { name: /войти/i })).toBeEnabled();
  });

  it("clears the token when the challenge expires, times out or errors", async () => {
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);

    for (const lose of [
      () => turnstile.expire(),
      () => turnstile.timeout(),
      () => turnstile.fail(),
    ]) {
      await turnstile.solve();
      await waitFor(() => expect(screen.getByRole("button", { name: /войти/i })).toBeEnabled());
      await lose();
      await waitFor(() => expect(screen.getByRole("button", { name: /войти/i })).toBeDisabled());
    }
  });

  it("renews the challenge after invalid credentials, because the token was already spent", async () => {
    // The backend verifies the challenge BEFORE comparing the password, so a
    // wrong password still consumes the single-use token. Reusing it could only
    // produce `timeout-or-duplicate`.
    const user = userEvent.setup();
    const loginImpl = fail("invalid_credentials");
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={loginImpl} />);

    const before = turnstile.renders.length;
    await submit(user);
    await screen.findByRole("alert");

    await waitFor(() => expect(turnstile.renders.length).toBeGreaterThan(before));
  });

  it("renews the challenge after a CAPTCHA rejection and says so plainly", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("captcha_failed")} />);

    const before = turnstile.renders.length;
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Проверка безопасности не пройдена",
    );
    await waitFor(() => expect(turnstile.renders.length).toBeGreaterThan(before));
  });

  it("renews the challenge after a blocked account", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("inactive")} />);

    const before = turnstile.renders.length;
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Доступ приостановлен");
    await waitFor(() => expect(turnstile.renders.length).toBeGreaterThan(before));
  });

  it("keeps the token when the attempt never reached CAPTCHA validation", async () => {
    // A rate limit is refused ahead of verification and a transport failure may
    // never have arrived, so the token is provably unspent in both cases.
    for (const code of ["rate_limited", "upstream_unavailable"]) {
      resetTurnstileDouble();
      turnstile = installTurnstileDouble();
      const user = userEvent.setup();
      const view = render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail(code)} />);

      const before = turnstile.renders.length;
      await submit(user);
      await screen.findByRole("alert");

      expect(turnstile.renders.length).toBe(before);
      view.unmount();
    }
  });

  it("reports a provider outage and a broken configuration distinctly", async () => {
    for (const [code, text] of [
      ["captcha_unavailable", "Проверка безопасности недоступна"],
      ["captcha_configuration_error", "Вход временно недоступен"],
    ] as const) {
      resetTurnstileDouble();
      turnstile = installTurnstileDouble();
      const user = userEvent.setup();
      const view = render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail(code)} />);

      await submit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      view.unmount();
    }
  });

  it("renders an unavailable state and blocks submission when no site key is configured", async () => {
    const loginImpl = ok();
    render(<LoginForm turnstileSiteKey={null} loginImpl={loginImpl} />);

    expect(screen.getByTestId("captcha-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /войти/i })).toBeDisabled();
    expect(turnstile.renders).toHaveLength(0);
    expect(loginImpl).not.toHaveBeenCalled();
  });

  it("treats a malformed site key as unavailable, never as a pass", () => {
    render(<LoginForm turnstileSiteKey="not-a-site-key" loginImpl={ok()} />);
    expect(screen.getByTestId("captcha-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /войти/i })).toBeDisabled();
  });

  it("never persists the token in browser storage, the URL or the DOM", async () => {
    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={ok()} />);
    await submit(user);

    expect(JSON.stringify(window.localStorage)).not.toContain(DUMMY_TOKEN);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(DUMMY_TOKEN);
    expect(window.location.href).not.toContain(DUMMY_TOKEN);
    expect(document.cookie).not.toContain(DUMMY_TOKEN);
    expect(document.body.innerHTML).not.toContain(DUMMY_TOKEN);
  });

  it("never logs the token", async () => {
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }

    const user = userEvent.setup();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");

    expect(logged.join("\n")).not.toContain(DUMMY_TOKEN);
  });

  it("sends no legacy sentinel and forwards no extra field", async () => {
    const user = userEvent.setup();
    const loginImpl = ok();
    render(<LoginForm turnstileSiteKey={TEST_SITE_KEY} loginImpl={loginImpl} />);
    await submit(user);

    await waitFor(() => expect(loginImpl).toHaveBeenCalled());
    const [email, password, options] = loginImpl.mock.calls[0] as [
      string,
      string,
      { captchaToken?: string },
    ];
    expect(email).toBe(VALID_EMAIL);
    expect(password).toBe(VALID_PASSWORD);
    expect(options.captchaToken).toBe(DUMMY_TOKEN);
    expect(options.captchaToken).not.toBe("dev-captcha-ok");
    expect(Object.keys(options)).toEqual(["captchaToken"]);
  });
});
