/**
 * «Сеанс завершён — Войти снова» (2026-10-04, launch audit).
 *
 * Any Backend call answering 401 puts the one way back on screen, pointing at
 * the login page and back to the page the learner was on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/client", () => ({ logout: vi.fn(), fetchSession: vi.fn() }));

import { SessionProvider } from "@/features/auth/session-provider";
import { SessionExpiryWatch, loginAgainHref, isBackendProxyCall } from "@/features/auth/session-expired-notice";
import { SessionUnavailable } from "@/features/auth/session-unavailable";

const viewer = { id: "1", name: "Анна", role: "user", status: "active", synthetic: false } as const;

function mount() {
  return render(
    <SessionProvider initialState={{ status: "AUTHENTICATED", viewer }}>
      <p>страница</p>
      <SessionExpiryWatch />
    </SessionProvider>,
  );
}

let underlying: ReturnType<typeof vi.fn>;
beforeEach(() => {
  underlying = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    return { status: url.includes("expired") ? 401 : 200, ok: !url.includes("expired") } as Response;
  });
  vi.stubGlobal("fetch", underlying);
  window.history.replaceState(null, "", "/tools/journal?tab=all");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the session-expired notice", () => {
  it("appears on a 401 from the Backend proxy, and leads back to this page after login", async () => {
    mount();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      const res = await window.fetch("/api/backend/tools/journal/expired");
      expect(res.status).toBe(401); // passed through untouched
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Сеанс завершён");
    const link = screen.getByRole("link", { name: "Войти снова" });
    expect(link.getAttribute("href")).toBe("/login?next=%2Ftools%2Fjournal%3Ftab%3Dall");
  });

  it("stays away for successes, for other paths and for other origins", async () => {
    mount();
    await act(async () => {
      await window.fetch("/api/backend/tools/journal");
      await window.fetch("/lessons/expired");
      await window.fetch("https://elsewhere.invalid/api/backend/expired");
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives the page its own fetch back when it leaves", () => {
    const view = mount();
    expect(window.fetch).not.toBe(underlying);
    view.unmount();
    expect(window.fetch).toBe(underlying);
  });

  it("builds the way back safely", () => {
    expect(loginAgainHref("/home")).toBe("/login");
    expect(loginAgainHref("//evil.example")).toBe("/login");
    expect(loginAgainHref("/lessons/v2.l004.kak-chitat-grafik")).toBe("/login?next=%2Flessons%2Fv2.l004.kak-chitat-grafik");
    expect(isBackendProxyCall(new URL("/api/backend/x", window.location.href))).toBe(true);
    expect(isBackendProxyCall("/api/other")).toBe(false);
  });
});

describe("«Нет связи с Академией»", () => {
  it("says the session is intact and retries the same address", () => {
    render(<SessionUnavailable retryHref="/path" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Нет связи с Академией");
    expect(screen.getByRole("alert")).toHaveTextContent("Ваш вход и прогресс на месте");
    expect(screen.getByRole("link", { name: "Повторить" }).getAttribute("href")).toBe("/path");
  });
});
