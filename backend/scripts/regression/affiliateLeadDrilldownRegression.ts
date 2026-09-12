/**
 * AFD-5B2B — affiliate lead drilldown: population, identity, redaction, journey
 * state, acquisition, timeline, filters, cursors and query safety.
 *
 * WHAT THIS SUITE IS. Everything provable without an HTTP server, run against a
 * SYNTHETIC database built from the repository's own migrations. No live port is
 * contacted, no live database is opened, no live secret is read, and every
 * fixture below is invented here. The authorization contract, the CSRF contract,
 * the audit row and the real route wiring are proven separately by
 * `affiliateLeadDrilldownIsolatedE2E.ts`.
 *
 * THE CLOCK IS ALWAYS FROZEN. Every case passes an explicit `now`, so a suite
 * that runs at 23:59:59 Moscow cannot produce a different answer from one that
 * runs at 00:00:01.
 *
 * THE FIXTURE IS A CAST OF LEADS, each carrying exactly one lesson:
 *
 *   A  attributed, three-touch journey ending in an immediate confirmed deposit
 *   B  attributed, deposit that arrived BEFORE the registration that named it,
 *      then reconciled — the only shape that proves the pending step is real
 *   C  attributed, Pocket registered, deposit quarantined and NEVER counted
 *   D  DIRECT registration that still reached a confirmed deposit
 *   E  Academy registration and nothing else
 *   F  Pocket registered with no deposit at all
 *   G  a second academy_registration row — the malformed-integrity case
 *   H  a deposit that WAS counted and was later quarantined by a divergent
 *      redelivery: the case that forces journey stage and deposit state apart
 *   P  a deposit still pending although the identity binding already exists
 *   S  a same-click journey, where first, last and selected are one occurrence
 *
 * Two accounts are deliberately NOT leads: a staff member and a learner with no
 * conversion event. Neither may ever appear in a page.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { localWallClockToUtc } from "../../src/lib/analytics/business-time";
import { maskEmail } from "../../src/lib/crm/users";
import { canRevealLeadPii, STAFF_ROLE_PERMISSIONS } from "../../src/lib/crm/roles";
import { buildDataAvailability } from "../../src/lib/analytics/availability";
import { buildCohortAvailability } from "../../src/lib/analytics/cohort-availability";
import {
  LEAD_ID_PATTERN,
  normalizeForMasking,
  parseLeadId,
  redactedIdentity,
  revealedIdentity,
  toLeadId,
} from "../../src/lib/leads/lead-identity";
import {
  deriveLeadState,
  LEAD_DEPOSIT_STATES,
  LEAD_JOURNEY_STAGES,
} from "../../src/lib/leads/lead-state";
import {
  canonicalLeadQuery,
  LEADS_DEFAULT_PAGE_SIZE,
  LEADS_MAX_PAGE_SIZE,
  LEAD_SORTS,
  parseLeadListQuery,
} from "../../src/lib/leads/lead-request";
import {
  cursorFingerprint,
  decodeLeadCursor,
  encodeLeadCursor,
} from "../../src/lib/leads/lead-cursor";
import { loadLeadByEventId, loadLeadFacts, loadLeadKeys } from "../../src/lib/leads/lead-queries";
import { buildLeadDetail, buildLeadListRow } from "../../src/lib/leads/lead-dto";
import { buildLeadDataAvailability } from "../../src/lib/leads/lead-availability";
import { LEAD_TIMELINE_MAX_ITEMS } from "../../src/lib/leads/lead-timeline";
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

const dbPath = path.join(os.tmpdir(), `ata-afd5b2b-leads-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const projectRoot = path.resolve(__dirname, "../..");
const MSK = "Europe/Moscow";

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

/** Pocket player ids are digits, 1..19 long, with no leading zero. */
let playerSequence = 700000;
function playerId(): string {
  playerSequence += 1;
  return String(playerSequence);
}

function msk(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return localWallClockToUtc({ year: y, month: m, day: d, hour: h, minute: min, second: s }, MSK);
}

/** The frozen report clock. Every fixture instant is in its past. */
const NOW = msk(2027, 1, 15, 12, 0, 0);

const params = (query: string) => new URLSearchParams(query);
const parse = (query: string) => parseLeadListQuery(params(query), MSK, NOW);

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

  /* ------------------------------------------------------- affiliate tree */

  const staffUser = await prisma.user.create({
    data: {
      email: "afd5b2b-fixture-staff@example.invalid",
      name: "Fixture Staff",
      role: "admin",
      passwordHash: "x",
    },
  });

  const alpha = await prisma.affiliatePartner.create({
    data: { code: "alpha", displayName: "Alpha", createdByUserId: staffUser.id, status: "active" },
  });
  // Archived on purpose: an archived affiliate still acquired its learners, and
  // history must remain filterable after somebody tidied the configuration up.
  const beta = await prisma.affiliatePartner.create({
    data: {
      code: "beta",
      displayName: "Beta",
      createdByUserId: staffUser.id,
      status: "archived",
      archivedAt: new Date(),
    },
  });
  const alphaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: alpha.id,
      code: "alpha-one",
      displayName: "Alpha One",
      createdByUserId: staffUser.id,
    },
  });
  const betaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: beta.id,
      code: "beta-one",
      displayName: "Beta One",
      createdByUserId: staffUser.id,
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
      createdByUserId: staffUser.id,
    },
  });
  const linkA2 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linkatwo"),
      displayName: "Alpha One B",
      status: "paused",
      createdByUserId: staffUser.id,
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
      createdByUserId: staffUser.id,
    },
  });

  /* ---------------------------------------------------------- fixture API */

  let learnerSequence = 0;

  async function makeClick(linkId: number, occurredAt: Date) {
    return prisma.affiliateClick.create({
      data: {
        ataClickId: id32("c"),
        trackingLinkId: linkId,
        anonymousVisitorId: id32("v"),
        classification: "qualified",
        effectiveAttributionWindowDays: 30,
        occurredAt,
      },
    });
  }

  type Deposit = {
    readonly firstReceivedAt: Date;
    readonly status: "matched" | "conflict" | "pending_identity";
    readonly matchedAt?: Date;
    readonly conflictDetectedAt?: Date;
    readonly conflictCode?:
      | "click_id_mismatch"
      | "amount_mismatch"
      | "identity_owner_mismatch"
      | "click_owner_missing";
    /** Whether AFD-4 also wrote the immutable ledger row. */
    readonly ledgerAt?: Date;
    readonly amount?: string;
    readonly currency?: string | null;
    readonly replayCount?: number;
    /** Attach the provider event to the learner ONLY through the identity. */
    readonly unmatchedOwner?: boolean;
  };

  type Journey = {
    readonly label: string;
    readonly registeredAt: Date;
    readonly touches?: {
      readonly first: { linkId: number; at: Date };
      readonly last?: { linkId: number; at: Date };
      readonly selected?: { linkId: number; at: Date };
    };
    readonly pocketAt?: Date;
    readonly deposit?: Deposit;
    readonly duplicateRegistration?: boolean;
  };

  type Lead = {
    readonly label: string;
    readonly userId: number;
    readonly email: string;
    readonly name: string;
    readonly eventId: string;
    readonly leadId: string;
  };

  const leads = new Map<string, Lead>();

  async function makeLead(journey: Journey): Promise<Lead> {
    learnerSequence += 1;
    const email = `afd5b2b-${journey.label.toLowerCase()}-${learnerSequence}@example.invalid`;
    const name = `Lead ${journey.label}`;
    const user = await prisma.user.create({
      data: { email, name, role: "user", passwordHash: "x" },
    });

    let attributionId: number | null = null;
    let selectedClickId: number | null = null;
    let snapshot: {
      affiliatePartnerId: number;
      affiliateCampaignId: number | null;
      trackingLinkId: number;
      affiliateCodeSnapshot: string;
      campaignCodeSnapshot: string | null;
      trackingLinkPublicCodeSnapshot: string;
    } | null = null;

    if (journey.touches) {
      const first = await makeClick(journey.touches.first.linkId, journey.touches.first.at);
      const last = journey.touches.last
        ? await makeClick(journey.touches.last.linkId, journey.touches.last.at)
        : first;
      const selected = journey.touches.selected
        ? journey.touches.selected.linkId === journey.touches.last?.linkId &&
          journey.touches.selected.at.getTime() === journey.touches.last?.at.getTime()
          ? last
          : await makeClick(journey.touches.selected.linkId, journey.touches.selected.at)
        : last;

      const attribution = await prisma.affiliateAttribution.create({
        data: {
          userId: user.id,
          anonymousVisitorId: id32("va"),
          firstTouchClickId: first.id,
          lastTouchClickId: last.id,
          selectedClickId: selected.id,
          attributionModel: "last_eligible_affiliate_click",
          selectionReason: "registration_cookie",
          selectedAt: journey.registeredAt,
          frozenAt: journey.registeredAt,
        },
      });
      attributionId = attribution.id;
      selectedClickId = selected.id;

      const link = await prisma.affiliateTrackingLink.findUniqueOrThrow({
        where: { id: selected.trackingLinkId },
        select: {
          id: true,
          affiliatePartnerId: true,
          affiliateCampaignId: true,
          publicCode: true,
          partner: { select: { code: true } },
          campaign: { select: { code: true } },
        },
      });
      snapshot = {
        affiliatePartnerId: link.affiliatePartnerId,
        affiliateCampaignId: link.affiliateCampaignId,
        trackingLinkId: link.id,
        affiliateCodeSnapshot: link.partner.code,
        campaignCodeSnapshot: link.campaign ? link.campaign.code : null,
        trackingLinkPublicCodeSnapshot: link.publicCode,
      };
    }

    const eventId = id32("r");
    await prisma.affiliateConversionEvent.create({
      data: {
        eventId,
        eventType: "academy_registration",
        userId: user.id,
        attributionId,
        selectedClickId,
        ...(snapshot ?? {}),
        sourceOwner: "auth_register",
        sourceEventId: `afd3b2:user:${user.id}`,
        occurredAt: journey.registeredAt,
      },
    });

    // The malformed case: a SECOND registration row for one learner. It is
    // written directly here because no supported path can produce it — the
    // ledger's unique key makes it unreachable through `auth_register`.
    if (journey.duplicateRegistration) {
      await prisma.affiliateConversionEvent.create({
        data: {
          eventId: id32("rd"),
          eventType: "academy_registration",
          userId: user.id,
          sourceOwner: "auth_register",
          sourceEventId: `afd3b2:user:${user.id}:synthetic-duplicate`,
          occurredAt: new Date(journey.registeredAt.getTime() + 1000),
        },
      });
    }

    let player: string | null = null;
    if (journey.pocketAt) {
      player = playerId();
      await prisma.pocketTraderIdentity.create({
        data: {
          userId: user.id,
          pocketUserId: player,
          clickId: id32("pk"),
          source: "registration_postback",
          boundAt: journey.pocketAt,
        },
      });
    }

    if (journey.deposit) {
      const deposit = journey.deposit;
      const amount = deposit.amount ?? "50.00";
      const currency = deposit.currency === undefined ? "USD" : deposit.currency;
      // A deposit that has no trusted identity to hang from also has no player
      // to name, so the fixture mints one; it will simply be unreachable.
      const eventPlayer = player ?? playerId();

      // THE DATABASE DECIDES THE SHAPE, NOT THIS FIXTURE. A CHECK constraint
      // makes `matched` name both a learner and a match instant, and makes
      // `pending_identity` and `conflict` name neither — so a "conflict that
      // kept its match" is unrepresentable and is not something this suite may
      // pretend to build. The counted-then-disputed case is a MATCHED row
      // carrying a conflict code, exactly as `redeliver()` writes it.
      const matched = deposit.status === "matched";
      const providerEvent = await prisma.pocketProviderEvent.create({
        data: {
          eventType: "first_deposit",
          pocketClickId: id32("pc"),
          pocketPlayerId: eventPlayer,
          matchedUserId: matched ? user.id : null,
          normalizedAmount: amount,
          currencyCode: currency,
          currencyStatus: currency === null ? "unspecified" : "configured",
          status: deposit.status,
          firstReceivedAt: deposit.firstReceivedAt,
          lastReceivedAt: deposit.firstReceivedAt,
          replayCount: deposit.replayCount ?? 0,
          ...(matched ? { matchedAt: deposit.matchedAt ?? deposit.firstReceivedAt } : {}),
          ...(deposit.conflictDetectedAt
            ? { conflictDetectedAt: deposit.conflictDetectedAt }
            : {}),
          ...(deposit.conflictCode ? { conflictCode: deposit.conflictCode } : {}),
        },
      });

      if (deposit.ledgerAt) {
        await prisma.affiliateConversionEvent.create({
          data: {
            eventId: id32("fd"),
            eventType: "first_deposit",
            userId: user.id,
            attributionId,
            selectedClickId,
            ...(snapshot ?? {}),
            sourceOwner: "pocket_first_deposit",
            sourceEventId: `pocket:${providerEvent.id}`,
            providerAmount: amount,
            currencyCode: currency,
            currencyStatus: currency === null ? "unspecified" : "configured",
            occurredAt: deposit.ledgerAt,
          },
        });
      }
    }

    const lead: Lead = {
      label: journey.label,
      userId: user.id,
      email,
      name,
      eventId,
      leadId: toLeadId(eventId),
    };
    leads.set(journey.label, lead);
    return lead;
  }

  /* ------------------------------------------------------------- the cast */

  const A = await makeLead({
    label: "A",
    registeredAt: msk(2026, 3, 10, 9),
    touches: {
      first: { linkId: linkA1.id, at: msk(2026, 3, 1, 8) },
      last: { linkId: linkA2.id, at: msk(2026, 3, 9, 8) },
      selected: { linkId: linkA2.id, at: msk(2026, 3, 9, 8) },
    },
    pocketAt: msk(2026, 3, 11, 9),
    deposit: {
      firstReceivedAt: msk(2026, 3, 12, 9),
      status: "matched",
      matchedAt: msk(2026, 3, 12, 9),
      ledgerAt: msk(2026, 3, 12, 9),
    },
  });

  const B = await makeLead({
    label: "B",
    registeredAt: msk(2026, 4, 5, 10),
    touches: { first: { linkId: linkB1.id, at: msk(2026, 4, 1, 10) } },
    // The deposit landed BEFORE the binding that named it, and reconciliation
    // ran a day later. Those three instants are the entire evidence base for
    // the pending step.
    pocketAt: msk(2026, 4, 8, 10),
    deposit: {
      firstReceivedAt: msk(2026, 4, 6, 10),
      status: "matched",
      matchedAt: msk(2026, 4, 8, 10),
      ledgerAt: msk(2026, 4, 8, 10),
    },
  });

  const C = await makeLead({
    label: "C",
    registeredAt: msk(2026, 5, 2, 11),
    touches: { first: { linkId: linkA1.id, at: msk(2026, 5, 1, 11) } },
    pocketAt: msk(2026, 5, 3, 11),
    deposit: {
      firstReceivedAt: msk(2026, 5, 4, 11),
      status: "conflict",
      conflictDetectedAt: msk(2026, 5, 4, 11),
      conflictCode: "identity_owner_mismatch",
      // NEVER matched and NO ledger row: quarantined money counts for nobody.
      unmatchedOwner: true,
    },
  });

  const D = await makeLead({
    label: "D",
    registeredAt: msk(2026, 6, 1, 12),
    pocketAt: msk(2026, 6, 2, 12),
    deposit: {
      firstReceivedAt: msk(2026, 6, 3, 12),
      status: "matched",
      matchedAt: msk(2026, 6, 3, 12),
      ledgerAt: msk(2026, 6, 3, 12),
    },
  });

  const E = await makeLead({ label: "E", registeredAt: msk(2026, 7, 1, 13) });

  const F = await makeLead({
    label: "F",
    registeredAt: msk(2026, 8, 1, 14),
    pocketAt: msk(2026, 8, 2, 14),
  });

  const G = await makeLead({
    label: "G",
    registeredAt: msk(2026, 9, 1, 15),
    duplicateRegistration: true,
  });

  const H = await makeLead({
    label: "H",
    registeredAt: msk(2026, 10, 1, 16),
    touches: { first: { linkId: linkA1.id, at: msk(2026, 9, 30, 16) } },
    pocketAt: msk(2026, 10, 2, 16),
    deposit: {
      firstReceivedAt: msk(2026, 10, 3, 16),
      // Still `matched`. A divergent redelivery flags the disagreement BESIDE
      // the match rather than erasing it, because unmatching would orphan a
      // conversion event that is already canonical and immutable.
      status: "matched",
      matchedAt: msk(2026, 10, 3, 16),
      conflictDetectedAt: msk(2026, 10, 5, 16),
      conflictCode: "amount_mismatch",
      ledgerAt: msk(2026, 10, 3, 16),
      replayCount: 2,
    },
  });

  const P = await makeLead({
    label: "P",
    registeredAt: msk(2026, 11, 1, 17),
    pocketAt: msk(2026, 11, 2, 17),
    deposit: {
      firstReceivedAt: msk(2026, 11, 3, 17),
      status: "pending_identity",
      unmatchedOwner: true,
    },
  });

  const S = await makeLead({
    label: "S",
    registeredAt: msk(2026, 12, 2, 18),
    touches: { first: { linkId: linkA1.id, at: msk(2026, 12, 1, 18) } },
  });

  // Not leads. A staff member and a learner who never passed through the public
  // registration owner, both of which must be invisible to every page.
  const excludedLearner = await prisma.user.create({
    data: {
      email: "afd5b2b-no-conversion@example.invalid",
      name: "No Conversion",
      role: "user",
      passwordHash: "x",
    },
  });

  /* --------------------------------------------------------------- helpers */

  async function page(query: string) {
    const parsed = parse(query);
    const keys = await loadLeadKeys(prisma, parsed);
    const hasMore = keys.length > parsed.limit;
    const kept = hasMore ? keys.slice(0, parsed.limit) : keys;
    const facts = await loadLeadFacts(
      prisma,
      kept.map((key) => key.rowId),
    );
    return { parsed, keys, kept, hasMore, facts, rows: facts.map((f) => buildLeadListRow(f, false)) };
  }

  const labelsOf = (rows: { leadId: string }[]) => {
    const byLeadId = new Map([...leads.values()].map((lead) => [lead.leadId, lead.label]));
    return rows.map((row) => byLeadId.get(row.leadId) ?? "?");
  };

  async function detailOf(lead: Lead) {
    const facts = await loadLeadByEventId(prisma, lead.eventId);
    assert.ok(facts, `no facts for ${lead.label}`);
    return buildLeadDetail(facts!, MSK, false);
  }

  /* ------------------------------------------------- 1. lead population */

  await check("1. an attributed public registration is a lead", async () => {
    const result = await page("");
    assert.ok(labelsOf(result.rows).includes("A"));
  });

  await check("2. a direct public registration is a lead", async () => {
    const result = await page("");
    assert.ok(labelsOf(result.rows).includes("D"));
  });

  await check("3. every fixture lead appears exactly once", async () => {
    const result = await page("limit=100");
    const found = labelsOf(result.rows).filter((label) => label !== "?");
    assert.equal(found.length, leads.size);
    assert.equal(new Set(found).size, leads.size);
  });

  await check("4. a staff account is not a lead", async () => {
    const result = await page("limit=100");
    // The staff member has no academy_registration event, so no leadId can
    // exist for them. Proven by the population count, not by an exclusion list.
    const total = await prisma.affiliateConversionEvent.count({
      where: { eventType: "academy_registration", userId: staffUser.id },
    });
    assert.equal(total, 0);
    assert.equal(result.rows.length, leads.size);
  });

  await check("5. a learner with no academy_registration event is not a lead", async () => {
    const total = await prisma.affiliateConversionEvent.count({
      where: { eventType: "academy_registration", userId: excludedLearner.id },
    });
    assert.equal(total, 0);
    const result = await page("limit=100");
    assert.equal(result.rows.length, leads.size);
  });

  await check("6. a duplicate registration event is flagged, not duplicated", async () => {
    const rows = await prisma.affiliateConversionEvent.findMany({
      where: { eventType: "academy_registration", userId: G.userId },
      select: { id: true, eventId: true },
      orderBy: { id: "asc" },
    });
    assert.equal(rows.length, 2, "the fixture must hold two registration rows");

    // ONE lead, not two: the learner occupies exactly one position in the page.
    const result = await page("limit=100");
    assert.equal(labelsOf(result.rows).filter((label) => label === "G").length, 1);

    // The canonical row is the one written FIRST, and it is the one whose
    // eventId is the lead reference.
    assert.equal(G.eventId, rows[0].eventId);
    const detail = await detailOf(G);
    assert.equal(detail.leadId, toLeadId(rows[0].eventId));

    // The anomaly is reported rather than hidden by the deduplication.
    assert.ok(detail.integrityFlags.includes("duplicate_academy_registration"));

    // The SECOND row's eventId is a real stored value that is not a lead, so it
    // must not become a second reference to the same learner.
    assert.equal(await loadLeadByEventId(prisma, rows[1].eventId), null);
  });

  await check("7. a first_deposit eventId does not resolve as a lead", async () => {
    const fd = await prisma.affiliateConversionEvent.findFirstOrThrow({
      where: { eventType: "first_deposit" },
      select: { eventId: true },
    });
    assert.equal(await loadLeadByEventId(prisma, fd.eventId), null);
  });

  /* -------------------------------------------------- 8. lead identifier */

  await check("8. the lead id is opaque, versioned and stable", async () => {
    assert.match(A.leadId, LEAD_ID_PATTERN);
    assert.equal(A.leadId, `v1_${A.eventId}`);
    const first = await detailOf(A);
    const second = await detailOf(A);
    assert.equal(first.leadId, second.leadId);
  });

  await check("9. the lead id is not the raw User id, email or any provider id", async () => {
    const identity = await prisma.pocketTraderIdentity.findUniqueOrThrow({
      where: { userId: A.userId },
      select: { pocketUserId: true, clickId: true },
    });
    for (const forbidden of [
      String(A.userId),
      A.email,
      A.name,
      identity.pocketUserId,
      identity.clickId,
    ]) {
      assert.ok(!A.leadId.includes(forbidden), `leadId leaked ${forbidden}`);
    }
  });

  await check("10. a tampered, over-long or wrong-version lead id is refused", () => {
    assert.equal(parseLeadId(`v1_${"z".repeat(32)}Z`).kind, "invalid");
    assert.equal(parseLeadId("v1_" + "a".repeat(31)).kind, "invalid");
    assert.equal(parseLeadId("v1_" + "a".repeat(33)).kind, "invalid");
    assert.equal(parseLeadId("a".repeat(32)).kind, "invalid");
    assert.equal(parseLeadId(String(A.userId)).kind, "invalid");
    assert.equal(parseLeadId("x".repeat(5000)).kind, "invalid");
    const future = parseLeadId(`v2_${A.eventId}`);
    assert.equal(future.kind, "invalid");
    assert.equal(future.kind === "invalid" && future.reason, "unsupported_version");
  });

  await check("11. a well-formed but unknown lead id resolves to nothing", async () => {
    assert.equal(await loadLeadByEventId(prisma, "z".repeat(32)), null);
  });

  /* ------------------------------------------------------ 12. redaction */

  await check("12. the list row carries a masked address and no display name", async () => {
    const result = await page("limit=100");
    for (const row of result.rows) {
      assert.equal(row.piiState, "redacted");
      assert.equal(row.displayName, null);
      assert.ok(row.maskedEmail.includes("***"));
    }
    const rowA = result.rows[labelsOf(result.rows).indexOf("A")];
    assert.equal(rowA.maskedEmail, maskEmail(A.email));
    assert.notEqual(rowA.maskedEmail, A.email);
  });

  await check("13. no list response contains a full address or a learner name", async () => {
    const result = await page("limit=100");
    const body = JSON.stringify(result.rows);
    for (const lead of leads.values()) {
      assert.ok(!body.includes(lead.email), `list leaked ${lead.label}'s email`);
      assert.ok(!body.includes(lead.name), `list leaked ${lead.label}'s name`);
    }
  });

  await check("14. no default detail contains a full address or a learner name", async () => {
    for (const lead of leads.values()) {
      const body = JSON.stringify(await detailOf(lead));
      assert.ok(!body.includes(lead.email));
      assert.ok(!body.includes(lead.name));
    }
  });

  await check("15. a one-character local part masks safely", () => {
    assert.equal(maskEmail("a@example.invalid"), "a***@e***.invalid");
    const identity = redactedIdentity("v1_x", "a@example.invalid");
    assert.equal(identity.piiState, "redacted");
    assert.equal(identity.displayName, null);
  });

  await check("16. hidden Unicode is normalized away before masking", () => {
    const sneaky = "n​i­na@ex⁦ample.invalid";
    assert.equal(normalizeForMasking(sneaky), "nina@example.invalid");
    const masked = maskEmail(normalizeForMasking(sneaky));
    assert.equal(masked, "n***@e***.invalid");
    for (const char of ["​", "­", "⁦"]) {
      assert.ok(!masked.includes(char));
    }
  });

  await check("17. the mask is deterministic and carries no recoverable digest", () => {
    assert.equal(maskEmail(A.email), maskEmail(A.email));
    const masked = maskEmail(A.email);
    // Fixed shape, fixed-width asterisks: it encodes neither the length of the
    // local part nor any hash of it.
    assert.match(masked, /^.\*\*\*@.\*\*\*\..+$/);
    assert.ok(masked.length < A.email.length);
  });

  await check("18. the revealed shape carries only the two approved fields", () => {
    const revealed = revealedIdentity("v1_x", A.email, A.name);
    assert.deepEqual(Object.keys(revealed).sort(), [
      "displayName",
      "email",
      "leadId",
      "piiState",
    ]);
    assert.equal(revealed.piiState, "revealed");
  });

  /* ----------------------------------------------------- 19. permissions */

  await check("19. the canonical PII owner is reveal_pii and no permission was added", () => {
    assert.equal(canRevealLeadPii(["reveal_pii"]), true);
    assert.equal(canRevealLeadPii(["view_affiliate_analytics"]), false);
    assert.equal(canRevealLeadPii(["manage_settings"]), false);
    assert.equal(canRevealLeadPii([]), false);
  });

  await check("20. analyst may read leads and may never reveal", () => {
    const analyst = STAFF_ROLE_PERMISSIONS.analyst;
    assert.ok(analyst.includes("view_affiliate_analytics"));
    assert.equal(canRevealLeadPii(analyst), false);
  });

  await check("21. crm_admin holds the reveal permission; the denied roles do not", () => {
    assert.equal(canRevealLeadPii(STAFF_ROLE_PERMISSIONS.crm_admin), true);
    for (const role of ["analyst", "support", "mentor", "moderator", "content_manager", "read_only"] as const) {
      assert.equal(canRevealLeadPii(STAFF_ROLE_PERMISSIONS[role]), false, role);
    }
  });

  await check("22. view_affiliate_analytics does not imply PII and was not broadened", () => {
    // The affiliate READ gate and the PII gate are independent: holding the
    // former alone reveals nothing, which is the whole contract.
    assert.equal(canRevealLeadPii(["view_affiliate_analytics", "export", "view_audit"]), false);
  });

  /* --------------------------------------------------- 23. journey state */

  await check("23. Academy-only reaches exactly the first stage", async () => {
    const detail = await detailOf(E);
    assert.equal(detail.journey.journeyStage, "academy_registered");
    assert.equal(detail.deposit.depositState, "none");
    assert.equal(detail.journey.pocketRegisteredAt, null);
  });

  await check("24. a Pocket registration without a deposit stops at the second stage", async () => {
    const detail = await detailOf(F);
    assert.equal(detail.journey.journeyStage, "pocket_registered");
    assert.equal(detail.deposit.depositState, "none");
    assert.notEqual(detail.journey.pocketRegisteredAt, null);
  });

  await check("25. a confirmed deposit reaches the third stage", async () => {
    const detail = await detailOf(A);
    assert.equal(detail.journey.journeyStage, "first_deposit_confirmed");
    assert.equal(detail.deposit.depositState, "confirmed");
    assert.notEqual(detail.journey.firstDepositConfirmedAt, null);
  });

  await check("26. a still-pending deposit is pending, and the stage does not advance", async () => {
    const detail = await detailOf(P);
    assert.equal(detail.deposit.depositState, "pending_identity");
    assert.equal(detail.journey.journeyStage, "pocket_registered");
    assert.equal(detail.journey.firstDepositConfirmedAt, null);
    assert.ok(detail.integrityFlags.includes("deposit_pending_after_identity_binding"));
  });

  await check("27. a quarantined deposit never counted does not imply a confirmed one", async () => {
    const detail = await detailOf(C);
    assert.equal(detail.deposit.depositState, "conflict");
    assert.equal(detail.journey.journeyStage, "pocket_registered");
    assert.equal(detail.journey.firstDepositConfirmedAt, null);
    assert.equal(detail.deposit.conflictCategory, "identity_owner_mismatch");
  });

  await check("28. a counted deposit quarantined later keeps its stage and reports the conflict", async () => {
    const detail = await detailOf(H);
    // The two dimensions disagree BECAUSE they are two dimensions. A single
    // status field would have to suppress one of these two facts.
    assert.equal(detail.journey.journeyStage, "first_deposit_confirmed");
    assert.equal(detail.deposit.depositState, "conflict");
    assert.equal(detail.deposit.conflictCategory, "amount_mismatch");
    assert.notEqual(detail.journey.firstDepositConfirmedAt, null);
  });

  await check("29. a replay is visible as a boolean and never as an extra deposit", async () => {
    const detail = await detailOf(H);
    assert.equal(detail.deposit.replayObserved, true);
    assert.equal(JSON.stringify(detail).includes("replayCount"), false);
    const clean = await detailOf(A);
    assert.equal(clean.deposit.replayObserved, false);
  });

  await check("30. an untrusted identity source is refused rather than accepted weakly", () => {
    const state = deriveLeadState({
      academyRegisteredAt: msk(2026, 1, 1),
      academyRegistrationCount: 1,
      pocketRegisteredAt: msk(2026, 1, 2),
      // The database CHECK makes this unrepresentable today; the derivation
      // still refuses it, so widening that CHECK cannot silently widen a stage.
      pocketIdentitySource: "manual_backfill",
      firstDepositConfirmedAt: null,
      firstDepositConversionCount: 0,
      providerEventCount: 0,
      providerStatus: null,
      providerFirstReceivedAt: null,
      providerConflictDetectedAt: null,
      providerMatchedAt: null,
    });
    assert.equal(state.journeyStage, "academy_registered");
    assert.equal(state.pocketRegisteredAt, null);
    assert.ok(state.integrityFlags.includes("pocket_identity_untrusted_source"));
  });

  await check("31. a backwards milestone is flagged and never reordered", () => {
    const state = deriveLeadState({
      academyRegisteredAt: msk(2026, 5, 10),
      academyRegistrationCount: 1,
      pocketRegisteredAt: msk(2026, 5, 1),
      pocketIdentitySource: "registration_postback",
      firstDepositConfirmedAt: null,
      firstDepositConversionCount: 0,
      providerEventCount: 0,
      providerStatus: null,
      providerFirstReceivedAt: null,
      providerConflictDetectedAt: null,
      providerMatchedAt: null,
    });
    assert.ok(state.integrityFlags.includes("negative_journey_duration"));
    assert.equal(state.journeyStage, "pocket_registered");
  });

  await check("32. no lead reports a redeposit or a balance", async () => {
    for (const lead of leads.values()) {
      const body = JSON.stringify(await detailOf(lead));
      for (const forbidden of ["redeposit", "balance", "currentBalance"]) {
        assert.ok(!body.toLowerCase().includes(forbidden.toLowerCase()), `${lead.label}: ${forbidden}`);
      }
    }
  });

  /* ------------------------------------------------------- 33. acquisition */

  await check("33. first, last and selected touch come from the frozen attribution", async () => {
    const detail = await detailOf(A);
    assert.equal(detail.acquisition.attributionState, "attributed");
    assert.equal(detail.acquisition.firstTouchAt, msk(2026, 3, 1, 8).toISOString());
    assert.equal(detail.acquisition.lastTouchAt, msk(2026, 3, 9, 8).toISOString());
    assert.equal(detail.acquisition.selectedTouchAt, msk(2026, 3, 9, 8).toISOString());
    assert.equal(detail.acquisition.acquisitionModel, "last_eligible_affiliate_click");
    assert.equal(detail.acquisition.selectionReason, "registration_cookie");
    assert.notEqual(detail.acquisition.frozenAt, null);
  });

  await check("34. first and selected differ when the journey had two clicks", async () => {
    const detail = await detailOf(A);
    assert.notEqual(detail.acquisition.firstTouchAt, detail.acquisition.selectedTouchAt);
  });

  await check("35. one click carrying all three roles yields ONE timeline item", async () => {
    const detail = await detailOf(S);
    const acquisition = detail.timeline.items.filter((item) => item.roles !== null);
    assert.equal(acquisition.length, 1);
    assert.deepEqual(acquisition[0].roles, ["first_touch", "last_touch", "selected"]);
    assert.equal(acquisition[0].eventType, "acquisition_selected");
  });

  await check("36. a two-click journey yields separate first and selected items", async () => {
    const detail = await detailOf(A);
    const acquisition = detail.timeline.items.filter((item) => item.roles !== null);
    assert.equal(acquisition.length, 2);
    assert.deepEqual(acquisition[0].roles, ["first_touch"]);
    assert.deepEqual(acquisition[1].roles, ["last_touch", "selected"]);
    assert.equal(acquisition[1].eventType, "acquisition_selected");
  });

  await check("37. a direct lead is unattributed and gets no synthetic affiliate", async () => {
    const detail = await detailOf(D);
    assert.equal(detail.acquisition.attributionState, "unattributed");
    assert.equal(detail.acquisition.affiliate, null);
    assert.equal(detail.acquisition.campaign, null);
    assert.equal(detail.acquisition.trackingLink, null);
    assert.equal(detail.acquisition.firstTouchAt, null);
    assert.equal(detail.acquisition.selectedTouchAt, null);
    assert.equal(detail.timeline.items.filter((item) => item.roles !== null).length, 0);
  });

  await check("38. an archived affiliate still reports the history it acquired", async () => {
    const detail = await detailOf(B);
    assert.equal(detail.acquisition.attributionState, "attributed");
    assert.equal(detail.acquisition.affiliate?.code, "beta");
    assert.equal(detail.acquisition.campaign?.code, "beta-one");
  });

  await check("39. the acquisition code is the conversion-time snapshot", async () => {
    await prisma.affiliatePartner.update({
      where: { id: alpha.id },
      data: { displayName: "Alpha Renamed" },
    });
    await prisma.affiliateTrackingLink.update({
      where: { id: linkA2.id },
      data: { status: "archived", archivedAt: new Date(), displayName: "Alpha One B (retired)" },
    });

    const detail = await detailOf(A);
    // The CODE is frozen at conversion time; only the human label follows the
    // current row. Archiving the link rewrote no history.
    assert.equal(detail.acquisition.affiliate?.code, "alpha");
    assert.equal(detail.acquisition.affiliate?.displayName, "Alpha Renamed");
    assert.equal(detail.acquisition.trackingLink?.code, linkA2.publicCode);
    assert.equal(detail.acquisition.selectedTouchAt, msk(2026, 3, 9, 8).toISOString());
  });

  await check("40. no acquisition field exposes a click identifier", async () => {
    const clicks = await prisma.affiliateClick.findMany({
      select: { ataClickId: true, anonymousVisitorId: true },
    });
    for (const lead of leads.values()) {
      const body = JSON.stringify(await detailOf(lead));
      for (const click of clicks) {
        assert.ok(!body.includes(click.ataClickId));
        if (click.anonymousVisitorId) assert.ok(!body.includes(click.anonymousVisitorId));
      }
    }
  });

  await check("41. no response exposes a Pocket player or click id", async () => {
    const identities = await prisma.pocketTraderIdentity.findMany({
      select: { pocketUserId: true, clickId: true },
    });
    const providerEvents = await prisma.pocketProviderEvent.findMany({
      select: { pocketClickId: true, pocketPlayerId: true },
    });
    for (const lead of leads.values()) {
      const body = JSON.stringify(await detailOf(lead));
      for (const identity of identities) {
        assert.ok(!body.includes(identity.pocketUserId), `${lead.label}: player id`);
        assert.ok(!body.includes(identity.clickId), `${lead.label}: identity click id`);
      }
      for (const event of providerEvents) {
        assert.ok(!body.includes(event.pocketClickId), `${lead.label}: provider click id`);
        assert.ok(!body.includes(event.pocketPlayerId), `${lead.label}: provider player id`);
      }
    }
  });

  /* --------------------------------------------------------- 42. timeline */

  await check("42. the Academy registration is always on the timeline", async () => {
    for (const lead of leads.values()) {
      const detail = await detailOf(lead);
      const items = detail.timeline.items.filter((i) => i.eventType === "academy_registration");
      assert.equal(items.length, 1, lead.label);
      assert.equal(items[0].sourceCategory, "academy");
    }
  });

  await check("43. a trusted Pocket registration appears once, from boundAt", async () => {
    const detail = await detailOf(F);
    const items = detail.timeline.items.filter((i) => i.eventType === "pocket_registration");
    assert.equal(items.length, 1);
    assert.equal(items[0].occurredAt, msk(2026, 8, 2, 14).toISOString());
    assert.equal(items[0].sourceCategory, "provider_identity");
  });

  await check("44. a deposit matched on arrival gets NO fabricated pending step", async () => {
    const detail = await detailOf(A);
    const pending = detail.timeline.items.filter(
      (i) => i.eventType === "first_deposit_received_pending",
    );
    assert.equal(pending.length, 0);
    const confirmed = detail.timeline.items.filter(
      (i) => i.eventType === "first_deposit_confirmed",
    );
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].state, "confirmed");
  });

  await check("45. a deposit that waited shows pending, then registration, then confirmed", async () => {
    const detail = await detailOf(B);
    const sequence = detail.timeline.items.map((i) => i.eventType);
    const pendingAt = sequence.indexOf("first_deposit_received_pending");
    const pocketAt = sequence.indexOf("pocket_registration");
    const confirmedAt = sequence.indexOf("first_deposit_confirmed");
    assert.ok(pendingAt >= 0 && pocketAt >= 0 && confirmedAt >= 0);
    assert.ok(pendingAt < pocketAt, "pending must precede the binding that resolved it");
    assert.ok(pocketAt <= confirmedAt);
    assert.equal(
      detail.timeline.items[pendingAt].occurredAt,
      msk(2026, 4, 6, 10).toISOString(),
    );
    assert.equal(detail.timeline.items[pendingAt].state, "pending");
  });

  await check("46. a conflict carries its own detection instant", async () => {
    const detail = await detailOf(C);
    const conflict = detail.timeline.items.filter(
      (i) => i.eventType === "first_deposit_conflict_detected",
    );
    assert.equal(conflict.length, 1);
    assert.equal(conflict[0].occurredAt, msk(2026, 5, 4, 11).toISOString());
    assert.equal(conflict[0].state, "conflict");
    assert.equal(
      detail.timeline.items.filter((i) => i.eventType === "first_deposit_confirmed").length,
      0,
    );
  });

  await check("47. a counted-then-quarantined deposit shows BOTH events in order", async () => {
    const detail = await detailOf(H);
    const sequence = detail.timeline.items.map((i) => i.eventType);
    assert.ok(sequence.includes("first_deposit_confirmed"));
    assert.ok(sequence.includes("first_deposit_conflict_detected"));
    assert.ok(
      sequence.indexOf("first_deposit_confirmed") < sequence.indexOf("first_deposit_conflict_detected"),
    );
  });

  await check("48. the timeline is ascending with a deterministic tie breaker", async () => {
    for (const lead of leads.values()) {
      const items = (await detailOf(lead)).timeline.items;
      for (let index = 1; index < items.length; index += 1) {
        const previous = new Date(items[index - 1].occurredAt).getTime();
        const current = new Date(items[index].occurredAt).getTime();
        assert.ok(previous <= current, `${lead.label} is out of order at ${index}`);
      }
      // Byte-identical on a second read: nothing here depends on map ordering,
      // on the clock or on which row the database happened to return first.
      assert.deepEqual(items, (await detailOf(lead)).timeline.items);
    }
  });

  await check("49. every timeline item carries a Moscow wall-clock rendering", async () => {
    const detail = await detailOf(A);
    for (const item of detail.timeline.items) {
      assert.match(item.localOccurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      assert.match(item.titleKey, /^crm\.leads\.timeline\./);
    }
    const registration = detail.timeline.items.find(
      (item) => item.eventType === "academy_registration",
    );
    // 09:00 Moscow wall clock, stated back as 09:00 rather than as UTC.
    assert.equal(registration?.localOccurredAt, "2026-03-10T09:00:00");
  });

  await check("50. the timeline is capped and reports whether it truncated", async () => {
    for (const lead of leads.values()) {
      const timeline = (await detailOf(lead)).timeline;
      assert.equal(timeline.maxItems, LEAD_TIMELINE_MAX_ITEMS);
      assert.ok(timeline.items.length <= LEAD_TIMELINE_MAX_ITEMS);
      // The current catalog cannot exceed six items for one lead, so a `true`
      // here would mean a new event source arrived without a review.
      assert.equal(timeline.truncated, false, lead.label);
    }
  });

  await check("51. the timeline exposes no row id, no query and no secret", async () => {
    for (const lead of leads.values()) {
      const body = JSON.stringify((await detailOf(lead)).timeline);
      for (const forbidden of ["clickid", "playerid", "sourceEventId", "SECRET", "cookie"]) {
        assert.ok(!body.toLowerCase().includes(forbidden.toLowerCase()), `${lead.label}: ${forbidden}`);
      }
    }
  });

  /* ---------------------------------------------------------- 52. filters */

  await check("52. the affiliate filter selects only that affiliate's leads", async () => {
    const result = await page(`affiliatePartnerId=${alpha.id}&limit=100`);
    assert.deepEqual(new Set(labelsOf(result.rows)), new Set(["A", "C", "H", "S"]));
  });

  await check("53. the campaign filter narrows within the affiliate", async () => {
    const result = await page(`affiliateCampaignId=${betaOne.id}&limit=100`);
    assert.deepEqual(labelsOf(result.rows), ["B"]);
  });

  await check("54. the tracking-link filter selects the SELECTED link", async () => {
    const result = await page(`affiliateTrackingLinkId=${linkA2.id}&limit=100`);
    assert.deepEqual(labelsOf(result.rows), ["A"]);
  });

  await check("55. a hierarchy mismatch is refused rather than silently emptied", async () => {
    await assert.rejects(async () => {
      const parsed = parse(`affiliatePartnerId=${beta.id}&affiliateCampaignId=${alphaOne.id}`);
      const { assertFilterHierarchy } = await import("../../src/lib/analytics/request");
      await assertFilterHierarchy(parsed.filters);
    });
  });

  await check("56. attributed and unattributed partition the population", async () => {
    const attributed = await page("attributionState=attributed&limit=100");
    const unattributed = await page("attributionState=unattributed&limit=100");
    const all = await page("limit=100");
    assert.equal(attributed.rows.length + unattributed.rows.length, all.rows.length);
    assert.deepEqual(labelsOf(unattributed.rows).sort(), ["D", "E", "F", "G", "P"]);
    for (const row of attributed.rows) assert.equal(row.attributionState, "attributed");
    for (const row of unattributed.rows) assert.equal(row.attributionState, "unattributed");
  });

  await check("57. the journey-stage filter agrees with the detail it lists", async () => {
    for (const stage of LEAD_JOURNEY_STAGES) {
      const result = await page(`journeyStage=${stage}&limit=100`);
      for (const row of result.rows) assert.equal(row.journeyStage, stage);
    }
    const stages = await Promise.all(
      LEAD_JOURNEY_STAGES.map(async (stage) => (await page(`journeyStage=${stage}&limit=100`)).rows.length),
    );
    assert.equal(
      stages.reduce((sum, count) => sum + count, 0),
      leads.size,
      "the three stages must partition the population",
    );
  });

  await check("58. the deposit-state filter agrees with the detail it lists", async () => {
    for (const state of LEAD_DEPOSIT_STATES) {
      const result = await page(`depositState=${state}&limit=100`);
      for (const row of result.rows) assert.equal(row.depositState, state);
    }
    assert.deepEqual(labelsOf((await page("depositState=pending_identity&limit=100")).rows), ["P"]);
    assert.deepEqual(
      new Set(labelsOf((await page("depositState=conflict&limit=100")).rows)),
      new Set(["C", "H"]),
    );
    const counts = await Promise.all(
      LEAD_DEPOSIT_STATES.map(async (state) => (await page(`depositState=${state}&limit=100`)).rows.length),
    );
    assert.equal(counts.reduce((sum, value) => sum + value, 0), leads.size);
  });

  await check("59. the registration period bounds by the registration event", async () => {
    const result = await page(
      "registrationPreset=custom&registrationStartDate=2026-03-01&registrationEndDate=2026-04-01&limit=100",
    );
    assert.deepEqual(labelsOf(result.rows), ["A"]);
  });

  await check("60. the acquisition period bounds by the SELECTED click", async () => {
    // A registered in March, but was acquired by a click on 9 March; the window
    // below contains the click and not the registration of anybody else.
    const result = await page(
      "acquisitionPreset=custom&acquisitionStartDate=2026-03-09&acquisitionEndDate=2026-03-10&limit=100",
    );
    assert.deepEqual(labelsOf(result.rows), ["A"]);
  });

  await check("61. the two periods are ANDed and never reinterpreted as one another", async () => {
    const both = await page(
      "registrationPreset=custom&registrationStartDate=2026-03-01&registrationEndDate=2026-04-01" +
        "&acquisitionPreset=custom&acquisitionStartDate=2026-03-09&acquisitionEndDate=2026-03-10&limit=100",
    );
    assert.deepEqual(labelsOf(both.rows), ["A"]);

    // The same acquisition window with a registration window that excludes A
    // returns nothing: neither predicate stood in for the other.
    const contradiction = await page(
      "registrationPreset=custom&registrationStartDate=2026-06-01&registrationEndDate=2026-07-01" +
        "&acquisitionPreset=custom&acquisitionStartDate=2026-03-09&acquisitionEndDate=2026-03-10&limit=100",
    );
    assert.equal(contradiction.rows.length, 0);
  });

  await check("62. an acquisition window excludes every direct lead", async () => {
    const result = await page("acquisitionPreset=all_time&limit=100");
    assert.deepEqual(new Set(labelsOf(result.rows)), new Set(["A", "B", "C", "H", "S"]));
  });

  await check("63. asking for a direct acquisition window is refused as a contradiction", () => {
    assert.throws(() => parse("acquisitionPreset=all_time&attributionState=unattributed"));
  });

  await check("64. an unknown or duplicated query key is refused", () => {
    assert.throws(() => parse("email=someone@example.invalid"));
    assert.throws(() => parse("search=nina"));
    assert.throws(() => parse("orderBy=email"));
    assert.throws(() => parse("sort=registration_desc&sort=registration_asc"));
  });

  await check("65. invalid filter, stage, deposit and period values are refused", () => {
    assert.throws(() => parse("affiliatePartnerId=abc"));
    assert.throws(() => parse("affiliatePartnerId=-1"));
    assert.throws(() => parse("affiliatePartnerId=0"));
    assert.throws(() => parse("journeyStage=whatever"));
    assert.throws(() => parse("depositState=paid"));
    assert.throws(() => parse("attributionState=maybe"));
    assert.throws(() => parse("registrationPreset=next_week"));
    assert.throws(() => parse("registrationStartDate=2026-01-01"));
    assert.throws(() => parse("registrationPreset=today&registrationStartDate=2026-01-01"));
  });

  await check("66. no identity-search parameter exists at all", () => {
    for (const key of ["search", "email", "q", "name", "playerId", "clickId"]) {
      assert.throws(() => parse(`${key}=x`), new RegExp(""), `${key} must not be accepted`);
    }
  });

  /* ------------------------------------------------------- 67. pagination */

  await check("67. the default page size is 25 and the maximum is 100", () => {
    assert.equal(parse("").limit, LEADS_DEFAULT_PAGE_SIZE);
    assert.equal(LEADS_DEFAULT_PAGE_SIZE, 25);
    assert.equal(parse("limit=100").limit, 100);
    assert.equal(LEADS_MAX_PAGE_SIZE, 100);
    assert.throws(() => parse("limit=101"));
    assert.throws(() => parse("limit=0"));
    assert.throws(() => parse("limit=-1"));
    assert.throws(() => parse("limit=abc"));
  });

  await check("68. the default sort is registration descending", async () => {
    assert.equal(parse("").sort, "registration_desc");
    const result = await page("limit=100");
    const dates = result.rows.map((row) => new Date(row.academyRegisteredAt).getTime());
    for (let index = 1; index < dates.length; index += 1) {
      assert.ok(dates[index - 1] >= dates[index]);
    }
  });

  await check("69. every supported sort works and an unknown one is refused", async () => {
    for (const sort of LEAD_SORTS) {
      const result = await page(`sort=${sort}&limit=100`);
      assert.equal(result.rows.length, leads.size, sort);
    }
    assert.throws(() => parse("sort=email_desc"));
    assert.throws(() => parse("sort=registration"));
  });

  await check("70. nullable sorts put the absent values last in BOTH directions", async () => {
    const descending = await page("sort=acquisition_desc&limit=100");
    const ascending = await page("sort=acquisition_asc&limit=100");
    for (const rows of [descending.rows, ascending.rows]) {
      const firstNull = rows.findIndex((row) => row.selectedAcquisitionAt === null);
      if (firstNull === -1) continue;
      for (let index = firstNull; index < rows.length; index += 1) {
        assert.equal(rows[index].selectedAcquisitionAt, null);
      }
    }
  });

  await check("71. paging one row at a time returns every lead exactly once", async () => {
    for (const sort of LEAD_SORTS) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 100; guard += 1) {
        const query = `sort=${sort}&limit=1${cursor === null ? "" : `&cursor=${cursor}`}`;
        const result = await page(query);
        for (const row of result.rows) seen.push(row.leadId);
        if (!result.hasMore || result.kept.length === 0) break;
        const last = result.kept[result.kept.length - 1];
        cursor = encodeLeadCursor(
          { nullBucket: last.nullBucket, sortValue: last.sortValue, rowId: last.rowId },
          result.parsed.fingerprint,
        );
      }
      assert.equal(seen.length, leads.size, `${sort}: wrong number of rows`);
      assert.equal(new Set(seen).size, leads.size, `${sort}: duplicate rows across pages`);
    }
  });

  await check("72. repeated registration instants still page without loss", async () => {
    // Three leads sharing one instant: the tie breaker is the only thing that
    // can keep a page boundary from falling between them twice.
    const collision = msk(2026, 2, 14, 12);
    const collided: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const lead = await makeLead({ label: `T${index}`, registeredAt: collision });
      collided.push(lead.leadId);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 100; guard += 1) {
      const result = await page(`limit=2${cursor === null ? "" : `&cursor=${cursor}`}`);
      for (const row of result.rows) seen.push(row.leadId);
      if (!result.hasMore || result.kept.length === 0) break;
      const last = result.kept[result.kept.length - 1];
      cursor = encodeLeadCursor(
        { nullBucket: last.nullBucket, sortValue: last.sortValue, rowId: last.rowId },
        result.parsed.fingerprint,
      );
    }
    assert.equal(new Set(seen).size, seen.length, "duplicate rows across pages");
    for (const leadId of collided) assert.ok(seen.includes(leadId), "a collided row was skipped");
    assert.equal(seen.length, leads.size);
  });

  await check("73. a tampered cursor is refused", () => {
    const fingerprint = parse("").fingerprint;
    const good = encodeLeadCursor({ nullBucket: false, sortValue: NOW, rowId: 5 }, fingerprint);
    assert.doesNotThrow(() => decodeLeadCursor(good, fingerprint));

    for (const bad of [
      "not-base64!!",
      Buffer.from("{}", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ v: 2, f: fingerprint, n: 0, t: NOW.toISOString(), i: 5 })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, f: fingerprint, n: 0, t: NOW.toISOString(), i: 5, extra: 1 })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, f: fingerprint, n: 0, t: "not-a-date", i: 5 })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, f: fingerprint, n: 0, t: NOW.toISOString(), i: "5" })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, f: fingerprint, n: 1, t: NOW.toISOString(), i: 5 })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, f: fingerprint, n: 0, t: null, i: 5 })).toString("base64url"),
      "a".repeat(600),
    ]) {
      assert.throws(() => decodeLeadCursor(bad, fingerprint), `accepted a tampered cursor: ${bad.slice(0, 40)}`);
    }
  });

  await check("74. a cursor is bound to its filters and its sort", async () => {
    const first = await page("limit=1");
    const last = first.kept[0];
    const cursor = encodeLeadCursor(
      { nullBucket: last.nullBucket, sortValue: last.sortValue, rowId: last.rowId },
      first.parsed.fingerprint,
    );
    assert.doesNotThrow(() => parse(`limit=1&cursor=${cursor}`));
    // Replayed against a different predicate or a different ordering, the same
    // cursor is an error rather than a quietly wrong page.
    assert.throws(() => parse(`limit=1&sort=registration_asc&cursor=${cursor}`));
    assert.throws(() => parse(`limit=1&attributionState=attributed&cursor=${cursor}`));
    assert.throws(() => parse(`limit=1&journeyStage=academy_registered&cursor=${cursor}`));
    assert.throws(() => parse(`limit=1&registrationPreset=all_time&cursor=${cursor}`));
    // The page SIZE is deliberately not bound: it changes no ordering.
    assert.doesNotThrow(() => parse(`limit=5&cursor=${cursor}`));
  });

  await check("75. the fingerprint is order-independent and predicate-sensitive", () => {
    const left = parse(`affiliatePartnerId=${alpha.id}&journeyStage=academy_registered`);
    const right = parse(`journeyStage=academy_registered&affiliatePartnerId=${alpha.id}`);
    assert.equal(left.fingerprint, right.fingerprint);
    assert.notEqual(left.fingerprint, parse(`affiliatePartnerId=${beta.id}`).fingerprint);
    assert.equal(
      cursorFingerprint(
        canonicalLeadQuery({
          filters: {},
          attributionState: null,
          journeyStage: null,
          depositState: null,
          registrationPeriod: null,
          acquisitionPeriod: null,
          sort: "registration_desc",
        }),
      ),
      parse("").fingerprint,
    );
  });

  await check("76. a cursor carries no identity and no capability", () => {
    const fingerprint = parse("").fingerprint;
    const cursor = encodeLeadCursor({ nullBucket: false, sortValue: NOW, rowId: 7 }, fingerprint);
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    assert.deepEqual(Object.keys(decoded).sort(), ["f", "i", "n", "t", "v"]);
    for (const lead of leads.values()) {
      assert.ok(!cursor.includes(lead.email));
      assert.ok(!JSON.stringify(decoded).includes(lead.email));
    }
  });

  /* --------------------------------------------------- 77. data availability */

  await check("77. every unavailable dimension states its reason", async () => {
    const detail = await detailOf(E);
    const availability = buildLeadDataAvailability({
      attributed: detail.acquisition.attributionState === "attributed",
      pocketRegistered: detail.journey.pocketRegisteredAt !== null,
      depositState: detail.deposit.depositState,
    });
    assert.deepEqual(availability.redeposit, {
      available: false,
      reason: "provider_transaction_identifier_missing",
    });
    assert.deepEqual(availability.currentBalance, {
      available: false,
      reason: "prohibited_not_collected",
    });
    assert.deepEqual(availability.educationTimeline, {
      available: false,
      reason: "authoritative_product_event_catalog_not_implemented",
    });
    assert.deepEqual(availability.trafficSubParameters, {
      available: false,
      reason: "sensitive_acquisition_metadata_not_exposed",
    });
    assert.deepEqual(availability.acquisition, {
      available: false,
      reason: "direct_registration",
    });
    assert.equal(availability.academyRegistration.available, true);
  });

  await check("78. the deposit availability distinguishes four outcomes", async () => {
    const cases: [typeof A, string][] = [
      [A, "available"],
      [P, "pending"],
      [C, "conflict"],
      [E, "absent"],
    ];
    for (const [lead, expected] of cases) {
      const detail = await detailOf(lead);
      const availability = buildLeadDataAvailability({
        attributed: detail.acquisition.attributionState === "attributed",
        pocketRegistered: detail.journey.pocketRegisteredAt !== null,
        depositState: detail.deposit.depositState,
      });
      assert.equal(availability.firstDeposit.state, expected, lead.label);
    }
  });

  await check("79. an unavailable amount is never rendered as a number", async () => {
    const noCurrency = await makeLead({
      label: "N",
      registeredAt: msk(2026, 2, 1, 9),
      pocketAt: msk(2026, 2, 2, 9),
      deposit: {
        firstReceivedAt: msk(2026, 2, 3, 9),
        status: "matched",
        matchedAt: msk(2026, 2, 3, 9),
        ledgerAt: msk(2026, 2, 3, 9),
        amount: "42.00",
        currency: null,
      },
    });
    const detail = await detailOf(noCurrency);
    assert.equal(detail.deposit.amountAvailability.available, false);
    assert.equal(detail.deposit.providerAmount, null);
    assert.equal(detail.deposit.currencyCode, null);
    assert.notEqual(detail.deposit.confirmedAt, null);

    const withCurrency = await detailOf(A);
    assert.equal(withCurrency.deposit.amountAvailability.available, true);
    assert.equal(withCurrency.deposit.providerAmount, "50.00");
    assert.equal(withCurrency.deposit.currencyCode, "USD");
  });

  await check("80. the analytics availability blocks now report the drilldown as shipped", () => {
    const eventDate = buildDataAvailability({
      amountAggregationAvailable: true,
      amountUnavailableReason: null,
    });
    assert.deepEqual(eventDate.leadDrilldown, { available: true });
    const cohort = buildCohortAvailability({
      amountAggregationAvailable: true,
      amountUnavailableReason: null,
    });
    assert.deepEqual(cohort.leadDrilldown, { available: true });
  });

  /* ---------------------------------------------------- 81. query safety */

  await check("81. the query count is independent of the page size", async () => {
    const counted: string[] = [];
    const spy = {
      $queryRaw: (...args: Parameters<typeof prisma.$queryRaw>) => {
        counted.push("q");
        return (prisma.$queryRaw as (...a: unknown[]) => unknown)(...args);
      },
    } as unknown as typeof prisma;

    for (const limit of [1, 5, 25, 100]) {
      counted.length = 0;
      const parsed = parse(`limit=${limit}`);
      const keys = await loadLeadKeys(spy, parsed);
      await loadLeadFacts(
        spy,
        keys.slice(0, parsed.limit).map((key) => key.rowId),
      );
      // TWO. Always two, whatever the page holds. That is the N+1 proof.
      assert.equal(counted.length, 2, `limit=${limit} issued ${counted.length} statements`);
    }
  });

  await check("82. one detail is one statement", async () => {
    let count = 0;
    const spy = {
      $queryRaw: (...args: Parameters<typeof prisma.$queryRaw>) => {
        count += 1;
        return (prisma.$queryRaw as (...a: unknown[]) => unknown)(...args);
      },
    } as unknown as typeof prisma;
    await loadLeadByEventId(spy, A.eventId);
    assert.equal(count, 1);
  });

  await check("83. hostile filter input reaches no SQL", async () => {
    for (const hostile of [
      "1; DROP TABLE User",
      "1 OR 1=1",
      "1'--",
      "../../etc/passwd",
      "%00",
    ]) {
      assert.throws(() => parse(`affiliatePartnerId=${encodeURIComponent(hostile)}`));
      assert.throws(() => parse(`journeyStage=${encodeURIComponent(hostile)}`));
      assert.throws(() => parse(`sort=${encodeURIComponent(hostile)}`));
    }
    // The tables are all still here.
    assert.ok((await prisma.user.count()) > 0);
  });

  await check("84. a hostile lead id reaches no SQL and finds nothing", async () => {
    for (const hostile of ["' OR '1'='1", "v1_' OR 1=1 --", `v1_${"a".repeat(32)}' --`]) {
      assert.equal(parseLeadId(hostile).kind, "invalid");
    }
    // A syntactically valid id that names nothing is a clean miss, not an error.
    assert.equal(await loadLeadByEventId(prisma, "q".repeat(32)), null);
  });

  await check("85. no lead row carries a timeline array", async () => {
    const result = await page("limit=100");
    for (const row of result.rows) {
      assert.equal("timeline" in row, false);
      assert.equal("email" in row, false);
      assert.equal("userId" in row, false);
    }
  });

  await check("86. the list and the detail agree about every lead", async () => {
    const result = await page("limit=100");
    for (const row of result.rows) {
      const lead = [...leads.values()].find((entry) => entry.leadId === row.leadId);
      if (!lead) continue;
      const detail = await detailOf(lead);
      assert.equal(row.journeyStage, detail.journey.journeyStage, lead.label);
      assert.equal(row.depositState, detail.deposit.depositState, lead.label);
      assert.equal(row.attributionState, detail.acquisition.attributionState, lead.label);
      assert.equal(row.maskedEmail, detail.maskedEmail, lead.label);
      assert.equal(row.pocketRegisteredAt, detail.journey.pocketRegisteredAt, lead.label);
      assert.equal(row.firstDepositAt, detail.journey.firstDepositConfirmedAt, lead.label);
    }
  });

  await check("87. canRevealPii is a hint and never the redaction itself", async () => {
    const facts = await loadLeadByEventId(prisma, A.eventId);
    const permitted = buildLeadListRow(facts!, true);
    const denied = buildLeadListRow(facts!, false);
    assert.equal(permitted.canRevealPii, true);
    assert.equal(denied.canRevealPii, false);
    // The identity is identical either way: holding the permission changes what
    // a caller MAY DO, never what a list row contains.
    assert.equal(permitted.maskedEmail, denied.maskedEmail);
    assert.equal(permitted.piiState, "redacted");
    assert.equal(buildLeadDetail(facts!, MSK, true).piiState, "redacted");
  });

  await prisma.$disconnect();
  cleanup();

  console.log(`\nAFD-5B2B lead drilldown: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
