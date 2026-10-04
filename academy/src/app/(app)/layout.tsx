import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "@/features/home/home.css";
// The product hi-fi for error and empty states (DD-338), once for the group.
import "@/styles/states-hifi.css";
import { getAcademyConfig } from "@/config/academy-config";
import { readServerSession } from "@/server/auth/server-session";
import { SessionUnavailable } from "@/features/auth/session-unavailable";
import { SessionProvider } from "@/features/auth/session-provider";
import { SessionExpiryWatch } from "@/features/auth/session-expired-notice";
import { NavigationProgress } from "@/components/shell/navigation-progress";
import { sanitizeReturnTo, DEFAULT_RETURN_TO } from "@/lib/auth/return-to";
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
 * - a Backend that could not answer (timeout, failure) is NOT a signed-out
 *   learner (2026-10-04, launch audit): the page says «Нет связи с Академией»
 *   with a retry of the same address, and renders nothing protected.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const config = getAcademyConfig();

  let initialState: SessionState;

  if (config.mode === "api") {
    const session = await readServerSession();
    if (session.kind !== "viewer") {
      const requestHeaders = await headers();
      const pathname = requestHeaders.get(PATHNAME_HEADER);
      const returnTo = sanitizeReturnTo(pathname);
      if (session.kind === "unavailable") {
        return <SessionUnavailable retryHref={returnTo} />;
      }
      // A `next` that merely repeats the post-login default carries no
      // information, so it is omitted. The comparison is against the constant
      // rather than a literal path: UNIFIED-DESIGN-V1 moved that default from
      // `/` to `/home`, and a hardcoded "/" here would have started emitting a
      // redundant `?next=%2Fhome` on the most common auth-loss path.
      redirect(
        returnTo === DEFAULT_RETURN_TO
          ? "/login"
          : `/login?next=${encodeURIComponent(returnTo)}`,
      );
    }
    initialState = { status: "AUTHENTICATED", viewer: session.viewer };
  } else {
    initialState = { status: "AUTHENTICATED", viewer: FIXTURE_VIEWER };
  }

  return (
    <SessionProvider initialState={initialState}>
      {children}
      {/* A 401 from any Backend call puts «Сеанс завершён — Войти снова» on screen. */}
      <SessionExpiryWatch />
      {/* A line across the top from an internal link's click until the next page arrives. */}
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
    </SessionProvider>
  );
}
