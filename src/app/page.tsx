import type { Metadata } from "next";
import { PublicHomeScreen } from "@/features/public-home/public-home-screen";
import { getServerViewer } from "@/server/auth/server-session";
import "@/features/public-home/public-home.css";

export const metadata: Metadata = {
  title: "ATA — последовательный путь в трейдинге",
  description:
    "Не ещё один источник информации о трейдинге. Система, где знание превращается в действие, проверку, обратную связь и следующий шаг.",
};

/**
 * PUBLIC HOME — `/`.
 *
 * UNIFIED-DESIGN-V1 route decision 1. This file sits at `src/app/page.tsx`,
 * OUTSIDE the `(app)` route group, which is the whole mechanism: the `(app)`
 * layout is what resolves a session and redirects to `/login`, and this page
 * never enters it. Authenticated Home moved to `/home` so that this path could
 * be freed; the two can never collide because only one `page.tsx` may answer a
 * given path.
 *
 * IT IS STILL NOT PUBLIC ON PREPROD. The nginx Basic Auth gate covers the whole
 * host at server scope and is NOT edited by this phase. "Public" here means
 * "outside the application's own auth guard", not "reachable by the internet".
 *
 * WHY IT RESOLVES A VIEWER AT ALL. Route decision 3: an authenticated user may
 * view Public Home, and its primary CTA then becomes «Перейти в Академию» → the
 * Academy, instead of an invitation to register. Deciding that truthfully needs
 * to know whether a session exists.
 *
 * THAT COSTS AN ANONYMOUS VISITOR NOTHING. `getServerViewer()` returns `null`
 * immediately when there is no session cookie, before it makes any request — so
 * the common case for a marketing page performs no Backend call at all. A
 * cookie-bearing visitor pays one loopback round trip, and if the Backend is
 * unreachable the helper fails closed to `null`, which degrades this page to
 * its ordinary public form rather than breaking it.
 *
 * NO REDIRECT. An authenticated visitor is deliberately NOT bounced to `/home`
 * (route decision 3). They asked for this page; they get this page.
 */
export const dynamic = "force-dynamic";

export default async function PublicHomePage() {
  const viewer = await getServerViewer();
  return <PublicHomeScreen authenticated={viewer !== null} />;
}
