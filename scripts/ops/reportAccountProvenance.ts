/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§5/§29) — say what the PREPROD
 * population actually is, from authority rather than from address shape.
 *
 * REPLACES `reportSyntheticFixtures.ts`, which asked one question — does this
 * address end in `@ata-preprod.invalid`? — and reported everything else as
 * real. That produced "45 real learners" on an environment holding 3 accounts
 * with a routable address.
 *
 * WHAT THIS DOES DIFFERENTLY. It reads the authorities that were WRITTEN BY
 * SOMETHING and reports the classes they support, including the ones that are
 * uncomfortable: `SELF_SERVICE_UNPROVEN_PROVENANCE` and
 * `LEGACY_UNKNOWN_PROVENANCE` are printed at full size rather than folded into
 * a "real" total. `PROVEN_ORGANIC` is printed even when it is zero, because a
 * class that silently disappears when empty is a class a reader assumes was
 * never checked.
 *
 * It reads. It never writes, never deletes and never hides a row.
 *
 *   DATABASE_URL="file:/path/to/a/COPY.sqlite" npx tsx \
 *     scripts/ops/reportAccountProvenance.ts
 *
 * Exit 0 when it can run: this is a report, not a gate.
 */
import { PrismaClient } from "@prisma/client";
import {
  ACCEPTANCE_FIXTURE_AUDIT_ACTION,
  classifyAccountProvenance,
  isReservedNonRoutableAddress,
  type AccountProvenanceClass,
} from "@/lib/growth/account-provenance";

const CLASS_ORDER: readonly AccountProvenanceClass[] = [
  "PROVEN_SYNTHETIC_FIXTURE",
  "PROVEN_ORGANIC",
  "SELF_SERVICE_UNPROVEN_PROVENANCE",
  "LEGACY_UNKNOWN_PROVENANCE",
];

const CLASS_MEANING: Record<AccountProvenanceClass, string> = {
  PROVEN_SYNTHETIC_FIXTURE: "this system recorded that it created the account",
  PROVEN_ORGANIC: "positive evidence of a person (requires more than a routable address)",
  SELF_SERVICE_UNPROVEN_PROVENANCE: "registered from a real client; nothing proves person or fixture",
  LEGACY_UNKNOWN_PROVENANCE: "no registration authority and no provisioning authority",
};

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({ select: { id: true, email: true } });

    const staffUserIds = new Set(
      (await prisma.staffProfile.findMany({ select: { userId: true } })).map((s) => s.userId),
    );

    // Authority 1 — a provisioning run that wrote `synthetic: true` about itself.
    const provisioning = await prisma.auditLog.findMany({
      where: { entityType: "User", action: { startsWith: "PREPROD_" } },
      select: { entityId: true, action: true, metadata: true },
    });
    const syntheticProvisioned = new Set<number>();
    const acceptanceDeclared = new Set<number>();
    for (const row of provisioning) {
      const id = Number(row.entityId);
      if (!Number.isFinite(id)) continue;
      if (row.action === ACCEPTANCE_FIXTURE_AUDIT_ACTION) {
        acceptanceDeclared.add(id);
        continue;
      }
      const meta = row.metadata as { synthetic?: unknown } | null;
      if (meta && meta.synthetic === true) syntheticProvisioned.add(id);
    }

    // Authority 2 — the self-service registration trail and the client it saw.
    const registrations = await prisma.auditLog.findMany({
      where: { action: "AUTH_REGISTER", userId: { not: null } },
      select: { userId: true, ip: true },
    });
    const registrationByUser = new Map<number, { clientIp: string | null }>();
    for (const row of registrations) {
      if (row.userId !== null) registrationByUser.set(row.userId, { clientIp: row.ip });
    }

    const provenanceByUser = new Map<number, ReturnType<typeof classifyAccountProvenance>>();
    for (const user of users) {
      provenanceByUser.set(
        user.id,
        classifyAccountProvenance({
          email: user.email,
          hasSyntheticProvisioningAudit: syntheticProvisioned.has(user.id),
          hasAcceptanceFixtureDeclaration: acceptanceDeclared.has(user.id),
          hasStaffProfile: staffUserIds.has(user.id),
          selfServiceRegistration: registrationByUser.get(user.id) ?? null,
        }),
      );
    }

    console.log("PREPROD ACCOUNT PROVENANCE");
    console.log("read-only · subtracts nothing · classifies from persisted authority only");
    console.log("");

    console.log("AUTHORITIES CONSULTED");
    console.log(`  AuditLog PREPROD_*_PROVISIONED with metadata.synthetic=true : ${syntheticProvisioned.size}`);
    console.log(`  AuditLog ${ACCEPTANCE_FIXTURE_AUDIT_ACTION}      : ${acceptanceDeclared.size}`);
    console.log(`  AuditLog AUTH_REGISTER                                      : ${registrationByUser.size}`);
    console.log(`  StaffProfile                                                : ${staffUserIds.size}`);
    console.log("");

    console.log("POPULATION");
    console.log(`  learners total : ${users.length}`);
    for (const cls of CLASS_ORDER) {
      const ids = users.filter((u) => provenanceByUser.get(u.id)!.class === cls).map((u) => u.id);
      console.log(`    ${cls.padEnd(34)} ${String(ids.length).padStart(3)}   ${CLASS_MEANING[cls]}`);
      if (ids.length > 0) console.log(`      ids: ${ids.join(", ")}`);
    }
    console.log("");

    const reserved = users.filter((u) => isReservedNonRoutableAddress(u.email)).length;
    const staffCount = users.filter((u) => provenanceByUser.get(u.id)!.staffOperational).length;
    console.log("ORTHOGONAL ATTRIBUTES (not provenance classes)");
    console.log(`  on a reserved non-routable TLD : ${reserved} of ${users.length}`);
    console.log(`  on a routable address          : ${users.length - reserved} of ${users.length}`);
    console.log(`  carrying a StaffProfile        : ${staffCount} of ${users.length}`);
    console.log("");
    console.log("  A reserved address proves the account cannot receive mail. It does NOT");
    console.log("  prove who created it, which is why it is reported here and not as a class.");
    console.log("");

    const families = await prisma.growthEvent.groupBy({ by: ["eventType"], _count: { _all: true } });
    console.log("GROWTH LEDGER BY PROVENANCE OF THE ACCOUNT THE EVENT BELONGS TO");
    const header = "  " + "family".padEnd(24) + "total".padStart(6) +
      CLASS_ORDER.map((c) => c.split("_")[0].slice(0, 8).padStart(10)).join("");
    console.log(header);
    console.log("  " + "-".repeat(header.length - 2));

    const idsByClass = new Map<AccountProvenanceClass, number[]>();
    for (const cls of CLASS_ORDER) {
      idsByClass.set(cls, users.filter((u) => provenanceByUser.get(u.id)!.class === cls).map((u) => u.id));
    }

    for (const family of families.sort((a, b) => a.eventType.localeCompare(b.eventType))) {
      const cells: string[] = [];
      for (const cls of CLASS_ORDER) {
        const ids = idsByClass.get(cls)!;
        const count = ids.length
          ? await prisma.growthEvent.count({ where: { eventType: family.eventType, userId: { in: ids } } })
          : 0;
        cells.push(String(count).padStart(10));
      }
      console.log(
        "  " + family.eventType.padEnd(24) + String(family._count._all).padStart(6) + cells.join(""),
      );
    }
    console.log("");
    console.log("  Column headings are the first word of each class above, in the same order.");
    console.log("  Totals are canonical and unmodified: no row is subtracted anywhere.");
    console.log("");
    console.log("READING THIS HONESTLY");
    console.log("  'PROVEN_ORGANIC = 0' is a statement about the EVIDENCE, not a claim that");
    console.log("  no real person exists. Nothing in PREPROD currently proves one, and this");
    console.log("  report will not promote unproven accounts into that class to make the");
    console.log("  number look better.");
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
