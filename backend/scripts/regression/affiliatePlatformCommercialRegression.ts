/**
 * AFFILIATE-PLATFORM-V1 — the commercial invariant suite.
 *
 * WHAT THIS SUITE IS FOR. §52 lists a test matrix whose centre is a handful of
 * statements about money that must be true under retry, under concurrency, and
 * after a price change. Those statements are the reason this phase exists, so
 * they are tested against a REAL DATABASE built by the REAL MIGRATION RUNNER —
 * the constraints under test are the ones migration 50 actually creates, not a
 * copy of them in a fixture.
 *
 * EVERY TEST NAMES THE INVARIANT IT DEFENDS:
 *
 *   I1  one qualifying FTD  -> at most one qualification
 *   I2  one qualification   -> at most one commission
 *   I3  RDEP                -> zero qualifications, ever
 *   I4  unattributed FTD    -> zero qualifications, and no partner guessed
 *   I5  commission amount  == the CPA snapshot, NEVER the deposit amount
 *   I6  changing the CPA does not rewrite an existing commission
 *   I7  one conversion x one endpoint version -> one logical delivery
 *   I8  the campaign's active price is unique, in the database
 *
 * WHERE A TEST COULD PASS FOR THE WRONG REASON, IT ASSERTS THE OPPOSITE TOO.
 * I5 does not merely check that the commission is 120.00 — it checks that the
 * deposit was 500.00 in the same fixture, so a bug that made every amount equal
 * could not produce a green run.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { qualifyFirstDeposit } from "../../src/lib/affiliate/cpa/qualification";
import { setCampaignCpaTerms, parseCpaAmount } from "../../src/lib/affiliate/commercial/terms";
import { enqueueConversionPostback } from "../../src/lib/affiliate/postback/enqueue";
import { validatePostbackTemplate, renderPostbackTemplate } from "../../src/lib/affiliate/postback/template";
import { groupAmountsByCurrency } from "../../src/lib/affiliate/partner/reporting";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

const REPO = path.resolve(__dirname, "..", "..");
const DB_PATH = path.join(os.tmpdir(), `ata-affiliate-commercial-${process.pid}.db`);

let prisma: PrismaClient;
let failures = 0;
let passes = 0;

/** The CPA under test, and the deposit it must never be confused with. */
const CPA_V1 = "120.00";
const CPA_V2 = "150.00";
const DEPOSIT = "500.00";
const REDEPOSIT = "77.25";

/**
 * A value with the exact SHAPE of a bcrypt digest — `$2b$` + cost + 53
 * characters — so the storage CHECK accepts it. It is not a usable credential
 * and no test here authenticates against it.
 */
const BCRYPT_SHAPED = `$2b$10$${"a".repeat(53)}`;

/** A deterministic 32-character base32 id, the shape every public id uses. */
function base32Id(seed: string): string {
  // A DETERMINISTIC 32-CHARACTER BASE32 ID, derived from a real hash rather
  // than a hand-rolled LCG. The first attempt used one, and its 32-bit state
  // exceeded IEEE-754 integer precision on multiply, which collapsed distinct
  // seeds onto identical ids and produced a UNIQUE violation that looked like a
  // schema defect. A hash has no such failure mode.
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const digest = crypto.createHash("sha256").update(seed).digest();
  let out = "";
  for (let i = 0; i < 32; i += 1) out += alphabet[digest[i] % alphabet.length];
  return out;
}

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

function sqlite(sql: string): string {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
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

type Fixture = {
  staffUserId: number;
  partnerId: number;
  otherPartnerId: number;
  campaignId: number;
  linkId: number;
  attributedUserId: number;
  attributionId: number;
  clickId: number;
};

/**
 * One partner with a priced campaign, one attributed learner, and a SECOND
 * partner that exists only to prove isolation.
 */
async function buildFixture(): Promise<Fixture> {
  const staff = await prisma.user.create({
    data: {
      email: `staff-${process.pid}@example.invalid`,
      name: "Commercial Fixture Staff",
      passwordHash: BCRYPT_SHAPED,
      role: "admin",
    },
    select: { id: true },
  });

  const partner = await prisma.affiliatePartner.create({
    data: { code: "fixture-partner", displayName: "Fixture Partner", createdByUserId: staff.id },
    select: { id: true },
  });
  const otherPartner = await prisma.affiliatePartner.create({
    data: { code: "other-partner", displayName: "Other Partner", createdByUserId: staff.id },
    select: { id: true },
  });

  const campaign = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: partner.id,
      code: "fixture-campaign",
      displayName: "Fixture Campaign",
      createdByUserId: staff.id,
    },
    select: { id: true },
  });

  const link = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: partner.id,
      affiliateCampaignId: campaign.id,
      publicCode: "a".repeat(32),
      displayName: "Fixture Link",
      status: "active",
      createdByUserId: staff.id,
    },
    select: { id: true },
  });

  const click = await prisma.affiliateClick.create({
    data: {
      ataClickId: "b".repeat(32),
      trackingLinkId: link.id,
      anonymousVisitorId: "v".repeat(32),
      externalAffiliateClickId: "network-click-1",
      sub1: "src-a",
      sub2: "src-b",
      classification: "qualified",
      effectiveAttributionWindowDays: 30,
      occurredAt: new Date("2026-08-01T00:00:00Z"),
    },
    select: { id: true },
  });

  const learner = await prisma.user.create({
    data: {
      email: `learner-${process.pid}@example.invalid`,
      name: "Fixture Learner",
      passwordHash: BCRYPT_SHAPED,
    },
    select: { id: true },
  });

  const attribution = await prisma.affiliateAttribution.create({
    data: {
      userId: learner.id,
      anonymousVisitorId: "v".repeat(32),
      firstTouchClickId: click.id,
      lastTouchClickId: click.id,
      selectedClickId: click.id,
      attributionModel: "last_eligible_affiliate_click",
      selectedAt: new Date("2026-08-01T00:01:00Z"),
      frozenAt: new Date("2026-08-01T00:01:00Z"),
      selectionReason: "registration_cookie",
    },
    select: { id: true },
  });

  return {
    staffUserId: staff.id,
    partnerId: partner.id,
    otherPartnerId: otherPartner.id,
    campaignId: campaign.id,
    linkId: link.id,
    attributedUserId: learner.id,
    attributionId: attribution.id,
    clickId: click.id,
  };
}

let seq = 0;
async function createConversion(
  f: Fixture,
  eventType: "first_deposit" | "redeposit" | "academy_registration",
  options: { attributed: boolean; amount?: string | null; withCampaign?: boolean } = {
    attributed: true,
  },
): Promise<number> {
  seq += 1;
  const attributed = options.attributed;
  const withCampaign = options.withCampaign ?? true;
  const money = eventType === "academy_registration" ? null : (options.amount ?? DEPOSIT);
  const row = await prisma.affiliateConversionEvent.create({
    data: {
      // The ledger CHECK demands 32 characters of the base32 alphabet
      // [a-z2-7], so a decimal counter cannot be padded into one.
      eventId: base32Id(`ev${seq}`),
      eventType,
      userId: f.attributedUserId,
      attributionId: attributed ? f.attributionId : null,
      selectedClickId: attributed ? f.clickId : null,
      affiliatePartnerId: attributed ? f.partnerId : null,
      affiliateCampaignId: attributed && withCampaign ? f.campaignId : null,
      trackingLinkId: attributed ? f.linkId : null,
      affiliateCodeSnapshot: attributed ? "fixture-partner" : null,
      campaignCodeSnapshot: attributed && withCampaign ? "fixture-campaign" : null,
      trackingLinkPublicCodeSnapshot: attributed ? "a".repeat(32) : null,
      sourceOwner:
        eventType === "academy_registration"
          ? "auth_register"
          : eventType === "first_deposit"
            ? "pocket_first_deposit"
            : "pocket_redeposit",
      sourceEventId: `fixture:${eventType}:${seq}`,
      providerAmount: money,
      currencyCode: null,
      currencyStatus: money === null ? null : "unspecified",
      occurredAt: new Date("2026-08-02T00:00:00Z"),
    },
    select: { id: true },
  });
  return row.id;
}

const QUALIFY_ON = { AFFILIATE_CPA_QUALIFICATION_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;

async function main() {
  console.log("AFFILIATE-PLATFORM-V1 — commercial invariant regression\n");
  migrate();
  prisma = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } });

  const f = await buildFixture();

  // ---------------------------------------------------------------- schema
  await check("migration count is the canonical one", () => {
    assert.equal(Number(sqlite("SELECT count(*) FROM _prisma_migrations;")), EXPECTED_MIGRATION_COUNT);
  });

  await check("I8 · one ACTIVE terms version per campaign is a DATABASE rule", async () => {
    const first = await setCampaignCpaTerms(prisma, {
      affiliateCampaignId: f.campaignId,
      cpaAmount: CPA_V1,
      cpaCurrency: "USD",
      actorUserId: f.staffUserId,
      now: new Date("2026-08-01T12:00:00Z"),
    });
    assert.equal(first.ok, true);

    // Forge a SECOND active row by raw SQL, bypassing the service entirely.
    // The partial unique index must refuse it: if only the service enforced
    // this, a future writer could create two live prices.
    let refused = false;
    try {
      sqlite(
        `INSERT INTO "AffiliateCampaignTerms"
           ("publicId","affiliateCampaignId","version","cpaAmount","cpaCurrency","status","effectiveFrom","createdByUserId","createdAt")
         VALUES ('${"z".repeat(32)}',${f.campaignId},99,'999.00','USD','active',1786000000000,${f.staffUserId},1786000000000);`,
      );
    } catch {
      refused = true;
    }
    assert.equal(refused, true, "a second active terms row must be refused by the index");
  });

  await check("money shape · a CPA amount is canonical decimal TEXT, never rounded", () => {
    const whole = parseCpaAmount("120");
    assert.equal(whole.ok && whole.normalized, "120.00");
    const oneDecimal = parseCpaAmount("120.5");
    assert.equal(oneDecimal.ok && oneDecimal.normalized, "120.50");
    assert.equal(parseCpaAmount("120.555").ok, false, "a third decimal is refused, not rounded");
    assert.equal(parseCpaAmount("0.00").ok, false, "a zero CPA is not representable");
    assert.equal(parseCpaAmount("-5.00").ok, false);
    assert.equal(parseCpaAmount("1e2").ok, false);
    assert.equal(parseCpaAmount("1,20").ok, false);
  });

  // ------------------------------------------------------------ CPA + money
  let firstConversionId = 0;
  await check("I5 · the commission is the CPA SNAPSHOT, not the deposit amount", async () => {
    firstConversionId = await createConversion(f, "first_deposit", { attributed: true });
    const result = await qualifyFirstDeposit(prisma, firstConversionId, new Date(), QUALIFY_ON);
    assert.equal(result.outcome, "qualified");

    const commission = await prisma.affiliateCommission.findFirst({
      where: { qualification: { conversionEventId: firstConversionId } },
      select: { amount: true, currencyCode: true },
    });
    const deposit = await prisma.affiliateConversionEvent.findUnique({
      where: { id: firstConversionId },
      select: { providerAmount: true },
    });

    // BOTH SIDES. The commission is the CPA and the deposit is NOT the CPA, so
    // a bug that collapsed the two numbers could not pass this.
    assert.equal(commission?.amount, CPA_V1);
    assert.equal(commission?.currencyCode, "USD");
    assert.equal(deposit?.providerAmount, DEPOSIT);
    assert.notEqual(commission?.amount, deposit?.providerAmount);
  });

  await check("I1 · a retry creates NO second qualification and NO second commission", async () => {
    const second = await qualifyFirstDeposit(prisma, firstConversionId, new Date(), QUALIFY_ON);
    assert.equal(second.outcome, "already_qualified");
    assert.equal(
      await prisma.affiliateCpaQualification.count({ where: { conversionEventId: firstConversionId } }),
      1,
    );
    assert.equal(await prisma.affiliateCommission.count(), 1);
  });

  await check("I1 · FIVE CONCURRENT qualifiers produce exactly one of each", async () => {
    const conversionId = await createConversion(f, "first_deposit", { attributed: true });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        qualifyFirstDeposit(prisma, conversionId, new Date(), QUALIFY_ON).catch((error) => ({
          outcome: `threw:${(error as Error).message}`,
        })),
      ),
    );
    const qualified = results.filter((r) => r.outcome === "qualified").length;
    const already = results.filter((r) => r.outcome === "already_qualified").length;
    assert.equal(qualified, 1, `exactly one winner, got ${qualified}`);
    assert.equal(qualified + already, 5, "every other caller learns the answer, none throws");
    assert.equal(
      await prisma.affiliateCpaQualification.count({ where: { conversionEventId: conversionId } }),
      1,
    );
    assert.equal(
      await prisma.affiliateCommission.count({
        where: { qualification: { conversionEventId: conversionId } },
      }),
      1,
    );
  });

  await check("I3 · a REDEPOSIT never qualifies, whatever it is worth", async () => {
    const rdep = await createConversion(f, "redeposit", { attributed: true, amount: REDEPOSIT });
    const before = await prisma.affiliateCpaQualification.count();
    const result = await qualifyFirstDeposit(prisma, rdep, new Date(), QUALIFY_ON);
    assert.equal(result.outcome, "not_qualified");
    assert.equal((result as { reason: string }).reason, "not_a_first_deposit");
    assert.equal(await prisma.affiliateCpaQualification.count(), before);
  });

  await check("I3 · MANY redeposits are all statistics and none is a CPA", async () => {
    const before = await prisma.affiliateCpaQualification.count();
    const beforeCommissions = await prisma.affiliateCommission.count();
    for (const amount of ["10.00", "20.50", "30.99"]) {
      const id = await createConversion(f, "redeposit", { attributed: true, amount });
      await qualifyFirstDeposit(prisma, id, new Date(), QUALIFY_ON);
    }
    assert.equal(await prisma.affiliateCpaQualification.count(), before);
    assert.equal(await prisma.affiliateCommission.count(), beforeCommissions);
    assert.equal(
      await prisma.affiliateConversionEvent.count({ where: { eventType: "redeposit" } }),
      4,
      "all four redeposits ARE recorded as conversions — they are statistics, not nothing",
    );
  });

  await check("I3 · a REGISTRATION never qualifies either", async () => {
    const reg = await createConversion(f, "academy_registration", { attributed: true });
    const result = await qualifyFirstDeposit(prisma, reg, new Date(), QUALIFY_ON);
    assert.equal(result.outcome, "not_qualified");
    assert.equal((result as { reason: string }).reason, "not_a_first_deposit");
  });

  await check("I4 · an UNATTRIBUTED first deposit qualifies nothing and names no partner", async () => {
    const id = await createConversion(f, "first_deposit", { attributed: false });
    const result = await qualifyFirstDeposit(prisma, id, new Date(), QUALIFY_ON);
    assert.equal(result.outcome, "not_qualified");
    assert.equal((result as { reason: string }).reason, "unattributed");
    assert.equal(await prisma.affiliateCpaQualification.count({ where: { conversionEventId: id } }), 0);
  });

  await check("I4 · an attributed deposit with NO CAMPAIGN qualifies nothing", async () => {
    const id = await createConversion(f, "first_deposit", { attributed: true, withCampaign: false });
    const result = await qualifyFirstDeposit(prisma, id, new Date(), QUALIFY_ON);
    assert.equal(result.outcome, "not_qualified");
    assert.equal((result as { reason: string }).reason, "no_commercial_campaign");
  });

  await check("§36 · with the switch OFF, a perfect deposit still mints nothing", async () => {
    const id = await createConversion(f, "first_deposit", { attributed: true });
    const result = await qualifyFirstDeposit(prisma, id, new Date(), {} as unknown as NodeJS.ProcessEnv);
    assert.equal(result.outcome, "not_qualified");
    assert.equal((result as { reason: string }).reason, "qualification_disabled");
    assert.equal(await prisma.affiliateCpaQualification.count({ where: { conversionEventId: id } }), 0);
  });

  // -------------------------------------------------- §11/§42 no rewrite
  await check("I6 · changing the CPA 120 -> 150 does NOT rewrite the earned 120", async () => {
    const before = await prisma.affiliateCommission.findFirst({
      where: { qualification: { conversionEventId: firstConversionId } },
      select: { id: true, amount: true },
    });
    assert.equal(before?.amount, CPA_V1);

    const changed = await setCampaignCpaTerms(prisma, {
      affiliateCampaignId: f.campaignId,
      cpaAmount: CPA_V2,
      cpaCurrency: "USD",
      actorUserId: f.staffUserId,
      now: new Date("2026-08-03T00:00:00Z"),
    });
    assert.equal(changed.ok, true);
    assert.equal(changed.ok && changed.version, 2);
    assert.equal(changed.ok && changed.previous?.cpaAmount, CPA_V1);

    const after = await prisma.affiliateCommission.findUnique({
      where: { id: before!.id },
      select: { amount: true },
    });
    assert.equal(after?.amount, CPA_V1, "the historical commission is unchanged");

    const qualification = await prisma.affiliateCpaQualification.findUnique({
      where: { conversionEventId: firstConversionId },
      select: { termsVersionSnapshot: true, cpaAmountSnapshot: true },
    });
    assert.equal(qualification?.termsVersionSnapshot, 1);
    assert.equal(qualification?.cpaAmountSnapshot, CPA_V1);
  });

  await check("I6 · a deposit qualifying AFTER the change earns the NEW price", async () => {
    const id = await createConversion(f, "first_deposit", { attributed: true });
    const result = await qualifyFirstDeposit(prisma, id, new Date(), QUALIFY_ON);
    assert.equal(result.outcome, "qualified");
    assert.equal((result as { amount: string }).amount, CPA_V2);

    const both = await prisma.affiliateCommission.findMany({
      orderBy: { id: "asc" },
      select: { amount: true },
    });
    // The whole of §42 in one assertion: two commissions, two prices, and the
    // first one is still the first one.
    assert.deepEqual(
      [both[0].amount, both[both.length - 1].amount],
      [CPA_V1, CPA_V2],
      "the old commission kept its price and the new one got the new price",
    );
  });

  // ------------------------------------------------------------- §27 outbox
  await check("I7 · one conversion x one endpoint version -> ONE logical delivery", async () => {
    const partnerUser = await prisma.affiliatePartnerUser.create({
      data: {
        publicId: "d".repeat(32),
        affiliatePartnerId: f.partnerId,
        email: "partner@example.invalid",
        passwordHash: BCRYPT_SHAPED,
        displayName: "Fixture Partner User",
        createdByUserId: f.staffUserId,
      },
      select: { id: true },
    });

    await prisma.affiliatePostbackEndpoint.create({
      data: {
        publicId: "e".repeat(32),
        affiliatePartnerId: f.partnerId,
        eventType: "first_deposit",
        urlTemplate: "https://receiver.example.com/cb?c={click_id}&a={amount}&s1={sub1}",
        version: 1,
        status: "active",
        signingSecret: "S".repeat(43),
        createdByPartnerUserId: partnerUser.id,
      },
    });

    const first = await enqueueConversionPostback(prisma, firstConversionId, new Date());
    assert.equal(first.kind, "enqueued");
    const again = await enqueueConversionPostback(prisma, firstConversionId, new Date());
    assert.equal(again.kind, "already_enqueued");
    assert.equal(
      await prisma.affiliatePostbackDelivery.count({ where: { conversionEventId: firstConversionId } }),
      1,
    );

    // TEN CONCURRENT ENQUEUES, which is the duplicate-worker case §28 names.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        enqueueConversionPostback(prisma, firstConversionId, new Date()).catch(() => ({
          kind: "threw" as const,
        })),
      ),
    );
    assert.equal(results.filter((r) => r.kind === "enqueued").length, 0);
    assert.equal(
      await prisma.affiliatePostbackDelivery.count({ where: { conversionEventId: firstConversionId } }),
      1,
      "concurrency adds no delivery row",
    );
  });

  await check("I7 · re-pointing the endpoint DOES owe a new delivery", async () => {
    await prisma.affiliatePostbackEndpoint.updateMany({
      where: { affiliatePartnerId: f.partnerId, eventType: "first_deposit" },
      data: { urlTemplate: "https://receiver2.example.com/cb?c={click_id}", version: 2 },
    });
    const result = await enqueueConversionPostback(prisma, firstConversionId, new Date());
    assert.equal(result.kind, "enqueued");
    assert.equal(
      await prisma.affiliatePostbackDelivery.count({ where: { conversionEventId: firstConversionId } }),
      2,
      "a different destination version is a different logical delivery",
    );
  });

  await check("§26 · the rendered URL carries the partner's context and no secret", async () => {
    const delivery = await prisma.affiliatePostbackDelivery.findFirst({
      where: { conversionEventId: firstConversionId, endpointVersion: 1 },
      select: { requestUrl: true },
    });
    const url = delivery!.requestUrl;
    assert.match(url, /^https:\/\/receiver\.example\.com\/cb\?/);
    assert.ok(url.includes(`c=${"b".repeat(32)}`), "the ATA click id is carried");
    assert.ok(url.includes(`a=${DEPOSIT}`), "the exact provider amount is carried");
    assert.ok(url.includes("s1=src-a"), "sub1 is carried");
    assert.ok(!url.includes("S".repeat(43)), "the signing secret is NOT in the URL");
    assert.ok(!/[0-9]+@/.test(url), "no learner address");
  });

  await check("§26 · an unknown macro is refused at configuration time", () => {
    assert.equal(validatePostbackTemplate("https://x.example.com/?c={click_id}").ok, true);
    assert.equal(validatePostbackTemplate("https://x.example.com/?c={sub_1}").ok, false);
    assert.equal(validatePostbackTemplate("https://x.example.com/?c={click_id").ok, false);
    assert.equal(validatePostbackTemplate("http://x.example.com/?c={click_id}").ok, false);
    assert.equal(validatePostbackTemplate("https://u:p@x.example.com/?c={click_id}").ok, false);
    assert.equal(validatePostbackTemplate("https://x.example.com/?a=1").ok, false, "no click context");
    // THE HOST MUST BE FIXED. A macro in the authority would make the
    // destination depend on runtime data.
    assert.equal(validatePostbackTemplate("https://{sub1}.example.com/?c={click_id}").ok, false);
  });

  await check("§21/§26 · a hostile sub value cannot escape its parameter", () => {
    const template = "https://x.example.com/cb?c={click_id}&s={sub1}";
    const rendered = renderPostbackTemplate(template, {
      event: "dep",
      click_id: "abc",
      external_click_id: "",
      sub1: "a&admin=1#frag/../x?y=z",
      sub2: "",
      sub3: "",
      sub4: "",
      sub5: "",
      amount: "",
      currency: "",
      event_time: "",
      conversion_id: "",
      campaign: "",
      link: "",
    });
    const parsed = new URL(rendered);
    assert.equal(parsed.host, "x.example.com");
    assert.equal(parsed.hash, "", "no fragment was injected");
    assert.equal(parsed.searchParams.get("admin"), null, "no parameter was injected");
    assert.equal(parsed.searchParams.get("s"), "a&admin=1#frag/../x?y=z", "the value survives intact");
  });

  // ------------------------------------------------------------- §23 money
  await check("§23 · amounts are never summed across currencies, and never invented", () => {
    const totals = groupAmountsByCurrency([
      { amount: "10.10", currency: "USD" },
      { amount: "20.20", currency: "USD" },
      { amount: "5.05", currency: "EUR" },
      { amount: "1.01", currency: null },
      { amount: null, currency: "USD" },
    ]);
    assert.equal(totals.length, 3, "three buckets, not one total");
    const usd = totals.find((t) => t.currency === "USD");
    assert.equal(usd?.amount, "30.30", "exact decimal addition, no float");
    assert.equal(usd?.count, 2, "a null amount is not a zero and does not count");
    assert.equal(totals.find((t) => t.currency === null)?.amount, "1.01");
    assert.equal(totals[totals.length - 1].currency, null, "the unspecified bucket is last");
  });

  await check("§23 · exact decimal addition survives the classic float case", () => {
    const totals = groupAmountsByCurrency([
      { amount: "0.10", currency: "USD" },
      { amount: "0.20", currency: "USD" },
    ]);
    assert.equal(totals[0].amount, "0.30", "0.1 + 0.2 is exactly 0.30 here");
  });

  // ------------------------------------------------------------ §18 tenancy
  await check("I8/§18 · no commercial row exists for the second partner", async () => {
    assert.equal(await prisma.affiliateCommission.count({ where: { affiliatePartnerId: f.otherPartnerId } }), 0);
    assert.equal(await prisma.affiliateCpaQualification.count({ where: { affiliatePartnerId: f.otherPartnerId } }), 0);
    assert.equal(await prisma.affiliatePostbackDelivery.count({ where: { affiliatePartnerId: f.otherPartnerId } }), 0);
    // …and every row that DOES exist names the first partner. A tenant filter
    // that silently matched nothing would pass the three assertions above.
    const commissions = await prisma.affiliateCommission.findMany({ select: { affiliatePartnerId: true } });
    assert.ok(commissions.length > 0);
    assert.ok(commissions.every((row) => row.affiliatePartnerId === f.partnerId));
  });

  await check("schema · a tracking link cannot have two authors, or none", () => {
    let bothRefused = false;
    try {
      sqlite(
        `INSERT INTO "AffiliateTrackingLink"
           ("affiliatePartnerId","publicCode","displayName","status","landingKey","externalClickParameter","createdByUserId","createdByPartnerUserId","createdAt","updatedAt")
         VALUES (${f.partnerId},'${"y".repeat(32)}','x','draft','academy_registration','clickid',${f.staffUserId},1,1786000000000,1786000000000);`,
      );
    } catch {
      bothRefused = true;
    }
    assert.equal(bothRefused, true, "two creators is a contradiction and is refused");

    let neitherRefused = false;
    try {
      sqlite(
        `INSERT INTO "AffiliateTrackingLink"
           ("affiliatePartnerId","publicCode","displayName","status","landingKey","externalClickParameter","createdAt","updatedAt")
         VALUES (${f.partnerId},'${"w".repeat(32)}','x','draft','academy_registration','clickid',1786000000000,1786000000000);`,
      );
    } catch {
      neitherRefused = true;
    }
    assert.equal(neitherRefused, true, "an unauthored public URL is refused");
  });

  await check("schema · a commission cannot exist twice for one qualification", async () => {
    const qualification = await prisma.affiliateCpaQualification.findFirst({ select: { id: true, affiliatePartnerId: true } });
    let refused = false;
    try {
      sqlite(
        `INSERT INTO "AffiliateCommission" ("publicId","qualificationId","affiliatePartnerId","amount","currencyCode","createdAt")
         VALUES ('${"q".repeat(32)}',${qualification!.id},${qualification!.affiliatePartnerId},'999.00','USD',1786000000000);`,
      );
    } catch {
      refused = true;
    }
    assert.equal(refused, true, "I2 is a database rule, not an application one");
  });

  await check("integrity · foreign keys and integrity are clean after the whole suite", () => {
    assert.equal(sqlite("PRAGMA integrity_check;"), "ok");
    assert.equal(sqlite("PRAGMA foreign_key_check;"), "");
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
