import { POST_REGISTRATION_RETURN_TO } from "@/lib/auth/return-to";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const refresh = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/api/client", () => ({ register: vi.fn() }));

import * as api from "@/lib/api/client";
import { RegisterForm } from "@/features/auth/register-form";
import { makeError, normalizeHttpError } from "@/lib/api/errors";
import {
  installTurnstileDouble,
  resetTurnstileDouble,
  TEST_SITE_KEY,
  DUMMY_TOKEN,
  type TurnstileDouble,
} from "@/test/turnstile-double";

const registerMock = vi.mocked(api.register);

/**
 * The live Turnstile double for the current test. Installed in `beforeEach` in
 * auto-solve mode so the many tests that only exercise form behaviour get a
 * token without each having to drive the challenge; the tests that care about
 * the challenge itself re-install it with `autoSolve: false`.
 */
let turnstile: TurnstileDouble;

/**
 * Render with the PUBLISHED Cloudflare test site key. The key is documentation,
 * not a credential, and the SECRET counterpart lives only in the Backend.
 */
function renderForm(siteKey: string | null = TEST_SITE_KEY) {
  return render(<RegisterForm turnstileSiteKey={siteKey} />);
}

/** First (and only) payload the form sent. Fails loudly if it never called. */
function sentPayload(): api.RegistrationInput {
  const call = registerMock.mock.calls[0];
  if (!call) throw new Error("api.register was not called");
  return call[0];
}


const CREATED = {
  ok: true as const,
  data: { user: { id: 7, name: "Трейдер-1234", role: "user" }, verification: { required: false } },
  requestId: null,
};

function created(over: { required?: boolean } = {}) {
  return {
    ...CREATED,
    data: { ...CREATED.data, verification: { required: over.required ?? false } },
  };
}

/**
 * Fill every required field AND wait for the challenge to produce a token.
 *
 * The wait is part of "the form is valid" now: submit is disabled until a token
 * exists, so a test that typed three fields and clicked would click a disabled
 * button and silently assert nothing.
 */
async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "Learner@Example.COM");
  await user.type(screen.getByLabelText("Пароль"), "Passw0rd");
  await user.type(screen.getByLabelText("Повторите пароль"), "Passw0rd");
  await waitFor(() => expect(submitButton()).toBeEnabled());
}

function submitButton() {
  return screen.getByRole("button", { name: /Создать аккаунт|Создаём аккаунт/ });
}

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
  registerMock.mockReset();
  searchParams = new URLSearchParams();
  turnstile = installTurnstileDouble();
});

afterEach(() => {
  vi.useRealTimers();
  resetTurnstileDouble();
});

describe("RegisterForm — DTO mapping", () => {
  it("sends exactly the authoritative DTO fields and invents none", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
    const payload = sentPayload();

    expect(Object.keys(payload).sort()).toEqual([
      "captchaToken",
      "email",
      "name",
      "password",
      "referralCode",
    ]);
    // No invented fields anywhere in the payload.
    for (const invented of ["firstName", "lastName", "phone", "telegram", "country", "consent", "experience"]) {
      expect(payload).not.toHaveProperty(invented);
    }
  });

  it("normalizes the email exactly as Backend does", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(sentPayload().email).toBe("learner@example.com");
  });

  it("never sends the client-only password confirmation", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(sentPayload()).not.toHaveProperty("confirmPassword");
  });

  it("omits a blank optional name instead of sending an empty string", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(sentPayload().name).toBeUndefined();
  });

  it("sends a provided name", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.type(screen.getByLabelText(/^Имя/), "  Аня  ");
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(sentPayload().name).toBe("Аня");
  });

  it("sends the token the widget produced, and never a fabricated one", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    // Exactly what the challenge minted — not a sentinel, not a constant, not
    // the "dev-captcha-ok" string the Backend's own legacy page hard-codes.
    expect(sentPayload().captchaToken).toBe(DUMMY_TOKEN);
    expect(sentPayload().captchaToken).not.toBe("dev-captcha-ok");
  });
});

describe("RegisterForm — referral", () => {
  it("forwards a valid ?ref and shows referral context", async () => {
    searchParams = new URLSearchParams("ref=ABC123");
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    expect(screen.getByTestId("referral-valid")).toBeTruthy();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(sentPayload().referralCode).toBe("ABC123");
  });

  it("registers normally with no ?ref at all", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    expect(screen.queryByTestId("referral-valid")).toBeNull();
    expect(screen.queryByTestId("referral-malformed")).toBeNull();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(sentPayload().referralCode).toBeUndefined();
  });

  it("drops a malformed ?ref, says so, and still allows registration", async () => {
    searchParams = new URLSearchParams("ref=" + encodeURIComponent("<script>alert(1)</script>"));
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    expect(screen.getByTestId("referral-malformed")).toBeTruthy();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(sentPayload().referralCode).toBeUndefined();
  });

  it("does not claim the referral succeeded merely because it was in the URL", async () => {
    searchParams = new URLSearchParams("ref=ABC123");
    const user = userEvent.setup();
    registerMock.mockResolvedValue(
      normalizeFailure({ status: 400, body: { error: "REFERRAL_INVALID", message: "…" } }),
    );

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    const error = await screen.findByTestId("register-error");
    expect(error.textContent).toContain("Ссылка-приглашение недействительна");
  });

  it("a ref value cannot redirect the user anywhere", async () => {
    searchParams = new URLSearchParams("ref=" + encodeURIComponent("https://evil.example.com"));
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining("evil.example.com"));
  });
});

function normalizeFailure(args: { status: number; body?: unknown }) {
  return { ok: false as const, error: normalizeHttpError(args) };
}

describe("RegisterForm — validation states", () => {
  it("blocks submission and shows a field error for an invalid email", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Email"), "nope");
    await user.type(screen.getByLabelText("Пароль"), "Passw0rd");
    await user.type(screen.getByLabelText("Повторите пароль"), "Passw0rd");
    await user.click(submitButton());

    expect(await screen.findByText("Введите корректный email.")).toBeTruthy();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("blocks submission for a password that fails the Backend policy", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Пароль"), "password");
    await user.type(screen.getByLabelText("Повторите пароль"), "password");
    await user.click(submitButton());

    expect(await screen.findByText("Добавьте заглавную букву.")).toBeTruthy();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("blocks submission when the confirmation does not match", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Пароль"), "Passw0rd");
    await user.type(screen.getByLabelText("Повторите пароль"), "Different1");
    await user.click(submitButton());

    expect(await screen.findByText("Пароли не совпадают.")).toBeTruthy();
    expect(registerMock).not.toHaveBeenCalled();
  });
});

describe("RegisterForm — server states", () => {
  it("shows the duplicate-email state and clears the password fields", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(normalizeFailure({ status: 400, body: { error: "Email уже занят" } }));

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    const error = await screen.findByTestId("register-error");
    expect(error.textContent).toContain("Этот email уже зарегистрирован");
    // Email is preserved so the user need not retype it; secrets are cleared.
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("Learner@Example.COM");
    expect((screen.getByLabelText("Пароль") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Повторите пароль") as HTMLInputElement).value).toBe("");
  });

  it("shows the rate-limit state", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(
      normalizeFailure({ status: 429, body: { error: "RATE_LIMITED", message: "…" } }),
    );

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    expect((await screen.findByTestId("register-error")).textContent).toContain("Слишком много попыток");
  });

  it("shows the CAPTCHA-failed state", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(
      normalizeFailure({ status: 400, body: { error: "CAPTCHA_FAILED", message: "…" } }),
    );

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    expect((await screen.findByTestId("register-error")).textContent).toContain("Проверка не пройдена");
  });

  it("shows the Backend-validation state", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(
      normalizeFailure({
        status: 400,
        body: { error: "VALIDATION_ERROR", message: "…", details: [{ field: "password", message: "…" }] },
      }),
    );

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    expect((await screen.findByTestId("register-error")).textContent).toContain("Проверьте введённые данные");
  });

  it("shows the Backend-unavailable state", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(normalizeFailure({ status: 502 }));

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    expect((await screen.findByTestId("register-error")).textContent).toContain("Сервис временно недоступен");
  });

  it("shows a bounded generic message for an unknown failure", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue({ ok: false, error: makeError("MALFORMED_RESPONSE") });

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    expect((await screen.findByTestId("register-error")).textContent).toContain("Не удалось создать аккаунт");
  });

  it("surfaces the request id for support without leaking anything else", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue({
      ok: false,
      error: { ...normalizeHttpError({ status: 502 }), requestId: "req-42" },
    });

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    expect((await screen.findByTestId("register-error")).textContent).toContain("req-42");
  });

  it("never retries automatically", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(normalizeFailure({ status: 502 }));

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await screen.findByTestId("register-error");
    expect(registerMock).toHaveBeenCalledTimes(1);
  });
});

describe("RegisterForm — loading and duplicate submission", () => {
  it("disables the form and announces progress while submitting", async () => {
    const user = userEvent.setup();
    let resolve!: (value: ReturnType<typeof created>) => void;
    registerMock.mockReturnValue(new Promise((r) => { resolve = r; }));

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(submitButton().getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Создаём аккаунт, подождите.")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeDisabled();

    resolve(created());
    await screen.findByText("Аккаунт создан");
  });

  it("sends exactly one request for a rapid double activation", async () => {
    const user = userEvent.setup();
    let resolve!: (value: ReturnType<typeof created>) => void;
    registerMock.mockReturnValue(new Promise((r) => { resolve = r; }));

    renderForm();
    await fillValidForm(user);
    const button = submitButton();
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(registerMock).toHaveBeenCalledTimes(1);
    resolve(created());
    await screen.findByText("Аккаунт создан");
  });
});

describe("RegisterForm — success", () => {
  it("shows the success state and does not navigate on its own", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await screen.findByText("Аккаунт создан");
    expect(screen.getByText(/learner@example\.com/)).toBeTruthy();
    // Success is announced, never inferred from a navigation that already happened.
    expect(replace).not.toHaveBeenCalled();
  });

  it("routes to an existing internal destination only when the user asks", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await user.click(await screen.findByRole("button", { name: "Продолжить" }));
    // The registration destination has its own constant, deliberately separate
    // from the login default so a routing change cannot move the onboarding
    // flow as a side effect.
    expect(replace).toHaveBeenCalledWith(POST_REGISTRATION_RETURN_TO);
  });

  it("does not claim a session when Backend requires email verification", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created({ required: true }));

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await screen.findByText("Аккаунт создан");
    expect(screen.getByText(/Подтвердите email/)).toBeTruthy();
    expect(screen.queryByText("Вы уже вошли в систему.")).toBeNull();
    // An explicit login action, never a fabricated session.
    expect(screen.getByRole("link", { name: "Перейти ко входу" }).getAttribute("href")).toBe("/login");
  });

  it("makes no further registration request after success", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await screen.findByText("Аккаунт создан");
    expect(registerMock).toHaveBeenCalledTimes(1);
  });
});

describe("RegisterForm — accessibility", () => {
  it("labels every field explicitly", () => {
    renderForm();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText(/^Имя/)).toBeTruthy();
    expect(screen.getByLabelText("Пароль")).toBeTruthy();
    expect(screen.getByLabelText("Повторите пароль")).toBeTruthy();
  });

  it("uses autocomplete values appropriate to a new-account form", () => {
    renderForm();
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("email");
    expect(screen.getByLabelText("Пароль").getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByLabelText("Повторите пароль").getAttribute("autocomplete")).toBe("new-password");
  });

  it("associates each field error with its field", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Email"), "nope");
    await user.type(screen.getByLabelText("Пароль"), "Passw0rd");
    await user.type(screen.getByLabelText("Повторите пароль"), "Passw0rd");
    await user.click(submitButton());

    const email = await screen.findByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    const describedBy = email.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Введите корректный email.");
  });

  it("announces the error summary and moves focus to it", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(normalizeFailure({ status: 502 }));

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    const summary = await screen.findByTestId("register-error");
    expect(summary.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(document.activeElement).toBe(summary));
  });

  it("submits from the keyboard", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.type(screen.getByLabelText("Повторите пароль"), "{Enter}");

    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
  });

  it("offers the login link for people who already have an account", () => {
    renderForm();
    expect(screen.getByRole("link", { name: "Войти" }).getAttribute("href")).toBe("/login");
  });
});

describe("RegisterForm — security", () => {
  it("never writes registration data to web storage", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());
    const localSet = vi.spyOn(Storage.prototype, "setItem");

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByText("Аккаунт создан");

    expect(localSet).not.toHaveBeenCalled();
    localSet.mockRestore();
  });

  it("never logs the password or a captcha token", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(normalizeFailure({ status: 400, body: { error: "Email уже занят" } }));
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByTestId("register-error");

    const logged = spies.flatMap((spy) => spy.mock.calls.flat()).map(String).join(" ");
    expect(logged).not.toContain("Passw0rd");
    expect(logged).not.toContain("captchaToken");
    for (const spy of spies) spy.mockRestore();
  });

  it("keeps the password out of the URL", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());
    await screen.findByText("Аккаунт создан");

    expect(window.location.search).not.toContain("Passw0rd");
    expect(window.location.href).not.toContain("Passw0rd");
  });

  it("does not expose the Backend dev verification token", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue({
      ...created({ required: true }),
      // Even if Backend sends devToken, the consumed type ignores it.
      data: {
        user: { id: 7, name: "n", role: "user" },
        verification: { required: true, devToken: "SECRET-DEV-TOKEN" },
      },
    } as never);

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());

    await screen.findByText("Аккаунт создан");
    expect(document.body.textContent).not.toContain("SECRET-DEV-TOKEN");
  });
});

// ===========================================================================
// AFD-3A2 — Turnstile integration in the registration form.
// ===========================================================================

describe("RegisterForm — Turnstile gating", () => {
  it("blocks submission until the challenge produces a token", async () => {
    const user = userEvent.setup();
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });
    registerMock.mockResolvedValue(created());

    renderForm();
    await user.type(screen.getByLabelText("Email"), "learner@example.com");
    await user.type(screen.getByLabelText("Пароль"), "Passw0rd");
    await user.type(screen.getByLabelText("Повторите пароль"), "Passw0rd");

    // Every field is valid; only the challenge is outstanding.
    expect(submitButton()).toBeDisabled();
    await user.click(submitButton());
    expect(registerMock).not.toHaveBeenCalled();

    await turnstile.solve();
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it("tells the user, in a live region, that the challenge is outstanding", async () => {
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });

    renderForm();

    const statuses = screen.getAllByRole("status");
    const text = statuses.map((node) => node.textContent).join(" ");
    expect(text).toContain("Пройдите проверку безопасности");
  });

  it("re-disables submission when a solved token later expires", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    expect(submitButton()).toBeEnabled();

    await turnstile.expire();

    // A five-minute-old token is worthless; the form must not let it be sent.
    await waitFor(() => expect(submitButton()).toBeDisabled());
  });

  it.each([
    ["timeout", () => turnstile.timeout()],
    ["provider error", () => turnstile.fail()],
  ])("re-disables submission after a %s", async (_label, drive) => {
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    expect(submitButton()).toBeEnabled();

    await drive();

    await waitFor(() => expect(submitButton()).toBeDisabled());
  });

  it("renders an unavailable state and blocks submission with no site key", async () => {
    const user = userEvent.setup();
    renderForm(null);

    await user.type(screen.getByLabelText("Email"), "learner@example.com");
    await user.type(screen.getByLabelText("Пароль"), "Passw0rd");
    await user.type(screen.getByLabelText("Повторите пароль"), "Passw0rd");

    // The decisive assertion: an unconfigured provider must NOT silently hide
    // the challenge and let the request through.
    expect(screen.getByTestId("captcha-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("turnstile-widget")).toBeNull();
    expect(submitButton()).toBeDisabled();

    await user.click(submitButton());
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("renders an unavailable state for a malformed site key", () => {
    renderForm("not-a-site-key");

    expect(screen.getByTestId("captcha-unavailable")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });
});

describe("RegisterForm — Turnstile failure recovery", () => {
  async function submitAndFail(status: number, code: string) {
    const user = userEvent.setup();
    registerMock.mockResolvedValue({
      ok: false as const,
      error: normalizeHttpError({ status, body: { error: code } }),
    } as never);

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());
    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    return user;
  }

  it.each([
    [400, "CAPTCHA_FAILED", "Проверка не пройдена"],
    [503, "CAPTCHA_UNAVAILABLE", "Сервис проверки временно недоступен"],
    [503, "CAPTCHA_CONFIGURATION_ERROR", "Проверка недоступна"],
  ])("maps %s %s to its own message", async (status, code, expected) => {
    await submitAndFail(status, code);
    expect(await screen.findByTestId("register-error")).toHaveTextContent(expected);
  });

  it("resets the widget after a consumed-token failure", async () => {
    const rendersBefore = turnstile.renders.length;
    await submitAndFail(400, "CAPTCHA_FAILED");

    // A Turnstile token is single-use: replaying it can only produce
    // `timeout-or-duplicate`, so a new challenge is mandatory, not cosmetic.
    await waitFor(() => expect(turnstile.renders.length).toBeGreaterThan(rendersBefore));
    expect(turnstile.removed.length).toBeGreaterThan(0);
  });

  it("re-enables submission only once a NEW token arrives", async () => {
    resetTurnstileDouble();
    turnstile = installTurnstileDouble({ autoSolve: false });
    const user = userEvent.setup();
    registerMock.mockResolvedValue({
      ok: false as const,
      error: normalizeHttpError({ status: 400, body: { error: "CAPTCHA_FAILED" } }),
    } as never);

    renderForm();
    await user.type(screen.getByLabelText("Email"), "learner@example.com");
    await user.type(screen.getByLabelText("Пароль"), "Passw0rd");
    await user.type(screen.getByLabelText("Повторите пароль"), "Passw0rd");
    await turnstile.solve("first-token");
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    await waitFor(() => expect(submitButton()).toBeDisabled());
    await turnstile.solve("second-token");
    await waitFor(() => expect(submitButton()).toBeEnabled());

    await user.click(submitButton());
    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(2));
    // The retry must carry the NEW token, never the spent one.
    const retry = registerMock.mock.calls[1];
    if (!retry) throw new Error("the retry never reached api.register");
    expect(retry[0].captchaToken).toBe("second-token");
  });

  it("keeps the referral code across a CAPTCHA failure and retry", async () => {
    searchParams = new URLSearchParams("ref=invite-abc123");
    await submitAndFail(400, "CAPTCHA_FAILED");

    expect(sentPayload().referralCode).toBe("invite-abc123");
    expect(screen.getByTestId("referral-valid")).toBeInTheDocument();
  });
});

describe("RegisterForm — token confinement", () => {
  it("puts the token in the request body and nowhere else", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());
    await waitFor(() => expect(registerMock).toHaveBeenCalled());

    expect(sentPayload().captchaToken).toBe(DUMMY_TOKEN);
    expect(window.location.href).not.toContain(DUMMY_TOKEN);
    expect(window.location.search).not.toContain(DUMMY_TOKEN);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(DUMMY_TOKEN);
  });

  it("adds no affiliate or attribution field alongside the token", async () => {
    const user = userEvent.setup();
    registerMock.mockResolvedValue(created());

    renderForm();
    await fillValidForm(user);
    await user.click(submitButton());
    await waitFor(() => expect(registerMock).toHaveBeenCalled());

    // ATA invitation referral is not affiliate acquisition attribution and not
    // a Pocket click id. None of those belong in a registration payload.
    for (const forbidden of ["ataClickId", "clickid", "click_id", "externalAffiliateClickId", "affiliateCode", "publicCode"]) {
      expect(sentPayload()).not.toHaveProperty(forbidden);
    }
  });
});
