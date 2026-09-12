-- ===========================================================================
-- MIGRATION 49 -- POCKET-DEP-RDEP-1
--
-- MAKE PocketProviderEvent ABLE TO HOLD A CANONICAL REDEPOSIT.
--
-- PRISMA SPLITS THIS FILE ON THE SEMICOLON CHARACTER, so NO COMMENT IN THIS
-- FILE CONTAINS ONE, and every statement is a single complete statement
-- terminated by exactly one semicolon.
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- It is NOT created because this is a new block. The previous phase declined to
-- create migration 49 for exactly that reason. It exists because the current
-- schema STRUCTURALLY CANNOT EXPRESS THE PRODUCT, in two independent ways:
--
--   1. CHECK ("eventType" IN ('first_deposit')) -- a canonical redeposit has
--      nowhere to live.
--   2. UNIQUE(provider, eventType, pocketPlayerId) -- widening the CHECK alone
--      would cap every player at ONE lifetime redeposit.
--
-- ---------------------------------------------------------------------------
-- FIRST-DEPOSIT UNIQUENESS IS PRESERVED, NOT WEAKENED
--
-- The old index is replaced by a PARTIAL index scoped to the first-deposit
-- family alone:
--
--   UNIQUE(provider, pocketPlayerId) WHERE eventType = 'first_deposit'
--
-- That is STRICTLY STRONGER for first deposits than what it replaces: the old
-- key included eventType, so it only ever prevented a duplicate FTD. The new one
-- says the same thing without depending on the family column, and it cannot be
-- widened by adding a family.
--
-- REDEPOSIT UNIQUENESS IS ON THE DERIVED KEY, AND ONLY THERE:
--
--   UNIQUE(provider, eventType, providerEventKey) WHERE providerEventKey IS NOT NULL
--
-- Many redeposits per player, one canonical event per derived key.
--
-- ---------------------------------------------------------------------------
-- THE KEY IS ATA'S, NOT POCKET'S
--
-- providerEventKey holds an identity ATA DERIVES from authenticated provider
-- attributes -- player, normalised DATE_TIME, canonical amount. Pocket does not
-- guarantee it is unique per deposit. That residual risk is an accepted business
-- decision recorded as BUSINESS_ACCEPTED_RDEP_DEDUP_ASSUMPTION in
-- src/lib/growth/pocket/redeposit-identity.ts and in the audit package. The
-- column name says providerEvent because it identifies a provider event, NOT
-- because the provider issued it.
--
-- ---------------------------------------------------------------------------
-- STORAGE CLASS, FIXED BEFORE THIS TABLE EVER CARRIES MONEY
--
-- Migration 47 established INTEGER EPOCH MILLISECONDS as canonical and migration
-- 48 normalised 70 legacy TEXT values that a DEFAULT CURRENT_TIMESTAMP had
-- produced. This table still carried that same DEFAULT on createdAt and
-- updatedAt and had no typeof guard on any timestamp. It has zero rows today, so
-- the defect is latent -- and a financial table is the last place it should be
-- allowed to appear. Every timestamp column is now integer-guarded by CHECK and
-- the defaults are integer expressions.
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE REBUILD IS SAFE HERE
--
-- SQLite cannot add a CHECK or change a DEFAULT in place. The rebuild is safe
-- because, measured on the live database immediately before this was written:
--   * PocketProviderEvent holds 0 rows
--   * NO table has a foreign key pointing at it
--   * it has exactly one outbound foreign key, matchedUserId -> User(id)
-- The copy step is still written, and is still correct, if rows exist.
--
-- Every CHECK, index and comment from the accepted table is carried forward
-- verbatim unless this migration deliberately changes it.
-- ===========================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_PocketProviderEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL DEFAULT 'pocket'
        CHECK ("provider" IN ('pocket')),
    -- WIDENED. 'redeposit' joins 'first_deposit' as a canonical financial event.
    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN ('first_deposit', 'redeposit')),
    "pocketClickId" TEXT NOT NULL
        CHECK (length("pocketClickId") BETWEEN 1 AND 64),
    "pocketPlayerId" TEXT NOT NULL
        CHECK (length("pocketPlayerId") BETWEEN 1 AND 16)
        CHECK ("pocketPlayerId" NOT GLOB '*[^0-9]*')
        CHECK ("pocketPlayerId" NOT GLOB '0*'),
    "matchedUserId" INTEGER,
    "normalizedAmount" TEXT NOT NULL
        CHECK (length("normalizedAmount") BETWEEN 4 AND 15)
        CHECK ("normalizedAmount" GLOB '*[0-9].[0-9][0-9]')
        CHECK ("normalizedAmount" NOT GLOB '*[^0-9.]*')
        CHECK ("normalizedAmount" NOT GLOB '*.*.*')
        CHECK ("normalizedAmount" GLOB '*[1-9]*'),
    "currencyCode" TEXT
        CHECK ("currencyCode" IS NULL OR (length("currencyCode") = 3 AND "currencyCode" NOT GLOB '*[^A-Z]*')),
    "currencyStatus" TEXT NOT NULL DEFAULT 'unspecified'
        CHECK ("currencyStatus" IN ('unspecified', 'configured')),
    "status" TEXT NOT NULL DEFAULT 'pending_identity'
        CHECK ("status" IN ('pending_identity', 'matched', 'conflict')),

    -- NEW. The ATA-derived redeposit identity. NULL for a first deposit, which
    -- has its own natural key in the player.
    "providerEventKey" TEXT
        CHECK ("providerEventKey" IS NULL OR length("providerEventKey") BETWEEN 8 AND 160),
    -- NEW. The provider's LOCAL wall clock, normalised. Zone-independent, and
    -- what the deterministic key is built from.
    "providerEventLocal" TEXT
        CHECK ("providerEventLocal" IS NULL
               OR "providerEventLocal" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'),
    -- NEW. The ABSOLUTE provider instant, and it is NULLABLE ON PURPOSE.
    --
    -- Pocket renders DATE_TIME in a zone that varies by user, account and
    -- registration GEO. There is no single zone ATA could apply without
    -- fabricating one, and a fabricated instant applied uniformly is worse than
    -- an absent one because it looks authoritative and is wrong per row. So this
    -- is populated ONLY when the delivery states its own offset.
    "providerEventAt" DATETIME
        CHECK ("providerEventAt" IS NULL OR typeof("providerEventAt") = 'integer'),
    -- NEW. Which of the two above is true.
    "providerEventAtStatus" TEXT NOT NULL DEFAULT 'absent'
        CHECK ("providerEventAtStatus" IN ('absent', 'local_only', 'absolute_from_sender')),
    -- NEW. The exact bytes received, kept so a zone can be applied later without
    -- re-deriving anything, exactly as ProviderIngressEvent keeps its raw form.
    "providerEventAtRaw" TEXT
        CHECK ("providerEventAtRaw" IS NULL OR length("providerEventAtRaw") BETWEEN 1 AND 64),

    "firstReceivedAt" DATETIME NOT NULL
        CHECK (typeof("firstReceivedAt") = 'integer'),
    "lastReceivedAt" DATETIME NOT NULL
        CHECK (typeof("lastReceivedAt") = 'integer'),
    "replayCount" INTEGER NOT NULL DEFAULT 0
        CHECK ("replayCount" >= 0),
    "conflictCode" TEXT
        CHECK ("conflictCode" IS NULL OR "conflictCode" IN ('click_id_mismatch', 'amount_mismatch', 'identity_owner_mismatch', 'click_owner_missing')),
    "conflictDetectedAt" DATETIME
        CHECK ("conflictDetectedAt" IS NULL OR typeof("conflictDetectedAt") = 'integer'),
    "matchedAt" DATETIME
        CHECK ("matchedAt" IS NULL OR typeof("matchedAt") = 'integer'),
    "createdAt" DATETIME NOT NULL
        DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        CHECK (typeof("createdAt") = 'integer'),
    "updatedAt" DATETIME NOT NULL
        DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        CHECK (typeof("updatedAt") = 'integer'),

    CHECK (("currencyStatus" = 'configured') = ("currencyCode" IS NOT NULL)),
    CHECK (
        ("status" = 'matched' AND "matchedUserId" IS NOT NULL AND "matchedAt" IS NOT NULL)
        OR
        ("status" IN ('pending_identity', 'conflict') AND "matchedUserId" IS NULL AND "matchedAt" IS NULL)
    ),
    CHECK ("status" <> 'conflict' OR "conflictCode" IS NOT NULL),
    CHECK ("status" <> 'pending_identity' OR "conflictCode" IS NULL),
    CHECK (("conflictCode" IS NULL) = ("conflictDetectedAt" IS NULL)),
    CHECK ("lastReceivedAt" >= "firstReceivedAt"),

    -- NEW. Each family must carry the shape its identity requires, so a row can
    -- never be half a redeposit.
    --
    -- A redeposit without a derived key would be an uncountable canonical event
    -- and a redeposit without an event time would mean the key was derived from
    -- something else -- both are the failure this design exists to prevent.
    -- A redeposit must carry its derived identity and the local wall clock that
    -- identity was built from. It must NOT be required to carry an absolute
    -- instant: that is frequently unknowable and is recorded as such.
    CHECK (
        "eventType" <> 'redeposit'
        OR ("providerEventKey" IS NOT NULL AND "providerEventLocal" IS NOT NULL)
    ),
    -- The temporal status and the absolute instant must agree, so a row can
    -- never claim an instant it does not hold or hold one it calls unknown.
    CHECK (("providerEventAtStatus" = 'absolute_from_sender') = ("providerEventAt" IS NOT NULL)),
    CHECK ("eventType" <> 'redeposit' OR "providerEventAtStatus" <> 'absent'),
    -- A first deposit is identified by its player, not by a derived key. Storing
    -- one would put it in the redeposit unique index and let a first deposit and
    -- a redeposit collide.
    CHECK ("eventType" <> 'first_deposit' OR "providerEventKey" IS NULL),

    CONSTRAINT "PocketProviderEvent_matchedUser_fkey" FOREIGN KEY ("matchedUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_PocketProviderEvent" (
    "id", "provider", "eventType", "pocketClickId", "pocketPlayerId", "matchedUserId",
    "normalizedAmount", "currencyCode", "currencyStatus", "status",
    "firstReceivedAt", "lastReceivedAt", "replayCount",
    "conflictCode", "conflictDetectedAt", "matchedAt", "createdAt", "updatedAt"
)
SELECT
    "id", "provider", "eventType", "pocketClickId", "pocketPlayerId", "matchedUserId",
    "normalizedAmount", "currencyCode", "currencyStatus", "status",
    CASE WHEN typeof("firstReceivedAt") = 'text' THEN CAST(strftime('%s', "firstReceivedAt") AS INTEGER) * 1000 ELSE CAST("firstReceivedAt" AS INTEGER) END,
    CASE WHEN typeof("lastReceivedAt") = 'text' THEN CAST(strftime('%s', "lastReceivedAt") AS INTEGER) * 1000 ELSE CAST("lastReceivedAt" AS INTEGER) END,
    "replayCount",
    "conflictCode",
    CASE WHEN typeof("conflictDetectedAt") = 'text' THEN CAST(strftime('%s', "conflictDetectedAt") AS INTEGER) * 1000 ELSE "conflictDetectedAt" END,
    CASE WHEN typeof("matchedAt") = 'text' THEN CAST(strftime('%s', "matchedAt") AS INTEGER) * 1000 ELSE "matchedAt" END,
    CASE WHEN typeof("createdAt") = 'text' THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 ELSE CAST("createdAt" AS INTEGER) END,
    CASE WHEN typeof("updatedAt") = 'text' THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 ELSE CAST("updatedAt" AS INTEGER) END
FROM "PocketProviderEvent";

DROP TABLE "PocketProviderEvent";

ALTER TABLE "new_PocketProviderEvent" RENAME TO "PocketProviderEvent";

-- FIRST-DEPOSIT UNIQUENESS. Partial, scoped to its own family, and strictly
-- stronger than the index it replaces.
CREATE UNIQUE INDEX "PocketProviderEvent_first_deposit_player_key"
ON "PocketProviderEvent"("provider", "pocketPlayerId")
WHERE "eventType" = 'first_deposit';

-- REDEPOSIT UNIQUENESS. On the derived key alone, so one player may hold many
-- redeposits and each derived key may appear once.
CREATE UNIQUE INDEX "PocketProviderEvent_provider_eventType_providerEventKey_key"
ON "PocketProviderEvent"("provider", "eventType", "providerEventKey")
WHERE "providerEventKey" IS NOT NULL;

CREATE INDEX "PocketProviderEvent_pocketClickId_idx"
ON "PocketProviderEvent"("pocketClickId");

CREATE INDEX "PocketProviderEvent_matchedUserId_idx"
ON "PocketProviderEvent"("matchedUserId");

CREATE INDEX "PocketProviderEvent_status_firstReceivedAt_idx"
ON "PocketProviderEvent"("status", "firstReceivedAt");

CREATE INDEX "PocketProviderEvent_conflictCode_idx"
ON "PocketProviderEvent"("conflictCode");

CREATE INDEX "PocketProviderEvent_lastReceivedAt_idx"
ON "PocketProviderEvent"("lastReceivedAt");

CREATE INDEX "PocketProviderEvent_status_conflictDetectedAt_idx"
ON "PocketProviderEvent"("status", "conflictDetectedAt");

-- Redeposits are read by player and by event time on the Growth surfaces.
CREATE INDEX "PocketProviderEvent_eventType_pocketPlayerId_providerEventAt_idx"
ON "PocketProviderEvent"("eventType", "pocketPlayerId", "providerEventAt");

PRAGMA foreign_keys=ON;
