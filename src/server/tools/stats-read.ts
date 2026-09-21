/**
 * TOOLS-V2 — Personal Stats over all time, read on the server (SERVER-ONLY).
 *
 * The same reason as the other tools' first reads: the page arrives with the
 * figures already drawn, instead of a loading line and a jump. The server does
 * not know the learner's calendar, so it reads all time, which needs no date;
 * 7 and 30 days are read from the browser. Any failure returns null and the
 * tool reads again from the browser. Nothing here decides access: a locked tool
 * is refused by the Backend and comes back null.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { isJournalStats } from "@/features/tool-windows/stats/stats-client";
import type { JournalStats } from "@/features/tool-windows/stats/stats-model";

/** A handful of counts; far inside this. */
const MAX_RESPONSE_BYTES = 32 * 1024;

export async function readStatsOnServer(): Promise<JournalStats | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return null;

  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  if (!session) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}/api/tools/stats?period=all`, {
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
    return isJournalStats(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
