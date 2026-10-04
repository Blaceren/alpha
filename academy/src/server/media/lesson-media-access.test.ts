/**
 * WHO IS HANDED A LESSON'S FILE.
 *
 * One rule, the Backend's: the learner may load a level's media exactly when
 * the Backend would give them that level's lesson. This file holds the three
 * things the Academy adds around that rule — no session means no question is
 * asked, only a "yes" is remembered, and what is remembered is keyed to one
 * session AND one level.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined) }),
}));
const readLevelContent = vi.fn();
vi.mock("@/server/curriculum/server-read", () => ({
  readLevelContent: (...args: unknown[]) => readLevelContent(...args),
}));

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { forgetLessonMediaAccess, resolveLessonMediaAccess } from "@/server/media/lesson-media-access";

const LEVEL_4 = "v2.l004.kak-chitat-grafik";
const LEVEL_5 = "v2.l005.cikl-sdelki";
const readable = { ok: true, content: {} };
const refused = { ok: false, reason: "locked" };

beforeEach(() => {
  cookieJar.clear();
  readLevelContent.mockReset();
  forgetLessonMediaAccess();
  vi.useRealTimers();
});

describe("resolveLessonMediaAccess", () => {
  it("without a session cookie asks nobody and allows nothing", async () => {
    expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("denied");
    expect(readLevelContent).not.toHaveBeenCalled();
  });

  it("allows what the Backend would give the lesson of, and asks it by the level's own code", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "session-a");
    readLevelContent.mockResolvedValue(readable);
    expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("allowed");
    expect(readLevelContent).toHaveBeenCalledWith(LEVEL_4, "ru");
  });

  it("denies a level the Backend refuses — locked, not enrolled, expired session alike", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "session-a");
    for (const reason of ["locked", "not_enrolled", "not_configured", "unavailable", "feature_disabled"]) {
      readLevelContent.mockResolvedValueOnce({ ok: false, reason });
      expect(await resolveLessonMediaAccess(LEVEL_4), reason).toBe("denied");
    }
  });

  it("remembers a yes, so a seek does not cost a Backend read", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "session-a");
    readLevelContent.mockResolvedValue(readable);
    for (let range = 0; range < 6; range += 1) expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("allowed");
    expect(readLevelContent).toHaveBeenCalledTimes(1);
  });

  it("never remembers a no: a level opened a moment ago is not refused by a stale answer", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "session-a");
    readLevelContent.mockResolvedValueOnce(refused).mockResolvedValueOnce(readable);
    expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("denied");
    expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("allowed");
    expect(readLevelContent).toHaveBeenCalledTimes(2);
  });

  it("a yes for one level says nothing about another", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "session-a");
    readLevelContent.mockResolvedValueOnce(readable).mockResolvedValueOnce(refused);
    expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("allowed");
    expect(await resolveLessonMediaAccess(LEVEL_5)).toBe("denied");
  });

  it("a yes for one session says nothing about another", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "session-a");
    readLevelContent.mockResolvedValueOnce(readable).mockResolvedValueOnce(refused);
    expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("allowed");
    cookieJar.set(SESSION_COOKIE_NAME, "session-b");
    expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("denied");
    expect(readLevelContent).toHaveBeenCalledTimes(2);
  });

  it("forgets after two minutes and asks again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    cookieJar.set(SESSION_COOKIE_NAME, "session-a");
    readLevelContent.mockResolvedValue(readable);
    await resolveLessonMediaAccess(LEVEL_4);
    vi.setSystemTime(new Date("2026-10-02T12:01:59Z"));
    await resolveLessonMediaAccess(LEVEL_4);
    expect(readLevelContent).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-02T12:02:01Z"));
    readLevelContent.mockResolvedValueOnce(refused);
    // The learner's access was taken away meanwhile: the next request is refused.
    expect(await resolveLessonMediaAccess(LEVEL_4)).toBe("denied");
    expect(readLevelContent).toHaveBeenCalledTimes(2);
  });
});
