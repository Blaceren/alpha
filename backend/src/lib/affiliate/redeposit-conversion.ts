/**
 * AFFILIATE-PLATFORM-V1 §25/§41 — the affiliate conversion for a REDEPOSIT.
 *
 * A STATISTIC AND A POSTBACK. NEVER A CPA EVENT.
 *
 * This module writes an `AffiliateConversionEvent` of type `redeposit` and does
 * nothing else. It does not call the qualification owner, it does not import
 * it, and it could not mint a commission if it tried: `qualifyFirstDeposit`
 * refuses any event type but `first_deposit`, so the invariant holds at BOTH
 * ends — this side never asks, and that side would say no.
 *
 * WHY A REDEPOSIT NEEDS A CONVERSION ROW AT ALL. A partner is owed the truth
 * about redeposit volume: it is how they judge traffic quality, and it is a
 * standard outbound event in every affiliate integration. Until this phase, a
 * redeposit existed as a canonical PocketProviderEvent and a Growth `rdep`
 * event and reached the affiliate ledger nowhere, so partner reporting could
 * not see it and partner postbacks could not carry it.
 *
 * ATTRIBUTION IS REUSED, NEVER PERFORMED — the same rule as the first deposit.
 * The learner's `AffiliateAttribution` was frozen at registration and is read
 * exactly as it stands. No click is selected at redeposit time, no later click
 * can win, and a learner who was direct at registration stays direct forever.
 *
 * AN UNATTRIBUTED REDEPOSIT STILL GETS A ROW, every affiliate column null,
 * exactly as an unattributed first deposit does. A redeposit that produced no
 * row would be indistinguishable from one the ledger dropped.
 *
 * THE TIME IS THE ONE THE CANONICAL FINANCIAL ROW ALREADY DECIDED. This module
 * takes `occurredAt` from its caller, which took it from the redeposit's own
 * temporal authority — the provider's instant when the delivery stated its
 * offset, ATA's receipt time when it did not, labelled either way on the growth
 * event. It never reads a clock of its own: a conversion whose time disagreed
 * with the financial row it projects would put the same money in two reporting
 * periods.
 */
import type { Prisma } from "@prisma/client";
import { randomBase32Id } from "@/lib/affiliate/random-id";

export const REDEPOSIT_SOURCE_OWNER = "pocket_redeposit" as const;

/**
 * The ledger's idempotency key for a redeposit conversion.
 *
 * IT NAMES THE CANONICAL PocketProviderEvent ROW, never a Pocket player, never
 * a click id and never ATA's derived provider key. The canonical row is already
 * unique per derived key (migration 49's partial index), so keying on its row
 * id inherits that uniqueness without republishing a provider identifier into
 * the affiliate ledger — the same rule `pocket_first_deposit` follows.
 */
export function redepositConversionSourceEventId(providerEventId: number): string {
  return `pocket:redeposit:event:${providerEventId}`;
}

export type RedepositConversionCurrency =
  | { readonly status: "configured"; readonly code: string }
  | { readonly status: "unspecified"; readonly code: null };

/**
 * Write the one conversion event for this redeposit.
 *
 * CALLED INSIDE THE REDEPOSIT'S OWN TRANSACTION, alongside the canonical
 * financial row and the growth event. One fact, three readers, no drift: it
 * must be impossible for a redeposit to appear in the financial ledger and not
 * in the affiliate one, because a partner statistic that silently omits events
 * is worse than no statistic.
 */
export async function emitRedepositConversion(
  tx: Prisma.TransactionClient,
  input: {
    providerEventId: number;
    userId: number;
    normalizedAmount: string;
    currency: RedepositConversionCurrency;
    occurredAt: Date;
  },
): Promise<{ conversionEventId: number } | { conversionEventId: null; duplicate: true }> {
  const attribution = await tx.affiliateAttribution.findUnique({
    where: { userId: input.userId },
    select: {
      id: true,
      selectedClickId: true,
      selectedClick: {
        select: {
          trackingLink: {
            select: {
              id: true,
              publicCode: true,
              affiliatePartnerId: true,
              affiliateCampaignId: true,
              partner: { select: { code: true } },
              campaign: { select: { code: true } },
            },
          },
        },
      },
    },
  });

  const link = attribution?.selectedClick.trackingLink ?? null;

  try {
    const created = await tx.affiliateConversionEvent.create({
      data: {
        eventId: randomBase32Id(),
        eventType: "redeposit",
        userId: input.userId,
        attributionId: attribution?.id ?? null,
        selectedClickId: attribution?.selectedClickId ?? null,
        affiliatePartnerId: link?.affiliatePartnerId ?? null,
        affiliateCampaignId: link?.affiliateCampaignId ?? null,
        trackingLinkId: link?.id ?? null,
        affiliateCodeSnapshot: link?.partner.code ?? null,
        campaignCodeSnapshot: link?.campaign?.code ?? null,
        trackingLinkPublicCodeSnapshot: link?.publicCode ?? null,
        sourceOwner: REDEPOSIT_SOURCE_OWNER,
        sourceEventId: redepositConversionSourceEventId(input.providerEventId),
        // THE EXACT PROVIDER AMOUNT, carried through unchanged. §41 requires the
        // redeposit amount to be exact, and this is a projection of a value the
        // canonical financial row already established — not a second decision.
        providerAmount: input.normalizedAmount,
        currencyCode: input.currency.code,
        currencyStatus: input.currency.status,
        occurredAt: input.occurredAt,
      },
      select: { id: true },
    });
    return { conversionEventId: created.id };
  } catch (error) {
    // A second delivery of the same canonical redeposit. The caller already
    // guards on the canonical row being new, so reaching here means two paths
    // raced — and the answer is the same either way: one conversion exists.
    if (isRedepositConversionCollision(error)) {
      return { conversionEventId: null, duplicate: true };
    }
    throw error;
  }
}

/** Matched on the constraint target, so an unrelated unique failure still throws. */
export function isRedepositConversionCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") return false;
  return JSON.stringify(candidate.meta ?? {}).includes("sourceEventId");
}
