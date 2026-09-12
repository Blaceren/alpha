import { NextResponse } from "next/server";
import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/csrf";
import { shouldUseSecureCookies } from "@/lib/session";

export async function GET() {
  const csrfToken = createCsrfToken();
  const response = NextResponse.json({ csrfToken });

  response.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
  });

  return response;
}
