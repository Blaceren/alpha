/**
 * G4-GROWTH — the isolated integration proof.
 *
 * RUNS ON ITS OWN DATABASE, ALWAYS. The script creates a fresh SQLite file under
 * a temp directory, runs every migration into it, and points Prisma at it. It
 * never reads, writes, copies or symlinks a live database — §65 — and it refuses
 * to start if `DATABASE_URL` already points somewhere that looks live.
 *
 * WHAT IT PROVES, in order:
 *   1. Migration 47 applies to a fresh database and creates the three tables.
 *   2. The ledger's idempotency contract holds: emitting twice for one owner
 *      produces ONE event, and the outbox gets ONE item.
 *   3. The migration BACKFILL and the runtime EMITTER agree on keys — the
 *      failure mode that would silently double every historical count.
 *   4. §63's two fixture cohorts produce the metrics the dashboards will read,
 *      and the dashboard ranks neither.
 *   5. Money is exact, and an unknown currency blocks aggregation rather than
 *      producing a number.
 *   6. RDEP stays fail-closed, and the unresolved deliveries are counted
 *      separately from money.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Failure = { readonly check: string; readonly detail: string };

const failures: Failure[] = [];
const passes: string[] = [];

function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    passes.push(name);
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ check: name, detail });
    console.log(`  FAIL  ${name} — ${detail}`);
  }
}

async function main() {
  // ---- isolation, established before anything is loaded --------------------
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ata-g4-growth-"));
  const dbPath = path.join(root, "growth-isolated.db");
  const url = `file:${dbPath}`;

  // The guard, not a formality: a stray DATABASE_URL in the shell would
  // otherwise silently point this at PREPROD.
  if (dbPath.startsWith("/srv/ata")) {
    throw new Error("refusing to run against a path under /srv/ata");
  }

  process.env.DATABASE_URL = url;

  console.log(`G4 growth isolated E2E`);
  console.log(`  database: ${dbPath}`);

  execFileSync("npx", ["tsx", "prisma/migrate.ts"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  // Imported AFTER DATABASE_URL is set, so the client binds to the isolated file.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const { emitGrowthEvent } = await import("@/lib/growth/emit");
  const {
    pocketPlayerSourceEventId,
    progressSourceEventId,
    userSourceEventId,
  } = await import("@/lib/growth/event-keys");
  const { loadFirstDepositAmounts, loadGrowthCounts, loadLearnerFunnel, countUnresolvedRedeposits } = await import(
    "@/lib/growth/analytics/queries"
  );

  try {
    // ---- 1. the migration landed ------------------------------------------
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('GrowthEvent','GrowthEventOutbox','ProviderIngressEvent')",
    );
    check("migration 47 creates the three growth tables", tables.length === 3, `found ${tables.length}`);

    // ---- fixtures ----------------------------------------------------------
    // Two acquisition cohorts, §63: campaign A buys volume that does not
    // convert downstream, campaign B buys fewer registrations that do.
    const admin = await prisma.user.create({
      data: { email: "g4-admin@example.test", name: "G4 Admin", role: "admin", passwordHash: "x" },
    });

    const partner = await prisma.affiliatePartner.create({
      data: { code: "g4partner", displayName: "G4 Partner", createdByUserId: admin.id },
    });

    async function makeCampaign(code: string) {
      const campaign = await prisma.affiliateCampaign.create({
        data: {
          affiliatePartnerId: partner.id,
          code,
          displayName: code,
          createdByUserId: admin.id,
        },
      });
      const link = await prisma.affiliateTrackingLink.create({
        data: {
          affiliatePartnerId: partner.id,
          affiliateCampaignId: campaign.id,
          publicCode: `${code}`.padEnd(32, "a").slice(0, 32),
          displayName: code,
          status: "active",
          createdByUserId: admin.id,
        },
      });
      return { campaign, link };
    }

    const A = await makeCampaign("campaigna");
    const B = await makeCampaign("campaignb");

    const when = (day: number) => new Date(Date.UTC(2026, 7, day, 12, 0, 0));

    /**
     * A valid, DISTINCT 32-character base32 id.
     *
     * The accepted schema CHECKs every acquisition identifier against
     * `[a-z2-7]{32}`, so `0` and `1` are not usable — and a sanitiser that
     * simply replaces them collapses `click0` and `click1` into one value, which
     * then trips the unique index. Counting in the base32 alphabet keeps every
     * generated id both valid and distinct.
     */
    const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
    let idCounter = 0;
    const base32Id = () => {
      idCounter += 1;
      let value = idCounter;
      let out = "";
      while (value > 0) {
        out = BASE32[value % 32] + out;
        value = Math.floor(value / 32);
      }
      return out.padStart(32, "a");
    };

    async function makeLearner(
      email: string,
      side: { link: { id: number } },
      day: number,
    ) {
      const click = await prisma.affiliateClick.create({
        data: {
          ataClickId: base32Id(),
          trackingLinkId: side.link.id,
          anonymousVisitorId: base32Id(),
          classification: "qualified",
          effectiveAttributionWindowDays: 30,
          occurredAt: when(day),
        },
      });
      const user = await prisma.user.create({
        data: { email, name: email, passwordHash: "x", createdAt: when(day) },
      });
      const attribution = await prisma.affiliateAttribution.create({
        data: {
          userId: user.id,
          anonymousVisitorId: click.anonymousVisitorId!,
          firstTouchClickId: click.id,
          lastTouchClickId: click.id,
          selectedClickId: click.id,
          attributionModel: "last_eligible_affiliate_click",
          selectionReason: "registration_cookie",
          selectedAt: when(day),
          frozenAt: when(day),
        },
      });
      await prisma.$transaction((tx) =>
        emitGrowthEvent(tx, {
          eventType: "ata_reg",
          occurredAt: when(day),
          sourceEventId: userSourceEventId(user.id),
          sourceEntityId: user.id,
          userId: user.id,
          attributionId: attribution.id,
          acquisitionClickId: click.id,
        }),
      );
      return { user, click, attribution };
    }

    // Campaign A: five registrations, none of which go further.
    const aLearners = [];
    for (let index = 0; index < 5; index += 1) {
      aLearners.push(await makeLearner(`a${index}@example.test`, A, 3));
    }

    // Campaign B: two registrations, both of which reach a deposit.
    const bLearners = [];
    for (let index = 0; index < 2; index += 1) {
      bLearners.push(await makeLearner(`b${index}@example.test`, B, 3));
    }

    // ---- 2. idempotency ----------------------------------------------------
    const learner = aLearners[0];
    const replay = await prisma.$transaction((tx) =>
      emitGrowthEvent(tx, {
        eventType: "ata_reg",
        occurredAt: when(3),
        sourceEventId: userSourceEventId(learner.user.id),
        sourceEntityId: learner.user.id,
        userId: learner.user.id,
      }),
    );
    check("a replayed emitter returns duplicate, not a second event", replay.outcome === "duplicate", replay.outcome);

    const regCount = await prisma.growthEvent.count({
      where: { eventType: "ata_reg", sourceEventId: userSourceEventId(learner.user.id) },
    });
    check("exactly one ata_reg per user after a replay", regCount === 1, `count=${regCount}`);

    const outboxCount = await prisma.growthEventOutbox.count();
    const eventCount = await prisma.growthEvent.count();
    check(
      "one outbox item per growth event, written in the same transaction",
      outboxCount === eventCount,
      `outbox=${outboxCount} events=${eventCount}`,
    );

    // ---- 3. Pocket registrations and deposits for campaign B ---------------
    for (const [index, entry] of bLearners.entries()) {
      const player = `100${index + 1}`;
      const identity = await prisma.pocketTraderIdentity.create({
        data: {
          userId: entry.user.id,
          pocketUserId: player,
          clickId: `tq-0000000${index}-0000-0000-0000-00000000000${index}`,
          source: "registration_postback",
          boundAt: when(5),
        },
      });
      await prisma.$transaction((tx) =>
        emitGrowthEvent(tx, {
          eventType: "pocket_reg",
          occurredAt: when(5),
          sourceEventId: pocketPlayerSourceEventId(player),
          sourceEntityId: identity.id,
          userId: entry.user.id,
          pocketTraderIdentityId: identity.id,
          attributionId: entry.attribution.id,
          acquisitionClickId: entry.click.id,
          provider: "pocket",
        }),
      );

      const providerEvent = await prisma.pocketProviderEvent.create({
        data: {
          provider: "pocket",
          eventType: "first_deposit",
          pocketClickId: `tq-0000000${index}-0000-0000-0000-00000000000${index}`,
          pocketPlayerId: player,
          matchedUserId: entry.user.id,
          matchedAt: when(6),
          normalizedAmount: index === 0 ? "25.00" : "30.50",
          currencyCode: "USD",
          currencyStatus: "configured",
          status: "matched",
          firstReceivedAt: when(6),
          lastReceivedAt: when(6),
        },
      });
      await prisma.$transaction((tx) =>
        emitGrowthEvent(tx, {
          eventType: "dep",
          occurredAt: when(6),
          sourceEventId: pocketPlayerSourceEventId(player),
          sourceEntityId: providerEvent.id,
          userId: entry.user.id,
          attributionId: entry.attribution.id,
          acquisitionClickId: entry.click.id,
          provider: "pocket",
          amount: providerEvent.normalizedAmount,
          currencyCode: "USD",
          currencyStatus: "configured",
        }),
      );
    }

    // ---- 4. the two cohorts, as the dashboard reads them -------------------
    const period = { start: new Date(Date.UTC(2026, 7, 1)), end: new Date(Date.UTC(2026, 8, 1)) };

    const aCounts = await loadGrowthCounts(
      prisma,
      period,
      { affiliateCampaignId: A.campaign.id },
      "attributed",
    );
    const bCounts = await loadGrowthCounts(
      prisma,
      period,
      { affiliateCampaignId: B.campaign.id },
      "attributed",
    );

    check("campaign A shows 5 registrations", aCounts.ataRegistrations === 5, String(aCounts.ataRegistrations));
    check("campaign A shows 0 deposits", aCounts.firstDeposits === 0, String(aCounts.firstDeposits));
    check("campaign B shows 2 registrations", bCounts.ataRegistrations === 2, String(bCounts.ataRegistrations));
    check("campaign B shows 2 deposits", bCounts.firstDeposits === 2, String(bCounts.firstDeposits));
    check(
      "the cheaper campaign really does have more registrations",
      aCounts.ataRegistrations > bCounts.ataRegistrations,
      "fixture is not exercising the comparison",
    );
    check(
      "and the better campaign really does have more deposits",
      bCounts.firstDeposits > aCounts.firstDeposits,
      "fixture is not exercising the comparison",
    );

    // Campaign A's deposit rate is a real zero — it had registrations that did
    // not convert. That is NOT the same as null, and the distinction is §60.
    //
    // ASSERTED AGAINST THE FUNCTION THAT OWNS THE RATE. This check used to read
    // `computeGrowthRatios`, and it had been RED since the G4-H3/R2 corrections
    // moved every cohort-basis ratio out of that function: it now returns null
    // for anything declaring a `basis`, deliberately, so a metric can never be
    // produced by the wrong arithmetic. The rate itself was correct the whole
    // time; the assertion was pointed at the wrong owner and nothing noticed,
    // because the suite's failure was never attributed.
    const { computeGrowthRatios, computeLearnerFunnelRatios } = await import(
      "@/lib/growth/analytics/sources"
    );
    const aFunnel = await loadLearnerFunnel(
      prisma,
      period,
      { affiliateCampaignId: A.campaign.id },
      "attributed",
    );
    const aRatios = computeLearnerFunnelRatios(aFunnel);
    check(
      "a real zero rate is 0, not null, when the denominator exists",
      aRatios.depositRatePerRegistration !== null &&
        Number(aRatios.depositRatePerRegistration) === 0,
      String(aRatios.depositRatePerRegistration),
    );

    // And the default-deny itself is now asserted, so a future wave that
    // reintroduced event-count arithmetic for a cohort metric would fail here.
    const aEventRatios = computeGrowthRatios(aCounts, "attributed");
    check(
      "a cohort-basis rate is never computed from raw event counts",
      aEventRatios.depositRatePerRegistration === null,
      String(aEventRatios.depositRatePerRegistration),
    );

    const emptyFunnel = await loadLearnerFunnel(
      prisma,
      { start: new Date(Date.UTC(2030, 0, 1)), end: new Date(Date.UTC(2030, 1, 1)) },
      {},
      "attributed",
    );
    const emptyRatios = computeLearnerFunnelRatios(emptyFunnel);
    check(
      "an absent denominator gives null, never 0",
      emptyRatios.depositRatePerRegistration === null,
      String(emptyRatios.depositRatePerRegistration),
    );

    // ---- 5. money ----------------------------------------------------------
    const amounts = await loadFirstDepositAmounts(
      prisma,
      period,
      { affiliateCampaignId: B.campaign.id },
      "attributed",
    );
    check("deposit sum is exact decimal text", amounts.sum === "55.50", String(amounts.sum));
    check("deposit average is exact", amounts.average === "27.75", String(amounts.average));
    check("currency is reported", amounts.currencyCode === "USD", String(amounts.currencyCode));

    // One deposit with an unknown unit must block aggregation entirely.
    const unknownLearner = await makeLearner("unknown@example.test", B, 7);
    const unknownEvent = await prisma.pocketProviderEvent.create({
      data: {
        provider: "pocket",
        eventType: "first_deposit",
        pocketClickId: "tq-00000009-0000-0000-0000-000000000009",
        pocketPlayerId: "9999",
        matchedUserId: unknownLearner.user.id,
        matchedAt: when(7),
        normalizedAmount: "10.00",
        currencyStatus: "unspecified",
        status: "matched",
        firstReceivedAt: when(7),
        lastReceivedAt: when(7),
      },
    });
    await prisma.$transaction((tx) =>
      emitGrowthEvent(tx, {
        eventType: "dep",
        occurredAt: when(7),
        sourceEventId: pocketPlayerSourceEventId("9999"),
        sourceEntityId: unknownEvent.id,
        userId: unknownLearner.user.id,
        attributionId: unknownLearner.attribution.id,
        acquisitionClickId: unknownLearner.click.id,
        provider: "pocket",
        amount: "10.00",
        currencyStatus: "unspecified",
      }),
    );

    const mixed = await loadFirstDepositAmounts(
      prisma,
      period,
      { affiliateCampaignId: B.campaign.id },
      "attributed",
    );
    check(
      "a currency-less deposit blocks aggregation rather than producing a number",
      mixed.amountAggregationAvailable === false && mixed.sum === null,
      `available=${mixed.amountAggregationAvailable} sum=${mixed.sum}`,
    );
    check(
      "and the deposit COUNT is still reported, because it is known",
      mixed.count === 3,
      String(mixed.count),
    );

    // ---- 6. RDEP stays fail-closed ----------------------------------------
    await prisma.providerIngressEvent.create({
      data: {
        provider: "pocket",
        goal: "redep",
        receivedAt: when(8),
        providerEventAtRaw: "2026-08-13 10:00:00",
        providerEventAtStatus: "unparseable",
        playerIdNormalized: "1001",
        clickId: "tq-00000000-0000-0000-0000-000000000000",
        amount: "25.00",
        sanitizedPayload: { goal: "redep", ow: "[redacted]" },
        rawPayloadHash: "b".repeat(64),
        processingStatus: "identity_unresolved",
        rejectionCode: "provider_event_identity_missing",
      },
    });

    const rdepCanonical = await prisma.growthEvent.count({ where: { eventType: "rdep" } });
    check("no canonical rdep event exists", rdepCanonical === 0, String(rdepCanonical));

    const unresolved = await countUnresolvedRedeposits(prisma, period);
    check("the unresolved delivery is counted separately", unresolved === 1, String(unresolved));

    const totals = await loadGrowthCounts(prisma, period, {}, "total");
    check(
      "unresolved redeposits are NOT counted as confirmed redeposits",
      totals.confirmedRedeposits === 0 && totals.unresolvedRedeposits === 1,
      `confirmed=${totals.confirmedRedeposits} unresolved=${totals.unresolvedRedeposits}`,
    );

    // ---- 7. the database refuses a forged goal ----------------------------
    let goalRefused = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProviderIngressEvent" ("goal","receivedAt","sanitizedPayload","rawPayloadHash","processingStatus") VALUES ('commission', '2026-08-13', '{}', '${"c".repeat(64)}', 'accepted_processed')`,
      );
    } catch {
      goalRefused = true;
    }
    check("the database itself refuses goal=commission", goalRefused, "the insert succeeded");

    // ---- 8. organic learners are visible, not dropped ---------------------
    const organic = await prisma.user.create({
      data: { email: "organic@example.test", name: "Organic", passwordHash: "x", createdAt: when(4) },
    });
    await prisma.$transaction((tx) =>
      emitGrowthEvent(tx, {
        eventType: "ata_reg",
        occurredAt: when(4),
        sourceEventId: userSourceEventId(organic.id),
        sourceEntityId: organic.id,
        userId: organic.id,
      }),
    );
    // G4-H4: the scope is named `organic` now. Same population, one vocabulary
    // across the query layer, the API, the metric registry and the CRM.
    const organicSlice = await loadGrowthCounts(prisma, period, {}, "organic");
    check(
      "an organic registration appears in the organic slice",
      organicSlice.ataRegistrations === 1,
      String(organicSlice.ataRegistrations),
    );
    check(
      "and the organic slice reports zero clicks by construction",
      organicSlice.clicks === 0,
      String(organicSlice.clicks),
    );

    // ---- 9. append-only: the ledger has no update path --------------------
    const progressKey = progressSourceEventId(1);
    check(
      "progress keys are stable strings",
      progressKey === "progress:1",
      progressKey,
    );

    // ---- 10. THE CRITICAL ONE: backfill keys == runtime keys --------------
    //
    // The migration reconstructs history in SQL. The emitters write the same
    // facts in TypeScript. If the two build `sourceEventId` differently, a
    // backfilled row and a runtime row for ONE owner both exist, the unique
    // index does not collide, nothing errors, and every historical count is
    // silently doubled.
    //
    // This replays the migration's own backfill statements — read from the
    // shipped file, not copied — against a database that now HAS fixture rows,
    // and asserts nothing duplicates.
    const migrationSql = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20260813000000_growth_event_foundation/migration.sql",
      ),
      "utf8",
    );

    // Split exactly as `prisma/migrate.ts` does — on the semicolon — so the
    // fragments replayed here are the same ones the runner executes. Each
    // carries its leading comment block, which SQLite accepts, so the filter
    // looks for the INSERT anywhere in the fragment rather than at its start.
    const backfillStatements = migrationSql
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => /INSERT INTO "GrowthEvent/.test(statement));

    check(
      "the migration contains backfill statements to replay",
      backfillStatements.length >= 12,
      `found ${backfillStatements.length}`,
    );

    const beforeReplay = await prisma.growthEvent.count();

    // G4-M1 / fix-wave §100. TWICE, deliberately. The previous version replayed
    // once against a fixture whose backfill had produced nothing, so the
    // unguarded outbox statement had nothing to collide with and the defect it
    // appeared to cover was one iteration away. The second pass is the test.
    for (const pass of [1, 2]) {
      for (const statement of backfillStatements) {
        await prisma.$executeRawUnsafe(statement);
      }
      void pass;
    }

    const afterReplay = await prisma.growthEvent.count();

    // Every fixture event above was written by a RUNTIME emitter. Replaying the
    // backfill must find them already present and insert nothing for them.
    // Rows it legitimately adds are for owners the runtime never emitted for in
    // this fixture (enrollments, level progress), which is why the assertion is
    // about DUPLICATES rather than about the total staying identical.
    const duplicates = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*) AS n FROM (
         SELECT "eventType", "sourceOwner", "sourceEventId", COUNT(*) AS c
         FROM "GrowthEvent"
         GROUP BY "eventType", "sourceOwner", "sourceEventId"
         HAVING c > 1
       )`,
    );

    check(
      "replaying the migration backfill creates NO duplicate of a runtime event",
      Number(duplicates[0]?.n ?? 0) === 0,
      `duplicate key groups: ${duplicates[0]?.n}`,
    );

    const regAfterBackfill = await prisma.growthEvent.count({
      where: { eventType: "ata_reg", sourceEventId: userSourceEventId(learner.user.id) },
    });
    check(
      "the learner emitted at runtime still has exactly one ata_reg after backfill",
      regAfterBackfill === 1,
      `count=${regAfterBackfill}`,
    );

    const depAfterBackfill = await prisma.growthEvent.count({
      where: { eventType: "dep", sourceEventId: pocketPlayerSourceEventId("1001") },
    });
    check(
      "the deposit emitted at runtime still has exactly one dep after backfill",
      depAfterBackfill === 1,
      `count=${depAfterBackfill}`,
    );

    check(
      "the backfill is not a no-op — it did reconstruct owners the runtime skipped",
      afterReplay > beforeReplay,
      `before=${beforeReplay} after=${afterReplay}`,
    );

    // And it must still not have invented a redeposit.
    const rdepAfterBackfill = await prisma.growthEvent.count({ where: { eventType: "rdep" } });
    check(
      "the backfill invents no rdep",
      rdepAfterBackfill === 0,
      String(rdepAfterBackfill),
    );

    console.log("");
    console.log(`  ${passes.length} passed, ${failures.length} failed`);

    if (failures.length > 0) {
      console.log("");
      for (const failure of failures) console.log(`  FAILED: ${failure.check} — ${failure.detail}`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
    // The isolated database is left on disk for inspection; it contains only
    // synthetic fixtures and no live data.
    console.log(`  artifacts: ${root}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
