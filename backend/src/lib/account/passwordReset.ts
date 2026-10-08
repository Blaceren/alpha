/**
 * ACCOUNT RECOVERY — the password reset.
 *
 * WHAT WAS HERE BEFORE. Nothing. A learner who forgot a password wrote to
 * support, and support had no path either: nobody can read a bcrypt hash.
 *
 * THE REQUEST SAYS NOTHING ABOUT THE ADDRESS. It returns the same way for an
 * address with an account, an address without one and a blocked account. What
 * differs happens out of sight: only a live account gets a link.
 *
 * ONE PERSON CANNOT BE FLOODED. The route limits by network address; this file
 * limits by ACCOUNT, because the mailbox being filled belongs to the learner,
 * not to whoever is typing their address. Past the limit the request still
 * answers the same and simply sends nothing.
 *
 * THE RESET CLOSES EVERY SESSION. A person resets a password because they lost
 * it or because someone else has it. Either way no existing session should
 * outlive the old password: the new hash, the spent link and the revoked
 * sessions commit together. The person signs in with the new password —
 * the reset does not sign them in, so a link opened on a shared machine leaves
 * nothing behind.
 *
 * THE LINK PROVES THE MAILBOX. Whoever opened it received mail at the account's
 * address, which is exactly what email verification establishes. An unverified
 * address becomes verified by a completed reset.
 *
 * A RESET ALSO STOPS A PENDING CHANGE OF ADDRESS (`account/lifecycle.ts`): the
 * person who lost control of the account must not have to find a second
 * button for the link a stranger is still holding.
 */
import bcrypt from "bcryptjs";
import { createAuditLog } from "@/lib/audit";
import { retireLinksOnPasswordChange } from "@/lib/account/lifecycle";
import { accountLink } from "@/lib/account/links";
import {
  ACCOUNT_TOKEN_TTL_MS,
  consumeAccountActionToken,
  issueAccountActionToken,
} from "@/lib/account/tokens";
import { resolveMailConfig } from "@/lib/mail/config";
import { sendMail } from "@/lib/mail/send";
import { passwordChangedMessage, passwordResetMessage } from "@/lib/mail/templates";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

/** Reset emails one account may be sent per hour, whoever asks. */
const PER_ACCOUNT_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 };

/**
 * Handle a reset request for an address. Never throws for an unknown address
 * and never returns anything: the caller's answer is the same in every case.
 */
export async function requestPasswordReset(email: string, request?: Request): Promise<void> {
  const mail = resolveMailConfig();
  if (mail.kind !== "configured") return;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, status: true },
  });

  if (!user || user.status === "blocked") {
    await createAuditLog({
      action: "AUTH_PASSWORD_RESET_REQUESTED",
      entityType: "User",
      metadata: { matched: false },
      request,
    });
    return;
  }

  if (!rateLimit(`auth:password-reset:account:${user.id}`, PER_ACCOUNT_LIMIT).allowed) {
    await createAuditLog({
      userId: user.id,
      action: "AUTH_PASSWORD_RESET_THROTTLED",
      entityType: "User",
      entityId: user.id,
      request,
    });
    return;
  }

  const token = await prisma.$transaction((tx) =>
    issueAccountActionToken(tx, { userId: user.id, kind: "password_reset" }),
  );

  await createAuditLog({
    userId: user.id,
    action: "AUTH_PASSWORD_RESET_REQUESTED",
    entityType: "User",
    entityId: user.id,
    metadata: { matched: true },
    request,
  });

  await sendMail(
    passwordResetMessage({
      to: user.email,
      name: user.name,
      link: accountLink(mail.config.origin, "password_reset", token),
      minutes: Math.round(ACCOUNT_TOKEN_TTL_MS.password_reset / 60_000),
    }),
    { userId: user.id },
  );
}

export type PasswordResetConfirmation = { readonly ok: true } | { readonly ok: false };

/** Set a new password with a link's token. One answer for every dead link. */
export async function confirmPasswordReset(
  token: unknown,
  newPassword: string,
  request?: Request,
): Promise<PasswordResetConfirmation> {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const now = new Date();

  const done = await prisma.$transaction(async (tx) => {
    const claim = await consumeAccountActionToken(tx, token, "password_reset", now);
    if (!claim) return null;
    const user = await tx.user.findUnique({
      where: { id: claim.userId },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });
    if (!user) return null;
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? now },
    });
    await tx.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });
    await retireLinksOnPasswordChange(tx, user.id, now);
    return user;
  });

  if (!done) {
    await createAuditLog({
      action: "AUTH_PASSWORD_RESET_REJECTED",
      entityType: "User",
      request,
    });
    return { ok: false };
  }

  await createAuditLog({
    userId: done.id,
    action: "AUTH_PASSWORD_RESET_COMPLETED",
    entityType: "User",
    entityId: done.id,
    request,
  });
  await sendMail(passwordChangedMessage({ to: done.email, name: done.name }), { userId: done.id });
  return { ok: true };
}
