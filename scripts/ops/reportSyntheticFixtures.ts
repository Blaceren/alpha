/**
 * POCKET-REG-SECURITY-CLOSURE-1 (§18) — say out loud how much of the Growth
 * ledger is acceptance-fixture activity.
 *
 * §18 requires that acceptance-fixture activity is never presented as
 * unexplained real business activity, and forbids solving that by silently
 * subtracting rows. This tool is the "stated explicitly" half: it reports, per
 * event family, how many rows belong to synthetic fixtures and how many belong
 * to real learners, so any number on a Growth surface can be decomposed.
 *
 * It reads. It never writes, never deletes and never hides a row.
 *
 *   DATABASE_URL="file:/path/to/a/COPY.sqlite" npx tsx \
 *     scripts/ops/reportSyntheticFixtures.ts
 *
 * Exit 0 always when it can run: this is a report, not a gate. A fixture in
 * PREPROD is expected — an UNEXPLAINED one is what the phase package is for.
 */
import { PrismaClient } from "@prisma/client";
import {
  SYNTHETIC_FIXTURE_EMAIL_DOMAIN,
  isSyntheticFixtureEmail,
} from "@/lib/growth/synthetic-fixtures";

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    console.log("SYNTHETIC ACCEPTANCE-FIXTURE REPORT");
    console.log(`fixture domain: ${SYNTHETIC_FIXTURE_EMAIL_DOMAIN}   (RFC 2606 reserved)`);
    console.log("read-only · subtracts nothing · identifies only");
    console.log("");

    const users = await prisma.user.findMany({ select: { id: true, email: true } });
    const fixtureIds = users.filter((u) => isSyntheticFixtureEmail(u.email)).map((u) => u.id);
    const realCount = users.length - fixtureIds.length;

    console.log(`learners: ${users.length} total = ${realCount} real + ${fixtureIds.length} fixture`);
    console.log(`fixture learner ids: ${fixtureIds.length ? fixtureIds.join(", ") : "(none)"}`);
    console.log("");

    const families = await prisma.growthEvent.groupBy({
      by: ["eventType"],
      _count: { _all: true },
    });

    console.log("GROWTH LEDGER DECOMPOSITION");
    let totalFixture = 0;
    for (const family of families.sort((a, b) => a.eventType.localeCompare(b.eventType))) {
      const fixture = fixtureIds.length
        ? await prisma.growthEvent.count({
            where: { eventType: family.eventType, userId: { in: fixtureIds } },
          })
        : 0;
      totalFixture += fixture;
      const total = family._count._all;
      console.log(
        `  ${family.eventType.padEnd(24)} total=${String(total).padStart(4)} ` +
          `real=${String(total - fixture).padStart(4)} fixture=${String(fixture).padStart(4)}` +
          (fixture > 0 ? "   <- contains acceptance-fixture activity" : ""),
      );
    }
    console.log("");

    const identities = fixtureIds.length
      ? await prisma.pocketTraderIdentity.count({ where: { userId: { in: fixtureIds } } })
      : 0;
    const ingress = await prisma.providerIngressEvent.count();
    console.log(`PocketTraderIdentity from fixtures : ${identities}`);
    console.log(`ProviderIngressEvent (all)         : ${ingress}`);
    console.log(`GrowthEvent rows from fixtures     : ${totalFixture}`);
    console.log("");
    console.log(
      totalFixture === 0
        ? "No acceptance-fixture activity in the ledger."
        : "Fixture activity above is EXPECTED in PREPROD and is documented in the phase package. " +
            "It is identified, not subtracted: every surface still shows the real total.",
    );
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
