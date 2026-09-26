/**
 * AFFILIATE-PLATFORM-V1 §10/§11 — the CPA configuration owner.
 *
 * THE CAMPAIGN IS THE COMMERCIAL OWNER (§9), and this module is the only writer
 * of its price. A price is never edited: setting a new CPA SUPERSEDES the
 * current version and appends a new one, inside one transaction, so at no
 * instant does a campaign have two live prices or none by accident.
 *
 * WHY THIS IS NOT THREE MUTABLE COLUMNS ON THE CAMPAIGN. With a mutable
 * `cpaAmount`, the only thing standing between changing a price and rewriting
 * every commission ever earned under it is that the qualification remembered to
 * copy the value. §11 forbids the rewrite and §42 requires proving it does not
 * happen — and "the code copies it" is a property of the code, provable only by
 * reading every future call site. An append-only version makes it a property of
 * the schema: there is no UPDATE path that can reach the amount a past
 * commission was computed from.
 *
 * THE AMOUNT SHAPE IS DELIBERATELY IDENTICAL TO THE PROVIDER MONEY SHAPE.
 * Canonical decimal TEXT, exactly two fraction digits, no sign, no exponent, no
 * separator, positive. Not because a CPA is a deposit — they are different
 * numbers with different owners and §51 forbids ever presenting one as the
 * other — but because a product with two spellings of money eventually compares
 * them as strings and gets a wrong answer. One shape, one parser.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import { parsePocketDepositAmount } from "@/lib/exchange/pocketDepositAmount";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The currencies ATA may configure a CPA in.
 *
 * AN ALLOWLIST, NOT AN ISO-4217 VALIDATOR. Accepting all 180 codes would let an
 * operator configure a campaign in a currency no downstream surface can group,
 * total or explain. Extending this list is a deliberate product act.
 */
export const SUPPORTED_CPA_CURRENCIES = ["USD", "EUR"] as const;
export type CpaCurrency = (typeof SUPPORTED_CPA_CURRENCIES)[number];

export function isSupportedCpaCurrency(value: string): value is CpaCurrency {
  return (SUPPORTED_CPA_CURRENCIES as readonly string[]).includes(value);
}

export type CpaTermsRejection =
  | "amount_empty"
  | "amount_too_long"
  | "amount_malformed"
  | "amount_not_positive"
  | "currency_unsupported"
  | "campaign_not_found"
  | "campaign_not_active";

/**
 * Parse a CPA amount into canonical form.
 *
 * DELEGATES TO THE ONE MONEY PARSER THIS REPOSITORY HAS. It is named for the
 * provider because that is where it was first needed, not because its rules are
 * provider-specific: they are the canonical decimal-TEXT rules, and the storage
 * CHECK on `AffiliateCampaignTerms.cpaAmount` is the same shape.
 *
 * NORMALISATION IS PADDING, NEVER ROUNDING. `120` becomes `120.00`. An input
 * that would need rounding to fit two decimals is refused, because rounding
 * somebody's commercial terms without being told to is how a dispute starts.
 */
export function parseCpaAmount(
  raw: string | undefined | null,
): { ok: true; normalized: string } | { ok: false; reason: CpaTermsRejection } {
  const parsed = parsePocketDepositAmount(raw);
  if (parsed.ok) return { ok: true, normalized: parsed.normalized };
  const mapped: Record<string, CpaTermsRejection> = {
    empty: "amount_empty",
    too_long: "amount_too_long",
    malformed: "amount_malformed",
    not_positive: "amount_not_positive",
  };
  return { ok: false, reason: mapped[parsed.reason] ?? "amount_malformed" };
}

export type ActiveTerms = {
  readonly id: number;
  readonly publicId: string;
  readonly version: number;
  readonly cpaAmount: string;
  readonly cpaCurrency: string;
  readonly effectiveFrom: Date;
};

/**
 * The campaign's current price, or null if it has none.
 *
 * NULL IS A REAL ANSWER, not a missing one. A campaign with no active terms is
 * a campaign whose commercial terms have not been agreed, and the qualifier
 * refuses to invent one — see `qualification.ts` precondition 4.
 */
export async function getActiveCampaignTerms(
  db: Db,
  affiliateCampaignId: number,
): Promise<ActiveTerms | null> {
  const row = await db.affiliateCampaignTerms.findFirst({
    where: { affiliateCampaignId, status: "active" },
    select: {
      id: true,
      publicId: true,
      version: true,
      cpaAmount: true,
      cpaCurrency: true,
      effectiveFrom: true,
    },
  });
  return row;
}

export type SetCpaTermsResult =
  | {
      readonly ok: true;
      readonly termsId: number;
      readonly publicId: string;
      readonly version: number;
      readonly cpaAmount: string;
      readonly cpaCurrency: string;
      /** What was superseded, so the audit record can state both sides. */
      readonly previous: { readonly version: number; readonly cpaAmount: string; readonly cpaCurrency: string } | null;
    }
  | { readonly ok: false; readonly reason: CpaTermsRejection };

/**
 * Set a campaign's CPA, creating a new version and superseding the old one.
 *
 * ONE TRANSACTION, TWO WRITES, AND THE INDEX BETWEEN THEM. The supersede runs
 * before the insert, so the partial unique index `WHERE status = 'active'` is
 * satisfied at commit. If two operators price the same campaign concurrently,
 * one of them collides on that index and fails loudly rather than leaving two
 * live prices for the qualifier to choose between.
 *
 * IT NEVER TOUCHES A QUALIFICATION OR A COMMISSION. §11 in one sentence:
 * changing 100 to 150 writes exactly one new row and rewrites nothing. Every
 * commission earned under version 1 keeps naming version 1 and keeps its own
 * copy of 100.00.
 *
 * IT IS NOT RETROACTIVE IN THE OTHER DIRECTION EITHER. `effectiveFrom` is the
 * moment of the change, and a qualification always reads the version that is
 * ACTIVE when it fires — so a price set today does not reach a deposit that
 * qualified yesterday, and could not, since that qualification already exists.
 */
export async function setCampaignCpaTerms(
  db: PrismaClient,
  input: {
    affiliateCampaignId: number;
    cpaAmount: string;
    cpaCurrency: string;
    actorUserId: number;
    now: Date;
  },
): Promise<SetCpaTermsResult> {
  const amount = parseCpaAmount(input.cpaAmount);
  if (!amount.ok) return { ok: false, reason: amount.reason };

  const currency = input.cpaCurrency.trim().toUpperCase();
  if (!isSupportedCpaCurrency(currency)) {
    return { ok: false, reason: "currency_unsupported" };
  }

  const campaign = await db.affiliateCampaign.findUnique({
    where: { id: input.affiliateCampaignId },
    select: { id: true, status: true },
  });
  if (campaign === null) return { ok: false, reason: "campaign_not_found" };
  // A price may only be set on a campaign that can actually be used. Pricing an
  // archived campaign would create a live commercial term for something no link
  // can serve.
  if (campaign.status !== "active") return { ok: false, reason: "campaign_not_active" };

  return db.$transaction(async (tx) => {
    const current = await tx.affiliateCampaignTerms.findFirst({
      where: { affiliateCampaignId: input.affiliateCampaignId, status: "active" },
      select: { id: true, version: true, cpaAmount: true, cpaCurrency: true },
    });

    if (current !== null) {
      await tx.affiliateCampaignTerms.update({
        where: { id: current.id },
        data: { status: "superseded", supersededAt: input.now },
      });
    }

    // The highest version ever issued for this campaign, superseded rows
    // included. Deriving it from the ACTIVE row would restart numbering after a
    // campaign spent time with no price.
    const highest = await tx.affiliateCampaignTerms.findFirst({
      where: { affiliateCampaignId: input.affiliateCampaignId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const created = await tx.affiliateCampaignTerms.create({
      data: {
        publicId: randomBase32Id(),
        affiliateCampaignId: input.affiliateCampaignId,
        version: (highest?.version ?? 0) + 1,
        cpaAmount: amount.normalized,
        cpaCurrency: currency,
        status: "active",
        effectiveFrom: input.now,
        createdByUserId: input.actorUserId,
      },
      select: { id: true, publicId: true, version: true },
    });

    return {
      ok: true as const,
      termsId: created.id,
      publicId: created.publicId,
      version: created.version,
      cpaAmount: amount.normalized,
      cpaCurrency: currency,
      previous:
        current === null
          ? null
          : { version: current.version, cpaAmount: current.cpaAmount, cpaCurrency: current.cpaCurrency },
    };
  });
}
