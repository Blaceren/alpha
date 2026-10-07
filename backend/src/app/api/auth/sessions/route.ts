import { NextResponse } from "next/server";
import { ApiAuthError, apiAuthErrorResponse } from "@/lib/apiAuth";
import { getSession, listLiveSessions, MAX_LIVE_SESSIONS } from "@/lib/session";
import { describeUserAgent } from "@/lib/session-device";

/**
 * The account's live sessions, for its own Profile (owner 2026-10-07: «в профиле
 * снизу есть сеансы они должны быть там показаны»).
 *
 * Only the caller's own sessions, only the live ones, the most recently used
 * first; the one this request came from is marked `current`. Each names its
 * device in three coarse facts (browser, system, kind) — never the browser's
 * raw description, never a token or its hash, and no address (none is kept).
 */
export async function GET(request: Request) {
  try {
    const current = await getSession();
    if (!current) throw new ApiAuthError(401);

    const sessions = await listLiveSessions(current.userId);

    return NextResponse.json(
      {
        limit: MAX_LIVE_SESSIONS,
        sessions: sessions.map((session) => ({
          id: session.id,
          current: session.id === current.sessionId,
          signedInAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
          device: describeUserAgent(session.userAgent),
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
