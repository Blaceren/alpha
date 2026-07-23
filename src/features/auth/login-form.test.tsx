import { describe, it, expect, vi, beforeEach } from "vitest";
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

const loginMock = vi.mocked(api.login);
const sessionMock = vi.mocked(api.fetchSession);

beforeEach(() => {
  replace.mockClear();
  loginMock.mockReset();
  sessionMock.mockReset();
  searchParams = new URLSearchParams();
});

describe("LoginForm", () => {
  it("logs in, confirms the session and redirects to a validated internal returnTo", async () => {
    searchParams = new URLSearchParams("next=/lessons/L2");
    loginMock.mockResolvedValue({ ok: true, data: { user: { id: 1, name: "A", role: "user" } }, requestId: null });
    sessionMock.mockResolvedValue({ ok: true, data: { user: { id: 1, name: "A", role: "user" } }, requestId: null });

    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret1");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/lessons/L2"));
    expect(sessionMock).toHaveBeenCalled();
  });

  it("redirects to root when returnTo is an external URL (open-redirect blocked)", async () => {
    searchParams = new URLSearchParams("next=https://evil.example.com");
    loginMock.mockResolvedValue({ ok: true, data: { user: { id: 1, name: "A", role: "user" } }, requestId: null });
    sessionMock.mockResolvedValue({ ok: true, data: { user: { id: 1, name: "A", role: "user" } }, requestId: null });

    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret1");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("shows a generic, enumeration-safe error on invalid credentials", async () => {
    loginMock.mockResolvedValue({ ok: false, error: makeError("INVALID_CREDENTIALS", { status: 401 }) });

    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Email"), "nobody@b.co");
    await userEvent.type(screen.getByLabelText("Пароль"), "wrong1");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Неверный email или пароль.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows a retryable message with a request id when the Backend is unavailable", async () => {
    loginMock.mockResolvedValue({ ok: false, error: makeError("BACKEND_UNAVAILABLE", { requestId: "req-77" }) });

    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret1");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Сервис временно недоступен");
    expect(alert).toHaveTextContent("req-77");
  });

  it("shows a rate-limit message on 429", async () => {
    loginMock.mockResolvedValue({ ok: false, error: makeError("RATE_LIMITED", { status: 429 }) });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret1");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Слишком много попыток");
  });

  it("uses password input semantics and autocomplete for password managers", () => {
    render(<LoginForm />);
    const password = screen.getByLabelText("Пароль");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
  });
});
