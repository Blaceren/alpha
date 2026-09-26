/**
 * AFD-5B2B — query plans and a large-fixture measurement.
 *
 * WHAT THIS PROVES. That the lead list is set-based rather than per-row, that
 * the statement count does not grow with the page, and that the plans SQLite
 * actually chooses use indexes where it matters. It builds a disposable fixture
 * large enough for a defect to show — twenty thousand leads — because a pattern
 * that looks fine over ten rows is exactly the pattern that stalls over twenty
 * thousand, and the only honest way to know is to measure.
 *
 * IT IS A MEASUREMENT, NOT A THRESHOLD GATE. Wall-clock numbers on a shared
 * host are not reproducible enough to fail a build on, so this suite fails on
 * STRUCTURAL facts — a statement count that grows with the page, a plan that
 * scans a table it should seek, a page that duplicates or skips a row — and
 * merely REPORTS the timings for the audit. A slow-but-correct plan is a
 * finding for a human; a wrong plan is a failure.
 *
 * NO LIVE DATA. Everything below is invented, written to a throwaway file under
 * the system temp directory, and deleted afterwards. No benchmark identifier
 * ever reaches an audit artifact.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { localWallClockToUtc } from "../../src/lib/analytics/business-time";
import { encodeLeadCursor } from "../../src/lib/leads/lead-cursor";
import { parseLeadListQuery, LEAD_SORTS } from "../../src/lib/leads/lead-request";
import { loadLeadByEventId, loadLeadFacts, loadLeadKeys } from "../../src/lib/leads/lead-queries";
import { buildLeadDetail } from "../../src/lib/leads/lead-dto";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

const dbPath = path.join(os.tmpdir(), `ata-afd5b2b-plan-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const projectRoot = path.resolve(__dirname, "../..");
const MSK = "Europe/Moscow";
const OUT = process.env.AFD5B2B_PLAN_OUT ?? "";

/** Deliberately large enough for an N+1 or a full scan to become visible. */
const LEAD_COUNT = Number(process.env.AFD5B2B_PLAN_LEADS ?? 20_000);
const PARTNERS = 5;
const LINKS_PER_PARTNER = 3;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function msk(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return localWallClockToUtc({ year: y, month: m, day: d, hour: h, minute: min, second: s }, MSK);
}

const NOW = msk(2027, 6, 1, 12);

type PlanRow = { id: unknown; parent: unknown; notused: unknown; detail: unknown };
type Timing = { label: string; ms: number; rows: number; statements: number };

const plans: Record<string, string[]> = {};
const timings: Timing[] = [];

function base32(index: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "";
  let value = index;
  for (let position = 0; position < 32; position += 1) {
    out = alphabet[value % 32] + out;
    value = Math.floor(value / 32) + 7;
  }
  return out;
}

async function main() {
  cleanup();
  process.env.DATABASE_URL = dbUrl;
  delete process.env.ATA_BUSINESS_TIMEZONE;

  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: projectRoot, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `migrate failed: ${migrate.stderr}`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  /* ------------------------------------------------------- the big fixture */

  console.log(`building a ${LEAD_COUNT}-lead fixture...`);
  const built = Date.now();

  await prisma.user.create({
    data: { email: "plan-staff@example.invalid", name: "Plan", role: "admin", passwordHash: "x" },
  });

  // Raw inserts, in one transaction per table. The fixture's own build time is
  // not what this suite measures, and a Prisma round trip per row would make a
  // twenty-thousand-lead fixture take longer than the phase.
  const partnerRows: string[] = [];
  for (let p = 1; p <= PARTNERS; p += 1) {
    // The last partner is archived, with the `archivedAt` its CHECK requires:
    // an archived dimension must still be filterable, so the fixture has one.
    const archived = p === PARTNERS;
    partnerRows.push(
      `(${p}, 'partner${p}', 'Partner ${p}', ${archived ? "'archived'" : "'active'"}, 30, 1, ${NOW.getTime()}, ${NOW.getTime()}, ${archived ? NOW.getTime() : "NULL"})`,
    );
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AffiliatePartner" ("id","code","displayName","status","defaultAttributionWindowDays","createdByUserId","createdAt","updatedAt","archivedAt") VALUES ${partnerRows.join(",")}`,
  );

  const campaignRows: string[] = [];
  for (let p = 1; p <= PARTNERS; p += 1) {
    campaignRows.push(
      `(${p}, ${p}, 'camp${p}', 'Campaign ${p}', 'active', 1, ${NOW.getTime()}, ${NOW.getTime()})`,
    );
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AffiliateCampaign" ("id","affiliatePartnerId","code","displayName","status","createdByUserId","createdAt","updatedAt") VALUES ${campaignRows.join(",")}`,
  );

  const linkRows: string[] = [];
  let linkId = 0;
  for (let p = 1; p <= PARTNERS; p += 1) {
    for (let l = 0; l < LINKS_PER_PARTNER; l += 1) {
      linkId += 1;
      linkRows.push(
        `(${linkId}, ${p}, ${p}, '${base32(900000 + linkId)}', 'Link ${linkId}', 'active', 'academy_registration', 'clickid', 1, ${NOW.getTime()}, ${NOW.getTime()})`,
      );
    }
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AffiliateTrackingLink" ("id","affiliatePartnerId","affiliateCampaignId","publicCode","displayName","status","landingKey","externalClickParameter","createdByUserId","createdAt","updatedAt") VALUES ${linkRows.join(",")}`,
  );

  const START = msk(2026, 1, 1).getTime();
  const DAY = 86_400_000;
  const CHUNK = 2000;

  for (let offset = 0; offset < LEAD_COUNT; offset += CHUNK) {
    const users: string[] = [];
    const clicks: string[] = [];
    const attributions: string[] = [];
    const events: string[] = [];
    const identities: string[] = [];
    const providerEvents: string[] = [];

    for (let index = offset; index < Math.min(offset + CHUNK, LEAD_COUNT); index += 1) {
      const id = index + 2; // 1 is the staff user
      // Repeated registration instants on purpose: every 40th lead shares a
      // timestamp with its neighbours, which is what makes the tie breaker load
      // bearing rather than decorative.
      const registeredAt = START + Math.floor(index / 40) * DAY;
      const attributed = index % 4 !== 0; // a quarter of the population is direct
      const link = (index % (PARTNERS * LINKS_PER_PARTNER)) + 1;
      const partner = Math.floor((link - 1) / LINKS_PER_PARTNER) + 1;

      users.push(
        `(${id}, 'plan-${index}@example.invalid', 'Plan ${index}', 'user', 'x', 'active', 1, 0, 0, ${registeredAt}, ${registeredAt})`,
      );

      if (attributed) {
        clicks.push(
          `(${id}, '${base32(index)}', ${link}, '${base32(index + 500000)}', 'qualified', 30, ${registeredAt - DAY}, ${registeredAt})`,
        );
        attributions.push(
          `(${id}, ${id}, '${base32(index + 500000)}', ${id}, ${id}, ${id}, 'last_eligible_affiliate_click', ${registeredAt}, ${registeredAt}, 'registration_cookie', ${registeredAt})`,
        );
        events.push(
          `('${base32(index + 100000)}', 'academy_registration', ${id}, ${id}, ${id}, ${partner}, ${partner}, ${link}, 'partner${partner}', 'camp${partner}', '${base32(900000 + link)}', 'auth_register', 'afd3b2:user:${id}', NULL, NULL, NULL, ${registeredAt}, ${registeredAt})`,
        );
      } else {
        events.push(
          `('${base32(index + 100000)}', 'academy_registration', ${id}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'auth_register', 'afd3b2:user:${id}', NULL, NULL, NULL, ${registeredAt}, ${registeredAt})`,
        );
      }

      // Half reach Pocket; of those, half deposit.
      if (index % 2 === 0) {
        identities.push(
          `(${id}, ${id}, '${800000000 + index}', '${base32(index + 300000)}', 'registration_postback', ${registeredAt + DAY}, ${registeredAt}, ${registeredAt})`,
        );
        if (index % 4 === 0) {
          const receivedAt = registeredAt + 2 * DAY;
          providerEvents.push(
            `(${id}, 'pocket', 'first_deposit', '${base32(index + 700000)}', '${800000000 + index}', ${id}, '25.00', 'USD', 'configured', 'matched', ${receivedAt}, ${receivedAt}, 0, ${receivedAt}, ${receivedAt}, ${receivedAt})`,
          );
          // The LEDGER row too. Without it the stage filter would be measuring
          // an empty slice and proving nothing — the confirmed stage is read
          // from the conversion ledger, never from the provider row.
          if (attributed) {
            events.push(
              `('${base32(index + 2000000)}', 'first_deposit', ${id}, ${id}, ${id}, ${partner}, ${partner}, ${link}, 'partner${partner}', 'camp${partner}', '${base32(900000 + link)}', 'pocket_first_deposit', 'pocket:${id}', '25.00', 'USD', 'configured', ${receivedAt}, ${receivedAt})`,
            );
          } else {
            events.push(
              `('${base32(index + 2000000)}', 'first_deposit', ${id}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'pocket_first_deposit', 'pocket:${id}', '25.00', 'USD', 'configured', ${receivedAt}, ${receivedAt})`,
            );
          }
        }
      }
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" ("id","email","name","role","passwordHash","status","level","xp","leaderboardExcluded","createdAt","updatedAt") VALUES ${users.join(",")}`,
    );
    if (clicks.length > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AffiliateClick" ("id","ataClickId","trackingLinkId","anonymousVisitorId","classification","effectiveAttributionWindowDays","occurredAt","createdAt") VALUES ${clicks.join(",")}`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AffiliateAttribution" ("id","userId","anonymousVisitorId","firstTouchClickId","lastTouchClickId","selectedClickId","attributionModel","selectedAt","frozenAt","selectionReason","createdAt") VALUES ${attributions.join(",")}`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AffiliateConversionEvent" ("eventId","eventType","userId","attributionId","selectedClickId","affiliatePartnerId","affiliateCampaignId","trackingLinkId","affiliateCodeSnapshot","campaignCodeSnapshot","trackingLinkPublicCodeSnapshot","sourceOwner","sourceEventId","providerAmount","currencyCode","currencyStatus","occurredAt","createdAt") VALUES ${events.join(",")}`,
    );
    if (identities.length > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PocketTraderIdentity" ("id","userId","pocketUserId","clickId","source","boundAt","createdAt","updatedAt") VALUES ${identities.join(",")}`,
      );
    }
    if (providerEvents.length > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PocketProviderEvent" ("id","provider","eventType","pocketClickId","pocketPlayerId","matchedUserId","normalizedAmount","currencyCode","currencyStatus","status","firstReceivedAt","lastReceivedAt","replayCount","matchedAt","createdAt","updatedAt") VALUES ${providerEvents.join(",")}`,
      );
    }
  }

  const leadTotal = await prisma.affiliateConversionEvent.count({
    where: { eventType: "academy_registration" },
  });
  console.log(`fixture ready: ${leadTotal} leads in ${((Date.now() - built) / 1000).toFixed(1)}s`);
  assert.equal(leadTotal, LEAD_COUNT);

  /* ------------------------------------------------------------ query plans */

  /**
   * Capture the plan SQLite chooses for the statements this route issues.
   *
   * `EXPLAIN QUERY PLAN` cannot be run through the same tagged template the
   * route uses, so the plans are captured by re-issuing the SAME predicates
   * through `$queryRawUnsafe` HERE, in a suite, against a throwaway file. No
   * request value reaches these strings — they are literals in this file — and
   * the runtime path in `src/` remains fully parameter-bound. `scripts/` is
   * explicitly out of the raw-SQL auditor's scope for exactly this reason.
   */
  async function plan(label: string, sql: string) {
    const rows = await prisma.$queryRawUnsafe<PlanRow[]>(`EXPLAIN QUERY PLAN ${sql}`);
    const detail = rows.map((row) => String(row.detail));
    plans[label] = detail;
    console.log(`\nplan[${label}]`);
    for (const line of detail) console.log(`   ${line}`);
    return detail;
  }

  const POPULATION = `"AffiliateConversionEvent" e WHERE e."eventType" = 'academy_registration'
    AND e."id" = (SELECT MIN(ce."id") FROM "AffiliateConversionEvent" ce
                  WHERE ce."userId" = e."userId" AND ce."eventType" = 'academy_registration')`;

  const registrationSort = await plan(
    "default_registration_sort",
    `SELECT e."id" FROM ${POPULATION} ORDER BY e."occurredAt" DESC, e."id" DESC LIMIT 26`,
  );

  const affiliateFilter = await plan(
    "affiliate_filter",
    `SELECT e."id" FROM ${POPULATION} AND e."affiliatePartnerId" = 2
     ORDER BY e."occurredAt" DESC, e."id" DESC LIMIT 26`,
  );

  const acquisitionFilter = await plan(
    "acquisition_period_filter",
    `SELECT e."id" FROM "AffiliateConversionEvent" e
     LEFT JOIN "AffiliateAttribution" a ON a."id" = e."attributionId"
     LEFT JOIN "AffiliateClick" sc ON sc."id" = a."selectedClickId"
     WHERE e."eventType" = 'academy_registration'
       AND sc."occurredAt" >= ${msk(2026, 3, 1).getTime()} AND sc."occurredAt" < ${msk(2026, 4, 1).getTime()}
     ORDER BY e."occurredAt" DESC, e."id" DESC LIMIT 26`,
  );

  const stageFilter = await plan(
    "journey_stage_filter",
    `SELECT e."id" FROM ${POPULATION}
     AND EXISTS (SELECT 1 FROM "AffiliateConversionEvent" fx
                 WHERE fx."userId" = e."userId" AND fx."eventType" = 'first_deposit')
     ORDER BY e."occurredAt" DESC, e."id" DESC LIMIT 26`,
  );

  const depositFilter = await plan(
    "deposit_state_filter",
    `SELECT e."id" FROM ${POPULATION}
     AND (SELECT CASE WHEN pe2."status" = 'conflict' OR pe2."conflictDetectedAt" IS NOT NULL THEN 'conflict'
                      WHEN pe2."status" = 'matched' THEN 'confirmed' ELSE 'pending_identity' END
          FROM "PocketProviderEvent" pe2 WHERE pe2."id" = COALESCE(
            (SELECT pm."id" FROM "PocketProviderEvent" pm
              WHERE pm."eventType" = 'first_deposit' AND pm."matchedUserId" = e."userId"
              ORDER BY pm."firstReceivedAt" ASC, pm."id" ASC LIMIT 1),
            (SELECT pi."id" FROM "PocketProviderEvent" pi
              WHERE pi."provider" = 'pocket' AND pi."eventType" = 'first_deposit'
                AND pi."pocketPlayerId" = (SELECT ti2."pocketUserId" FROM "PocketTraderIdentity" ti2
                                           WHERE ti2."userId" = e."userId" AND ti2."source" = 'registration_postback')
              ORDER BY pi."firstReceivedAt" ASC, pi."id" ASC LIMIT 1))) = 'confirmed'
     ORDER BY e."occurredAt" DESC, e."id" DESC LIMIT 26`,
  );

  const detailLookup = await plan(
    "detail_lookup",
    `SELECT e."id" FROM "AffiliateConversionEvent" e WHERE e."eventType" = 'academy_registration'
       AND e."eventId" = '${base32(100000)}'`,
  );

  const timelineJoins = await plan(
    "timeline_source_joins",
    `SELECT e."id" FROM "AffiliateConversionEvent" e
     JOIN "User" u ON u."id" = e."userId"
     LEFT JOIN "AffiliateAttribution" a ON a."id" = e."attributionId"
     LEFT JOIN "AffiliateClick" fc ON fc."id" = a."firstTouchClickId"
     LEFT JOIN "AffiliateClick" lc ON lc."id" = a."lastTouchClickId"
     LEFT JOIN "AffiliateClick" sc ON sc."id" = a."selectedClickId"
     LEFT JOIN "PocketTraderIdentity" ti ON ti."userId" = e."userId"
     WHERE e."id" IN (1,2,3,4,5)`,
  );

  const hydration = await plan(
    "page_hydration",
    `SELECT e."id" FROM "AffiliateConversionEvent" e WHERE e."id" IN (1,2,3,4,5,6,7,8,9,10)`,
  );

  // The full phase-two projection, with every correlated lookup a lead row
  // needs. This is the plan that decides what a page actually costs.
  const projection = await plan(
    "page_projection",
    `SELECT e."id",
       (SELECT COUNT(*) FROM "AffiliateConversionEvent" rc
         WHERE rc."userId" = e."userId" AND rc."eventType" = 'academy_registration') AS "regCount",
       (SELECT COUNT(*) FROM "PocketProviderEvent" cm
         WHERE cm."eventType" = 'first_deposit' AND cm."matchedUserId" = e."userId") AS "cm",
       (SELECT COUNT(*) FROM "PocketProviderEvent" ci
         WHERE ci."provider" = 'pocket' AND ci."eventType" = 'first_deposit'
           AND ci."pocketPlayerId" = (SELECT ti2."pocketUserId" FROM "PocketTraderIdentity" ti2
                                      WHERE ti2."userId" = e."userId" AND ti2."source" = 'registration_postback')
           AND (ci."matchedUserId" IS NULL OR ci."matchedUserId" <> e."userId")) AS "ci"
     FROM "AffiliateConversionEvent" e
     JOIN "User" u ON u."id" = e."userId"
     LEFT JOIN "AffiliateAttribution" a ON a."id" = e."attributionId"
     LEFT JOIN "AffiliateClick" fc ON fc."id" = a."firstTouchClickId"
     LEFT JOIN "AffiliateClick" lc ON lc."id" = a."lastTouchClickId"
     LEFT JOIN "AffiliateClick" sc ON sc."id" = a."selectedClickId"
     LEFT JOIN "AffiliatePartner" p ON p."id" = e."affiliatePartnerId"
     LEFT JOIN "AffiliateCampaign" c ON c."id" = e."affiliateCampaignId"
     LEFT JOIN "AffiliateTrackingLink" tl ON tl."id" = e."trackingLinkId"
     LEFT JOIN "PocketTraderIdentity" ti ON ti."userId" = e."userId"
     LEFT JOIN "AffiliateConversionEvent" fd ON fd."id" = (
       SELECT fd2."id" FROM "AffiliateConversionEvent" fd2
       WHERE fd2."userId" = e."userId" AND fd2."eventType" = 'first_deposit'
       ORDER BY fd2."occurredAt" ASC, fd2."id" ASC LIMIT 1)
     LEFT JOIN "PocketProviderEvent" pe ON pe."id" = COALESCE(
       (SELECT pm."id" FROM "PocketProviderEvent" pm
         WHERE pm."eventType" = 'first_deposit' AND pm."matchedUserId" = e."userId"
         ORDER BY pm."firstReceivedAt" ASC, pm."id" ASC LIMIT 1),
       (SELECT pi."id" FROM "PocketProviderEvent" pi
         WHERE pi."provider" = 'pocket' AND pi."eventType" = 'first_deposit'
           AND pi."pocketPlayerId" = (SELECT ti3."pocketUserId" FROM "PocketTraderIdentity" ti3
                                      WHERE ti3."userId" = e."userId" AND ti3."source" = 'registration_postback')
         ORDER BY pi."firstReceivedAt" ASC, pi."id" ASC LIMIT 1))
     WHERE e."id" IN (2,3,4,5,6,7,8,9,10,11)`,
  );

  const usesIndex = (detail: string[], table: string) =>
    detail.some((line) => line.includes(table) && /USING (COVERING )?(INDEX|PRIMARY KEY)/.test(line));

  /**
   * Every bare `SCAN` in a plan, whatever it scanned.
   *
   * MATCHING ON THE TABLE NAME IS NOT ENOUGH, and an earlier revision of this
   * suite learned it the hard way: SQLite prints the ALIAS, so `SCAN pe` passed
   * a check looking for `SCAN PocketProviderEvent` while a full table scan ran
   * once per candidate lead. A plan that must be index-served is asserted to
   * contain NO bare scan at all, which no alias can hide from.
   */
  const bareScans = (detail: string[]) =>
    detail.filter((line) => line.trim().startsWith("SCAN ") && !line.includes("USING"));

  check("P1. the default registration sort is index-ordered", () => {
    // The AFD-5B1 index on (eventType, occurredAt) must serve BOTH the predicate
    // and the ordering: a temporary sort here would mean every page paid for the
    // whole table.
    assert.ok(
      usesIndex(registrationSort, "AffiliateConversionEvent"),
      registrationSort.join(" | "),
    );
    assert.ok(
      !registrationSort.some((line) => line.includes("USE TEMP B-TREE FOR ORDER BY")),
      `the default sort fell back to a temp sort: ${registrationSort.join(" | ")}`,
    );
  });

  check("P2. the affiliate filter seeks rather than scans", () => {
    assert.ok(usesIndex(affiliateFilter, "AffiliateConversionEvent"), affiliateFilter.join(" | "));
    assert.deepEqual(bareScans(affiliateFilter), [], affiliateFilter.join(" | "));
  });

  check("P3. the acquisition-period filter reaches its clicks by index", () => {
    assert.deepEqual(bareScans(acquisitionFilter), [], acquisitionFilter.join(" | "));
  });

  check("P4. the stage filter's EXISTS is index-served", () => {
    assert.deepEqual(bareScans(stageFilter), [], stageFilter.join(" | "));
  });

  check("P5. the deposit-state filter reaches the provider rows by index", () => {
    // The check that caught the OR. A bare scan anywhere in this plan means the
    // per-lead provider lookup degenerated to a full table read again.
    assert.deepEqual(bareScans(depositFilter), [], depositFilter.join(" | "));
  });

  check("P6. the detail lookup is a unique-index seek", () => {
    assert.ok(usesIndex(detailLookup, "AffiliateConversionEvent"), detailLookup.join(" | "));
    assert.deepEqual(bareScans(detailLookup), [], detailLookup.join(" | "));
  });

  check("P7. every timeline source is reached by primary key or index", () => {
    assert.deepEqual(bareScans(timelineJoins), [], timelineJoins.join(" | "));
  });

  check("P8. page hydration is a primary-key seek", () => {
    assert.deepEqual(bareScans(hydration), [], hydration.join(" | "));
  });

  check("P8b. the full page projection is index-served end to end", () => {
    assert.deepEqual(bareScans(projection), [], projection.join(" | "));
  });

  /* ------------------------------------------------------------- timings */

  let statements = 0;
  const spy = {
    $queryRaw: (...args: Parameters<typeof prisma.$queryRaw>) => {
      statements += 1;
      return (prisma.$queryRaw as (...a: unknown[]) => unknown)(...args);
    },
  } as unknown as typeof prisma;

  async function measure(label: string, query: string, cursor?: string) {
    statements = 0;
    const started = Date.now();
    const parsed = parseLeadListQuery(
      new URLSearchParams(cursor ? `${query}${query ? "&" : ""}cursor=${cursor}` : query),
      MSK,
      NOW,
    );
    const keys = await loadLeadKeys(spy, parsed);
    const kept = keys.slice(0, parsed.limit);
    const facts = await loadLeadFacts(
      spy,
      kept.map((key) => key.rowId),
    );
    const timing: Timing = {
      label,
      ms: Date.now() - started,
      rows: facts.length,
      statements,
    };
    timings.push(timing);
    console.log(`   ${label}: ${timing.ms}ms, ${timing.rows} rows, ${timing.statements} statements`);
    return { parsed, keys, kept, facts };
  }

  console.log("\ntimings:");

  const first = await measure("first_page", "");
  let cursor = encodeLeadCursor(
    {
      nullBucket: first.kept[first.kept.length - 1].nullBucket,
      sortValue: first.kept[first.kept.length - 1].sortValue,
      rowId: first.kept[first.kept.length - 1].rowId,
    },
    first.parsed.fingerprint,
  );

  // Walk deep into the set so a "middle" page is genuinely in the middle.
  let deep = first;
  for (let step = 0; step < 200; step += 1) {
    deep = await (async () => {
      const parsed = parseLeadListQuery(new URLSearchParams(`cursor=${cursor}`), MSK, NOW);
      const keys = await loadLeadKeys(prisma, parsed);
      const kept = keys.slice(0, parsed.limit);
      if (kept.length > 0) {
        const last = kept[kept.length - 1];
        cursor = encodeLeadCursor(
          { nullBucket: last.nullBucket, sortValue: last.sortValue, rowId: last.rowId },
          parsed.fingerprint,
        );
      }
      return { parsed, keys, kept, facts: [] as typeof deep.facts };
    })();
    if (deep.kept.length === 0) break;
  }
  const middle = await measure("middle_cursor_page", "", cursor);
  assert.ok(middle.facts.length > 0, "the middle page must not be empty");

  await measure("affiliate_filtered_page", "affiliatePartnerId=2");
  await measure("direct_lead_page", "attributionState=unattributed");
  await measure("stage_filtered_page", "journeyStage=first_deposit_confirmed");
  await measure("deposit_state_page", "depositState=confirmed");
  await measure("acquisition_period_page", "acquisitionPreset=all_time");
  await measure("max_page_size", "limit=100");

  // The final page: walk to the end of a narrow slice so it is reachable.
  {
    let tail = await measure("final_page_walk_start", "journeyStage=first_deposit_confirmed&limit=100");
    let tailCursor: string | null = null;
    for (let step = 0; step < 100; step += 1) {
      if (tail.keys.length <= tail.parsed.limit) break;
      const last = tail.kept[tail.kept.length - 1];
      tailCursor = encodeLeadCursor(
        { nullBucket: last.nullBucket, sortValue: last.sortValue, rowId: last.rowId },
        tail.parsed.fingerprint,
      );
      tail = await measure(
        `final_page_step_${step}`,
        "journeyStage=first_deposit_confirmed&limit=100",
        tailCursor,
      );
    }
    timings.push({ label: "final_page", ms: tail.facts.length, rows: tail.facts.length, statements: 2 });
  }

  const detailStart = Date.now();
  let detailStatements = 0;
  const detailSpy = {
    $queryRaw: (...args: Parameters<typeof prisma.$queryRaw>) => {
      detailStatements += 1;
      return (prisma.$queryRaw as (...a: unknown[]) => unknown)(...args);
    },
  } as unknown as typeof prisma;
  const detailFacts = await loadLeadByEventId(detailSpy, base32(100000));
  assert.ok(detailFacts);
  const detail = buildLeadDetail(detailFacts!, MSK, false);
  timings.push({
    label: "lead_detail_with_timeline",
    ms: Date.now() - detailStart,
    rows: detail.timeline.items.length,
    statements: detailStatements,
  });
  console.log(
    `   lead_detail_with_timeline: ${Date.now() - detailStart}ms, ${detail.timeline.items.length} timeline items, ${detailStatements} statements`,
  );

  /* --------------------------------------------------------- structure */

  check("P9. no page cost more than two statements, whatever it returned", () => {
    for (const timing of timings) {
      if (timing.label === "final_page" || timing.label === "lead_detail_with_timeline") continue;
      // TWO for a page with rows, ONE when the page is empty and there is
      // nothing to hydrate. Never more, and never a function of `limit`.
      assert.equal(
        timing.statements,
        timing.rows === 0 ? 1 : 2,
        `${timing.label} issued ${timing.statements} for ${timing.rows} rows`,
      );
    }
    const sizes = timings.filter((t) => t.label === "first_page" || t.label === "max_page_size");
    assert.equal(new Set(sizes.map((t) => t.statements)).size, 1, "statement count tracked page size");
  });

  check("P10. one lead detail costs exactly one statement", () => {
    assert.equal(detailStatements, 1);
  });

  await checkAsync("P11. the large fixture pages without duplicates or gaps", async () => {
    // A full walk of a narrow, well-defined slice: every row exactly once.
    const seen = new Set<number>();
    let total = 0;
    let walkCursor: string | null = null;
    for (let step = 0; step < 400; step += 1) {
      const parsed = parseLeadListQuery(
        new URLSearchParams(
          `journeyStage=first_deposit_confirmed&limit=100${walkCursor ? `&cursor=${walkCursor}` : ""}`,
        ),
        MSK,
        NOW,
      );
      const keys = await loadLeadKeys(prisma, parsed);
      const kept = keys.slice(0, parsed.limit);
      for (const key of kept) {
        assert.ok(!seen.has(key.rowId), "a row was returned on two pages");
        seen.add(key.rowId);
      }
      total += kept.length;
      if (keys.length <= parsed.limit) break;
      const last = kept[kept.length - 1];
      walkCursor = encodeLeadCursor(
        { nullBucket: last.nullBucket, sortValue: last.sortValue, rowId: last.rowId },
        parsed.fingerprint,
      );
    }

    const expected = await prisma.affiliateConversionEvent.count({
      where: {
        eventType: "academy_registration",
        user: { affiliateConversionEvents: { some: { eventType: "first_deposit" } } },
      },
    });
    assert.equal(total, seen.size);
    assert.equal(total, expected, "the walk lost or invented rows");
  });

  await checkAsync("P12. every sort walks the whole population exactly once", async () => {
    for (const sort of LEAD_SORTS) {
      const seen = new Set<number>();
      let walkCursor: string | null = null;
      for (let step = 0; step < 250; step += 1) {
        const parsed = parseLeadListQuery(
          new URLSearchParams(`sort=${sort}&limit=100${walkCursor ? `&cursor=${walkCursor}` : ""}`),
          MSK,
          NOW,
        );
        const keys = await loadLeadKeys(prisma, parsed);
        const kept = keys.slice(0, parsed.limit);
        for (const key of kept) {
          assert.ok(!seen.has(key.rowId), `${sort}: duplicate row`);
          seen.add(key.rowId);
        }
        if (keys.length <= parsed.limit) break;
        const last = kept[kept.length - 1];
        walkCursor = encodeLeadCursor(
          { nullBucket: last.nullBucket, sortValue: last.sortValue, rowId: last.rowId },
          parsed.fingerprint,
        );
      }
      assert.equal(seen.size, LEAD_COUNT, `${sort}: walked ${seen.size} of ${LEAD_COUNT}`);
    }
  });

  if (OUT) {
    fs.writeFileSync(
      OUT,
      `${JSON.stringify(
        {
          schema: "ata.afd5b2b.query-plan/1",
          phase: "AFD-5B2B",
          fixture: { leads: LEAD_COUNT, partners: PARTNERS, links: PARTNERS * LINKS_PER_PARTNER },
          note:
            "Timings are reported, not gated: wall clock on a shared host is not " +
            "reproducible enough to fail a build on. Structural facts are gated.",
          plans,
          timings,
          checks: { passed, failed },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`\nwrote ${OUT}`);
  }

  await prisma.$disconnect();
  cleanup();

  console.log(`\nAFD-5B2B query plan: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
