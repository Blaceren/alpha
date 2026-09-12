import type { Metadata } from "next";
import { PublicHomeScreen } from "@/features/public-home/public-home-screen";
import { getServerViewer } from "@/server/auth/server-session";
import "@/features/public-home/public-home.css";

/**
 * Metadata carried across from the frozen HomeATA `<head>`: the same title, the
 * same description, the same theme colour.
 *
 * THE FAVICON IS NO LONGER DECLARED HERE. It used to be, and for a good reason
 * at the time: HomeATA's favicon was the authority for Public Home, and the
 * app-wide `src/app/icon.svg` could not be replaced without changing the icon
 * for every authenticated surface — outside what that phase was allowed to
 * touch. So the override was scoped to this one route.
 *
 * That scope is exactly what left the rest of the product on the old navy mark.
 * The app now declares one favicon in the root layout and this route inherits
 * it, so the override is gone rather than duplicated.
 */
export const metadata: Metadata = {
  title: "ATA — последовательный путь в трейдинге",
  description:
    "Alfa Trade Academy — последовательный путь обучения трейдингу: знания, практика, обратная связь и видимый прогресс.",
};

export const viewport = { themeColor: "#0B0D0A" };

/**
 * PUBLIC HOME — `/`.
 *
 * Outside the `(app)` route group, which is the whole mechanism: the `(app)`
 * layout is what resolves a session and redirects to `/login`, and this page
 * never enters it.
 *
 * WHY IT RESOLVES A VIEWER AT ALL. So the primary call to action can be
 * truthful: «Начать путь» → /register for a visitor, «Перейти в Академию» →
 * /home for someone already signed in. There is deliberately NO redirect — an
 * authenticated visitor asked for this page and gets it.
 *
 * IT COSTS AN ANONYMOUS VISITOR NOTHING. `getServerViewer()` returns null before
 * issuing any request when there is no session cookie, so the common case for a
 * marketing page performs no Backend call at all. If the Backend is unreachable
 * the helper fails closed to null, which degrades this page to its ordinary
 * public form rather than breaking it.
 */
export const dynamic = "force-dynamic";

export default async function PublicHomePage() {
  const viewer = await getServerViewer();
  return <PublicHomeScreen authenticated={viewer !== null} />;
}
