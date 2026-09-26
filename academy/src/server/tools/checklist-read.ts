/**
 * TOOLS-V2 — the Entry Checklist, read on the server (SERVER-ONLY).
 *
 * The same reason as the other tools' first reads: the page arrives with the
 * list and the newest checks already drawn, instead of a loading line and a
 * jump. Any failure returns null and the tool reads again from the browser.
 * Nothing here decides access: a locked tool is refused by the Backend and
 * comes back null.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { isChecklistState } from "@/features/tool-windows/checklist/checklist-client";
import type { ChecklistState } from "@/features/tool-windows/checklist/checklist-model";

/** Twenty checks and the list stay well inside this. */
const MAX_RESPONSE_BYTES = 128 * 1024;

export async function readChecklistOnServer(): Promise<ChecklistState | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return null;

  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  if (!session) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}/api/tools/entry-checks`, {
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
    return isChecklistState(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
