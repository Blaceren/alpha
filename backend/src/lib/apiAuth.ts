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

export async function apiAuthErrorResponse(error: unknown, request?: Request) {
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

  return unauthorizedResponse();
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
