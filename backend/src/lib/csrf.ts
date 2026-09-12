import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";

export const CSRF_COOKIE_NAME = "trading_platform_csrf";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export function createCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

export function getCsrfTokenFromRequest(request: Request) {
  return {
    cookieToken: getCookieValue(request, CSRF_COOKIE_NAME),
    headerToken: request.headers.get("x-csrf-token"),
  };
}

export function validateCsrfToken(request: Request) {
  if (SAFE_METHODS.includes(request.method)) {
    return true;
  }

  const { cookieToken, headerToken } = getCsrfTokenFromRequest(request);

  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

export function csrfErrorResponse() {
  return NextResponse.json(
    {
      error: "CSRF_INVALID",
      message: "Недействительный CSRF token",
    },
    { status: 403 },
  );
}

export async function csrfFailureResponse(request: Request) {
  const user = await getCurrentUser();
  const url = new URL(request.url);

  await createAuditLog({
    userId: user?.id,
    action: "CSRF_INVALID",
    entityType: "API_ROUTE",
    entityId: url.pathname,
    metadata: {
      path: url.pathname,
      method: request.method,
    },
    request,
  });

  return csrfErrorResponse();
}
