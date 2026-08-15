/**
 * LEARNER-OPERATIONS-V1 — the acceptance fixture provisioner.
 *
 * TWO VERBS AND NOTHING ELSE:
 *
 *   provision   create (or complete) the synthetic staff principals and
 *               learners named in the CLOSED allowlist, so a real Chrome can
 *               execute the operational E2E journeys as somebody who is not a
 *               real employee and not a real learner
 *
 *   inspect     report what exists, change nothing, take no password
 *
 * IT IS A DRY RUN UNTIL `--apply`. Without it, `provision` reads, reports and
 * writes nothing — and does not even prompt for a password.
 *
 * ============================================================================
 * WHAT IT CANNOT DO, BY CONSTRUCTION
 * ============================================================================
 *
 * NO `--email`, NO `--role`, NO `--permission`. Every principal is written down
 * in `learner-ops-fixture/identities.ts` at review time. The CLI names a KEY
 * from that table. A shell on this host therefore cannot point this tool at a
 * real learner, a real employee, or an address no reviewer ever saw.
 *
 * IT CANNOT TOUCH THE NEGATIVE CONTROL. `preprod-qa-operator@ata.invalid` is
 * absent from the allowlist, so this tool cannot grant it a Learner Operations
 * permission, cannot change its StaffRole, and cannot alter it at all. That
 * principal must remain `moderator` + `admin` + zero `learner_ops_*`, because
 * it is the only thing that can PROVE denial.
 *
 * IT CANNOT TOUCH THE COMMERCIAL FIXTURES. Users 66 and 67, and every other
 * existing learner, are outside the allowlist. Accepted Affiliate and Pocket
 * evidence cannot be contaminated by this tool.
 *
 * IT IS NOT A PROGRESSION AUTHORITY. It creates principals and enrolls learners
 * through `enrollUserInPublishedCurriculum`, the canonical enrollment owner. It
 * writes no `UserLevelProgress`, no `ReportSubmission`, no `XPTransaction` and
 * no raw SQL. Positioning a learner for the report and mentor-review journeys is
 * done afterwards through the platform's OWN commands and the existing
 * `StagingAttestation` harness — never by manufacturing progression here.
 *
 * IT IS NOT A DATABASE TOOL. No SQL, no `--table`, no raw query, no migration.
 *
 * IT IS NOT AN HTTP SURFACE. Nothing here is imported by a route.
 *
 * ============================================================================
 * OUTPUT DISCIPLINE
 * ============================================================================
 * Human lines to stderr, one JSON result object to stdout, so `> evidence.json`
 * is clean. NEITHER carries a password, a hash, a length, a session secret or
 * any environment value. The JSON names fixture KEYS and emails from the
 * reviewed allowlist and nothing else.
 *
 *   DATABASE_URL=... ATA_LEARNER_OPS_FIXTURE_CONFIRM=PROVISION_LEARNER_OPS_ACCEPTANCE_FIXTURES \
 *     npx tsx scripts/ops/learnerOpsAcceptanceFixture.ts provision --apply
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { checkPreprodEnvironment } from "./preprod-qa-operator/guard";
import {
  FIXTURE_BCRYPT_COST,
  LEARNER_FIXTURES,
  LEARNER_OPS_FIXTURE_AUDIT_ACTION,
  STAFF_FIXTURES,
  isAllowlisted,
  type LearnerFixture,
  type StaffFixture,
} from "./learner-ops-fixture/identities";
import { hasControllingTty, intakeFixturePassword } from "./learner-ops-fixture/tty-password";
import { enrollUserInPublishedCurriculum } from "@/lib/curriculum/enrollment";

/**
 * This tool's OWN acknowledgement, deliberately distinct from the QA operator's.
 * An acknowledgement left in a shell after provisioning that principal must not
 * silently authorize provisioning these.
 */
export const FIXTURE_CONFIRM_KEY = "ATA_LEARNER_OPS_FIXTURE_CONFIRM";
export const FIXTURE_CONFIRM_VALUE = "PROVISION_LEARNER_OPS_ACCEPTANCE_FIXTURES";

type Verb = "provision" | "inspect";

function note(line: string): void {
  process.stderr.write(`${line}\n`);
}

export type FixtureRefusal =
  | "unknown_verb"
  | "environment"
  | "missing_confirmation"
  | "no_controlling_tty"
  | "not_allowlisted"
  | "password_rejected";

/**
 * The full gate. Environment checks run BEFORE the acknowledgement, so on a
 * production host the answer is "wrong environment" no matter what anyone typed.
 */
export function checkFixtureAllowed(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; reason: FixtureRefusal; detail: string } {
  // ORDER MATTERS AND IS ASSERTED BY REGRESSION. The environment is judged
  // FIRST, so on a production host the answer is "wrong environment" no matter
  // what anyone typed, and the sentinel is never something a production host can
  // be walked toward one variable at a time.
  const environment = checkPreprodEnvironment(env);
  if (environment.kind === "refused") {
    return { ok: false, reason: "environment", detail: environment.reason };
  }
  return checkAcknowledgement(env);
}

/**
 * The acknowledgement half, separated so it is testable on its own.
 *
 * It cannot be tested through `checkFixtureAllowed` with a hand-built
 * environment, because the environment gate's third check demands a deployment
 * the application would actually agree to boot on — a synthetic map of
 * variables is, correctly, refused as "a claim about PREPROD rather than one".
 * That is the guard working, so the acknowledgement gets its own entry point
 * rather than a weakened environment check to accommodate a test.
 */
export function checkAcknowledgement(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; reason: FixtureRefusal; detail: string } {
  if (env[FIXTURE_CONFIRM_KEY] !== FIXTURE_CONFIRM_VALUE) {
    return {
      ok: false,
      reason: "missing_confirmation",
      detail: `${FIXTURE_CONFIRM_KEY} must equal the exact sentinel for this operation`,
    };
  }
  return { ok: true };
}

/* --------------------------------------------------------------- provision */

async function provisionStaff(
  prisma: PrismaClient,
  fixture: StaffFixture,
  password: string,
): Promise<{ userId: number; staffId: string; created: boolean }> {
  // Belt as well as braces: the allowlist is the source of the fixture, and it
  // is asserted again immediately before the write.
  if (!isAllowlisted(fixture.email)) {
    throw new Error(`refusing a non-allowlisted address for ${fixture.key}`);
  }

  const passwordHash = await bcrypt.hash(password, FIXTURE_BCRYPT_COST);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: fixture.email },
      select: { id: true, staffProfile: { select: { id: true } } },
    });

    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            role: fixture.userRole,
            status: "active",
            name: fixture.name,
            emailVerifiedAt: new Date(),
          },
          select: { id: true },
        })
      : await tx.user.create({
          data: {
            email: fixture.email,
            name: fixture.name,
            passwordHash,
            role: fixture.userRole,
            status: "active",
            emailVerifiedAt: new Date(),
          },
          select: { id: true },
        });

    const staff = await tx.staffProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        displayName: fixture.displayName,
        staffRole: fixture.staffRole,
      },
      update: { displayName: fixture.displayName, staffRole: fixture.staffRole },
      select: { id: true },
    });

    // Provenance, so a later reader can tell a fixture from a real employee
    // without consulting a document. No password, no hash, no length.
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: LEARNER_OPS_FIXTURE_AUDIT_ACTION,
        entityType: "StaffProfile",
        entityId: staff.id,
        metadata: {
          synthetic: true,
          fixtureKey: fixture.key,
          staffRole: fixture.staffRole,
          userRole: fixture.userRole,
          phase: "ATA-PREPROD-LEARNER-OPERATIONS-CRM-END-TO-END-1",
          purpose: fixture.why,
        },
      },
    });

    return { userId: user.id, staffId: staff.id, created: existing === null };
  });
}

async function provisionLearner(
  prisma: PrismaClient,
  fixture: LearnerFixture,
  password: string,
  /**
   * The staff actor the canonical enrollment owner will attribute the enrolment
   * to. It is the `admin` fixture provisioned moments earlier — a synthetic
   * operator performing an operator action, which is exactly what the
   * enrolment command expects. It is never a learner and never a real employee.
   */
  actorId: number,
): Promise<{ userId: number; created: boolean; enrolled: boolean }> {
  if (!isAllowlisted(fixture.email)) {
    throw new Error(`refusing a non-allowlisted address for ${fixture.key}`);
  }

  const passwordHash = await bcrypt.hash(password, FIXTURE_BCRYPT_COST);

  const existing = await prisma.user.findUnique({
    where: { email: fixture.email },
    select: { id: true },
  });

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, status: "active", emailVerifiedAt: new Date() },
        select: { id: true },
      })
    : await prisma.user.create({
        data: {
          email: fixture.email,
          name: fixture.name,
          passwordHash,
          role: "user",
          status: "active",
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: LEARNER_OPS_FIXTURE_AUDIT_ACTION,
      entityType: "User",
      entityId: String(user.id),
      metadata: {
        synthetic: true,
        fixtureKey: fixture.key,
        phase: "ATA-PREPROD-LEARNER-OPERATIONS-CRM-END-TO-END-1",
        purpose: fixture.why,
      },
    },
  });

  // THE CANONICAL ENROLLMENT OWNER. Not an insert — this is the same function
  // registration itself calls, so the enrollment, its curriculum version and its
  // level-progress rows are created by the authority that owns them.
  let enrolled = false;
  try {
    const result = await enrollUserInPublishedCurriculum({ userId: user.id, actorId });
    enrolled = result.kind === "enrolled";
  } catch (error) {
    note(`  ! enrollment for ${fixture.key} refused by the canonical owner: ${(error as Error).message}`);
  }

  return { userId: user.id, created: existing === null, enrolled };
}

/* -------------------------------------------------------------------- main */

async function main(): Promise<number> {
  const verb = (process.argv[2] ?? "") as Verb;
  const apply = process.argv.includes("--apply");

  if (verb !== "provision" && verb !== "inspect") {
    note("usage: learnerOpsAcceptanceFixture.ts <provision|inspect> [--apply]");
    process.stdout.write(JSON.stringify({ ok: false, refusal: "unknown_verb" }, null, 2) + "\n");
    return 2;
  }

  const prisma = new PrismaClient();

  try {
    if (verb === "inspect") {
      const rows: unknown[] = [];
      for (const fixture of [...STAFF_FIXTURES, ...LEARNER_FIXTURES]) {
        const user = await prisma.user.findUnique({
          where: { email: fixture.email },
          select: {
            id: true,
            role: true,
            status: true,
            staffProfile: { select: { staffRole: true } },
            curriculumEnrollments: { select: { status: true } },
          },
        });
        rows.push({
          key: fixture.key,
          email: fixture.email,
          exists: user !== null,
          userId: user?.id ?? null,
          userRole: user?.role ?? null,
          staffRole: user?.staffProfile?.staffRole ?? null,
          enrollments: user?.curriculumEnrollments.length ?? 0,
        });
      }
      process.stdout.write(JSON.stringify({ ok: true, verb, fixtures: rows }, null, 2) + "\n");
      return 0;
    }

    /* ------------------------------------------------------------ provision */

    const gate = checkFixtureAllowed();
    if (!gate.ok) {
      note(`REFUSED: ${gate.reason} — ${gate.detail}`);
      process.stdout.write(JSON.stringify({ ok: false, refusal: gate.reason }, null, 2) + "\n");
      return 3;
    }

    if (!apply) {
      note("DRY RUN — nothing is written and no password is requested. Add --apply.");
      note("would provision:");
      for (const f of STAFF_FIXTURES) note(`  staff   ${f.key.padEnd(9)} ${f.email}  ${f.staffRole}/${f.userRole}`);
      for (const f of LEARNER_FIXTURES) note(`  learner ${f.key.padEnd(9)} ${f.email}`);
      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            verb,
            applied: false,
            staff: STAFF_FIXTURES.map((f) => ({ key: f.key, email: f.email, staffRole: f.staffRole, userRole: f.userRole })),
            learners: LEARNER_FIXTURES.map((f) => ({ key: f.key, email: f.email })),
          },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }

    if (!hasControllingTty()) {
      note("REFUSED: no controlling terminal. The password must be typed by a human on /dev/tty.");
      note("         This tool cannot be run from a pipeline, a cron job or a redirect.");
      process.stdout.write(JSON.stringify({ ok: false, refusal: "no_controlling_tty" }, null, 2) + "\n");
      return 4;
    }

    note("");
    note("Passwords are typed here, hidden, and are never logged, echoed or stored.");
    note("ONE password is taken for all staff fixtures and ONE for all learner fixtures:");
    note("these are synthetic acceptance identities on PREPROD, and fewer prompts means");
    note("fewer chances for a secret to end up somewhere it should not be.");
    note("");

    const staffPassword = intakeFixturePassword("the three STAFF fixtures");
    if (!staffPassword.ok) {
      note(`REFUSED: staff password — ${staffPassword.reason}`);
      if (staffPassword.issues) staffPassword.issues.forEach((i) => note(`         ${i}`));
      process.stdout.write(JSON.stringify({ ok: false, refusal: "password_rejected" }, null, 2) + "\n");
      return 5;
    }

    const learnerPassword = intakeFixturePassword("the six LEARNER fixtures");
    if (!learnerPassword.ok) {
      note(`REFUSED: learner password — ${learnerPassword.reason}`);
      if (learnerPassword.issues) learnerPassword.issues.forEach((i) => note(`         ${i}`));
      process.stdout.write(JSON.stringify({ ok: false, refusal: "password_rejected" }, null, 2) + "\n");
      return 5;
    }

    const staffResults: unknown[] = [];
    let actorId: number | null = null;
    for (const fixture of STAFF_FIXTURES) {
      const result = await provisionStaff(prisma, fixture, staffPassword.password);
      if (fixture.key === "admin") actorId = result.userId;
      note(`  staff   ${fixture.key.padEnd(9)} userId=${result.userId} staffId=${result.staffId} ${result.created ? "created" : "updated"}`);
      staffResults.push({ key: fixture.key, email: fixture.email, userId: result.userId, staffId: result.staffId, staffRole: fixture.staffRole, userRole: fixture.userRole, created: result.created });
    }
    if (actorId === null) throw new Error("the admin fixture must exist before learners are enrolled");

    const learnerResults: unknown[] = [];
    for (const fixture of LEARNER_FIXTURES) {
      const result = await provisionLearner(prisma, fixture, learnerPassword.password, actorId);
      note(`  learner ${fixture.key.padEnd(9)} userId=${result.userId} ${result.created ? "created" : "updated"} enrolled=${result.enrolled}`);
      learnerResults.push({ key: fixture.key, email: fixture.email, userId: result.userId, created: result.created, enrolled: result.enrolled });
    }

    process.stdout.write(
      JSON.stringify({ ok: true, verb, applied: true, staff: staffResults, learners: learnerResults }, null, 2) + "\n",
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * IMPORTING THIS MODULE MUST DO NOTHING.
 *
 * `guard.test.ts` imports `checkFixtureAllowed` to assert the refusals. Running
 * `main()` at module load meant importing the provisioner tried to PROVISION —
 * which is both a broken test harness and, much worse, a tool that acts merely
 * because something referenced it. The entry point is therefore explicit: it
 * runs only when this file is the process's entry script.
 */
const invokedDirectly =
  typeof process.argv[1] === "string" && process.argv[1].includes("learnerOpsAcceptanceFixture");

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      note(`FAILED: ${(error as Error).message}`);
      process.exit(1);
    });
}
