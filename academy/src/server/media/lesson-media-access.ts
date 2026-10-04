/**
 * LESSON MEDIA — who may be handed a lesson's file (SERVER-ONLY).
 *
 * ONE RULE, AND IT IS THE BACKEND'S. A learner may load the media of a level
 * exactly when the Backend would give them that level's lesson. The Academy
 * does not hold a second copy of that rule: it asks the same content endpoint
 * the lesson page reads, with the learner's own cookie, and a 200 is the
 * permission. A level that is locked, a learner who is not enrolled, a session
 * that has expired — the Backend already refuses each, and so does this.
 *
 * WHY THERE IS A SHORT MEMORY. A player does not ask for a video once: it asks
 * for a range, then another on every seek. Asking the Backend each time would
 * put a database read behind every scrub of the timeline. A permission is
 * therefore remembered for two minutes, under a hash of the session and the
 * level — never the cookie itself — and only a "yes" is remembered: a learner
 * who has just opened a level must not be refused by a stale "no".
 */
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { readLevelContent } from "@/server/curriculum/server-read";

export type LessonMediaAccess = "allowed" | "denied";

const ALLOW_TTL_MS = 120_000;
const MAX_REMEMBERED = 2_000;
const DEFAULT_LOCALE = "ru";

const remembered = new Map<string, number>();

function remember(key: string, now: number): void {
  if (remembered.size >= MAX_REMEMBERED) {
    for (const [candidate, expires] of remembered) {
      if (expires <= now) remembered.delete(candidate);
    }
    // Still full of live entries: drop the oldest insertion.
    if (remembered.size >= MAX_REMEMBERED) {
      const oldest = remembered.keys().next();
      if (!oldest.done) remembered.delete(oldest.value);
    }
  }
  remembered.set(key, now + ALLOW_TTL_MS);
}

export async function resolveLessonMediaAccess(levelStableCode: string): Promise<LessonMediaAccess> {
  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  if (!session) return "denied";

  const key = createHash("sha256").update(session).update("\n").update(levelStableCode).digest("hex");
  const now = Date.now();
  const expires = remembered.get(key);
  if (expires !== undefined && expires > now) return "allowed";

  const content = await readLevelContent(levelStableCode, DEFAULT_LOCALE);
  if (!content.ok) return "denied";
  remember(key, now);
  return "allowed";
}

/** Test seam: forget every remembered permission. */
export function forgetLessonMediaAccess(): void {
  remembered.clear();
}
