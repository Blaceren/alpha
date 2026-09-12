import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import {
  issueSessionWithin,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session";
import { passwordSchema, validateJsonBody } from "@/lib/validation";

/**
 * CHANGE YOUR OWN PASSWORD.
 *
 * WHAT WAS HERE BEFORE. Nothing. A learner who wanted a new password wrote to
 * support, and support had no self-service path to point at either.
 *
 * THE SESSION IS ROTATED, NOT KEPT. Changing a password is the one moment a
 * person is most likely to be acting on a suspicion that someone else has it.
 * A change that left the existing token live would answer that suspicion with
 * nothing. The new hash and the new session row commit together — see
 * `issueSessionWithin` — so the token the browser arrived with stops resolving
 * the instant the new password exists, and the response carries its replacement.
 * The person stays signed in; anyone holding a copy of the old token does not.
 *
 * SAME PASSWORD AGAIN IS ALLOWED, DELIBERATELY. Re-entering the current password
 * as the new one is a valid request with a defined outcome: the hash is
 * recomputed and the session still rotates. Refusing it would turn "log every
 * other device out" into an error message.
 *
 * WHAT NEVER LEAVES THIS FILE. No password, no hash, no session token and no
 * token hash appears in a response body or an audit record. The audit trail
 * carries the action and the outcome, which is what it is for.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const changePasswordSchema = z.object({
  /* Not `passwordSchema`: the current password is checked against the stored
     hash, never against a policy. Applying today's minimum to it would lock out
     anyone whose password predates the rule. */
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: passwordSchema,
});

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const currentUser = await requireUser();

    /* Keyed by user AND address: an attacker who has the session cookie is
       already past authentication, so the useful limit is on how fast the
       current password can be guessed. */
    const limit = rateLimit(
      `auth:change-password:${currentUser.id}:${getRequestIp(request)}`,
      { limit: 5, windowMs: 10 * 60 * 1000 },
    );

    if (!limit.allowed) {
      await createAuditLog({
        userId: currentUser.id,
        action: "AUTH_PASSWORD_CHANGE_RATE_LIMITED",
        entityType: "User",
        entityId: currentUser.id,
        request,
      });

      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Слишком много попыток. Попробуйте позже." },
        { status: 429 },
      );
    }

    const parsed = await validateJsonBody(request, changePasswordSchema);
    if (!parsed.success) return parsed.response;

    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { id: true, passwordHash: true },
    });

    if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      await createAuditLog({
        userId: currentUser.id,
        action: "AUTH_PASSWORD_CHANGE_FAILED",
        entityType: "User",
        entityId: currentUser.id,
        metadata: { reason: "invalid_current_password" },
        request,
      });

      /* Neutral on purpose. The caller is already authenticated, so this says
         nothing about the account — only about the value just typed. */
      return NextResponse.json(
        { error: "INVALID_CURRENT_PASSWORD", message: "Текущий пароль указан неверно." },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);

    const token = await issueSessionWithin(user.id, async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    });

    await createAuditLog({
      userId: user.id,
      action: "AUTH_PASSWORD_CHANGED",
      entityType: "User",
      entityId: user.id,
      request,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    return response;
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
