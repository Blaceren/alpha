-- AFD-4 — Pocket first-deposit ingestion.
--
-- Additive only. This migration introduces one new table and widens the
-- conversion ledger so it can carry a money-bearing event type. It adds no
-- redeposit table, no balance column, no outbox and no fabricated provider
-- transaction identifier.
--
-- MIGRATION RUNNER CONTRACT. prisma/migrate.ts splits this file on the
-- semicolon character and executes each fragment inside one transaction. A
-- semicolon inside a comment would therefore cut a statement in half and apply
-- the halves separately, so no comment in this file contains one. Every
-- statement below is a single complete SQL statement terminated by exactly one
-- semicolon, and the file ends with a statement rather than with a comment.

-- ---------------------------------------------------------------------------
-- 1. The canonical Pocket provider event.
-- ---------------------------------------------------------------------------
--
-- The uniqueness at the bottom is the whole point of the table: one Pocket
-- player produces at most one canonical first deposit, enforced by the
-- database rather than by whichever code path happens to run first.
--
-- pocketClickId and normalizedAmount are canonical and immutable. A later
-- delivery that disagrees with either is recorded through conflictCode beside
-- them and never written over them.

CREATE TABLE "PocketProviderEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL DEFAULT 'pocket'
        CHECK ("provider" IN ('pocket')),
    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN ('first_deposit')),
    -- The ATA-issued click id Pocket echoes back, shaped tq-<uuid v4>.
    "pocketClickId" TEXT NOT NULL
        CHECK (length("pocketClickId") BETWEEN 1 AND 64),
    -- A strictly positive base-10 Pocket player id, bounded to 16 digits so it
    -- survives the Partner API JSON number round trip.
    "pocketPlayerId" TEXT NOT NULL
        CHECK (length("pocketPlayerId") BETWEEN 1 AND 16)
        CHECK ("pocketPlayerId" NOT GLOB '*[^0-9]*')
        CHECK ("pocketPlayerId" NOT GLOB '0*'),
    "matchedUserId" INTEGER,
    -- Canonical decimal TEXT with exactly two fractional digits. Stored as text
    -- because binary floating point cannot hold 282.70 exactly and this value is
    -- money somebody is paid a commission on.
    "normalizedAmount" TEXT NOT NULL
        CHECK (length("normalizedAmount") BETWEEN 4 AND 15)
        CHECK ("normalizedAmount" GLOB '*[0-9].[0-9][0-9]')
        CHECK ("normalizedAmount" NOT GLOB '*[^0-9.]*')
        CHECK ("normalizedAmount" NOT GLOB '*.*.*')
        -- Strictly positive. A zero first deposit is a provider error or a
        -- probe, and storing one would create a canonical event the real
        -- deposit could never supersede.
        CHECK ("normalizedAmount" GLOB '*[1-9]*'),
    "currencyCode" TEXT
        CHECK ("currencyCode" IS NULL OR (length("currencyCode") = 3 AND "currencyCode" NOT GLOB '*[^A-Z]*')),
    "currencyStatus" TEXT NOT NULL DEFAULT 'unspecified'
        CHECK ("currencyStatus" IN ('unspecified', 'configured')),
    "status" TEXT NOT NULL DEFAULT 'pending_identity'
        CHECK ("status" IN ('pending_identity', 'matched', 'conflict')),
    "firstReceivedAt" DATETIME NOT NULL,
    "lastReceivedAt" DATETIME NOT NULL,
    -- Transport metadata. Bounded, and it never implies more than one deposit.
    "replayCount" INTEGER NOT NULL DEFAULT 0
        CHECK ("replayCount" >= 0),
    "conflictCode" TEXT
        CHECK ("conflictCode" IS NULL OR "conflictCode" IN ('click_id_mismatch', 'amount_mismatch', 'identity_owner_mismatch', 'click_owner_missing')),
    "conflictDetectedAt" DATETIME,
    "matchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The currency code and its status travel together in both directions, so a
    -- row can never claim a unit it does not name or name one it calls unknown.
    CHECK (("currencyStatus" = 'configured') = ("currencyCode" IS NOT NULL)),
    -- A matched event names its learner and when it matched. A pending or
    -- quarantined one names neither, so "matched" can never be half true.
    CHECK (
        ("status" = 'matched' AND "matchedUserId" IS NOT NULL AND "matchedAt" IS NOT NULL)
        OR
        ("status" IN ('pending_identity', 'conflict') AND "matchedUserId" IS NULL AND "matchedAt" IS NULL)
    ),
    -- A quarantined event always names why it was quarantined.
    CHECK ("status" <> 'conflict' OR "conflictCode" IS NOT NULL),
    -- A still-pending event never names a conflict: it has no canonical
    -- counterpart yet for anything to disagree with.
    CHECK ("status" <> 'pending_identity' OR "conflictCode" IS NULL),
    -- A MATCHED event may carry a conflict code without losing its match. When a
    -- divergent delivery arrives after the deposit was legitimately matched and
    -- counted, the disagreement is flagged BESIDE the match rather than erasing
    -- it -- unmatching would orphan a conversion event that is already canonical
    -- and immutable, which is a worse lie than the divergence itself.
    CHECK (("conflictCode" IS NULL) = ("conflictDetectedAt" IS NULL)),
    -- Deliveries cannot precede the first one.
    CHECK ("lastReceivedAt" >= "firstReceivedAt"),
    CONSTRAINT "PocketProviderEvent_matchedUser_fkey" FOREIGN KEY ("matchedUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The domain invariant, as a database fact. A replayed, retried or concurrent
-- callback for the same player collides here instead of creating a second
-- deposit.
CREATE UNIQUE INDEX "PocketProviderEvent_provider_eventType_pocketPlayerId_key"
ON "PocketProviderEvent"("provider", "eventType", "pocketPlayerId");

CREATE INDEX "PocketProviderEvent_pocketClickId_idx"
ON "PocketProviderEvent"("pocketClickId");

CREATE INDEX "PocketProviderEvent_matchedUserId_idx"
ON "PocketProviderEvent"("matchedUserId");

-- The operator reconciliation command's scan: pending rows in arrival order.
CREATE INDEX "PocketProviderEvent_status_firstReceivedAt_idx"
ON "PocketProviderEvent"("status", "firstReceivedAt");

CREATE INDEX "PocketProviderEvent_conflictCode_idx"
ON "PocketProviderEvent"("conflictCode");

CREATE INDEX "PocketProviderEvent_lastReceivedAt_idx"
ON "PocketProviderEvent"("lastReceivedAt");

-- ---------------------------------------------------------------------------
-- 2. Widen the conversion ledger for a money-bearing event type.
-- ---------------------------------------------------------------------------
--
-- SQLite cannot alter a CHECK constraint in place, so the eventType and
-- sourceOwner enumerations are widened by rebuilding the table. Nothing else in
-- the schema holds a foreign key TO AffiliateConversionEvent, so the rebuild
-- needs no foreign key suspension -- which matters, because the runner executes
-- this file inside a transaction and PRAGMA foreign_keys is a no-op there.
--
-- Every existing academy_registration row is carried across unchanged, with the
-- three new money columns set to NULL.

CREATE TABLE "new_AffiliateConversionEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL
        CHECK (length("eventId") = 32)
        CHECK ("eventId" NOT GLOB '*[^a-z2-7]*'),
    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN ('academy_registration', 'first_deposit')),
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
        CHECK ("sourceOwner" IN ('auth_register', 'pocket_first_deposit')),
    "sourceEventId" TEXT NOT NULL
        CHECK (length("sourceEventId") BETWEEN 1 AND 128),
    -- AFD-4 money columns. Canonical decimal TEXT, never a float, never a
    -- balance and never summed into one.
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
    -- A money-bearing event states its amount and its currency status. An event
    -- that carries no money states neither, so an academy_registration can never
    -- acquire an amount and a first_deposit can never lose one.
    CHECK (
        ("eventType" = 'first_deposit' AND "providerAmount" IS NOT NULL AND "currencyStatus" IS NOT NULL)
        OR
        ("eventType" <> 'first_deposit' AND "providerAmount" IS NULL AND "currencyCode" IS NULL AND "currencyStatus" IS NULL)
    ),
    -- The unit and the claim about the unit travel together, in both directions.
    CHECK (("currencyStatus" = 'configured') = ("currencyCode" IS NOT NULL)),
    -- The producing owner and the event type are bound to each other, so a
    -- deposit owner cannot mint a registration or the reverse.
    CHECK (
        ("eventType" = 'academy_registration' AND "sourceOwner" = 'auth_register')
        OR
        ("eventType" = 'first_deposit' AND "sourceOwner" = 'pocket_first_deposit')
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

-- Columns listed explicitly on both sides. A bare SELECT star would bind by
-- position and would silently mis-assign every column if either table is ever
-- edited again.
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
    "sourceOwner", "sourceEventId", NULL, NULL, NULL,
    "occurredAt", "createdAt"
FROM "AffiliateConversionEvent";

DROP TABLE "AffiliateConversionEvent";

ALTER TABLE "new_AffiliateConversionEvent" RENAME TO "AffiliateConversionEvent";

CREATE UNIQUE INDEX "AffiliateConversionEvent_eventId_key"
ON "AffiliateConversionEvent"("eventId");

-- The idempotency key, preserved exactly. For AFD-4 the triple is
-- first_deposit + pocket_first_deposit + the PocketProviderEvent row id, so a
-- replayed deposit cannot double-count a conversion.
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
