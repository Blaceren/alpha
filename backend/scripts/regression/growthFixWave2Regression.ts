/**
 * G4-PREPROD-GROWTH-FOUNDATION-FIX-WAVE-2 — the regression suite for the five
 * HIGH findings of the independent re-audit, plus the general bounded-rate audit
 * the brief requires instead of five point fixes.
 *
 * EVERY TEST HERE IS A BASELINE-FAIL / FIX-PASS PAIR IN SPIRIT. Each one builds
 * the exact population shape the re-audit used to produce the invalid statement,
 * and asserts the statement is now unproducible. Where the old arithmetic is
 * still reachable as a function, the test computes it too and asserts it WOULD
 * have been wrong — so the fixture cannot silently stop reproducing the defect
 * and leave a green test proving nothing. That is the failure mode
 * `31_TEST_QUALITY.md` found in the previous wave's suite.
 *
 * REAL DATABASE, REAL MIGRATION, REAL QUERIES. The fixture is built at
 * migration 46 and migrated by the real runner, so the migration's own
 * normalisation and predicate are under test, not a copy of them.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const REPO = path.resolve(__dirname, "..", "..");
const DB_PATH = path.join(os.tmpdir(), `ata-g4-fixwave2-${process.pid}.db`);

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

/** Epoch milliseconds, the canonical representation under test. */
function ms(iso: string): number {
  return Date.parse(iso);
}

function sqlite(sql: string): string {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" });
}

/**
 * Build the database exactly as a deployment would: migration 46, then source
 * rows, then the real migration 47 through the real runner.
 */
function buildFixture(sourceSql: string) {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }
  const all = fs.readdirSync(path.join(REPO, "prisma", "migrations")).sort();
  const growth = all.filter((n) => n.includes("growth_event_foundation"));
  assert.equal(growth.length, 1, "exactly one growth migration must exist");

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "ata-g4-fw2-mig-"));
  const stage = (names: string[]) => {
    const root = path.join(staging, `s${names.length}`, "prisma", "migrations");
    fs.rmSync(path.join(staging, `s${names.length}`), { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    for (const n of names) {
      fs.cpSync(path.join(REPO, "prisma", "migrations", n), path.join(root, n), {
        recursive: true,
      });
    }
    return path.join(staging, `s${names.length}`);
  };

  const before = stage(all.filter((n) => !n.includes("growth_event_foundation")));
  const withGrowth = stage(all);

  const run = (cwd: string) =>
    execFileSync(
      path.join(REPO, "node_modules", ".bin", "tsx"),
      [path.join(REPO, "prisma", "migrate.ts")],
      { cwd, env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: "pipe" },
    );

  run(before);
  if (sourceSql.trim().length > 0) execFileSync("sqlite3", [DB_PATH, sourceSql]);
  run(withGrowth);
  fs.rmSync(staging, { recursive: true, force: true });
}

/**
 * §106 — ONE FIXTURE CARRYING EVERY PROBLEM CLASS AT ONCE.
 *
 * Tracked clicks and organic registrations · unknown-origin historical users ·
 * admin-created staff with and without a StaffProfile · a self-service learner
 * later promoted to staff · registrations spread over two months · activation,
 * Pocket registration and deposit all lagging into a later month · reports
 * submitted in month A and approved in month B · a pending report · a rejected
 * and resubmitted report · explicit level starts · a financial-checkpoint
 * completion with no start · and source rows whose timestamps are TEXT rather
 * than integers.
 *
 * A rate that survives this fixture bounded is bounded for a reason.
 */
const JAN = "2026-01";
const FEB = "2026-02";

function adversarialFixture(): string {
  const rows: string[] = [];
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

  rows.push(`INSERT INTO "CurriculumVersion" ("id","code","name","status","versionNumber","publishedAt","createdAt")
    VALUES (1,'ATA','fw2',' published'||'',1,${ms("2026-01-01T00:00:00Z")},${ms("2026-01-01T00:00:00Z")});`);
  rows.push(`UPDATE "CurriculumVersion" SET "status"='published' WHERE id=1;`);
  rows.push(`INSERT INTO "ModuleDefinition" ("id","curriculumVersionId","moduleNumber","code","title","firstLevel","lastLevel","status")
    VALUES (1,1,1,'M1','Module 1',1,10,'active');`);
  rows.push(`INSERT INTO "LevelDefinition" ("id","curriculumVersionId","moduleId","levelNumber","stableCode","type","title","completionMethod","status") VALUES
    (1,1,1,1,'L1','lesson','L1','auto','active'),
    (2,1,1,2,'L2','lesson','L2','auto','active'),
    (5,1,1,5,'L5','financial_checkpoint','CP','checkpoint','active');`);

  // -- acquisition: one partner, one campaign, one link, 20 January clicks.
  rows.push(`INSERT INTO "User" ("id","email","name","createdAt","updatedAt","passwordHash","role","referralCode")
    VALUES (900,'ops@fw2.invalid','Ops',${ms("2026-01-01T00:00:00Z")},${ms("2026-01-01T00:00:00Z")},'h','admin','ops900');`);
  rows.push(`INSERT INTO "AffiliatePartner" ("id","code","displayName","createdByUserId","createdAt","updatedAt")
    VALUES (1,'partner-fw2','P',900,${ms("2026-01-01T00:00:00Z")},${ms("2026-01-01T00:00:00Z")});`);
  rows.push(`INSERT INTO "AffiliateCampaign" ("id","affiliatePartnerId","code","displayName","createdByUserId","createdAt","updatedAt")
    VALUES (1,1,'camp-fw2','C',900,${ms("2026-01-01T00:00:00Z")},${ms("2026-01-01T00:00:00Z")});`);
  // Deterministic and well-distributed: the base-32 rendering of a counted
  // sequence, padded. A PRNG is not needed and a weak one produced collisions.
  const b32 = (seed: number, len = 32) => {
    const A = "abcdefghijklmnopqrstuvwxyz234567";
    let out = "";
    let x = seed + 1;
    for (let i = 0; i < len; i += 1) {
      out += A[x % A.length];
      x = Math.floor(x / A.length) + (i + 1) * 7 + seed;
    }
    return out;
  };
  rows.push(`INSERT INTO "AffiliateTrackingLink" ("id","affiliatePartnerId","affiliateCampaignId","publicCode","displayName","status","createdByUserId","createdAt","updatedAt")
    VALUES (1,1,1,${q(b32(7))},'L','active',900,${ms("2026-01-01T00:00:00Z")},${ms("2026-01-01T00:00:00Z")});`);

  const clicks: string[] = [];
  const users: string[] = [];
  const audits: string[] = [];
  const attrs: string[] = [];
  for (let i = 1; i <= 20; i += 1) {
    clicks.push(
      `(${i},${q(b32(100 + i))},1,${q(b32(500 + i))},'qualified',30,${ms(`${JAN}-05T00:00:00Z`)},${ms(`${JAN}-05T00:00:00Z`)})`,
    );
  }
  // ONE February click. It is what gives the OLD arithmetic a non-zero
  // denominator to be wrong about: 2 February registrations (from January
  // clicks) over 1 February click reads as 200%.
  clicks.push(
    `(21,${q(b32(121))},1,${q(b32(521))},'qualified',30,${ms(`${FEB}-05T00:00:00Z`)},${ms(`${FEB}-05T00:00:00Z`)})`,
  );
  rows.push(
    `INSERT INTO "AffiliateClick" ("id","ataClickId","trackingLinkId","anonymousVisitorId","classification","effectiveAttributionWindowDays","occurredAt","createdAt") VALUES ${clicks.join(",")};`,
  );

  // 12 of the 20 clicks register — 6 in January, 6 in FEBRUARY (the lag that
  // produced 683% when clicks and registrations were counted per window).
  for (let i = 1; i <= 12; i += 1) {
    const when = i <= 10 ? `${JAN}-06T00:00:00Z` : `${FEB}-10T00:00:00Z`;
    users.push(
      `(${i},'attr${i}@fw2.invalid','A${i}',${ms(when)},${ms(when)},'h','user',${q(`ra${i}`)})`,
    );
    audits.push(`(${i},'AUTH_REGISTER',${ms(when)})`);
    attrs.push(
      `(${i},${i},${q(b32(500 + i))},${i},${i},${i},'last_eligible_affiliate_click',${ms(when)},${ms(when)},'registration_cookie')`,
    );
  }
  // 10 organic self-service registrations, no click at all.
  for (let i = 21; i <= 30; i += 1) {
    users.push(
      `(${i},'org${i}@fw2.invalid','O${i}',${ms(`${JAN}-07T00:00:00Z`)},${ms(`${JAN}-07T00:00:00Z`)},'h','user',${q(`ro${i}`)})`,
    );
    audits.push(`(${i},'AUTH_REGISTER',${ms(`${JAN}-07T00:00:00Z`)})`);
  }
  // 5 unknown-origin historical users: no AUTH_REGISTER, but they DO hold
  // NotificationSettings — the artefact the old predicate accepted.
  for (let i = 41; i <= 45; i += 1) {
    users.push(
      `(${i},'unk${i}@fw2.invalid','U${i}',${ms(`${JAN}-02T00:00:00Z`)},${ms(`${JAN}-02T00:00:00Z`)},'h','user',${q(`ru${i}`)})`,
    );
  }
  // R4: admin-created staff WITHOUT a StaffProfile, with notification settings.
  users.push(
    `(51,'staff51@fw2.invalid','S51',${ms(`${JAN}-03T00:00:00Z`)},${ms(`${JAN}-03T00:00:00Z`)},'h','admin','rs51')`,
  );
  users.push(
    `(52,'staff52@fw2.invalid','S52',${ms(`${JAN}-03T00:00:00Z`)},${ms(`${JAN}-03T00:00:00Z`)},'h','news_editor','rs52')`,
  );
  // R4: admin-created staff WITH a StaffProfile.
  users.push(
    `(53,'staff53@fw2.invalid','S53',${ms(`${JAN}-03T00:00:00Z`)},${ms(`${JAN}-03T00:00:00Z`)},'h','support','rs53')`,
  );
  // R4: a self-service learner LATER PROMOTED to staff. Must still count.
  users.push(
    `(54,'promoted@fw2.invalid','S54',${ms(`${JAN}-04T00:00:00Z`)},${ms(`${JAN}-04T00:00:00Z`)},'h','admin','rs54')`,
  );
  audits.push(`(54,'AUTH_REGISTER',${ms(`${JAN}-04T00:00:00Z`)})`);
  // R3: a source row whose createdAt is TEXT, exactly like frozen PREPROD.
  users.push(
    `(60,'texttime@fw2.invalid','T60','2026-01-08 10:11:12','2026-01-08 10:11:12','h','user','rt60')`,
  );
  audits.push(`(60,'AUTH_REGISTER',${ms(`${JAN}-08T10:11:12Z`)})`);

  rows.push(
    `INSERT INTO "User" ("id","email","name","createdAt","updatedAt","passwordHash","role","referralCode") VALUES ${users.join(",")};`,
  );
  rows.push(`INSERT INTO "AuditLog" ("userId","action","createdAt") VALUES ${audits.join(",")};`);
  rows.push(
    `INSERT INTO "AffiliateAttribution" ("id","userId","anonymousVisitorId","firstTouchClickId","lastTouchClickId","selectedClickId","attributionModel","selectedAt","frozenAt","selectionReason") VALUES ${attrs.join(",")};`,
  );
  // Notification settings for the unknown-origin users and the staff accounts —
  // the exact artefact the old negative-inference predicate accepted.
  const ns = [41, 42, 43, 44, 45, 51, 52]
    .map((id) => `(${id},${ms(`${FEB}-01T00:00:00Z`)},${ms(`${FEB}-01T00:00:00Z`)})`)
    .join(",");
  rows.push(`INSERT INTO "NotificationSettings" ("userId","createdAt","updatedAt") VALUES ${ns};`);
  rows.push(`INSERT INTO "StaffProfile" ("id","userId","displayName","staffRole","createdAt","updatedAt")
    VALUES ('cmfw2staff53000000000000',53,'S53','support',${ms(`${JAN}-03T00:00:00Z`)},${ms(`${JAN}-03T00:00:00Z`)}),
           ('cmfw2staff54000000000000',54,'S54','crm_admin',${ms(`${JAN}-04T00:00:00Z`)},${ms(`${JAN}-04T00:00:00Z`)});`);

  // Enrollments and progression. Learner 1 activates in FEBRUARY from a JANUARY
  // click — the lag that produced 583%. Learner 41 (unknown origin) enrolls too,
  // which is what made the downstream event quotients exceed 1.
  const enr: string[] = [];
  const prog: string[] = [];
  for (const [eid, uid, when] of [
    [1, 1, `${JAN}-06T01:00:00Z`],
    [2, 2, `${JAN}-06T01:00:00Z`],
    [3, 21, `${JAN}-07T01:00:00Z`],
    [4, 41, `${JAN}-09T01:00:00Z`],
    [5, 60, `${JAN}-08T11:00:00Z`],
  ] as Array<[number, number, string]>) {
    enr.push(`(${eid},${uid},1,'ATA','active',${ms(when)},${ms(when)},${ms(when)})`);
  }
  rows.push(
    `INSERT INTO "UserCurriculumEnrollment" ("id","userId","curriculumVersionId","curriculumCode","status","enrolledAt","createdAt","updatedAt") VALUES ${enr.join(",")};`,
  );
  // enrollment 1: L1 started in Jan, completed in FEBRUARY (activation lag)
  prog.push(
    `(1,1,1,1,'completed',${ms(`${JAN}-06T02:00:00Z`)},${ms(`${FEB}-12T00:00:00Z`)},'auto',${ms(`${JAN}-06T02:00:00Z`)},${ms(`${FEB}-12T00:00:00Z`)})`,
  );
  // enrollment 2: L1 started, still in progress
  prog.push(
    `(2,2,1,1,'in_progress',${ms(`${JAN}-06T02:00:00Z`)},NULL,NULL,${ms(`${JAN}-06T02:00:00Z`)},${ms(`${JAN}-06T02:00:00Z`)})`,
  );
  // enrollment 3: a FINANCIAL CHECKPOINT completed with no explicit start (H1)
  prog.push(
    `(3,3,1,5,'completed',${ms(`${JAN}-20T00:00:00Z`)},${ms(`${JAN}-20T00:01:00Z`)},'checkpoint_verification',${ms(`${JAN}-20T00:00:00Z`)},${ms(`${JAN}-20T00:01:00Z`)})`,
  );
  // enrollment 4: the unknown-origin learner completes a level (R4 downstream)
  prog.push(
    `(4,4,1,1,'completed',${ms(`${JAN}-09T02:00:00Z`)},${ms(`${JAN}-10T00:00:00Z`)},'auto',${ms(`${JAN}-09T02:00:00Z`)},${ms(`${JAN}-10T00:00:00Z`)})`,
  );
  // enrollment 5: TEXT timestamps on the progress row itself (R3)
  prog.push(
    `(5,5,1,1,'completed','2026-01-08 11:30:00','2026-01-09 12:00:00','auto','2026-01-08 11:30:00','2026-01-09 12:00:00')`,
  );
  rows.push(
    `INSERT INTO "UserLevelProgress" ("id","enrollmentId","curriculumVersionId","levelDefinitionId","status","startedAt","completedAt","completionMethod","createdAt","updatedAt") VALUES ${prog.join(",")};`,
  );

  // Pocket: learner 1 (January cohort) registers and deposits in FEBRUARY.
  rows.push(`INSERT INTO "PocketTraderIdentity" ("userId","pocketUserId","clickId","source","boundAt","createdAt","updatedAt")
    VALUES (1,'770001','tq-fw2','registration_postback',${ms(`${FEB}-14T00:00:00Z`)},${ms(`${FEB}-14T00:00:00Z`)},${ms(`${FEB}-14T00:00:00Z`)});`);
  rows.push(`INSERT INTO "PocketProviderEvent" ("provider","eventType","pocketClickId","pocketPlayerId","matchedUserId","matchedAt","normalizedAmount","currencyCode","currencyStatus","status","firstReceivedAt","lastReceivedAt","replayCount","createdAt","updatedAt")
    VALUES ('pocket','first_deposit','tq-fw2','770001',1,${ms(`${FEB}-15T00:00:00Z`)},'55.01','USD','configured','matched',${ms(`${FEB}-15T00:00:00Z`)},${ms(`${FEB}-15T00:00:00Z`)},0,${ms(`${FEB}-15T00:00:00Z`)},${ms(`${FEB}-15T00:00:00Z`)});`);

  return rows.join("\n");
}

/**
 * Report submissions need their own owner rows. They are added directly to the
 * ledger AFTER the migration, because the metric under test is the analytics
 * cohort rule and the report domain's own owner graph is proven separately by
 * the curriculum suites.
 */
function reportLedgerSql(): string {
  const row = (
    type: string,
    at: string,
    submission: number,
    owner: string,
    entity: string,
  ) =>
    `(lower(hex(randomblob(20))),'${type}',${ms(at)},'runtime',1,1,'${owner}','${entity}','${submission}','submission:${submission}')`;
  return `INSERT INTO "GrowthEvent" ("eventId","eventType","occurredAt","origin","userId","enrollmentId","sourceOwner","sourceEntityType","sourceEntityId","sourceEventId") VALUES
    ${row("report_submitted", `${JAN}-10T00:00:00Z`, 1, "curriculum_report_submission", "ReportSubmission")},
    ${row("report_submitted", `${JAN}-11T00:00:00Z`, 2, "curriculum_report_submission", "ReportSubmission")},
    ${row("report_submitted", `${FEB}-15T00:00:00Z`, 3, "curriculum_report_submission", "ReportSubmission")},
    ${row("report_submitted", `${FEB}-16T00:00:00Z`, 4, "curriculum_report_submission", "ReportSubmission")},
    ${row("report_approved", `${FEB}-10T00:00:00Z`, 1, "curriculum_report_review", "ReportReview")},
    ${row("report_approved", `${FEB}-11T00:00:00Z`, 2, "curriculum_report_review", "ReportReview")},
    ${row("report_approved", `${FEB}-20T00:00:00Z`, 4, "curriculum_report_review", "ReportReview")};`;
}

const PERIODS = {
  january: { start: new Date(ms(`${JAN}-01T00:00:00Z`)), end: new Date(ms(`${FEB}-01T00:00:00Z`)) },
  february: { start: new Date(ms(`${FEB}-01T00:00:00Z`)), end: new Date(ms("2026-03-01T00:00:00Z")) },
  allTime: { start: new Date(0), end: new Date(ms("2099-01-01T00:00:00Z")) },
};

async function main() {
  console.log("G4 FIX WAVE 2 — regression suite\n");
  buildFixture(adversarialFixture());
  sqlite(reportLedgerSql());

  // Six January-cohort learners activate in FEBRUARY. Injected into the ledger
  // directly: the unit under test is the analytics cohort rule, and the
  // enrollment-to-activation derivation is proven by the migration reconciliation.
  sqlite(
    `INSERT INTO "GrowthEvent" ("eventId","eventType","occurredAt","origin","userId","acquisitionClickId","sourceOwner","sourceEntityType","sourceEntityId","sourceEventId")
     SELECT lower(hex(randomblob(20))),'academy_activation',${ms(`${FEB}-18T00:00:00Z`)},'runtime',g."userId",g."acquisitionClickId",'curriculum_level_progress','UserLevelProgress',CAST(900 + g."userId" AS TEXT),'enrollment:lag' || CAST(g."userId" AS TEXT)
     FROM "GrowthEvent" g WHERE g."eventType"='ata_reg' AND g."userId" BETWEEN 2 AND 7;`,
  );

  prisma = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } });

  const queries = await import("@/lib/growth/analytics/queries");
  const sources = await import("@/lib/growth/analytics/sources");
  const { exactRatio } = await import("@/lib/analytics/decimal");

  // ------------------------------------------------------------------ R3
  console.log("R3 — canonical time representation");

  await check("every GrowthEvent.occurredAt is an integer, whatever the source stored", () => {
    const kinds = sqlite(
      "SELECT DISTINCT typeof(occurredAt) FROM GrowthEvent;",
    ).trim().split("\n").filter(Boolean);
    assert.deepEqual(kinds, ["integer"], `mixed storage classes: ${kinds.join(",")}`);
  });

  await check("every timestamp the migration creates is an integer", () => {
    for (const [table, column] of [
      ["GrowthEvent", "recordedAt"],
      ["GrowthEventOutbox", "availableAt"],
      ["GrowthEventOutbox", "createdAt"],
    ] as const) {
      const kinds = sqlite(`SELECT DISTINCT typeof(${column}) FROM ${table};`)
        .trim().split("\n").filter(Boolean);
      assert.deepEqual(kinds, ["integer"], `${table}.${column}: ${kinds.join(",")}`);
    }
  });

  await check("a TEXT source timestamp converts to its own instant, not a neighbouring one", () => {
    // User 60 registered at '2026-01-08 10:11:12', stored as TEXT.
    const at = sqlite(
      "SELECT occurredAt FROM GrowthEvent WHERE eventType='ata_reg' AND userId=60;",
    ).trim();
    assert.equal(Number(at), ms("2026-01-08T10:11:12Z"), "instant drifted during normalisation");
  });

  await check("BASELINE: the verbatim-copy form WOULD have produced an unqueryable row", () => {
    // The defect was that a TEXT value compares above every integer. Proving the
    // ordering still holds is what makes the normalisation load-bearing rather
    // than decorative.
    const above = sqlite(
      `SELECT CASE WHEN '2026-01-08 10:11:12' > ${ms("2099-01-01T00:00:00Z")} THEN 'yes' ELSE 'no' END;`,
    ).trim();
    assert.equal(above, "yes", "SQLite no longer orders TEXT above INTEGER — revisit this fix");
  });

  await check("rows with TEXT source timestamps are counted by the API in the right period", async () => {
    const jan = await queries.loadGrowthCounts(prisma, PERIODS.january, {}, "total");
    const feb = await queries.loadGrowthCounts(prisma, PERIODS.february, {}, "total");
    // Learner 60 registered 8 January and enrolled the same day, both from TEXT.
    assert.ok(jan.ataRegistrations >= 1, "January must contain the TEXT-sourced registration");
    const all = await queries.loadGrowthCounts(prisma, PERIODS.allTime, {}, "total");
    const ledger = Number(
      sqlite("SELECT COUNT(*) FROM GrowthEvent WHERE eventType='curriculum_enrollment';").trim(),
    );
    assert.equal(all.enrollments, ledger, "an enrollment vanished between the ledger and the API");
    assert.ok(feb.ataRegistrations >= 1, "February must still contain its own registrations");
  });

  await check("§80 a narrow range around a TEXT-sourced row includes it and its neighbours do not", async () => {
    const at = ms("2026-01-08T10:11:12Z");
    const inside = await queries.countLedgerEvents(
      prisma, { start: new Date(at - 1000), end: new Date(at + 1000) }, {}, "total", "ata_reg",
    );
    const before = await queries.countLedgerEvents(
      prisma, { start: new Date(at - 10000), end: new Date(at - 1000) }, {}, "total", "ata_reg",
    );
    const after = await queries.countLedgerEvents(
      prisma, { start: new Date(at + 1000), end: new Date(at + 10000) }, {}, "total", "ata_reg",
    );
    assert.equal(inside, 1, "the row is not in its own second");
    assert.equal(before, 0, "the row leaked into the preceding range");
    assert.equal(after, 0, "the row leaked into the following range");
  });

  await check("§40 the boundary is start-inclusive and end-exclusive", async () => {
    const at = ms("2026-01-08T10:11:12Z");
    const startInclusive = await queries.countLedgerEvents(
      prisma, { start: new Date(at), end: new Date(at + 1) }, {}, "total", "ata_reg",
    );
    const endExclusive = await queries.countLedgerEvents(
      prisma, { start: new Date(at - 1), end: new Date(at) }, {}, "total", "ata_reg",
    );
    assert.equal(startInclusive, 1, "start must be inclusive");
    assert.equal(endExclusive, 0, "end must be exclusive");
  });

  // ------------------------------------------------------------------ R4
  console.log("R4 — historical ATA_REG positive authority");

  await check("an admin-created staff account WITHOUT a StaffProfile is NOT a registration", () => {
    for (const id of [51, 52]) {
      const n = Number(
        sqlite(`SELECT COUNT(*) FROM GrowthEvent WHERE eventType='ata_reg' AND userId=${id};`).trim(),
      );
      assert.equal(n, 0, `user ${id} (staff role, no StaffProfile, has NotificationSettings) was counted`);
    }
  });

  await check("BASELINE: the old negative-inference predicate WOULD have counted them", () => {
    const n = Number(
      sqlite(`SELECT COUNT(*) FROM "User" u
        WHERE u.id IN (SELECT userId FROM NotificationSettings)
          AND u.id NOT IN (SELECT userId FROM StaffProfile)
          AND u.id IN (51,52);`).trim(),
    );
    assert.equal(n, 2, "the fixture no longer reproduces the defect it exists to prove");
  });

  await check("a self-service learner later promoted to staff IS still a registration", () => {
    const n = Number(
      sqlite("SELECT COUNT(*) FROM GrowthEvent WHERE eventType='ata_reg' AND userId=54;").trim(),
    );
    assert.equal(n, 1, "origin authority must outrank current role");
  });

  await check("an unknown-origin account is not fabricated into a registration", () => {
    for (const id of [41, 42, 43, 44, 45]) {
      const n = Number(
        sqlite(`SELECT COUNT(*) FROM GrowthEvent WHERE eventType='ata_reg' AND userId=${id};`).trim(),
      );
      assert.equal(n, 0, `unknown-origin user ${id} was backfilled`);
    }
  });

  await check("the population reconciles exactly to the positive evidence", () => {
    const backfilled = Number(
      sqlite("SELECT COUNT(*) FROM GrowthEvent WHERE eventType='ata_reg';").trim(),
    );
    const proven = Number(
      sqlite(`SELECT COUNT(DISTINCT a.userId) FROM AuditLog a
              WHERE a.action='AUTH_REGISTER' AND a.userId IS NOT NULL
                AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = a.userId);`).trim(),
    );
    assert.equal(backfilled, proven, "backfill and positive evidence disagree");
  });

  await check("the migration references NotificationSettings nowhere", () => {
    const sql = fs.readFileSync(
      path.join(REPO, "prisma", "migrations", "20260813000000_growth_event_foundation", "migration.sql"),
      "utf8",
    );
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.ok(
      !statements.includes("NotificationSettings"),
      "a negative-inference artefact is still read by an executable statement",
    );
  });

  // ------------------------------------------------------------------ R2
  console.log("R2 — acquisition rates on a compatible population");

  await check("the 683% shape is unproducible: February clicks, January conversions", async () => {
    const feb = await queries.loadClickCohortFunnel(prisma as never, PERIODS.february, {});
    assert.ok(
      feb.convertedClicks <= feb.clicks,
      `converted ${feb.convertedClicks} > cohort ${feb.clicks}`,
    );
    const rate = sources.computeClickCohortRatios(feb).attributedClickToRegistrationRate;
    assert.ok(rate === null || Number(rate) <= 1, `attributedClickToRegistrationRate=${rate}`);
  });

  await check("BASELINE: the old event quotient WOULD have exceeded 1 on this fixture", async () => {
    const feb = await queries.loadGrowthCounts(prisma, PERIODS.february, {}, "attributed");
    const old = exactRatio(feb.ataRegistrations, feb.clicks);
    assert.ok(
      old !== null && Number(old) > 1,
      `the fixture must reproduce the defect: registrations=${feb.ataRegistrations} clicks=${feb.clicks} quotient=${old}`,
    );
  });

  await check("the January cohort attributes its own conversions", async () => {
    const jan = await queries.loadClickCohortFunnel(prisma as never, PERIODS.january, {});
    assert.equal(jan.clicks, 20, "the cohort anchor must be the period's clicks");
    assert.equal(jan.convertedClicks, 12, "all 12 attributed learners belong to the January cohort");
    const rates = sources.computeClickCohortRatios(jan);
    assert.equal(rates.attributedClickToRegistrationRate, "0.600000");
    // The two February registrations belong to JANUARY clicks, so they are
    // counted here and not against the single February click.
    const feb = await queries.loadClickCohortFunnel(prisma as never, PERIODS.february, {});
    assert.equal(feb.clicks, 1, "February's own cohort is the one February click");
    assert.equal(feb.convertedClicks, 0, "that click has produced nothing yet");
  });

  await check("downstream cohort rates are subsets and never exceed 1", async () => {
    const jan = await queries.loadClickCohortFunnel(prisma as never, PERIODS.january, {});
    assert.ok(jan.activatedLearners <= jan.registeredLearners, "activation is not a subset");
    assert.ok(jan.pocketRegisteredLearners <= jan.registeredLearners, "pocket is not a subset");
    assert.ok(jan.depositedLearners <= jan.registeredLearners, "deposit is not a subset");
    assert.ok(
      jan.depositedAmongPocketRegistered <= jan.pocketRegisteredLearners,
      "deposit-among-pocket is not a subset",
    );
    for (const [key, value] of Object.entries(sources.computeClickCohortRatios(jan))) {
      if (value === null) continue;
      assert.ok(Number(value) <= 1, `${key}=${value}`);
    }
  });

  await check("BASELINE: the old activation quotient WOULD have exceeded 1", async () => {
    // 1 January-cohort learner activates in February against 0 February
    // registrations in the attributed slice.
    const feb = await queries.loadGrowthCounts(prisma, PERIODS.february, {}, "attributed");
    const old = exactRatio(feb.activatedLearners, feb.ataRegistrations);
    assert.ok(
      old === null || Number(old) > 1,
      `expected the old form to be broken or undefined, got ${old}`,
    );
  });

  await check("§21 a campaign row's numerators are scoped to that campaign", async () => {
    const breakdown = await queries.loadAcquisitionBreakdown(
      prisma,
      PERIODS.january,
      "affiliateCampaign",
      50,
    );
    const rows = breakdown.rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].clicks, 20);
    assert.equal(rows[0].registeredLearners, 12, "no cross-campaign leakage");
    for (const [key, value] of Object.entries(sources.computeClickCohortRatios(rows[0]))) {
      if (value === null) continue;
      assert.ok(Number(value) <= 1, `campaign row ${key}=${value}`);
    }

    // G4-M9 — the population is now declared, so a reader can tell a complete
    // list from the oldest N of many.
    assert.equal(breakdown.totalMembers, 1);
    assert.equal(breakdown.truncated, false);

    // And a limit below the population reports the truncation rather than
    // presenting a partial list as if it were the whole one.
    const clipped = await queries.loadAcquisitionBreakdown(
      prisma,
      PERIODS.january,
      "affiliateCampaign",
      0,
    );
    assert.equal(clipped.rows.length, 0);
    assert.equal(clipped.totalMembers, 1);
    assert.equal(clipped.truncated, true);
  });

  // ------------------------------------------------------------------ R5
  console.log("R5 — report approval on a submission cohort");

  await check("the 200% shape is unproducible: January submissions approved in February", async () => {
    const feb = await queries.loadReportCohort(prisma as never, PERIODS.february, {}, "total");
    assert.ok(
      feb.approvedFromCohort <= feb.submittedCohort,
      `approved ${feb.approvedFromCohort} > submitted ${feb.submittedCohort}`,
    );
    const rate = sources.computeReportCohortRatio(feb);
    assert.ok(rate === null || Number(rate) <= 1, `rate=${rate}`);
  });

  await check("BASELINE: the old event quotient WOULD have exceeded 1", async () => {
    const feb = await queries.loadGrowthCounts(prisma, PERIODS.february, {}, "total");
    const old = exactRatio(feb.reportsApproved, feb.reportsSubmitted);
    assert.ok(
      old !== null && Number(old) > 1,
      `the fixture must reproduce the defect: approved=${feb.reportsApproved} submitted=${feb.reportsSubmitted} quotient=${old}`,
    );
  });

  await check("the January cohort owns its own approvals", async () => {
    const jan = await queries.loadReportCohort(prisma as never, PERIODS.january, {}, "total");
    assert.equal(jan.submittedCohort, 2, "two reports were first submitted in January");
    assert.equal(jan.approvedFromCohort, 2, "both were approved, in February");
    assert.equal(sources.computeReportCohortRatio(jan), "1.000000");
  });

  await check("§58 a pending report stays in the denominator and lowers the rate", async () => {
    const feb = await queries.loadReportCohort(prisma as never, PERIODS.february, {}, "total");
    assert.equal(feb.submittedCohort, 2, "two reports were first submitted in February");
    assert.equal(feb.approvedFromCohort, 1, "one of them is approved, one is pending");
    assert.equal(sources.computeReportCohortRatio(feb), "0.500000");
  });

  await check("§54 approvals with no cohort submissions yield null, not a rate", async () => {
    // March: no submissions at all.
    const march = await queries.loadReportCohort(
      prisma as never,
      { start: new Date(ms("2026-03-01T00:00:00Z")), end: new Date(ms("2026-04-01T00:00:00Z")) },
      {},
      "total",
    );
    assert.equal(march.submittedCohort, 0);
    assert.equal(sources.computeReportCohortRatio(march), null, "zero denominator must be null");
  });

  await check("§57 a revision cannot count the same report twice", () => {
    const distinct = Number(
      sqlite(`SELECT COUNT(*) FROM (SELECT sourceEventId FROM GrowthEvent
              WHERE eventType='report_submitted' GROUP BY sourceEventId HAVING COUNT(*)>1);`).trim(),
    );
    assert.equal(distinct, 0, "a submission produced two events");
  });

  // ------------------------------------------- general bounded-rate audit
  console.log("§25-§27 — the general bounded-rate audit");

  await check("no bounded rate exceeds 1 on any surface, scope or period", async () => {
    const violations: string[] = [];
    for (const [periodName, period] of Object.entries(PERIODS)) {
      for (const scope of ["total", "attributed", "organic"] as const) {
        const counts = await queries.loadGrowthCounts(prisma, period, {}, scope);
        const learners = await queries.loadLearnerFunnel(prisma as never, period, {}, scope);
        const reports = await queries.loadReportCohort(prisma as never, period, {}, scope);
        const cohort = await queries.loadClickCohortFunnel(prisma as never, period, {});
        const levels = await queries.loadLevelFunnel(prisma as never, period, {}, scope, 50);

        const rates: Record<string, string | null> = {
          ...sources.computeGrowthRatios(counts, scope),
          ...sources.computeLearnerFunnelRatios(learners),
          ...sources.computeClickCohortRatios(cohort),
          submittedReportCohortApprovalRate: sources.computeReportCohortRatio(reports),
          attributionCoverageRate: sources.computeAttributionCoverage({
            attributedRegistrations: (await queries.loadGrowthCounts(prisma, period, {}, "attributed"))
              .ataRegistrations,
            totalRegistrations: (await queries.loadGrowthCounts(prisma, period, {}, "total"))
              .ataRegistrations,
          }).attributionCoverageRate,
        };
        for (const level of levels) {
          rates[`level${level.levelNumber}.startedCompletionRate`] = exactRatio(
            level.startedAndCompletedLearners,
            level.startedLearners,
          );
        }
        for (const [key, value] of Object.entries(rates)) {
          if (value === null) continue;
          if (Number(value) > 1) violations.push(`${periodName}/${scope}/${key}=${value}`);
          if (Number(value) < 0) violations.push(`${periodName}/${scope}/${key}=${value} (negative)`);
        }
      }
    }
    assert.deepEqual(violations, [], `bounded rates out of range: ${violations.join(", ")}`);
  });

  await check("§64 nothing clamps a rate to hide a defect", () => {
    for (const file of [
      "src/lib/growth/analytics/sources.ts",
      "src/lib/growth/analytics/queries.ts",
      "src/app/api/crm/v1/growth/acquisition/route.ts",
      "src/app/api/crm/v1/growth/overview/route.ts",
      "src/app/api/crm/v1/growth/funnel/route.ts",
    ]) {
      const source = fs.readFileSync(path.join(REPO, file), "utf8");
      assert.ok(!/Math\.min\s*\(\s*1\s*,/.test(source), `${file} clamps a rate`);
      assert.ok(!/Math\.min\s*\([^)]*,\s*1\s*\)/.test(source), `${file} clamps a rate`);
    }
  });

  await check("§26 every declared rate spec names a basis or is a same-population quotient", () => {
    for (const [key, spec] of Object.entries(sources.GROWTH_RATIO_DENOMINATORS)) {
      const hasBasis = "basis" in (spec as Record<string, unknown>);
      const isAssessment = key === "assessmentPassRate";
      assert.ok(
        hasBasis || isAssessment,
        `${key} declares neither a cohort basis nor same-population membership`,
      );
    }
  });

  // ------------------------------------------------- preserved invariants
  console.log("§4 — invariants the re-audit closed must stay closed");

  await check("H1 the level rate is still a subset of the started set", async () => {
    const levels = await queries.loadLevelFunnel(prisma as never, PERIODS.allTime, {}, "total", 50);
    const cp = levels.find((l) => l.levelNumber === 5);
    assert.ok(cp, "the financial checkpoint must appear");
    assert.equal(cp!.startedLearners, 0, "a checkpoint must never be given a synthetic start");
    assert.equal(cp!.completedLearners, 1);
    assert.equal(cp!.completedWithoutStartLearners, 1);
    for (const level of levels) {
      assert.ok(
        level.startedAndCompletedLearners <= level.startedLearners,
        `level ${level.levelNumber} rate is not a subset`,
      );
    }
  });

  await check("H4 the default total funnel still shows real business", async () => {
    const total = await queries.loadGrowthCounts(prisma, PERIODS.allTime, {}, "total");
    assert.ok(total.ataRegistrations > 0, "total must not be empty");
    assert.ok(total.enrollments > 0);
    const attributed = await queries.loadGrowthCounts(prisma, PERIODS.allTime, {}, "attributed");
    assert.ok(
      attributed.ataRegistrations < total.ataRegistrations,
      "organic learners must be present in total and absent from attributed",
    );
  });

  await check("outbox is still 1:1 with the ledger", () => {
    const row = sqlite(`SELECT (SELECT COUNT(*) FROM GrowthEvent)||'/'||(SELECT COUNT(*) FROM GrowthEventOutbox)
      ||'/'||(SELECT COUNT(*) FROM GrowthEvent g WHERE NOT EXISTS (SELECT 1 FROM GrowthEventOutbox o WHERE o.growthEventId=g.id));`).trim();
    const [events, outbox, orphans] = row.split("/").map(Number);
    // The report rows were injected directly into the ledger by this suite and
    // deliberately have no outbox row, so the comparison excludes them.
    // The suite injects 7 report rows and 6 lagged activations straight into the
    // ledger, deliberately bypassing the emitter, so those 13 have no outbox row.
    assert.equal(orphans, 13, `expected exactly the 13 suite-injected rows to be outbox-free, got ${orphans}`);
    assert.equal(events - 13, outbox, `ledger ${events} - 13 != outbox ${outbox}`);
  });

  await check("money is still exact and un-multiplied", async () => {
    const amounts = await queries.loadFirstDepositAmounts(prisma as never, PERIODS.allTime, {}, "total");
    assert.equal(amounts.count, 1);
    assert.equal(amounts.sum, "55.01");
    assert.equal(amounts.currencyCode, "USD");
  });

  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma?.$disconnect();
  process.exit(1);
});
