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
import { sessionCookieHeader } from "@/lib/auth/constants";
import { isBackendSessionResponse } from "@/lib/api/types";
import { toAcademyViewer, type AcademyViewer } from "@/lib/api/viewer";

export async function getServerViewer(): Promise<AcademyViewer | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) {
    return null;
  }

  const cookieStore = await cookies();
  const sessionCookie = sessionCookieHeader((name) => cookieStore.get(name));
  if (!sessionCookie) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}/api/auth/me`, {
      headers: {
        cookie: sessionCookie,
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

/**
 * SHELL-VIEWER-IDENTITY-2 — the shell's name, from the one authority.
 *
 * Every authenticated surface had written `viewer?.name ?? "Ученик"` for itself,
 * and the surfaces that predate that convention wrote a fixture name instead:
 * eleven shells said «Артём» regardless of who was looking. Those eleven all sit
 * in fixture-mode branches, so nothing shipped with a stranger's name on it —
 * but the fallback is what a page reaches for when it has no viewer, and a
 * fixture name is not a fallback. It is a different person.
 *
 * The neutral fallback is unchanged: a surface that cannot know who is looking
 * says «Ученик», which claims nothing.
 *
 * The route-level `loading.tsx` and `error.tsx` shells keep the literal. A
 * suspense fallback must render without awaiting anything, and an error
 * boundary is a client component — neither can consult the server viewer, and
 * neither should pretend to.
 */
export async function shellViewerName(): Promise<string> {
  return (await getServerViewer())?.name ?? "Ученик";
}
