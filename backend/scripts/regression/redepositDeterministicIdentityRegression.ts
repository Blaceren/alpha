/**
 * POCKET-DEP-RDEP-1 (§14) — the redeposit retry / distinct-event matrix, run
 * against the REAL handler and a REAL migrated database.
 *
 * Not a unit test of the key function: that is covered separately. This drives
 * `ingestPocketRedeposit` end to end so the derived key, the canonical
 * `PocketProviderEvent` row, the partial unique index, the Growth event and the
 * delivery evidence are all exercised together.
 *
 * WHAT "CORRECT" MEANS HERE
 *   * only EXACT derived-key equality deduplicates;
 *   * every legitimately distinct input becomes its own canonical redeposit;
 *   * delivery evidence increments per delivery and is NEVER deduplicated away;
 *   * a first deposit is never touched, replaced or duplicated;
 *   * no CPA and no commission is created by any redeposit.
 *
 * THE COLLISION CASE IS A PASS, NOT A BUG. Two conceptually distinct deposits
 * by one player, same amount, same DATE_TIME second, derive one key and become
 * ONE canonical redeposit. That is BUSINESS_ACCEPTED_COLLISION_BEHAVIOUR — an
 * explicit product decision — and it is asserted here so a future engineer
 * cannot "fix" it by inventing a less stable identity.
 *
 *   DATABASE_URL="file:/path/to/a/MIGRATED/copy.sqlite" \
 *     npx tsx scripts/regression/redepositDeterministicIdentityRegression.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { ingestPocketRedeposit } from "@/lib/growth/pocket/redeposit";

const ZONE_ENV = {} as unknown as NodeJS.ProcessEnv;

let passed = 0;
const check = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

function params(player: string, sum: string, dateTime: string | null, clickId: string): URLSearchParams {
  const p = new URLSearchParams();
  p.set("clickid", clickId);
  p.set("goal", "redep");
  p.set("playerid", player);
  p.set("sum", sum);
  if (dateTime !== null) p.set("date_time", dateTime);
  return p;
}

async function main(): Promise<number> {
  const db = new PrismaClient();
  console.log("REDEPOSIT DETERMINISTIC IDENTITY REGRESSION");

  // A learner, a click and a first deposit, so redeposits have somewhere to land.
  const suffix = String(Date.now()).slice(-9);
  const player = `9${suffix.slice(0, 8)}`;
  const otherPlayer = `8${suffix.slice(0, 8)}`;
  const clickId = `tq-${crypto.randomUUID()}`;
  const otherClickId = `tq-${crypto.randomUUID()}`;

  const user = await db.user.create({
    data: {
      email: `rdep-${suffix}@ata-preprod.invalid`,
      name: "RDEP fixture",
      passwordHash: "",
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  const otherUser = await db.user.create({
    data: {
      email: `rdep2-${suffix}@ata-preprod.invalid`,
      name: "RDEP fixture 2",
      passwordHash: "",
      updatedAt: new Date(),
    },
    select: { id: true },
  });

  for (const [u, c, p] of [
    [user.id, clickId, player],
    [otherUser.id, otherClickId, otherPlayer],
  ] as const) {
    await db.exchangeAccount.create({
      data: {
        userId: u,
        clickId: c,
        provider: "pocket",
        referralLink: "https://pocketoption.com/?click_id=" + c,
        exchangeAccountId: "acct-" + c.slice(3, 15),
        updatedAt: new Date(),
      },
    });
    await db.pocketTraderIdentity.create({
      data: { userId: u, pocketUserId: p, clickId: c, source: "registration_postback", boundAt: new Date() },
    });
    await db.pocketProviderEvent.create({
      data: {
        provider: "pocket",
        eventType: "first_deposit",
        pocketClickId: c,
        pocketPlayerId: p,
        matchedUserId: u,
        matchedAt: new Date(),
        status: "matched",
        normalizedAmount: "50.00",
        currencyStatus: "unspecified",
        firstReceivedAt: new Date(),
        lastReceivedAt: new Date(),
      },
    });
  }

  const ftdBefore = await db.pocketProviderEvent.count({ where: { eventType: "first_deposit" } });
  const conversionsBefore = await db.affiliateConversionEvent.count();

  const T1 = "2026-08-14 18:51:17";
  const T2 = "2026-08-14 19:10:00";

  const run = (pl: string, sum: string, dt: string | null, cl: string) =>
    ingestPocketRedeposit(db, { params: params(pl, sum, dt, cl), now: new Date(), env: ZONE_ENV });

  const canonicalCount = () => db.pocketProviderEvent.count({ where: { eventType: "redeposit" } });
  const rdepEvents = () => db.growthEvent.count({ where: { eventType: "rdep" } });
  const deliveries = () => db.providerIngressEvent.count({ where: { goal: "redep" } });

  await check("a first redeposit becomes one canonical event", async () => {
    const before = await canonicalCount();
    const r = await run(player, "25.00", T1, clickId);
    assert.equal(r.kind, "emitted");
    assert.equal(await canonicalCount(), before + 1);
  });

  await check("SEQUENTIAL retry of the same key does NOT create a second", async () => {
    const before = await canonicalCount();
    const g = await rdepEvents();
    const d = await deliveries();
    const r1 = await run(player, "25.00", T1, clickId);
    const r2 = await run(player, "25.00", T1, clickId);
    assert.equal(await canonicalCount(), before, "canonical redeposits must not grow on a retry");
    assert.equal(await rdepEvents(), g, "growth rdep must not grow on a retry");
    assert.equal(await deliveries(), d + 2, "delivery EVIDENCE must grow, one row per delivery");
    for (const r of [r1, r2]) assert.equal(r.kind, "duplicate");
  });

  await check("CONCURRENT deliveries of the same key produce exactly one", async () => {
    const before = await canonicalCount();
    const g = await rdepEvents();
    const results = await Promise.allSettled([
      run(player, "25.00", T1, clickId),
      run(player, "25.00", T1, clickId),
      run(player, "25.00", T1, clickId),
    ]);
    assert.equal(await canonicalCount(), before, "concurrency must not create a second canonical row");
    assert.equal(await rdepEvents(), g);
    assert.ok(results.some((r) => r.status === "fulfilled"), "at least one delivery must settle");
  });

  await check("a LATER DATE_TIME, same amount, is a SECOND canonical redeposit", async () => {
    const before = await canonicalCount();
    const r = await run(player, "25.00", T2, clickId);
    assert.equal(r.kind, "emitted");
    assert.equal(await canonicalCount(), before + 1);
  });

  await check("the SAME DATE_TIME with a DIFFERENT amount is distinct", async () => {
    const before = await canonicalCount();
    const r = await run(player, "25.01", T1, clickId);
    assert.equal(r.kind, "emitted");
    assert.equal(await canonicalCount(), before + 1);
  });

  await check("a DIFFERENT player with the same DATE_TIME and amount is distinct", async () => {
    const before = await canonicalCount();
    const r = await run(otherPlayer, "25.00", T1, otherClickId);
    assert.equal(r.kind, "emitted");
    assert.equal(await canonicalCount(), before + 1);
  });

  await check("BUSINESS_ACCEPTED_COLLISION_BEHAVIOUR — two conceptual deposits collapse to one", async () => {
    // Same player, same exact amount, same DATE_TIME second, delivered twice as
    // two genuinely distinct deposits. ATA cannot tell them apart under the
    // accepted contract and records ONE. This is a PASS.
    const before = await canonicalCount();
    const a = await run(player, "77.00", "2026-08-14 20:00:00", clickId);
    const b = await run(player, "77.00", "2026-08-14 20:00:00", clickId);
    assert.equal(a.kind, "emitted");
    assert.equal(b.kind, "duplicate", "the second is indistinguishable from a retry, by design");
    assert.equal(await canonicalCount(), before + 1, "exactly one canonical redeposit — accepted trade-off");
  });

  await check("a missing DATE_TIME fails closed with durable evidence", async () => {
    const before = await canonicalCount();
    const d = await deliveries();
    const r = await run(player, "31.00", null, clickId);
    assert.equal(r.kind, "identity_unresolved");
    assert.equal(await canonicalCount(), before, "no canonical money without an event time");
    assert.equal(await deliveries(), d + 1, "the delivery is still recorded as evidence");
  });

  await check("a malformed DATE_TIME fails closed", async () => {
    const before = await canonicalCount();
    for (const bad of ["2026-02-30 10:00:00", "14/08/2026 10:00:00", "2026-08-14", "2026-08-14 25:00:00"]) {
      const r = await run(player, "32.00", bad, clickId);
      assert.equal(r.kind, "identity_unresolved", `must refuse ${bad}`);
    }
    assert.equal(await canonicalCount(), before);
  });

  await check("an UNKNOWN timezone does NOT reject an otherwise valid redeposit", async () => {
    // The corrected product model: Pocket renders DATE_TIME in a zone that
    // varies by user/account/GEO, so an unknown zone is the ORDINARY case and
    // must not destroy financial truth.
    const before = await canonicalCount();
    const r = await run(player, "33.00", "2026-08-14 21:00:00", clickId);
    assert.equal(r.kind, "emitted", "a valid redeposit must be created without a zone");
    assert.equal(await canonicalCount(), before + 1);

    const row = await db.pocketProviderEvent.findFirst({
      where: { eventType: "redeposit", normalizedAmount: "33.00" },
      select: { providerEventLocal: true, providerEventAt: true, providerEventAtStatus: true, providerEventAtRaw: true },
    });
    assert.equal(row?.providerEventLocal, "2026-08-14T21:00:00", "the local wall clock is preserved");
    assert.equal(row?.providerEventAt, null, "the absolute instant stays UNKNOWN rather than guessed");
    assert.equal(row?.providerEventAtStatus, "local_only", "and the row says so");
    assert.equal(row?.providerEventAtRaw, "2026-08-14 21:00:00", "raw bytes kept");
  });

  await check("a sender-declared offset IS taken as the absolute instant", async () => {
    const r = await run(player, "34.00", "2026-08-14T21:00:00+02:00", clickId);
    assert.equal(r.kind, "emitted");
    const row = await db.pocketProviderEvent.findFirst({
      where: { eventType: "redeposit", normalizedAmount: "34.00" },
      select: { providerEventLocal: true, providerEventAt: true, providerEventAtStatus: true },
    });
    assert.equal(row?.providerEventAtStatus, "absolute_from_sender");
    assert.equal(row?.providerEventAt?.toISOString(), "2026-08-14T19:00:00.000Z");
    assert.equal(row?.providerEventLocal, "2026-08-14T21:00:00", "the local half stays zone-free for the key");
  });

  await check("occurredAt names its own authority, and never lies about it", async () => {
    const events = await db.growthEvent.findMany({
      where: { eventType: "rdep" },
      select: { occurredAt: true, sourceEntityId: true, metadata: true },
    });
    assert.ok(events.length > 0);
    for (const ev of events) {
      const canonical = await db.pocketProviderEvent.findUnique({
        where: { id: Number(ev.sourceEntityId) },
        select: { providerEventAt: true, firstReceivedAt: true, providerEventAtStatus: true },
      });
      assert.ok(canonical);
      const authority = (ev.metadata as { occurredAtAuthority?: string } | null)?.occurredAtAuthority;

      if (canonical!.providerEventAt !== null) {
        assert.equal(authority, "provider_event_instant");
        assert.equal(ev.occurredAt.getTime(), canonical!.providerEventAt!.getTime());
      } else {
        // The narrowest truthful fallback, and it is LABELLED as such.
        assert.equal(authority, "ata_receipt_time", "an unknown provider instant must be labelled");
        assert.equal(canonical!.providerEventAtStatus, "local_only");
      }
    }
  });

  await check("no first deposit was created, replaced or duplicated", async () => {
    assert.equal(await db.pocketProviderEvent.count({ where: { eventType: "first_deposit" } }), ftdBefore);
    const ftd = await db.pocketProviderEvent.findFirst({
      where: { eventType: "first_deposit", pocketPlayerId: player },
      select: { normalizedAmount: true },
    });
    assert.equal(ftd?.normalizedAmount, "50.00", "the first deposit amount is untouched");
  });

  await check("no CPA qualification and no commission was created by any redeposit", async () => {
    assert.equal(await db.affiliateConversionEvent.count(), conversionsBefore);
  });

  await check("delivery evidence was never deduplicated away", async () => {
    const canonical = await canonicalCount();
    const delivered = await deliveries();
    assert.ok(delivered > canonical, "more deliveries than canonical events, as designed");
  });

  console.log(`\n${passed}/${passed} assertions passed`);
  await db.$disconnect();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
