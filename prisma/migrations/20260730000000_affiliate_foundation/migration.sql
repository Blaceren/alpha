-- AFD-2 -- Administrative affiliate foundation: partners, campaigns and named
-- tracking links.
--
-- PURELY ADDITIVE. Three new tables and their indexes. No existing table is
-- rebuilt, no existing column is altered, no existing row is read or modified,
-- nothing is backfilled and no synthetic affiliate is seeded. Applying this
-- migration changes no accepted behaviour: the tables start empty and the only
-- code that can write to them requires an authenticated CRM session holding
-- `manage_settings`.
--
-- WHAT IS DELIBERATELY ABSENT. There is no column here that could hold a
-- traffic click, an anonymous visitor, an external affiliate click id, an
-- ataClickId, an attribution decision, a conversion event, a Pocket identifier,
-- a learner, a monetary amount or a current balance. Acquisition data arrives in
-- AFD-3B and lands in its own tables, and first deposit arrives in AFD-4.
-- Persisting any of that would require a new migration and a review.
--
-- NOTE ON STYLE. No comment in this file contains a statement separator,
-- because the canonical runner (prisma/migrate.ts) splits the whole file on
-- that character before executing. One inside prose would silently cut a
-- CREATE TABLE in half and apply the fragments.
--
-- NO REDIRECT SURFACE. `landingKey` is a CHECK-bounded logical key, not a URL.
-- A tracking link therefore cannot express "send this visitor to an arbitrary
-- address" even if an operator wanted it to, which is the open-redirect class
-- this design refuses to have. There is no public route in this migration's
-- release that reads any of these rows.

-- ---------------------------------------------------------------- partners --

CREATE TABLE "AffiliatePartner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    -- The immutable operator-facing handle. Lowercased before storage, and the
    -- CHECK bounds both the length and the alphabet so a code can never carry a
    -- space, a slash, a percent-escape, a control character or a Unicode
    -- lookalike that would make two visually identical affiliates distinct.
    "code" TEXT NOT NULL
        CHECK (length("code") BETWEEN 3 AND 64)
        CHECK ("code" NOT GLOB '*[^a-z0-9_-]*'),
    "displayName" TEXT NOT NULL
        CHECK (length(trim("displayName")) BETWEEN 1 AND 160),
    "description" TEXT
        CHECK ("description" IS NULL OR length("description") <= 2000),
    "status" TEXT NOT NULL DEFAULT 'active'
        CHECK ("status" IN ('active', 'paused', 'archived')),
    -- Bounded so a link can never inherit a window of zero (which would make
    -- every click instantly ineligible) or of decades (which would let a click
    -- claim a registration years later).
    "defaultAttributionWindowDays" INTEGER NOT NULL DEFAULT 30
        CHECK ("defaultAttributionWindowDays" BETWEEN 1 AND 365),
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    -- Set when and only when status becomes 'archived'. The paired CHECK makes
    -- "archived without a timestamp" and "timestamped without being archived"
    -- both unrepresentable, so history cannot drift from status.
    "archivedAt" DATETIME
        CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL)),
    -- RESTRICT, not CASCADE: deleting the employee who created an affiliate
    -- must never silently delete the affiliate and its traffic history.
    CONSTRAINT "AffiliatePartner_createdBy_fkey" FOREIGN KEY ("createdByUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- "One affiliate owns one code, forever" as a database fact. Two concurrent
-- creates of the same code cannot both commit, and the loser is a stable 409.
CREATE UNIQUE INDEX "AffiliatePartner_code_key" ON "AffiliatePartner"("code");

CREATE INDEX "AffiliatePartner_status_createdAt_idx"
ON "AffiliatePartner"("status", "createdAt");
CREATE INDEX "AffiliatePartner_createdAt_idx" ON "AffiliatePartner"("createdAt");
CREATE INDEX "AffiliatePartner_createdByUserId_idx"
ON "AffiliatePartner"("createdByUserId");

-- --------------------------------------------------------------- campaigns --

CREATE TABLE "AffiliateCampaign" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "affiliatePartnerId" INTEGER NOT NULL,
    "code" TEXT NOT NULL
        CHECK (length("code") BETWEEN 3 AND 64)
        CHECK ("code" NOT GLOB '*[^a-z0-9_-]*'),
    "displayName" TEXT NOT NULL
        CHECK (length(trim("displayName")) BETWEEN 1 AND 160),
    "notes" TEXT
        CHECK ("notes" IS NULL OR length("notes") <= 2000),
    "status" TEXT NOT NULL DEFAULT 'active'
        CHECK ("status" IN ('active', 'paused', 'archived')),
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME
        CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL)),
    -- RESTRICT: an affiliate with campaigns is archived, never deleted.
    CONSTRAINT "AffiliateCampaign_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCampaign_createdBy_fkey" FOREIGN KEY ("createdByUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Campaign codes are unique WITHIN an affiliate, not globally: two affiliates
-- may each run a `summer` campaign and they are different campaigns.
CREATE UNIQUE INDEX "AffiliateCampaign_affiliatePartnerId_code_key"
ON "AffiliateCampaign"("affiliatePartnerId", "code");

-- The composite target that lets a tracking link's FK prove, in the database,
-- that its campaign belongs to the same partner as the link. Without this there
-- is no non-racy way to enforce it: an application-level read-then-write can
-- always be interleaved with a concurrent campaign move.
CREATE UNIQUE INDEX "AffiliateCampaign_id_affiliatePartnerId_key"
ON "AffiliateCampaign"("id", "affiliatePartnerId");

CREATE INDEX "AffiliateCampaign_affiliatePartnerId_status_createdAt_idx"
ON "AffiliateCampaign"("affiliatePartnerId", "status", "createdAt");
CREATE INDEX "AffiliateCampaign_createdAt_idx" ON "AffiliateCampaign"("createdAt");
CREATE INDEX "AffiliateCampaign_createdByUserId_idx"
ON "AffiliateCampaign"("createdByUserId");

-- ---------------------------------------------------------- tracking links --

CREATE TABLE "AffiliateTrackingLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "affiliatePartnerId" INTEGER NOT NULL,
    "affiliateCampaignId" INTEGER,
    -- Server-generated only. 32 lowercase base32 characters carrying 160 bits
    -- of CSPRNG entropy, so the code space cannot be walked and one link's code
    -- reveals nothing about another's. The CHECK pins the exact shape, which
    -- also means a client-supplied value of any other form is rejected by the
    -- database even if application validation were bypassed.
    "publicCode" TEXT NOT NULL
        CHECK (length("publicCode") = 32)
        CHECK ("publicCode" NOT GLOB '*[^a-z2-7]*'),
    "displayName" TEXT NOT NULL
        CHECK (length(trim("displayName")) BETWEEN 1 AND 160),
    -- 'active' is absent by design in AFD-2. There is no public route to serve
    -- an active link and no attribution owner to receive its click, so the
    -- status simply does not exist yet rather than existing and misleading.
    "status" TEXT NOT NULL DEFAULT 'draft'
        CHECK ("status" IN ('draft', 'paused', 'archived')),
    -- A logical destination KEY, never a URL. The CHECK is the reason an
    -- operator cannot turn a tracking link into an open redirect: there is no
    -- value of this column that names an external address.
    "landingKey" TEXT NOT NULL DEFAULT 'academy_registration'
        CHECK ("landingKey" IN ('academy_registration')),
    -- INCOMING query-parameter NAMES this link will accept in AFD-3B. Never
    -- captured values. Constrained to a strict identifier alphabet so a
    -- configured name cannot smuggle a bracket, a dot path or a separator into
    -- future query parsing.
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
    -- NULL inherits the partner default. Bounded identically when set.
    "attributionWindowDays" INTEGER
        CHECK ("attributionWindowDays" IS NULL OR "attributionWindowDays" BETWEEN 1 AND 365),
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME
        CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL)),
    CONSTRAINT "AffiliateTrackingLink_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    -- COMPOSITE, and that is the whole point: a link may only reference a
    -- campaign whose owning partner is the link's own partner. Cross-affiliate
    -- assignment is rejected by the database rather than by a check the
    -- application might forget, and it cannot be won by a race.
    CONSTRAINT "AffiliateTrackingLink_campaign_fkey"
        FOREIGN KEY ("affiliateCampaignId", "affiliatePartnerId")
        REFERENCES "AffiliateCampaign"("id", "affiliatePartnerId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateTrackingLink_createdBy_fkey" FOREIGN KEY ("createdByUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- "One public code names at most one link, forever." A collision loses this
-- race rather than overwriting, and the generator retries a bounded number of
-- times before failing loudly — it never falls back to a predictable code.
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
