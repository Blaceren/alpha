-- L4PA-1 -- Authoritative learner-to-Pocket trader identity binding.
--
-- Purely additive: ONE new table and its indexes. No existing table is rebuilt,
-- no existing column is altered, no existing row is modified, nothing is
-- backfilled and no legacy value is migrated in. In particular
-- `ExchangeAccount.traderId` is deliberately NOT copied here: it is a
-- non-unique, silently-overwritten attribution hint written by every postback
-- goal, so importing it would import exactly the ambiguity this table exists to
-- remove. Bindings begin after this migration. A learner who registered before
-- it simply has no binding and their checkpoint reports `identity_unlinked`.
--
-- Applying this migration changes no accepted behaviour. With
-- POCKET_POSTBACK_ENABLED absent (the shipped default) nothing is ever written,
-- and with POCKET_BALANCE_PROVIDER_ENABLED absent nothing is ever read.
--
-- PRIVACY BY ABSENCE. There is no column here that could hold an observed
-- balance, a demo balance, a deposit total, an FTD amount, a raw postback, a raw
-- provider response, a free-form JSON blob, an API token or a generated hash.
-- Persisting a learner's money would require a new migration and a review.

CREATE TABLE "PocketTraderIdentity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    -- A foreign system's identifier stored as a CANONICAL DECIMAL STRING so it
    -- round-trips exactly and is compared as text, never as a float. The CHECK
    -- rejects empty, signed, padded, spaced and non-numeric values, and bounds
    -- the length so an oversized identifier cannot be stored: '0' is rejected
    -- because Pocket trader IDs are strictly positive, and a leading zero is
    -- rejected because two spellings of one identity would defeat UNIQUE.
    "pocketUserId" TEXT NOT NULL
        CHECK (length("pocketUserId") BETWEEN 1 AND 19)
        CHECK ("pocketUserId" NOT GLOB '*[^0-9]*')
        CHECK ("pocketUserId" NOT GLOB '0*'),
    -- The trusted attribution identifier the binding arrived on. Retained for
    -- support correlation only, and it is never an authorisation input.
    "clickId" TEXT NOT NULL CHECK (length(trim("clickId")) BETWEEN 1 AND 200),
    -- Provenance. Only an authenticated registration postback may bind today,
    -- and the CHECK keeps any future source an explicit, reviewed act.
    "source" TEXT NOT NULL DEFAULT 'registration_postback'
        CHECK ("source" IN ('registration_postback')),
    "boundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PocketTraderIdentity_user_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- "One learner has at most one authoritative Pocket trader" as a database fact.
-- Two concurrent registration postbacks naming different traders cannot both
-- commit. The loser is a conflict, never an overwrite.
CREATE UNIQUE INDEX "PocketTraderIdentity_userId_key"
ON "PocketTraderIdentity"("userId");

-- "One Pocket trader backs at most one learner" as a database fact. Without
-- this, one funded Pocket account could be replayed to pass the $50 checkpoint
-- for an unlimited number of ATA learners.
CREATE UNIQUE INDEX "PocketTraderIdentity_pocketUserId_key"
ON "PocketTraderIdentity"("pocketUserId");

-- Support correlation by attribution identifier.
CREATE INDEX "PocketTraderIdentity_clickId_idx"
ON "PocketTraderIdentity"("clickId");
