import { NextResponse } from "next/server";
import { z } from "zod";
import { requestEmailChange } from "@/lib/account/emailChange";
import { apiAuthErrorResponse, rateLimitedResponse, requireUser } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { rateLimit } from "@/lib/rateLimit";
import { validateJsonBody } from "@/lib/validation";

/**
 * CHANGE YOUR OWN EMAIL — ask for it. Withdrawing the request is
 * `POST /api/me/email-change/cancel`, a separate route because the Academy's
 * proxy allow-list speaks GET and POST only.
 *
 * Asking takes the current password, not only a session: moving an account to
 * another mailbox is how an account is taken over, and a session left open on a
 * shared machine must not be enough to do it. The change takes effect when the
 * link sent to the new address is opened (`/api/auth/email-change/confirm`).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const requestSchema = z.object({
  newEmail: z.string().trim().email("Введите корректный email").max(254).toLowerCase(),
  currentPassword: z.string().min(1, "Введите текущий пароль"),
});

const REFUSALS = {
  MAIL_UNAVAILABLE: { status: 503, message: "Смена почты сейчас недоступна." },
  INVALID_PASSWORD: { status: 400, message: "Текущий пароль указан неверно." },
  SAME_EMAIL: { status: 400, message: "Это уже ваш текущий адрес." },
  EMAIL_IN_USE: { status: 409, message: "Этот адрес уже используется." },
} as const;

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  try {
    const user = await requireUser();
    if (!rateLimit(`me:email-change:${user.id}`, { limit: 5, windowMs: 60 * 60 * 1000 }).allowed) {
      return rateLimitedResponse();
    }
    const parsed = await validateJsonBody(request, requestSchema);
    if (!parsed.success) return parsed.response;

    const result = await requestEmailChange(
      { userId: user.id, newEmail: parsed.data.newEmail, currentPassword: parsed.data.currentPassword },
      request,
    );
    if (!result.ok) {
      const refusal = REFUSALS[result.code];
      return NextResponse.json({ error: result.code, message: refusal.message }, { status: refusal.status });
    }
    return NextResponse.json({ ok: true, pendingEmail: result.pendingEmail });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
