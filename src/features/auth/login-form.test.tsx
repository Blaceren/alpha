import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./login-form";
import { RETURN_PATH_KEY } from "@/domain/identity/return-path";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

const VALID_EMAIL = "mentor@example.com";
const VALID_PASSWORD = "secret123";

beforeEach(() => {
  replace.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
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

async function submit(user: ReturnType<typeof userEvent.setup>, email = VALID_EMAIL, password = VALID_PASSWORD) {
  if (email) await user.type(screen.getByLabelText(/рабочий email/i), email);
  if (password) await user.type(screen.getByLabelText(/^пароль$/i), password);
  await user.click(screen.getByRole("button", { name: /войти/i }));
}

describe("LoginForm — idle", () => {
  it("renders a semantic labelled form", () => {
    render(<LoginForm loginImpl={ok()} />);

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
    render(<LoginForm loginImpl={ok()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the session-expired notice only when told to", () => {
    const { unmount } = render(<LoginForm loginImpl={ok()} />);
    expect(screen.queryByText(/сессия завершена/i)).not.toBeInTheDocument();
    unmount();

    render(<LoginForm loginImpl={ok()} sessionExpired />);
    expect(screen.getByText(/сессия завершена/i)).toBeInTheDocument();
  });
});

describe("LoginForm — submission", () => {
  it("calls the client with the trimmed email and the password", async () => {
    const user = userEvent.setup();
    const loginImpl = ok();
    render(<LoginForm loginImpl={loginImpl} />);

    await user.type(screen.getByLabelText(/рабочий email/i), `  ${VALID_EMAIL}  `);
    await user.type(screen.getByLabelText(/^пароль$/i), VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: /войти/i }));

    await waitFor(() => expect(loginImpl).toHaveBeenCalledWith(VALID_EMAIL, VALID_PASSWORD));
  });

  it("submits on Enter from the password field", async () => {
    const user = userEvent.setup();
    const loginImpl = ok();
    render(<LoginForm loginImpl={loginImpl} />);

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
    render(<LoginForm loginImpl={loginImpl} />);

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
    render(<LoginForm loginImpl={loginImpl} />);
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
    render(<LoginForm loginImpl={loginImpl} />);
    await submit(user, "not-an-email", VALID_PASSWORD);

    expect(loginImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/проверьте email и пароль/i);
  });

  it("rejects a short password without a request", async () => {
    const user = userEvent.setup();
    const loginImpl = ok();
    render(<LoginForm loginImpl={loginImpl} />);
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
    render(<LoginForm loginImpl={fail(code)} />);
    await submit(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(pattern);
  });

  it("does not render backend prose", async () => {
    const user = userEvent.setup();
    render(<LoginForm loginImpl={fail("invalid_credentials")} />);
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
    const { unmount } = render(<LoginForm loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    const first = (await screen.findByRole("alert")).textContent;
    unmount();

    const user2 = userEvent.setup();
    render(<LoginForm loginImpl={fail("invalid_credentials")} />);
    await submit(user2, "nobody@example.com", VALID_PASSWORD);
    expect((await screen.findByRole("alert")).textContent).toBe(first);
  });

  it("shows a requestId as a support reference when present", async () => {
    const user = userEvent.setup();
    render(<LoginForm loginImpl={fail("not_staff", "req-42")} />);
    await submit(user);
    expect(await screen.findByText(/req-42/)).toBeInTheDocument();
  });

  it("moves focus to the error summary", async () => {
    const user = userEvent.setup();
    render(<LoginForm loginImpl={fail("invalid_credentials")} />);
    await submit(user);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("re-enables the form after a failure", async () => {
    const user = userEvent.setup();
    render(<LoginForm loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: /войти/i })).toBeEnabled();
    expect(screen.getByLabelText(/рабочий email/i)).toBeEnabled();
  });
});

describe("LoginForm — password handling", () => {
  it("clears the password after a failure", async () => {
    const user = userEvent.setup();
    render(<LoginForm loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");

    expect(screen.getByLabelText(/^пароль$/i)).toHaveValue("");
  });

  it("clears the password after success", async () => {
    const user = userEvent.setup();
    render(<LoginForm loginImpl={ok()} />);
    await submit(user);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(screen.getByLabelText(/^пароль$/i)).toHaveValue("");
  });

  it("keeps the email so a retry does not require retyping it", async () => {
    const user = userEvent.setup();
    render(<LoginForm loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");

    expect(screen.getByLabelText(/рабочий email/i)).toHaveValue(VALID_EMAIL);
  });

  it("never writes the password to storage", async () => {
    const user = userEvent.setup();
    const localSet = vi.spyOn(window.localStorage, "setItem");
    const sessionSet = vi.spyOn(window.sessionStorage, "setItem");

    render(<LoginForm loginImpl={ok()} />);
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
    render(<LoginForm loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/users"));
  });

  it("returns to the remembered protected route", async () => {
    window.sessionStorage.setItem(RETURN_PATH_KEY, "/users/77");
    const user = userEvent.setup();
    render(<LoginForm loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/users/77"));
  });

  it("ignores a poisoned return path", async () => {
    window.sessionStorage.setItem(RETURN_PATH_KEY, "https://evil.test/steal");
    const user = userEvent.setup();
    render(<LoginForm loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/users"));
  });

  it("never redirects back to /login", async () => {
    window.sessionStorage.setItem(RETURN_PATH_KEY, "/login?reason=session_required");
    const user = userEvent.setup();
    render(<LoginForm loginImpl={ok()} />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/users"));
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining("/login"));
  });

  it("does not redirect on failure", async () => {
    const user = userEvent.setup();
    render(<LoginForm loginImpl={fail("invalid_credentials")} />);
    await submit(user);
    await screen.findByRole("alert");
    expect(replace).not.toHaveBeenCalled();
  });
});
