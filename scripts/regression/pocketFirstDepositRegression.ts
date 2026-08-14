/**
 * AFD-4 — Pocket first-deposit ingestion, pending identity and reconciliation.
 *
 * Synthetic database only. NO EXTERNAL REQUEST IS MADE: this suite builds real
 * `Request` objects in Pocket's exact GET format and hands them to the route
 * handler in process. Nothing contacts Pocket, no live secret is read, and every
 * secret, clickid, playerid and amount here is synthetic.
 *
 * The claim under test: **one Pocket player produces at most one canonical first
 * deposit and one first_deposit conversion event; a deposit never binds an
 * identity, completes a level or awards XP; and anything that disagrees is
 * quarantined rather than overwriting what was already recorded.**
 *
 * Proven here:
 *   A. configuration — default off, reg unaffected, dep unavailable, currency.
 *   B. migration     — 36 to 39, rebuild preserves rows, no RD/balance/outbox.
 *   C. parameters    — every field exactly once, aliases, control chars, bounds.
 *   D. amount        — exact decimal, normalisation, and every rejected spelling.
 *   E. identity      — matched, pending, unknown click, conflict, no binding.
 *   F. idempotency   — replay, changed amount, changed click, concurrency.
 *   G. reconciliation— dep before reg, goal=reg convergence, operator command.
 *   H. attribution   — frozen reuse, direct null, no retroactive attribution.
 *   I. safety        — no XP, no level completion, no balance, no leakage.
 */
import assert from "node:assert/strict";

import { leaksValue } from "../../src/lib/testing/leakDetection";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXPECTED_MIGRATION_COUNT, expectedPriorMigrationCount } from "./support/migrationCount";

const dbPath = path.join(os.tmpdir(), `ata-pocket-fd-afd4-${process.pid}.db`);
const upgradeDbPath = path.join(os.tmpdir(), `ata-pocket-fd-afd4-upgrade-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** Synthetic. Never a real Pocket secret. Contains `&` and `%` deliberately. */
const SECRET = "afd4-synth&postback%secret-01";
const ROUTE = "https://ata.invalid/api/postbacks/pocket";
const MIGRATION_NAME = "20260731010000_pocket_first_deposit";

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

function cleanup() {
  for (const base of [dbPath, upgradeDbPath]) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      fs.rmSync(`${base}${suffix}`, { force: true });
    }
  }
}

function captureConsole() {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const record = (...args: unknown[]) =>
    lines.push(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
  console.log = record;
  console.warn = record;
  console.error = record;
  return {
    lines,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}
function safeJson(v: unknown) {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Build an environment probe.
 *
 * `NodeJS.ProcessEnv` is declared with a REQUIRED `NODE_ENV` in this project, so
 * a partial literal cannot be cast to it directly. Going through `unknown` is
 * the point of these cases: the configuration model must hold for an
 * environment that has no NODE_ENV at all.
 */
function probeEnv(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

let ipSeq = 0;
/** A fresh source IP per request so the route's rate limit never masks a result. */
const nextIp = () => `10.7.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

let playerSeq = 0;
const nextPlayerId = () => String(700_000_000 + ++playerSeq);

function runMigrations(env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env, encoding: "utf8" },
  );
}

async function main() {
  cleanup();
  const baseEnv = { ...process.env, DATABASE_URL: dbUrl };
  const migration = runMigrations(baseEnv);
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.POSTBACK_SECRET = SECRET;
  process.env.POCKET_POSTBACK_ENABLED = "true";
  // G4 made ingest GRANULAR: the master switch alone no longer admits a goal.
  // These suites predate that gate and still wrote the pre-G4 contract, so every
  // positive case answered 503 and they had been red ever since — on the
  // accepted release too, unattributed. Fixture-only and isolated: this sets
  // environment variables inside a throwaway process against a throwaway SQLite
  // file, and changes nothing about the live PREPROD flags, which stay OFF.
  process.env.POCKET_REG_INGEST_ENABLED = "true";
  process.env.POCKET_DEP_INGEST_ENABLED = "true";
  // POCKET-REG-SECURITY-CLOSURE-1 (§14): RDEP is deliberately NOT enabled here,
  // and is DELETED rather than merely left unset — several cases below assert
  // that a redeposit is refused, and an operator shell exporting the flag would
  // silently convert those refusals into acceptances.
  delete process.env.POCKET_RDEP_INGEST_ENABLED;
  process.env.POCKET_FIRST_DEPOSIT_ENABLED = "true";
  delete process.env.POCKET_DEPOSIT_CURRENCY;

  const { prisma } = await import("../../src/lib/prisma");
  const route = await import("../../src/app/api/postbacks/pocket/route");
  const config = await import("../../src/lib/exchange/pocketFirstDepositConfig");
  const amounts = await import("../../src/lib/exchange/pocketDepositAmount");
  const fd = await import("../../src/lib/exchange/pocketFirstDeposit");
  // The repository's own id generator, so fixtures satisfy the same 32-character
  // base32 CHECK constraints the production writers do.
  const { randomBase32Id } = await import("../../src/lib/affiliate/random-id");

  let learnerSeq = 0;
  /** A learner whose ExchangeAccount carries a real ATA-format clickid. */
  async function createLearner() {
    learnerSeq += 1;
    const user = await prisma.user.create({
      data: { email: `afd4-${learnerSeq}@example.invalid`, name: "AFD4" },
    });
    const clickId = `tq-${crypto.randomUUID()}`;
    await prisma.exchangeAccount.create({
      data: {
        userId: user.id,
        provider: "real_placeholder",
        referralLink: "https://example.invalid/ref",
        exchangeAccountId: `pocket-pending-${user.id}`,
        clickId,
        status: "pending",
      },
    });
    return { userId: user.id, clickId };
  }

  /** Bind a Pocket identity the ONLY legal way: as a registration postback. */
  async function bindIdentity(userId: number, playerId: string, clickId: string) {
    await prisma.pocketTraderIdentity.create({
      data: { userId, pocketUserId: playerId, clickId, source: "registration_postback" },
    });
  }

  let affiliateSeq = 0;
  /** A complete acquisition journey ending in a frozen attribution. */
  async function attributeLearner(userId: number) {
    affiliateSeq += 1;
    const staff = await prisma.user.create({
      data: { email: `afd4-staff-${affiliateSeq}@example.invalid`, name: "Staff" },
    });
    const partner = await prisma.affiliatePartner.create({
      data: {
        code: `afd4-partner-${affiliateSeq}`,
        displayName: "Partner",
        createdByUserId: staff.id,
      },
    });
    const campaign = await prisma.affiliateCampaign.create({
      data: {
        affiliatePartnerId: partner.id,
        code: `afd4-campaign-${affiliateSeq}`,
        displayName: "Campaign",
        createdByUserId: staff.id,
      },
    });
    const link = await prisma.affiliateTrackingLink.create({
      data: {
        affiliatePartnerId: partner.id,
        affiliateCampaignId: campaign.id,
        publicCode: randomBase32Id(),
        displayName: "Link",
        status: "active",
        createdByUserId: staff.id,
      },
    });
    const click = await prisma.affiliateClick.create({
      data: {
        ataClickId: randomBase32Id(),
        trackingLinkId: link.id,
        anonymousVisitorId: randomBase32Id(),
        classification: "qualified",
        effectiveAttributionWindowDays: 30,
        occurredAt: new Date(),
      },
    });
    const attribution = await prisma.affiliateAttribution.create({
      data: {
        userId,
        anonymousVisitorId: randomBase32Id(),
        firstTouchClickId: click.id,
        lastTouchClickId: click.id,
        selectedClickId: click.id,
        attributionModel: "last_eligible_affiliate_click",
        selectionReason: "registration_cookie",
        selectedAt: new Date(),
        frozenAt: new Date(),
      },
    });
    return { partner, campaign, link, click, attribution };
  }

  /**
   * The synthetic DIRECT Pocket sender — exactly the official field shape:
   *   GET <url>?clickid=...&goal=dep&playerid=...&ow=<secret>&sum=...
   * `raw` allows deliberately malformed query strings (duplicates, encoding).
   */
  function send(input: {
    clickid?: string;
    goal?: string;
    ow?: string | null;
    playerid?: string;
    sum?: string;
    extra?: Record<string, string>;
    header?: string;
    raw?: string;
  }) {
    let url: string;
    if (input.raw !== undefined) {
      url = `${ROUTE}?${input.raw}`;
    } else {
      const params = new URLSearchParams();
      if (input.clickid !== undefined) params.set("clickid", input.clickid);
      if (input.goal !== undefined) params.set("goal", input.goal);
      if (input.playerid !== undefined) params.set("playerid", input.playerid);
      if (input.sum !== undefined) params.set("sum", input.sum);
      if (input.ow !== undefined && input.ow !== null) params.set("ow", input.ow);
      for (const [k, v] of Object.entries(input.extra ?? {})) params.set(k, v);
      url = `${ROUTE}?${params.toString()}`;
    }
    const headers: Record<string, string> = { "x-forwarded-for": nextIp() };
    if (input.header) headers["x-postback-secret"] = input.header;
    return route.GET(new Request(url, { headers }));
  }

  /** The canonical happy-path deposit sender. */
  const dep = (clickId: string, playerId: string, sum: string) =>
    send({ clickid: clickId, goal: "dep", playerid: playerId, sum, ow: SECRET });

  const eventFor = (playerId: string) =>
    prisma.pocketProviderEvent.findFirst({ where: { pocketPlayerId: playerId } });

  const conversionsFor = (userId: number) =>
    prisma.affiliateConversionEvent.findMany({
      where: { userId, eventType: "first_deposit" },
    });

  /* ------------------------------------------------------------------ */
  /* A. Configuration                                                    */
  /* ------------------------------------------------------------------ */

  await check("A1 first deposit is disabled by default", () => {
    assert.equal(config.isPocketFirstDepositEnabled(probeEnv({})), false);
    assert.equal(
      config.isPocketFirstDepositEnabled(probeEnv({
        POCKET_POSTBACK_ENABLED: "true",
        POSTBACK_SECRET: SECRET,
      })),
      false,
    );
  });

  await check("A2 enabling first deposit requires the Pocket integration", () => {
    const resolution = config.resolvePocketFirstDepositConfig(probeEnv({
      POCKET_FIRST_DEPOSIT_ENABLED: "true",
    }));
    assert.equal(resolution.kind, "invalid");
    assert.equal(
      resolution.kind === "invalid" ? resolution.reason : null,
      "postback_integration_disabled",
    );
  });

  await check("A3 a valid currency resolves as configured", () => {
    const resolution = config.resolvePocketFirstDepositConfig(probeEnv({
      POCKET_FIRST_DEPOSIT_ENABLED: "true",
      POCKET_POSTBACK_ENABLED: "true",
      POSTBACK_SECRET: SECRET,
      POCKET_DEPOSIT_CURRENCY: "USD",
    }));
    assert.equal(resolution.kind, "resolved");
    assert.deepEqual(
      resolution.kind === "resolved" && resolution.config.enabled
        ? resolution.config.currency
        : null,
      { status: "configured", code: "USD" },
    );
  });

  await check("A4 an unset currency resolves as unspecified, never USD", () => {
    const resolution = config.resolvePocketFirstDepositConfig(probeEnv({
      POCKET_FIRST_DEPOSIT_ENABLED: "true",
      POCKET_POSTBACK_ENABLED: "true",
      POSTBACK_SECRET: SECRET,
    }));
    assert.equal(resolution.kind, "resolved");
    assert.deepEqual(
      resolution.kind === "resolved" && resolution.config.enabled
        ? resolution.config.currency
        : null,
      { status: "unspecified", code: null },
    );
  });

  await check("A5 an invalid currency fails closed", () => {
    for (const value of ["usd", "US", "USDT", "US1", " USD", "USD ", "$", "840"]) {
      const resolution = config.resolvePocketFirstDepositConfig(probeEnv({
        POCKET_FIRST_DEPOSIT_ENABLED: "true",
        POCKET_POSTBACK_ENABLED: "true",
        POSTBACK_SECRET: SECRET,
        POCKET_DEPOSIT_CURRENCY: value,
      }));
      assert.equal(resolution.kind, "invalid", `currency ${JSON.stringify(value)} must be refused`);
    }
  });

  await check("A6 goal=dep is unavailable while first deposit is disabled", async () => {
    const learner = await createLearner();
    process.env.POCKET_FIRST_DEPOSIT_ENABLED = "false";
    try {
      const response = await dep(learner.clickId, nextPlayerId(), "100.00");
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, "POCKET_POSTBACK_UNAVAILABLE");
      assert.equal(await prisma.pocketProviderEvent.count(), 0);
    } finally {
      process.env.POCKET_FIRST_DEPOSIT_ENABLED = "true";
    }
  });

  await check("A7 goal=reg still works while first deposit is disabled", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    process.env.POCKET_FIRST_DEPOSIT_ENABLED = "false";
    try {
      const response = await send({
        clickid: learner.clickId,
        goal: "reg",
        playerid: playerId,
        ow: SECRET,
      });
      assert.equal(response.status, 200);
      const identity = await prisma.pocketTraderIdentity.findUnique({
        where: { userId: learner.userId },
      });
      assert.equal(identity?.pocketUserId, playerId);
    } finally {
      process.env.POCKET_FIRST_DEPOSIT_ENABLED = "true";
    }
  });

  // POCKET-REG-INGRESS-1 — the post-G4 refusal contract
  // (TEST-POCKET-REFUSAL-CONTRACT): `redep` IS a Growth V1 goal, so with its
  // family switch off a query-authenticated attempt is answered
  // `503 POCKET_POSTBACK_UNAVAILABLE` before authentication — retry-safe, and
  // not an invitation to hunt for a secret mismatch that does not exist. Goals
  // with no Growth V1 mandate keep the one indistinguishable 403. Neither
  // refusal reaches the database.
  await check("A8 no other financial goal accepts ow, enabled or not", async () => {
    const learner = await createLearner();
    for (const enabled of ["true", "false"]) {
      process.env.POCKET_FIRST_DEPOSIT_ENABLED = enabled;
      for (const goal of ["ftd", "commission", "withdrawal", "email"]) {
        const response = await send({
          clickid: learner.clickId,
          goal,
          playerid: nextPlayerId(),
          sum: "10.00",
          ow: SECRET,
        });
        assert.equal(response.status, 403, `${goal} must stay header-only (fd=${enabled})`);
      }
      const redep = await send({
        clickid: learner.clickId,
        goal: "redep",
        playerid: nextPlayerId(),
        sum: "10.00",
        ow: SECRET,
      });
      assert.equal(redep.status, 503, `redep while RDEP is off is unavailable, pre-auth (fd=${enabled})`);
    }
    process.env.POCKET_FIRST_DEPOSIT_ENABLED = "true";
  });

  /* ------------------------------------------------------------------ */
  /* B. Migration                                                        */
  /* ------------------------------------------------------------------ */

  await check("B1 the canonical migration count matches the directory", () => {
    const entries = fs
      .readdirSync(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    // AFD-5B1 added the index-only migration 40. AGENT-FOUNDATION-1 added the
    // additive Agent Core migration 41, which creates nine new tables and
    // touches nothing this suite measures.
    // PHASE-G0: the hand-written literal is gone. It was pinned to 41 while the
    // repository had already reached 42, so this assertion had been failing on
    // the accepted base and guarded nothing. The count lives ONLY in the shared
    // constant now, which is exactly the arrangement
    // scripts/regression/support/migrationCount.ts exists to enforce -- a second
    // copy beside it is what let it drift in the first place.
    assert.equal(entries.length, EXPECTED_MIGRATION_COUNT);
    assert.ok(entries.includes(MIGRATION_NAME));
  });

  await check("B2 the applied database reports the canonical migration count", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
      'SELECT COUNT(*) AS c FROM "_prisma_migrations" WHERE "rolled_back_at" IS NULL',
    );
    assert.equal(Number(rows[0].c), EXPECTED_MIGRATION_COUNT);
  });

  await check("B3 integrity and foreign keys are clean", async () => {
    const integrity = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
      "PRAGMA integrity_check",
    );
    assert.equal(Object.values(integrity[0])[0], "ok");
    const fk = await prisma.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check");
    assert.equal(fk.length, 0);
  });

  await check("B4 the migration is safe under the runner's semicolon split", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "prisma", "migrations", MIGRATION_NAME, "migration.sql"),
      "utf8",
    );
    // The runner splits on ";" and executes each fragment. A fragment that is
    // only a comment would be executed as SQL and fail, and a semicolon inside a
    // comment would bisect the statement before it.
    const fragments = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const fragment of fragments) {
      const executable = fragment
        .split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("--"));
      assert.ok(executable.length > 0, `comment-only fragment: ${fragment.slice(0, 60)}`);
    }
    assert.equal(fragments.length, 18);
  });

  await check("B5 the migration adds no redeposit, balance or outbox structure", () => {
    const sql = fs
      .readFileSync(
        path.join(process.cwd(), "prisma", "migrations", MIGRATION_NAME, "migration.sql"),
        "utf8",
      )
      .replace(/--[^\n]*\n/g, "");
    for (const forbidden of [/redeposit/i, /"?balance"?\s+(REAL|NUMERIC|INTEGER|DECIMAL)/i, /outbox/i]) {
      assert.ok(!forbidden.test(sql), `migration must not introduce ${forbidden}`);
    }
  });

  // POCKET-REG-INGRESS-1 (TEST-POCKET-REFUSAL-CONTRACT): migration 47
  // (`growth_event_foundation`) creates `GrowthEventOutbox` BY DESIGN — the
  // canonical Growth ledger's single outbox. The pre-47 spelling of this
  // assertion ("no outbox concept anywhere") had therefore been failing on the
  // accepted, deployed release while guarding nothing. The post-47 contract it
  // now pins: still no redeposit table (RDEP identity is an external
  // dependency and no schema may pre-empt it), still no balance column on the
  // provider event, and no SECOND outbox — `GrowthEventOutbox` is the only one
  // allowed to exist.
  await check("B6 no redeposit table, no balance column, no second outbox", async () => {
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    const names = tables.map((t) => t.name.toLowerCase());
    assert.ok(!names.some((n) => n.includes("redeposit")), "found a redeposit table");
    const outboxes = names.filter((n) => n.includes("outbox"));
    assert.deepEqual(outboxes, ["growtheventoutbox"], "GrowthEventOutbox must be the only outbox");
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("PocketProviderEvent")',
    );
    const columnNames = columns.map((c) => c.name.toLowerCase());
    assert.ok(!columnNames.some((c) => c.includes("balance")), "no balance column");
  });

  await check("B7 the provider event carries every required index", async () => {
    const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='PocketProviderEvent'",
    );
    const names = indexes.map((i) => i.name);
    for (const required of [
      // POCKET-DEP-RDEP-1. The compound unique
      // (provider, eventType, pocketPlayerId) is deliberately GONE. It could
      // only express "one row per player per type", which is right for a first
      // deposit and wrong for redeposits — a player has many. Migration 49
      // replaces it with two PARTIAL uniques, so the FTD guarantee is unchanged
      // while redeposits are keyed on their derived identity instead.
      "PocketProviderEvent_first_deposit_player_key",
      "PocketProviderEvent_provider_eventType_providerEventKey_key",
      "PocketProviderEvent_pocketClickId_idx",
      "PocketProviderEvent_matchedUserId_idx",
      "PocketProviderEvent_status_firstReceivedAt_idx",
      "PocketProviderEvent_conflictCode_idx",
      "PocketProviderEvent_lastReceivedAt_idx",
    ]) {
      assert.ok(names.includes(required), `missing index ${required}`);
    }
  });

  await check("B8 the conversion ledger keeps its uniqueness and gains no new gap", async () => {
    const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='AffiliateConversionEvent'",
    );
    const names = indexes.map((i) => i.name);
    for (const required of [
      "AffiliateConversionEvent_eventId_key",
      "AffiliateConversionEvent_source_key",
      "AffiliateConversionEvent_eventType_occurredAt_idx",
      "AffiliateConversionEvent_affiliatePartnerId_occurredAt_idx",
      "AffiliateConversionEvent_affiliateCampaignId_occurredAt_idx",
      "AffiliateConversionEvent_trackingLinkId_occurredAt_idx",
      "AffiliateConversionEvent_userId_occurredAt_idx",
    ]) {
      assert.ok(names.includes(required), `missing index ${required}`);
    }
  });

  await check(
    "B9 upgrading a 38-migration database to 39 preserves academy_registration rows",
    () => {
      const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
      // Every migration that lands BEFORE this one, in order. Not "all except
      // this one": AFD-5B1's index-only migration 40 targets a table AFD-4
      // creates, so excluding only AFD-4 would produce an unbuildable schema.
      const ordered = fs
        .readdirSync(migrationsDir)
        .filter((e) => e !== "migration_lock.toml")
        .sort();
      const prior = ordered.slice(0, ordered.indexOf(MIGRATION_NAME));
      // The argument is "how many migrations land at or after this one". It was
      // 2 (this migration itself and AFD-5B1's index-only 40); AGENT-FOUNDATION-1's
      // additive Agent Core migration made it 3; PHASE-A's staging attestation and
      // PHASE-G0's authoring foundation make it 5. Expressed relative to
      // EXPECTED_MIGRATION_COUNT so it cannot drift away from the canonical
      // total, but the offset itself is a second migration-count pin and moves
      // deliberately, in the same commit as the migration.
      //
      // PHASE-G2 CORRECTION: it was left at 5 when the G0 CORRECTION migration
      // landed, which made it 6 — so this assertion had been failing on the
      // accepted G1 base and was guarding nothing, the exact decay
      // support/migrationCount.ts exists to stop. PHASE-G2's source-authority
      // migration makes it 7, and both steps are corrected here together.
      //
      // PHASE-G2 SUCCESSOR: the assessment lineage migration makes it 8. Nothing
      // about Pocket changed — this suite pins the migration chain twice, by
      // total and by offset, and both pins move when a migration is added.
      //
      // POCKET-REG-INGRESS-1 (TEST-POCKET-REFUSAL-CONTRACT): G4's
      // `growth_event_foundation` (migration 47) landed after this one and the
      // offset was not bumped with it — the same decay this comment already
      // documents twice, caught this time by the activation phase that owns the
      // post-G4 contract. 8 -> 9. No Pocket schema changed; both pins move
      // together, and EXPECTED_MIGRATION_COUNT remains 47.
      //
      // POCKET-REG-FINAL-INTERNAL-CORRECTION-1: migration 48 normalises legacy
      // TEXT timestamp storage and lands after this one, so the offset is 9 ->
      // 10 and EXPECTED_MIGRATION_COUNT is 47 -> 48. No Pocket schema changed
      // and no Pocket row was touched. Bumped in the same commit as the
      // migration, which is the discipline the three comments above exist to
      // enforce — this suite going red when a migration appears is the guard
      // working, not a failure to accommodate.
      //
      // POCKET-DEP-RDEP-FINANCIAL-INGRESS-1: migration 49 rebuilds
      // PocketProviderEvent for redeposits and lands after this one, so the
      // offset is 10 -> 11 and EXPECTED_MIGRATION_COUNT is 48 -> 49. Unlike the
      // five bumps above, this one DOES change the Pocket schema — but not the
      // property under test here: the rebuild preserves every existing row, and
      // academy_registration conversion rows live in a different table entirely.
      assert.equal(prior.length, expectedPriorMigrationCount(11));

      const bookkeeping = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0);`;
      assert.equal(
        spawnSync("sqlite3", [upgradeDbPath], { input: bookkeeping, encoding: "utf8" }).status,
        0,
      );
      for (const name of prior) {
        const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
        assert.equal(
          spawnSync("sqlite3", [upgradeDbPath], { input: sql, encoding: "utf8" }).status,
          0,
          `apply ${name}`,
        );
        const checksum = crypto.createHash("sha256").update(sql).digest("hex");
        assert.equal(
          spawnSync("sqlite3", [upgradeDbPath], {
            input: `INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","finished_at","applied_steps_count") VALUES ('${crypto.randomUUID()}','${checksum}','${name}',CURRENT_TIMESTAMP,1);`,
            encoding: "utf8",
          }).status,
          0,
        );
      }

      // The first-deposit table must not exist yet.
      assert.equal(
        spawnSync("sqlite3", [upgradeDbPath], {
          input: `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='PocketProviderEvent';`,
          encoding: "utf8",
        }).stdout.trim(),
        "0",
      );

      // A representative pre-existing conversion ledger: one attributed-shaped
      // row is impossible without a full affiliate graph, so a DIRECT
      // registration row is used -- which is also the row most at risk from a
      // careless rebuild, because every affiliate column is NULL.
      const seed = `
        INSERT INTO "User" ("email","pendingEmail","referralCode","passwordHash","role","status","name","level","xp","createdAt","updatedAt")
        VALUES ('afd4-legacy@example.test',NULL,'afd4-legacy-ref','x','user','active','Legacy',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "AffiliateConversionEvent" ("eventId","eventType","userId","sourceOwner","sourceEventId","occurredAt","createdAt")
        VALUES ('aaaabbbbccccddddeeeeffffgggghhhh','academy_registration',(SELECT id FROM "User" WHERE email='afd4-legacy@example.test'),'auth_register','user:legacy',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`;
      assert.equal(spawnSync("sqlite3", [upgradeDbPath], { input: seed, encoding: "utf8" }).status, 0);

      // Apply migration 39 through the repository runner.
      const upgrade = runMigrations({ ...baseEnv, DATABASE_URL: `file:${upgradeDbPath}` });
      assert.equal(upgrade.status, 0, `${upgrade.stdout}\n${upgrade.stderr}`);

      const query = (sql: string) =>
        spawnSync("sqlite3", [upgradeDbPath], { input: sql, encoding: "utf8" }).stdout.trim();

      assert.equal(query(`SELECT count(*) FROM "_prisma_migrations";`), String(EXPECTED_MIGRATION_COUNT));
      assert.equal(query(`PRAGMA integrity_check;`), "ok");
      assert.equal(query(`PRAGMA foreign_key_check;`), "");
      // The pre-existing row survived the rebuild, byte for byte, with the new
      // money columns null.
      assert.equal(
        query(
          `SELECT "eventId"||'|'||"eventType"||'|'||"sourceOwner"||'|'||"sourceEventId"||'|'||coalesce("providerAmount",'-')||'|'||coalesce("currencyCode",'-')||'|'||coalesce("currencyStatus",'-') FROM "AffiliateConversionEvent";`,
        ),
        "aaaabbbbccccddddeeeeffffgggghhhh|academy_registration|auth_register|user:legacy|-|-|-",
      );
      assert.equal(
        query(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='PocketProviderEvent';`),
        "1",
      );
    },
  );

  await check("B10 rerunning the migration runner is idempotent", () => {
    const rerun = runMigrations(baseEnv);
    assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
  });

  /* ------------------------------------------------------------------ */
  /* C. Parameter contract                                               */
  /* ------------------------------------------------------------------ */

  await check("C1 a valid deposit request is accepted", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    const response = await dep(learner.clickId, playerId, "282.70");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.ok(await eventFor(playerId));
  });

  await check("C2 click_id is accepted as an alias for clickid", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    const response = await send({
      goal: "dep",
      playerid: playerId,
      sum: "10.00",
      ow: SECRET,
      extra: { click_id: learner.clickId },
    });
    assert.equal(response.status, 200);
    assert.equal((await eventFor(playerId))?.pocketClickId, learner.clickId);
  });

  await check("C3 supplying BOTH clickid and click_id is ambiguous and refused", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    const response = await send({
      clickid: learner.clickId,
      goal: "dep",
      playerid: playerId,
      sum: "10.00",
      ow: SECRET,
      extra: { click_id: learner.clickId },
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "INVALID_DEPOSIT");
    assert.equal(await eventFor(playerId), null);
  });

  await check("C4 every duplicated field is refused", async () => {
    const learner = await createLearner();
    const ow = encodeURIComponent(SECRET);
    const cases: Array<[string, string]> = [
      ["clickid", `clickid=${learner.clickId}&clickid=${learner.clickId}&goal=dep&playerid=${nextPlayerId()}&sum=10.00&ow=${ow}`],
      ["playerid", `clickid=${learner.clickId}&goal=dep&playerid=${nextPlayerId()}&playerid=${nextPlayerId()}&sum=10.00&ow=${ow}`],
      ["sum", `clickid=${learner.clickId}&goal=dep&playerid=${nextPlayerId()}&sum=10.00&sum=20.00&ow=${ow}`],
    ];
    for (const [field, raw] of cases) {
      const response = await send({ raw });
      assert.equal(response.status, 400, `duplicated ${field} must be refused`);
    }
  });

  await check("C5 a duplicated goal selects the safe header-only mode", async () => {
    const learner = await createLearner();
    const raw = `clickid=${learner.clickId}&goal=dep&goal=dep&playerid=${nextPlayerId()}&sum=10.00&ow=${encodeURIComponent(SECRET)}`;
    const response = await send({ raw });
    assert.equal(response.status, 403);
  });

  await check("C6 a duplicated ow is ambiguous and refused", async () => {
    const learner = await createLearner();
    const ow = encodeURIComponent(SECRET);
    const raw = `clickid=${learner.clickId}&goal=dep&playerid=${nextPlayerId()}&sum=10.00&ow=${ow}&ow=${ow}`;
    const response = await send({ raw });
    assert.equal(response.status, 403);
  });

  await check("C7 a missing field is refused", async () => {
    const learner = await createLearner();
    const base = { goal: "dep", ow: SECRET } as const;
    const missing = [
      { ...base, playerid: nextPlayerId(), sum: "10.00" },
      { ...base, clickid: learner.clickId, sum: "10.00" },
      { ...base, clickid: learner.clickId, playerid: nextPlayerId() },
    ];
    for (const input of missing) {
      const response = await send(input);
      assert.equal(response.status, 400, `missing field must be refused: ${safeJson(input)}`);
    }
  });

  await check("C8 an empty field is refused", async () => {
    const learner = await createLearner();
    for (const input of [
      { clickid: "", goal: "dep", playerid: nextPlayerId(), sum: "10.00", ow: SECRET },
      { clickid: learner.clickId, goal: "dep", playerid: "", sum: "10.00", ow: SECRET },
      { clickid: learner.clickId, goal: "dep", playerid: nextPlayerId(), sum: "", ow: SECRET },
    ]) {
      const response = await send(input);
      assert.equal(response.status, 400, `empty field must be refused: ${safeJson(input)}`);
    }
  });

  await check("C9 a malformed click id is refused before any lookup", async () => {
    for (const clickid of [
      "tq-not-a-uuid",
      "../../etc/passwd",
      "tq-00000000-0000-0000-0000-000000000000' OR '1'='1",
      `tq-${"a".repeat(200)}`,
    ]) {
      const response = await send({
        clickid,
        goal: "dep",
        playerid: nextPlayerId(),
        sum: "10.00",
        ow: SECRET,
      });
      assert.equal(response.status, 400, `clickid ${clickid.slice(0, 20)} must be refused`);
    }
  });

  await check("C10 a malformed player id is refused", async () => {
    const learner = await createLearner();
    for (const playerid of ["0", "-1", "+1", "1.5", "1e3", "007", "abc", "9".repeat(20)]) {
      const response = await send({
        clickid: learner.clickId,
        goal: "dep",
        playerid,
        sum: "10.00",
        ow: SECRET,
      });
      assert.equal(response.status, 400, `playerid ${playerid} must be refused`);
    }
  });

  await check("C11 control characters are refused", async () => {
    const learner = await createLearner();
    const response = await send({
      raw: `clickid=${learner.clickId}&goal=dep&playerid=${nextPlayerId()}&sum=10.00%0d%0aInjected&ow=${encodeURIComponent(SECRET)}`,
    });
    assert.equal(response.status, 400);
  });

  await check("C12 an oversized query is refused before authentication", async () => {
    const learner = await createLearner();
    const response = await send({
      clickid: learner.clickId,
      goal: "dep",
      playerid: nextPlayerId(),
      sum: "10.00",
      ow: SECRET,
      extra: { padding: "x".repeat(1200) },
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "PARAM_TOO_LONG");
  });

  await check("C13 unknown unrelated parameters are ignored, not persisted", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    const response = await send({
      clickid: learner.clickId,
      goal: "dep",
      playerid: playerId,
      sum: "44.00",
      ow: SECRET,
      extra: { country: "PT", device_type: "mobile", promo: "spring" },
    });
    assert.equal(response.status, 200);
    const event = await eventFor(playerId);
    assert.ok(event);
    const dump = safeJson(event);
    for (const value of ["PT", "mobile", "spring"]) {
      assert.ok(!dump.includes(value), `unrelated parameter ${value} was persisted`);
    }
  });

  await check("C14 an unauthenticated deposit is refused and leaves no row", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    for (const ow of [undefined, "wrong-secret-value-000000", ""]) {
      const response = await send({
        clickid: learner.clickId,
        goal: "dep",
        playerid: playerId,
        sum: "10.00",
        ow: ow ?? null,
      });
      assert.equal(response.status, 403, `ow=${JSON.stringify(ow)} must not authenticate`);
    }
    assert.equal(await eventFor(playerId), null);
  });

  /* ------------------------------------------------------------------ */
  /* D. Amount                                                           */
  /* ------------------------------------------------------------------ */

  await check("D1 accepted amounts normalise canonically", () => {
    const expected: Array<[string, string]> = [
      ["282", "282.00"],
      ["282.7", "282.70"],
      ["282.70", "282.70"],
      ["0.50", "0.50"],
      ["0.05", "0.05"],
      ["1", "1.00"],
      ["999999999999.99", "999999999999.99"],
    ];
    for (const [input, normalized] of expected) {
      const result = amounts.parsePocketDepositAmount(input);
      assert.equal(result.ok, true, `${input} must be accepted`);
      assert.equal(result.ok && result.normalized, normalized);
    }
  });

  await check("D2 every forbidden spelling is rejected", () => {
    const rejected = [
      "0",
      "0.00",
      "0.0",
      "-1",
      "+1",
      "1e2",
      "1E2",
      "1,20",
      "1.234",
      " 12",
      "12 ",
      "",
      "NaN",
      "Infinity",
      "0x10",
      "1_000",
      "1.2.3",
      ".5",
      "5.",
      "01.00",
      "9999999999999.99",
      "$10",
    ];
    for (const input of rejected) {
      const result = amounts.parsePocketDepositAmount(input);
      assert.equal(result.ok, false, `${JSON.stringify(input)} must be rejected`);
    }
  });

  await check("D3 the stored amount is the canonical normalisation", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await dep(learner.clickId, playerId, "282.7");
    const event = await eventFor(playerId);
    assert.equal(event?.normalizedAmount, "282.70");
    assert.equal(amounts.isCanonicalPocketAmount(event!.normalizedAmount), true);
  });

  await check("D4 an integer amount is stored with two decimals", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await dep(learner.clickId, playerId, "282");
    assert.equal((await eventFor(playerId))?.normalizedAmount, "282.00");
  });

  await check("D5 a rejected amount creates no provider event", async () => {
    const learner = await createLearner();
    for (const sum of ["0", "-1", "1e2", "1,20", "1.234"]) {
      const playerId = nextPlayerId();
      const response = await dep(learner.clickId, playerId, sum);
      assert.equal(response.status, 400, `sum ${sum} must be refused`);
      assert.equal(await eventFor(playerId), null);
    }
  });

  await check("D6 the database itself refuses a non-canonical amount", async () => {
    await assert.rejects(
      prisma.pocketProviderEvent.create({
        data: {
          eventType: "first_deposit",
          pocketClickId: `tq-${crypto.randomUUID()}`,
          pocketPlayerId: nextPlayerId(),
          normalizedAmount: "282.7",
          firstReceivedAt: new Date(),
          lastReceivedAt: new Date(),
        },
      }),
    );
    await assert.rejects(
      prisma.pocketProviderEvent.create({
        data: {
          eventType: "first_deposit",
          pocketClickId: `tq-${crypto.randomUUID()}`,
          pocketPlayerId: nextPlayerId(),
          normalizedAmount: "0.00",
          firstReceivedAt: new Date(),
          lastReceivedAt: new Date(),
        },
      }),
    );
  });

  /* ------------------------------------------------------------------ */
  /* E. Identity                                                         */
  /* ------------------------------------------------------------------ */

  await check("E1 a deposit whose click and identity agree is matched", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);

    const response = await dep(learner.clickId, playerId, "150.00");
    assert.equal(response.status, 200);

    const event = await eventFor(playerId);
    assert.equal(event?.status, "matched");
    assert.equal(event?.matchedUserId, learner.userId);
    assert.ok(event?.matchedAt);
    assert.equal(event?.conflictCode, null);
    assert.equal((await conversionsFor(learner.userId)).length, 1);
  });

  await check("E2 a deposit with no bound identity is pending, with no conversion", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();

    const response = await dep(learner.clickId, playerId, "99.00");
    assert.equal(response.status, 200);

    const event = await eventFor(playerId);
    assert.equal(event?.status, "pending_identity");
    assert.equal(event?.matchedUserId, null);
    assert.equal(event?.matchedAt, null);
    assert.equal((await conversionsFor(learner.userId)).length, 0);
    // No identity was created by the deposit.
    assert.equal(
      await prisma.pocketTraderIdentity.findUnique({ where: { userId: learner.userId } }),
      null,
    );
  });

  await check("E3 an unknown click id leaves NO row that could block a later event", async () => {
    const playerId = nextPlayerId();
    const response = await send({
      clickid: `tq-${crypto.randomUUID()}`,
      goal: "dep",
      playerid: playerId,
      sum: "10.00",
      ow: SECRET,
    });
    assert.equal(response.status, 400);
    assert.equal(await eventFor(playerId), null);

    // The same player can still record a legitimate deposit afterwards.
    const learner = await createLearner();
    assert.equal((await dep(learner.clickId, playerId, "20.00")).status, 200);
    assert.equal((await eventFor(playerId))?.status, "pending_identity");
  });

  await check("E4 an unknown click id is indistinguishable from a malformed one", async () => {
    const unknown = await send({
      clickid: `tq-${crypto.randomUUID()}`,
      goal: "dep",
      playerid: nextPlayerId(),
      sum: "10.00",
      ow: SECRET,
    });
    const malformed = await send({
      clickid: "tq-broken",
      goal: "dep",
      playerid: nextPlayerId(),
      sum: "10.00",
      ow: SECRET,
    });
    assert.equal(unknown.status, malformed.status);
    assert.equal(await unknown.text(), await malformed.text());
  });

  await check("E5 a click/identity owner mismatch is quarantined, mutating nothing", async () => {
    const owner = await createLearner();
    const attacker = await createLearner();
    const playerId = nextPlayerId();
    // The player legally belongs to `owner`.
    await bindIdentity(owner.userId, playerId, owner.clickId);

    // A deposit arrives naming the ATTACKER's click id but the owner's player.
    const response = await dep(attacker.clickId, playerId, "500.00");
    assert.equal(response.status, 200);

    const event = await eventFor(playerId);
    assert.equal(event?.status, "conflict");
    assert.equal(event?.conflictCode, "identity_owner_mismatch");
    assert.equal(event?.matchedUserId, null);
    // No conversion for either party, and the identity is untouched.
    assert.equal((await conversionsFor(owner.userId)).length, 0);
    assert.equal((await conversionsFor(attacker.userId)).length, 0);
    const identity = await prisma.pocketTraderIdentity.findUnique({
      where: { pocketUserId: playerId },
    });
    assert.equal(identity?.userId, owner.userId);
    assert.equal(identity?.clickId, owner.clickId);
    assert.equal(
      await prisma.pocketTraderIdentity.findUnique({ where: { userId: attacker.userId } }),
      null,
    );
  });

  await check("E6 goal=dep never binds a Pocket identity", async () => {
    const before = await prisma.pocketTraderIdentity.count();
    const learner = await createLearner();
    await dep(learner.clickId, nextPlayerId(), "10.00");
    assert.equal(await prisma.pocketTraderIdentity.count(), before);
    assert.equal(
      await prisma.pocketTraderIdentity.findUnique({ where: { userId: learner.userId } }),
      null,
    );
  });

  await check("E7 the database forbids an identity sourced from anything but registration", async () => {
    const learner = await createLearner();
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "PocketTraderIdentity" ("userId","pocketUserId","clickId","source","boundAt","createdAt","updatedAt") VALUES (${learner.userId}, '${nextPlayerId()}', '${learner.clickId}', 'deposit_postback', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ),
    );
  });

  /* ------------------------------------------------------------------ */
  /* F. Idempotency                                                      */
  /* ------------------------------------------------------------------ */

  await check("F1 an identical replay creates no second event and no second conversion", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);

    const first = await dep(learner.clickId, playerId, "282.70");
    const second = await dep(learner.clickId, playerId, "282.70");
    const third = await dep(learner.clickId, playerId, "282.70");

    assert.equal(first.status, 200);
    // Byte-identical acknowledgements: the response is not an oracle.
    assert.equal(await second.text(), await third.text());
    assert.equal(second.status, 200);

    assert.equal(await prisma.pocketProviderEvent.count({ where: { pocketPlayerId: playerId } }), 1);
    assert.equal((await conversionsFor(learner.userId)).length, 1);

    const event = await eventFor(playerId);
    assert.equal(event?.replayCount, 2);
    assert.equal(event?.normalizedAmount, "282.70");
    assert.equal(event?.status, "matched");
  });

  await check("F2 a changed amount is quarantined and never overwrites", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);
    await dep(learner.clickId, playerId, "282.70");

    const response = await dep(learner.clickId, playerId, "999.99");
    assert.equal(response.status, 200);

    const event = await eventFor(playerId);
    // Canonical values untouched.
    assert.equal(event?.normalizedAmount, "282.70");
    assert.equal(event?.conflictCode, "amount_mismatch");
    assert.ok(event?.conflictDetectedAt);
    // Already matched, so the match and its canonical conversion survive.
    assert.equal(event?.status, "matched");
    assert.equal(event?.matchedUserId, learner.userId);
    const conversions = await conversionsFor(learner.userId);
    assert.equal(conversions.length, 1);
    assert.equal(conversions[0].providerAmount, "282.70");
  });

  await check("F3 a changed click id is quarantined and never reattributes", async () => {
    const learner = await createLearner();
    const other = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);
    await dep(learner.clickId, playerId, "120.00");

    const response = await dep(other.clickId, playerId, "120.00");
    assert.equal(response.status, 200);

    const event = await eventFor(playerId);
    assert.equal(event?.pocketClickId, learner.clickId);
    assert.equal(event?.conflictCode, "click_id_mismatch");
    assert.equal(event?.matchedUserId, learner.userId);
    assert.equal((await conversionsFor(other.userId)).length, 0);
    assert.equal((await conversionsFor(learner.userId)).length, 1);
  });

  await check("F4 the FIRST conflict reason is the one kept", async () => {
    const learner = await createLearner();
    const other = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);
    await dep(learner.clickId, playerId, "50.00");
    await dep(learner.clickId, playerId, "60.00"); // amount_mismatch first
    await dep(other.clickId, playerId, "50.00"); // then a click divergence

    assert.equal((await eventFor(playerId))?.conflictCode, "amount_mismatch");
  });

  await check("F5 concurrent identical callbacks settle on exactly one event", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);

    const responses = await Promise.all([
      dep(learner.clickId, playerId, "77.00"),
      dep(learner.clickId, playerId, "77.00"),
      dep(learner.clickId, playerId, "77.00"),
      dep(learner.clickId, playerId, "77.00"),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200, "no unhandled unique-constraint error");
    }
    assert.equal(await prisma.pocketProviderEvent.count({ where: { pocketPlayerId: playerId } }), 1);
    assert.equal((await conversionsFor(learner.userId)).length, 1);
  });

  await check("F6 the database itself forbids a second event for one player", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await dep(learner.clickId, playerId, "10.00");
    await assert.rejects(
      prisma.pocketProviderEvent.create({
        data: {
          eventType: "first_deposit",
          pocketClickId: learner.clickId,
          pocketPlayerId: playerId,
          normalizedAmount: "20.00",
          firstReceivedAt: new Date(),
          lastReceivedAt: new Date(),
        },
      }),
    );
  });

  await check("F7 the conversion ledger itself forbids a second first_deposit", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);
    await dep(learner.clickId, playerId, "10.00");
    const event = await eventFor(playerId);

    await assert.rejects(
      prisma.affiliateConversionEvent.create({
        data: {
          eventId: randomBase32Id(),
          eventType: "first_deposit",
          userId: learner.userId,
          sourceOwner: "pocket_first_deposit",
          sourceEventId: fd.firstDepositSourceEventId(event!.id),
          providerAmount: "10.00",
          currencyStatus: "unspecified",
          occurredAt: new Date(),
        },
      }),
    );
  });

  /* ------------------------------------------------------------------ */
  /* G. Reconciliation                                                   */
  /* ------------------------------------------------------------------ */

  await check("G1 a deposit before registration stays pending, then reconciles on goal=reg", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();

    // 1. The deposit arrives FIRST.
    assert.equal((await dep(learner.clickId, playerId, "310.25")).status, 200);
    let event = await eventFor(playerId);
    assert.equal(event?.status, "pending_identity");
    assert.equal((await conversionsFor(learner.userId)).length, 0);

    // 2. The trusted registration arrives second.
    const registration = await send({
      clickid: learner.clickId,
      goal: "reg",
      playerid: playerId,
      ow: SECRET,
    });
    assert.equal(registration.status, 200);

    // 3. The identity was bound by the REGISTRATION, and the deposit converged.
    const identity = await prisma.pocketTraderIdentity.findUnique({
      where: { pocketUserId: playerId },
    });
    assert.equal(identity?.userId, learner.userId);
    assert.equal(identity?.source, "registration_postback");

    event = await eventFor(playerId);
    assert.equal(event?.status, "matched");
    assert.equal(event?.matchedUserId, learner.userId);
    assert.equal(event?.normalizedAmount, "310.25");

    const conversions = await conversionsFor(learner.userId);
    assert.equal(conversions.length, 1);
    assert.equal(conversions[0].providerAmount, "310.25");
  });

  await check("G2 replaying the registration reconciles idempotently", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await dep(learner.clickId, playerId, "45.00");

    for (let i = 0; i < 3; i += 1) {
      const response = await send({
        clickid: learner.clickId,
        goal: "reg",
        playerid: playerId,
        ow: SECRET,
      });
      assert.equal(response.status, 200);
    }

    assert.equal((await eventFor(playerId))?.status, "matched");
    assert.equal((await conversionsFor(learner.userId)).length, 1);
  });

  await check("G3 a pending deposit reconciles on the provider's own retry too", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await dep(learner.clickId, playerId, "60.00");
    assert.equal((await eventFor(playerId))?.status, "pending_identity");

    // The identity is bound out of band (as a registration would).
    await bindIdentity(learner.userId, playerId, learner.clickId);

    // An identical redelivery of the deposit now converges.
    assert.equal((await dep(learner.clickId, playerId, "60.00")).status, 200);
    assert.equal((await eventFor(playerId))?.status, "matched");
    assert.equal((await conversionsFor(learner.userId)).length, 1);
  });

  await check("G4 a registration binding a DIFFERENT learner quarantines the pending deposit", async () => {
    const depositor = await createLearner();
    const registrant = await createLearner();
    const playerId = nextPlayerId();

    // The deposit names the depositor's click.
    await dep(depositor.clickId, playerId, "80.00");
    assert.equal((await eventFor(playerId))?.status, "pending_identity");

    // But the registration binds that player to somebody else entirely.
    const registration = await send({
      clickid: registrant.clickId,
      goal: "reg",
      playerid: playerId,
      ow: SECRET,
    });
    assert.equal(registration.status, 200);

    // The identity owner stays authoritative, and the deposit counts for nobody.
    const identity = await prisma.pocketTraderIdentity.findUnique({
      where: { pocketUserId: playerId },
    });
    assert.equal(identity?.userId, registrant.userId);

    const event = await eventFor(playerId);
    assert.equal(event?.status, "conflict");
    assert.equal(event?.conflictCode, "identity_owner_mismatch");
    assert.equal(event?.matchedUserId, null);
    assert.equal((await conversionsFor(depositor.userId)).length, 0);
    assert.equal((await conversionsFor(registrant.userId)).length, 0);
  });

  await check("G5 registration still completes Level 1 with zero XP when a deposit is pending", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await dep(learner.clickId, playerId, "70.00");

    const response = await send({
      clickid: learner.clickId,
      goal: "reg",
      playerid: playerId,
      ow: SECRET,
    });
    assert.equal(response.status, 200);

    // The registration owner did its job, and the deposit awarded nothing.
    const account = await prisma.exchangeAccount.findFirst({ where: { userId: learner.userId } });
    assert.equal(account?.registrationStatus, true);
    assert.equal(
      await prisma.xPTransaction.count({ where: { userId: learner.userId } }),
      0,
      "a deposit or registration must award no XP",
    );
  });

  await check("G6 the operator command dry-run reports counts and changes nothing", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await dep(learner.clickId, playerId, "90.00");
    await bindIdentity(learner.userId, playerId, learner.clickId);

    const before = await prisma.affiliateConversionEvent.count({
      where: { eventType: "first_deposit" },
    });
    const result = spawnSync(
      process.execPath,
      [
        path.join("node_modules", "tsx", "dist", "cli.mjs"),
        path.join("scripts", "ops", "reconcilePocketFirstDeposits.ts"),
      ],
      { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "dry-run");
    assert.ok(report.inspected >= 1);
    assert.equal(
      await prisma.affiliateConversionEvent.count({ where: { eventType: "first_deposit" } }),
      before,
      "a dry run must create no conversion",
    );
    assert.equal((await eventFor(playerId))?.status, "pending_identity");

    // Counts only: no identifier from the data reaches stdout.
    assert.ok(!result.stdout.includes(playerId));
    assert.ok(!result.stdout.includes(learner.clickId));
    assert.ok(!result.stdout.includes("90.00"));
    assert.ok(!result.stdout.includes(SECRET));
  });

  await check("G7 the operator command applies, and is idempotent on a second run", async () => {
    const run = () =>
      spawnSync(
        process.execPath,
        [
          path.join("node_modules", "tsx", "dist", "cli.mjs"),
          path.join("scripts", "ops", "reconcilePocketFirstDeposits.ts"),
          "--apply",
        ],
        { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
      );

    const first = run();
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const report = JSON.parse(first.stdout);
    assert.equal(report.mode, "apply");
    assert.ok(report.matched >= 1, "at least the G6 learner must reconcile");
    assert.equal(report.conversion_events_created, report.matched);
    assert.equal(report.errors, 0);

    const second = run();
    assert.equal(second.status, 0);
    const repeat = JSON.parse(second.stdout);
    assert.equal(repeat.matched, 0, "a second run must find nothing left to match");
    assert.equal(repeat.conversion_events_created, 0);
  });

  await check("G8 the operator command refuses to run while first deposit is disabled", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join("node_modules", "tsx", "dist", "cli.mjs"),
        path.join("scripts", "ops", "reconcilePocketFirstDeposits.ts"),
        "--apply",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: dbUrl, POCKET_FIRST_DEPOSIT_ENABLED: "false" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 2);
    assert.ok(!result.stderr.includes(SECRET));
  });

  /* ------------------------------------------------------------------ */
  /* H. Attribution                                                      */
  /* ------------------------------------------------------------------ */

  await check("H1 an attributed learner's deposit reuses the frozen attribution", async () => {
    const learner = await createLearner();
    const graph = await attributeLearner(learner.userId);
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);

    await dep(learner.clickId, playerId, "282.70");

    const conversions = await conversionsFor(learner.userId);
    assert.equal(conversions.length, 1);
    const conversion = conversions[0];
    assert.equal(conversion.attributionId, graph.attribution.id);
    assert.equal(conversion.selectedClickId, graph.click.id);
    assert.equal(conversion.affiliatePartnerId, graph.partner.id);
    assert.equal(conversion.affiliateCampaignId, graph.campaign.id);
    assert.equal(conversion.trackingLinkId, graph.link.id);
    assert.equal(conversion.affiliateCodeSnapshot, graph.partner.code);
    assert.equal(conversion.campaignCodeSnapshot, graph.campaign.code);
    assert.equal(conversion.trackingLinkPublicCodeSnapshot, graph.link.publicCode);
    assert.equal(conversion.providerAmount, "282.70");
  });

  await check("H2 a direct learner's deposit is recorded with null affiliate columns", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);

    await dep(learner.clickId, playerId, "42.00");

    const conversions = await conversionsFor(learner.userId);
    assert.equal(conversions.length, 1);
    const conversion = conversions[0];
    assert.equal(conversion.attributionId, null);
    assert.equal(conversion.selectedClickId, null);
    assert.equal(conversion.affiliatePartnerId, null);
    assert.equal(conversion.affiliateCampaignId, null);
    assert.equal(conversion.trackingLinkId, null);
    assert.equal(conversion.affiliateCodeSnapshot, null);
    // A direct deposit still produces a row.
    assert.equal(conversion.providerAmount, "42.00");
  });

  await check("H3 a later click cannot retroactively attribute a deposit", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);

    // The learner was direct at registration. A brand-new affiliate click
    // appears AFTER, which must not be able to claim the deposit.
    const graph = await attributeLearner((await createLearner()).userId);
    await prisma.affiliateClick.create({
      data: {
        ataClickId: randomBase32Id(),
        trackingLinkId: graph.link.id,
        anonymousVisitorId: randomBase32Id(),
        classification: "qualified",
        effectiveAttributionWindowDays: 30,
        occurredAt: new Date(),
      },
    });

    await dep(learner.clickId, playerId, "33.00");

    const conversion = (await conversionsFor(learner.userId))[0];
    assert.equal(conversion.attributionId, null);
    assert.equal(conversion.affiliatePartnerId, null);
  });

  await check("H4 the deposit performs no attribution write of its own", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);

    const before = {
      attributions: await prisma.affiliateAttribution.count(),
      clicks: await prisma.affiliateClick.count(),
    };
    await dep(learner.clickId, playerId, "12.00");
    assert.equal(await prisma.affiliateAttribution.count(), before.attributions);
    assert.equal(await prisma.affiliateClick.count(), before.clicks);
  });

  await check("H5 academy_registration rows never acquire money columns", async () => {
    // Seeded explicitly. This suite drives the POSTBACK route, which never
    // writes a registration conversion, so without this row the UPDATE below
    // would match nothing and the assertion would pass vacuously.
    const learner = await createLearner();
    await prisma.affiliateConversionEvent.create({
      data: {
        eventId: randomBase32Id(),
        eventType: "academy_registration",
        userId: learner.userId,
        sourceOwner: "auth_register",
        sourceEventId: `user:${learner.userId}`,
        occurredAt: new Date(),
      },
    });

    const rows = await prisma.affiliateConversionEvent.findMany({
      where: { eventType: "academy_registration" },
    });
    assert.ok(rows.length > 0, "the guard must be exercised against a real row");
    for (const row of rows) {
      assert.equal(row.providerAmount, null);
      assert.equal(row.currencyCode, null);
      assert.equal(row.currencyStatus, null);
    }

    // And the database itself refuses to give one an amount.
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `UPDATE "AffiliateConversionEvent" SET "providerAmount" = '10.00' WHERE "eventType" = 'academy_registration'`,
      ),
    );
    // A registration conversion may not be minted by the deposit owner either.
    await assert.rejects(
      prisma.affiliateConversionEvent.create({
        data: {
          eventId: randomBase32Id(),
          eventType: "academy_registration",
          userId: learner.userId,
          sourceOwner: "pocket_first_deposit",
          sourceEventId: "pocket-first-deposit:999999",
          occurredAt: new Date(),
        },
      }),
    );
  });

  await check("H6 an unspecified currency is explicit, never defaulted to USD", async () => {
    const rows = await prisma.affiliateConversionEvent.findMany({
      where: { eventType: "first_deposit" },
    });
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.currencyStatus, "unspecified");
      assert.equal(row.currencyCode, null);
    }
    const events = await prisma.pocketProviderEvent.findMany();
    for (const event of events) {
      assert.equal(event.currencyStatus, "unspecified");
      assert.equal(event.currencyCode, null);
    }
  });

  await check("H7 a configured currency is stamped on the deposit", async () => {
    process.env.POCKET_DEPOSIT_CURRENCY = "EUR";
    try {
      const learner = await createLearner();
      const playerId = nextPlayerId();
      await bindIdentity(learner.userId, playerId, learner.clickId);
      await dep(learner.clickId, playerId, "55.00");

      const event = await eventFor(playerId);
      assert.equal(event?.currencyStatus, "configured");
      assert.equal(event?.currencyCode, "EUR");

      const conversion = (await conversionsFor(learner.userId))[0];
      assert.equal(conversion.currencyStatus, "configured");
      assert.equal(conversion.currencyCode, "EUR");
    } finally {
      delete process.env.POCKET_DEPOSIT_CURRENCY;
    }
  });

  /* ------------------------------------------------------------------ */
  /* I. Safety                                                           */
  /* ------------------------------------------------------------------ */

  await check("I1 no deposit ever awarded XP or completed a level", async () => {
    assert.equal(await prisma.xPTransaction.count(), 0);
    // Every level progress row in this suite came from the registration owner,
    // and none of them names a deposit.
    const progress = await prisma.userLevelProgress.findMany({
      select: { completionMethod: true },
    });
    for (const row of progress) {
      assert.notEqual(row.completionMethod, "deposit");
      assert.notEqual(row.completionMethod, "first_deposit");
    }
  });

  await check("I2 no balance is persisted, derived or returned", async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("AffiliateConversionEvent")',
    );
    for (const column of columns) {
      assert.ok(!column.name.toLowerCase().includes("balance"), `found ${column.name}`);
    }
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);
    const response = await dep(learner.clickId, playerId, "15.00");
    const body = await response.text();
    assert.ok(!body.toLowerCase().includes("balance"));
    assert.equal(body, JSON.stringify({ ok: true }));
  });

  await check("I3 redeposit exists as its own type and can never become an FTD", async () => {
    // WHAT THIS ASSERTION USED TO SAY, AND WHY IT CHANGED. It asserted that the
    // string "redeposit" appeared nowhere in the schema — a correct guard while
    // the redeposit family was unbuilt, because anything resembling one would
    // have been fabricated money. POCKET-DEP-RDEP-1 built the family
    // deliberately, so asserting its ABSENCE now guards nothing and would fail
    // permanently. What still needs guarding is the boundary between the two:
    // a redeposit must never be counted as, or promoted into, a first deposit.
    const rows = await prisma.$queryRawUnsafe<Array<{ sql: string }>>(
      "SELECT sql FROM sqlite_master WHERE name = 'PocketProviderEvent'",
    );
    const ddl = rows.map((r) => r.sql).join("\n");
    assert.match(ddl, /'first_deposit'\s*,\s*'redeposit'/, "eventType admits exactly these two");

    // The FTD guarantee survives the widening: still exactly one first_deposit
    // per (provider, player), now expressed as a PARTIAL unique so a player may
    // hold many redeposits.
    const indexes = await prisma.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='PocketProviderEvent'",
    );
    const ftd = indexes.find((i) => i.name === "PocketProviderEvent_first_deposit_player_key");
    assert.ok(ftd, "the first-deposit partial unique must exist");
    assert.match(ftd!.sql ?? "", /WHERE\s+"?eventType"?\s*=\s*'first_deposit'/i);

    // And the source refuses to promote a redeposit into a first deposit, which
    // is the behaviour the schema alone cannot express.
    //
    // ASSERT ON THE WRITES, NOT ON THE FILE. A first draft of this check
    // searched the whole file for `eventType: "first_deposit"` and failed on a
    // findFirst WHERE clause — the redeposit path legitimately READS whether an
    // FTD already exists for the player. Matching a query filter as though it
    // were a write is a false positive, so only `create` arguments are examined.
    const redeposit = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "growth", "pocket", "redeposit.ts"),
      "utf8",
    );
    const creates = [...redeposit.matchAll(/pocketProviderEvent\.create\(\{([\s\S]*?)\n {4}\}\)/g)];
    assert.ok(creates.length > 0, "the redeposit path must create a provider event");
    for (const [, body] of creates) {
      const eventType = /eventType:\s*"([a-z_]+)"/.exec(body)?.[1];
      assert.equal(eventType, "redeposit", "a redeposit write must never be typed as a first deposit");
    }
  });

  await check("I4 nothing logs the secret, the query string or a Pocket identifier", async () => {
    const capture = captureConsole();
    let learner: { userId: number; clickId: string };
    let playerId: string;
    try {
      learner = await createLearner();
      playerId = nextPlayerId();
      await dep(learner.clickId, playerId, "282.70");
      await dep(learner.clickId, playerId, "282.70");
      await dep(learner.clickId, playerId, "999.99");
      await send({ clickid: "tq-bad", goal: "dep", playerid: playerId, sum: "1.00", ow: SECRET });
    } finally {
      capture.restore();
    }
    const logged = capture.lines.join("\n");
    for (const forbidden of [
      SECRET,
      "ow=",
      "api/postbacks/pocket?",
      learner!.clickId,
      playerId!,
      "282.70",
    ]) {
      assert.ok(!logged.includes(forbidden), `logged ${forbidden}: ${logged.slice(0, 300)}`);
    }
  });

  await check("I5 no audit row retains a secret, click id, player id or amount", async () => {
    const audits = await prisma.auditLog.findMany();
    const dump = safeJson(audits);
    assert.ok(!dump.includes(SECRET));
    assert.ok(!dump.includes("ow="));
    for (const event of await prisma.pocketProviderEvent.findMany({ take: 20 })) {
      // AFD-5B2A-FINAL — these were raw substring matches. An amount like `260`
      // occurs by chance inside a cuid, a UUID or an ISO timestamp in the same
      // dump, so the check failed without anything having leaked. `leaksValue`
      // requires the value to appear on token boundaries, which is how a real
      // leak appears in JSON; detection is unchanged.
      assert.ok(!leaksValue(dump, event.pocketClickId), "an audit row leaked a click id");
      assert.ok(!leaksValue(dump, event.pocketPlayerId), "an audit row leaked a player id");
      assert.ok(!leaksValue(dump, event.normalizedAmount), "an audit row leaked an amount");
    }
  });

  await check("I6 a conflict is audited with a bounded reason only", async () => {
    const audits = await prisma.auditLog.findMany({
      where: { action: "POCKET_FIRST_DEPOSIT_CONFLICT" },
    });
    assert.ok(audits.length > 0, "conflicts must be visible to an operator");
    for (const audit of audits) {
      const metadata = safeJson(audit.metadata ?? {});
      assert.ok(
        /amount_mismatch|click_id_mismatch|identity_owner_mismatch|click_owner_missing|conflict/.test(
          metadata,
        ),
        `unexpected conflict metadata: ${metadata}`,
      );
    }
  });

  await check("I7 a successful replay creates no audit noise", async () => {
    const learner = await createLearner();
    const playerId = nextPlayerId();
    await bindIdentity(learner.userId, playerId, learner.clickId);
    await dep(learner.clickId, playerId, "11.00");

    const before = await prisma.auditLog.count();
    for (let i = 0; i < 5; i += 1) await dep(learner.clickId, playerId, "11.00");
    assert.equal(await prisma.auditLog.count(), before, "replays must not grow the audit log");
    assert.equal((await eventFor(playerId))?.replayCount, 5);
  });

  await check("I8 the conversion source key names a row, never a Pocket identifier", async () => {
    const rows = await prisma.affiliateConversionEvent.findMany({
      where: { eventType: "first_deposit" },
    });
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.sourceOwner, "pocket_first_deposit");
      assert.match(row.sourceEventId, /^pocket-first-deposit:\d+$/);
      const event = await prisma.pocketProviderEvent.findUnique({
        where: { id: Number(row.sourceEventId.split(":")[1]) },
      });
      assert.ok(event, "the source key must resolve to a provider event");
      assert.ok(!row.sourceEventId.includes(event.pocketPlayerId));
      assert.ok(!row.sourceEventId.includes(event.pocketClickId));
    }
  });

  await prisma.$disconnect();
}

main()
  .then(() => {
    cleanup();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error) => {
    cleanup();
    console.error(error);
    process.exit(1);
  });
