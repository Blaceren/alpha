/**
 * AFD-5D2 — the isolated fixture.
 *
 * RUN FROM THE BACKEND WORKTREE so `@prisma/client` resolves to the candidate's
 * generated client. It is executed, never imported by the CRM bundle, and it
 * modifies no backend file — only the throwaway database named by DATABASE_URL.
 *
 * A DELIBERATELY LOPSIDED POPULATION: Alpha converts, Beta produces clicks and
 * nothing else, so the analysis has a real contrast to state and a real
 * concentration to measure rather than an empty period that would exercise only
 * the insufficient-data branch.
 *
 * EVERY IDENTIFIER IS SYNTHETIC. No live learner, no live staff, no real Pocket
 * player id and no real click id appears anywhere.
 */
import bcrypt from "bcryptjs";
import { PrismaClient, type StaffRole } from "@prisma/client";

const prisma = new PrismaClient();

const PASSWORD = process.env.ATLAS_E2E_PASSWORD ?? "CurieAtlasE2E123!";

let sequence = 0;
/** A 32-character id in the BASE32 alphabet the database enforces: `[a-z2-7]`. */
const letters = (value: number): string => {
  let out = "";
  let rest = value;
  do {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return out;
};
const id32 = (prefix: string): string => {
  sequence += 1;
  const tail = letters(sequence);
  return `${`${prefix}${"a".repeat(32)}`.slice(0, 32 - tail.length)}${tail}`.slice(0, 32);
};

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  /* ------------------------------------------------------------------ staff */

  const staff: Record<string, string> = {};
  for (const role of ["crm_admin", "analyst", "support"] as const) {
    const email = `afd5d3-e2e-${role}@example.invalid`;
    const user = await prisma.user.create({
      data: { email, name: `E2E ${role}`, role: "admin", passwordHash: hash },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, displayName: `E2E ${role}`, staffRole: role as StaffRole },
    });
    staff[role] = email;
  }

  // A learner with NO staff profile: the "learner is refused" case.
  await prisma.user.create({
    data: {
      email: "afd5d3-e2e-learner@example.invalid",
      name: "E2E learner",
      role: "user",
      passwordHash: hash,
    },
  });

  /* -------------------------------------------------------------- inventory */

  const owner = await prisma.user.findFirstOrThrow({ where: { email: staff.crm_admin } });

  const alpha = await prisma.affiliatePartner.create({
    data: { code: "alpha", displayName: "Affiliate Alpha", createdByUserId: owner.id },
  });
  const beta = await prisma.affiliatePartner.create({
    data: { code: "beta", displayName: "Affiliate Beta", createdByUserId: owner.id },
  });
  const alphaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: alpha.id,
      code: "alpha-one",
      displayName: "Campaign Alpha One",
      createdByUserId: owner.id,
    },
  });
  const linkA = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linka"),
      displayName: "Link Alpha",
      createdByUserId: owner.id,
    },
  });
  const linkB = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: beta.id,
      publicCode: id32("linkb"),
      displayName: "Link Beta",
      createdByUserId: owner.id,
    },
  });

  /* ---------------------------------------------------------------- traffic */

  const day = (n: number) => new Date(Date.UTC(2026, 6, n, 9, 0, 0));

  async function click(linkId: number, at: Date) {
    return prisma.affiliateClick.create({
      data: {
        ataClickId: id32("c"),
        trackingLinkId: linkId,
        anonymousVisitorId: id32("v"),
        classification: "qualified",
        effectiveAttributionWindowDays: 30,
        occurredAt: at,
      },
    });
  }

  // Alpha: clicks that convert into Academy registrations.
  for (let i = 1; i <= 12; i += 1) {
    const at = day(1 + (i % 7));
    const selected = await click(linkA.id, at);
    if (i % 3 === 0) {
      const learner = await prisma.user.create({
        data: {
          email: `${id32("l")}@example.invalid`,
          name: "E2E learner",
          role: "user",
          passwordHash: hash,
        },
      });
      const attribution = await prisma.affiliateAttribution.create({
        data: {
          userId: learner.id,
          anonymousVisitorId: selected.anonymousVisitorId,
          firstTouchClickId: selected.id,
          lastTouchClickId: selected.id,
          selectedClickId: selected.id,
          attributionModel: "last_eligible_affiliate_click",
          selectedAt: at,
          frozenAt: at,
          selectionReason: "registration_cookie",
        },
      });
      await prisma.affiliateConversionEvent.create({
        data: {
          eventId: id32("e"),
          eventType: "academy_registration",
          userId: learner.id,
          attributionId: attribution.id,
          selectedClickId: selected.id,
          trackingLinkId: linkA.id,
          affiliatePartnerId: alpha.id,
          affiliateCampaignId: alphaOne.id,
          // The database enforces these snapshots all-or-nothing alongside the
          // attribution links, so an attributed conversion must carry them.
          affiliateCodeSnapshot: alpha.code,
          campaignCodeSnapshot: alphaOne.code,
          trackingLinkPublicCodeSnapshot: linkA.publicCode,
          sourceOwner: "auth_register",
          sourceEventId: id32("s"),
          occurredAt: at,
        },
      });
    }
  }

  // Beta: clicks and nothing else.
  for (let i = 1; i <= 9; i += 1) {
    await click(linkB.id, day(1 + (i % 5)));
  }

  console.log(JSON.stringify({ staff, partners: [alpha.id, beta.id] }));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
