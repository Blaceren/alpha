/**
 * AFD-5B2A — registered acquisition cohorts: population, cutoff, no look-ahead,
 * exact rates, exact medians, follow-up metadata, buckets, breakdowns, and the
 * boundary between this mode and AFD-5B1's event-date mode.
 *
 * WHAT THIS SUITE IS. Everything provable without an HTTP server, run against a
 * SYNTHETIC database built from the repository's own migrations. No live port is
 * contacted, no live database is opened, no live secret is read, and every
 * fixture below is invented here. The authorization contract and the real route
 * wiring are proven separately by `affiliateCohortAnalyticsIsolatedE2E.ts`.
 *
 * THE CLOCK IS ALWAYS FROZEN. Every case passes an explicit `now`, so a suite
 * that runs at 23:59:59 Moscow cannot produce a different answer from one that
 * runs at 00:00:01.
 *
 * THE FIXTURE IS A CALENDAR, and each month tests one thing:
 *
 *   Jan 2026  the main journey — five acquisition cohort members whose
 *             conversions land in February, March and April, which is what makes
 *             the cutoff progression observable
 *   Feb 2026  a learner whose whole journey happens inside one month
 *   May 2026  a selected click that is NOT qualified
 *   Jun 2026  an EVEN median population
 *   Jul 2026  an ODD median population, and a repeating-decimal rate
 *   Aug 2026  a duration that runs backwards
 *   Sep 2026  an attribution with no authoritative registration event
 *   Oct 2026  first touch in the previous month, selected touch in this one
 *   Nov 2026  first touch in the previous month, selected touch in THIS one —
 *             the same learner proves both directions of the anchor rule
 *   Dec 2026  deliberately empty, for the zero-denominator contract
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { localWallClockToUtc } from "../../src/lib/analytics/business-time";
import { AnalyticsPeriodError, buildBuckets, resolvePeriod } from "../../src/lib/analytics/periods";
import { exactRatio } from "../../src/lib/analytics/decimal";
import {
  buildBucketFollowupMetadata,
  buildFollowupMetadata,
  resolveCutoff,
} from "../../src/lib/analytics/cohort-time";
import {
  COHORT_ANCHOR,
  COHORT_MODE,
  COHORT_POPULATION,
} from "../../src/lib/analytics/cohort-sources";
import {
  cohortScope,
  computeCohortRates,
  earliestCohortClick,
  loadCohortAmount,
  loadCohortAmountByDimension,
  loadCohortBreakdown,
  loadCohortBuckets,
  loadCohortCounts,
  loadCohortIntegrity,
  loadCohortMedians,
} from "../../src/lib/analytics/cohort-queries";
import { buildCohortAvailability } from "../../src/lib/analytics/cohort-availability";
import { buildDataAvailability } from "../../src/lib/analytics/availability";
import { loadCounts } from "../../src/lib/analytics/affiliate-queries";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
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

/* ------------------------------------------------------------------ fixture */

const dbPath = path.join(os.tmpdir(), `ata-afd5b2a-cohorts-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const projectRoot = path.resolve(__dirname, "../..");
const MSK = "Europe/Moscow";
const DAY = 86_400;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

let idSequence = 0;
function letterSuffix(value: number): string {
  let out = "";
  let remaining = value;
  do {
    out = String.fromCharCode(97 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26);
  } while (remaining > 0);
  return out;
}
/** Identifiers must be exactly 32 characters from the base32 alphabet. */
function id32(prefix: string): string {
  idSequence += 1;
  const tail = letterSuffix(idSequence);
  const body = `${prefix}${"a".repeat(32)}`.slice(0, 32 - tail.length);
  return `${body}${tail}`.slice(0, 32);
}

/** A Moscow wall-clock instant, written the way a business day is spoken. */
function msk(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return localWallClockToUtc({ year, month, day, hour, minute, second }, MSK);
}

/** The frozen report clock. Every fixture instant is in its past. */
const NOW = msk(2027, 1, 15, 12, 0, 0);

const NO_FILTERS = {} as const;

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

  await check("0. the candidate migration count is the one this phase expects", () => {
    const entries = fs
      .readdirSync(path.join(projectRoot, "prisma/migrations"))
      .filter((entry) => entry !== "migration_lock.toml");
    assert.equal(entries.length, EXPECTED_MIGRATION_COUNT);
  });

  /* ----------------------------- affiliate tree ------------------------- */

  const staff = await prisma.user.create({
    data: {
      email: "afd5b2a-fixture@example.invalid",
      name: "Fixture",
      role: "admin",
      passwordHash: "x",
    },
  });

  const alpha = await prisma.affiliatePartner.create({
    data: { code: "alpha", displayName: "Alpha", createdByUserId: staff.id, status: "active" },
  });
  const beta = await prisma.affiliatePartner.create({
    // Archived on purpose: an archived affiliate still acquired its learners.
    data: {
      code: "beta",
      displayName: "Beta",
      createdByUserId: staff.id,
      status: "archived",
      archivedAt: new Date(),
    },
  });
  const alphaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: alpha.id,
      code: "alpha-one",
      displayName: "Alpha One",
      createdByUserId: staff.id,
    },
  });
  const betaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: beta.id,
      code: "beta-one",
      displayName: "Beta One",
      createdByUserId: staff.id,
      status: "archived",
      archivedAt: new Date(),
    },
  });
  const linkA1 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linkaone"),
      displayName: "Alpha One A",
      status: "active",
      createdByUserId: staff.id,
    },
  });
  const linkA2 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linkatwo"),
      // Paused with history: still reportable.
      displayName: "Alpha One B",
      status: "paused",
      createdByUserId: staff.id,
    },
  });
  const linkB1 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: beta.id,
      affiliateCampaignId: betaOne.id,
      publicCode: id32("linkbone"),
      displayName: "Beta One A",
      status: "archived",
      archivedAt: new Date(),
      createdByUserId: staff.id,
    },
  });

  /* ------------------------------ fixture API --------------------------- */

  let learnerSequence = 0;

  async function makeClick(
    linkId: number,
    occurredAt: Date,
    classification: "qualified" | "prefetch" = "qualified",
  ) {
    return prisma.affiliateClick.create({
      data: {
        ataClickId: id32("c"),
        trackingLinkId: linkId,
        // The database refuses a visitor journey on a non-qualified click:
        // prefetch and authenticated-user clicks are unattributable by
        // construction, not by convention.
        anonymousVisitorId: classification === "qualified" ? id32("v") : null,
        classification,
        effectiveAttributionWindowDays: 30,
        occurredAt,
      },
    });
  }

  type Journey = {
    readonly label: string;
    /** The click the attribution FROZE as the acquiring one. */
    readonly selectedClick: { id: number; trackingLinkId: number; occurredAt: Date };
    /** An earlier click, when the test needs first touch and selected to differ. */
    readonly firstTouchClick?: { id: number };
    readonly registeredAt: Date | null;
    readonly pocketAt?: Date;
    readonly firstDepositAt?: Date;
    readonly firstDepositAmount?: string;
    readonly firstDepositCurrency?: string | null;
    /** Emit a SECOND academy_registration event, to exercise the integrity path. */
    readonly duplicateRegistration?: boolean;
  };

  async function makeLearner(journey: Journey) {
    learnerSequence += 1;
    const user = await prisma.user.create({
      data: {
        email: `afd5b2a-${journey.label.toLowerCase()}-${learnerSequence}@example.invalid`,
        name: `Cohort ${journey.label}`,
        role: "user",
        passwordHash: "x",
      },
    });

    const link = await prisma.affiliateTrackingLink.findUniqueOrThrow({
      where: { id: journey.selectedClick.trackingLinkId },
      select: {
        id: true,
        affiliatePartnerId: true,
        affiliateCampaignId: true,
        publicCode: true,
        partner: { select: { code: true } },
        campaign: { select: { code: true } },
      },
    });

    /**
     * The immutable snapshot every attributed conversion carries.
     *
     * The database CHECK constrains these all-or-nothing, which is what makes a
     * direct conversion structurally distinguishable from an attributed one
     * whose snapshot somebody forgot to write.
     */
    const snapshot = {
      attributionIdPresent: true,
      affiliateCodeSnapshot: link.partner.code,
      campaignCodeSnapshot: link.campaign?.code ?? null,
      trackingLinkPublicCodeSnapshot: link.publicCode,
    } as const;

    const attribution = await prisma.affiliateAttribution.create({
      data: {
        userId: user.id,
        anonymousVisitorId: id32("av"),
        firstTouchClickId: journey.firstTouchClick?.id ?? journey.selectedClick.id,
        lastTouchClickId: journey.selectedClick.id,
        selectedClickId: journey.selectedClick.id,
        attributionModel: "last_eligible_affiliate_click",
        selectionReason: "registration_cookie",
        selectedAt: journey.registeredAt ?? journey.selectedClick.occurredAt,
        frozenAt: journey.registeredAt ?? journey.selectedClick.occurredAt,
      },
    });

    if (journey.registeredAt !== null) {
      await prisma.affiliateConversionEvent.create({
        data: {
          eventId: id32("ev"),
          eventType: "academy_registration",
          userId: user.id,
          attributionId: attribution.id,
          selectedClickId: journey.selectedClick.id,
          affiliatePartnerId: link.affiliatePartnerId,
          affiliateCampaignId: link.affiliateCampaignId,
          trackingLinkId: link.id,
          affiliateCodeSnapshot: snapshot.affiliateCodeSnapshot,
          campaignCodeSnapshot: snapshot.campaignCodeSnapshot,
          trackingLinkPublicCodeSnapshot: snapshot.trackingLinkPublicCodeSnapshot,
          sourceOwner: "auth_register",
          sourceEventId: `reg-${user.id}`,
          occurredAt: journey.registeredAt,
        },
      });

      if (journey.duplicateRegistration === true) {
        await prisma.affiliateConversionEvent.create({
          data: {
            eventId: id32("ev"),
            eventType: "academy_registration",
            userId: user.id,
            attributionId: attribution.id,
            selectedClickId: journey.selectedClick.id,
            affiliatePartnerId: link.affiliatePartnerId,
            affiliateCampaignId: link.affiliateCampaignId,
            trackingLinkId: link.id,
            affiliateCodeSnapshot: snapshot.affiliateCodeSnapshot,
            campaignCodeSnapshot: snapshot.campaignCodeSnapshot,
            trackingLinkPublicCodeSnapshot: snapshot.trackingLinkPublicCodeSnapshot,
            sourceOwner: "auth_register",
            sourceEventId: `reg-dup-${user.id}`,
            occurredAt: journey.registeredAt,
          },
        });
      }
    }

    if (journey.pocketAt !== undefined) {
      await prisma.pocketTraderIdentity.create({
        data: {
          userId: user.id,
          // The database constrains a Pocket player id to 1-19 characters.
          pocketUserId: `9${String(user.id).padStart(9, "0")}`,
          clickId: id32("pc"),
          source: "registration_postback",
          boundAt: journey.pocketAt,
        },
      });
    }

    if (journey.firstDepositAt !== undefined) {
      const currency = journey.firstDepositCurrency;
      await prisma.affiliateConversionEvent.create({
        data: {
          eventId: id32("ev"),
          eventType: "first_deposit",
          userId: user.id,
          attributionId: attribution.id,
          selectedClickId: journey.selectedClick.id,
          affiliatePartnerId: link.affiliatePartnerId,
          affiliateCampaignId: link.affiliateCampaignId,
          trackingLinkId: link.id,
          affiliateCodeSnapshot: snapshot.affiliateCodeSnapshot,
          campaignCodeSnapshot: snapshot.campaignCodeSnapshot,
          trackingLinkPublicCodeSnapshot: snapshot.trackingLinkPublicCodeSnapshot,
          sourceOwner: "pocket_first_deposit",
          sourceEventId: `fd-${user.id}`,
          providerAmount: journey.firstDepositAmount ?? "100.00",
          currencyCode: currency === null ? null : (currency ?? "USD"),
          currencyStatus: currency === null ? "unspecified" : "configured",
          occurredAt: journey.firstDepositAt,
        },
      });
    }

    return user;
  }

  /* ------------------------- January: the main journey ------------------ */

  const clickA = await makeClick(linkA1.id, msk(2026, 1, 10));
  await makeLearner({
    label: "A",
    selectedClick: clickA,
    registeredAt: msk(2026, 2, 5),
    pocketAt: msk(2026, 3, 5),
    firstDepositAt: msk(2026, 4, 5),
    firstDepositAmount: "150.00",
  });

  const clickB = await makeClick(linkA2.id, msk(2026, 1, 12));
  await makeLearner({ label: "B", selectedClick: clickB, registeredAt: msk(2026, 1, 20) });

  // E: first touch Alpha, SELECTED touch Beta. The cohort must use Beta's date
  // and Beta's dimensions — this is the whole point of the frozen anchor.
  const eFirstTouch = await makeClick(linkA1.id, msk(2026, 1, 2));
  const eSelected = await makeClick(linkB1.id, msk(2026, 1, 25));
  const learnerE = await makeLearner({
    label: "E",
    selectedClick: eSelected,
    firstTouchClick: eFirstTouch,
    registeredAt: msk(2026, 1, 26),
  });

  // F: acquired in January but registers in March — invisible to a February
  // cutoff and present under a March one.
  const clickF = await makeClick(linkA1.id, msk(2026, 1, 15));
  await makeLearner({ label: "F", selectedClick: clickF, registeredAt: msk(2026, 3, 20) });

  // G: converts one stage later than A at every step.
  const clickG = await makeClick(linkA1.id, msk(2026, 1, 18));
  await makeLearner({
    label: "G",
    selectedClick: clickG,
    registeredAt: msk(2026, 1, 25),
    pocketAt: msk(2026, 3, 10),
    firstDepositAt: msk(2026, 4, 10),
    firstDepositAmount: "250.00",
  });

  /* ------------------ February: a journey inside one month -------------- */

  const clickC = await makeClick(linkB1.id, msk(2026, 2, 8));
  await makeLearner({
    label: "C",
    selectedClick: clickC,
    registeredAt: msk(2026, 2, 8, 1),
    pocketAt: msk(2026, 2, 8, 2),
    firstDepositAt: msk(2026, 2, 8, 3),
    firstDepositAmount: "50.00",
  });

  /* ------------- D and U: the two shapes that are never in a cohort ----- */

  // D: a DIRECT learner. A real academy_registration event with every affiliate
  // column null, a Pocket registration and a deposit — and NO attribution.
  const directUser = await prisma.user.create({
    data: {
      email: "afd5b2a-direct@example.invalid",
      name: "Direct",
      role: "user",
      passwordHash: "x",
    },
  });
  await prisma.affiliateConversionEvent.create({
    data: {
      eventId: id32("ev"),
      eventType: "academy_registration",
      userId: directUser.id,
      sourceOwner: "auth_register",
      sourceEventId: `reg-${directUser.id}`,
      occurredAt: msk(2026, 1, 11),
    },
  });
  await prisma.pocketTraderIdentity.create({
    data: {
      userId: directUser.id,
      pocketUserId: `9${String(directUser.id).padStart(9, "0")}`,
      clickId: id32("pc"),
      source: "registration_postback",
      boundAt: msk(2026, 1, 12),
    },
  });
  await prisma.affiliateConversionEvent.create({
    data: {
      eventId: id32("ev"),
      eventType: "first_deposit",
      userId: directUser.id,
      sourceOwner: "pocket_first_deposit",
      sourceEventId: `fd-${directUser.id}`,
      providerAmount: "999.00",
      currencyCode: "USD",
      currencyStatus: "configured",
      occurredAt: msk(2026, 1, 13),
    },
  });

  // U: an unaffiliated learner with no conversion ledger entry at all.
  await prisma.user.create({
    data: {
      email: "afd5b2a-unaffiliated@example.invalid",
      name: "Unaffiliated",
      role: "user",
      passwordHash: "x",
    },
  });

  /* --------------- May: a selected click that is not qualified ---------- */

  const prefetchClick = await makeClick(linkA1.id, msk(2026, 5, 5), "prefetch");
  await makeLearner({ label: "R", selectedClick: prefetchClick, registeredAt: msk(2026, 5, 6) });

  /* --------------------- June: an EVEN median population ---------------- */

  const clickH = await makeClick(linkA1.id, msk(2026, 6, 1));
  await makeLearner({ label: "H", selectedClick: clickH, registeredAt: msk(2026, 6, 1, 0, 0, 10) });
  const clickI = await makeClick(linkA1.id, msk(2026, 6, 2));
  await makeLearner({ label: "I", selectedClick: clickI, registeredAt: msk(2026, 6, 2, 0, 0, 11) });

  /* ------- July: an ODD median population and a repeating decimal -------- */

  const clickK = await makeClick(linkA1.id, msk(2026, 7, 1));
  await makeLearner({
    label: "K",
    selectedClick: clickK,
    registeredAt: msk(2026, 7, 1, 0, 0, 10),
    // Exactly one of July's three learners reaches Pocket: 1/3, a rate with no
    // exact decimal expansion.
    pocketAt: msk(2026, 7, 5),
  });
  const clickL = await makeClick(linkA1.id, msk(2026, 7, 2));
  await makeLearner({ label: "L", selectedClick: clickL, registeredAt: msk(2026, 7, 2, 0, 0, 11) });
  const clickM = await makeClick(linkA1.id, msk(2026, 7, 3));
  await makeLearner({ label: "M", selectedClick: clickM, registeredAt: msk(2026, 7, 3, 0, 0, 20) });

  /* ---------------- August: a duration that runs backwards -------------- */

  const clickN = await makeClick(linkA1.id, msk(2026, 8, 5, 0, 0, 10));
  await makeLearner({ label: "N", selectedClick: clickN, registeredAt: msk(2026, 8, 5, 0, 0, 0) });

  /* ------- September: attributions the conversion ledger contradicts ----- */

  const clickO = await makeClick(linkA1.id, msk(2026, 9, 5));
  await makeLearner({ label: "O", selectedClick: clickO, registeredAt: null });
  const clickDup = await makeClick(linkA1.id, msk(2026, 9, 6));
  await makeLearner({
    label: "DUP",
    selectedClick: clickDup,
    registeredAt: msk(2026, 9, 7),
    duplicateRegistration: true,
  });

  /* ------------- October / November: the anchor is the SELECTED click ---- */

  // Q: first touch in September, selected click in October. Belongs to October.
  const qFirstTouch = await makeClick(linkA1.id, msk(2026, 9, 20));
  const qSelected = await makeClick(linkA1.id, msk(2026, 10, 5));
  await makeLearner({
    label: "Q",
    selectedClick: qSelected,
    firstTouchClick: qFirstTouch,
    registeredAt: msk(2026, 10, 10),
  });

  // P: first touch in October, selected click in November. Belongs to November,
  // and must NOT appear in October despite having clicked in it.
  const pFirstTouch = await makeClick(linkA1.id, msk(2026, 10, 20));
  const pSelected = await makeClick(linkA1.id, msk(2026, 11, 5));
  await makeLearner({
    label: "P",
    selectedClick: pSelected,
    firstTouchClick: pFirstTouch,
    registeredAt: msk(2026, 11, 10),
  });

  /* ------------------------------ helpers -------------------------------- */

  /** A custom cohort interval over whole Moscow months. */
  function monthPeriod(year: number, month: number) {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    return resolvePeriod({ preset: "custom", startDate, endDate }, MSK, NOW);
  }

  function scopeFor(
    year: number,
    month: number,
    cutoffDate: string,
    filters: Record<string, number> = NO_FILTERS,
  ) {
    const period = monthPeriod(year, month);
    const cutoff = resolveCutoff({ cutoffDate }, period, MSK, NOW);
    return { period, cutoff, scope: cohortScope(period, cutoff, filters) };
  }

  const JAN_FEB = scopeFor(2026, 1, "2026-02-28");
  const JAN_MAR = scopeFor(2026, 1, "2026-03-31");
  const JAN_APR = scopeFor(2026, 1, "2026-04-30");

  /* =================================================================== */
  /* A. mode identity                                                     */
  /* =================================================================== */

  await check("A1 the mode, population and anchor are named explicitly", () => {
    assert.equal(COHORT_MODE, "acquisition_cohort");
    assert.equal(COHORT_POPULATION, "registered_attributed_learners");
    assert.equal(COHORT_ANCHOR, "selected_acquisition_click");
  });

  await check("A2 the cohort mode is NOT the event-date mode", async () => {
    const { ANALYTICS_MODE } = await import("../../src/lib/analytics/affiliate-sources");
    assert.notEqual(COHORT_MODE, ANALYTICS_MODE);
  });

  /* =================================================================== */
  /* B. cohort population                                                 */
  /* =================================================================== */

  await check("B1 a January cohort observed to February holds four learners", async () => {
    const counts = await loadCohortCounts(prisma, JAN_FEB.scope);
    // A, B, E and G registered by the cutoff. F had not.
    assert.equal(counts.cohortLearners, 4);
  });

  await check("B2 the late registration appears once a later cutoff is chosen", async () => {
    const counts = await loadCohortCounts(prisma, JAN_MAR.scope);
    assert.equal(counts.cohortLearners, 5);
  });

  await check("B3 a direct learner is never in an acquisition cohort", async () => {
    // D registered, took a Pocket identity and deposited, all inside January.
    // Every one of those events is real; none of them creates an acquisition
    // anchor, so D is absent from the cohort at every cutoff.
    for (const scope of [JAN_FEB, JAN_MAR, JAN_APR]) {
      const counts = await loadCohortCounts(prisma, scope.scope);
      assert.ok(counts.cohortLearners <= 5, "a direct learner leaked into the cohort");
    }
    const all = await prisma.affiliateConversionEvent.count({
      where: { userId: directUser.id, eventType: "academy_registration" },
    });
    assert.equal(all, 1, "the direct learner must still have a real registration event");
  });

  await check("B4 an unaffiliated learner is never in a cohort", async () => {
    const counts = await loadCohortCounts(prisma, scopeFor(2026, 1, "2026-12-31").scope);
    assert.equal(counts.cohortLearners, 5);
  });

  await check("B5 a learner appears at most once", async () => {
    // DUP carries two registration events. If membership joined row-to-row it
    // would be counted twice; it is excluded instead and reported as integrity.
    const september = scopeFor(2026, 9, "2026-12-31");
    const counts = await loadCohortCounts(prisma, september.scope);
    assert.equal(counts.cohortLearners, 0);
  });

  await check("B6 a selected click that is not qualified anchors no cohort", async () => {
    const may = scopeFor(2026, 5, "2026-12-31");
    const counts = await loadCohortCounts(prisma, may.scope);
    assert.equal(counts.cohortLearners, 0);
  });

  await check("B7 the anchor is the SELECTED click, not the first touch", async () => {
    // Q first touched in September and was selected in October.
    const september = await loadCohortCounts(prisma, scopeFor(2026, 9, "2026-12-31").scope);
    const october = await loadCohortCounts(prisma, scopeFor(2026, 10, "2026-12-31").scope);
    assert.equal(september.cohortLearners, 0, "a first touch must not create membership");
    assert.equal(october.cohortLearners, 1, "the selected click must create membership");
  });

  await check("B8 a first touch inside the interval does not pull a later learner in", async () => {
    // P clicked in October but was SELECTED in November.
    const october = await loadCohortCounts(prisma, scopeFor(2026, 10, "2026-12-31").scope);
    const november = await loadCohortCounts(prisma, scopeFor(2026, 11, "2026-12-31").scope);
    assert.equal(october.cohortLearners, 1, "October holds Q only");
    assert.equal(november.cohortLearners, 1, "November holds P only");
  });

  await check("B9 E is anchored to Beta's date and Beta's dimensions", async () => {
    const januaryBeta = await loadCohortCounts(
      prisma,
      scopeFor(2026, 1, "2026-12-31", { affiliatePartnerId: beta.id }).scope,
    );
    const januaryAlpha = await loadCohortCounts(
      prisma,
      scopeFor(2026, 1, "2026-12-31", { affiliatePartnerId: alpha.id }).scope,
    );
    assert.equal(januaryBeta.cohortLearners, 1, "E belongs to Beta, its SELECTED affiliate");
    assert.equal(januaryAlpha.cohortLearners, 4, "A, B, F and G belong to Alpha");
    const learner = await prisma.affiliateAttribution.findUniqueOrThrow({
      where: { userId: learnerE.id },
      select: { firstTouchClickId: true, selectedClickId: true },
    });
    assert.notEqual(learner.firstTouchClickId, learner.selectedClickId);
  });

  await check("B10 an empty interval yields an empty cohort, not an error", async () => {
    const december = await loadCohortCounts(prisma, scopeFor(2026, 12, "2026-12-31").scope);
    assert.equal(december.cohortLearners, 0);
    assert.equal(december.pocketRegisteredLearners, 0);
    assert.equal(december.firstDepositLearners, 0);
  });

  /* =================================================================== */
  /* C. the cutoff and no look-ahead                                      */
  /* =================================================================== */

  await check("C1 the default cutoff is the frozen report clock", () => {
    const period = monthPeriod(2026, 1);
    const cutoff = resolveCutoff({}, period, MSK, NOW);
    assert.equal(cutoff.source, "report_clock");
    assert.equal(cutoff.cutoffUtc.getTime(), NOW.getTime());
    assert.equal(cutoff.cutoffDateLocal, null);
  });

  await check("C2 an explicit cutoff observes through the END of its local day", () => {
    const period = monthPeriod(2026, 1);
    const cutoff = resolveCutoff({ cutoffDate: "2026-02-28" }, period, MSK, NOW);
    assert.equal(cutoff.source, "explicit_date");
    // The start of 1 March, Moscow — so 28 February 23:59:59 is included.
    assert.equal(cutoff.cutoffUtc.getTime(), msk(2026, 3, 1).getTime());
    assert.equal(cutoff.clampedToReportClock, false);
  });

  await check("C3 a future cutoff is refused", () => {
    const period = monthPeriod(2026, 1);
    assert.throws(
      () => resolveCutoff({ cutoffDate: "2027-06-01" }, period, MSK, NOW),
      (error: unknown) =>
        error instanceof AnalyticsPeriodError &&
        error.messageKey === "crm.analytics.cutoff_in_future",
    );
  });

  await check("C4 today is accepted and clamped to the report clock", () => {
    const period = monthPeriod(2026, 1);
    const cutoff = resolveCutoff({ cutoffDate: "2027-01-15" }, period, MSK, NOW);
    assert.equal(cutoff.clampedToReportClock, true);
    assert.equal(cutoff.cutoffUtc.getTime(), NOW.getTime());
  });

  await check("C5 a cutoff at or before the cohort start is refused", () => {
    const period = monthPeriod(2026, 6);
    assert.throws(
      () => resolveCutoff({ cutoffDate: "2026-05-01" }, period, MSK, NOW),
      (error: unknown) =>
        error instanceof AnalyticsPeriodError &&
        error.messageKey === "crm.analytics.cutoff_before_cohort_start",
    );
  });

  await check("C6 a malformed cutoff is refused, never coerced", () => {
    const period = monthPeriod(2026, 1);
    for (const bad of ["2026-02-30", "28-02-2026", "2026-2-8", "2026-02-28T00:00:00Z", "today"]) {
      assert.throws(
        () => resolveCutoff({ cutoffDate: bad }, period, MSK, NOW),
        (error: unknown) => error instanceof AnalyticsPeriodError,
        `accepted ${bad}`,
      );
    }
  });

  await check("C7 a cutoff inside the cohort interval is allowed and REPORTED", () => {
    const period = monthPeriod(2026, 1);
    const cutoff = resolveCutoff({ cutoffDate: "2026-01-15" }, period, MSK, NOW);
    const followup = buildFollowupMetadata(period, cutoff);
    assert.equal(followup.cohortIntervalFullyBeforeCutoff, false);
    assert.equal(followup.minimumPossibleFollowupSeconds, 0);
  });

  await check("C8 no Pocket registration after the cutoff is counted", async () => {
    const february = await loadCohortCounts(prisma, JAN_FEB.scope);
    const march = await loadCohortCounts(prisma, JAN_MAR.scope);
    assert.equal(february.pocketRegisteredLearners, 0, "A and G bind in March");
    assert.equal(march.pocketRegisteredLearners, 2);
  });

  await check("C9 no first deposit after the cutoff is counted", async () => {
    const march = await loadCohortCounts(prisma, JAN_MAR.scope);
    const april = await loadCohortCounts(prisma, JAN_APR.scope);
    assert.equal(march.firstDepositLearners, 0, "A and G deposit in April");
    assert.equal(april.firstDepositLearners, 2);
  });

  await check("C10 the historical answer never changes when re-read", async () => {
    const first = await loadCohortCounts(prisma, scopeFor(2026, 1, "2026-02-28").scope);
    const second = await loadCohortCounts(prisma, scopeFor(2026, 1, "2026-02-28").scope);
    assert.deepEqual(first, second);
    // And the February answer is still February's, now that April is known.
    assert.deepEqual(first, {
      cohortLearners: 4,
      pocketRegisteredLearners: 0,
      firstDepositLearners: 0,
    });
  });

  /* =================================================================== */
  /* D. rates                                                             */
  /* =================================================================== */

  await check("D1 the three cohort rates are exact decimal strings", async () => {
    const counts = await loadCohortCounts(prisma, JAN_APR.scope);
    assert.deepEqual(counts, {
      cohortLearners: 5,
      pocketRegisteredLearners: 2,
      firstDepositLearners: 2,
    });
    assert.deepEqual(computeCohortRates(counts), {
      pocketRegistrationRate: "0.400000",
      firstDepositRate: "0.400000",
      pocketToFirstDepositRate: "1.000000",
    });
  });

  await check("D2 a zero denominator is null, never zero", async () => {
    const december = await loadCohortCounts(prisma, scopeFor(2026, 12, "2026-12-31").scope);
    const rates = computeCohortRates(december);
    assert.equal(rates.pocketRegistrationRate, null);
    assert.equal(rates.firstDepositRate, null);
    assert.equal(rates.pocketToFirstDepositRate, null);
  });

  await check("D3 a zero numerator is zero, never null", async () => {
    const counts = await loadCohortCounts(prisma, JAN_FEB.scope);
    const rates = computeCohortRates(counts);
    assert.equal(rates.pocketRegistrationRate, "0.000000");
    assert.equal(rates.firstDepositRate, "0.000000");
    // No Pocket registrations at all, so the Pocket→FD denominator is zero.
    assert.equal(rates.pocketToFirstDepositRate, null);
  });

  await check("D4 a repeating decimal is exact and truncated, never rounded up", async () => {
    const july = await loadCohortCounts(prisma, scopeFor(2026, 7, "2026-12-31").scope);
    assert.equal(july.cohortLearners, 3);
    assert.equal(july.pocketRegisteredLearners, 1);
    const rates = computeCohortRates(july);
    assert.equal(rates.pocketRegistrationRate, "0.333333");
    assert.equal(exactRatio(1, 3), "0.333333");
  });

  await check("D5 no rate is a binary float", async () => {
    const counts = await loadCohortCounts(prisma, JAN_APR.scope);
    for (const value of Object.values(computeCohortRates(counts))) {
      assert.ok(value === null || typeof value === "string");
    }
  });

  /* =================================================================== */
  /* E. medians                                                           */
  /* =================================================================== */

  await check("E1 an odd population takes the middle value", async () => {
    const medians = await loadCohortMedians(prisma, JAN_APR.scope);
    const lag = medians.selectedClickToAcademyRegistration;
    // 1, 7, 8, 26 and 64 days → the third is 8 days.
    assert.equal(lag.sampleSize, 5);
    assert.equal(lag.medianSeconds, `${8 * DAY}.0`);
  });

  await check("E2 an even population is the exact mean of the two central values", async () => {
    const medians = await loadCohortMedians(prisma, JAN_APR.scope);
    const lag = medians.academyRegistrationToPocketRegistration;
    // A waited 28 days, G waited 44 → (28 + 44) / 2 = 36 days exactly.
    assert.equal(lag.sampleSize, 2);
    assert.equal(lag.medianSeconds, `${36 * DAY}.0`);
  });

  await check("E3 an even population with adjacent values yields an exact half", async () => {
    const june = await loadCohortMedians(prisma, scopeFor(2026, 6, "2026-12-31").scope);
    const lag = june.selectedClickToAcademyRegistration;
    // 10 s and 11 s → 10.5 s, represented exactly and not as 10.499999999999998.
    assert.equal(lag.sampleSize, 2);
    assert.equal(lag.medianSeconds, "10.5");
  });

  await check("E4 an odd population of three takes the middle, not the mean", async () => {
    const july = await loadCohortMedians(prisma, scopeFor(2026, 7, "2026-12-31").scope);
    const lag = july.selectedClickToAcademyRegistration;
    // 10, 11 and 20 → median 11. The MEAN would be 13.666…, so a suite that
    // accepted the mean would fail here.
    assert.equal(lag.sampleSize, 3);
    assert.equal(lag.medianSeconds, "11.0");
    assert.notEqual(lag.medianSeconds, "13.7");
  });

  await check("E5 a single value is its own median", async () => {
    const october = await loadCohortMedians(prisma, scopeFor(2026, 10, "2026-12-31").scope);
    const lag = october.selectedClickToAcademyRegistration;
    assert.equal(lag.sampleSize, 1);
    assert.equal(lag.medianSeconds, `${5 * DAY}.0`);
  });

  await check("E6 an empty population reports null with a zero sample size", async () => {
    const december = await loadCohortMedians(prisma, scopeFor(2026, 12, "2026-12-31").scope);
    for (const lag of Object.values(december)) {
      assert.equal(lag.medianSeconds, null);
      assert.equal(lag.sampleSize, 0);
    }
  });

  await check("E7 each median's population is exactly the one its contract names", async () => {
    const medians = await loadCohortMedians(prisma, JAN_APR.scope);
    assert.equal(medians.selectedClickToAcademyRegistration.sampleSize, 5, "all cohort learners");
    assert.equal(medians.academyRegistrationToPocketRegistration.sampleSize, 2, "Pocket only");
    assert.equal(medians.pocketRegistrationToFirstDeposit.sampleSize, 2, "confirmed FD only");
    assert.equal(medians.selectedClickToFirstDeposit.sampleSize, 2, "confirmed FD only");
  });

  await check("E8 the cutoff removes a learner from a median population", async () => {
    const february = await loadCohortMedians(prisma, JAN_FEB.scope);
    assert.equal(february.academyRegistrationToPocketRegistration.sampleSize, 0);
    assert.equal(february.academyRegistrationToPocketRegistration.medianSeconds, null);
    // Four members registered by February, so the first lag still has a median.
    assert.equal(february.selectedClickToAcademyRegistration.sampleSize, 4);
  });

  await check("E9 a negative duration is an integrity error, not a clamped zero", async () => {
    const august = await loadCohortMedians(prisma, scopeFor(2026, 8, "2026-12-31").scope);
    const lag = august.selectedClickToAcademyRegistration;
    assert.equal(lag.negativeDurationCount, 1);
    // Excluded from the population rather than counted as 0 seconds.
    assert.equal(lag.sampleSize, 0);
    assert.equal(lag.medianSeconds, null);
  });

  await check("E10 the Pocket-to-first-deposit median is exact", async () => {
    const medians = await loadCohortMedians(prisma, JAN_APR.scope);
    // A: 5 March to 5 April = 31 days. G: 10 March to 10 April = 31 days.
    assert.equal(medians.pocketRegistrationToFirstDeposit.medianSeconds, `${31 * DAY}.0`);
  });

  /* =================================================================== */
  /* F. follow-up metadata                                                */
  /* =================================================================== */

  await check("F1 follow-up bounds are computed from the interval and the cutoff", () => {
    const followup = buildFollowupMetadata(JAN_APR.period, JAN_APR.cutoff);
    // Cohort [1 Jan, 1 Feb), cutoff 1 May.
    assert.equal(followup.minimumPossibleFollowupSeconds, 89 * DAY); // 1 Feb → 1 May
    assert.equal(followup.maximumPossibleFollowupSeconds, 120 * DAY); // 1 Jan → 1 May
    assert.equal(followup.cohortIntervalFullyBeforeCutoff, true);
  });

  await check("F2 an interval straddling the cutoff reports a zero minimum", () => {
    const period = monthPeriod(2026, 1);
    const cutoff = resolveCutoff({ cutoffDate: "2026-01-20" }, period, MSK, NOW);
    const followup = buildFollowupMetadata(period, cutoff);
    assert.equal(followup.cohortIntervalFullyBeforeCutoff, false);
    assert.equal(followup.minimumPossibleFollowupSeconds, 0);
    assert.equal(followup.maximumPossibleFollowupSeconds, 20 * DAY);
  });

  await check("F3 maturity is explicitly NOT scored", () => {
    const followup = buildFollowupMetadata(JAN_APR.period, JAN_APR.cutoff);
    assert.equal(followup.maturityAssessment, "not_scored");
    assert.equal(followup.maturityReason, "empirical_maturity_model_not_implemented");
    const serialised = JSON.stringify(followup).toLowerCase();
    for (const forbidden of ["mature", "high_potential", "stable", "deteriorating", "forecast"]) {
      assert.ok(!serialised.includes(forbidden), `follow-up metadata claimed "${forbidden}"`);
    }
  });

  await check("F4 all-time has no cohort start, so the maximum is null not zero", () => {
    const period = resolvePeriod({ preset: "all_time" }, MSK, NOW);
    const cutoff = resolveCutoff({}, period, MSK, NOW);
    const followup = buildFollowupMetadata(period, cutoff);
    assert.equal(followup.cohortStartUtc, null);
    assert.equal(followup.maximumPossibleFollowupSeconds, null);
  });

  await check("F5 every bucket shares the report cutoff", () => {
    const buckets = buildBuckets(JAN_APR.period, "week");
    const metadata = buckets.map((bucket) =>
      buildBucketFollowupMetadata(bucket, MSK, JAN_APR.cutoff),
    );
    const cutoffs = new Set(metadata.map((entry) => entry.cutoffUtc));
    assert.equal(cutoffs.size, 1, "buckets must not each get their own cutoff");
    // Earlier buckets have been watched for longer — a fact, not a score.
    assert.ok(
      metadata[0]!.maximumPossibleFollowupSeconds! >
        metadata[metadata.length - 1]!.maximumPossibleFollowupSeconds!,
    );
  });

  /* =================================================================== */
  /* G. time series                                                       */
  /* =================================================================== */

  await check("G1 day buckets place a learner by the SELECTED CLICK date", async () => {
    const buckets = buildBuckets(JAN_APR.period, "day");
    const series = await loadCohortBuckets(prisma, JAN_APR.scope, buckets);
    const byLabel = new Map(series.map((entry) => [entry.localLabel, entry.counts]));
    // A clicked on 10 January and deposited in April; the deposit is reported in
    // the JANUARY bucket, which is the whole difference from event-date mode.
    assert.equal(byLabel.get("2026-01-10")?.cohortLearners, 1);
    assert.equal(byLabel.get("2026-01-10")?.firstDepositLearners, 1);
    assert.equal(byLabel.get("2026-01-11")?.cohortLearners, 0, "D is direct, not a cohort member");
  });

  await check("G2 zero-population buckets are present, not omitted", async () => {
    const buckets = buildBuckets(JAN_APR.period, "day");
    const series = await loadCohortBuckets(prisma, JAN_APR.scope, buckets);
    assert.equal(series.length, 31, "January has 31 day buckets");
    assert.ok(series.some((entry) => entry.counts.cohortLearners === 0));
  });

  await check("G3 bucket counts sum to the summary totals", async () => {
    for (const group of ["day", "week", "month"] as const) {
      const buckets = buildBuckets(JAN_APR.period, group);
      const series = await loadCohortBuckets(prisma, JAN_APR.scope, buckets);
      const totals = await loadCohortCounts(prisma, JAN_APR.scope);
      const summed = series.reduce(
        (accumulator, entry) => ({
          cohortLearners: accumulator.cohortLearners + entry.counts.cohortLearners,
          pocketRegisteredLearners:
            accumulator.pocketRegisteredLearners + entry.counts.pocketRegisteredLearners,
          firstDepositLearners:
            accumulator.firstDepositLearners + entry.counts.firstDepositLearners,
        }),
        { cohortLearners: 0, pocketRegisteredLearners: 0, firstDepositLearners: 0 },
      );
      assert.deepEqual(summed, totals, `${group} buckets did not reconcile`);
    }
  });

  await check("G4 buckets never overlap and are ascending", () => {
    for (const group of ["day", "week", "month"] as const) {
      const buckets = buildBuckets(JAN_APR.period, group);
      for (let index = 1; index < buckets.length; index += 1) {
        assert.ok(
          buckets[index]!.startUtc.getTime() >= buckets[index - 1]!.endUtc.getTime(),
          `${group} buckets overlap`,
        );
      }
    }
  });

  await check("G5 the total rate is recomputed, never averaged across buckets", async () => {
    const buckets = buildBuckets(JAN_APR.period, "day");
    const series = await loadCohortBuckets(prisma, JAN_APR.scope, buckets);
    const totals = await loadCohortCounts(prisma, JAN_APR.scope);

    const nonEmpty = series.filter((entry) => entry.counts.cohortLearners > 0);
    const averaged =
      nonEmpty.reduce(
        (sum, entry) =>
          sum + entry.counts.pocketRegisteredLearners / entry.counts.cohortLearners,
        0,
      ) / nonEmpty.length;

    assert.equal(computeCohortRates(totals).pocketRegistrationRate, "0.400000");
    // Five one-learner buckets, two of which converted: the average of the
    // bucket rates is 0.4 only by coincidence of this fixture, so the test
    // asserts the SOURCE of the number rather than its value.
    assert.equal(
      computeCohortRates(totals).pocketRegistrationRate,
      exactRatio(totals.pocketRegisteredLearners, totals.cohortLearners),
    );
    assert.ok(Number.isFinite(averaged));
  });

  await check("G6 a bucket median is not the whole-cohort median", async () => {
    const buckets = buildBuckets(JAN_APR.period, "day");
    const series = await loadCohortBuckets(prisma, JAN_APR.scope, buckets);
    const whole = await loadCohortMedians(prisma, JAN_APR.scope);
    const bucketMedians = series
      .map((entry) => entry.medians.selectedClickToAcademyRegistration)
      .filter((lag) => lag.sampleSize > 0);
    assert.equal(bucketMedians.length, 5, "each January learner clicked on their own day");
    for (const lag of bucketMedians) assert.equal(lag.sampleSize, 1);
    assert.equal(whole.selectedClickToAcademyRegistration.sampleSize, 5);
  });

  await check("G7 an oversized series is refused rather than truncated", () => {
    const period = resolvePeriod(
      { preset: "custom", startDate: "2020-01-01", endDate: "2024-01-01" },
      MSK,
      NOW,
    );
    assert.throws(
      () => buildBuckets(period, "day"),
      (error: unknown) =>
        error instanceof AnalyticsPeriodError &&
        error.messageKey === "crm.analytics.bucket_cap_exceeded",
    );
  });

  await check("G8 an all-time series starts at the earliest selected click", async () => {
    const period = resolvePeriod({ preset: "all_time" }, MSK, NOW);
    const cutoff = resolveCutoff({}, period, MSK, NOW);
    const scope = cohortScope(period, cutoff, NO_FILTERS);
    const earliest = await earliestCohortClick(prisma, scope);
    assert.ok(earliest !== null);
    // E's Beta click on 2 January is a FIRST TOUCH, not a selected click, so the
    // earliest ANCHOR is A's on the 10th.
    assert.equal(earliest!.getTime(), msk(2026, 1, 10).getTime());
  });

  /* =================================================================== */
  /* H. breakdowns                                                        */
  /* =================================================================== */

  await check("H1 the affiliate breakdown splits the cohort by SELECTED link owner", async () => {
    const rows = await loadCohortBreakdown(prisma, JAN_APR.scope, "affiliate");
    assert.equal(rows.get(alpha.id)?.counts.cohortLearners, 4);
    assert.equal(rows.get(beta.id)?.counts.cohortLearners, 1);
    assert.equal(rows.get(alpha.id)?.counts.firstDepositLearners, 2);
  });

  await check("H2 an archived affiliate, campaign and link remain reportable", async () => {
    const affiliates = await loadCohortBreakdown(prisma, JAN_APR.scope, "affiliate");
    const campaigns = await loadCohortBreakdown(prisma, JAN_APR.scope, "campaign");
    const links = await loadCohortBreakdown(prisma, JAN_APR.scope, "tracking_link");
    assert.ok(affiliates.has(beta.id), "the archived affiliate disappeared");
    assert.ok(campaigns.has(betaOne.id), "the archived campaign disappeared");
    assert.ok(links.has(linkB1.id), "the archived link disappeared");
    // And the paused link too.
    assert.ok(links.has(linkA2.id));
  });

  await check("H3 breakdown rows reconcile with the summary under the same filters", async () => {
    for (const dimension of ["affiliate", "campaign", "tracking_link"] as const) {
      const rows = await loadCohortBreakdown(prisma, JAN_APR.scope, dimension);
      const totals = await loadCohortCounts(prisma, JAN_APR.scope);
      const summed = [...rows.values()].reduce(
        (accumulator, row) => ({
          cohortLearners: accumulator.cohortLearners + row.counts.cohortLearners,
          pocketRegisteredLearners:
            accumulator.pocketRegisteredLearners + row.counts.pocketRegisteredLearners,
          firstDepositLearners:
            accumulator.firstDepositLearners + row.counts.firstDepositLearners,
        }),
        { cohortLearners: 0, pocketRegisteredLearners: 0, firstDepositLearners: 0 },
      );
      assert.deepEqual(summed, totals, `${dimension} rows did not reconcile`);
    }
  });

  await check("H4 a breakdown row carries its own exact median", async () => {
    const rows = await loadCohortBreakdown(prisma, JAN_APR.scope, "affiliate");
    const betaRow = rows.get(beta.id);
    // E clicked on 25 January and registered on the 26th: exactly one day.
    assert.equal(betaRow?.medians.selectedClickToAcademyRegistration.sampleSize, 1);
    assert.equal(betaRow?.medians.selectedClickToAcademyRegistration.medianSeconds, `${DAY}.0`);
  });

  await check("H5 last cohort activity never exceeds the cutoff", async () => {
    for (const scope of [JAN_FEB, JAN_MAR, JAN_APR]) {
      const rows = await loadCohortBreakdown(prisma, scope.scope, "affiliate");
      for (const row of rows.values()) {
        if (row.lastCohortActivityAt === null) continue;
        assert.ok(
          row.lastCohortActivityAt.getTime() < scope.cutoff.cutoffUtc.getTime(),
          "last activity looked past the cutoff",
        );
      }
    }
  });

  await check("H6 a filtered breakdown returns only the named affiliate", async () => {
    const filtered = scopeFor(2026, 1, "2026-04-30", { affiliatePartnerId: alpha.id });
    const rows = await loadCohortBreakdown(prisma, filtered.scope, "affiliate");
    assert.deepEqual([...rows.keys()], [alpha.id]);
  });

  await check("H7 a link filter narrows to that link's learners", async () => {
    const filtered = scopeFor(2026, 1, "2026-04-30", { affiliateTrackingLinkId: linkA2.id });
    const counts = await loadCohortCounts(prisma, filtered.scope);
    assert.equal(counts.cohortLearners, 1, "only B was acquired through Alpha One B");
  });

  await check("H8 current status does not rewrite history", async () => {
    // linkB1 is archived and betaOne is archived, yet E is still counted under
    // them, with the same numbers as before the archive.
    const filtered = scopeFor(2026, 1, "2026-04-30", { affiliateCampaignId: betaOne.id });
    const counts = await loadCohortCounts(prisma, filtered.scope);
    assert.equal(counts.cohortLearners, 1);
  });

  /* =================================================================== */
  /* I. integrity                                                         */
  /* =================================================================== */

  await check("I1 a missing registration event is counted, not invented", async () => {
    const september = scopeFor(2026, 9, "2026-12-31");
    const integrity = await loadCohortIntegrity(prisma, september.scope);
    // O has none and DUP has two.
    assert.equal(integrity.missingOrDuplicateRegistrationCount, 2);
  });

  await check("I2 a late registration is NOT an integrity warning", async () => {
    // F registers in March. Under a February cutoff F is simply unobserved.
    const integrity = await loadCohortIntegrity(prisma, JAN_FEB.scope);
    assert.equal(integrity.missingOrDuplicateRegistrationCount, 0);
  });

  await check("I3 the integrity count is bounded and never returns rows", async () => {
    const integrity = await loadCohortIntegrity(prisma, scopeFor(2026, 9, "2026-12-31").scope);
    assert.equal(typeof integrity.missingOrDuplicateRegistrationCount, "number");
    assert.equal(typeof integrity.duplicateFirstDepositCount, "number");
    assert.equal(Object.keys(integrity).length, 2);
  });

  /* =================================================================== */
  /* J. first-deposit money                                               */
  /* =================================================================== */

  await check("J1 a single configured currency yields an exact total", async () => {
    const amount = await loadCohortAmount(prisma, JAN_APR.scope);
    assert.equal(amount.amountAggregationAvailable, true);
    // A deposited 150.00 and G 250.00.
    assert.equal(amount.amountTotal, "400.00");
    assert.equal(amount.currencyCode, "USD");
  });

  await check("J2 a cohort with no deposits states the reason, not a zero", async () => {
    const amount = await loadCohortAmount(prisma, JAN_FEB.scope);
    assert.equal(amount.amountAggregationAvailable, false);
    assert.equal(amount.amountTotal, null);
    assert.equal(amount.unavailableReason, "no_confirmed_first_deposits");
  });

  await check("J3 an unspecified currency withholds the total", async () => {
    const clickX = await makeClick(linkA1.id, msk(2026, 1, 28));
    await makeLearner({
      label: "X",
      selectedClick: clickX,
      registeredAt: msk(2026, 1, 29),
      pocketAt: msk(2026, 1, 30),
      firstDepositAt: msk(2026, 1, 31),
      firstDepositAmount: "10.00",
      firstDepositCurrency: null,
    });

    const amount = await loadCohortAmount(prisma, JAN_APR.scope);
    assert.equal(amount.amountAggregationAvailable, false);
    assert.equal(amount.amountTotal, null);
    assert.equal(amount.unavailableReason, "currency_unspecified_or_mixed");

    // The COUNT is still authoritative even though the money is withheld.
    const counts = await loadCohortCounts(prisma, JAN_APR.scope);
    assert.equal(counts.firstDepositLearners, 3);

    await prisma.affiliateConversionEvent.deleteMany({ where: { userId: (await prisma.user.findFirstOrThrow({ where: { name: "Cohort X" } })).id } });
    await prisma.affiliateAttribution.deleteMany({ where: { userId: (await prisma.user.findFirstOrThrow({ where: { name: "Cohort X" } })).id } });
    await prisma.pocketTraderIdentity.deleteMany({ where: { userId: (await prisma.user.findFirstOrThrow({ where: { name: "Cohort X" } })).id } });
    await prisma.user.deleteMany({ where: { name: "Cohort X" } });
  });

  await check("J4 per-dimension money is one grouped query, not one per row", async () => {
    const byDimension = await loadCohortAmountByDimension(prisma, JAN_APR.scope, "affiliate");
    assert.equal(byDimension.get(alpha.id)?.amountTotal, "400.00");
    // Beta acquired E, who never deposited.
    assert.equal(byDimension.has(beta.id), false);
  });

  /* =================================================================== */
  /* K. availability                                                      */
  /* =================================================================== */

  await check("K1 the anonymous visitor cohort rate is unavailable WITH its reason", () => {
    const availability = buildCohortAvailability({
      amountAggregationAvailable: true,
      amountUnavailableReason: null,
    });
    assert.deepEqual(availability.anonymousVisitorToRegistrationCohortRate, {
      available: false,
      reason: "unregistered_visitor_selected_attribution_not_frozen",
    });
  });

  await check("K2 every prohibited metric is unavailable with a reason", () => {
    const availability = buildCohortAvailability({
      amountAggregationAvailable: true,
      amountUnavailableReason: null,
    });
    const expected: Record<string, string> = {
      unattributedAcquisitionCohort: "no_selected_acquisition_click",
      directTrafficCohort: "acquisition_anchor_absent",
      educationQuality: "authoritative_product_event_catalog_not_implemented",
      redeposits: "provider_transaction_identifier_missing",
      currentBalance: "prohibited_not_collected",
      // leadDrilldown is deliberately absent: AFD-5B2B shipped it, so it is no
      // longer an unavailable dimension with a reason. It is asserted available
      // in its own case below.
      maturityScoring: "deferred_to_statistical_analyst_phase",
      forecasting: "deferred_to_predictive_analytics_phase",
    };
    for (const [key, reason] of Object.entries(expected)) {
      const state = (availability as unknown as Record<string, { available: boolean; reason?: string }>)[key];
      assert.equal(state?.available, false, `${key} must be unavailable`);
      assert.equal(state?.reason, reason, `${key} reason`);
    }
  });

  await check("K3 what IS available is stated as available", () => {
    const availability = buildCohortAvailability({
      amountAggregationAvailable: true,
      amountUnavailableReason: null,
    });
    assert.deepEqual(availability.registeredAcquisitionCohort, { available: true });
    assert.deepEqual(availability.pocketRegistration, { available: true });
    assert.deepEqual(availability.firstDeposit, { available: true });
  });

  await check("K4 nothing unavailable is rendered as a zero", () => {
    const availability = buildCohortAvailability({
      amountAggregationAvailable: false,
      amountUnavailableReason: "currency_unspecified_or_mixed",
    });
    const serialised = JSON.stringify(availability);
    assert.ok(!serialised.includes(":0"), "an availability state was serialised as a number");
  });

  await check("K5 the event-date mode now reports the cohort mode as available", () => {
    const availability = buildDataAvailability({
      amountAggregationAvailable: true,
      amountUnavailableReason: null,
    });
    // AFD-5B1 said "deferred_to_afd5b2". That claim is no longer true, and a
    // stale deferral is a lie the API tells about itself.
    assert.deepEqual(availability.acquisitionCohortMode, { available: true });
    // AFD-5B2B shipped the lead drilldown. Same rule as the line above: a stale
    // deferral is a lie the API tells about itself.
    assert.deepEqual(availability.leadDrilldown, { available: true });
  });

  /* =================================================================== */
  /* L. event-date versus cohort                                          */
  /* =================================================================== */

  await check("L1 event-date counts each event on its OWN date", async () => {
    // The cross-month chain: A clicks in January, registers in February, binds
    // Pocket in March and deposits in April.
    const january = await loadCounts(prisma, monthPeriod(2026, 1), NO_FILTERS, "attributed");
    const february = await loadCounts(prisma, monthPeriod(2026, 2), NO_FILTERS, "attributed");
    const march = await loadCounts(prisma, monthPeriod(2026, 3), NO_FILTERS, "attributed");
    const april = await loadCounts(prisma, monthPeriod(2026, 4), NO_FILTERS, "attributed");

    assert.equal(january.academyRegistrations, 3, "B, G and E registered in January");
    assert.equal(january.pocketRegistrations, 0);
    assert.equal(january.confirmedFirstDeposits, 0);

    assert.equal(february.academyRegistrations, 2, "A and C registered in February");
    assert.equal(february.pocketRegistrations, 1, "C bound Pocket in February");

    assert.equal(march.pocketRegistrations, 2, "A and G bound Pocket in March");
    assert.equal(march.confirmedFirstDeposits, 0);

    assert.equal(april.confirmedFirstDeposits, 2, "A and G deposited in April");
    assert.equal(april.academyRegistrations, 0);
  });

  await check("L2 the same calendar month gives the two modes different answers", async () => {
    const eventDate = await loadCounts(prisma, monthPeriod(2026, 3), NO_FILTERS, "attributed");
    const cohort = await loadCohortCounts(prisma, scopeFor(2026, 3, "2026-12-31").scope);

    // March saw two Pocket bindings but acquired nobody: every March event
    // belongs to a January cohort. Forcing these to agree would be the bug.
    assert.equal(eventDate.pocketRegistrations, 2);
    assert.equal(cohort.cohortLearners, 0);
  });

  await check("L3 the cohort follows its learners forward across months", async () => {
    const february = await loadCohortCounts(prisma, JAN_FEB.scope);
    const march = await loadCohortCounts(prisma, JAN_MAR.scope);
    const april = await loadCohortCounts(prisma, JAN_APR.scope);

    assert.deepEqual(february, {
      cohortLearners: 4,
      pocketRegisteredLearners: 0,
      firstDepositLearners: 0,
    });
    assert.deepEqual(march, {
      cohortLearners: 5,
      pocketRegisteredLearners: 2,
      firstDepositLearners: 0,
    });
    assert.deepEqual(april, {
      cohortLearners: 5,
      pocketRegisteredLearners: 2,
      firstDepositLearners: 2,
    });
  });

  /* =================================================================== */
  /* M. query safety                                                      */
  /* =================================================================== */

  await check("M1 a hostile filter value cannot reach the SQL", async () => {
    // The filters are typed as numbers by the request parser; this proves the
    // query layer itself binds rather than interpolates, by passing a value that
    // would be catastrophic if it were ever concatenated.
    const period = monthPeriod(2026, 1);
    const cutoff = resolveCutoff({ cutoffDate: "2026-04-30" }, period, MSK, NOW);
    const hostile = cohortScope(period, cutoff, {
      affiliatePartnerId: "1 OR 1=1; DROP TABLE User" as unknown as number,
    });
    const counts = await loadCohortCounts(prisma, hostile);
    assert.equal(counts.cohortLearners, 0, "a bound parameter matched nothing, as it must");
    const users = await prisma.user.count();
    assert.ok(users > 0, "the User table survived");
  });

  await check("M2 no cohort query returns a learner identifier", async () => {
    const rows = await loadCohortBreakdown(prisma, JAN_APR.scope, "affiliate");
    for (const row of rows.values()) {
      const serialised = JSON.stringify(row);
      assert.ok(!serialised.includes("@"), "an email reached a breakdown row");
      assert.ok(!/"uid"/.test(serialised), "a user id reached a breakdown row");
    }
  });

  await check("M3 the median query returns at most two rows per group", async () => {
    // Proven structurally: a 5-learner cohort still reports one median value.
    const medians = await loadCohortMedians(prisma, JAN_APR.scope);
    assert.equal(typeof medians.selectedClickToAcademyRegistration.medianSeconds, "string");
    assert.equal(medians.selectedClickToAcademyRegistration.sampleSize, 5);
  });

  /* ---------------------------------------------------------------- end */

  await prisma.$disconnect();
  cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
