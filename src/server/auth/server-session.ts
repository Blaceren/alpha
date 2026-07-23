/**
 * Server-side session resolution for the route guard (SERVER-ONLY).
 *
 * The `(app)` layout calls this to decide whether to render protected content.
 * It reads the incoming httpOnly session cookie via `next/headers` and confirms
 * it against the Backend `/api/auth/me` endpoint (server-to-server, same trust
 * boundary as the proxy). It never fabricates a viewer: no cookie, an invalid
 * cookie, or an unreachable Backend all resolve to `null` (fail-closed).
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { isBackendSessionResponse } from "@/lib/api/types";
import { toAcademyViewer, type AcademyViewer } from "@/lib/api/viewer";

export async function getServerViewer(): Promise<AcademyViewer | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) {
    return null;
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}/api/auth/me`, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}`,
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json();
    if (!isBackendSessionResponse(body) || !body.user) {
      return null;
    }

    return toAcademyViewer(body.user);
  } catch {
    // Network/timeout: do not fabricate a session. The guard redirects to a
    // login page that surfaces a retryable, non-authenticated state.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
