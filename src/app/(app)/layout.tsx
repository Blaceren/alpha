import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "@/features/home/home.css";
import { getAcademyConfig } from "@/config/academy-config";
import { getServerViewer } from "@/server/auth/server-session";
import { SessionProvider } from "@/features/auth/session-provider";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { PATHNAME_HEADER } from "@/lib/auth/constants";
import { FIXTURE_VIEWER } from "@/lib/api/viewer";
import type { SessionState } from "@/features/auth/session-machine";

// The authenticated area is guarded per-request; never statically prerender it.
export const dynamic = "force-dynamic";

/**
 * (app) route group layout + authenticated route guard.
 *
 * - fixture mode (default, local visual dev): renders the synthetic viewer, no
 *   Backend, behaviour identical to the pre-integration prototype.
 * - api mode: resolves the real Backend session server-side. Unauthenticated
 *   requests are redirected to /login with a validated internal returnTo; the
 *   authenticated viewer hydrates the client SessionProvider with no
 *   protected-content flash.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const config = getAcademyConfig();

  let initialState: SessionState;

  if (config.mode === "api") {
    const viewer = await getServerViewer();
    if (!viewer) {
      const requestHeaders = await headers();
      const pathname = requestHeaders.get(PATHNAME_HEADER);
      const returnTo = sanitizeReturnTo(pathname);
      redirect(returnTo === "/" ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`);
    }
    initialState = { status: "AUTHENTICATED", viewer };
  } else {
    initialState = { status: "AUTHENTICATED", viewer: FIXTURE_VIEWER };
  }

  return <SessionProvider initialState={initialState}>{children}</SessionProvider>;
}
