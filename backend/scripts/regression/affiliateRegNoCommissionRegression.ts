/**
 * AFFILIATE-PLATFORM-V1 — REG MUST NEVER MINT COMMERCIAL MONEY.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM THE COMMERCIAL ONE.
 *
 * A phase report described a browser registration as "the single event that
 * mints the first 120.00 USD commission". That was shorthand for the CHAIN —
 * registration, then a Pocket identity, then a sanctioned first deposit, and the
 * DEPOSIT mints the commission — but read literally it inverts the V1 business
 * contract, in which REG is a statistical conversion that creates NO CPA
 * qualification and NO commission.
 *
 * The contract was already correct in the source. What it did not have was a
 * test whose NAME is the invariant, so that anyone who later wires a commercial
 * trigger to the registration path is stopped by a red suite rather than by
 * someone rereading a comment. That is what this file is.
 *
 * IT DRIVES THE REAL OWNERS, NOT HAND-MADE ROWS. `freezeAttribution` and
 * `recordRegistrationConversion` are the exact functions the registration route
 * calls inside its transaction, and `qualifyFirstDeposit` is the exact function
 * the deposit owner calls after its transaction commits. A suite that inserted
 * conversion rows by hand would prove only that hand-made rows behave, which is
 * not the question.
 *
 * THE INVARIANTS, IN ORDER:
 *
 *   R1  an ATTRIBUTED registration  -> academy_registration +1, CPA 0, commission 0
 *   R2  the qualifier REFUSES a registration conversion handed to it directly
 *   R3  a qualifying attributed FTD -> CPA +1, commission +1
 *   R4  retry and 5-way concurrency -> still exactly 1 and 1
 *   R5  RDEP after the FTD          -> CPA and commission UNCHANGED
 *   R6  only ONE function in src/ writes either money table  (structural)
 *   R7  DB uniqueness and application uniqueness AGREE
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  freezeAttribution,
  recordRegistrationConversion,
  type AcquisitionSelection,
} from "../../src/lib/affiliate/registration-attribution";
import { emitRedepositConversion } from "../../src/lib/affiliate/redeposit-conversion";
import { qualifyFirstDeposit } from "../../src/lib/affiliate/cpa/qualification";
import { setCampaignCpaTerms } from "../../src/lib/affiliate/commercial/terms";
import { randomBase32Id } from "../../src/lib/affiliate/random-id";

const REPO = path.resolve(__dirname, "..", "..");
const DB_PATH = path.join(os.tmpdir(), `ata-reg-no-commission-${process.pid}.db`);

const CPA = "120.00";
const DEPOSIT = "500.00";
const REDEPOSIT = "77.25";
const BCRYPT_SHAPED = `$2b$10$${"a".repeat(53)}`;
const QUALIFY_ON = { AFFILIATE_CPA_QUALIFICATION_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;

let prisma: PrismaClient;
let failures = 0;
let passes = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passes += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
  }
}

function base32Id(seed: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const digest = crypto.createHash("sha256").update(seed).digest();
  let out = "";
  for (let i = 0; i < 32; i += 1) out += alphabet[digest[i] % alphabet.length];
  return out;
}

function migrate() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }
  execFileSync(
    path.join(REPO, "node_modules", ".bin", "tsx"),
    [path.join(REPO, "prisma", "migrate.ts")],
    { cwd: REPO, env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: "pipe" },
  );
}

/** The two money counts, read together so a test can assert a DELTA. */
async function money(): Promise<{ qualifications: number; commissions: number }> {
  const [qualifications, commissions] = await Promise.all([
    prisma.affiliateCpaQualification.count(),
    prisma.affiliateCommission.count(),
  ]);
  return { qualifications, commissions };
}

async function main() {
  console.log("AFFILIATE-PLATFORM-V1 — REG creates no commercial money\n");
  migrate();
  prisma = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } });

  // ------------------------------------------------------------- the fixture
  const staff = await prisma.user.create({
    data: {
      email: `staff-${process.pid}@example.invalid`,
      name: "Fixture Staff",
      passwordHash: BCRYPT_SHAPED,
      role: "admin",
    },
    select: { id: true },
  });
  const partner = await prisma.affiliatePartner.create({
    data: { code: "reg-test-partner", displayName: "REG Test Partner", createdByUserId: staff.id },
    select: { id: true, code: true },
  });
  const campaign = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: partner.id,
      code: "reg-test-campaign",
      displayName: "REG Test Campaign",
      createdByUserId: staff.id,
    },
    select: { id: true, code: true },
  });
  const linkPublicCode = base32Id("reg-test-link");
  const link = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: partner.id,
      affiliateCampaignId: campaign.id,
      publicCode: linkPublicCode,
      displayName: "REG Test Link",
      status: "active",
      createdByUserId: staff.id,
    },
    select: { id: true },
  });
  const pricing = await setCampaignCpaTerms(prisma, {
    affiliateCampaignId: campaign.id,
    cpaAmount: CPA,
    cpaCurrency: "USD",
    actorUserId: staff.id,
    now: new Date("2026-08-01T00:00:00Z"),
  });
  assert.equal(pricing.ok, true, "the fixture campaign must be priced");

  const visitorId = base32Id("reg-test-visitor");
  const click = await prisma.affiliateClick.create({
    data: {
      ataClickId: base32Id("reg-test-click"),
      trackingLinkId: link.id,
      anonymousVisitorId: visitorId,
      sub1: "reg-suite",
      classification: "qualified",
      effectiveAttributionWindowDays: 30,
      occurredAt: new Date("2026-08-01T00:00:00Z"),
    },
    select: { id: true },
  });

  const selection: AcquisitionSelection = {
    anonymousVisitorId: visitorId,
    firstTouchClickId: click.id,
    lastTouchClickId: click.id,
    selectedClickId: click.id,
    trackingLinkId: link.id,
    affiliatePartnerId: partner.id,
    affiliateCampaignId: campaign.id,
    affiliateCodeSnapshot: partner.code,
    campaignCodeSnapshot: campaign.code,
    trackingLinkPublicCodeSnapshot: linkPublicCode,
  };

  // ------------------------------------------------ R1 · the whole point
  let regConversionId = 0;
  await check(
    "R1 · an ATTRIBUTED registration writes a REG conversion and NO money",
    async () => {
      const before = await money();
      assert.deepEqual(before, { qualifications: 0, commissions: 0 });

      // THE REAL REGISTRATION PATH, in one transaction, exactly as the route
      // does it: create the user, freeze the attribution, record the conversion.
      const result = await prisma.$transaction(async (tx) => {
        const learner = await tx.user.create({
          data: {
            email: `learner-${process.pid}@example.invalid`,
            name: "REG Suite Learner",
            passwordHash: BCRYPT_SHAPED,
          },
          select: { id: true, createdAt: true },
        });
        const attributionId = await freezeAttribution(tx, learner.id, selection, learner.createdAt);
        const conversion = await recordRegistrationConversion(tx, {
          userId: learner.id,
          attributionId,
          selection,
          occurredAt: learner.createdAt,
        });
        return { learnerId: learner.id, attributionId, conversionId: conversion.conversionEventId };
      });
      regConversionId = result.conversionId;

      // THE REG CONVERSION EXISTS, ATTRIBUTED, WITH A CAMPAIGN — so this is not
      // passing because attribution silently failed.
      const reg = await prisma.affiliateConversionEvent.findUniqueOrThrow({
        where: { id: regConversionId },
        select: {
          eventType: true,
          attributionId: true,
          affiliatePartnerId: true,
          affiliateCampaignId: true,
          providerAmount: true,
        },
      });
      assert.equal(reg.eventType, "academy_registration");
      assert.equal(reg.attributionId, result.attributionId, "the REG is attributed");
      assert.equal(reg.affiliatePartnerId, partner.id, "…to the partner");
      assert.equal(reg.affiliateCampaignId, campaign.id, "…under the PRICED campaign");
      assert.equal(reg.providerAmount, null, "a registration carries no money");

      assert.equal(
        await prisma.affiliateConversionEvent.count({ where: { eventType: "academy_registration" } }),
        1,
      );

      // AND THE MONEY DELTA IS ZERO. This is the invariant the suite is named for.
      const after = await money();
      assert.deepEqual(
        after,
        { qualifications: 0, commissions: 0 },
        "REG -> CPA QUALIFICATION DELTA = 0 and COMMISSION DELTA = 0",
      );
    },
  );

  // ------------------------------------- R2 · defence in depth at the owner
  await check(
    "R2 · the qualifier REFUSES a REG conversion handed to it directly",
    async () => {
      // Nothing in the source does this. The test does it anyway: the guard must
      // hold even if a future call site is wired to the wrong conversion.
      const before = await money();
      const result = await qualifyFirstDeposit(prisma, regConversionId, new Date(), QUALIFY_ON);
      assert.equal(result.outcome, "not_qualified");
      assert.equal((result as { reason: string }).reason, "not_a_first_deposit");
      assert.deepEqual(await money(), before, "and it wrote nothing");
    },
  );

  // ------------------------------------------------- R3 · the DEPOSIT mints
  let ftdConversionId = 0;
  await check("R3 · the qualifying attributed FTD mints exactly one of each", async () => {
    const learner = await prisma.affiliateConversionEvent.findUniqueOrThrow({
      where: { id: regConversionId },
      select: { userId: true, attributionId: true },
    });

    const ftd = await prisma.affiliateConversionEvent.create({
      data: {
        eventId: base32Id("ftd-1"),
        eventType: "first_deposit",
        userId: learner.userId,
        attributionId: learner.attributionId,
        selectedClickId: click.id,
        affiliatePartnerId: partner.id,
        affiliateCampaignId: campaign.id,
        trackingLinkId: link.id,
        affiliateCodeSnapshot: partner.code,
        campaignCodeSnapshot: campaign.code,
        trackingLinkPublicCodeSnapshot: linkPublicCode,
        sourceOwner: "pocket_first_deposit",
        sourceEventId: "pocket-first-deposit:1",
        providerAmount: DEPOSIT,
        currencyStatus: "unspecified",
        occurredAt: new Date("2026-08-02T00:00:00Z"),
      },
      select: { id: true },
    });
    ftdConversionId = ftd.id;

    const result = await qualifyFirstDeposit(prisma, ftdConversionId, new Date(), QUALIFY_ON);
    assert.equal(result.outcome, "qualified");
    assert.deepEqual(await money(), { qualifications: 1, commissions: 1 });

    // THE COMMISSION IS THE CPA, AND THE DEPOSIT IS NOT THE CPA. Both halves,
    // so a bug that made every amount equal could not pass.
    const commission = await prisma.affiliateCommission.findFirstOrThrow({
      select: { amount: true, currencyCode: true, qualification: { select: { cpaAmountSnapshot: true, termsVersionSnapshot: true } } },
    });
    assert.equal(commission.amount, CPA);
    assert.equal(commission.currencyCode, "USD");
    assert.equal(commission.qualification.cpaAmountSnapshot, CPA);
    assert.equal(commission.qualification.termsVersionSnapshot, 1);
    assert.notEqual(commission.amount, DEPOSIT);
  });

  // ------------------------------------------- R4 · retry and concurrency
  await check("R4 · retry and 5-way concurrency leave exactly 1 and 1", async () => {
    const retry = await qualifyFirstDeposit(prisma, ftdConversionId, new Date(), QUALIFY_ON);
    assert.equal(retry.outcome, "already_qualified");

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () =>
        qualifyFirstDeposit(prisma, ftdConversionId, new Date(), QUALIFY_ON).catch(() => ({
          outcome: "threw" as const,
        })),
      ),
    );
    assert.equal(concurrent.filter((r) => r.outcome === "qualified").length, 0);
    assert.equal(concurrent.filter((r) => r.outcome === "threw").length, 0, "none throws");
    assert.deepEqual(await money(), { qualifications: 1, commissions: 1 });
  });

  // ----------------------------------------------------- R5 · RDEP after FTD
  await check("R5 · a REDEPOSIT after the FTD changes neither count", async () => {
    const before = await money();
    const learner = await prisma.affiliateConversionEvent.findUniqueOrThrow({
      where: { id: ftdConversionId },
      select: { userId: true },
    });

    // Through the REAL redeposit conversion emitter.
    const rdep = await prisma.$transaction(async (tx) =>
      emitRedepositConversion(tx, {
        providerEventId: 4242,
        userId: learner.userId,
        normalizedAmount: REDEPOSIT,
        currency: { status: "unspecified", code: null },
        occurredAt: new Date("2026-08-03T00:00:00Z"),
      }),
    );
    assert.notEqual(rdep.conversionEventId, null, "the redeposit IS recorded as a conversion");

    assert.equal(
      await prisma.affiliateConversionEvent.count({ where: { eventType: "redeposit" } }),
      1,
    );
    assert.deepEqual(await money(), before, "and it earns nothing");

    // …and handing it to the qualifier directly still refuses.
    const forced = await qualifyFirstDeposit(
      prisma,
      rdep.conversionEventId!,
      new Date(),
      QUALIFY_ON,
    );
    assert.equal((forced as { reason: string }).reason, "not_a_first_deposit");
    assert.deepEqual(await money(), before);
  });

  // ------------------------------------------------- R6 · structural, not behavioural
  await check("R6 · exactly ONE function in src/ writes either money table", () => {
    // A GREP, DELIBERATELY. Every behavioural test above proves the CURRENT
    // paths refuse. This one fails the day somebody adds a SECOND writer
    // anywhere in the application — which is the change that would make all the
    // behavioural tests true and the system wrong.
    const hits = execFileSync(
      "grep",
      [
        "-rn",
        "-E",
        "affiliate(CpaQualification|Commission)\\.(create|upsert|createMany|updateMany|update)",
        "src",
        "--include=*.ts",
      ],
      { cwd: REPO, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);

    for (const hit of hits) {
      assert.ok(
        hit.startsWith("src/lib/affiliate/cpa/qualification.ts:"),
        `unexpected writer of commercial money: ${hit}`,
      );
    }
    assert.equal(hits.length, 2, "exactly two writes: the qualification and its commission");
  });

  await check("R6 · and NO path outside the deposit owner calls the qualifier", () => {
    const hits = execFileSync(
      "grep",
      ["-rn", "qualifyFirstDeposit(", "src", "--include=*.ts"],
      { cwd: REPO, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((line) => !/^\S+:\d+:\s*(\*|\/\/)/.test(line));

    const callers = hits.map((line) => line.split(":")[0]);
    for (const caller of callers) {
      assert.ok(
        caller === "src/lib/affiliate/cpa/qualification.ts" ||
          caller === "src/lib/exchange/pocketFirstDeposit.ts",
        `unexpected caller of the qualification owner: ${caller}`,
      );
    }
  });

  // ------------------------------- R7 · the database agrees with the application
  await check("R7 · DB uniqueness and application uniqueness AGREE", () => {
    const sqlite = (sql: string) =>
      execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();

    // The application answered `already_qualified`. The DATABASE must refuse the
    // same thing independently — otherwise the invariant is a convention.
    let secondQualificationRefused = false;
    try {
      sqlite(
        `INSERT INTO "AffiliateCpaQualification"
          ("publicId","conversionEventId","affiliatePartnerId","affiliateCampaignId","attributionId",
           "termsId","termsVersionSnapshot","cpaAmountSnapshot","cpaCurrencySnapshot",
           "affiliateCodeSnapshot","campaignCodeSnapshot","qualifiedAt","createdAt")
         SELECT '${base32Id("dup-qual")}', "conversionEventId", "affiliatePartnerId",
                "affiliateCampaignId", "attributionId", "termsId", "termsVersionSnapshot",
                "cpaAmountSnapshot", "cpaCurrencySnapshot", "affiliateCodeSnapshot",
                "campaignCodeSnapshot", 1786000000000, 1786000000000
         FROM "AffiliateCpaQualification" LIMIT 1;`,
      );
    } catch {
      secondQualificationRefused = true;
    }
    assert.equal(secondQualificationRefused, true, "UNIQUE(conversionEventId)");

    let secondCommissionRefused = false;
    try {
      sqlite(
        `INSERT INTO "AffiliateCommission" ("publicId","qualificationId","affiliatePartnerId","amount","currencyCode","createdAt")
         SELECT '${base32Id("dup-comm")}', "qualificationId", "affiliatePartnerId", '999.00', 'USD', 1786000000000
         FROM "AffiliateCommission" LIMIT 1;`,
      );
    } catch {
      secondCommissionRefused = true;
    }
    assert.equal(secondCommissionRefused, true, "UNIQUE(qualificationId)");

    assert.equal(sqlite("PRAGMA integrity_check;"), "ok");
    assert.equal(sqlite("PRAGMA foreign_key_check;"), "");
  });

  await check("FINAL · the whole run leaves exactly one qualification and one commission", async () => {
    assert.deepEqual(await money(), { qualifications: 1, commissions: 1 });
    const byType = await prisma.affiliateConversionEvent.groupBy({
      by: ["eventType"],
      _count: { _all: true },
    });
    const counts = Object.fromEntries(byType.map((row) => [row.eventType, row._count._all]));
    assert.deepEqual(counts, { academy_registration: 1, first_deposit: 1, redeposit: 1 });
  });

  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
