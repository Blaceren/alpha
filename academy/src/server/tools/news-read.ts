/**
 * TOOLS-V2 — the News Calendar's first read, on the server (SERVER-ONLY).
 *
 * The same reason as the other tools' first reads: the page arrives with the
 * plan and the releases already in it. The server does not know which day is
 * "today" for the learner until it has their plan's zone, so it asks for no
 * day at all: the Backend answers the releases within now ± 36 h, which holds
 * today in every time zone, and the page picks the learner's day out of them.
 * Any failure returns null and the tool reads again from the browser. Nothing
 * here decides access: a locked tool is refused by the Backend and comes back
 * null.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { isNewsCalendarState } from "@/features/tool-windows/news/news-client";
import { dayIn, type NewsCalendarState } from "@/features/tool-windows/news/news-model";

/** Three days of releases; well inside this. */
const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * The first read, and the learner's today in their saved plan's zone as of the
 * read, so the day is drawn before the browser takes over. No plan, no day:
 * the server cannot know the learner's zone.
 */
export async function readNewsCalendarOnServer(): Promise<{ state: NewsCalendarState; day: string | null } | null> {
  const state = await readState();
  return state ? { state, day: state.plan ? dayIn(Date.now(), state.plan.timeZone) : null } : null;
}

async function readState(): Promise<NewsCalendarState | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return null;

  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  if (!session) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}/api/tools/news-calendar`, {
      method: "GET",
      headers: { accept: "application/json", cookie: session },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return null;
    const body = JSON.parse(text) as unknown;
    const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
    return isNewsCalendarState(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
