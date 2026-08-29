import { cache } from "react";
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

/**
 * Does at least one unread notification exist for this learner, right now?
 *
 * THREE ANSWERS, AND THE THIRD IS THE IMPORTANT ONE. `true`, `false`, and
 * `null` — meaning the question could not be answered. A hard-coded indicator
 * is recorded as INVALID PRODUCT TRUTH in the frozen Notifications design, and
 * the deployed shell carried exactly that: a permanent dot rendered from a
 * literal, on every page, for every learner, including the page that says there
 * is nothing. `null` is what stops this becoming the same defect by a different
 * route — an unreachable Backend produces no claim, not a claim of unread.
 *
 * EXISTENCE, NOT A COUNT. The frozen architecture selects a quiet boolean
 * presence and rejects a number: a count is a queue length, it invites clearing
 * behaviour, and — because it is computed over all history while the register
 * is windowed — it can assert more than the learner can reach. So the count
 * that comes back is reduced to a boolean here and never travels further.
 *
 * ONE READ PER REQUEST. `cache` dedupes the two call sites in the shell
 * (desktop band and mobile bar) into a single Backend round trip, and the
 * caller renders it inside Suspense so it never delays the page.
 *
 * READ-ONLY. A GET against a route the Academy already proxies. Nothing here
 * marks anything read; consumption is changed only by the Backend, and this
 * phase changes it not at all.
 */
export const hasUnreadNotifications = cache(async (): Promise<boolean | null> => {
  /* EVERYTHING is inside the try, including config and cookie resolution. Any
     one of them can throw outside a real request scope, and every one of those
     failures means the same thing here: the question could not be answered. */
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = getAcademyConfig();
    if (config.mode !== "api" || !config.backendOrigin) return null;

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (!sessionCookie) return null;

    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    const response = await fetch(`${config.backendOrigin}/api/notifications`, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}`,
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const count = (body as { unreadCount?: unknown }).unreadCount;
    if (typeof count !== "number" || !Number.isFinite(count)) return null;
    return count > 0;
  } catch {
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
});
