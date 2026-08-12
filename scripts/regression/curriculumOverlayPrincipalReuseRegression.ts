/**
 * PREPROD ACTIVATION — historical principal CREATE / REUSE_EXACT / REFUSE_CONFLICT.
 *
 * A historical editorial principal is an ENVIRONMENT identity: `User` and
 * `StaffProfile` carry no `curriculumVersionId`, and `User.email` is unique. So a
 * successor overlay published into an environment a previous overlay already
 * provisioned MUST bind to the same account. Authorization used to require those
 * identities to be ABSENT, which is right for a first activation and makes every
 * successor permanently unauthorizable.
 *
 * This suite pins the replacement invariant and, more importantly, pins what it
 * did NOT open up. Reuse is allowed only when the existing account is the same
 * principal on every field the overlay importer itself compares — role, the
 * StaffProfile's staffRole, and, for a `process` identity, that the account
 * cannot log in. Everything else is refused rather than repaired: no demotion,
 * no elevation, no merge, no guessing between candidates.
 *
 * One disposable SQLite fixture per case, built from the real migration chain.
 * No live data, no network.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  assertHistoricalPrincipalsAuthorized,
  classifyHistoricalPrincipals,
  type HistoricalPrincipalDeclaration,
} from "@/lib/curriculum/preprod-activation/baseline";
import { assertOverlayPrincipalsAreReviewed } from "@/lib/curriculum/preprod-activation/manifest";
import { PreprodActivationError } from "@/lib/curriculum/preprod-activation/errors";

const REPO = process.cwd();
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "ata-principal-reuse-"));
fs.chmodSync(SCRATCH, 0o700);
const T = 1786000000000;

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/* ------------------------------------------------------------------ *
 * fixture
 * ------------------------------------------------------------------ */

function dropSidecars(databasePath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

function buildSchema(target: string): void {
  const db = new DatabaseSync(target);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    const names = fs
      .readdirSync(path.join(REPO, "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const sql = fs.readFileSync(path.join(REPO, "prisma", "migrations", name, "migration.sql"), "utf8");
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
      db.prepare(
        'INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","applied_steps_count","finished_at") VALUES (?,?,?,?,?)',
      ).run(`fixture-${name}`, crypto.createHash("sha256").update(sql).digest("hex"), name, 1, T);
    }
  } finally {
    db.close();
  }
  dropSidecars(target);
}

/** The accepted successor overlay's two principals, verbatim in shape. */
const AUTHOR: HistoricalPrincipalDeclaration = {
  ref: "g2.author.a@ata-editorial.invalid",
  kind: "process",
  role: "user",
  staffRole: "content_manager",
  provisionIfMissing: true,
};
const REVIEWER: HistoricalPrincipalDeclaration = {
  ref: "g2.reviewer.r@ata-editorial.invalid",
  kind: "process",
  role: "user",
  staffRole: "crm_admin",
  provisionIfMissing: true,
};
const DECLARED = [AUTHOR, REVIEWER];

type Account = {
  email?: string;
  role?: string;
  status?: string;
  staffRole?: string | null;
  /** Extra StaffProfile rows on the same account, for the duplicate-profile case. */
  extraStaffRoles?: string[];
};

let seq = 0;

/** A target holding exactly the accounts described, plus one unrelated learner. */
function targetWith(accounts: Account[]): string {
  const file = path.join(SCRATCH, `fixture-${++seq}.sqlite`);
  buildSchema(file);
  const db = new DatabaseSync(file);
  try {
    db.exec(`INSERT INTO "User" ("id","email","name","passwordHash","role","status","level","xp","createdAt","updatedAt")
             VALUES (1,'learner@fixture.invalid','Learner','x','user','active',1,0,${T},${T})`);
    let id = 10;
    let profile = 0;
    for (const account of accounts) {
      id += 1;
      db.exec(`INSERT INTO "User" ("id","email","name","passwordHash","role","status","level","xp","createdAt","updatedAt")
               VALUES (${id},'${account.email}','Historical','x','${account.role ?? "user"}','${account.status ?? "blocked"}',1,0,${T},${T})`);
      const roles = [
        ...(account.staffRole === null || account.staffRole === undefined ? [] : [account.staffRole]),
        ...(account.extraStaffRoles ?? []),
      ];
      for (const staffRole of roles) {
        profile += 1;
        db.exec(`INSERT INTO "StaffProfile" ("id","userId","displayName","staffRole","permissionVersion","createdAt","updatedAt")
                 VALUES ('sp-${profile}',${id},'Historical','${staffRole}',1,${T},${T})`);
      }
    }
  } finally {
    db.close();
  }
  dropSidecars(file);
  return file;
}

const exact = (declaration: HistoricalPrincipalDeclaration, overrides: Partial<Account> = {}): Account => ({
  email: declaration.ref,
  role: declaration.role,
  status: "blocked",
  staffRole: declaration.staffRole,
  ...overrides,
});

function classify(accounts: Account[], declared: HistoricalPrincipalDeclaration[] = DECLARED) {
  return classifyHistoricalPrincipals(targetWith(accounts), declared);
}
const dispositions = (accounts: Account[], declared: HistoricalPrincipalDeclaration[] = DECLARED): string[] =>
  classify(accounts, declared).map((entry) => entry.disposition);

function refusesWith(fn: () => unknown, fragment: RegExp): PreprodActivationError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof PreprodActivationError, `expected a PreprodActivationError, got ${String(error)}`);
    assert.equal(error.code, "UNEXPECTED_HISTORICAL_PRINCIPAL");
    assert.match(error.message, fragment);
    return error;
  }
  throw new assert.AssertionError({ message: "expected a refusal, but the call returned" });
}

/* ------------------------------------------------------------------ *
 * suite
 * ------------------------------------------------------------------ */

function main(): void {
  /* ---- A. accept: the three shapes that must be authorized ---- */

  check("A1. both expected principals absent -> CREATE, CREATE", () => {
    const result = classify([]);
    assert.deepEqual(result.map((entry) => entry.disposition), ["CREATE", "CREATE"]);
    assert.deepEqual(result.map((entry) => entry.matchedUserId), [null, null]);
    assertHistoricalPrincipalsAuthorized(result);
  });

  check("A2. both already exist exactly as declared -> REUSE_EXACT, REUSE_EXACT", () => {
    const result = classify([exact(AUTHOR), exact(REVIEWER)]);
    assert.deepEqual(result.map((entry) => entry.disposition), ["REUSE_EXACT", "REUSE_EXACT"]);
    assert.deepEqual(result.map((entry) => entry.matchedUserId), [11, 12]);
    assert.deepEqual(result.flatMap((entry) => entry.conflicts), []);
    assertHistoricalPrincipalsAuthorized(result);
  });

  check("A3. one absent, one exact-existing -> CREATE + REUSE_EXACT", () => {
    const result = classify([exact(REVIEWER)]);
    assert.deepEqual(result.map((entry) => `${entry.ref}=${entry.disposition}`), [
      `${AUTHOR.ref}=CREATE`,
      `${REVIEWER.ref}=REUSE_EXACT`,
    ]);
    assertHistoricalPrincipalsAuthorized(result);
  });

  check("A4. successor after an accepted predecessor overlay -> exact reuse", () => {
    // Exactly the live PREPROD shape: both identities blocked, role user, with
    // the staff profiles the v3 overlay created.
    const result = classify([exact(AUTHOR), exact(REVIEWER)]);
    assert.deepEqual(result.map((entry) => entry.disposition), ["REUSE_EXACT", "REUSE_EXACT"]);
    assert.deepEqual(result.map((entry) => entry.rowCount), [1, 1]);
    assertHistoricalPrincipalsAuthorized(result);
  });

  check("A5. classification is deterministic across repeated runs from the same state", () => {
    const accounts = [exact(AUTHOR), exact(REVIEWER)];
    const first = dispositions(accounts);
    const second = dispositions(accounts);
    const third = dispositions(accounts);
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
  });

  check("A6. an unrelated learner account on the target changes nothing", () => {
    // The fixture always seeds one; this states that it is not accidentally
    // being folded into a principal class.
    assert.deepEqual(dispositions([exact(AUTHOR), exact(REVIEWER)]), ["REUSE_EXACT", "REUSE_EXACT"]);
  });

  /* ---- B. refuse: every security-significant difference ---- */

  const refusals: Array<[string, Account[], RegExp]> = [
    [
      "B1. same address, different role -> REFUSE (a different principal)",
      [exact(AUTHOR, { role: "admin" }), exact(REVIEWER)],
      /role admin != user/,
    ],
    [
      "B2. same address, different staffRole -> REFUSE",
      [exact(AUTHOR, { staffRole: "crm_admin" }), exact(REVIEWER)],
      /staffRole crm_admin != content_manager/,
    ],
    [
      "B3. process identity exists as ACTIVE and loginable -> REFUSE, never demote",
      [exact(AUTHOR, { status: "active" }), exact(REVIEWER)],
      /loginable, but the overlay declares a non-loginable historical process identity/,
    ],
    [
      "B4. expected StaffProfile missing entirely -> REFUSE",
      [exact(AUTHOR, { staffRole: null }), exact(REVIEWER)],
      /staffRole <none> != content_manager/,
    ],
    [
      "B5. the expected staffRole is held by a DIFFERENT account -> REFUSE",
      [exact(AUTHOR, { staffRole: null }), exact(REVIEWER), { email: "impostor@fixture.invalid", staffRole: "content_manager" }],
      /staffRole <none> != content_manager/,
    ],
    [
      "B6. a learner account squatting the reserved address -> REFUSE",
      [exact(AUTHOR, { role: "user", status: "active", staffRole: null }), exact(REVIEWER)],
      /staffRole <none> != content_manager/,
    ],
  ];

  for (const [name, accounts, fragment] of refusals) {
    check(name, () => {
      const result = classify(accounts);
      assert.equal(result[0].disposition, "REFUSE_CONFLICT");
      refusesWith(() => assertHistoricalPrincipalsAuthorized(result), fragment);
    });
  }

  check("B5b. a duplicate StaffProfile is unreachable — the schema forbids it", () => {
    // The classifier still refuses on `staff.length > 1` as defence in depth, but
    // that branch cannot fire today and the fixture must not pretend otherwise.
    assert.throws(
      () => targetWith([exact(AUTHOR, { extraStaffRoles: ["crm_admin"] })]),
      /UNIQUE constraint failed: StaffProfile\.userId/,
      "StaffProfile.userId is no longer unique; the duplicate-profile branch is now reachable and needs a real test",
    );
  });

  check("B7. two accounts share one canonical identity -> REFUSE as ambiguous", () => {
    // `User.email` is unique only case-SENSITIVELY, so this is constructible.
    const result = classify([
      exact(AUTHOR),
      exact(AUTHOR, { email: AUTHOR.ref.toUpperCase() }),
      exact(REVIEWER),
    ]);
    const author = result.find((entry) => entry.ref === AUTHOR.ref)!;
    assert.equal(author.disposition, "REFUSE_CONFLICT");
    assert.equal(author.rowCount, 2);
    assert.equal(author.matchedUserId, null, "an ambiguous class must not name a winner");
    refusesWith(() => assertHistoricalPrincipalsAuthorized(result), /2 accounts share this canonical identity/);
  });

  check("B8. absent, and the overlay does not permit provisioning -> REFUSE", () => {
    const result = classify([], [{ ...AUTHOR, provisionIfMissing: false }, REVIEWER]);
    assert.equal(result[0].disposition, "REFUSE_CONFLICT");
    refusesWith(
      () => assertHistoricalPrincipalsAuthorized(result),
      /absent and this overlay does not permit provisioning it/,
    );
  });

  check("B9. one good principal does not rescue a conflicted sibling", () => {
    const result = classify([exact(AUTHOR, { role: "admin" }), exact(REVIEWER)]);
    assert.deepEqual(result.map((entry) => entry.disposition), ["REFUSE_CONFLICT", "REUSE_EXACT"]);
    refusesWith(() => assertHistoricalPrincipalsAuthorized(result), /1 of the overlay's historical principal/);
  });

  /* ---- C. the reviewed principal SET ---- */

  check("C1. the overlay's principal set must equal the manifest's reviewed refs", () => {
    assertOverlayPrincipalsAreReviewed([AUTHOR.ref, REVIEWER.ref], DECLARED);
  });

  check("C2. an overlay naming an unreviewed principal -> REFUSE", () => {
    assert.throws(
      () =>
        assertOverlayPrincipalsAreReviewed(
          [AUTHOR.ref, REVIEWER.ref],
          [...DECLARED, { ref: "someone.else@ata-editorial.invalid" }],
        ),
      (error: unknown) =>
        error instanceof PreprodActivationError &&
        error.code === "OVERLAY_PROVENANCE_MISMATCH" &&
        /unreviewed someone\.else@ata-editorial\.invalid/.test(error.message),
    );
  });

  check("C3. an overlay omitting a reviewed principal -> REFUSE", () => {
    assert.throws(
      () => assertOverlayPrincipalsAreReviewed([AUTHOR.ref, REVIEWER.ref], [AUTHOR]),
      (error: unknown) =>
        error instanceof PreprodActivationError &&
        error.code === "OVERLAY_PROVENANCE_MISMATCH" &&
        /missing g2\.reviewer\.r@ata-editorial\.invalid/.test(error.message),
    );
  });

  check("C4. the set comparison folds identity the same way the fence does", () => {
    assertOverlayPrincipalsAreReviewed([AUTHOR.ref.toUpperCase(), REVIEWER.ref], DECLARED);
  });

  /* ---- D. the predicate is the importer's, and must stay that way ---- */

  check("D1. the classifier compares exactly the fields the overlay importer compares", () => {
    const importer = fs.readFileSync(
      path.join(REPO, "src", "lib", "curriculum", "editorial-overlay", "import.ts"),
      "utf8",
    );
    const classifier = fs.readFileSync(
      path.join(REPO, "src", "lib", "curriculum", "preprod-activation", "baseline.ts"),
      "utf8",
    );
    // If the importer ever gains a fourth comparison, this fails and the
    // classifier has to gain it too — otherwise authorization would permit a
    // reuse the importer then refuses.
    for (const marker of [
      "targetStaffRole !== principal.staffRole",
      "existing.role !== principal.role",
      'principal.kind === "process" && existing.status !== "blocked"',
    ]) {
      assert.ok(importer.includes(marker), `the importer no longer contains: ${marker}`);
    }
    for (const marker of [
      "targetStaffRole !== principal.staffRole",
      "targetRole !== principal.role",
      'principal.kind === "process" && targetStatus !== "blocked"',
    ]) {
      assert.ok(classifier.includes(marker), `the classifier no longer contains: ${marker}`);
    }
  });

  check("D2. no disposition mutates the target", () => {
    const file = targetWith([exact(AUTHOR), exact(REVIEWER)]);
    const before = fs.readFileSync(file);
    classifyHistoricalPrincipals(file, DECLARED);
    classifyHistoricalPrincipals(file, DECLARED);
    assert.deepEqual(fs.readFileSync(file), before, "classification wrote to the target");
  });

  check("D3. an empty declaration list is valid and authorizes nothing", () => {
    const result = classifyHistoricalPrincipals(targetWith([]), []);
    assert.deepEqual(result, []);
    assertHistoricalPrincipalsAuthorized(result);
  });

  console.log(`\ncurriculum overlay principal reuse regression: ${passed} passed, ${failed} failed`);
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

main();
