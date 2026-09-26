import { cache } from "react";
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { isVisibleNotificationType } from "@/config/feature-visibility";

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
    const sessionCookie = sessionCookieHeader((name) => cookieStore.get(name));
    if (!sessionCookie) return null;

    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    const response = await fetch(`${config.backendOrigin}/api/notifications`, {
      headers: {
        cookie: sessionCookie,
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;

    /**
     * THE MARK AND THE LIST ARE THE SAME SET.
     *
     * This used to read `unreadCount` — one number the Backend computes over
     * every type it stores. While a section is withheld from the product that
     * number can count an event the register will not show, and the learner
     * gets the worst possible answer: a bell that says something is waiting,
     * and a page that says nothing is. So presence is derived from the SAME
     * rows the register renders, through the SAME visibility predicate.
     *
     * WHAT THIS TRADES. The count was authoritative over all history; these
     * items are the window the Backend returns. An unread item outside that
     * window no longer lights the mark. That is the honest direction to fail:
     * this file's own header already notes the count "can assert more than the
     * learner can reach", and a mark the learner cannot act on is the defect
     * this surface was built to remove.
     *
     * STILL READ-ONLY. Same GET, same already-proxied route. Nothing is
     * deleted, nothing is marked read, nothing is written.
     */
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as { type?: unknown; readAt?: unknown };
      const type = typeof row.type === "string" ? row.type : "";
      if (!isVisibleNotificationType(type)) continue;
      if (row.readAt === null || row.readAt === undefined) return true;
    }
    return false;
  } catch {
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
});
