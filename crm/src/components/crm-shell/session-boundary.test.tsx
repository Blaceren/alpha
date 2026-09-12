import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionOutcome } from "@/application/session-client";
import { resetClientRuntimeMode } from "@/config/client-runtime-mode";
import { AppShell } from "./app-shell";
import { LOGIN_REDIRECT, SessionBoundary } from "./session-boundary";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/today",
}));

const VALID_DTO = {
  employeeId: "emp_7f3a9c",
  displayName: "Ирина Соколова",
  role: "support" as const,
  effectivePermissions: ["edit_user_notes" as const],
  permissionVersion: 3,
  expiresAt: "2026-07-20T18:30:00.000Z",
};

function outcome(o: SessionOutcome) {
  return async () => o;
}

/** Never resolves — models the loading state. */
const pending = () => new Promise<SessionOutcome>(() => {});

beforeEach(() => {
  replace.mockClear();
  resetClientRuntimeMode();
});

afterEach(() => resetClientRuntimeMode());

describe("SessionBoundary — loading", () => {
  it("shows a loading status and no children", async () => {
    render(
      <SessionBoundary fetchSessionImpl={pending as never}>
        <p>CRM FEATURE CHILD</p>
      </SessionBoundary>,
    );
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("CRM FEATURE CHILD")).not.toBeInTheDocument();
  });
});

describe("SessionBoundary — authenticated", () => {
  it("renders children once the session validates", async () => {
    render(
      <SessionBoundary fetchSessionImpl={outcome({ status: "authenticated", dto: VALID_DTO }) as never}>
        <p>CRM FEATURE CHILD</p>
      </SessionBoundary>,
    );
    expect(await screen.findByText("CRM FEATURE CHILD")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("SessionBoundary — 401", () => {
  it("redirects to the exact login URL and mounts no children", async () => {
    render(
      <SessionBoundary fetchSessionImpl={outcome({ status: "unauthenticated" }) as never}>
        <p>CRM FEATURE CHILD</p>
      </SessionBoundary>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith(LOGIN_REDIRECT));
    expect(LOGIN_REDIRECT).toBe("/login?reason=session_required");
    expect(screen.queryByText("CRM FEATURE CHILD")).not.toBeInTheDocument();
  });

  it("uses a fixed target with no caller-controlled redirect parameter", () => {
    // An open-redirect guard: the destination must not echo any input.
    expect(LOGIN_REDIRECT).not.toMatch(/(returnTo|next|redirect|url)=/);
  });
});

describe("SessionBoundary — 403", () => {
  it("renders the forbidden state without app chrome or children", async () => {
    render(
      <SessionBoundary fetchSessionImpl={outcome({ status: "forbidden" }) as never}>
        <p>CRM FEATURE CHILD</p>
      </SessionBoundary>,
    );
    expect(await screen.findByText("Нет доступа к CRM")).toBeInTheDocument();
    expect(screen.queryByText("CRM FEATURE CHILD")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("may show a requestId as a support reference", async () => {
    render(
      <SessionBoundary
        fetchSessionImpl={outcome({ status: "forbidden", requestId: "req_abc123" }) as never}
      >
        <p>child</p>
      </SessionBoundary>,
    );
    expect(await screen.findByText("req_abc123")).toBeInTheDocument();
  });
});

describe("SessionBoundary — upstream and malformed", () => {
  it("renders a retry state for an upstream failure", async () => {
    render(
      <SessionBoundary fetchSessionImpl={outcome({ status: "upstream_unavailable" }) as never}>
        <p>CRM FEATURE CHILD</p>
      </SessionBoundary>,
    );
    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    expect(screen.queryByText("CRM FEATURE CHILD")).not.toBeInTheDocument();
  });

  it("renders a fail-closed state for a malformed response", async () => {
    render(
      <SessionBoundary fetchSessionImpl={outcome({ status: "malformed_response" }) as never}>
        <p>CRM FEATURE CHILD</p>
      </SessionBoundary>,
    );
    expect(await screen.findByText("Некорректный ответ сервиса")).toBeInTheDocument();
    expect(screen.queryByText("CRM FEATURE CHILD")).not.toBeInTheDocument();
  });

  it("shows no raw exception text", async () => {
    render(
      <SessionBoundary fetchSessionImpl={outcome({ status: "upstream_unavailable" }) as never}>
        <p>child</p>
      </SessionBoundary>,
    );
    await screen.findByText("Сервис недоступен");
    const html = document.body.innerHTML;
    for (const leak of ["ECONNREFUSED", "TypeError", "Failed to fetch", "stack", "127.0.0.1"]) {
      expect(html).not.toContain(leak);
    }
  });
});

describe("SessionBoundary — retry", () => {
  it("recovers when the retry succeeds", async () => {
    const user = userEvent.setup();
    const impl = vi
      .fn<() => Promise<SessionOutcome>>()
      .mockResolvedValueOnce({ status: "upstream_unavailable" })
      .mockResolvedValueOnce({ status: "authenticated", dto: VALID_DTO });

    render(
      <SessionBoundary fetchSessionImpl={impl as never}>
        <p>CRM FEATURE CHILD</p>
      </SessionBoundary>,
    );
    await user.click(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("CRM FEATURE CHILD")).toBeInTheDocument();
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("does not start a second concurrent retry", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const impl = vi.fn(async (): Promise<SessionOutcome> => {
      calls += 1;
      if (calls === 1) return { status: "upstream_unavailable" };
      // Second call hangs, so the button stays clickable in the retrying state.
      return new Promise<SessionOutcome>(() => {});
    });

    render(
      <SessionBoundary fetchSessionImpl={impl as never}>
        <p>child</p>
      </SessionBoundary>,
    );
    const button = await screen.findByRole("button", { name: "Повторить" });
    await user.click(button);
    await user.click(button).catch(() => {});
    await user.click(button).catch(() => {});

    // One initial load + exactly one retry, despite three clicks.
    expect(impl).toHaveBeenCalledTimes(2);
  });
});

describe("AppShell — mode routing", () => {
  it("mock mode renders children immediately and never fetches", async () => {
    const impl = vi.fn();
    render(
      <AppShell mode="mock">
        <p>MOCK CHILD</p>
      </AppShell>,
    );
    expect(await screen.findByText("MOCK CHILD")).toBeInTheDocument();
    expect(impl).not.toHaveBeenCalled();
  });
});
