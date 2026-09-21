/**
 * The `(tool)` group inherits no guard from `(app)`, so it carries its own:
 * no session in api mode means the login page, with the tool as the way back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
const pathname = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => pathname() }) }));
vi.mock("@/config/academy-config", () => ({ getAcademyConfig: () => ({ mode: "api" }) }));
const getServerViewer = vi.fn();
vi.mock("@/server/auth/server-session", () => ({ getServerViewer: () => getServerViewer() }));
vi.mock("@/features/auth/session-provider", () => ({
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

import ToolLayout from "./layout";

beforeEach(() => {
  getServerViewer.mockReset();
  pathname.mockReset();
});

describe("the tool tab's own session guard", () => {
  it("sends an anonymous request to login and back to the tool", async () => {
    getServerViewer.mockResolvedValue(null);
    pathname.mockReturnValue("/tools/trade-card");
    await expect(ToolLayout({ children: null })).rejects.toMatchObject({ to: "/login?next=%2Ftools%2Ftrade-card" });
  });

  it("renders the tool for a signed-in viewer", async () => {
    getServerViewer.mockResolvedValue({ id: 7, name: "Ученик", role: "user" });
    await expect(ToolLayout({ children: "tool" })).resolves.toBeTruthy();
  });
});
