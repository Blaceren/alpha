/**
 * AFFILIATE-PLATFORM-V1 §37 — the sanctioned PREPROD commercial fixture.
 *
 * WHY THIS IS AN OPS COMMAND AND NOT A CURL SCRIPT
 *
 * §37 asks for the acceptance setup to be created "through source-owned admin
 * flows" and forbids raw SQL "where canonical APIs exist". The CRM routes are
 * the canonical staff APIs, and they authenticate a HUMAN employee's session —
 * which this phase does not hold and must not forge. So this command calls the
 * SAME CANONICAL DOMAIN OWNERS those routes call (`setCampaignCpaTerms`,
 * `hashPartnerPassword`, `validatePostbackTemplate`, the Prisma models with
 * their own CHECK constraints), from the host, under the deployment's own
 * environment, behind the same hard guard the QA-operator command uses.
 *
 * It writes NO raw SQL. Every row it creates goes through the schema's
 * constraints and, where one exists, the domain owner that owns the rule.
 *
 * IT IS A DRY RUN UNTIL `--apply`, and `--apply` additionally requires the
 * exact acknowledgement sentinel AND a deployment that positively classifies as
 * staging AND an environment the application itself would boot on. A production
 * checkout plus knowledge of this command's name writes nothing.
 *
 * WHAT IT CREATES — ALL OBVIOUSLY SYNTHETIC, NEVER PRODUCTION-LIKE
 *
 *   partner       affiliate-acceptance-a  and  affiliate-acceptance-b
 *                 TWO partners, because the whole tenant-isolation acceptance
 *                 needs a second tenant to be isolated FROM. B is not
 *                 decoration: it holds its own campaign, price and login.
 *   principal     acceptance-a@partners.invalid, acceptance-b@partners.invalid
 *                 `.invalid` is reserved by RFC 2606 and can never be a real
 *                 mailbox, so this fixture cannot email anybody by accident.
 *   campaign      one per partner, priced
 *   terms         120.00 USD for A, 90.00 USD for B — DELIBERATELY DIFFERENT
 *                 and deliberately NOT equal to any deposit amount in this
 *                 database, so a commission that accidentally carried the
 *                 deposit would be visible at a glance.
 *   tracking link one per partner, active, under its campaign
 *
 * IT CREATES NO POSTBACK ENDPOINT. That is the partner's own act, performed
 * through the partner API during acceptance, because §47 tests the partner
 * configuring a destination — pre-creating one would test nothing.
 *
 * IT PRINTS THE GENERATED PASSWORDS ONCE, TO STDERR, and they appear in no
 * audit row, no log and no evidence file. The JSON on stdout carries public
 * identifiers only.
 */
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { checkPreprodEnvironment } from "./preprod-qa-operator/guard";
import { validateRuntimeEnv } from "../../src/lib/env";
import { randomBase32Id } from "../../src/lib/affiliate/random-id";
import { hashPartnerPassword, normalisePartnerEmail } from "../../src/lib/affiliate/partner/credential";
import { setCampaignCpaTerms } from "../../src/lib/affiliate/commercial/terms";

const CONFIRM_KEY = "ATA_AFFILIATE_FIXTURE_CONFIRM";
const CONFIRM_VALUE = "PROVISION_PREPROD_AFFILIATE_ACCEPTANCE_FIXTURE";

type TenantSpec = {
  readonly code: string;
  readonly displayName: string;
  readonly email: string;
  readonly personName: string;
  readonly campaignCode: string;
  readonly campaignName: string;
  readonly cpaAmount: string;
  readonly cpaCurrency: string;
  readonly linkName: string;
};

const TENANTS: readonly TenantSpec[] = [
  {
    code: "affiliate-acceptance-a",
    displayName: "PREPROD Acceptance Affiliate A",
    email: "acceptance-a@partners.invalid",
    personName: "Acceptance Partner A",
    campaignCode: "acceptance-a-cpa",
    campaignName: "Acceptance A — CPA campaign",
    cpaAmount: "120.00",
    cpaCurrency: "USD",
    linkName: "Acceptance A primary link",
  },
  {
    code: "affiliate-acceptance-b",
    displayName: "PREPROD Acceptance Affiliate B",
    email: "acceptance-b@partners.invalid",
    personName: "Acceptance Partner B",
    campaignCode: "acceptance-b-cpa",
    campaignName: "Acceptance B — CPA campaign",
    cpaAmount: "90.00",
    cpaCurrency: "USD",
    linkName: "Acceptance B primary link",
  },
];

/** 24 CSPRNG bytes, base64url. Not chosen by anyone, and above the policy floor. */
function generatePassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const env = process.env;

  const guard = checkPreprodEnvironment(env);
  if (guard.kind === "refused") {
    console.error(`REFUSED: ${guard.reason} — ${guard.detail}`);
    return 2;
  }
  const runtime = validateRuntimeEnv(env);
  if (!runtime.ok) {
    console.error("REFUSED: this environment is not one the application would boot on");
    return 2;
  }
  if (apply && env[CONFIRM_KEY] !== CONFIRM_VALUE) {
    console.error(`REFUSED: ${CONFIRM_KEY}=${CONFIRM_VALUE} is required to apply`);
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    // THE CREATING STAFF IDENTITY. Every affiliate row carries `createdByUserId`
    // with a RESTRICT foreign key, so a real accountable `User` must be named.
    // The lowest-numbered active admin is used and is RECORDED in the output —
    // this command creates no staff account and impersonates no session.
    const creator = await prisma.user.findFirst({
      where: { role: "admin", status: "active" },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (creator === null) {
      console.error("REFUSED: no active admin User exists to own these rows");
      return 2;
    }

    const report: Record<string, unknown>[] = [];
    const passwords: { email: string; password: string }[] = [];

    for (const spec of TENANTS) {
      const existing = await prisma.affiliatePartner.findUnique({
        where: { code: spec.code },
        select: { id: true },
      });

      if (!apply) {
        report.push({
          partnerCode: spec.code,
          action: existing === null ? "would_create" : "already_exists",
          campaignCode: spec.campaignCode,
          cpa: `${spec.cpaAmount} ${spec.cpaCurrency}`,
        });
        continue;
      }

      const partner =
        existing ??
        (await prisma.affiliatePartner.create({
          data: {
            code: spec.code,
            displayName: spec.displayName,
            description: "Synthetic PREPROD acceptance affiliate. Not a real counterparty.",
            createdByUserId: creator.id,
          },
          select: { id: true },
        }));

      const campaign = await prisma.affiliateCampaign.upsert({
        where: {
          affiliatePartnerId_code: { affiliatePartnerId: partner.id, code: spec.campaignCode },
        },
        update: {},
        create: {
          affiliatePartnerId: partner.id,
          code: spec.campaignCode,
          displayName: spec.campaignName,
          notes: "Synthetic PREPROD acceptance campaign.",
          createdByUserId: creator.id,
        },
        select: { id: true },
      });

      // THE PRICE GOES THROUGH ITS OWN DOMAIN OWNER, not through a create call:
      // that owner is what supersedes a previous version and satisfies the
      // one-active-price index, and using it here means the fixture exercises
      // the same path a CRM operator does.
      const activeTerms = await prisma.affiliateCampaignTerms.findFirst({
        where: { affiliateCampaignId: campaign.id, status: "active" },
        select: { id: true, version: true, cpaAmount: true },
      });
      let termsVersion = activeTerms?.version ?? 0;
      let termsAmount = activeTerms?.cpaAmount ?? null;
      if (activeTerms === null) {
        const result = await setCampaignCpaTerms(prisma, {
          affiliateCampaignId: campaign.id,
          cpaAmount: spec.cpaAmount,
          cpaCurrency: spec.cpaCurrency,
          actorUserId: creator.id,
          now: new Date(),
        });
        if (!result.ok) {
          console.error(`REFUSED: could not price ${spec.campaignCode}: ${result.reason}`);
          return 2;
        }
        termsVersion = result.version;
        termsAmount = result.cpaAmount;
      }

      const email = normalisePartnerEmail(spec.email);
      let partnerUser = await prisma.affiliatePartnerUser.findUnique({
        where: { email },
        select: { publicId: true },
      });
      if (partnerUser === null) {
        const password = generatePassword();
        partnerUser = await prisma.affiliatePartnerUser.create({
          data: {
            publicId: randomBase32Id(),
            affiliatePartnerId: partner.id,
            email,
            passwordHash: await hashPartnerPassword(password),
            displayName: spec.personName,
            createdByUserId: creator.id,
          },
          select: { publicId: true },
        });
        passwords.push({ email, password });
      }

      let link = await prisma.affiliateTrackingLink.findFirst({
        where: { affiliatePartnerId: partner.id, affiliateCampaignId: campaign.id },
        select: { publicCode: true },
      });
      if (link === null) {
        link = await prisma.affiliateTrackingLink.create({
          data: {
            affiliatePartnerId: partner.id,
            affiliateCampaignId: campaign.id,
            publicCode: randomBase32Id(),
            displayName: spec.linkName,
            status: "active",
            landingKey: "academy_registration",
            externalClickParameter: "clickid",
            sub1Parameter: "sub1",
            sub2Parameter: "sub2",
            // Staff-authored, so the staff creator axis is the one that is set.
            createdByUserId: creator.id,
          },
          select: { publicCode: true },
        });
      }

      report.push({
        partnerCode: spec.code,
        partnerId: partner.id,
        campaignCode: spec.campaignCode,
        campaignId: campaign.id,
        cpaAmount: termsAmount,
        cpaCurrency: spec.cpaCurrency,
        termsVersion,
        partnerUserPublicId: partnerUser.publicId,
        partnerUserEmail: email,
        trackingLinkPublicCode: link.publicCode,
      });
    }

    // Passwords to STDERR, once, never to stdout and never to a row.
    for (const entry of passwords) {
      console.error(`GENERATED PASSWORD (shown once) ${entry.email} :: ${entry.password}`);
    }

    console.log(
      JSON.stringify(
        { applied: apply, createdByUserId: creator.id, tenants: report },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("affiliate acceptance fixture failed");
    console.error((error as Error).message.slice(0, 300));
    process.exit(1);
  });
