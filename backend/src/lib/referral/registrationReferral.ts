/**
 * AFD-3A2 — the ATA invitation referral contract for registration.
 *
 * THE DEFECT THIS FILE EXISTS TO FIX
 * `POST /api/auth/register` used to decide the whole question in one condition:
 *
 *     if (referralCode && (!inviter || !referralConfig?.isActive)) → REFERRAL_INVALID
 *
 * That conflates two unrelated facts. `inviter` answers "does this person
 * exist?" — a property of the invitation. `referralConfig.isActive` answers
 * "is the platform currently paying a bonus?" — a property of the marketing
 * programme. Joining them with `||` means switching the bonus programme off, or
 * simply never having switched one on, silently invalidates every genuine
 * invitation in circulation.
 *
 * That is not hypothetical. The live database has ZERO `ReferralBonusConfig`
 * rows, so on the day the public registration page shipped, every real ATA
 * invite link would have been rejected as "Ссылка-приглашение недействительна"
 * — telling an invited person their friend's link was fake.
 *
 * THE FOUR QUESTIONS, ANSWERED SEPARATELY
 *   A. Is the inviter code valid?          → `inviter` lookup. Only this can reject.
 *   B. May a relationship be recorded?     → yes, whenever A holds.
 *   C. Is a bonus programme configured?    → `ReferralBonusConfig` lookup.
 *   D. Are rewards payable?                → only when C holds AND is active.
 *
 * WHY A RELATIONSHIP WITHOUT A REWARD IS NOT AN INVENTED ZERO
 * The `Referral` model already distinguishes them. `xpEarned` and
 * `invitedXpEarned` default to `0`, and `bonusGrantedAt` is NULLABLE. A row with
 * a null `bonusGrantedAt` is the schema's own way of saying "this relationship
 * exists and no bonus has been granted". No new column, no migration, no
 * invented economic value, and no XP event: the reward ledger stays empty.
 *
 * NAMING. This is the ATA INVITATION system. It is not affiliate acquisition
 * attribution and not a Pocket referral click id; those are separate systems
 * with separate identifiers, and no term is shared with them here.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

/** The bonus programme row the registration path consults. */
export const DEFAULT_REFERRAL_BONUS_SLUG = "default";

/** Why a referral relationship carries no reward. Bounded, non-economic. */
export type ReferralRewardState =
  /** No `ReferralBonusConfig` row exists for the default programme. */
  | "not_configured"
  /** A row exists but `isActive` is false. */
  | "inactive"
  /** A row exists, is active, and rewards are payable. */
  | "payable";

/** What the registration route should do about `referralCode`. */
export type ReferralResolution =
  /** No code was supplied. No relationship, no reward. */
  | { readonly kind: "absent" }
  /**
   * A code was supplied and no user owns it. The ONLY rejecting outcome, and
   * the only thing that still produces `REFERRAL_INVALID`.
   */
  | { readonly kind: "invalid" }
  /**
   * The code is valid. `reward` says whether anything is payable; when it is
   * not, the relationship is still recorded.
   */
  | {
      readonly kind: "accepted";
      readonly inviterId: number;
      readonly reward: ReferralRewardState;
      /** Present only when `reward === "payable"`. */
      readonly bonus: { readonly inviterXp: number; readonly invitedXp: number } | null;
    };

type ReferralClient = Pick<PrismaClient, "user" | "referralBonusConfig">;

/**
 * Resolve the referral contract before the write transaction opens.
 *
 * Reads only. It performs no mutation, grants nothing, and never creates a
 * `ReferralBonusConfig` row — inventing a bonus programme, even an empty one,
 * would be a product decision this code has no authority to make.
 */
export async function resolveRegistrationReferral(
  db: ReferralClient,
  referralCode: string | undefined,
): Promise<ReferralResolution> {
  if (!referralCode) return { kind: "absent" };

  const inviter = await db.user.findUnique({
    where: { referralCode },
    select: { id: true, status: true },
  });

  // Question A, and only question A. An unknown or malformed code is invalid
  // because nobody owns it — never because the platform is not paying today.
  if (!inviter) return { kind: "invalid" };

  // A blocked inviter is a real account whose invitations must stop working.
  // Treated as invalid rather than as "valid but unrewarded": a blocked account
  // should not keep accruing a downline, and the invitee gets the same generic
  // answer as for an unknown code, which leaks nothing about the block.
  if (inviter.status === "blocked") return { kind: "invalid" };

  const config = await db.referralBonusConfig.findUnique({
    where: { slug: DEFAULT_REFERRAL_BONUS_SLUG },
    select: { isActive: true, inviterXp: true, invitedXp: true },
  });

  if (!config) {
    return { kind: "accepted", inviterId: inviter.id, reward: "not_configured", bonus: null };
  }
  if (!config.isActive) {
    return { kind: "accepted", inviterId: inviter.id, reward: "inactive", bonus: null };
  }

  return {
    kind: "accepted",
    inviterId: inviter.id,
    reward: "payable",
    bonus: { inviterXp: config.inviterXp, invitedXp: config.invitedXp },
  };
}

/**
 * Re-check, inside the transaction, the mutable facts the resolution depends on.
 *
 * The resolution above is computed BEFORE the transaction, so an inviter can be
 * blocked, or the bonus programme switched off, in the window between. Losing
 * that race must not pay a bonus the operator has just withdrawn, so the
 * conditions are read again transactionally and the reward is DEMOTED where
 * they no longer hold.
 *
 * Demotion only. A race can never promote `not_configured` into a payout and can
 * never turn an accepted invitation into a rejection — the invitee has already
 * been told their link was good, and failing their registration because a
 * marketing switch moved would be the original defect in a smaller window.
 */
export async function revalidateReferralReward(
  tx: Prisma.TransactionClient,
  resolution: Extract<ReferralResolution, { kind: "accepted" }>,
): Promise<ReferralRewardState> {
  if (resolution.reward !== "payable") return resolution.reward;

  const [inviter, config] = await Promise.all([
    tx.user.findUnique({ where: { id: resolution.inviterId }, select: { status: true } }),
    tx.referralBonusConfig.findUnique({
      where: { slug: DEFAULT_REFERRAL_BONUS_SLUG },
      select: { isActive: true, inviterXp: true, invitedXp: true },
    }),
  ]);

  if (!inviter || inviter.status === "blocked") return "inactive";
  if (!config) return "not_configured";
  if (!config.isActive) return "inactive";
  // The amounts must still be the ones the resolution priced. If an operator
  // edited them mid-request, pay nothing rather than pay a number this request
  // never validated.
  if (
    config.inviterXp !== resolution.bonus?.inviterXp ||
    config.invitedXp !== resolution.bonus.invitedXp
  ) {
    return "inactive";
  }

  return "payable";
}
