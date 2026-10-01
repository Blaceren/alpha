/**
 * ACCOUNT RECOVERY — confirming an address, and changing it.
 *
 * CONFIRMATION IS SOFT (owner, 2026-10-01). A learner signs in and learns with
 * an unconfirmed address. Confirming it is what makes the address a channel:
 * the place a reset link can be sent.
 *
 * A CHANGE IS NOT A CHANGE UNTIL THE NEW MAILBOX ANSWERS. Before this file,
 * `PATCH /api/me` wrote `pendingEmail` for anyone holding a session and
 * nothing ever resolved it. A change now takes three things: the current
 * password (a session alone is not enough to move the account to another
 * mailbox), a link opened from the NEW address, and no other account holding
 * that address at the moment of confirmation. Until then the account keeps its
 * address, signs in with it and receives its mail there.
 *
 * THE OLD ADDRESS IS TOLD, TWICE: when a change is requested and when it takes
 * effect. That message is the only warning the real owner gets if the request
 * was not theirs, so it does not depend on the old address being confirmed.
 *
 * A change cannot be requested where mail cannot be sent: a pending address
 * with no link to confirm it would be pending for ever.
 *
 * What a change does to the links of the other flows, and how long a pending
 * address is held, is `account/lifecycle.ts`.
 */
import bcrypt from "bcryptjs";
import { createAuditLog } from "@/lib/audit";
import {
  dropPendingEmailChange,
  pendingEmailStaleBefore,
  retireLinksOnEmailChange,
} from "@/lib/account/lifecycle";
import { accountLink } from "@/lib/account/links";
import { consumeAccountActionToken, issueAccountActionToken } from "@/lib/account/tokens";
import { createEmailVerificationToken } from "@/lib/emailVerification";
import { resolveMailConfig } from "@/lib/mail/config";
import { sendMail, type MailSendResult } from "@/lib/mail/send";
import {
  emailChangeConfirmMessage,
  emailChangeNoticeMessage,
  emailChangedMessage,
  maskEmail,
  verifyEmailMessage,
} from "@/lib/mail/templates";
import { prisma } from "@/lib/prisma";

/** A unique-constraint failure, however this Prisma version reports it. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === "P2002") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /UNIQUE constraint failed/i.test(message);
}

/**
 * Send the confirmation message for the account's current address. Creates a
 * verification token only when a message can actually be sent.
 */
export async function sendVerificationMail(user: {
  id: number;
  email: string;
  name: string | null;
}): Promise<MailSendResult> {
  const mail = resolveMailConfig();
  if (mail.kind === "disabled") return { sent: false, reason: "disabled" };
  if (mail.kind === "invalid") return { sent: false, reason: "invalid_config" };
  const token = await createEmailVerificationToken(user.id);
  return sendMail(
    verifyEmailMessage({
      to: user.email,
      name: user.name,
      link: accountLink(mail.config.origin, "verify_email", token),
    }),
    { userId: user.id },
  );
}

export type EmailChangeRequestResult =
  | { readonly ok: true; readonly pendingEmail: string }
  | {
      readonly ok: false;
      readonly code: "MAIL_UNAVAILABLE" | "INVALID_PASSWORD" | "SAME_EMAIL" | "EMAIL_IN_USE";
    };

export async function requestEmailChange(
  input: { userId: number; newEmail: string; currentPassword: string },
  request?: Request,
): Promise<EmailChangeRequestResult> {
  const mail = resolveMailConfig();
  if (mail.kind !== "configured") return { ok: false, code: "MAIL_UNAVAILABLE" };

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    await createAuditLog({
      userId: input.userId,
      action: "PROFILE_EMAIL_CHANGE_REFUSED",
      entityType: "User",
      entityId: input.userId,
      metadata: { reason: "invalid_password" },
      request,
    });
    return { ok: false, code: "INVALID_PASSWORD" };
  }

  if (input.newEmail === user.email) return { ok: false, code: "SAME_EMAIL" };

  /* One clock for the request: the moment written on the account and the
     moment the link's lifetime is counted from are the same moment. */
  const now = new Date();
  const staleBefore = pendingEmailStaleBefore(now);

  /* Another account holds the address when it IS that account's address, or
     when that account is waiting for it and its link can still be opened. */
  const holder = await prisma.user.findFirst({
    where: {
      id: { not: user.id },
      OR: [
        { email: input.newEmail },
        { pendingEmail: input.newEmail, pendingEmailRequestedAt: { gt: staleBefore } },
      ],
    },
    select: { id: true },
  });
  if (holder) return { ok: false, code: "EMAIL_IN_USE" };

  let token: string;
  try {
    token = await prisma.$transaction(async (tx) => {
      /* A request whose link has died still occupies the unique slot. Release
         it — only the dead ones: a live request that appeared since the check
         above keeps its slot, and the write below loses to it. */
      await tx.user.updateMany({
        where: {
          id: { not: user.id },
          pendingEmail: input.newEmail,
          OR: [{ pendingEmailRequestedAt: null }, { pendingEmailRequestedAt: { lte: staleBefore } }],
        },
        data: { pendingEmail: null, pendingEmailRequestedAt: null },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { pendingEmail: input.newEmail, pendingEmailRequestedAt: now },
      });
      return issueAccountActionToken(tx, {
        userId: user.id,
        kind: "email_change",
        newEmail: input.newEmail,
        now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "EMAIL_IN_USE" };
    throw error;
  }

  await createAuditLog({
    userId: user.id,
    action: "PROFILE_EMAIL_CHANGE_REQUESTED",
    entityType: "User",
    entityId: user.id,
    metadata: { pendingEmail: maskEmail(input.newEmail) },
    request,
  });

  await sendMail(
    emailChangeConfirmMessage({
      to: input.newEmail,
      name: user.name,
      link: accountLink(mail.config.origin, "email_change", token),
    }),
    { userId: user.id },
  );
  await sendMail(
    emailChangeNoticeMessage({ to: user.email, name: user.name, newEmail: input.newEmail }),
    { userId: user.id },
  );

  return { ok: true, pendingEmail: input.newEmail };
}

export type EmailChangeConfirmation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "INVALID_TOKEN" | "EMAIL_IN_USE" };

export async function confirmEmailChange(
  token: unknown,
  request?: Request,
): Promise<EmailChangeConfirmation> {
  const now = new Date();
  let outcome:
    | { kind: "done"; userId: number; oldEmail: string; newEmail: string; name: string | null }
    | { kind: "invalid" }
    | { kind: "in_use"; userId: number };

  try {
    outcome = await prisma.$transaction(async (tx) => {
      const claim = await consumeAccountActionToken(tx, token, "email_change", now);
      if (!claim || !claim.newEmail) return { kind: "invalid" as const };
      const user = await tx.user.findUnique({
        where: { id: claim.userId },
        select: { id: true, email: true, name: true, pendingEmail: true },
      });
      /* The request this link belongs to must still be the pending one: a
         cancelled or replaced request leaves its link dead even if unspent. */
      if (!user || user.pendingEmail !== claim.newEmail) return { kind: "invalid" as const };
      const holder = await tx.user.findFirst({
        where: { id: { not: user.id }, email: claim.newEmail },
        select: { id: true },
      });
      if (holder) {
        await tx.user.update({
          where: { id: user.id },
          data: { pendingEmail: null, pendingEmailRequestedAt: null },
        });
        return { kind: "in_use" as const, userId: user.id };
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: claim.newEmail,
          pendingEmail: null,
          pendingEmailRequestedAt: null,
          emailVerifiedAt: now,
        },
      });
      await retireLinksOnEmailChange(tx, user.id, now);
      return {
        kind: "done" as const,
        userId: user.id,
        oldEmail: user.email,
        newEmail: claim.newEmail,
        name: user.name,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "EMAIL_IN_USE" };
    throw error;
  }

  if (outcome.kind === "invalid") {
    await createAuditLog({ action: "PROFILE_EMAIL_CHANGE_REJECTED", entityType: "User", request });
    return { ok: false, code: "INVALID_TOKEN" };
  }
  if (outcome.kind === "in_use") {
    await createAuditLog({
      userId: outcome.userId,
      action: "PROFILE_EMAIL_CHANGE_REJECTED",
      entityType: "User",
      entityId: outcome.userId,
      metadata: { reason: "email_in_use" },
      request,
    });
    return { ok: false, code: "EMAIL_IN_USE" };
  }

  await createAuditLog({
    userId: outcome.userId,
    action: "PROFILE_EMAIL_CHANGED",
    entityType: "User",
    entityId: outcome.userId,
    metadata: { email: maskEmail(outcome.newEmail) },
    request,
  });
  await sendMail(
    emailChangedMessage({ to: outcome.oldEmail, name: outcome.name, newEmail: outcome.newEmail }),
    { userId: outcome.userId },
  );
  return { ok: true };
}

/** Withdraw a pending change: the address is forgotten and its link stops working. */
export async function cancelEmailChange(userId: number, request?: Request): Promise<void> {
  await prisma.$transaction((tx) => dropPendingEmailChange(tx, userId));
  await createAuditLog({
    userId,
    action: "PROFILE_EMAIL_CHANGE_CANCELLED",
    entityType: "User",
    entityId: userId,
    request,
  });
}
