import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmPasswordReset } from "@/lib/account/passwordReset";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import { newPasswordSchema, validateJsonBody } from "@/lib/validation";

/**
 * SET A NEW PASSWORD WITH A LINK'S TOKEN.
 *
 * The token arrives in the body: the Academy page read it from the link's
 * fragment, so it was never in a URL a server or a log saw. An unknown, used,
 * retired or expired link is one answer. A successful reset closes every
 * session the account had and does not open one — the person signs in with the
 * new password.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const confirmSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: newPasswordSchema,
});

export async function POST(request: Request) {
  const ip = getRequestIp(request);
  if (!rateLimit(`auth:password-reset-confirm:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 }).allowed) {
    return rateLimitedResponse();
  }

  const parsed = await validateJsonBody(request, confirmSchema);
  if (!parsed.success) return parsed.response;

  const result = await confirmPasswordReset(parsed.data.token, parsed.data.newPassword, request);
  if (!result.ok) {
    return NextResponse.json(
      { error: "INVALID_TOKEN", message: "Ссылка недействительна или устарела. Запросите новую." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
