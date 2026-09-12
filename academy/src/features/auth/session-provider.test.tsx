import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/lib/api/client", () => ({ logout: vi.fn(), fetchSession: vi.fn() }));

import * as api from "@/lib/api/client";
import { SessionProvider } from "@/features/auth/session-provider";
import { useSession } from "@/features/auth/use-session";
import type { SessionState } from "@/features/auth/session-machine";
import type { AcademyViewer } from "@/lib/api/viewer";

const logoutMock = vi.mocked(api.logout);
const sessionMock = vi.mocked(api.fetchSession);

const viewer: AcademyViewer = { id: "1", name: "Артём", role: "user", status: "active", synthetic: false };

function Probe() {
  const { state, viewer: v, logout, refresh } = useSession();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="name">{v?.name ?? "none"}</span>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

function renderWith(initial: SessionState) {
  return render(
    <SessionProvider initialState={initial}>
      <Probe />
    </SessionProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  logoutMock.mockReset();
  sessionMock.mockReset();
});

describe("SessionProvider", () => {
  it("renders the authenticated viewer from the server-provided initial state (no flash)", () => {
    renderWith({ status: "AUTHENTICATED", viewer });
    expect(screen.getByTestId("status")).toHaveTextContent("AUTHENTICATED");
    expect(screen.getByTestId("name")).toHaveTextContent("Артём");
  });

  it("logout runs the server mutation, clears the viewer and returns to /login", async () => {
    logoutMock.mockResolvedValue({ ok: true, data: { ok: true }, requestId: null });
    renderWith({ status: "AUTHENTICATED", viewer });

    await userEvent.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status")).toHaveTextContent("UNAUTHENTICATED");
  });

  it("logout does not delete user drafts (Trading Journal / report drafts)", async () => {
    logoutMock.mockResolvedValue({ ok: true, data: { ok: true }, requestId: null });
    window.localStorage.setItem("ata.tools.trading-journal.v1", "journal-data");
    window.localStorage.setItem("ata.report-workspace.v3", "draft-data");

    renderWith({ status: "AUTHENTICATED", viewer });
    await userEvent.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));

    expect(window.localStorage.getItem("ata.tools.trading-journal.v1")).toBe("journal-data");
    expect(window.localStorage.getItem("ata.report-workspace.v3")).toBe("draft-data");
  });

  it("logout still returns to /login when the session was already expired", async () => {
    logoutMock.mockResolvedValue({ ok: false, error: { category: "UNAUTHENTICATED", status: 401, code: null, messageKey: "x", requestId: null, retryable: false } });
    renderWith({ status: "AUTHENTICATED", viewer });
    await userEvent.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.getByTestId("status")).toHaveTextContent("UNAUTHENTICATED");
  });

  it("refresh re-confirms the session and updates the viewer", async () => {
    sessionMock.mockResolvedValue({ ok: true, data: { user: { id: 2, name: "Борис", role: "user" } }, requestId: null });
    renderWith({ status: "AUTHENTICATED", viewer });
    await userEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Борис"));
  });

  it("refresh to a network error yields a retryable ERROR state, not a fake session", async () => {
    sessionMock.mockResolvedValue({ ok: false, error: { category: "NETWORK_ERROR", status: null, code: null, messageKey: "x", requestId: null, retryable: true } });
    renderWith({ status: "AUTHENTICATED", viewer });
    await userEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ERROR"));
    expect(screen.getByTestId("name")).toHaveTextContent("none");
  });
});
