import type { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";

export class ApiAuthError extends Error {
  constructor(
    public status: 401 | 403,
    public userId?: number,
    public role?: UserRole,
  ) {
    super(status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
  }
}

export function unauthorizedResponse() {
  return NextResponse.json(
    {
      error: "UNAUTHORIZED",
      message: "Необходимо войти в аккаунт",
    },
    { status: 401 },
  );
}

export function forbiddenResponse() {
  return NextResponse.json(
    {
      error: "FORBIDDEN",
      message: "Недостаточно прав",
    },
    { status: 403 },
  );
}

export function rateLimitedResponse() {
  return NextResponse.json(
    {
      error: "RATE_LIMITED",
      message: "Слишком много запросов. Попробуйте позже.",
    },
    { status: 429 },
  );
}

/**
 * ONLY AN AUTH FAILURE IS A 401 (2026-10-07 audit).
 *
 * This is the catch-all of most route handlers, and it used to answer 401 to
 * EVERYTHING that was not a 403 — a database busy for a moment, a timeout, a
 * bug. The Academy reads a 401 as «Сеанс завершён» and sends the learner to
 * sign in again, so a hiccup looked like being thrown out (and signing in again
 * took one of the account's two places). A 401 now means what it says; anything
 * else is logged and answered 500, which the Academy shows as a temporary
 * failure with the learner still signed in.
 */
function serverErrorResponse() {
  return NextResponse.json(
    {
      error: "INTERNAL_ERROR",
      message: "Не удалось выполнить запрос. Попробуйте ещё раз.",
    },
    { status: 500 },
  );
}

function isAuthFailure(error: unknown, status: 401 | 403): boolean {
  if (error instanceof ApiAuthError) return error.status === status;
  // `requireCurrentUser` / `requireRole` in lib/auth throw these plain errors.
  return error instanceof Error && error.message === (status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
}

export async function apiAuthErrorResponse(error: unknown, request?: Request) {
  if (isAuthFailure(error, 401)) return unauthorizedResponse();

  if (!isAuthFailure(error, 403)) {
    console.error(
      `[api] unexpected error${request ? ` on ${request.method} ${new URL(request.url).pathname}` : ""}:`,
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    return serverErrorResponse();
  }

  if (error instanceof ApiAuthError && error.status === 403) {
    await createAuditLog({
      userId: error.userId,
      action: "FORBIDDEN_ACCESS",
      entityType: "API_ROUTE",
      entityId: request ? new URL(request.url).pathname : null,
      metadata: {
        role: error.role,
      },
      request,
    });

    return forbiddenResponse();
  }

  return forbiddenResponse();
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new ApiAuthError(401);
  }

  if (user.status === "blocked") {
    throw new ApiAuthError(403, user.id, user.role);
  }

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();

  if (!hasRole(user.role, ["admin"])) {
    throw new ApiAuthError(403, user.id, user.role);
  }

  return user;
}

export async function requireSupportAccess() {
  const user = await requireUser();
  const allowedRoles: UserRole[] = ["admin", "support", "mentor"];

  if (!hasRole(user.role, allowedRoles)) {
    throw new ApiAuthError(403, user.id, user.role);
  }

  return user;
}

export async function requireProblemAccess() {
  const user = await requireUser();
  const allowedRoles: UserRole[] = ["admin", "support"];
  if (!hasRole(user.role, allowedRoles)) throw new ApiAuthError(403, user.id, user.role);
  return user;
}

export async function requireTaskReportReviewer() {
  const user = await requireUser();
  const allowedRoles: UserRole[] = ["admin", "mentor"];

  if (!hasRole(user.role, allowedRoles)) {
    throw new ApiAuthError(403, user.id, user.role);
  }

  return user;
}

export async function requireNewsEditorAccess() {
  const user = await requireUser();
  const allowedRoles: UserRole[] = ["admin", "news_editor"];

  if (!hasRole(user.role, allowedRoles)) {
    throw new ApiAuthError(403, user.id, user.role);
  }

  return user;
}

export async function requireModeratorAccess() {
  const user = await requireUser();
  const allowedRoles: UserRole[] = ["admin", "moderator"];

  if (!hasRole(user.role, allowedRoles)) {
    throw new ApiAuthError(403, user.id, user.role);
  }

  return user;
}
