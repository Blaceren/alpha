/**
 * TOOLS-V2 — the Trade Card's first read, on the server (SERVER-ONLY).
 *
 * WHY. Read from the browser, the card arrived after the page: every open
 * showed «Загружаю карточку…» and then the panel jumped to its real height.
 * Reading it here, with the learner's own session, the page arrives with the
 * card (or the empty plan) already in it.
 *
 * FAIL QUIET, NEVER FAIL OPEN. Any failure — no session, a locked tool, a
 * network error, an unexpected shape — returns null, and the tool reads again
 * from the browser, exactly as before. Nothing here decides access: the
 * Backend answers a locked tool with 403 and this returns null for it.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { isTradeCardState, type TradeCardState } from "@/features/tool-windows/trade-card/trade-card-client";

/** The card plus the two reference lists: a few kilobytes. */
const MAX_RESPONSE_BYTES = 128 * 1024;

export async function readTradeCardStateOnServer(): Promise<TradeCardState | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return null;

  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  if (!session) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}/api/tools/trade-cards`, {
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
    return isTradeCardState(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
