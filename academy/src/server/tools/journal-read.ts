/**
 * TOOLS-V2 — the Trading Journal's first page, read on the server (SERVER-ONLY).
 *
 * The same reason as the Trade Card's first read: the page arrives with the
 * journal already in it instead of a loading line and a jump. Any failure
 * returns null, and the journal reads again from the browser. Nothing here
 * decides access: a locked journal is refused by the Backend and comes back null.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { isJournalPage } from "@/features/tool-windows/journal/journal-client";
import type { JournalPage } from "@/features/tool-windows/journal/journal-model";

/** Twenty entries with every text at its longest stay well inside this. */
const MAX_RESPONSE_BYTES = 768 * 1024;

export async function readJournalOnServer(): Promise<JournalPage | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return null;

  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  if (!session) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}/api/tools/journal?filter=all`, {
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
    return isJournalPage(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
