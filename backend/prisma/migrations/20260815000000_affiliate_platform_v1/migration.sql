-- ===========================================================================
-- MIGRATION 50 -- AFFILIATE-PLATFORM-V1
--
-- PRISMA SPLITS THIS FILE ON THE SEMICOLON CHARACTER, so NO COMMENT IN THIS
-- FILE CONTAINS ONE, and every statement is a single complete statement
-- terminated by exactly one semicolon.
--
-- ---------------------------------------------------------------------------
-- ONE MIGRATION, NOT FOUR
--
-- The brief asks for one coherent migration rather than micro-churn, and the
-- five capabilities added here are not independent: a partner human must exist
-- before a tracking link can name one as its author, a commercial terms version
-- must exist before a qualification can point at one, and a qualification must
-- exist before a commission can be the thing it produced. Splitting them would
-- create intermediate states in which a foreign key names a table that is not
-- there yet.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO
--
-- IT CREATES NO MONEY. Not one commission row, not one qualification row, no
-- backfill of any kind for the four conversion events that already exist. §34
-- is explicit and this file obeys it literally: schema migration and business
-- backfill are different concerns, and a migration that quietly minted
-- liabilities for historical PREPROD traffic would be indistinguishable from a
-- bug that did the same thing. Every table it creates is created EMPTY.
--
-- IT CHANGES NO EXISTING MONEY. AffiliateConversionEvent is rebuilt, and the
-- rebuild copies its four rows column-for-column with every value unchanged.
-- The only difference is which values the CHECK constraints will admit in
-- FUTURE.
--
-- ---------------------------------------------------------------------------
-- WHY TWO EXISTING TABLES ARE REBUILT
--
-- SQLite cannot widen a CHECK, drop a NOT NULL or add a foreign key in place,
-- so both changes need the 12-step rebuild this repository already uses.
--
-- 1. AffiliateTrackingLink -- `createdByUserId` becomes NULLABLE and a second
--    creator axis is added. A link a PARTNER created for itself has no
--    accountable ATA employee. Naming one anyway -- the staff member who
--    created the partner login, say -- would put a false authorship claim in
--    the exact table an operator consults when asking who published a public
--    acquisition URL. A CHECK makes "exactly one creator" structural.
--
-- 2. AffiliateConversionEvent -- `redeposit` joins the event vocabulary and
--    `pocket_redeposit` joins the owner vocabulary. The previous phase
--    deliberately refused to add these without a consumer. This phase builds
--    the consumer, so they arrive together with it.
--
--    THE MONEY CHECK IS WIDENED PRECISELY. It used to read "first_deposit has
--    an amount, everything else has none". A redeposit also carries an exact
--    provider amount, so the rule becomes "the two deposit families carry an
--    amount, academy_registration carries none". academy_registration STILL
--    cannot acquire an amount, and neither deposit family can lose one.
--
--    THE OWNER BINDING IS WIDENED THE SAME WAY, so a redeposit owner cannot
--    mint a first deposit and a first-deposit owner cannot mint a redeposit.
--
-- ---------------------------------------------------------------------------
-- THE INVARIANTS THIS FILE MAKES UNREPRESENTABLE, RATHER THAN MERELY CHECKED
--
--   one FTD             -> at most one qualification   UNIQUE(conversionEventId)
--   one qualification   -> at most one commission      UNIQUE(qualificationId)
--   one campaign        -> at most one ACTIVE price    PARTIAL UNIQUE INDEX
--   one conversion x one endpoint version -> one logical delivery
--                                                      UNIQUE(conv, endpoint, version)
--   one delivery x one attempt number     -> one attempt row
--   a qualification is ALWAYS fully attributed         NOT NULL on every axis
--   a commission's currency is ALWAYS known            NOT NULL, 3 upper letters
--
-- The last one is worth stating plainly. Every deposit currently in this
-- database has `currencyStatus = 'unspecified'` because Pocket has never stated
-- a currency. A commission whose unit was also unknown would be unpayable, so
-- the CPA currency is chosen by ATA, required, and structurally separate from
-- whatever the provider did or did not say.
-- ===========================================================================

PRAGMA foreign_keys=OFF;

-- ---------------------------------------------------------------------------
-- 1. THE PARTNER PRINCIPAL
--
-- A LOGIN, NOT A PARTNER, and physically not a `User`. The learner/staff `User`
-- table carries the Academy session, the CRM StaffProfile axis, XP, enrolments
-- and progression. A partner principal living there would inherit every one of
-- those relations and would be one role column away from reaching the Academy.
-- ---------------------------------------------------------------------------
CREATE TABLE "AffiliatePartnerUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL
        CHECK (length("publicId") = 32)
        CHECK ("publicId" NOT GLOB '*[^a-z2-7]*'),
    "affiliatePartnerId" INTEGER NOT NULL,
    -- Lowercased and trimmed by the only writer. The GLOB pair rejects
    -- uppercase and whitespace at the storage layer, so a case-variant
    -- duplicate cannot be created by a path that forgot to normalise.
    "email" TEXT NOT NULL
        CHECK (length("email") BETWEEN 6 AND 254)
        CHECK ("email" NOT GLOB '*[A-Z]*')
        CHECK ("email" NOT GLOB '* *')
        CHECK ("email" GLOB '?*@?*.?*'),
    -- bcrypt modular crypt, cost 10 -- the same construction the learner
    -- credential uses. The CHECK refuses anything that is not a bcrypt digest,
    -- so a plaintext password cannot be stored here by a broken call site.
    "passwordHash" TEXT NOT NULL
        CHECK (length("passwordHash") = 60)
        CHECK ("passwordHash" GLOB '$2[aby]$[0-9][0-9]$*'),
    "displayName" TEXT NOT NULL
        CHECK (length(trim("displayName")) BETWEEN 1 AND 160),
    "status" TEXT NOT NULL DEFAULT 'active'
        CHECK ("status" IN ('active', 'disabled')),
    -- Carried inside the session token. Bumping it invalidates every token
    -- already issued, which is how a password change and a forced sign-out work
    -- without a server-side session table.
    "sessionEpoch" INTEGER NOT NULL DEFAULT 1
        CHECK ("sessionEpoch" >= 1),
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    "passwordUpdatedAt" DATETIME,
    "disabledAt" DATETIME
        CHECK (("status" = 'disabled') = ("disabledAt" IS NOT NULL)),
    CONSTRAINT "AffiliatePartnerUser_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliatePartnerUser_createdBy_fkey" FOREIGN KEY ("createdByUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliatePartnerUser_publicId_key"
ON "AffiliatePartnerUser"("publicId");

-- GLOBALLY unique, not unique per partner. An address identifies one human, and
-- the same address signing in for two partners would make "which tenant am I"
-- a question the login itself cannot answer.
CREATE UNIQUE INDEX "AffiliatePartnerUser_email_key"
ON "AffiliatePartnerUser"("email");

CREATE INDEX "AffiliatePartnerUser_affiliatePartnerId_status_idx"
ON "AffiliatePartnerUser"("affiliatePartnerId", "status");

CREATE INDEX "AffiliatePartnerUser_createdByUserId_idx"
ON "AffiliatePartnerUser"("createdByUserId");

-- ---------------------------------------------------------------------------
-- 2. COMMERCIAL TERMS -- THE CPA CONFIGURATION, AS AN APPEND-ONLY VERSION
--
-- The campaign is the commercial owner (§9), and this is its price list. A
-- version is never edited: changing the CPA supersedes the current row and
-- writes a new one. That is what makes "no retroactive money rewrite"
-- structural rather than a promise -- there is no UPDATE path that can reach
-- the amount a past commission was computed from.
--
-- THE AMOUNT IS TEXT, matching the accepted money convention of this database
-- exactly: 4 to 15 characters, exactly two decimal places, digits and one dot
-- only, and at least one non-zero digit. A zero CPA is therefore not
-- representable, which is deliberate -- a campaign that pays nothing should be
-- expressed by having no active terms, not by a price of 0.00 that every
-- downstream reader has to remember to treat as special.
-- ---------------------------------------------------------------------------
CREATE TABLE "AffiliateCampaignTerms" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL
        CHECK (length("publicId") = 32)
        CHECK ("publicId" NOT GLOB '*[^a-z2-7]*'),
    "affiliateCampaignId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL
        CHECK ("version" >= 1),
    "cpaAmount" TEXT NOT NULL
        CHECK (length("cpaAmount") BETWEEN 4 AND 15)
        CHECK ("cpaAmount" GLOB '*[0-9].[0-9][0-9]')
        CHECK ("cpaAmount" NOT GLOB '*[^0-9.]*')
        CHECK ("cpaAmount" NOT GLOB '*.*.*')
        CHECK ("cpaAmount" GLOB '*[1-9]*'),
    -- ISO-4217, uppercase, REQUIRED and never defaulted. ATA chooses what it
    -- pays in, so ATA always knows -- unlike the provider deposit currency,
    -- which is `unspecified` in every row this database holds.
    "cpaCurrency" TEXT NOT NULL
        CHECK (length("cpaCurrency") = 3)
        CHECK ("cpaCurrency" NOT GLOB '*[^A-Z]*'),
    "status" TEXT NOT NULL DEFAULT 'active'
        CHECK ("status" IN ('active', 'superseded')),
    "effectiveFrom" DATETIME NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" DATETIME
        CHECK (("status" = 'superseded') = ("supersededAt" IS NOT NULL)),
    CONSTRAINT "AffiliateCampaignTerms_campaign_fkey" FOREIGN KEY ("affiliateCampaignId")
        REFERENCES "AffiliateCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCampaignTerms_createdBy_fkey" FOREIGN KEY ("createdByUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliateCampaignTerms_publicId_key"
ON "AffiliateCampaignTerms"("publicId");

CREATE UNIQUE INDEX "AffiliateCampaignTerms_affiliateCampaignId_version_key"
ON "AffiliateCampaignTerms"("affiliateCampaignId", "version");

-- THE ONE-ACTIVE-PRICE RULE, IN THE ONLY PLACE THAT CAN ENFORCE IT.
--
-- Prisma cannot express a partial unique index, so this is written by hand and
-- the schema file documents that it exists here. Application code that forgot
-- to supersede the previous version fails the write rather than leaving a
-- campaign with two live prices for a qualifier to choose between.
CREATE UNIQUE INDEX "AffiliateCampaignTerms_one_active_per_campaign"
ON "AffiliateCampaignTerms"("affiliateCampaignId")
WHERE "status" = 'active';

CREATE INDEX "AffiliateCampaignTerms_affiliateCampaignId_status_idx"
ON "AffiliateCampaignTerms"("affiliateCampaignId", "status");

CREATE INDEX "AffiliateCampaignTerms_createdByUserId_idx"
ON "AffiliateCampaignTerms"("createdByUserId");

-- ---------------------------------------------------------------------------
-- 3. REBUILD AffiliateTrackingLink -- TWO CREATOR AXES, EXACTLY ONE SET
--
-- Every CHECK, index and comment of the accepted table is carried forward
-- unchanged. The three differences are stated at the top of this file.
-- ---------------------------------------------------------------------------
CREATE TABLE "new_AffiliateTrackingLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "affiliatePartnerId" INTEGER NOT NULL,
    "affiliateCampaignId" INTEGER,
    "publicCode" TEXT NOT NULL
        CHECK (length("publicCode") = 32)
        CHECK ("publicCode" NOT GLOB '*[^a-z2-7]*'),
    "displayName" TEXT NOT NULL
        CHECK (length(trim("displayName")) BETWEEN 1 AND 160),
    "status" TEXT NOT NULL DEFAULT 'draft'
        CHECK ("status" IN ('draft', 'active', 'paused', 'archived')),
    "landingKey" TEXT NOT NULL DEFAULT 'academy_registration'
        CHECK ("landingKey" IN ('academy_registration')),
    "externalClickParameter" TEXT NOT NULL DEFAULT 'clickid'
        CHECK (length("externalClickParameter") BETWEEN 1 AND 32)
        CHECK ("externalClickParameter" NOT GLOB '*[^a-z0-9_]*'),
    "sub1Parameter" TEXT
        CHECK ("sub1Parameter" IS NULL OR (length("sub1Parameter") BETWEEN 1 AND 32 AND "sub1Parameter" NOT GLOB '*[^a-z0-9_]*')),
    "sub2Parameter" TEXT
        CHECK ("sub2Parameter" IS NULL OR (length("sub2Parameter") BETWEEN 1 AND 32 AND "sub2Parameter" NOT GLOB '*[^a-z0-9_]*')),
    "sub3Parameter" TEXT
        CHECK ("sub3Parameter" IS NULL OR (length("sub3Parameter") BETWEEN 1 AND 32 AND "sub3Parameter" NOT GLOB '*[^a-z0-9_]*')),
    "sub4Parameter" TEXT
        CHECK ("sub4Parameter" IS NULL OR (length("sub4Parameter") BETWEEN 1 AND 32 AND "sub4Parameter" NOT GLOB '*[^a-z0-9_]*')),
    "sub5Parameter" TEXT
        CHECK ("sub5Parameter" IS NULL OR (length("sub5Parameter") BETWEEN 1 AND 32 AND "sub5Parameter" NOT GLOB '*[^a-z0-9_]*')),
    "attributionWindowDays" INTEGER
        CHECK ("attributionWindowDays" IS NULL OR "attributionWindowDays" BETWEEN 1 AND 365),
    "createdByUserId" INTEGER,
    "createdByPartnerUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME
        CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL)),
    -- EXACTLY ONE ACCOUNTABLE AUTHOR. Neither is an orphan record of a public
    -- URL nobody owns, and both is a contradiction about who published it.
    CHECK (("createdByUserId" IS NULL) <> ("createdByPartnerUserId" IS NULL)),
    CONSTRAINT "AffiliateTrackingLink_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateTrackingLink_campaign_fkey"
        FOREIGN KEY ("affiliateCampaignId", "affiliatePartnerId")
        REFERENCES "AffiliateCampaign"("id", "affiliatePartnerId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateTrackingLink_createdBy_fkey" FOREIGN KEY ("createdByUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateTrackingLink_createdByPartnerUser_fkey" FOREIGN KEY ("createdByPartnerUserId")
        REFERENCES "AffiliatePartnerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Columns listed explicitly on both sides. A bare SELECT star would bind by
-- position and silently shift every value if either side ever changed.
INSERT INTO "new_AffiliateTrackingLink" (
    "id", "affiliatePartnerId", "affiliateCampaignId", "publicCode", "displayName",
    "status", "landingKey", "externalClickParameter",
    "sub1Parameter", "sub2Parameter", "sub3Parameter", "sub4Parameter", "sub5Parameter",
    "attributionWindowDays", "createdByUserId", "createdByPartnerUserId",
    "createdAt", "updatedAt", "archivedAt"
)
SELECT
    "id", "affiliatePartnerId", "affiliateCampaignId", "publicCode", "displayName",
    "status", "landingKey", "externalClickParameter",
    "sub1Parameter", "sub2Parameter", "sub3Parameter", "sub4Parameter", "sub5Parameter",
    "attributionWindowDays", "createdByUserId", NULL,
    "createdAt", "updatedAt", "archivedAt"
FROM "AffiliateTrackingLink";

DROP TABLE "AffiliateTrackingLink";

ALTER TABLE "new_AffiliateTrackingLink" RENAME TO "AffiliateTrackingLink";

CREATE UNIQUE INDEX "AffiliateTrackingLink_publicCode_key"
ON "AffiliateTrackingLink"("publicCode");

CREATE INDEX "AffiliateTrackingLink_affiliatePartnerId_status_createdAt_idx"
ON "AffiliateTrackingLink"("affiliatePartnerId", "status", "createdAt");

CREATE INDEX "AffiliateTrackingLink_affiliateCampaignId_status_createdAt_idx"
ON "AffiliateTrackingLink"("affiliateCampaignId", "status", "createdAt");

CREATE INDEX "AffiliateTrackingLink_status_createdAt_idx"
ON "AffiliateTrackingLink"("status", "createdAt");

CREATE INDEX "AffiliateTrackingLink_createdAt_idx"
ON "AffiliateTrackingLink"("createdAt");

CREATE INDEX "AffiliateTrackingLink_createdByUserId_idx"
ON "AffiliateTrackingLink"("createdByUserId");

CREATE INDEX "AffiliateTrackingLink_createdByPartnerUserId_idx"
ON "AffiliateTrackingLink"("createdByPartnerUserId");

-- ---------------------------------------------------------------------------
-- 4. REBUILD AffiliateConversionEvent -- REDEPOSIT JOINS THE VOCABULARY
-- ---------------------------------------------------------------------------
CREATE TABLE "new_AffiliateConversionEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL
        CHECK (length("eventId") = 32)
        CHECK ("eventId" NOT GLOB '*[^a-z2-7]*'),
    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN ('academy_registration', 'first_deposit', 'redeposit')),
    "userId" INTEGER NOT NULL,
    "attributionId" INTEGER,
    "selectedClickId" INTEGER,
    "affiliatePartnerId" INTEGER,
    "affiliateCampaignId" INTEGER,
    "trackingLinkId" INTEGER,
    "affiliateCodeSnapshot" TEXT
        CHECK ("affiliateCodeSnapshot" IS NULL OR length("affiliateCodeSnapshot") BETWEEN 3 AND 64),
    "campaignCodeSnapshot" TEXT
        CHECK ("campaignCodeSnapshot" IS NULL OR length("campaignCodeSnapshot") BETWEEN 3 AND 64),
    "trackingLinkPublicCodeSnapshot" TEXT
        CHECK ("trackingLinkPublicCodeSnapshot" IS NULL OR length("trackingLinkPublicCodeSnapshot") = 32),
    "sourceOwner" TEXT NOT NULL
        CHECK ("sourceOwner" IN ('auth_register', 'pocket_first_deposit', 'pocket_redeposit')),
    "sourceEventId" TEXT NOT NULL
        CHECK (length("sourceEventId") BETWEEN 1 AND 128),
    "providerAmount" TEXT
        CHECK ("providerAmount" IS NULL OR (
            length("providerAmount") BETWEEN 4 AND 15
            AND "providerAmount" GLOB '*[0-9].[0-9][0-9]'
            AND "providerAmount" NOT GLOB '*[^0-9.]*'
            AND "providerAmount" NOT GLOB '*.*.*'
            AND "providerAmount" GLOB '*[1-9]*'
        )),
    "currencyCode" TEXT
        CHECK ("currencyCode" IS NULL OR (length("currencyCode") = 3 AND "currencyCode" NOT GLOB '*[^A-Z]*')),
    "currencyStatus" TEXT
        CHECK ("currencyStatus" IS NULL OR "currencyStatus" IN ('unspecified', 'configured')),
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        ("attributionId" IS NULL AND "selectedClickId" IS NULL AND "affiliatePartnerId" IS NULL
            AND "trackingLinkId" IS NULL AND "affiliateCodeSnapshot" IS NULL
            AND "trackingLinkPublicCodeSnapshot" IS NULL)
        OR
        ("attributionId" IS NOT NULL AND "selectedClickId" IS NOT NULL AND "affiliatePartnerId" IS NOT NULL
            AND "trackingLinkId" IS NOT NULL AND "affiliateCodeSnapshot" IS NOT NULL
            AND "trackingLinkPublicCodeSnapshot" IS NOT NULL)
    ),
    CHECK (("affiliateCampaignId" IS NULL) = ("campaignCodeSnapshot" IS NULL)),
    CHECK (("attributionId" IS NOT NULL) OR ("affiliateCampaignId" IS NULL)),
    -- WIDENED, AND ONLY WIDENED. Both deposit families carry an exact provider
    -- amount and a currency status. academy_registration still cannot acquire
    -- one, and neither deposit family can lose one.
    CHECK (
        ("eventType" IN ('first_deposit', 'redeposit') AND "providerAmount" IS NOT NULL AND "currencyStatus" IS NOT NULL)
        OR
        ("eventType" = 'academy_registration' AND "providerAmount" IS NULL AND "currencyCode" IS NULL AND "currencyStatus" IS NULL)
    ),
    CHECK (("currencyStatus" = 'configured') = ("currencyCode" IS NOT NULL)),
    -- The owner and the type stay bound to each other in both directions, so no
    -- owner can mint another owner's family.
    CHECK (
        ("eventType" = 'academy_registration' AND "sourceOwner" = 'auth_register')
        OR
        ("eventType" = 'first_deposit' AND "sourceOwner" = 'pocket_first_deposit')
        OR
        ("eventType" = 'redeposit' AND "sourceOwner" = 'pocket_redeposit')
    ),
    CONSTRAINT "AffiliateConversionEvent_user_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateConversionEvent_attribution_fkey" FOREIGN KEY ("attributionId")
        REFERENCES "AffiliateAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateConversionEvent_click_fkey" FOREIGN KEY ("selectedClickId")
        REFERENCES "AffiliateClick"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateConversionEvent_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateConversionEvent_campaign_fkey" FOREIGN KEY ("affiliateCampaignId")
        REFERENCES "AffiliateCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateConversionEvent_link_fkey" FOREIGN KEY ("trackingLinkId")
        REFERENCES "AffiliateTrackingLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_AffiliateConversionEvent" (
    "id", "eventId", "eventType", "userId", "attributionId", "selectedClickId",
    "affiliatePartnerId", "affiliateCampaignId", "trackingLinkId",
    "affiliateCodeSnapshot", "campaignCodeSnapshot", "trackingLinkPublicCodeSnapshot",
    "sourceOwner", "sourceEventId", "providerAmount", "currencyCode", "currencyStatus",
    "occurredAt", "createdAt"
)
SELECT
    "id", "eventId", "eventType", "userId", "attributionId", "selectedClickId",
    "affiliatePartnerId", "affiliateCampaignId", "trackingLinkId",
    "affiliateCodeSnapshot", "campaignCodeSnapshot", "trackingLinkPublicCodeSnapshot",
    "sourceOwner", "sourceEventId", "providerAmount", "currencyCode", "currencyStatus",
    "occurredAt", "createdAt"
FROM "AffiliateConversionEvent";

DROP TABLE "AffiliateConversionEvent";

ALTER TABLE "new_AffiliateConversionEvent" RENAME TO "AffiliateConversionEvent";

CREATE UNIQUE INDEX "AffiliateConversionEvent_eventId_key"
ON "AffiliateConversionEvent"("eventId");

CREATE UNIQUE INDEX "AffiliateConversionEvent_eventType_sourceOwner_sourceEventId_key"
ON "AffiliateConversionEvent"("eventType", "sourceOwner", "sourceEventId");

CREATE INDEX "AffiliateConversionEvent_eventType_occurredAt_idx"
ON "AffiliateConversionEvent"("eventType", "occurredAt");

CREATE INDEX "AffiliateConversionEvent_affiliatePartnerId_occurredAt_idx"
ON "AffiliateConversionEvent"("affiliatePartnerId", "occurredAt");

CREATE INDEX "AffiliateConversionEvent_affiliateCampaignId_occurredAt_idx"
ON "AffiliateConversionEvent"("affiliateCampaignId", "occurredAt");

CREATE INDEX "AffiliateConversionEvent_trackingLinkId_occurredAt_idx"
ON "AffiliateConversionEvent"("trackingLinkId", "occurredAt");

CREATE INDEX "AffiliateConversionEvent_userId_occurredAt_idx"
ON "AffiliateConversionEvent"("userId", "occurredAt");

-- ---------------------------------------------------------------------------
-- 5. CPA QUALIFICATION -- WHY A CONVERSION EARNED SOMETHING
--
-- Distinct from the FTD deliberately. The FTD is a fact about a learner's
-- money. This is a fact about a commercial agreement, and it answers questions
-- the deposit cannot: which partner, under which price version, at what rate,
-- at what moment the rule fired.
--
-- EVERY ATTRIBUTION AXIS IS NOT NULL. An unattributed deposit does not produce
-- a row here with nulls -- it produces NO ROW. §6 is explicit that the
-- financial event stays valid and no partner may be guessed, and a nullable
-- partner column is exactly the shape that invites guessing later.
-- ---------------------------------------------------------------------------
CREATE TABLE "AffiliateCpaQualification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL
        CHECK (length("publicId") = 32)
        CHECK ("publicId" NOT GLOB '*[^a-z2-7]*'),
    "conversionEventId" INTEGER NOT NULL,
    "affiliatePartnerId" INTEGER NOT NULL,
    "affiliateCampaignId" INTEGER NOT NULL,
    "attributionId" INTEGER NOT NULL,
    "trackingLinkId" INTEGER,
    "termsId" INTEGER NOT NULL,
    "termsVersionSnapshot" INTEGER NOT NULL
        CHECK ("termsVersionSnapshot" >= 1),
    "cpaAmountSnapshot" TEXT NOT NULL
        CHECK (length("cpaAmountSnapshot") BETWEEN 4 AND 15)
        CHECK ("cpaAmountSnapshot" GLOB '*[0-9].[0-9][0-9]')
        CHECK ("cpaAmountSnapshot" NOT GLOB '*[^0-9.]*')
        CHECK ("cpaAmountSnapshot" NOT GLOB '*.*.*')
        CHECK ("cpaAmountSnapshot" GLOB '*[1-9]*'),
    "cpaCurrencySnapshot" TEXT NOT NULL
        CHECK (length("cpaCurrencySnapshot") = 3)
        CHECK ("cpaCurrencySnapshot" NOT GLOB '*[^A-Z]*'),
    "affiliateCodeSnapshot" TEXT NOT NULL
        CHECK (length("affiliateCodeSnapshot") BETWEEN 3 AND 64),
    "campaignCodeSnapshot" TEXT NOT NULL
        CHECK (length("campaignCodeSnapshot") BETWEEN 3 AND 64),
    "qualifiedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateCpaQualification_conversion_fkey" FOREIGN KEY ("conversionEventId")
        REFERENCES "AffiliateConversionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCpaQualification_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCpaQualification_campaign_fkey" FOREIGN KEY ("affiliateCampaignId")
        REFERENCES "AffiliateCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCpaQualification_attribution_fkey" FOREIGN KEY ("attributionId")
        REFERENCES "AffiliateAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCpaQualification_link_fkey" FOREIGN KEY ("trackingLinkId")
        REFERENCES "AffiliateTrackingLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCpaQualification_terms_fkey" FOREIGN KEY ("termsId")
        REFERENCES "AffiliateCampaignTerms"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliateCpaQualification_publicId_key"
ON "AffiliateCpaQualification"("publicId");

-- THE INVARIANT OF THIS WHOLE PHASE. One qualifying FTD, one qualification,
-- forever. A retry, five concurrent workers, a replayed provider delivery and a
-- manual re-run all collide here, in the database, and no application path can
-- talk its way past it.
CREATE UNIQUE INDEX "AffiliateCpaQualification_conversionEventId_key"
ON "AffiliateCpaQualification"("conversionEventId");

CREATE INDEX "AffiliateCpaQualification_affiliatePartnerId_qualifiedAt_idx"
ON "AffiliateCpaQualification"("affiliatePartnerId", "qualifiedAt");

CREATE INDEX "AffiliateCpaQualification_affiliateCampaignId_qualifiedAt_idx"
ON "AffiliateCpaQualification"("affiliateCampaignId", "qualifiedAt");

CREATE INDEX "AffiliateCpaQualification_termsId_idx"
ON "AffiliateCpaQualification"("termsId");

-- ---------------------------------------------------------------------------
-- 6. COMMISSION -- ONE EARNED PARTNER LIABILITY
--
-- THE NARROWEST DURABLE V1 AND NOTHING MORE. No status, no approval, no
-- reversal, no hold, no payout reference, no settlement date: no owner in this
-- product has authority over any of them, and §13 is explicit that inventing an
-- approval workflow without authority is worse than leaving the concept out.
--
-- `amount` IS A COPY OF THE CPA SNAPSHOT, NEVER OF THE DEPOSIT. A 500.00
-- deposit under 120.00 terms produces 120.00 here. The deposit amount lives on
-- the conversion, two joins away.
-- ---------------------------------------------------------------------------
CREATE TABLE "AffiliateCommission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL
        CHECK (length("publicId") = 32)
        CHECK ("publicId" NOT GLOB '*[^a-z2-7]*'),
    "qualificationId" INTEGER NOT NULL,
    "affiliatePartnerId" INTEGER NOT NULL,
    "amount" TEXT NOT NULL
        CHECK (length("amount") BETWEEN 4 AND 15)
        CHECK ("amount" GLOB '*[0-9].[0-9][0-9]')
        CHECK ("amount" NOT GLOB '*[^0-9.]*')
        CHECK ("amount" NOT GLOB '*.*.*')
        CHECK ("amount" GLOB '*[1-9]*'),
    "currencyCode" TEXT NOT NULL
        CHECK (length("currencyCode") = 3)
        CHECK ("currencyCode" NOT GLOB '*[^A-Z]*'),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateCommission_qualification_fkey" FOREIGN KEY ("qualificationId")
        REFERENCES "AffiliateCpaQualification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCommission_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliateCommission_publicId_key"
ON "AffiliateCommission"("publicId");

CREATE UNIQUE INDEX "AffiliateCommission_qualificationId_key"
ON "AffiliateCommission"("qualificationId");

CREATE INDEX "AffiliateCommission_affiliatePartnerId_createdAt_idx"
ON "AffiliateCommission"("affiliatePartnerId", "createdAt");

-- ---------------------------------------------------------------------------
-- 7. OUTBOUND POSTBACK ENDPOINT -- WHERE A PARTNER WANTS ITS CONVERSIONS SENT
--
-- ONE ENDPOINT PER PARTNER PER EVENT TYPE. A partner wanting two consumers of
-- one event would need a fan-out owner, per-consumer retry semantics and a way
-- to say which one failed. None of that exists, so V1 represents one.
--
-- `urlTemplate` IS UNTRUSTED INPUT. It is validated at configuration time for
-- shape, scheme and macro vocabulary, and validated AGAIN at delivery time for
-- the address it actually resolves to, on every attempt and after every
-- redirect. Storing a validated string is not a safety property: the address a
-- name resolves to can change between the two moments.
-- ---------------------------------------------------------------------------
CREATE TABLE "AffiliatePostbackEndpoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL
        CHECK (length("publicId") = 32)
        CHECK ("publicId" NOT GLOB '*[^a-z2-7]*'),
    "affiliatePartnerId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN ('academy_registration', 'first_deposit', 'redeposit')),
    -- https only, and bounded. The application validator is far stricter than
    -- this -- the storage CHECK exists so a raw-SQL writer cannot bypass it.
    "urlTemplate" TEXT NOT NULL
        CHECK (length("urlTemplate") BETWEEN 12 AND 2048)
        CHECK ("urlTemplate" GLOB 'https://*')
        CHECK ("urlTemplate" NOT GLOB '* *'),
    "version" INTEGER NOT NULL DEFAULT 1
        CHECK ("version" >= 1),
    "status" TEXT NOT NULL DEFAULT 'active'
        CHECK ("status" IN ('active', 'disabled')),
    -- 256 CSPRNG bits, base64url. Server-generated: a partner cannot choose it,
    -- so it cannot be a password they reused. Revealed exactly once.
    "signingSecret" TEXT NOT NULL
        CHECK (length("signingSecret") = 43)
        CHECK ("signingSecret" NOT GLOB '*[^A-Za-z0-9_-]*'),
    "secretVersion" INTEGER NOT NULL DEFAULT 1
        CHECK ("secretVersion" >= 1),
    "secretRotatedAt" DATETIME,
    "createdByPartnerUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "disabledAt" DATETIME
        CHECK (("status" = 'disabled') = ("disabledAt" IS NOT NULL)),
    CONSTRAINT "AffiliatePostbackEndpoint_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliatePostbackEndpoint_createdBy_fkey" FOREIGN KEY ("createdByPartnerUserId")
        REFERENCES "AffiliatePartnerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliatePostbackEndpoint_publicId_key"
ON "AffiliatePostbackEndpoint"("publicId");

CREATE UNIQUE INDEX "AffiliatePostbackEndpoint_affiliatePartnerId_eventType_key"
ON "AffiliatePostbackEndpoint"("affiliatePartnerId", "eventType");

CREATE INDEX "AffiliatePostbackEndpoint_status_idx"
ON "AffiliatePostbackEndpoint"("status");

CREATE INDEX "AffiliatePostbackEndpoint_createdByPartnerUserId_idx"
ON "AffiliatePostbackEndpoint"("createdByPartnerUserId");

-- ---------------------------------------------------------------------------
-- 8. LOGICAL DELIVERY -- ONE CONVERSION TO ONE ENDPOINT VERSION
--
-- UNIQUE(conversionEventId, endpointId, endpointVersion) is §27's idempotency
-- rule stated where it can be enforced. A duplicated worker, a concurrent
-- worker and a manual re-run all collide here. Retries add ATTEMPT rows, never
-- delivery rows.
--
-- THE VERSION IS PART OF THE KEY ON PURPOSE. Re-pointing an endpoint
-- legitimately produces a NEW logical delivery for a conversion already
-- delivered to the OLD address, and neither duplicates the other.
-- ---------------------------------------------------------------------------
CREATE TABLE "AffiliatePostbackDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL
        CHECK (length("publicId") = 32)
        CHECK ("publicId" NOT GLOB '*[^a-z2-7]*'),
    "conversionEventId" INTEGER NOT NULL,
    "endpointId" INTEGER NOT NULL,
    "endpointVersion" INTEGER NOT NULL
        CHECK ("endpointVersion" >= 1),
    "affiliatePartnerId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN ('academy_registration', 'first_deposit', 'redeposit')),
    "status" TEXT NOT NULL DEFAULT 'pending'
        CHECK ("status" IN ('pending', 'delivered', 'failed_retryable', 'failed_terminal')),
    "attemptCount" INTEGER NOT NULL DEFAULT 0
        CHECK ("attemptCount" >= 0),
    "maxAttempts" INTEGER NOT NULL
        CHECK ("maxAttempts" BETWEEN 1 AND 20),
    "nextAttemptAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "lastOutcome" TEXT
        CHECK ("lastOutcome" IS NULL OR "lastOutcome" IN (
            'delivered', 'http_4xx', 'http_5xx', 'http_other', 'timeout',
            'connect_error', 'dns_error', 'blocked_destination',
            'too_many_redirects', 'response_too_large', 'endpoint_disabled'
        )),
    "lastHttpStatus" INTEGER
        CHECK ("lastHttpStatus" IS NULL OR "lastHttpStatus" BETWEEN 100 AND 599),
    "deliveredAt" DATETIME
        CHECK (("status" = 'delivered') = ("deliveredAt" IS NOT NULL)),
    -- The resolved request URL, macros substituted. It carries the partner's
    -- own tracking context and NO ATA secret -- the signature travels in a
    -- header, so nothing stored here is a credential.
    "requestUrl" TEXT NOT NULL
        CHECK (length("requestUrl") BETWEEN 12 AND 4096)
        CHECK ("requestUrl" GLOB 'https://*'),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    -- A terminal state is never scheduled for another attempt, and a live one
    -- always is. This is the property the worker query depends on.
    CHECK (
        ("status" IN ('delivered', 'failed_terminal') AND "nextAttemptAt" IS NULL)
        OR
        ("status" IN ('pending', 'failed_retryable') AND "nextAttemptAt" IS NOT NULL)
    ),
    CONSTRAINT "AffiliatePostbackDelivery_conversion_fkey" FOREIGN KEY ("conversionEventId")
        REFERENCES "AffiliateConversionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliatePostbackDelivery_endpoint_fkey" FOREIGN KEY ("endpointId")
        REFERENCES "AffiliatePostbackEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliatePostbackDelivery_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliatePostbackDelivery_publicId_key"
ON "AffiliatePostbackDelivery"("publicId");

CREATE UNIQUE INDEX "AffiliatePostbackDelivery_conversion_endpoint_version_key"
ON "AffiliatePostbackDelivery"("conversionEventId", "endpointId", "endpointVersion");

CREATE INDEX "AffiliatePostbackDelivery_status_nextAttemptAt_idx"
ON "AffiliatePostbackDelivery"("status", "nextAttemptAt");

CREATE INDEX "AffiliatePostbackDelivery_affiliatePartnerId_createdAt_idx"
ON "AffiliatePostbackDelivery"("affiliatePartnerId", "createdAt");

CREATE INDEX "AffiliatePostbackDelivery_endpointId_createdAt_idx"
ON "AffiliatePostbackDelivery"("endpointId", "createdAt");

-- ---------------------------------------------------------------------------
-- 9. ATTEMPT -- ONE TRY AGAINST ONE LOGICAL DELIVERY
--
-- `responseSnippet` is the ONLY thing a remote server can put into this
-- database. It is bounded to 256 characters, control characters are stripped by
-- the writer, and no surface renders it as HTML.
-- ---------------------------------------------------------------------------
CREATE TABLE "AffiliatePostbackAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deliveryId" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL
        CHECK ("attemptNumber" BETWEEN 1 AND 20),
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME NOT NULL,
    "outcome" TEXT NOT NULL
        CHECK ("outcome" IN (
            'delivered', 'http_4xx', 'http_5xx', 'http_other', 'timeout',
            'connect_error', 'dns_error', 'blocked_destination',
            'too_many_redirects', 'response_too_large', 'endpoint_disabled'
        )),
    "httpStatus" INTEGER
        CHECK ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599),
    "durationMs" INTEGER NOT NULL
        CHECK ("durationMs" >= 0),
    "responseSnippet" TEXT
        CHECK ("responseSnippet" IS NULL OR length("responseSnippet") <= 256),
    -- A network-level failure has no HTTP status, and an HTTP outcome always
    -- has one. Neither can be recorded as the other.
    CHECK (
        ("outcome" IN ('delivered', 'http_4xx', 'http_5xx', 'http_other') AND "httpStatus" IS NOT NULL)
        OR
        ("outcome" NOT IN ('delivered', 'http_4xx', 'http_5xx', 'http_other') AND "httpStatus" IS NULL)
    ),
    CONSTRAINT "AffiliatePostbackAttempt_delivery_fkey" FOREIGN KEY ("deliveryId")
        REFERENCES "AffiliatePostbackDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliatePostbackAttempt_deliveryId_attemptNumber_key"
ON "AffiliatePostbackAttempt"("deliveryId", "attemptNumber");

CREATE INDEX "AffiliatePostbackAttempt_deliveryId_startedAt_idx"
ON "AffiliatePostbackAttempt"("deliveryId", "startedAt");

PRAGMA foreign_keys=ON;
