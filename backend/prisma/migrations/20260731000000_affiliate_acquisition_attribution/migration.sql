-- AFD-3B2 -- Acquisition attribution: clicks, the frozen user attribution and
-- the conversion-event ledger.
--
-- WHAT THIS MIGRATION DOES. It adds the three tables that turn a configured
-- tracking link into a measured acquisition, and it teaches AffiliateTrackingLink
-- the one status AFD-2 deliberately refused to invent: 'active'. Nothing else is
-- touched. No User row is read, rewritten or backfilled, no attribution is
-- fabricated for an existing learner, no synthetic affiliate is seeded and no
-- table outside the affiliate group changes shape.
--
-- WHAT IS DELIBERATELY ABSENT. There is no first-deposit table, no redeposit,
-- no provider-event table, no outbox, no postback endpoint table and no
-- product-behaviour analytics. Those are AFD-4 and later, and each will need its
-- own migration and its own review. There is also no column anywhere below that
-- can hold a raw IP address, a User-Agent, a complete request URL, a cookie, a
-- Turnstile token, a Pocket identifier, a password or a monetary amount.
--
-- IDENTIFIER SEPARATION. Four different click-shaped identifiers exist in this
-- platform and none of them is the other. The affiliate network's own click id
-- arrives in a query parameter and is stored as externalAffiliateClickId. The
-- ATA acquisition click id is ours, generated here, and is stored as ataClickId.
-- The Pocket referral click id and the Pocket player id belong to the Pocket
-- callback contract and appear nowhere in this migration.
--
-- NOTE ON STYLE. No comment in this file contains a statement separator, because
-- the canonical runner (prisma/migrate.ts) splits the whole file on that
-- character before executing. One inside prose would silently cut a CREATE TABLE
-- in half and apply the fragments.

-- ------------------------------------------------- tracking-link activation --
--
-- SQLite cannot alter a CHECK constraint, so widening the status alphabet means
-- rebuilding the table. The established repository pattern is used verbatim:
-- defer foreign keys for the surrounding migration transaction, stash every row
-- in a TEMPORARY table, recreate the table with the new constraint, copy the
-- rows back column by column and rebuild every index.
--
-- Every AFD-2 row survives with its id, publicCode, status, parameter mapping,
-- window and timestamps unchanged. The rebuild adds exactly one legal value to
-- one CHECK. It changes no existing row and it does not activate anything --
-- activation is an authenticated, audited operator action, not a migration.

PRAGMA defer_foreign_keys = ON;

CREATE TEMPORARY TABLE "_afd3b2_tracking_link_stash" AS
SELECT * FROM "AffiliateTrackingLink";

DROP TABLE "AffiliateTrackingLink";

CREATE TABLE "AffiliateTrackingLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "affiliatePartnerId" INTEGER NOT NULL,
    "affiliateCampaignId" INTEGER,
    "publicCode" TEXT NOT NULL
        CHECK (length("publicCode") = 32)
        CHECK ("publicCode" NOT GLOB '*[^a-z2-7]*'),
    "displayName" TEXT NOT NULL
        CHECK (length(trim("displayName")) BETWEEN 1 AND 160),
    -- 'active' joins the alphabet here, and only here. A link may now be served
    -- by the public acquisition route -- but only while the feature switch, the
    -- parent affiliate and the parent campaign all agree, which is a runtime
    -- fact this column deliberately does not try to encode.
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
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME
        CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL)),
    CONSTRAINT "AffiliateTrackingLink_partner_fkey" FOREIGN KEY ("affiliatePartnerId")
        REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateTrackingLink_campaign_fkey"
        FOREIGN KEY ("affiliateCampaignId", "affiliatePartnerId")
        REFERENCES "AffiliateCampaign"("id", "affiliatePartnerId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateTrackingLink_createdBy_fkey" FOREIGN KEY ("createdByUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "AffiliateTrackingLink" (
    "id", "affiliatePartnerId", "affiliateCampaignId", "publicCode", "displayName",
    "status", "landingKey", "externalClickParameter",
    "sub1Parameter", "sub2Parameter", "sub3Parameter", "sub4Parameter", "sub5Parameter",
    "attributionWindowDays", "createdByUserId", "createdAt", "updatedAt", "archivedAt"
)
SELECT
    "id", "affiliatePartnerId", "affiliateCampaignId", "publicCode", "displayName",
    "status", "landingKey", "externalClickParameter",
    "sub1Parameter", "sub2Parameter", "sub3Parameter", "sub4Parameter", "sub5Parameter",
    "attributionWindowDays", "createdByUserId", "createdAt", "updatedAt", "archivedAt"
FROM "_afd3b2_tracking_link_stash";

DROP TABLE "_afd3b2_tracking_link_stash";

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

-- ------------------------------------------------------- acquisition clicks --
--
-- One row per request the public acquisition route accepted, whatever it decided
-- about that request. A prefetch is recorded and marked as a prefetch rather
-- than being silently dropped, because "this link received machine traffic" is a
-- fact an operator will eventually need and inventing it later is impossible.
--
-- WHAT A CLICK IS NOT ALLOWED TO REMEMBER. No raw IP, no User-Agent, no complete
-- request URL, no query string, no cookie, no authorization material. The only
-- externally supplied strings are the values of parameters an operator explicitly
-- configured on the link, each bounded and control-character-free. The referrer
-- is reduced to a bare host before storage, and even that is optional.

CREATE TABLE "AffiliateClick" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    -- OUR click identifier, and the only one this platform issues. 160 bits of
    -- CSPRNG entropy rendered as 32 lowercase base32 characters, matching the
    -- publicCode shape so the two are visibly the same KIND of thing and
    -- neither can be mistaken for a database id. Never accepted from a client.
    "ataClickId" TEXT NOT NULL
        CHECK (length("ataClickId") = 32)
        CHECK ("ataClickId" NOT GLOB '*[^a-z2-7]*'),
    "trackingLinkId" INTEGER NOT NULL,
    -- Present only for a qualified anonymous visit. A prefetch and a click made
    -- by an already-authenticated user both store NULL, which is what makes
    -- "these clicks can never be attributed" a database fact rather than a rule
    -- the selection query has to remember.
    "anonymousVisitorId" TEXT
        CHECK ("anonymousVisitorId" IS NULL OR (length("anonymousVisitorId") = 32 AND "anonymousVisitorId" NOT GLOB '*[^a-z2-7]*')),
    -- The AFFILIATE NETWORK's click id, captured from the parameter name the
    -- link configures. Not unique: a network may legitimately reuse or repeat a
    -- value, and enforcing uniqueness here would reject honest traffic.
    "externalAffiliateClickId" TEXT
        CHECK ("externalAffiliateClickId" IS NULL OR length("externalAffiliateClickId") BETWEEN 1 AND 256),
    "sub1" TEXT CHECK ("sub1" IS NULL OR length("sub1") BETWEEN 1 AND 256),
    "sub2" TEXT CHECK ("sub2" IS NULL OR length("sub2") BETWEEN 1 AND 256),
    "sub3" TEXT CHECK ("sub3" IS NULL OR length("sub3") BETWEEN 1 AND 256),
    "sub4" TEXT CHECK ("sub4" IS NULL OR length("sub4") BETWEEN 1 AND 256),
    "sub5" TEXT CHECK ("sub5" IS NULL OR length("sub5") BETWEEN 1 AND 256),
    "classification" TEXT NOT NULL
        CHECK ("classification" IN ('qualified', 'prefetch', 'authenticated_user')),
    -- The window SNAPSHOT. Eligibility is judged against the rule that was in
    -- force when the click happened, so an operator who later widens or narrows
    -- a link cannot retroactively grant or revoke attribution for traffic that
    -- has already been paid for.
    "effectiveAttributionWindowDays" INTEGER NOT NULL
        CHECK ("effectiveAttributionWindowDays" BETWEEN 1 AND 365),
    -- A bare lowercase host, never a URL and never a path or query.
    "sanitizedReferrerHost" TEXT
        CHECK ("sanitizedReferrerHost" IS NULL OR length("sanitizedReferrerHost") BETWEEN 1 AND 253),
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Belt and braces for the rule above: the two unattributable classifications
    -- cannot carry a visitor even if application code regressed.
    CHECK (("classification" = 'qualified') OR ("anonymousVisitorId" IS NULL)),
    -- RESTRICT: a link that has carried traffic is archived, never deleted, and
    -- deleting it must never silently destroy the acquisition history that a
    -- payout was calculated from.
    CONSTRAINT "AffiliateClick_trackingLink_fkey" FOREIGN KEY ("trackingLinkId")
        REFERENCES "AffiliateTrackingLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliateClick_ataClickId_key" ON "AffiliateClick"("ataClickId");

CREATE INDEX "AffiliateClick_trackingLinkId_occurredAt_idx"
ON "AffiliateClick"("trackingLinkId", "occurredAt");
-- The selection index. Registration asks exactly this question: which qualified
-- clicks does this visitor have, newest first.
CREATE INDEX "AffiliateClick_anonymousVisitorId_occurredAt_idx"
ON "AffiliateClick"("anonymousVisitorId", "occurredAt");
-- Partial, because the column is NULL for most rows and an operator only ever
-- looks a value up when reconciling with a network's own report.
CREATE INDEX "AffiliateClick_externalAffiliateClickId_idx"
ON "AffiliateClick"("externalAffiliateClickId")
WHERE "externalAffiliateClickId" IS NOT NULL;
CREATE INDEX "AffiliateClick_classification_occurredAt_idx"
ON "AffiliateClick"("classification", "occurredAt");

-- ------------------------------------------------------- user attribution --
--
-- The frozen answer to "which affiliate acquired this learner", written once at
-- registration and never again. There is no PATCH owner, no DELETE owner and no
-- reattribution path anywhere in the application, and the two unique indexes
-- below make the two dangerous mistakes unrepresentable rather than merely
-- unlikely: a user cannot acquire a second attribution, and a visitor journey
-- cannot be spent twice. The second one is what a copied cookie runs into.
--
-- All three click references belong to the same anonymousVisitorId. That is
-- enforced by the selection owner, which reads the three from one visitor's
-- eligible set, and it is recorded here so an auditor can re-check it.

CREATE TABLE "AffiliateAttribution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "anonymousVisitorId" TEXT NOT NULL
        CHECK (length("anonymousVisitorId") = 32)
        CHECK ("anonymousVisitorId" NOT GLOB '*[^a-z2-7]*'),
    "firstTouchClickId" INTEGER NOT NULL,
    "lastTouchClickId" INTEGER NOT NULL,
    "selectedClickId" INTEGER NOT NULL,
    "attributionModel" TEXT NOT NULL
        CHECK ("attributionModel" IN ('last_eligible_affiliate_click')),
    "selectedAt" DATETIME NOT NULL,
    -- Equal to selectedAt in this phase, and separate from it on purpose: the
    -- moment a decision was computed and the moment it became immutable are
    -- different facts, and a later phase that ever recomputes before freezing
    -- must not have to invent a column to say so.
    "frozenAt" DATETIME NOT NULL,
    "selectionReason" TEXT NOT NULL
        CHECK ("selectionReason" IN ('registration_cookie')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateAttribution_user_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateAttribution_firstTouch_fkey" FOREIGN KEY ("firstTouchClickId")
        REFERENCES "AffiliateClick"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateAttribution_lastTouch_fkey" FOREIGN KEY ("lastTouchClickId")
        REFERENCES "AffiliateClick"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffiliateAttribution_selected_fkey" FOREIGN KEY ("selectedClickId")
        REFERENCES "AffiliateClick"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AffiliateAttribution_userId_key" ON "AffiliateAttribution"("userId");
-- The replay defence. A copied, forwarded or replayed attribution token names a
-- visitor journey that has already been spent, and the second registration loses
-- this race in the database rather than in a pre-transaction check that a
-- concurrent request could interleave with.
CREATE UNIQUE INDEX "AffiliateAttribution_anonymousVisitorId_key"
ON "AffiliateAttribution"("anonymousVisitorId");

CREATE INDEX "AffiliateAttribution_selectedClickId_idx"
ON "AffiliateAttribution"("selectedClickId");
CREATE INDEX "AffiliateAttribution_selectedAt_idx"
ON "AffiliateAttribution"("selectedAt");

-- --------------------------------------------------- conversion-event ledger --
--
-- The append-only record of things worth paying for. AFD-3B2 writes exactly one
-- event type, academy_registration, and it writes one for EVERY successful public
-- registration -- including a direct one, whose affiliate columns are all NULL.
-- A direct registration that produced no row would be indistinguishable from a
-- registration the ledger simply missed, and the difference between "nobody
-- referred this learner" and "we do not know" is the difference between a
-- reconcilable ledger and an unreconcilable one.
--
-- The snapshots are denormalised on purpose. A payout report must still read the
-- code an affiliate was called at the moment of conversion even after the
-- affiliate is renamed, re-coded or archived.

CREATE TABLE "AffiliateConversionEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL
        CHECK (length("eventId") = 32)
        CHECK ("eventId" NOT GLOB '*[^a-z2-7]*'),
    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN ('academy_registration')),
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
    -- Which owner produced this event, and that owner's own idempotency key.
    -- Together with eventType they are the logical identity of the event, so a
    -- retried or replayed registration cannot produce a second one.
    "sourceOwner" TEXT NOT NULL
        CHECK ("sourceOwner" IN ('auth_register')),
    "sourceEventId" TEXT NOT NULL
        CHECK (length("sourceEventId") BETWEEN 1 AND 128),
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- An attributed event carries all of its affiliate coordinates or none of
    -- them. A half-attributed row -- an attribution with no link, a link with no
    -- affiliate -- would silently under- or over-pay, so it cannot be stored.
    CHECK (
        ("attributionId" IS NULL AND "selectedClickId" IS NULL AND "affiliatePartnerId" IS NULL
            AND "trackingLinkId" IS NULL AND "affiliateCodeSnapshot" IS NULL
            AND "trackingLinkPublicCodeSnapshot" IS NULL)
        OR
        ("attributionId" IS NOT NULL AND "selectedClickId" IS NOT NULL AND "affiliatePartnerId" IS NOT NULL
            AND "trackingLinkId" IS NOT NULL AND "affiliateCodeSnapshot" IS NOT NULL
            AND "trackingLinkPublicCodeSnapshot" IS NOT NULL)
    ),
    -- A campaign is optional on a tracking link, so its id and its snapshot are
    -- optional here too -- but they travel together.
    CHECK (("affiliateCampaignId" IS NULL) = ("campaignCodeSnapshot" IS NULL)),
    -- An unattributed event cannot name a campaign.
    CHECK (("attributionId" IS NOT NULL) OR ("affiliateCampaignId" IS NULL)),
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

CREATE UNIQUE INDEX "AffiliateConversionEvent_eventId_key"
ON "AffiliateConversionEvent"("eventId");

-- The idempotency key. "One academy_registration per registered user" is a
-- database fact, so a retried registration owner, a replayed request or a
-- concurrent duplicate cannot double-count a conversion.
CREATE UNIQUE INDEX "AffiliateConversionEvent_source_key"
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
