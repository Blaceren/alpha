/**
 * FDCONF-1 — regression tests for the first-deposit read model.
 *
 * THE DEFECT THESE LOCK. On live PREPROD, user 66 held a canonical first
 * deposit — provider event, conversion, CPA qualification and a paid commission
 * — while `ExchangeAccount.firstDepositConfirmed` still read 0, and the learner
 * dashboard read that column. The learner was told their first deposit was not
 * confirmed while ATA owed a partner 120.00 USD for it.
 *
 * THE OPPOSITE FAILURE IS LOCKED TOO. Two historical learners (27 and 33) hold
 * the legacy flag and NO canonical event. A canonical-only read would have
 * silently revoked their confirmation, which is rewriting history rather than
 * fixing a read model — so `legacy historical state` has a test of its own.
 *
 * The database is faked at the two calls the resolver actually makes, so these
 * are tests of the PRECEDENCE RULE rather than of Prisma.
 */
import { describe, expect, it } from "vitest";
import {
  resolveFirstDepositConfirmation,
  resolveFirstDepositConfirmations,
} from "./first-deposit-truth";

type ConversionRow = { userId: number; occurredAt: Date };

/**
 * A stand-in for the two reads the resolver performs, which also ASSERTS what it
 * may not read: any access to a balance, a deposit total or a checkpoint would
 * have to appear here as a third fake, and there is deliberately no room for one.
 */
function fakeDb(input: {
  conversions?: ConversionRow[];
  legacyConfirmedUserIds?: number[];
}) {
  const conversions = input.conversions ?? [];
  const legacy = new Set(input.legacyConfirmedUserIds ?? []);
  const calls = { conversion: 0, legacy: 0, legacyQueriedFor: [] as number[] };

  return {
    calls,
    db: {
      affiliateConversionEvent: {
        findMany: async ({ where }: { where: { userId: { in: number[] }; eventType: string } }) => {
          calls.conversion += 1;
          expect(where.eventType).toBe("first_deposit");
          return conversions
            .filter((row) => where.userId.in.includes(row.userId))
            .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        },
      },
      exchangeAccount: {
        findMany: async ({
          where,
        }: {
          where: { userId: { in: number[] }; firstDepositConfirmed: boolean };
        }) => {
          calls.legacy += 1;
          calls.legacyQueriedFor.push(...where.userId.in);
          expect(where.firstDepositConfirmed).toBe(true);
          return where.userId.in.filter((id) => legacy.has(id)).map((userId) => ({ userId }));
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const AT = new Date("2026-08-15T15:52:16.308Z");

describe("first deposit confirmation truth", () => {
  it("FTD PRESENT: a canonical conversion confirms, and names itself as the source", async () => {
    const { db } = fakeDb({ conversions: [{ userId: 66, occurredAt: AT }] });
    await expect(resolveFirstDepositConfirmation(db, 66)).resolves.toEqual({
      confirmed: true,
      source: "canonical_conversion",
      occurredAt: AT,
    });
  });

  it("FTD ABSENT: no evidence anywhere is `none`, never a guess", async () => {
    const { db } = fakeDb({});
    await expect(resolveFirstDepositConfirmation(db, 99)).resolves.toEqual({
      confirmed: false,
      source: "none",
      occurredAt: null,
    });
  });

  /**
   * The canonical ledger records an UNATTRIBUTED first deposit exactly as it
   * records an attributed one — learners 62 and 63 on live PREPROD have no
   * AffiliateAttribution and still deposited. Whether a partner is owed money is
   * a different question with a different owner, and it must not leak into
   * whether the learner deposited.
   */
  it("UNATTRIBUTED FTD: confirms the learner even though no partner is owed", async () => {
    const { db } = fakeDb({ conversions: [{ userId: 63, occurredAt: AT }] });
    await expect(resolveFirstDepositConfirmation(db, 63)).resolves.toEqual({
      confirmed: true,
      source: "canonical_conversion",
      occurredAt: AT,
    });
  });

  /**
   * A duplicate delivery cannot create a second conversion — UNIQUE(eventType,
   * sourceOwner, sourceEventId) forbids it — but if one somehow existed the
   * answer must still be a single confirmation at the EARLIEST instant, not a
   * later one and not a doubled record.
   */
  it("DUPLICATE FTD: collapses to one confirmation at the earliest instant", async () => {
    const later = new Date(AT.getTime() + 60_000);
    const { db } = fakeDb({
      conversions: [
        { userId: 66, occurredAt: later },
        { userId: 66, occurredAt: AT },
      ],
    });
    await expect(resolveFirstDepositConfirmation(db, 66)).resolves.toEqual({
      confirmed: true,
      source: "canonical_conversion",
      occurredAt: AT,
    });
  });

  it("LEGACY HISTORICAL STATE: a pre-ledger deposit is not revoked, and is labelled legacy", async () => {
    const { db } = fakeDb({ legacyConfirmedUserIds: [27, 33] });
    await expect(resolveFirstDepositConfirmation(db, 27)).resolves.toEqual({
      confirmed: true,
      source: "legacy_account_record",
      // NULL on purpose: the legacy column carries no instant, and `updatedAt`
      // is not one. Inventing a date would be the inference this module refuses.
      occurredAt: null,
    });
  });

  it("NEW CANONICAL FTD outranks a legacy flag, and the legacy set is not even consulted", async () => {
    const { db, calls } = fakeDb({
      conversions: [{ userId: 66, occurredAt: AT }],
      legacyConfirmedUserIds: [66],
    });
    await expect(resolveFirstDepositConfirmation(db, 66)).resolves.toEqual({
      confirmed: true,
      source: "canonical_conversion",
      occurredAt: AT,
    });
    // Precedence proved structurally: the legacy read never happened, so it
    // cannot have contributed to the answer.
    expect(calls.legacy).toBe(0);
  });

  it("resolves a mixed page in two queries, and asks the legacy set only about the undecided", async () => {
    const { db, calls } = fakeDb({
      conversions: [
        { userId: 62, occurredAt: AT },
        { userId: 66, occurredAt: AT },
      ],
      legacyConfirmedUserIds: [27],
    });

    const resolved = await resolveFirstDepositConfirmations(db, [27, 62, 66, 99]);

    expect(resolved.get(62)?.source).toBe("canonical_conversion");
    expect(resolved.get(66)?.source).toBe("canonical_conversion");
    expect(resolved.get(27)?.source).toBe("legacy_account_record");
    expect(resolved.get(99)).toEqual({ confirmed: false, source: "none", occurredAt: null });

    expect(calls.conversion).toBe(1);
    expect(calls.legacy).toBe(1);
    // The learners the canonical ledger already answered for are not re-asked.
    expect(calls.legacyQueriedFor.sort()).toEqual([27, 99]);
  });

  it("asks nothing at all for an empty page", async () => {
    const { db, calls } = fakeDb({});
    await expect(resolveFirstDepositConfirmations(db, [])).resolves.toEqual(new Map());
    expect(calls.conversion).toBe(0);
    expect(calls.legacy).toBe(0);
  });
});
