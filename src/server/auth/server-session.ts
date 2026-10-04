/**
 * Server-side session resolution for the route guard (SERVER-ONLY).
 *
 * The `(app)` layout calls this to decide whether to render protected content.
 * It reads the incoming httpOnly session cookie via `next/headers` and confirms
 * it against the Backend `/api/auth/me` endpoint (server-to-server, same trust
 * boundary as the proxy). It never fabricates a viewer: no cookie, an invalid
 * cookie, or an unreachable Backend all resolve to no viewer (fail-closed) —
 * and `readServerSession` says which of those it was.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { isBackendSessionResponse } from "@/lib/api/types";
import { toAcademyViewer, type AcademyViewer } from "@/lib/api/viewer";

/**
 * What the session read can answer (2026-10-04, launch audit).
 *
 * `signed-out` is an answer from the Backend: no cookie, no session behind it,
 * or an account that may no longer sign in. `unavailable` is NOT an answer — the
 * Backend did not respond in time, failed, or said something unreadable. The
 * guard used to fold the second into the first, so a ten-second hiccup on the
 * Backend sent every learner on every page to /login, where signing in then
 * failed too («Сервис временно недоступен»). The layout now tells the two apart:
 * signed-out goes to /login, unavailable stays and offers a retry.
 */
export type ServerSessionRead =
  | { kind: "viewer"; viewer: AcademyViewer }
  | { kind: "signed-out" }
  | { kind: "unavailable" };

export async function readServerSession(): Promise<ServerSessionRead> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) {
    return { kind: "signed-out" };
  }

  const cookieStore = await cookies();
  const sessionCookie = sessionCookieHeader((name) => cookieStore.get(name));
  if (!sessionCookie) {
    return { kind: "signed-out" };
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

    // 401: no session; 403: an account that may not sign in (blocked) — the
    // login page says which. Anything else that is not OK is the Backend's
    // trouble, not the learner's session.
    if (response.status === 401 || response.status === 403) {
      return { kind: "signed-out" };
    }
    if (!response.ok) {
      return { kind: "unavailable" };
    }

    const body: unknown = await response.json();
    if (!isBackendSessionResponse(body)) {
      return { kind: "unavailable" };
    }
    if (!body.user) {
      return { kind: "signed-out" };
    }

    return { kind: "viewer", viewer: toAcademyViewer(body.user) };
  } catch {
    // Network/timeout: no session is fabricated — and none is declared gone.
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

/** The viewer, or null for anything that is not one (signed out or unknown). */
export async function getServerViewer(): Promise<AcademyViewer | null> {
  const read = await readServerSession();
  return read.kind === "viewer" ? read.viewer : null;
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
