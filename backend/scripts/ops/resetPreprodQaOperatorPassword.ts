/**
 * ONE-SHOT REMEDIATION — restore the PREPROD QA operator's application password.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A NEW CAPABILITY.
 *
 * During ATA-PREPROD-COMMUNITY-END-TO-END-1 the acceptance run overwrote the
 * password of `preprod-qa-operator@ata.invalid` (user 54) with a value of its
 * own choosing, so the human's PREPROD staff credential no longer opens the CRM.
 * Nothing else about the account changed: `StaffProfile.staffRole` is still
 * `moderator`, `community_moderate` still resolves, and no product row moved.
 *
 * NEITHER ACCEPTED PROVISIONER CAN FIX IT, which is why this file is here:
 *
 *   `preprodQaOperator provision`  OWNS this identity but is CREATE-ONLY by
 *                                  design — "no update and no upsert update
 *                                  branch anywhere in this file". It reports
 *                                  `already_configured` and changes nothing.
 *
 *   `learnerOpsAcceptanceFixture`  has the TTY password intake but EXPLICITLY
 *                                  refuses this address, to keep it the negative
 *                                  RBAC control for Learner Operations.
 *
 * So this is a deliberate, minimal, one-shot correction of drift that this phase
 * introduced. It is NOT a user-management CLI: no `--email`, no `--role`, no
 * `--staff-role`, no create, no delete, no second principal.
 *
 * WHAT IT WRITES: exactly one column, `User.passwordHash`, on exactly one row,
 * selected by an address frozen in source below. It does not touch email, role,
 * status, StaffProfile, permissions, Community data, Academy progression,
 * Learner Operations cases, Pocket or Affiliate records, and it can never reach
 * users 66/67 — their addresses are not the one constant it will match.
 *
 * WHERE THE SECRET COMES FROM: `/dev/tty`, typed by a human, with echo off,
 * confirmed twice, validated against the product's own `registerSchema`. That
 * is the ALREADY-ACCEPTED intake module from the Learner Operations fixtures,
 * imported rather than reimplemented. There is no argv path, no environment
 * path, no stdin path and no file path — a redirect or a pipe cannot satisfy
 * `/dev/tty`, so this cannot be automated into something that stores a secret.
 *
 * NOTHING DERIVED FROM THE PASSWORD IS PRINTED: not the plaintext, not the
 * hash, not a length, not a prefix.
 *
 * RUN IT AS THE HUMAN, IN A REAL TERMINAL:
 *
 *   cd /home/ubuntu/learner-ops-v1/backend
 *   sudo HOME=/root npx tsx scripts/ops/resetPreprodQaOperatorPassword.ts --apply
 *
 * It reads the deployment's own environment file itself, so no secret passes
 * through your shell. It is a DRY RUN without `--apply`.
 */
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { intakeFixturePassword, hasControllingTty } from "./learner-ops-fixture/tty-password";
import { QA_OPERATOR_EMAIL } from "./preprod-qa-operator/identity";
import { checkPreprodEnvironment } from "./preprod-qa-operator/guard";

/**
 * The ONLY address this file can act on. Frozen in source and imported from the
 * identity module that already owns it, so the two cannot drift apart and a
 * shell on this host cannot point this at anybody else.
 */
const TARGET_EMAIL = QA_OPERATOR_EMAIL;

/** The bcrypt cost the product's own registration uses. */
const BCRYPT_COST = 10;

/** The deployment's own runtime environment, as systemd hands it to the service. */
const RUNTIME_ENV_FILE = process.env.ATA_ENV_FILE ?? "/srv/ata/config/backend.env";

/**
 * Load the runtime environment the way systemd's `EnvironmentFile=` does, and
 * NOT the way a shell `source` does.
 *
 * They disagree, and the disagreement is not academic: shell-sourcing this file
 * silently produced an EMPTY `POCKET_AFFILIATE_BASE_URL` because the shell
 * interprets characters inside the value, and the guard then refused a host
 * that is plainly PREPROD. systemd takes the whole remainder of the line
 * verbatim, which is why the service boots and the shell did not.
 *
 * Only keys ABSENT from the process environment are filled, so an explicitly
 * exported value still wins. No value is printed, here or anywhere.
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

    if (user.staffProfile?.staffRole !== "moderator") {
      // The whole point of restoring this credential is to exercise Community
      // moderation. If the role is not what the phase expects, stop and let a
      // human look rather than quietly resetting a password on a changed
      // principal.
      note("REFUSING: staffRole is not `moderator`. Investigate before resetting anything.");
      process.exit(2);
    }

    if (!apply) {
      note("");
      note("DRY RUN. Nothing was read from the terminal and nothing was written.");
      note("Re-run with --apply to be prompted for the password.");
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
      select: { id: true, email: true, role: true, status: true, staffProfile: { select: { staffRole: true } } },
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
