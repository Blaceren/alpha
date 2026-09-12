/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§4) — record, in the database, that
 * an account was created for acceptance.
 *
 * THE GAP THIS CLOSES. Learner 62 was registered in a real browser by the
 * operator to run the mandatory §26/§27 gate. Its provenance is documented in
 * the audit package and NOWHERE IN THE DATABASE, so `classifyAccountProvenance`
 * can only report it as `SELF_SERVICE_UNPROVEN_PROVENANCE` — which is honest,
 * and understates what is actually known.
 *
 * THE MECHANISM IS THE ONE THE PLATFORM ALREADY HAS. `preprod-qa-operator`
 * writes `PREPROD_QA_OPERATOR_PROVISIONED` with `metadata.synthetic = true`
 * when it provisions a synthetic principal. This writes the same kind of row
 * for an account a phase created for acceptance. No column, no migration, no
 * new concept — one audit row, which is what an audit log is for.
 *
 * WHAT IT REFUSES TO DO
 *   • it will not declare an account that already carries a declaration
 *   • it will not declare an account that does not exist
 *   • it will not modify the User row in any way — no email, no role, no status
 *   • it will not run without `--apply`
 *
 * A DECLARATION IS A CLAIM, SO IT IS ATTRIBUTED. Every row records the phase
 * that made it and the purpose it was made for, so a later reader can judge the
 * claim rather than inherit it.
 *
 *   DATABASE_URL=... npx tsx scripts/ops/declareAcceptanceFixture.ts --user 62 \
 *     --purpose pocket_reg_browser_acceptance --phase <PHASE> [--apply]
 */
import { PrismaClient } from "@prisma/client";
import {
  ACCEPTANCE_FIXTURE_AUDIT_ACTION,
  isReservedNonRoutableAddress,
} from "@/lib/growth/account-provenance";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const userId = Number(arg("user"));
  const purpose = arg("purpose");
  const phase = arg("phase");

  if (!Number.isInteger(userId) || userId <= 0) {
    console.error("--user <id> is required");
    return 2;
  }
  if (!purpose || !phase) {
    console.error("--purpose <slug> and --phase <name> are required: a declaration must say why");
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!user) {
      console.error(`user ${userId} does not exist`);
      return 2;
    }

    const existing = await prisma.auditLog.findFirst({
      where: { action: ACCEPTANCE_FIXTURE_AUDIT_ACTION, entityType: "User", entityId: String(userId) },
      select: { id: true },
    });

    console.log("ACCEPTANCE FIXTURE DECLARATION");
    console.log(`  user            : ${user.id}`);
    console.log(`  address         : ${isReservedNonRoutableAddress(user.email) ? "reserved non-routable" : "routable"}`);
    console.log(`  role / status   : ${user.role} / ${user.status}`);
    console.log(`  purpose         : ${purpose}`);
    console.log(`  phase           : ${phase}`);
    console.log(`  already declared: ${existing ? `yes (audit ${existing.id})` : "no"}`);
    console.log(`  mode            : ${apply ? "APPLY" : "REPORT ONLY (pass --apply to write)"}`);
    console.log("");

    if (existing) {
      console.log("Already declared. Nothing written — declarations are not duplicated.");
      return 0;
    }
    if (!apply) {
      console.log("Nothing written. Re-run with --apply to record the declaration.");
      return 0;
    }

    const created = await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: ACCEPTANCE_FIXTURE_AUDIT_ACTION,
        entityType: "User",
        entityId: String(user.id),
        metadata: {
          synthetic: true,
          purpose,
          phase,
          environment: "preprod",
          declaredBy: "scripts/ops/declareAcceptanceFixture.ts",
          // The address is NOT recorded here. The classification needs the
          // account id and the declaration, not the address, and an audit row
          // is a wider-read surface than the User table.
          selfServiceRegistration: true,
        },
      },
      select: { id: true },
    });
    console.log(`declared: audit row ${created.id}`);
    console.log("The User row itself was not modified.");
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
