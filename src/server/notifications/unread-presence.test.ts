/**
 * THE BELL AND THE LIST ARE THE SAME SET.
 *
 * The failure this exists to stop: the mark says something is waiting, the
 * learner opens the register, and there is nothing there — because the only
 * unread event belonged to a section withheld from the product.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: cookieGet })) }));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", backendOrigin: "https://backend.invalid", requestTimeoutMs: 1000 }),
}));

import { hasUnreadNotifications } from "@/server/notifications/unread-presence";

const respond = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

beforeEach(() => {
  vi.resetModules();
  cookieGet.mockReturnValue({ value: "session-token" });
});

/** `cache` memoises per module instance, so each case gets a fresh import. */
async function ask(body: unknown, ok = true) {
  vi.resetModules();
  vi.stubGlobal("fetch", respond(body, ok));
  const mod = await import("@/server/notifications/unread-presence");
  return mod.hasUnreadNotifications();
}

const unread = (type: string) => ({ id: 1, type, readAt: null, createdAt: "2026-08-30T10:00:00Z" });
const read = (type: string) => ({ id: 2, type, readAt: "2026-08-30T11:00:00Z", createdAt: "2026-08-30T10:00:00Z" });

describe("unread presence is derived from the visible set", () => {
  it("does NOT light for a withheld section's unread event", async () => {
    // The exact forbidden state: a Community reply is the only thing unread.
    expect(await ask({ unreadCount: 1, items: [unread("community_reply")] })).toBe(false);
    expect(await ask({ unreadCount: 2, items: [unread("community_reply"), unread("community_moderation")] })).toBe(false);
  });

  it("ignores the Backend's own count, which cannot be filtered", async () => {
    // unreadCount says 7; every item a learner can see is read.
    expect(await ask({ unreadCount: 7, items: [read("level_up"), read("system")] })).toBe(false);
  });

  it("lights for a visible unread event", async () => {
    expect(await ask({ unreadCount: 1, items: [unread("level_up")] })).toBe(true);
    expect(await ask({ unreadCount: 1, items: [read("system"), unread("mentor_reply")] })).toBe(true);
  });

  it("lights when a visible unread sits beside a withheld one", async () => {
    expect(await ask({ unreadCount: 2, items: [unread("community_reply"), unread("system")] })).toBe(true);
  });

  it("still withholds the claim when the question cannot be answered", async () => {
    expect(await ask({ items: "not-an-array" })).toBeNull();
    expect(await ask({ unreadCount: 3 })).toBeNull();
    expect(await ask(null)).toBeNull();
    expect(await ask({ items: [] }, false)).toBeNull();
  });

  it("reports nothing rather than something when the register is empty", async () => {
    expect(await ask({ unreadCount: 0, items: [] })).toBe(false);
  });

  it("makes no write of any kind", async () => {
    vi.resetModules();
    const f = respond({ unreadCount: 1, items: [unread("system")] });
    vi.stubGlobal("fetch", f);
    const mod = await import("@/server/notifications/unread-presence");
    await mod.hasUnreadNotifications();
    const init = (f.mock.calls as unknown as Array<[string, RequestInit | undefined]>)[0]?.[1];
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("says nothing at all without a session", async () => {
    vi.resetModules();
    cookieGet.mockReturnValue(undefined);
    vi.stubGlobal("fetch", respond({ unreadCount: 1, items: [unread("system")] }));
    const mod = await import("@/server/notifications/unread-presence");
    expect(await mod.hasUnreadNotifications()).toBeNull();
  });
});

/** Keeps the import above meaningful to the type checker. */
export type _Used = typeof hasUnreadNotifications;
