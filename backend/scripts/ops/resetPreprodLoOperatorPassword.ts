/**
 * ONE-SHOT REMEDIATION — restore the PREPROD LO operator's application password.
 *
 * WHY THIS EXISTS.
 *
 * ATA-PREPROD-COMMUNITY-END-TO-END-1 overwrote the passwords of five synthetic
 * accounts (54, 68, 71, 72, 73) to obtain sessions for acceptance. User 68 is
 * the NEGATIVE RBAC CONTROL for Community — `StaffProfile.staffRole = support`,
 * `community_moderate` absent — and the phase cannot finish without logging in
 * as it. Its `User.updatedAt` reads 2026-08-16 19:24:29Z, the same second as the
 * 71/72/73 batch, which is what identifies this as that drift and not a role,
 * status, routing or edge problem.
 *
 * WHY NOT THE ACCEPTED LO FIXTURE PROVISIONER, WHICH *CAN* RESET THIS ACCOUNT.
 *
 * `learnerOpsAcceptanceFixture provision --apply` owns this identity and does
 * update an existing `passwordHash`, so unlike the QA operator there IS an
 * accepted reset path. It is still the wrong instrument here: `provision` has
 * no per-identity selector — `--learner` belongs to `enroll` — so it rewrites
 * ALL NINE fixtures (staff 68/69/70 and learners 71-76) with the ONE password
 * typed at the prompt. Six of those are not drifted, and the learner fixtures
 * may belong to a different password group than the staff one; resetting them
 * to a staff credential would create new drift to repair the old.
 *
 * Its identity fields were checked and would be written back unchanged — name,
 * User.role, StaffProfile.displayName and staffRole all already equal the
 * fixture's declared values — so the objection is scope, not correctness.
 *
 * WHAT THIS WRITES: exactly one column, `User.passwordHash`, on exactly one row,
 * identified by an address frozen in source AND by user id AND by staff role AND
 * by the absence of the permission this account exists to be denied. It touches
 * no other account, no other column, and nothing in any product domain.
 *
 * WHERE THE SECRET COMES FROM: `/dev/tty`, typed by a human, echo off, twice,
 * validated against the product's own `registerSchema` — the already-accepted
 * intake module, imported rather than reimplemented. No argv, no environment, no
 * stdin, no file. A redirect or a pipe cannot satisfy `/dev/tty`.
 *
 * NOTHING DERIVED FROM THE PASSWORD IS PRINTED: not the plaintext, not the hash,
 * not a length, not a prefix.
 *
 * RUN IT AS THE HUMAN, IN A REAL TERMINAL, FROM THE BACKEND DIRECTORY:
 *
 *   sudo HOME=/root npx tsx scripts/ops/resetPreprodLoOperatorPassword.ts --apply
 *
 * It reads the deployment's own environment file itself, with systemd's
 * semantics rather than a shell's, so no secret passes through your shell. It is
 * a DRY RUN without `--apply`, and `--dry-run` says so explicitly.
 */
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { intakeFixturePassword, hasControllingTty } from "./learner-ops-fixture/tty-password";
import { checkPreprodEnvironment } from "./preprod-qa-operator/guard";
import { resolveEffectivePermissions } from "@/lib/crm/roles";

/** The ONLY address this file can act on. Frozen in source. */
const TARGET_EMAIL = "lo-operator@learner-ops.invalid";
/** The ONLY user id this file can act on. Belt to the address's braces. */
const TARGET_USER_ID = 68;
/** The role this principal must still hold. A different one means investigate. */
const REQUIRED_STAFF_ROLE = "support";
/** The permission this principal exists to be DENIED. Must stay absent. */
const FORBIDDEN_PERMISSION = "community_moderate";

/** The bcrypt cost the product's own registration uses. */
const BCRYPT_COST = 10;

const RUNTIME_ENV_FILE = process.env.ATA_ENV_FILE ?? "/srv/ata/config/backend.env";

function note(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Load the runtime environment the way systemd's `EnvironmentFile=` does.
 *
 * NOT the way a shell `source` does: they disagree, and shell-sourcing this file
 * silently yields an empty `POCKET_AFFILIATE_BASE_URL` because the shell
 * interprets characters inside the value. Only keys absent from the process
 * environment are filled. No value is printed.
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

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

  const runtime = loadRuntimeEnv();
  if (runtime === null) {
    note(`REFUSING: could not read ${RUNTIME_ENV_FILE}. Run this with sudo on the PREPROD host.`);
    process.exit(2);
  }
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
        staffProfile: { select: { id: true, staffRole: true, displayName: true } },
      },
    });

    if (!user) {
      note(`REFUSING: ${TARGET_EMAIL} does not exist. This tool never creates an account.`);
      process.exit(2);
    }

    const staffRole = user.staffProfile?.staffRole ?? null;
    const permissions = staffRole ? resolveEffectivePermissions(staffRole) : [];
    const holdsForbidden = permissions.includes(FORBIDDEN_PERMISSION);

    note("target (this tool changes the credential and nothing else):");
    note(`  userId      : ${user.id}`);
    note(`  email       : ${user.email}`);
    note(`  name        : ${user.name}`);
    note(`  User.role   : ${user.role}`);
    note(`  status      : ${user.status}`);
    note(`  employeeId  : ${user.staffProfile?.id ?? "(none)"}`);
    note(`  staffRole   : ${staffRole ?? "(no StaffProfile)"}`);
    note(`  permissions : ${permissions.length} resolved`);
    note(`  ${FORBIDDEN_PERMISSION}: ${holdsForbidden ? "PRESENT" : "ABSENT"}`);

    // FOUR INDEPENDENT GUARDS. Each one alone would be enough to stop a reset
    // aimed at the wrong principal; together they mean the account this writes
    // to is the negative control or nothing at all.
    if (user.id !== TARGET_USER_ID) {
      note(`REFUSING: expected userId ${TARGET_USER_ID}, found ${user.id}.`);
      process.exit(2);
    }
    if (staffRole !== REQUIRED_STAFF_ROLE) {
      note(`REFUSING: staffRole must be \`${REQUIRED_STAFF_ROLE}\`. Investigate before resetting anything.`);
      process.exit(2);
    }
    if (holdsForbidden) {
      // If this principal ever holds the permission it exists to be denied, the
      // negative control is already broken and a password is not the problem.
      note(`REFUSING: this principal holds ${FORBIDDEN_PERMISSION}. It is the NEGATIVE control and must not.`);
      process.exit(2);
    }
    if (user.status !== "active") {
      note(`REFUSING: status is \`${user.status}\`, not active.`);
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

    // ONE COLUMN, ONE ROW, and the row is pinned by id as well as by address.
    const updated = await prisma.user.update({
      where: { id: TARGET_USER_ID },
      data: { passwordHash: await bcrypt.hash(intake.password, BCRYPT_COST) },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        staffProfile: { select: { staffRole: true, displayName: true } },
      },
    });

    const after = resolveEffectivePermissions(updated.staffProfile!.staffRole);
    note("");
    note("credential updated. Nothing derived from it was printed or stored.");
    note(`  userId      : ${updated.id}`);
    note(`  email       : ${updated.email} (unchanged)`);
    note(`  User.role   : ${updated.role} (unchanged)`);
    note(`  status      : ${updated.status} (unchanged)`);
    note(`  staffRole   : ${updated.staffProfile?.staffRole} (unchanged)`);
    note(`  displayName : ${updated.staffProfile?.displayName} (unchanged)`);
    note(`  permissions : ${after.length} resolved`);
    note(`  ${FORBIDDEN_PERMISSION}: ${after.includes(FORBIDDEN_PERMISSION) ? "PRESENT — INVESTIGATE" : "ABSENT (negative control intact)"}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  note(`FAILED: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exit(1);
});
