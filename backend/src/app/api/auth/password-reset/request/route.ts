import { NextResponse } from "next/server";
import { z } from "zod";
import { accountCapabilities } from "@/lib/account/capabilities";
import { runDetached } from "@/lib/account/background";
import { requestPasswordReset } from "@/lib/account/passwordReset";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { verifyCaptcha } from "@/lib/captcha";
import { resolveAuthSurface } from "@/lib/captcha/surface";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import { validateJsonBody } from "@/lib/validation";

/**
 * ASK FOR A PASSWORD RESET LINK.
 *
 * ONE ANSWER. An address with an account, an address without one and a blocked
 * account all get `{ ok: true }`, after the same amount of work in the request:
 * the lookup, the token and the message happen detached (see
 * `account/background.ts`). The only refusals are about the REQUEST — too many
 * from one address, a failed challenge, a deployment that cannot send mail —
 * and none of them depends on who the address belongs to.
 *
 * THE CHALLENGE IS ALWAYS ON. This is the one anonymous form that makes the
 * platform send mail to an address the caller chose, so it is verified in every
 * environment, like registration.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const requestSchema = z.object({
  email: z.string().trim().email("Введите корректный email").max(254).toLowerCase(),
  captchaToken: z.string().trim().optional(),
});

export async function POST(request: Request) {
  if (!accountCapabilities().passwordRecovery) {
    return NextResponse.json(
      {
        error: "RECOVERY_UNAVAILABLE",
        message: "Восстановление пароля сейчас недоступно. Обратитесь в поддержку.",
      },
      { status: 503 },
    );
  }

  const ip = getRequestIp(request);
  if (!rateLimit(`auth:password-reset:ip:${ip}`, { limit: 5, windowMs: 15 * 60 * 1000 }).allowed) {
    await createAuditLog({ action: "AUTH_PASSWORD_RESET_RATE_LIMITED", entityType: "API_ROUTE", request });
    return rateLimitedResponse();
  }

  const parsed = await validateJsonBody(request, requestSchema);
  if (!parsed.success) return parsed.response;

  const captcha = await verifyCaptcha({
    token: parsed.data.captchaToken,
    purpose: "recovery",
    surface: resolveAuthSurface(request, "recovery"),
    request,
  });
  if (!captcha.ok) {
    await createAuditLog({
      action: "CAPTCHA_REJECTED",
      entityType: "API_ROUTE",
      metadata: { purpose: "recovery", outcome: captcha.outcome },
      request,
    });
    return NextResponse.json(
      { error: captcha.code, message: captcha.message },
      { status: captcha.status },
    );
  }

  const email = parsed.data.email;
  runDetached(() => requestPasswordReset(email, request));

  return NextResponse.json({ ok: true });
}
