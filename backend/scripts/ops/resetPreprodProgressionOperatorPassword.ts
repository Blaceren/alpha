/**
 * ONE-SHOT — set the PREPROD progression operator's application password.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A NEW CAPABILITY.
 *
 * PHASE-1 ADMIN created one disposable PREPROD staff principal —
 * `progression_operator`, user 79 — so a human can exercise the administrative
 * progression correction in a real browser. It was created WITHOUT a password
 * on purpose: the session that would use it cannot be minted by an agent (CRM
 * login is CAPTCHA-gated), and inventing a password to store would put a secret
 * into a transcript, which is the one thing the accepted intake exists to
 * prevent.
 *
 * NO ACCEPTED TOOL COULD SET IT, which is why this file is here:
 *
 *   `resetPreprodQaOperatorPassword`  frozen to `QA_OPERATOR_EMAIL` and REFUSES
 *                                     unless `staffRole === "moderator"`.
 *   `resetPreprodLoOperatorPassword`  frozen to `lo-operator@learner-ops.invalid`
 *                                     / user 68 and refuses on any other role.
 *   `preprodQaOperator provision`     create-only, one frozen identity.
 *   `learnerOpsAcceptanceFixture`     no per-identity selector; rewrites all nine.
 *
 * Neither reset script accepts `--email` or `--user` — deliberately — so neither
 * can reach user 79. This is the same shape, frozen to the new principal.
 *
 * IT IS NOT A USER-MANAGEMENT CLI: no `--email`, no `--role`, no `--staff-role`,
 * no create, no delete, no second principal.
 *
 * WHAT IT WRITES: exactly one column, `User.passwordHash`, on exactly one row,
 * selected by an address AND a user id AND a staffRole that must all three match
 * the constants below. It does not touch email, role, status, StaffProfile,
 * permissions, Academy progression, Community, Learner Operations, Pocket or
 * Affiliate records, and it cannot reach any shared fixture account: none of
 * them carries this address, this id, or this staff role.
 *
 * WHERE THE SECRET COMES FROM: `/dev/tty`, typed by a human, with echo off,
 * confirmed twice, validated against the product's own `registerSchema`. That is
 * the ALREADY-ACCEPTED intake module, imported rather than reimplemented. There
 * is no argv path, no environment path, no stdin path and no file path — a
 * redirect or a pipe cannot satisfy `/dev/tty`, so this cannot be automated into
 * something that stores a secret, and an agent cannot run it at all.
 *
 * NOTHING DERIVED FROM THE PASSWORD IS PRINTED: not the plaintext, not the hash,
 * not a length, not a prefix.
 *
 * RUN IT AS THE HUMAN, IN A REAL TERMINAL:
 *
 *   cd /home/ubuntu/learner-ops-v1/backend
 *   sudo HOME=/root npx tsx scripts/ops/resetPreprodProgressionOperatorPassword.ts --apply
 *
 * It reads the deployment's own environment file itself, so no secret passes
 * through your shell. It is a DRY RUN without `--apply`.
 */
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { intakeFixturePassword, hasControllingTty } from "./learner-ops-fixture/tty-password";
import { checkPreprodEnvironment } from "./preprod-qa-operator/guard";

/**
 * THE THREE CONSTANTS THIS FILE CAN ACT ON, and all three must match.
 *
 * The address alone would be enough to be safe; the id and the staff role are
 * additional because this principal was created by an automated run and a
 * three-way match is what makes "this is the account I meant" checkable by a
 * reader rather than assumed.
 */
/**
 * LOWERCASE, AND THAT IS LOAD-BEARING. The address was first created from an ISO
 * timestamp, so it carried an uppercase `T` and `Z` — and `loginSchema` lowercases
 * whatever a human types, so the lookup could never match the stored row and the
 * account was unloggable. The row was corrected; this constant must stay in the
 * same case as the row or this tool stops finding it.
 */
const TARGET_EMAIL = "progression-e2e-operator-2026-08-30t16-38-41-086z@e2e.invalid";
const TARGET_USER_ID = 79;
const REQUIRED_STAFF_ROLE = "progression_operator";

/** The bcrypt cost the product's own registration uses. */
const BCRYPT_COST = 10;

/** The deployment's own runtime environment, as systemd hands it to the service. */
const RUNTIME_ENV_FILE = process.env.ATA_ENV_FILE ?? "/srv/ata/config/backend.env";

/**
 * Load the runtime environment the way systemd's `EnvironmentFile=` does, and
 * NOT the way a shell `source` does. They disagree, and shell-sourcing has
 * already produced a value mangled enough to make the PREPROD guard refuse a
 * host that is plainly PREPROD. Only keys ABSENT from the process environment
 * are filled. No value is printed, here or anywhere.
 */
function loadRuntimeEnv(): { readonly loaded: number; readonly file: string } | null {
  let raw: string;
  try {
    raw = readFileSync(RUNTIME_ENV_FILE, "utf8");
  } catch {
    return null;
  }
  let loaded = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1);
    loaded += 1;
  }
  return { loaded, file: RUNTIME_ENV_FILE };
}

function note(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const runtime = loadRuntimeEnv();
  if (runtime === null) {
    note(`REFUSING: could not read ${RUNTIME_ENV_FILE}. Run this with sudo on the PREPROD host.`);
    process.exit(2);
  }
  // A COUNT, never a key list and never a value.
  note(`runtime environment: ${runtime.loaded} keys loaded from ${runtime.file}`);

  const environment = checkPreprodEnvironment();
  if (environment.kind !== "allowed") {
    note(`REFUSING: this is not a PREPROD host (${environment.reason}).`);
    note(`  ${environment.detail}`);
    process.exit(2);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL ?? "" } },
  });

  try {
    const user = await prisma.user.findUnique({
      where: { email: TARGET_EMAIL },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        staffProfile: { select: { id: true, staffRole: true } },
      },
    });

    if (!user) {
      note(`REFUSING: ${TARGET_EMAIL} does not exist. This tool never creates an account.`);
      process.exit(2);
    }

    note("target (unchanged by this tool except the credential):");
    note(`  userId      : ${user.id}`);
    note(`  email       : ${user.email}`);
    note(`  name        : ${user.name}`);
    note(`  User.role   : ${user.role}`);
    note(`  status      : ${user.status}`);
    note(`  staffRole   : ${user.staffProfile?.staffRole ?? "(no StaffProfile)"}`);

    if (user.id !== TARGET_USER_ID) {
      note(`REFUSING: ${TARGET_EMAIL} is user ${user.id}, not ${TARGET_USER_ID}.`);
      process.exit(2);
    }
    if (user.staffProfile?.staffRole !== REQUIRED_STAFF_ROLE) {
      // If the role is not what this phase created, stop and let a human look
      // rather than quietly resetting a password on a changed principal.
      note(`REFUSING: staffRole must be \`${REQUIRED_STAFF_ROLE}\`. Investigate before resetting anything.`);
      process.exit(2);
    }
    if (user.role !== "user") {
      // This principal is authorised on the CRM StaffProfile axis only. A
      // `User.role` of `admin` here would mean somebody widened it, and widening
      // is exactly what the dedicated role exists to avoid.
      note("REFUSING: User.role is not `user`. This principal must not hold legacy admin authority.");
      process.exit(2);
    }

    if (!apply) {
      note("");
      note("DRY RUN. Nothing was read from the terminal and nothing was written.");
      note("Re-run with --apply, in a real terminal, to be prompted for the password.");
      return;
    }

    if (!hasControllingTty()) {
      note("REFUSING: no controlling terminal. The password is typed by a human or not at all.");
      process.exit(2);
    }

    const intake = intakeFixturePassword(`PREPROD staff password for ${TARGET_EMAIL}`);
    if (!intake.ok) {
      note(
        intake.reason === "policy"
          ? `REFUSING: the password does not satisfy the product's own policy: ${(intake.issues ?? []).join("; ")}`
          : `REFUSING: password intake failed (${intake.reason}).`,
      );
      process.exit(2);
    }

    // ONE COLUMN, ONE ROW, SELECTED BY THE FROZEN ADDRESS.
    const updated = await prisma.user.update({
      where: { email: TARGET_EMAIL },
      data: { passwordHash: await bcrypt.hash(intake.password, BCRYPT_COST) },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        staffProfile: { select: { staffRole: true } },
      },
    });

    note("");
    note("credential updated. Nothing derived from it was printed or stored.");
    note(`  userId    : ${updated.id}`);
    note(`  email     : ${updated.email}`);
    note(`  User.role : ${updated.role} (unchanged)`);
    note(`  status    : ${updated.status} (unchanged)`);
    note(`  staffRole : ${updated.staffProfile?.staffRole} (unchanged)`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  // Never let an exception carry the secret into a log.
  note(`FAILED: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exit(1);
});
