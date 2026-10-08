/**
 * ACCOUNT RECOVERY — what one change does to the links mailed before it.
 *
 * Three flows put links in mailboxes, and every link is a way to act on the
 * account for whoever can read that mailbox. So the flows cannot be judged one
 * at a time. Walked against each other, before any message was ever sent:
 *
 *   - A change of address is requested by someone who has the password, and
 *     its link sits in THEIR mailbox for a day. The owner is told at the old
 *     address and does the natural thing: changes the password. If the link
 *     survived that, the stranger would open it afterwards — it needs no
 *     session — move the account to their own mailbox and reset the password
 *     from there. So A PENDING CHANGE OF ADDRESS DOES NOT SURVIVE A CHANGE OF
 *     PASSWORD, whether the password was changed in the profile or reset by
 *     link. Changing the password is, by itself, enough to stop the change.
 *
 *   - A reset link was mailed to the address the account had an hour ago. The
 *     account has since moved to another mailbox — often BECAUSE the old one
 *     was lost. If the link survived, the old mailbox could still set the
 *     password. So A RESET LINK DOES NOT SURVIVE A CHANGE OF ADDRESS, nor a
 *     change of password in the profile, which is the owner saying the
 *     credential is settled.
 *
 *   - A confirmation link mailed to the old address says nothing about the new
 *     one, so it is spent when the address changes.
 *
 * Each rule is one function, called INSIDE the transaction that makes the
 * change: there is no moment at which the change is committed and the older
 * link still works.
 *
 * A PENDING ADDRESS IS HELD ONLY WHILE ITS LINK CAN BE USED. `pendingEmail` is
 * unique, so a request nobody confirmed would otherwise keep an address away
 * from every other account for ever, and the profile would say «ждёт
 * подтверждения» about a link that died yesterday. Past the link's lifetime a
 * pending address is not pending: reads report none, and another account may
 * ask for it.
 */
import type { Prisma } from "@prisma/client";
import { ACCOUNT_TOKEN_TTL_MS, revokeAccountActionTokens } from "@/lib/account/tokens";

type PendingFields = { pendingEmail: string | null; pendingEmailRequestedAt: Date | null };

/** Requests made at or before this moment have no usable link left. */
export function pendingEmailStaleBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACCOUNT_TOKEN_TTL_MS.email_change);
}

/** The address waiting to replace the current one, while its link can still be used. */
export function livePendingEmail(user: PendingFields, now: Date = new Date()): string | null {
  if (!user.pendingEmail || !user.pendingEmailRequestedAt) return null;
  return user.pendingEmailRequestedAt.getTime() > pendingEmailStaleBefore(now).getTime()
    ? user.pendingEmail
    : null;
}

/** Forget a learner's pending change of address and retire its link. */
export async function dropPendingEmailChange(
  tx: Prisma.TransactionClient,
  userId: number,
  now: Date = new Date(),
): Promise<void> {
  await tx.user.updateMany({
    where: { id: userId, pendingEmail: { not: null } },
    data: { pendingEmail: null, pendingEmailRequestedAt: null },
  });
  await revokeAccountActionTokens(tx, userId, "email_change", now);
}

/** The password changed: no pending change of address and no reset link outlives it. */
export async function retireLinksOnPasswordChange(
  tx: Prisma.TransactionClient,
  userId: number,
  now: Date = new Date(),
): Promise<void> {
  await dropPendingEmailChange(tx, userId, now);
  await revokeAccountActionTokens(tx, userId, "password_reset", now);
}

/** The address changed: nothing mailed to the old one can act on the account any more. */
export async function retireLinksOnEmailChange(
  tx: Prisma.TransactionClient,
  userId: number,
  now: Date = new Date(),
): Promise<void> {
  await revokeAccountActionTokens(tx, userId, "password_reset", now);
  await tx.emailVerificationToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: now },
  });
}
