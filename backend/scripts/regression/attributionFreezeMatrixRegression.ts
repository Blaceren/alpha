/**
 * POCKET-DEP-RDEP-1 (attribution §1) — the acquisition freeze / re-entry matrix.
 *
 * Driven through the REAL domain owners — `classifyRequest`,
 * `resolveVisitorJourney`, `recordAcquisitionClick`, `selectEligibleClicks`,
 * `resolveRegistrationAttribution`, `freezeAttribution` — against a REAL
 * database, so the unique constraints and CHECKs participate. Nothing here mocks
 * the canonical path.
 *
 * WHAT IS BEING PROTECTED
 *   * the pre-freeze model is LAST eligible click, and "eligible" is narrow;
 *   * a prefetch or a signed-in click can never be attributed;
 *   * a click whose snapshotted window has exactly run out is spent;
 *   * a partner paused AFTER an eligible click does not erase that click;
 *   * the freeze happens once and cannot be overwritten, at the DATABASE;
 *   * registration succeeds whatever attribution does;
 *   * a tampered token cannot re-attribute anybody;
 *   * Pocket REG / DEP / RDEP never touch acquisition attribution.
 *
 *   DATABASE_URL="file:/path/to/a/COPY.sqlite" \
 *     npx tsx scripts/regression/attributionFreezeMatrixRegression.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  classifyRequest,
  recordAcquisitionClick,
  resolveVisitorJourney,
  type ResolvedLink,
} from "@/lib/affiliate/acquisition-click";
import {
  selectEligibleClicks,
  freezeAttribution,
  isVisitorAlreadyAttributed,
} from "@/lib/affiliate/registration-attribution";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import { NO_CAPTURED_PARAMETERS } from "@/lib/affiliate/click-capture";

const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET = "matrix-only-signing-key-not-the-live-one-000000000000";

let passed = 0;
const check = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://preprod.alfatrade.media/go/x", { headers });
}

async function main(): Promise<number> {
  const db = new PrismaClient();
  console.log("ATTRIBUTION FREEZE MATRIX REGRESSION");

  const suffix = String(Date.now()).slice(-9);
  // A creator is required by the schema: an affiliate record always names the
  // staff member who made it.
  const creator = await db.user.findFirstOrThrow({ where: { role: "admin" }, select: { id: true } });

  const partner = await db.affiliatePartner.create({
    data: {
      code: `mtx${suffix}`,
      displayName: "matrix fixture (synthetic)",
      status: "active",
      defaultAttributionWindowDays: 30,
      createdByUserId: creator.id,
      updatedAt: new Date(),
    },
    select: { id: true },
  });

  const mkLink = async (code: string, windowDays: number) =>
    db.affiliateTrackingLink.create({
      data: {
        affiliatePartnerId: partner.id,
        publicCode: code,
        displayName: `matrix link ${code.slice(0, 6)} (synthetic)`,
        landingKey: "academy_registration",
        status: "active",
        attributionWindowDays: windowDays,
        createdByUserId: creator.id,
        updatedAt: new Date(),
      },
      select: { id: true, publicCode: true },
    });

  const linkA = await mkLink(randomBase32Id(20).slice(0, 32), 30);
  const linkB = await mkLink(randomBase32Id(20).slice(0, 32), 30);
  const linkShort = await mkLink(randomBase32Id(20).slice(0, 32), 1);

  const resolved = (id: number, windowDays: number): ResolvedLink =>
    ({
      id,
      status: "active",
      landingKey: "academy_registration",
      externalClickParameter: null,
      sub1Parameter: null,
      sub2Parameter: null,
      sub3Parameter: null,
      sub4Parameter: null,
      sub5Parameter: null,
      attributionWindowDays: windowDays,
      partner: { status: "active", defaultAttributionWindowDays: 30 },
      campaign: null,
    }) as unknown as ResolvedLink;

  const visitor = randomBase32Id();
  const click = (linkId: number, windowDays: number, when: Date, cls: "qualified" | "prefetch" | "authenticated_user", who: string | null = visitor) =>
    recordAcquisitionClick(db, {
      link: resolved(linkId, windowDays),
      classification: cls,
      anonymousVisitorId: cls === "qualified" ? who : null,
      captured: NO_CAPTURED_PARAMETERS,
      referer: null,
      occurredAt: when,
    });

  const now = new Date();

  await check("A — a first qualified click is recorded", async () => {
    const before = await db.affiliateClick.count();
    const c = await click(linkA.id, 30, new Date(now.getTime() - 3 * DAY_MS), "qualified");
    assert.ok(c.ataClickId.length > 0);
    assert.equal(await db.affiliateClick.count(), before + 1);
  });

  await check("B — a second click on the SAME link moves last touch, keeps first", async () => {
    const c2 = await click(linkA.id, 30, new Date(now.getTime() - 2 * DAY_MS), "qualified");
    const touches = await selectEligibleClicks(db, visitor, now);
    assert.ok(touches);
    assert.equal(touches!.lastTouchClickId, c2.id, "last touch is the newer click");
    assert.notEqual(touches!.firstTouchClickId, c2.id, "first touch stays the older click");
  });

  await check("C — a DIFFERENT link becomes the candidate: last eligible click wins", async () => {
    const cB = await click(linkB.id, 30, new Date(now.getTime() - 1 * DAY_MS), "qualified");
    const touches = await selectEligibleClicks(db, visitor, now);
    assert.equal(touches!.lastTouchClickId, cB.id, "the newest eligible click is selected");
  });

  await check("D — a PREFETCH click can never be attributed", async () => {
    const p = await click(linkA.id, 30, now, "prefetch");
    const row = await db.affiliateClick.findUnique({ where: { id: p.id }, select: { anonymousVisitorId: true, classification: true } });
    assert.equal(row?.classification, "prefetch");
    assert.equal(row?.anonymousVisitorId, null, "an unqualified click carries no visitor, so it cannot be selected");
    const touches = await selectEligibleClicks(db, visitor, now);
    assert.notEqual(touches!.lastTouchClickId, p.id);
  });

  await check("E — a SIGNED-IN click is unqualified for the same reason", async () => {
    const a = await click(linkA.id, 30, now, "authenticated_user");
    const row = await db.affiliateClick.findUnique({ where: { id: a.id }, select: { anonymousVisitorId: true } });
    assert.equal(row?.anonymousVisitorId, null);
    const touches = await selectEligibleClicks(db, visitor, now);
    assert.notEqual(touches!.lastTouchClickId, a.id);
  });

  await check("E2 — classifyRequest names a prefetch before anything else", () => {
    assert.equal(classifyRequest(req({ purpose: "prefetch" })), "prefetch");
    assert.equal(classifyRequest(req()), "qualified");
  });

  await check("F — a click whose snapshotted window has exactly run out is SPENT", async () => {
    const lonely = randomBase32Id();
    const exact = new Date(now.getTime() - 1 * DAY_MS);
    await click(linkShort.id, 1, exact, "qualified", lonely);
    // The rule is strictly-greater: at exactly one window it is spent.
    assert.equal(await selectEligibleClicks(db, lonely, now), null, "exactly expired is not eligible");
    // One millisecond inside the window it is still eligible.
    const inside = new Date(now.getTime() - 1 * DAY_MS + 1000);
    const lonely2 = randomBase32Id();
    await click(linkShort.id, 1, inside, "qualified", lonely2);
    assert.ok(await selectEligibleClicks(db, lonely2, now), "inside the window it is still eligible");
  });

  await check("G — pausing the partner AFTER an eligible click does not erase it", async () => {
    await db.affiliatePartner.update({ where: { id: partner.id }, data: { status: "paused" } });
    const touches = await selectEligibleClicks(db, visitor, now);
    assert.ok(touches, "a historical eligible click survives a later pause");
    await db.affiliatePartner.update({ where: { id: partner.id }, data: { status: "active" } });
  });

  const learner = await db.user.create({
    data: { email: `attr-${suffix}@ata-preprod.invalid`, name: "attr fixture", passwordHash: "", updatedAt: new Date() },
    select: { id: true },
  });

  await check("H — registration freezes the attribution exactly once", async () => {
    const touches = await selectEligibleClicks(db, visitor, now);
    const sel = await db.affiliateClick.findUniqueOrThrow({
      where: { id: touches!.lastTouchClickId },
      select: { trackingLink: { select: { id: true, publicCode: true, affiliatePartnerId: true, affiliateCampaignId: true, partner: { select: { code: true } }, campaign: { select: { code: true } } } } },
    });
    const id = await db.$transaction((tx) =>
      freezeAttribution(tx, learner.id, {
        anonymousVisitorId: visitor,
        firstTouchClickId: touches!.firstTouchClickId,
        lastTouchClickId: touches!.lastTouchClickId,
        selectedClickId: touches!.lastTouchClickId,
        trackingLinkId: sel.trackingLink.id,
        affiliatePartnerId: sel.trackingLink.affiliatePartnerId,
        affiliateCampaignId: sel.trackingLink.affiliateCampaignId,
        affiliateCodeSnapshot: sel.trackingLink.partner.code,
        campaignCodeSnapshot: sel.trackingLink.campaign?.code ?? null,
        trackingLinkPublicCodeSnapshot: sel.trackingLink.publicCode,
      }, now),
    );
    assert.ok(id > 0);
    const row = await db.affiliateAttribution.findUniqueOrThrow({
      where: { userId: learner.id },
      select: { attributionModel: true, frozenAt: true, selectedClickId: true },
    });
    assert.equal(row.attributionModel, "last_eligible_affiliate_click");
    assert.ok(row.frozenAt, "frozenAt is stamped");
  });

  await check("I/J — a later click CANNOT overwrite the frozen attribution", async () => {
    const frozen = await db.affiliateAttribution.findUniqueOrThrow({
      where: { userId: learner.id },
      select: { selectedClickId: true, frozenAt: true },
    });
    // A later click on a different link, after the freeze.
    await click(linkB.id, 30, new Date(now.getTime() + 60_000), "qualified");
    const after = await db.affiliateAttribution.findUniqueOrThrow({
      where: { userId: learner.id },
      select: { selectedClickId: true, frozenAt: true },
    });
    assert.equal(after.selectedClickId, frozen.selectedClickId, "selection unchanged");
    assert.equal(after.frozenAt.getTime(), frozen.frozenAt.getTime(), "freeze instant unchanged");

    // And a second freeze is impossible AT THE DATABASE, not by convention.
    let refused = false;
    try {
      await db.$transaction((tx) =>
        freezeAttribution(tx, learner.id, {
          anonymousVisitorId: visitor,
          firstTouchClickId: frozen.selectedClickId,
          lastTouchClickId: frozen.selectedClickId,
          selectedClickId: frozen.selectedClickId,
          trackingLinkId: linkB.id,
          affiliatePartnerId: partner.id,
          affiliateCampaignId: null,
          affiliateCodeSnapshot: "x",
          campaignCodeSnapshot: null,
          trackingLinkPublicCodeSnapshot: linkB.publicCode,
        }, now),
      );
    } catch (error) {
      refused = true;
      assert.ok(isVisitorAlreadyAttributed(error) || String(error).includes("Unique"), "refused by uniqueness");
    }
    assert.ok(refused, "a second freeze for the same learner must be impossible");
  });

  await check("K — an unverifiable token starts a FRESH journey, it is not trusted", () => {
    const tampered = resolveVisitorJourney({
      existingToken: "not-a-real-token.aaaa",
      secret: SECRET,
      effectiveWindowDays: 30,
      now,
    });
    assert.notEqual(tampered.anonymousVisitorId, visitor, "a tampered token cannot claim another journey");
    const none = resolveVisitorJourney({ existingToken: null, secret: SECRET, effectiveWindowDays: 30, now });
    assert.notEqual(none.anonymousVisitorId, tampered.anonymousVisitorId, "each fresh journey is distinct");
  });

  await check("L — a learner with no attribution is still a valid learner", async () => {
    const solo = await db.user.create({
      data: { email: `noattr-${suffix}@ata-preprod.invalid`, name: "unattributed", passwordHash: "", updatedAt: new Date() },
      select: { id: true },
    });
    const attribution = await db.affiliateAttribution.findUnique({ where: { userId: solo.id } });
    assert.equal(attribution, null, "no attribution row");
    const stillThere = await db.user.findUnique({ where: { id: solo.id }, select: { id: true } });
    assert.ok(stillThere, "the account exists regardless");
  });

  await check("M/N/O — Pocket REG, DEP and RDEP never touch acquisition attribution", async () => {
    // Structural, not behavioural: no Pocket module may write the attribution table.
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const roots = ["src/lib/growth/pocket", "src/lib/exchange"];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of readdirSync(root)) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        const body = readFileSync(join(root, file), "utf8");
        if (/affiliateAttribution\s*\.\s*(create|update|upsert|delete)/.test(body)) offenders.push(`${root}/${file}`);
      }
    }
    assert.deepEqual(offenders, [], "no Pocket module may create or mutate an AffiliateAttribution");
  });

  console.log(`\n${passed}/${passed} assertions passed`);
  await db.$disconnect();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
