import { NextResponse } from "next/server";
import { ApiAuthError, apiAuthErrorResponse } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { getSession, revokeUserSession } from "@/lib/session";
import { notFoundResponse } from "@/lib/validation";

type SessionRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

/** A session row's id (a cuid) — anything else names no session. */
const SESSION_ID = /^[a-z0-9]{20,40}$/;

/**
 * Close another of the account's sessions (owner 2026-10-07: «возможность
 * закрыть сеанс с другого сеанса»).
 *
 * Scoped to the caller's own sessions: an id that is someone else's, already
 * closed or unknown is «not found», with nothing changed and nothing said about
 * whose it was. The session this request came from is closed by signing out,
 * not here. The closed session's next request is unauthenticated.
 */
export async function DELETE(request: Request, { params }: SessionRouteProps) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const current = await getSession();
    if (!current) throw new ApiAuthError(401);

    const { id } = await params;
    if (!SESSION_ID.test(id)) {
      return notFoundResponse("Сеанс не найден");
    }

    if (id === current.sessionId) {
      return NextResponse.json(
        { error: "CURRENT_SESSION", message: "Этот сеанс завершается выходом из аккаунта." },
        { status: 409 },
      );
    }

    const revoked = await revokeUserSession(current.userId, id);
    if (!revoked) {
      return notFoundResponse("Сеанс не найден");
    }

    await createAuditLog({
      userId: current.userId,
      action: "AUTH_SESSION_REVOKED",
      entityType: "UserSession",
      entityId: id,
      request,
    });

    return NextResponse.json({ revoked: true });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
