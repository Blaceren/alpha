import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/account/account-client", () => ({
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  verifyEmail: vi.fn(),
  confirmEmailChange: vi.fn(),
}));

import * as client from "@/lib/account/account-client";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { LinkConfirmation } from "@/features/auth/link-confirmation";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { TURNSTILE_LOGIN_ACTION, TURNSTILE_PASSWORD_RESET_ACTION, TURNSTILE_REGISTER_ACTION } from "@/lib/auth/turnstile";
import { DUMMY_TOKEN, TEST_SITE_KEY, installTurnstileDouble, resetTurnstileDouble, type TurnstileDouble } from "@/test/turnstile-double";

/**
 * ACCOUNT RECOVERY — the three forms a learner meets: ask for a link, set a
 * password with it, confirm an address with one.
 */

const requestMock = vi.mocked(client.requestPasswordReset);
const confirmMock = vi.mocked(client.confirmPasswordReset);
const verifyMock = vi.mocked(client.verifyEmail);
const changeMock = vi.mocked(client.confirmEmailChange);

const TOKEN = "T".repeat(43);
let turnstile: TurnstileDouble;

function arriveWith(hash: string, path = "/reset-password") {
  window.history.replaceState(null, "", `${path}${hash}`);
}

beforeEach(() => {
  for (const mock of [requestMock, confirmMock, verifyMock, changeMock]) mock.mockReset();
  turnstile = installTurnstileDouble();
});
afterEach(() => {
  resetTurnstileDouble();
  window.history.replaceState(null, "", "/");
});

describe("asking for a reset link", () => {
  async function fill(email: string) {
    render(<ForgotPasswordForm turnstileSiteKey={TEST_SITE_KEY} />);
    await userEvent.type(screen.getByLabelText("Email"), email);
    await waitFor(() => expect(screen.getByRole("button", { name: "Отправить ссылку" })).toBeEnabled());
  }

  it("raises its own challenge — not the login's, not the registration's", async () => {
    await fill("a@example.invalid");
    expect(turnstile.renders[0]!.action).toBe(TURNSTILE_PASSWORD_RESET_ACTION);
    expect(TURNSTILE_PASSWORD_RESET_ACTION).toBe("academy_password_reset");
    expect(new Set([TURNSTILE_PASSWORD_RESET_ACTION, TURNSTILE_LOGIN_ACTION, TURNSTILE_REGISTER_ACTION]).size).toBe(3);
  });

  it("sends the normalised address with the token, and answers the same for every address", async () => {
    requestMock.mockResolvedValue({ ok: true });
    await fill("  Known@Example.invalid ");
    await userEvent.click(screen.getByRole("button", { name: "Отправить ссылку" }));
    expect(requestMock).toHaveBeenCalledWith({ email: "known@example.invalid", captchaToken: DUMMY_TOKEN });
    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("Если адрес known@example.invalid зарегистрирован");
    expect(done.textContent).toContain("60 минут");
    // The page never says whether the account exists.
    expect(document.body.textContent).not.toMatch(/не найден|не зарегистрирован|нет такого/i);
    expect(screen.getByRole("link", { name: "Вернуться ко входу" }).getAttribute("href")).toBe("/login");
  });

  it("refuses locally what is not an address, without spending a request", async () => {
    await fill("not-an-address");
    await userEvent.click(screen.getByRole("button", { name: "Отправить ссылку" }));
    expect(requestMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Проверьте адрес почты");
  });

  it("renews the challenge after a rejected one, and keeps it after a refusal that never reached it", async () => {
    requestMock.mockResolvedValueOnce({ ok: false, failure: "RATE_LIMITED", requestId: null });
    await fill("a@example.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Отправить ссылку" }));
    await screen.findByText("Слишком много запросов. Попробуйте позже.");
    expect(turnstile.renders).toHaveLength(1);

    requestMock.mockResolvedValueOnce({ ok: false, failure: "CAPTCHA_FAILED", requestId: "req-1" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Отправить ссылку" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Отправить ссылку" }));
    await screen.findByText("Проверка не пройдена. Пройдите её ещё раз.");
    expect(screen.getByRole("alert").textContent).toContain("req-1");
  });

  it("does not offer a form it cannot protect", () => {
    render(<ForgotPasswordForm turnstileSiteKey={null} />);
    expect(screen.getByTestId("captcha-unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отправить ссылку" })).toBeDisabled();
  });
});

describe("setting a new password with the link", () => {
  it("says so when the link carries no token, and offers a new one", async () => {
    arriveWith("");
    render(<ResetPasswordForm />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Ссылка неполная");
    expect(screen.getByRole("link", { name: "Запросить новую ссылку" }).getAttribute("href")).toBe("/forgot-password");
    expect(screen.queryByLabelText("Новый пароль")).toBeNull();
  });

  it("takes the token out of the address bar, checks the two fields, and sends token and password in one body", async () => {
    confirmMock.mockResolvedValue({ ok: true });
    arriveWith(`#token=${TOKEN}`);
    render(<ResetPasswordForm />);
    const password = await screen.findByLabelText("Новый пароль");
    expect(window.location.hash).toBe("");

    await userEvent.type(password, "123");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "123");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    expect(screen.getByRole("alert").textContent).toContain("не короче 6");

    await userEvent.clear(password);
    await userEvent.type(password, "New-password-2");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    expect(screen.getByRole("alert").textContent).toContain("Пароли не совпадают");
    expect(confirmMock).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Повторите пароль"));
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "New-password-2");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    expect(confirmMock).toHaveBeenCalledWith({ token: TOKEN, newPassword: "New-password-2" });

    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("Пароль изменён");
    expect(done.textContent).toContain("Все прежние сеансы завершены");
    // A reset signs nobody in: the way on is the login page.
    expect(screen.getByRole("link", { name: "Перейти ко входу" }).getAttribute("href")).toBe("/login");
    expect(document.body.innerHTML).not.toContain("New-password-2");
  });

  it("has one sentence for every dead link", async () => {
    confirmMock.mockResolvedValue({ ok: false, failure: "INVALID_TOKEN" });
    arriveWith(`#token=${TOKEN}`);
    render(<ResetPasswordForm />);
    await userEvent.type(await screen.findByLabelText("Новый пароль"), "New-password-2");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "New-password-2");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Ссылка больше не действует");
    expect(screen.getByRole("link", { name: "Запросить новую ссылку" }).getAttribute("href")).toBe("/forgot-password");
    expect(screen.queryByLabelText("Новый пароль")).toBeNull();
  });

  it("keeps the form and the link after a failure that was not the link's", async () => {
    confirmMock.mockResolvedValueOnce({ ok: false, failure: "FAILED" }).mockResolvedValueOnce({ ok: true });
    arriveWith(`#token=${TOKEN}`);
    render(<ResetPasswordForm />);
    await userEvent.type(await screen.findByLabelText("Новый пароль"), "New-password-2");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "New-password-2");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    await screen.findByText("Не удалось сохранить пароль. Повторите попытку.");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    await screen.findByText("Пароль изменён");
    expect(confirmMock.mock.calls.map((call) => call[0].token)).toEqual([TOKEN, TOKEN]);
  });
});

describe("a link pasted into the tab that is already open", () => {
  /* Only the fragment differs from the page on screen, so the browser loads
     nothing and reports `hashchange`. */
  async function paste(path: string) {
    window.history.pushState(null, "", `${path}#token=${TOKEN}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  it("turns «ссылка неполная» into the form, and takes the token out of the address bar", async () => {
    arriveWith("", "/reset-password");
    render(<ResetPasswordForm />);
    expect((await screen.findByRole("alert")).textContent).toContain("Ссылка неполная");
    await paste("/reset-password");
    expect(await screen.findByLabelText("Новый пароль")).toBeTruthy();
    expect(window.location.hash).toBe("");

    confirmMock.mockResolvedValue({ ok: true });
    await userEvent.type(screen.getByLabelText("Новый пароль"), "New-password-1");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "New-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    expect(confirmMock).toHaveBeenCalledWith({ token: TOKEN, newPassword: "New-password-1" });
  });

  it("does the same for a confirmation, including after a dead link", async () => {
    verifyMock.mockResolvedValueOnce({ ok: false, failure: "INVALID_TOKEN" }).mockResolvedValueOnce({ ok: true });
    arriveWith(`#token=${"D".repeat(43)}`, "/verify-email");
    render(<LinkConfirmation kind="verify-email" />);
    await userEvent.click(await screen.findByRole("button", { name: "Подтвердить почту" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Ссылка больше не действует");

    await paste("/verify-email");
    await userEvent.click(await screen.findByRole("button", { name: "Подтвердить почту" }));
    expect(verifyMock).toHaveBeenLastCalledWith(TOKEN);
    expect((await screen.findByRole("status")).textContent).toContain("Почта подтверждена");
    expect(window.location.hash).toBe("");
  });

  it("is not disturbed by a fragment that is not a link", async () => {
    arriveWith(`#token=${TOKEN}`, "/verify-email");
    render(<LinkConfirmation kind="verify-email" />);
    await screen.findByRole("button", { name: "Подтвердить почту" });
    window.history.pushState(null, "", "/verify-email#top");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    verifyMock.mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Подтвердить почту" }));
    expect(verifyMock).toHaveBeenCalledWith(TOKEN);
  });
});

describe("confirming an address with the link", () => {
  it("does nothing until the button is pressed — opening the page spends no link", async () => {
    verifyMock.mockResolvedValue({ ok: true });
    arriveWith(`#token=${TOKEN}`, "/verify-email");
    render(<LinkConfirmation kind="verify-email" />);
    const button = await screen.findByRole("button", { name: "Подтвердить почту" });
    expect(window.location.hash).toBe("");
    expect(verifyMock).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(verifyMock).toHaveBeenCalledWith(TOKEN);
    expect((await screen.findByRole("status")).textContent).toContain("Почта подтверждена");
  });

  it("confirms a new address through its own route", async () => {
    changeMock.mockResolvedValue({ ok: true });
    arriveWith(`#token=${TOKEN}`, "/confirm-email");
    render(<LinkConfirmation kind="email-change" />);
    await userEvent.click(await screen.findByRole("button", { name: "Подтвердить новый адрес" }));
    expect(changeMock).toHaveBeenCalledWith(TOKEN);
    expect(verifyMock).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain("Почта аккаунта изменена");
  });

  it("is final about a dead link and a taken address, and lets a transient failure be retried", async () => {
    changeMock.mockResolvedValueOnce({ ok: false, failure: "FAILED" }).mockResolvedValueOnce({ ok: false, failure: "EMAIL_IN_USE" });
    arriveWith(`#token=${TOKEN}`, "/confirm-email");
    render(<LinkConfirmation kind="email-change" />);
    await userEvent.click(await screen.findByRole("button", { name: "Подтвердить новый адрес" }));
    await screen.findByText("Не удалось подтвердить");
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    await userEvent.click(await screen.findByRole("button", { name: "Подтвердить новый адрес" }));
    await screen.findByText("Этот адрес уже занят");
    expect(screen.queryByRole("button", { name: "Попробовать ещё раз" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Почта вашего аккаунта не изменилась");
  });

  it("says so when the link carries no token", async () => {
    arriveWith("", "/verify-email");
    render(<LinkConfirmation kind="verify-email" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Ссылка неполная");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
