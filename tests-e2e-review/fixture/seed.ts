/**
 * Deterministic seeder for the MR-1R reviewer fixture.
 *
 * Builds a complete, isolated migration-34 database from nothing, every run:
 *
 *   1. apply the Backend's own 34 migrations to a brand new SQLite file;
 *   2. import the operator-approved rev3 curriculum package with the Backend's
 *      own CLI (43 report fields, level v2.l003);
 *   3. finish authoring — publish the curriculum version, publish the R1–R7
 *      rubric, bind it to the report level;
 *   4. create the synthetic staff, reviewer pool and report owners;
 *   5. enrol each report owner at L3 with L1–L2 behind them;
 *   6. submit each owner's report THROUGH THE BACKEND'S OWN LEARNER API, so the
 *      revisions, receipts and workflow versions are the ones the domain writes.
 *
 * Steps 1–5 need no server. Step 6 does, so the caller starts the backend against
 * the database from step 5 and then calls `seedSubmissions`.
 *
 * Nothing is reused between runs and nothing is repaired by hand. If any step
 * fails the seed throws: a suite that ran against a half-built fixture would prove
 * less than no suite at all.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CURRICULUM_CODE,
  FIXTURE,
  MENTOR_POOL_SIZE,
  ADMIN_POOL_SIZE,
  REJECTION_REASONS,
  REPORT_LEVEL_STABLE_CODE,
  REPORT_OWNERS,
  RUBRIC_CRITERIA,
  RUBRIC_SCALE,
  SEED_EPOCH_MS,
  pooledAdmin,
  pooledMentor,
} from "./identities";
import { BACKEND_REPO, CURRICULUM_PACKAGE, type RunPaths } from "./paths";
import { exec, lit, query, scalar } from "./sqlite";

/**
 * The 43-field report body every owner submits, committed so two runs submit the
 * same report.
 *
 * Resolved from the Playwright root rather than the module's own directory:
 * Playwright transpiles this file to CommonJS, where `import.meta` does not exist.
 */
const CONTENT_FILE = path.join(process.cwd(), "tests-e2e-review", "fixture", "report-content.json");

function reportContent(): Record<string, unknown> {
  if (!fs.existsSync(CONTENT_FILE)) {
    throw new Error(`fixture report content not found at ${CONTENT_FILE}`);
  }
  return JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8")) as Record<string, unknown>;
}

function backendTsx(script: string, args: string[], databaseUrl: string): string {
  return execFileSync("./node_modules/.bin/tsx", [script, ...args], {
    cwd: BACKEND_REPO,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** bcrypt hash of the operator-supplied fixture password, computed with the Backend's own library. */
function hashPassword(password: string): string {
  const out = execFileSync(
    process.execPath,
    [
      "-e",
      "const b=require('bcryptjs');process.stdout.write(b.hashSync(process.argv[1],10));",
      password,
    ],
    { cwd: BACKEND_REPO, encoding: "utf8" },
  );
  if (!out.startsWith("$2")) throw new Error("password hashing produced no bcrypt hash");
  return out;
}

export interface SeededIds {
  curriculumVersionId: number;
  l3LevelDefinitionId: number;
  assignmentVersionId: number;
  rubricVersionId: number;
  fieldCount: number;
  identities: Record<string, number>;
  owners: Record<string, { userId: number; enrollmentId: number }>;
}

/* ------------------------------------------------------------------ schema */

export function seedSchema(paths: RunPaths, password: string): SeededIds {
  fs.mkdirSync(paths.runDir, { recursive: true });
  if (fs.existsSync(paths.databaseFile)) fs.rmSync(paths.databaseFile);

  backendTsx("prisma/migrate.ts", [], paths.databaseUrl);
  const migrations = Number(scalar(paths.databaseFile, "select count(*) from _prisma_migrations"));
  if (migrations !== 34) {
    throw new Error(`expected 34 migrations in the fixture database, found ${migrations}`);
  }

  backendTsx(
    "scripts/curriculum/importCurriculumPackage.ts",
    ["--package", CURRICULUM_PACKAGE, "--database", paths.databaseUrl, "--json"],
    paths.databaseUrl,
  );

  const ids = finishAuthoring(paths);
  const identities = createIdentities(paths, hashPassword(password));
  const owners = enrolOwners(paths, ids, identities);
  return { ...ids, identities, owners };
}

/**
 * Publish what the package import deliberately leaves in draft.
 *
 * The CLI imports the assignment and its 43 fields but stops short of a rubric:
 * a report binding requires an APPROVED rubric version, and package import does
 * not author one. These rows are the rubric the reviewer UI renders as R1–R7.
 */
function finishAuthoring(paths: RunPaths): Omit<SeededIds, "identities" | "owners"> {
  const db = paths.databaseFile;
  const curriculumVersionId = Number(
    scalar(db, "select id from CurriculumVersion where code = ?", [CURRICULUM_CODE]),
  );
  const l3LevelDefinitionId = Number(
    scalar(db, "select id from LevelDefinition where stableCode = ?", [REPORT_LEVEL_STABLE_CODE]),
  );
  const assignmentVersionId = Number(
    scalar(db, "select id from ReportAssignmentVersion where levelDefinitionId = ?", [l3LevelDefinitionId]),
  );
  const fieldCount = Number(
    scalar(db, "select count(*) from ReportFieldDefinition where reportAssignmentVersionId = ?", [
      assignmentVersionId,
    ]),
  );
  if (fieldCount !== 43) {
    throw new Error(`expected 43 published report fields, found ${fieldCount}`);
  }

  const t = SEED_EPOCH_MS;
  const statements: string[] = [
    `update CurriculumVersion set status = 'published', effectiveFrom = ${t}, publishedAt = ${t} where id = ${curriculumVersionId};`,
    `insert into ReportRubricVersion (id, reportAssignmentVersionId, versionNumber, status, createdById, createdAt, updatedAt, publishedAt)
       values (1, ${assignmentVersionId}, 1, 'published', NULL, ${t}, ${t}, ${t});`,
  ];

  RUBRIC_CRITERIA.forEach((criterion, index) => {
    const id = index + 1;
    statements.push(
      `insert into ReportRubricCriterion (id, reportRubricVersionId, stableKey, categoryCode, sortOrder, commentRequired, createdAt, updatedAt)
         values (${id}, 1, ${lit(criterion.code)}, ${lit(`${criterion.code}-cat`)}, ${index}, ${lit(criterion.commentRequired)}, ${t}, ${t});`,
      `insert into ReportRubricCriterionLocalization (id, reportRubricCriterionId, locale, title, description, createdAt, updatedAt)
         values (${id}, ${id}, 'ru', ${lit(criterion.title)}, ${lit(`Критерий ${criterion.code}: оценка по рубрике R1–R7.`)}, ${t}, ${t});`,
    );
  });

  RUBRIC_SCALE.forEach((option, index) => {
    const id = index + 1;
    statements.push(
      `insert into ReportRubricScaleOption (id, reportRubricVersionId, stableKey, ordinal, createdAt)
         values (${id}, 1, ${lit(option.code)}, ${index}, ${t});`,
      `insert into ReportRubricScaleOptionLocalization (id, reportRubricScaleOptionId, locale, label, description)
         values (${id}, ${id}, 'ru', ${lit(option.label)}, ${lit(`${option.label} — описание шкалы.`)});`,
    );
  });

  REJECTION_REASONS.forEach((reason, index) => {
    const id = index + 1;
    statements.push(
      `insert into ReportRejectionReason (id, reportRubricVersionId, stableKey, sortOrder, active, createdAt, updatedAt)
         values (${id}, 1, ${lit(reason.code)}, ${index}, 1, ${t}, ${t});`,
      `insert into ReportRejectionReasonLocalization (id, reportRejectionReasonId, locale, title, guidance)
         values (${id}, ${id}, 'ru', ${lit(reason.title)}, ${lit(reason.guidance)});`,
    );
  });

  statements.push(
    `insert into LevelReportBinding (id, levelDefinitionId, curriculumVersionId, reportAssignmentVersionId, reportRubricVersionId, createdById, revision, createdAt, updatedAt)
       values (1, ${l3LevelDefinitionId}, ${curriculumVersionId}, ${assignmentVersionId}, 1, NULL, 0, ${t}, ${t});`,
  );

  exec(db, statements.join("\n"));
  return { curriculumVersionId, l3LevelDefinitionId, assignmentVersionId, rubricVersionId: 1, fieldCount };
}

/* --------------------------------------------------------------- identities */

interface IdentitySpec {
  key: string;
  email: string;
  name: string;
  role: string;
  status: string;
  staffRole: string | null;
}

function identitySpecs(): IdentitySpec[] {
  const specs: IdentitySpec[] = [
    { key: "mentor", email: FIXTURE.mentor, name: "MR1R Mentor", role: "mentor", status: "active", staffRole: "mentor" },
    { key: "admin", email: FIXTURE.admin, name: "MR1R Admin", role: "admin", status: "active", staffRole: "crm_admin" },
    { key: "support", email: FIXTURE.support, name: "MR1R Support", role: "support", status: "active", staffRole: "support" },
    // A real CRM StaffProfile whose PLATFORM role is `user`: the sharpest case for
    // "staff admission is not reviewer authority".
    { key: "userStaff", email: FIXTURE.userStaff, name: "MR1R UserStaff", role: "user", status: "active", staffRole: "support" },
    { key: "inactiveMentor", email: FIXTURE.inactiveMentor, name: "MR1R Inactive", role: "mentor", status: "blocked", staffRole: "mentor" },
    { key: "learner", email: FIXTURE.learner, name: "MR1R Learner", role: "user", status: "active", staffRole: null },
  ];
  for (let slot = 1; slot <= MENTOR_POOL_SIZE; slot += 1) {
    specs.push({
      key: `poolMentor${String(slot).padStart(2, "0")}`,
      email: pooledMentor(slot),
      name: `MR1R PM ${String(slot).padStart(2, "0")}`,
      role: "mentor",
      status: "active",
      staffRole: "mentor",
    });
  }
  for (let slot = 1; slot <= ADMIN_POOL_SIZE; slot += 1) {
    specs.push({
      key: `poolAdmin${String(slot).padStart(2, "0")}`,
      email: pooledAdmin(slot),
      name: `MR1R PA ${String(slot).padStart(2, "0")}`,
      role: "admin",
      status: "active",
      staffRole: "crm_admin",
    });
  }
  for (const owner of REPORT_OWNERS) {
    specs.push({ key: owner.key, email: owner.email, name: owner.name, role: "user", status: "active", staffRole: null });
  }
  return specs;
}

function createIdentities(paths: RunPaths, passwordHash: string): Record<string, number> {
  const t = SEED_EPOCH_MS;
  const specs = identitySpecs();
  const statements: string[] = [];
  const identities: Record<string, number> = {};

  specs.forEach((spec, index) => {
    const id = index + 1;
    identities[spec.key] = id;
    statements.push(
      // `referralCode` is `String @unique` in the Prisma schema, not nullable: leaving
      // it NULL makes every `user.findUnique` fail with P2032 rather than returning a
      // user, which surfaces as an opaque 500 on login.
      `insert into User (id, email, name, level, xp, createdAt, updatedAt, passwordHash, role, status, emailVerifiedAt, leaderboardExcluded, referralCode)
         values (${id}, ${lit(spec.email)}, ${lit(spec.name)}, 1, 0, ${t}, ${t}, ${lit(passwordHash)}, ${lit(spec.role)}, ${lit(spec.status)}, ${t}, 0, ${lit(`mr1r-ref-${String(id).padStart(3, "0")}`)});`,
    );
    if (spec.staffRole) {
      statements.push(
        `insert into StaffProfile (id, userId, displayName, staffRole, permissionVersion, createdAt, updatedAt)
           values (${lit(`mr1r-staff-${String(id).padStart(3, "0")}`)}, ${id}, ${lit(spec.name)}, ${lit(spec.staffRole)}, 1, ${t}, ${t});`,
      );
    }
  });

  exec(paths.databaseFile, statements.join("\n"));
  return identities;
}

/* -------------------------------------------------------------- enrolments */

/**
 * Put every report owner exactly where a learner stands when a report is due:
 * L1 and L2 completed, L3 in progress, nothing beyond it.
 *
 * Journey E asserts `highestCompletedLevel === 2` after a revision request, so
 * this is the state the zero-reward contract is measured against.
 */
function enrolOwners(
  paths: RunPaths,
  ids: Omit<SeededIds, "identities" | "owners">,
  identities: Record<string, number>,
): Record<string, { userId: number; enrollmentId: number }> {
  const db = paths.databaseFile;
  const t = SEED_EPOCH_MS;
  const levelIds = query(db, "select id, levelNumber from LevelDefinition where curriculumVersionId = ? order by levelNumber", [
    ids.curriculumVersionId,
  ]).map((r) => ({ id: Number(r[0]), levelNumber: Number(r[1]) }));

  const statements: string[] = [];
  const owners: Record<string, { userId: number; enrollmentId: number }> = {};
  let progressId = 0;

  REPORT_OWNERS.forEach((owner, index) => {
    const enrollmentId = index + 1;
    const userId = identities[owner.key]!;
    owners[owner.key] = { userId, enrollmentId };
    statements.push(
      `insert into UserCurriculumEnrollment (id, userId, curriculumVersionId, curriculumCode, status, enrolledAt, highestCompletedLevel, currentLevel, lastMeaningfulActionAt, createdAt, updatedAt)
         values (${enrollmentId}, ${userId}, ${ids.curriculumVersionId}, ${lit(CURRICULUM_CODE)}, 'active', ${t}, 2, 3, ${t}, ${t}, ${t});`,
    );
    for (const level of levelIds) {
      if (level.levelNumber > 3) continue;
      progressId += 1;
      const completed = level.levelNumber < 3;
      statements.push(
        `insert into UserLevelProgress (id, enrollmentId, curriculumVersionId, levelDefinitionId, status, startedAt, lastProgressAt, completedAt, completionMethod, attemptCount, createdAt, updatedAt)
           values (${progressId}, ${enrollmentId}, ${ids.curriculumVersionId}, ${level.id}, ${completed ? "'completed'" : "'in_progress'"}, ${t}, ${t}, ${completed ? t : "NULL"}, ${completed ? lit(level.levelNumber === 1 ? "pocket_postback" : "assessment_pass") : "NULL"}, 0, ${t}, ${t});`,
      );
    }
  });

  exec(db, statements.join("\n"));
  return owners;
}

/* ------------------------------------------------------- submissions (HTTP) */

/**
 * A cookie jar just large enough for one fixture session.
 *
 * The Backend sets an httpOnly session cookie and a readable CSRF cookie; both must
 * come back on the write. `fetch` does not keep cookies, so the seeder keeps them.
 */
class Session {
  private cookies = new Map<string, string>();

  constructor(private readonly origin: string) {}

  private absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair?.indexOf("=") ?? -1;
      if (!pair || eq < 0) continue;
      this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }

  private header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(method: string, pathname: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const response = await fetch(`${this.origin}${pathname}`, {
      method,
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookies.size > 0 ? { cookie: this.header() } : {}),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    this.absorb(response);
    return response;
  }

  async expectOk(method: string, pathname: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<unknown> {
    const response = await this.request(method, pathname, init);
    if (!response.ok) {
      throw new Error(`${method} ${pathname} failed with ${response.status}: ${(await response.text()).slice(0, 400)}`);
    }
    return response.json();
  }
}

export interface SubmissionRecord {
  userId: number;
  enrollmentId: number;
  submissionId: number;
}

export async function seedSubmissions(
  paths: RunPaths,
  origin: string,
  password: string,
  owners: Record<string, { userId: number; enrollmentId: number }>,
): Promise<Record<string, SubmissionRecord>> {
  const content = reportContent();
  const out: Record<string, SubmissionRecord> = {};

  for (const owner of REPORT_OWNERS) {
    const session = new Session(origin);
    await session.expectOk("POST", "/api/auth/login", {
      body: { email: owner.email, password },
    });
    const csrf = (await session.expectOk("GET", "/api/csrf")) as { csrfToken: string };
    const headers = { "x-csrf-token": csrf.csrfToken };
    const base = `/api/curriculum/v2/levels/${REPORT_LEVEL_STABLE_CODE}/report`;

    // Deterministic request ids: replaying the seeder against the same database
    // would be a no-op rather than a second report.
    await session.expectOk("PUT", `${base}/draft`, {
      headers: { ...headers, "Idempotency-Key": `mr1r-seed-draft-${owner.key}` },
      body: { expectedRevision: 0, fieldValues: content },
    });
    await session.expectOk("POST", `${base}/submit`, {
      headers: { ...headers, "Idempotency-Key": `mr1r-seed-submit-${owner.key}` },
      body: { expectedRevision: 1 },
    });

    const record = owners[owner.key]!;
    const submissionId = Number(
      scalar(paths.databaseFile, "select id from ReportSubmission where userId = ?", [record.userId]),
    );
    const status = String(
      scalar(paths.databaseFile, "select status from ReportSubmission where id = ?", [submissionId]),
    );
    if (status !== "pending_review") {
      throw new Error(`seeded submission ${submissionId} for ${owner.key} is ${status}, expected pending_review`);
    }
    out[owner.key] = { ...record, submissionId };
  }

  const pending = Number(
    scalar(paths.databaseFile, "select count(*) from ReportSubmission where status = 'pending_review'"),
  );
  if (pending !== REPORT_OWNERS.length) {
    throw new Error(`expected ${REPORT_OWNERS.length} pending submissions after seeding, found ${pending}`);
  }
  const xp = Number(scalar(paths.databaseFile, "select count(*) from XPTransaction"));
  if (xp !== 0) throw new Error(`seeded fixture already carries ${xp} XPTransaction rows`);

  return out;
}
