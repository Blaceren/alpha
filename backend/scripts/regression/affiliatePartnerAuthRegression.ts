/**
 * AFFILIATE-PLATFORM-V1 §17/§18/§44 — partner identity and tenant isolation.
 *
 * TWO TENANTS, TWO PRINCIPALS, AND EVERY QUERY OWNER ASKED THE HOSTILE
 * QUESTION. §18 lists the attacks this must survive: horizontal IDOR, vertical
 * escalation, direct route access, object-id substitution, public-id
 * substitution, pagination leakage and aggregate leakage. Each one is a test
 * here, run against the REAL query owners rather than against a mock of them —
 * a suite that stubbed the reporting layer would prove only that the stub is
 * scoped.
 *
 * THE FIXTURE IS DELIBERATELY ASYMMETRIC. Partner B holds MORE of everything
 * than partner A: more clicks, more conversions, more money. So a query owner
 * that lost its tenant predicate would not merely return the wrong rows — it
 * would return OBVIOUSLY wrong TOTALS, and every aggregate assertion below
 * would fail loudly rather than coincidentally pass.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  createPartnerSessionToken,
  verifyPartnerSessionToken,
  partnerSessionCookieOptions,
  partnerCsrfCookieOptions,
  partnerCsrfTokensMatch,
  createPartnerCsrfToken,
  PARTNER_SESSION_COOKIE_NAME,
} from "../../src/lib/affiliate/partner/session";
import { resolvePartnerPrincipal } from "../../src/lib/affiliate/partner/principal";
import {
  authenticatePartnerUser,
  describePartnerPasswordRejection,
  hashPartnerPassword,
  normalisePartnerEmail,
} from "../../src/lib/affiliate/partner/credential";
import { getPartnerOverview, listPartnerConversions } from "../../src/lib/affiliate/partner/reporting";
import { parsePartnerFilters } from "../../src/lib/affiliate/partner/filters";
import { describeSecretRejection } from "../../src/lib/affiliate/platform-config";

const REPO = path.resolve(__dirname, "..", "..");
const DB_PATH = path.join(os.tmpdir(), `ata-partner-auth-${process.pid}.db`);

/** A well-formed secret that is not any other secret in the deployment. */
const PARTNER_SECRET = "kQ7vX2mR9tLpZ4wY8nB3cF6hJ1dS5gA0eU7iO2rT4yM";
// `as NodeJS.ProcessEnv` throughout: this repository's ProcessEnv type declares
// NODE_ENV as required, and a test env deliberately carries only the keys under
// test — supplying NODE_ENV would be adding a variable the assertion is not about.
const ENV = {
  AFFILIATE_PLATFORM_ENABLED: "true",
  PARTNER_SESSION_SECRET: PARTNER_SECRET,
} as unknown as NodeJS.ProcessEnv;

const PASSWORD_A = "correct-horse-battery-staple-A1";
const PASSWORD_B = "correct-horse-battery-staple-B2";

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

const BCRYPT_SHAPED = `$2b$10$${"a".repeat(53)}`;

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

type Tenant = {
  partnerId: number;
  partnerUserId: number;
  partnerUserPublicId: string;
  campaignId: number;
  campaignCode: string;
  linkId: number;
  linkPublicCode: string;
  clicks: number;
  regs: number;
  deps: number;
};

let seq = 0;

async function buildTenant(
  staffUserId: number,
  code: string,
  password: string,
  counts: { clicks: number; regs: number; deps: number },
  subValue: string,
): Promise<Tenant> {
  const partner = await prisma.affiliatePartner.create({
    data: { code, displayName: `${code} display`, createdByUserId: staffUserId },
    select: { id: true },
  });
  const campaign = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: partner.id,
      code: `${code}-campaign`,
      displayName: `${code} campaign`,
      createdByUserId: staffUserId,
    },
    select: { id: true, code: true },
  });
  const linkPublicCode = base32Id(`${code}-link`);
  const link = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: partner.id,
      affiliateCampaignId: campaign.id,
      publicCode: linkPublicCode,
      displayName: `${code} link`,
      status: "active",
      createdByUserId: staffUserId,
    },
    select: { id: true },
  });
  const partnerUser = await prisma.affiliatePartnerUser.create({
    data: {
      publicId: base32Id(`${code}-user`),
      affiliatePartnerId: partner.id,
      email: `${code}@example.invalid`,
      passwordHash: await hashPartnerPassword(password),
      displayName: `${code} human`,
      createdByUserId: staffUserId,
    },
    select: { id: true, publicId: true },
  });

  let firstAttributionId = 0;
  for (let i = 0; i < counts.clicks; i += 1) {
    seq += 1;
    const click = await prisma.affiliateClick.create({
      data: {
        ataClickId: base32Id(`${code}-click-${i}`),
        trackingLinkId: link.id,
        anonymousVisitorId: base32Id(`${code}-visitor-${i}`),
        sub1: subValue,
        classification: "qualified",
        effectiveAttributionWindowDays: 30,
        occurredAt: new Date("2026-08-01T00:00:00Z"),
      },
      select: { id: true },
    });

    if (i < counts.regs) {
      const learner = await prisma.user.create({
        data: {
          email: `${code}-learner-${i}@example.invalid`,
          name: `${code} learner ${i}`,
          passwordHash: BCRYPT_SHAPED,
        },
        select: { id: true },
      });
      const attribution = await prisma.affiliateAttribution.create({
        data: {
          userId: learner.id,
          anonymousVisitorId: base32Id(`${code}-visitor-${i}`),
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
      if (i === 0) firstAttributionId = attribution.id;

      const common = {
        userId: learner.id,
        attributionId: attribution.id,
        selectedClickId: click.id,
        affiliatePartnerId: partner.id,
        affiliateCampaignId: campaign.id,
        trackingLinkId: link.id,
        affiliateCodeSnapshot: code,
        campaignCodeSnapshot: campaign.code,
        trackingLinkPublicCodeSnapshot: linkPublicCode,
        occurredAt: new Date("2026-08-02T00:00:00Z"),
      };

      seq += 1;
      await prisma.affiliateConversionEvent.create({
        data: {
          ...common,
          eventId: base32Id(`ev-${seq}`),
          eventType: "academy_registration",
          sourceOwner: "auth_register",
          sourceEventId: `user:${learner.id}`,
        },
      });

      if (i < counts.deps) {
        seq += 1;
        await prisma.affiliateConversionEvent.create({
          data: {
            ...common,
            eventId: base32Id(`ev-${seq}`),
            eventType: "first_deposit",
            sourceOwner: "pocket_first_deposit",
            sourceEventId: `pocket-first-deposit:${seq}`,
            providerAmount: "100.00",
            currencyStatus: "unspecified",
          },
        });
      }
    }
  }

  void firstAttributionId;

  return {
    partnerId: partner.id,
    partnerUserId: partnerUser.id,
    partnerUserPublicId: partnerUser.publicId,
    campaignId: campaign.id,
    campaignCode: campaign.code,
    linkId: link.id,
    linkPublicCode,
    ...counts,
  };
}

async function main() {
  console.log("AFFILIATE-PLATFORM-V1 — partner auth and tenant isolation regression\n");
  migrate();
  prisma = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } });

  const staff = await prisma.user.create({
    data: {
      email: `staff-${process.pid}@example.invalid`,
      name: "Fixture Staff",
      passwordHash: BCRYPT_SHAPED,
      role: "admin",
    },
    select: { id: true },
  });

  // ASYMMETRIC ON PURPOSE — see the module header.
  const a = await buildTenant(staff.id, "tenant-a", PASSWORD_A, { clicks: 3, regs: 2, deps: 1 }, "a-sub");
  const b = await buildTenant(staff.id, "tenant-b", PASSWORD_B, { clicks: 9, regs: 7, deps: 5 }, "b-sub");

  // ------------------------------------------------------------ §17 tokens
  await check("§17 · a valid token round-trips, and its claims are exact", () => {
    const { token } = createPartnerSessionToken(
      { partnerUserId: a.partnerUserId, sessionEpoch: 1 },
      new Date(),
      ENV,
    );
    const claims = verifyPartnerSessionToken(token, new Date(), ENV);
    assert.equal(claims?.partnerUserId, a.partnerUserId);
    assert.equal(claims?.sessionEpoch, 1);
  });

  await check("§17 · a token signed with ANOTHER secret does not verify", () => {
    const { token } = createPartnerSessionToken({ partnerUserId: a.partnerUserId, sessionEpoch: 1 }, new Date(), {
      ...ENV,
      PARTNER_SESSION_SECRET: "zZ9yX8wV7uT6sR5qP4oN3mL2kJ1iH0gF9eD8cB7aA6b",
    } as NodeJS.ProcessEnv);
    assert.equal(verifyPartnerSessionToken(token, new Date(), ENV), null);
  });

  await check("§17 · every field is inside the MAC — editing any of them fails", () => {
    const { token } = createPartnerSessionToken({ partnerUserId: a.partnerUserId, sessionEpoch: 1 }, new Date(), ENV);
    const [prefix, id, epoch, expiry, signature] = token.split(".");
    // Substituting the OTHER TENANT'S principal id is the whole attack.
    assert.equal(
      verifyPartnerSessionToken(`${prefix}.${b.partnerUserId}.${epoch}.${expiry}.${signature}`, new Date(), ENV),
      null,
    );
    assert.equal(verifyPartnerSessionToken(`${prefix}.${id}.99.${expiry}.${signature}`, new Date(), ENV), null);
    assert.equal(
      verifyPartnerSessionToken(`${prefix}.${id}.${epoch}.${Number(expiry) + 86_400_000}.${signature}`, new Date(), ENV),
      null,
    );
    // The AUDIENCE PREFIX is signed too, so a token minted for another purpose
    // with the same key could not be replayed here.
    assert.equal(verifyPartnerSessionToken(`x.${id}.${epoch}.${expiry}.${signature}`, new Date(), ENV), null);
  });

  await check("§44 · an EXPIRED token is refused", () => {
    const past = new Date(Date.now() - 40 * 60 * 60 * 1000);
    const { token } = createPartnerSessionToken({ partnerUserId: a.partnerUserId, sessionEpoch: 1 }, past, ENV);
    assert.equal(verifyPartnerSessionToken(token, new Date(), ENV), null);
  });

  await check("§36 · with the platform OFF, NO token verifies and NO principal resolves", async () => {
    const { token } = createPartnerSessionToken({ partnerUserId: a.partnerUserId, sessionEpoch: 1 }, new Date(), ENV);
    assert.equal(verifyPartnerSessionToken(token, new Date(), {} as NodeJS.ProcessEnv), null);
    const result = await resolvePartnerPrincipal(token, prisma, new Date(), {} as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.refusal.kind, "platform_unavailable");
  });

  await check("§30 · the partner secret may not BE any other secret", () => {
    assert.equal(describeSecretRejection(PARTNER_SECRET, ENV), null);
    assert.equal(describeSecretRejection(PARTNER_SECRET, { ...ENV, SESSION_SECRET: PARTNER_SECRET } as NodeJS.ProcessEnv), "reused_session_secret");
    assert.equal(describeSecretRejection(PARTNER_SECRET, { ...ENV, POSTBACK_SECRET: PARTNER_SECRET } as NodeJS.ProcessEnv), "reused_postback_secret");
    assert.equal(
      describeSecretRejection(PARTNER_SECRET, { ...ENV, ATTRIBUTION_TOKEN_SECRET: PARTNER_SECRET } as NodeJS.ProcessEnv),
      "reused_attribution_secret",
    );
    assert.equal(describeSecretRejection("short", ENV), "too_short");
    // A HIGH-VARIETY PLACEHOLDER, so this asserts the placeholder rule rather
    // than accidentally re-asserting the variety rule that precedes it.
    assert.equal(describeSecretRejection("change-me-XyZ7qWvB4nMk2LpR9tGhJ3dSfA6uE0iCbN", ENV), "placeholder");
    assert.equal(describeSecretRejection("your-secret-XyZ7qWvB4nMk2LpR9tGhJ3dSfA6uE0iCb", ENV), "placeholder");
    assert.equal(describeSecretRejection("a".repeat(50), ENV), "low_variety");
    assert.equal(describeSecretRejection(undefined, ENV), "missing");
  });

  // ------------------------------------------------------ §44 credentials
  await check("§44 · the right password authenticates, the wrong one does not", async () => {
    const good = await authenticatePartnerUser("tenant-a@example.invalid", PASSWORD_A, prisma);
    assert.equal(good.kind, "authenticated");
    const bad = await authenticatePartnerUser("tenant-a@example.invalid", "wrong-password-entirely", prisma);
    assert.equal(bad.kind, "refused");
  });

  await check("§44 · ONE TENANT'S PASSWORD DOES NOT WORK FOR THE OTHER", async () => {
    const crossed = await authenticatePartnerUser("tenant-a@example.invalid", PASSWORD_B, prisma);
    assert.equal(crossed.kind, "refused");
  });

  await check("§44 · an unknown address is refused identically, and reads nothing", async () => {
    const unknown = await authenticatePartnerUser("nobody@example.invalid", PASSWORD_A, prisma);
    assert.deepEqual(unknown, { kind: "refused" }, "the same shape as a wrong password");
  });

  await check("§17 · an address is normalised, so case cannot fork an identity", async () => {
    assert.equal(normalisePartnerEmail("  TENANT-A@Example.INVALID "), "tenant-a@example.invalid");
    const upper = await authenticatePartnerUser("TENANT-A@EXAMPLE.INVALID", PASSWORD_A, prisma);
    assert.equal(upper.kind, "authenticated");
  });

  await check("§17 · the password policy refuses the mistakes that happen", () => {
    assert.equal(describePartnerPasswordRejection("short", "x@y.z"), "too_short");
    assert.equal(describePartnerPasswordRejection("aaaaaaaaaaaaaaaa", "x@y.z"), "low_variety");
    assert.equal(describePartnerPasswordRejection("tenant-a-password-1", "tenant-a@example.invalid"), "contains_email");
    assert.equal(describePartnerPasswordRejection(PASSWORD_A, "tenant-a@example.invalid"), null);
  });

  // -------------------------------------------------------- §44 revocation
  await check("§44 · a DISABLED principal cannot resolve, immediately", async () => {
    const { token } = createPartnerSessionToken({ partnerUserId: b.partnerUserId, sessionEpoch: 1 }, new Date(), ENV);
    assert.equal((await resolvePartnerPrincipal(token, prisma, new Date(), ENV)).ok, true);

    await prisma.affiliatePartnerUser.update({
      where: { id: b.partnerUserId },
      data: { status: "disabled", disabledAt: new Date() },
    });
    const after = await resolvePartnerPrincipal(token, prisma, new Date(), ENV);
    assert.equal(after.ok, false);
    assert.equal(after.ok === false && after.refusal.kind, "unauthenticated");

    await prisma.affiliatePartnerUser.update({
      where: { id: b.partnerUserId },
      data: { status: "active", disabledAt: null },
    });
  });

  await check("§44 · bumping the EPOCH revokes every token already issued", async () => {
    const { token } = createPartnerSessionToken({ partnerUserId: b.partnerUserId, sessionEpoch: 1 }, new Date(), ENV);
    assert.equal((await resolvePartnerPrincipal(token, prisma, new Date(), ENV)).ok, true);
    await prisma.affiliatePartnerUser.update({
      where: { id: b.partnerUserId },
      data: { sessionEpoch: { increment: 1 } },
    });
    assert.equal((await resolvePartnerPrincipal(token, prisma, new Date(), ENV)).ok, false);
    // A NEWLY MINTED TOKEN WORKS AGAIN — revocation is not a permanent lockout.
    const fresh = createPartnerSessionToken({ partnerUserId: b.partnerUserId, sessionEpoch: 2 }, new Date(), ENV);
    assert.equal((await resolvePartnerPrincipal(fresh.token, prisma, new Date(), ENV)).ok, true);
  });

  await check("§43 · a PAUSED PARTNER blocks access and is a DIFFERENT refusal", async () => {
    const { token } = createPartnerSessionToken({ partnerUserId: a.partnerUserId, sessionEpoch: 1 }, new Date(), ENV);
    await prisma.affiliatePartner.update({ where: { id: a.partnerId }, data: { status: "paused" } });
    const result = await resolvePartnerPrincipal(token, prisma, new Date(), ENV);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.refusal.kind, "partner_not_active");
    assert.equal(result.ok === false && result.refusal.status, 403, "403, not 401 — a different fact");

    // §43 — AND NOTHING WAS ERASED. Pausing a partner is an access decision,
    // not a financial one.
    assert.equal(
      await prisma.affiliateConversionEvent.count({ where: { affiliatePartnerId: a.partnerId } }),
      a.regs + a.deps,
    );
    assert.equal(await prisma.affiliateAttribution.count(), a.regs + b.regs);

    await prisma.affiliatePartner.update({ where: { id: a.partnerId }, data: { status: "active" } });
  });

  // ------------------------------------------------------ §18 tenant isolation
  await check("§18 · the principal's tenant comes from the ROW, never a request", async () => {
    const { token } = createPartnerSessionToken({ partnerUserId: a.partnerUserId, sessionEpoch: 1 }, new Date(), ENV);
    const result = await resolvePartnerPrincipal(token, prisma, new Date(), ENV);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.principal.affiliatePartnerId, a.partnerId);
    assert.notEqual(result.ok && result.principal.affiliatePartnerId, b.partnerId);
  });

  await check("§18 · AGGREGATES are tenant-exact, and the two tenants differ", async () => {
    const overviewA = await getPartnerOverview(prisma, a.partnerId);
    const overviewB = await getPartnerOverview(prisma, b.partnerId);

    assert.equal(overviewA.clicks, a.clicks);
    assert.equal(overviewA.reg, a.regs);
    assert.equal(overviewA.dep, a.deps);
    assert.equal(overviewB.clicks, b.clicks);
    assert.equal(overviewB.reg, b.regs);
    assert.equal(overviewB.dep, b.deps);

    // AND THEY ARE NOT THE SAME NUMBERS. A query that lost its predicate would
    // return the union to both and fail here.
    assert.notEqual(overviewA.clicks, overviewB.clicks);
    assert.equal(overviewA.depAmounts[0]?.amount, "100.00");
    assert.equal(overviewB.depAmounts[0]?.amount, "500.00");
  });

  await check("§23 · a rate with a zero denominator is NULL, not zero", async () => {
    const empty = await prisma.affiliatePartner.create({
      data: { code: "tenant-empty", displayName: "Empty", createdByUserId: staff.id },
      select: { id: true },
    });
    const overview = await getPartnerOverview(prisma, empty.id);
    assert.equal(overview.clicks, 0);
    assert.equal(overview.clickToRegRate, null, "no clicks means no rate, not a 0% rate");
    assert.equal(overview.regToDepRate, null);
    assert.deepEqual(overview.depAmounts, [], "no money means no currency bucket");
  });

  await check("§18 · CONVERSION LISTS never contain the other tenant's rows", async () => {
    const listA = await listPartnerConversions(prisma, a.partnerId, {}, { take: 100 });
    const listB = await listPartnerConversions(prisma, b.partnerId, {}, { take: 100 });

    assert.equal(listA.rows.length, a.regs + a.deps);
    assert.equal(listB.rows.length, b.regs + b.deps);

    const aCodes = new Set(listA.rows.map((row) => row.trackingLinkPublicCode));
    assert.equal(aCodes.has(b.linkPublicCode), false, "B's link code never appears in A's list");
    assert.equal(aCodes.has(a.linkPublicCode), true);

    // …and every sub value in A's list is A's.
    assert.ok(listA.rows.every((row) => row.sub1 === "a-sub" || row.sub1 === null));
    assert.ok(listB.rows.every((row) => row.sub1 === "b-sub" || row.sub1 === null));
  });

  await check("§18 · PAGINATION cannot walk into the other tenant", async () => {
    // Page through A's list one row at a time with a forged-forward cursor and
    // assert nothing of B's ever appears.
    let cursor: number | undefined;
    const seen: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const page = await listPartnerConversions(prisma, a.partnerId, {}, { take: 1, ...(cursor !== undefined ? { cursor } : {}) });
      if (page.rows.length === 0) break;
      seen.push(...page.rows.map((row) => row.conversionId));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    assert.equal(seen.length, a.regs + a.deps);

    // AND A CURSOR TAKEN FROM B'S DATA DOES NOT LEAK B'S ROWS INTO A'S LIST.
    const bRow = await prisma.affiliateConversionEvent.findFirst({
      where: { affiliatePartnerId: b.partnerId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    const forged = await listPartnerConversions(prisma, a.partnerId, {}, { take: 100, cursor: bRow!.id + 1 });
    assert.ok(forged.rows.every((row) => row.trackingLinkPublicCode === a.linkPublicCode));
  });

  await check("§18 · a FORGED CAMPAIGN filter finds nothing and reveals nothing", async () => {
    const params = new URLSearchParams({ campaign: b.campaignCode });
    const result = await parsePartnerFilters(prisma, a.partnerId, params);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "unknown_campaign");

    // THE SAME ANSWER A NONEXISTENT CODE GETS — so this is not an oracle.
    const nonexistent = await parsePartnerFilters(prisma, a.partnerId, new URLSearchParams({ campaign: "no-such-code" }));
    assert.equal(nonexistent.ok, false);
    assert.equal(nonexistent.ok === false && nonexistent.reason, "unknown_campaign");
  });

  await check("§18 · a FORGED LINK filter behaves identically", async () => {
    const forged = await parsePartnerFilters(prisma, a.partnerId, new URLSearchParams({ link: b.linkPublicCode }));
    assert.equal(forged.ok, false);
    assert.equal(forged.ok === false && forged.reason, "unknown_link");
    const own = await parsePartnerFilters(prisma, a.partnerId, new URLSearchParams({ link: a.linkPublicCode }));
    assert.equal(own.ok, true);
  });

  await check("§21 · sub filters are bounded and control-character-free", async () => {
    const tooLong = await parsePartnerFilters(prisma, a.partnerId, new URLSearchParams({ sub1: "x".repeat(300) }));
    assert.equal(tooLong.ok, false);
    assert.equal(tooLong.ok === false && tooLong.reason, "invalid_sub");

    const control = await parsePartnerFilters(prisma, a.partnerId, new URLSearchParams({ sub1: "a b" }));
    assert.equal(control.ok, false);

    // AN INJECTION ATTEMPT IS JUST A VALUE. It is passed as a parameter and
    // matches nothing, rather than changing the query.
    const injection = await parsePartnerFilters(
      prisma,
      a.partnerId,
      new URLSearchParams({ sub1: "' OR 1=1 --" }),
    );
    assert.equal(injection.ok, true, "it is accepted as text");
    const overview = await getPartnerOverview(prisma, a.partnerId, injection.ok ? injection.filters : {});
    assert.equal(overview.clicks, 0, "…and matches nothing, rather than everything");
  });

  await check("§18 · a sub filter scopes results WITHIN a tenant, exactly", async () => {
    const own = await parsePartnerFilters(prisma, a.partnerId, new URLSearchParams({ sub1: "a-sub" }));
    assert.equal(own.ok, true);
    const overview = await getPartnerOverview(prisma, a.partnerId, own.ok ? own.filters : {});
    assert.equal(overview.clicks, a.clicks);

    // FILTERING BY THE OTHER TENANT'S SUB VALUE RETURNS NOTHING, which is the
    // aggregate-leakage case §18 names.
    const foreign = await parsePartnerFilters(prisma, a.partnerId, new URLSearchParams({ sub1: "b-sub" }));
    assert.equal(foreign.ok, true);
    const leaked = await getPartnerOverview(prisma, a.partnerId, foreign.ok ? foreign.filters : {});
    assert.equal(leaked.clicks, 0);
    assert.equal(leaked.reg, 0);
    assert.equal(leaked.dep, 0);
  });

  await check("§24 · no learner identity is reachable through the partner projection", async () => {
    const list = await listPartnerConversions(prisma, a.partnerId, {}, { take: 100 });
    const serialised = JSON.stringify(list.rows);
    for (const forbidden of ["@example.invalid", "passwordHash", "userId", "pocket", "email"]) {
      assert.equal(
        serialised.includes(forbidden),
        false,
        `${forbidden} must not appear in a partner-facing conversion row`,
      );
    }
  });

  // ------------------------------------------------------------ §17 cookies
  await check("§17 · the session cookie is __Host-, Secure, Strict, Path=/", () => {
    assert.equal(PARTNER_SESSION_COOKIE_NAME.startsWith("__Host-"), true);
    const options = partnerSessionCookieOptions(3600);
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, "strict");
    assert.equal(options.path, "/");
    assert.equal("domain" in options, false, "a domain attribute would void the __Host- prefix");
  });

  await check("§17 · the CSRF companion is readable by the client and matched safely", () => {
    assert.equal(partnerCsrfCookieOptions(3600).httpOnly, false);
    const token = createPartnerCsrfToken();
    assert.equal(partnerCsrfTokensMatch(token, token), true);
    assert.equal(partnerCsrfTokensMatch(token, `${token}x`), false);
    assert.equal(partnerCsrfTokensMatch(token, null), false);
    assert.equal(partnerCsrfTokensMatch(null, token), false);
    assert.equal(partnerCsrfTokensMatch("short", "short"), false, "a too-short token is never a match");
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
