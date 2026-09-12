-- G4-GROWTH -- the canonical growth event ledger, its outbox, and durable
-- provider ingress evidence.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT TOUCH.
-- Three new tables. No existing table is altered, rewritten, renamed or
-- dropped. No published curriculum row is touched. No money column changes
-- meaning. PocketProviderEvent keeps UNIQUE(provider, eventType,
-- pocketPlayerId) and remains the sole enforcer of the one-first-deposit-per-
-- player invariant -- this migration adds a ledger that PROJECTS that fact and
-- never a second place where it could be decided.
--
-- THE LEDGER IS A PROJECTION WITH A PROVABLE ORIGIN. Every GrowthEvent row
-- names the owner table and owner row it was derived from, and carries that
-- owner's idempotency key. UNIQUE(eventType, sourceOwner, sourceEventId) is
-- what a replayed emitter collides with. The backfill at the end of this file
-- uses EXACTLY the same keys the runtime emitters use, so a backfilled row and
-- a later runtime row for the same owner cannot both exist.
--
-- WHY THERE IS A BACKFILL AT ALL. A ledger whose coverage begins at deploy time
-- reports zero registrations for every period before the deploy, and zero is a
-- business number. Every backfilled row is derived from an owner row that
-- already exists, using that owner's OWN occurrence timestamp -- never now(),
-- never updatedAt, never a neighbouring event's time -- and is stamped
-- origin = backfill so a reader can always separate reconstructed history from
-- observed history.
--
-- WHAT THE BACKFILL CANNOT RECONSTRUCT, STATED RATHER THAN FAKED.
-- mentor_review_submitted has no durably owned timestamp: entering
-- pending_review updates lastProgressAt, which a later action overwrites. Rows
-- STILL in pending_review are backfilled from lastProgressAt, which is exact
-- for them. Rows that have since been approved are NOT backfilled, because
-- their submission instant is genuinely not recorded anywhere. The analytics
-- availability block reports this rather than showing a smaller number as if it
-- were complete.
--
-- NOT APPLIED ANYWHERE BY THIS PHASE. Source-only, exactly like the migrations
-- it descends from. No live, preprod or production database is touched by this
-- wave, no Pocket ingress switch is enabled, and no service is restarted.
--
-- IT DESCENDS FROM 20260811000000_assessment_successor_lineage AND DOES NOT
-- EDIT IT. Correcting a shipped migration in place would change its checksum
-- and make every database that already ran it disagree with the repository.
--
-- MIGRATION RUNNER CONTRACT. prisma/migrate.ts splits this file on the
-- semicolon character, so NO COMMENT IN THIS FILE CONTAINS ONE, and every
-- statement is a single complete statement terminated by exactly one semicolon.
--
-- ===========================================================================
-- G4-R3 -- THE CANONICAL TIME REPRESENTATION OF THIS LEDGER.
--
-- WHAT WENT WRONG. This migration used to copy each owner's timestamp VERBATIM
-- into GrowthEvent.occurredAt. That is right for provenance and wrong for
-- storage: SQLite is dynamically typed, and PREPROD holds rows written by raw
-- SQL whose datetime columns are TEXT rather than the integer epoch
-- milliseconds Prisma writes. Copying them verbatim produced a ledger with
-- MIXED STORAGE CLASSES, and because SQLite orders every TEXT value above every
-- INTEGER, a `occurredAt >= ? AND occurredAt < ?` range filter was true on the
-- lower bound and FALSE on the upper one for every such row. Fifteen real,
-- correctly derived events on frozen PREPROD therefore matched no period at
-- all -- enrollments counted 19 of 21, level_started 38 of 44, level_completed
-- 43 of 49 -- silently, with no availability flag.
--
-- THE CANONICAL REPRESENTATION IS INTEGER EPOCH MILLISECONDS, and it was chosen
-- by measuring the stack rather than by preference. Prisma's SQLite connector
-- writes every DateTime as an integer number of milliseconds since the epoch
-- and binds range parameters the same way -- observed directly on the live
-- database, where User.createdAt is `integer` 1784577045092. Any other choice
-- would make the ORM disagree with the column on every read. It sorts
-- chronologically, compares correctly against a bound parameter, round-trips
-- through Prisma unchanged, keeps the occurredAt indexes usable because no
-- function wraps the column, and is identical for backfilled and runtime rows.
--
-- HOW HISTORY IS CONVERTED. Exactly one historical TEXT shape exists on frozen
-- PREPROD: `YYYY-MM-DD HH:MM:SS`, the format SQLite's own CURRENT_TIMESTAMP and
-- datetime('now') produce, which SQLite defines as UTC. `strftime('%s', v)`
-- reads it back to the same instant with the same UTC assumption the writer
-- used, so the conversion preserves the instant rather than inventing a zone.
-- Verified to round-trip: '2026-07-29 09:01:26' -> 1785315686000 ->
-- '2026-07-29 09:01:26'.
--
-- AN UNRECOGNISED SHAPE IS A LOUD FAILURE, NOT A GUESS. The guard statements
-- below count every source timestamp that is neither numeric nor that exact
-- shape and abort the whole migration through a CHECK if the count is not zero.
-- §35 forbids substituting the migration time, recordedAt or now() for an
-- unknown historical instant, and this makes that substitution unrepresentable.
--
-- THE SOURCE TABLES ARE NOT REWRITTEN. Normalisation happens on the way INTO
-- the projection. Every authoritative historical row keeps the bytes it had.
-- ===========================================================================

CREATE TABLE "GrowthEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,

    -- Opaque, server-generated, never a database id. A future outbound postback
    -- quotes this, and quoting a sequential integer would leak volume.
    "eventId" TEXT NOT NULL
        CHECK (length("eventId") BETWEEN 16 AND 64)
        CHECK ("eventId" NOT GLOB '*[^0-9a-z]*'),

    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN (
            'traffic_click',
            'ata_reg',
            'curriculum_enrollment',
            'academy_activation',
            'level_started',
            'level_completed',
            'assessment_completed',
            'report_submitted',
            'report_approved',
            'mentor_review_submitted',
            'mentor_review_approved',
            'pocket_reg',
            'dep',
            'rdep'
        )),

    -- G4-R3. Integer epoch milliseconds, enforced. The CHECK is what makes a
    -- mixed-storage-class ledger unrepresentable rather than merely unintended:
    -- a raw INSERT carrying a datetime string is refused at the boundary
    -- instead of becoming a row that no date range can ever match. Prisma's own
    -- writes satisfy it by construction -- its SQLite connector serialises
    -- DateTime as an integer -- which is asserted at runtime, not assumed.
    "occurredAt" DATETIME NOT NULL
        CHECK (typeof("occurredAt") = 'integer'),

    -- The DEFAULT is an integer expression rather than CURRENT_TIMESTAMP, which
    -- would produce TEXT and violate the CHECK on any raw insert that omits the
    -- column -- including this migration's own backfill.
    "recordedAt" DATETIME NOT NULL
        DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        CHECK (typeof("recordedAt") = 'integer'),

    "origin" TEXT NOT NULL DEFAULT 'runtime'
        CHECK ("origin" IN ('runtime', 'backfill')),

    "schemaVersion" INTEGER NOT NULL DEFAULT 1
        CHECK ("schemaVersion" >= 1),

    "userId" INTEGER,
    "enrollmentId" INTEGER,
    "acquisitionClickId" INTEGER,
    "attributionId" INTEGER,
    "pocketTraderIdentityId" INTEGER,
    "providerIngressEventId" INTEGER,

    "provider" TEXT
        CHECK ("provider" IS NULL OR "provider" IN ('pocket')),

    "levelDefinitionId" INTEGER,
    "levelNumber" INTEGER
        CHECK ("levelNumber" IS NULL OR "levelNumber" >= 1),

    -- Canonical decimal TEXT with exactly two fractional digits. The same shape
    -- PocketProviderEvent enforces, restated here so a row cannot enter this
    -- table carrying a float rendering, a thousands separator, an exponent or a
    -- sign.
    "amount" TEXT
        CHECK ("amount" IS NULL OR (
            length("amount") BETWEEN 4 AND 15
            AND "amount" GLOB '*[0-9].[0-9][0-9]'
            AND "amount" NOT GLOB '*[^0-9.]*'
            AND "amount" NOT GLOB '*.*.*'
        )),

    "currencyCode" TEXT
        CHECK ("currencyCode" IS NULL OR (
            length("currencyCode") = 3 AND "currencyCode" NOT GLOB '*[^A-Z]*'
        )),

    "currencyStatus" TEXT
        CHECK ("currencyStatus" IS NULL OR "currencyStatus" IN ('unspecified', 'configured')),

    "sourceOwner" TEXT NOT NULL
        CHECK ("sourceOwner" IN (
            'acquisition_click',
            'auth_register',
            'curriculum_enrollment',
            'curriculum_level_progress',
            'curriculum_assessment_attempt',
            'curriculum_report_submission',
            'curriculum_report_review',
            'curriculum_mentor_review',
            'pocket_identity_binding',
            'pocket_first_deposit',
            'pocket_redeposit'
        )),

    "sourceEntityType" TEXT NOT NULL
        CHECK (length("sourceEntityType") BETWEEN 1 AND 64),

    "sourceEntityId" TEXT NOT NULL
        CHECK (length("sourceEntityId") BETWEEN 1 AND 128),

    "sourceEventId" TEXT NOT NULL
        CHECK (length("sourceEventId") BETWEEN 1 AND 200),

    "metadata" JSONB,

    -- A currency may be named only when the row says it was configured, and a
    -- configured row must name one. This is the AFD-4 rule restated so that
    -- "we know the unit is unknown" can never decay into "nobody filled this in
    -- yet", which is how a NULL becomes USD.
    CHECK (("currencyStatus" = 'configured') = ("currencyCode" IS NOT NULL)),

    -- Money-bearing rows carry a currency STATUS even when the unit is unknown,
    -- and rows that carry no money carry no currency at all.
    CHECK (("amount" IS NULL) = ("currencyStatus" IS NULL)),

    -- Only the three Pocket families may carry money. A level completion with an
    -- amount would be a category error, and this makes it unrepresentable.
    CHECK ("amount" IS NULL OR "eventType" IN ('dep', 'rdep')),

    -- Provider-sourced families must name their provider, first-party families
    -- must not.
    CHECK (
        ("eventType" IN ('pocket_reg', 'dep', 'rdep') AND "provider" IS NOT NULL)
        OR ("eventType" NOT IN ('pocket_reg', 'dep', 'rdep') AND "provider" IS NULL)
    ),

    -- A traffic click happens before anyone is a user, and every other family
    -- happens to somebody. Enforced here so an emitter cannot record an
    -- ownerless registration.
    CHECK (
        ("eventType" = 'traffic_click' AND "userId" IS NULL)
        OR ("eventType" <> 'traffic_click' AND "userId" IS NOT NULL)
    ),

    -- A level ordinal and a level definition travel together or not at all.
    CHECK (("levelDefinitionId" IS NULL) = ("levelNumber" IS NULL)),

    CONSTRAINT "GrowthEvent_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GrowthEvent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId")
        REFERENCES "UserCurriculumEnrollment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GrowthEvent_acquisitionClickId_fkey" FOREIGN KEY ("acquisitionClickId")
        REFERENCES "AffiliateClick" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GrowthEvent_attributionId_fkey" FOREIGN KEY ("attributionId")
        REFERENCES "AffiliateAttribution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GrowthEvent_pocketTraderIdentityId_fkey" FOREIGN KEY ("pocketTraderIdentityId")
        REFERENCES "PocketTraderIdentity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GrowthEvent_providerIngressEventId_fkey" FOREIGN KEY ("providerIngressEventId")
        REFERENCES "ProviderIngressEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GrowthEvent_levelDefinitionId_fkey" FOREIGN KEY ("levelDefinitionId")
        REFERENCES "LevelDefinition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GrowthEvent_eventId_key" ON "GrowthEvent"("eventId");

-- THE IDEMPOTENCY CONTRACT OF THE WHOLE LEDGER. Every emitter declares an owner
-- and a key within that owner. A replay collides here rather than producing a
-- second event.
CREATE UNIQUE INDEX "GrowthEvent_eventType_sourceOwner_sourceEventId_key"
    ON "GrowthEvent"("eventType", "sourceOwner", "sourceEventId");

CREATE INDEX "GrowthEvent_eventType_occurredAt_idx"
    ON "GrowthEvent"("eventType", "occurredAt");

CREATE INDEX "GrowthEvent_eventType_levelNumber_occurredAt_idx"
    ON "GrowthEvent"("eventType", "levelNumber", "occurredAt");

CREATE INDEX "GrowthEvent_userId_occurredAt_idx"
    ON "GrowthEvent"("userId", "occurredAt");

CREATE INDEX "GrowthEvent_acquisitionClickId_eventType_idx"
    ON "GrowthEvent"("acquisitionClickId", "eventType");

CREATE INDEX "GrowthEvent_attributionId_eventType_idx"
    ON "GrowthEvent"("attributionId", "eventType");

CREATE INDEX "GrowthEvent_enrollmentId_eventType_idx"
    ON "GrowthEvent"("enrollmentId", "eventType");

CREATE INDEX "GrowthEvent_occurredAt_idx" ON "GrowthEvent"("occurredAt");

CREATE INDEX "GrowthEvent_providerIngressEventId_idx"
    ON "GrowthEvent"("providerIngressEventId");

CREATE INDEX "GrowthEvent_levelDefinitionId_idx"
    ON "GrowthEvent"("levelDefinitionId");

-- The transactional outbox. Written in the SAME transaction as the event it
-- announces, so "the conversion happened" and "the conversion was announced"
-- commit together and are recovered together. There is no destination column
-- because there is no consumer yet -- and adding one later must not mean adding
-- a second copy of the semantic event.
CREATE TABLE "GrowthEventOutbox" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "growthEventId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL
        CHECK ("eventType" IN (
            'traffic_click',
            'ata_reg',
            'curriculum_enrollment',
            'academy_activation',
            'level_started',
            'level_completed',
            'assessment_completed',
            'report_submitted',
            'report_approved',
            'mentor_review_submitted',
            'mentor_review_approved',
            'pocket_reg',
            'dep',
            'rdep'
        )),
    "status" TEXT NOT NULL DEFAULT 'pending'
        CHECK ("status" IN ('pending', 'in_flight', 'delivered', 'failed')),
    -- G4-R3. Same canonical representation as the ledger it announces: a
    -- dispatcher ordering by availableAt must not sort a TEXT row above every
    -- integer one and process reconstructed history out of order.
    "createdAt" DATETIME NOT NULL
        DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        CHECK (typeof("createdAt") = 'integer'),
    "availableAt" DATETIME NOT NULL
        CHECK (typeof("availableAt") = 'integer'),
    "attemptCount" INTEGER NOT NULL DEFAULT 0
        CHECK ("attemptCount" >= 0),
    "lastAttemptAt" DATETIME
        CHECK ("lastAttemptAt" IS NULL OR typeof("lastAttemptAt") = 'integer'),

    -- A bounded code only. A provider response body or a stack trace here would
    -- be an unbounded, unreviewed sink for whatever a third party returned.
    "lastErrorCode" TEXT
        CHECK ("lastErrorCode" IS NULL OR (
            length("lastErrorCode") BETWEEN 1 AND 64
            AND "lastErrorCode" NOT GLOB '*[^a-z_0-9]*'
        )),

    -- An attempt count without an attempt time, or the reverse, would make the
    -- retry history unreadable.
    CHECK (("attemptCount" = 0) = ("lastAttemptAt" IS NULL)),

    CONSTRAINT "GrowthEventOutbox_growthEventId_fkey" FOREIGN KEY ("growthEventId")
        REFERENCES "GrowthEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GrowthEventOutbox_growthEventId_key"
    ON "GrowthEventOutbox"("growthEventId");

CREATE INDEX "GrowthEventOutbox_status_availableAt_idx"
    ON "GrowthEventOutbox"("status", "availableAt");

CREATE INDEX "GrowthEventOutbox_eventType_status_idx"
    ON "GrowthEventOutbox"("eventType", "status");

-- Durable, sanitized evidence of every provider delivery.
--
-- A row here says a REQUEST ARRIVED and what it carried. A GrowthEvent says a
-- BUSINESS FACT IS TRUE. Keeping them apart is what lets an operator answer
-- "did Pocket ever send this and why was it refused" without the canonical
-- ledger filling up with rows that are not facts.
--
-- NO SECRET REACHES THIS TABLE. The route redacts ow, secret and token before
-- anything is persisted, and rawPayloadHash is computed over the SAME redacted
-- structure -- so the hash cannot be used as an offline oracle for the secret
-- either.
CREATE TABLE "ProviderIngressEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,

    "provider" TEXT NOT NULL DEFAULT 'pocket'
        CHECK ("provider" IN ('pocket')),

    -- EXACTLY THREE GOALS. withdraw, commission, email and the other nine
    -- aliases the legacy route accepted are absent by design: a caller-supplied
    -- string must not select a financial mutation, and this is the database
    -- saying so as well as the application.
    "goal" TEXT NOT NULL
        CHECK ("goal" IN ('reg', 'dep', 'redep')),

    -- G4-R3. Canonical integer epoch milliseconds, like every other timestamp
    -- this migration creates. `receivedAt` is the ingress-health surface's date
    -- basis, so a TEXT row here would disappear from an operator's window in
    -- exactly the way ledger rows used to.
    "receivedAt" DATETIME NOT NULL
        CHECK (typeof("receivedAt") = 'integer'),
    "providerEventAt" DATETIME
        CHECK ("providerEventAt" IS NULL OR typeof("providerEventAt") = 'integer'),
    "providerEventAtRaw" TEXT
        CHECK ("providerEventAtRaw" IS NULL OR length("providerEventAtRaw") BETWEEN 1 AND 64),
    "providerEventAtStatus" TEXT NOT NULL DEFAULT 'absent'
        CHECK ("providerEventAtStatus" IN ('absent', 'parsed', 'unparseable')),

    "playerIdNormalized" TEXT
        CHECK ("playerIdNormalized" IS NULL OR (
            length("playerIdNormalized") BETWEEN 1 AND 16
            AND "playerIdNormalized" NOT GLOB '*[^0-9]*'
            AND "playerIdNormalized" NOT GLOB '0*'
        )),

    "clickId" TEXT
        CHECK ("clickId" IS NULL OR length("clickId") BETWEEN 1 AND 64),

    "amount" TEXT
        CHECK ("amount" IS NULL OR (
            length("amount") BETWEEN 4 AND 15
            AND "amount" GLOB '*[0-9].[0-9][0-9]'
            AND "amount" NOT GLOB '*[^0-9.]*'
            AND "amount" NOT GLOB '*.*.*'
        )),

    "campaignId" TEXT CHECK ("campaignId" IS NULL OR length("campaignId") BETWEEN 1 AND 128),
    "campaignName" TEXT CHECK ("campaignName" IS NULL OR length("campaignName") BETWEEN 1 AND 128),
    "sub1" TEXT CHECK ("sub1" IS NULL OR length("sub1") BETWEEN 1 AND 128),
    "sub2" TEXT CHECK ("sub2" IS NULL OR length("sub2") BETWEEN 1 AND 128),
    "sub3" TEXT CHECK ("sub3" IS NULL OR length("sub3") BETWEEN 1 AND 128),
    "sub4" TEXT CHECK ("sub4" IS NULL OR length("sub4") BETWEEN 1 AND 128),
    "sub5" TEXT CHECK ("sub5" IS NULL OR length("sub5") BETWEEN 1 AND 128),
    "country" TEXT CHECK ("country" IS NULL OR length("country") BETWEEN 1 AND 64),
    "deviceType" TEXT CHECK ("deviceType" IS NULL OR length("deviceType") BETWEEN 1 AND 64),

    "sanitizedPayload" JSONB NOT NULL,

    "rawPayloadHash" TEXT NOT NULL
        CHECK (length("rawPayloadHash") = 64)
        CHECK ("rawPayloadHash" NOT GLOB '*[^0-9a-f]*'),

    -- The provider's own unique event id, when a contract proves one exists.
    -- NULL for every Pocket delivery today, which is exactly why a canonical
    -- rdep cannot be emitted.
    "providerEventIdentity" TEXT
        CHECK ("providerEventIdentity" IS NULL OR length("providerEventIdentity") BETWEEN 1 AND 128),

    "processingStatus" TEXT NOT NULL
        CHECK ("processingStatus" IN (
            'accepted_processed',
            'accepted_duplicate',
            'accepted_pending_linkage',
            'identity_unresolved',
            'rejected',
            'quarantined'
        )),

    "rejectionCode" TEXT
        CHECK ("rejectionCode" IS NULL OR "rejectionCode" IN (
            'auth_failed',
            'goal_unknown',
            'goal_disabled',
            'schema_invalid',
            'amount_invalid',
            'click_unknown',
            'player_conflict',
            'identity_owner_mismatch',
            'provider_event_identity_missing',
            'ordering_unresolved'
        )),

    "canonicalEventId" INTEGER,

    "schemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("schemaVersion" >= 1),
    "createdAt" DATETIME NOT NULL
        DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        CHECK (typeof("createdAt") = 'integer'),

    -- A parsed time must have a value, an unparseable one must have kept the raw
    -- string, and an absent one must have neither. This is what stops a
    -- timezone being invented for a money timestamp.
    CHECK (("providerEventAtStatus" = 'parsed') = ("providerEventAt" IS NOT NULL)),
    CHECK (("providerEventAtStatus" = 'unparseable') = ("providerEventAtRaw" IS NOT NULL)),

    -- Refusals carry a reason, acceptances do not.
    CHECK (
        ("processingStatus" IN ('rejected', 'quarantined', 'identity_unresolved')
            AND "rejectionCode" IS NOT NULL)
        OR ("processingStatus" NOT IN ('rejected', 'quarantined', 'identity_unresolved')
            AND "rejectionCode" IS NULL)
    ),

    -- A delivery that produced no canonical event must not name one, and a
    -- refused delivery can never have produced one.
    CHECK (
        "canonicalEventId" IS NULL
        OR "processingStatus" IN ('accepted_processed', 'accepted_duplicate')
    ),

    -- A registration carries no money.
    CHECK ("goal" <> 'reg' OR "amount" IS NULL),

    CONSTRAINT "ProviderIngressEvent_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId")
        REFERENCES "GrowthEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Two deliveries may not claim the same provider event identity. SQLite treats
-- NULLs as distinct in a unique index, so today -- when every Pocket delivery
-- has a NULL identity -- this constrains nothing, which is the honest outcome.
-- The moment a provider contract supplies real identities it becomes the
-- redeposit idempotency key without a schema change.
CREATE UNIQUE INDEX "ProviderIngressEvent_provider_goal_identity_key"
    ON "ProviderIngressEvent"("provider", "goal", "providerEventIdentity");

CREATE INDEX "ProviderIngressEvent_provider_goal_receivedAt_idx"
    ON "ProviderIngressEvent"("provider", "goal", "receivedAt");

CREATE INDEX "ProviderIngressEvent_processingStatus_receivedAt_idx"
    ON "ProviderIngressEvent"("processingStatus", "receivedAt");

CREATE INDEX "ProviderIngressEvent_rejectionCode_receivedAt_idx"
    ON "ProviderIngressEvent"("rejectionCode", "receivedAt");

CREATE INDEX "ProviderIngressEvent_playerIdNormalized_idx"
    ON "ProviderIngressEvent"("playerIdNormalized");

CREATE INDEX "ProviderIngressEvent_clickId_idx"
    ON "ProviderIngressEvent"("clickId");

CREATE INDEX "ProviderIngressEvent_rawPayloadHash_idx"
    ON "ProviderIngressEvent"("rawPayloadHash");

-- ---------------------------------------------------------------------------
-- G4-R3 -- TIME NORMALISATION PRE-FLIGHT GUARD
--
-- Every source timestamp this migration projects is checked BEFORE any event is
-- written. A value that is numeric is already canonical. A value that is TEXT is
-- convertible only if it matches the one historical shape this codebase has ever
-- produced, `YYYY-MM-DD HH:MM:SS`. Anything else -- an ISO string with a zone
-- offset, a fractional second, a locale rendering, a blob -- would require
-- GUESSING a zone or a format, and §35 forbids guessing.
--
-- The guard is a table whose CHECK admits only zero. If a single unsupported
-- value exists anywhere, the INSERT violates
-- `unsupportedSourceTimestamps` and the ENTIRE migration transaction rolls back
-- with that constraint named -- no partial ledger, no fabricated instant, and a
-- diagnostic that points at the cause rather than at a downstream symptom.
--
-- It is created and dropped inside the same transaction, so it leaves no trace
-- on a successful run.
CREATE TABLE "_growth_time_normalization_guard" (
    "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 0),
    "unsupportedSourceTimestamps" INTEGER NOT NULL
        CHECK ("unsupportedSourceTimestamps" = 0)
);

INSERT INTO "_growth_time_normalization_guard" ("id", "unsupportedSourceTimestamps")
SELECT 0, COUNT(*) FROM (
    SELECT c."occurredAt" AS v FROM "AffiliateClick" c
    UNION ALL SELECT e."occurredAt" FROM "AffiliateConversionEvent" e
    UNION ALL SELECT u."createdAt" FROM "User" u
    UNION ALL SELECT en."enrolledAt" FROM "UserCurriculumEnrollment" en
    UNION ALL SELECT p."startedAt" FROM "UserLevelProgress" p
    UNION ALL SELECT p."completedAt" FROM "UserLevelProgress" p
    UNION ALL SELECT p."lastProgressAt" FROM "UserLevelProgress" p
    UNION ALL SELECT a."submittedAt" FROM "AssessmentAttempt" a
    UNION ALL SELECT s."firstSubmittedAt" FROM "ReportSubmission" s
    UNION ALL SELECT r."reviewedAt" FROM "ReportReview" r
    UNION ALL SELECT t."boundAt" FROM "PocketTraderIdentity" t
    UNION ALL SELECT pe."firstReceivedAt" FROM "PocketProviderEvent" pe
) AS every_source_timestamp
WHERE v IS NOT NULL
  AND typeof(v) NOT IN ('integer', 'real')
  AND NOT (
      typeof(v) = 'text'
      AND v GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
      AND strftime('%s', v) IS NOT NULL
  );

DROP TABLE "_growth_time_normalization_guard";

-- ---------------------------------------------------------------------------
-- BACKFILL
--
-- G4-R3 -- EVERY TIMESTAMP BELOW IS NORMALISED, NOT COPIED.
--
-- The expression is the same everywhere and is written inline rather than
-- hidden behind a name, because SQLite has no user-defined function available
-- to a migration and a half-applied abstraction would be worse than repetition:
--
--   CASE WHEN typeof(X) = 'text' THEN strftime('%s', X) * 1000
--        ELSE CAST(X AS INTEGER) END
--
-- NULL flows through the ELSE branch as NULL, so an absent timestamp stays
-- absent. The guard above has already proved that every TEXT value reaching the
-- first branch is the one convertible shape.
--
-- Every statement below reads an owner table and writes the projection of it.
-- The sourceEventId expressions are the SAME strings the runtime emitters
-- produce -- see src/lib/growth/event-keys.ts, which is the single definition
-- both sides are written against and which its own test asserts against these
-- statements. eventId is 20 random bytes as lowercase hex, which satisfies the
-- charset CHECK and is unique with overwhelming probability -- and the unique
-- index is the actual guarantee.
-- ---------------------------------------------------------------------------

-- traffic_click. Qualified clicks only: a prefetch was made by a machine and an
-- authenticated_user click cannot be attributed, and counting either as
-- acquisition traffic would inflate every downstream denominator.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "acquisitionClickId",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'traffic_click',
    CASE WHEN typeof(c."occurredAt") = 'text' THEN strftime('%s', c."occurredAt") * 1000
         ELSE CAST(c."occurredAt" AS INTEGER) END,
    'backfill',
    c."id",
    'acquisition_click',
    'AffiliateClick',
    CAST(c."id" AS TEXT),
    'click:' || CAST(c."id" AS TEXT)
FROM "AffiliateClick" c
WHERE c."classification" = 'qualified'
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'traffic_click'
      AND existing."sourceOwner" = 'acquisition_click'
      AND existing."sourceEventId" = 'click:' || CAST(c."id" AS TEXT)
);

-- ata_reg. Sourced from the accepted conversion ledger rather than from User,
-- because that ledger is already the frozen answer to "this learner registered
-- and this is who acquired them", including for a direct signup whose affiliate
-- columns are all NULL.
--
-- G4-H2 -- THIS IS TIER 1 OF THREE. See the second pass below for the full
-- population rule. The conversion ledger only ever records a SELF-SERVICE
-- academy registration, so every row it holds is proven evidence and needs no
-- further predicate.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId",
    "acquisitionClickId", "attributionId",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'ata_reg',
    CASE WHEN typeof(e."occurredAt") = 'text' THEN strftime('%s', e."occurredAt") * 1000
         ELSE CAST(e."occurredAt" AS INTEGER) END,
    'backfill',
    e."userId",
    e."selectedClickId",
    e."attributionId",
    'auth_register',
    -- G4-L4. The owner of an `ata_reg` is the USER: that is what the key names
    -- (`user:<id>`) and what the runtime emitter records as the source entity.
    -- This pass used to name the conversion-event row instead, so one family had
    -- two spellings of its own provenance and neither matched the runtime.
    'User',
    CAST(e."userId" AS TEXT),
    'user:' || CAST(e."userId" AS TEXT)
FROM "AffiliateConversionEvent" e
WHERE e."eventType" = 'academy_registration'
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'ata_reg'
      AND existing."sourceOwner" = 'auth_register'
      AND existing."sourceEventId" = 'user:' || CAST(e."userId" AS TEXT)
);

-- ata_reg for learners the conversion ledger has no row for.
--
-- WHY THIS SECOND PASS IS NEEDED. `recordRegistrationConversion` only runs while
-- AFFILIATE_ATTRIBUTION_ENABLED is on, so every learner who registered while it
-- was off exists with no conversion row. Backfilling only from the ledger would
-- report those months as having had no registrations at all -- a zero with a
-- business meaning.
--
-- G4-H2 -- WHAT WAS WRONG, AND WHAT THE POPULATION IS NOW.
--
-- This pass used to read `FROM "User"` with NO PREDICATE AT ALL. On PREPROD that
-- backfilled 44 registrations from 44 accounts, of which NINE were staff: four
-- admins, three mentors and two support agents. Meanwhile the runtime emitter
-- fires in exactly one place -- POST /api/auth/register -- so an account created
-- by /api/admin/users or by the PREPROD QA operator provisioner produces no event
-- at all. History counted staff as customers, runtime did not, and every ratio
-- denominated in registrations changed meaning at the cutover instant.
--
-- G4-R4 -- POSITIVE AUTHORITY ONLY. THE NEGATIVE INFERENCE IS GONE.
--
-- The previous correction narrowed the population but kept a NEGATIVE tier: an
-- account was accepted if it held a `NotificationSettings` row and did NOT hold
-- a `StaffProfile`. The re-audit proved that unsafe, and the reason is that the
-- two axes belong to different owners:
--
--   * this platform's staff authority is `User.role` -- `hasRole`,
--     `requireAdmin` and `requireSupportAccess` all read it, and NOTHING reads
--     `StaffProfile` to decide backend authorization,
--   * `POST /api/admin/users` creates a staff-ROLE account and creates NO
--     `StaffProfile` at all,
--   * `PATCH /api/me/notification-settings` upserts a `NotificationSettings`
--     row for ANY authenticated principal.
--
-- So a staff account created by exactly the route this comment names as the
-- source of staff accounts acquired the positive artefact and escaped the
-- negative one the moment its owner saved a notification preference -- and was
-- counted as an ATA customer registration. Absence of evidence of staff is not
-- evidence of self-service.
--
-- WHAT REPLACES IT. Only artefacts that the self-service registration domain
-- EXCLUSIVELY produces, verified by exhaustive grep over `src/`:
--
--   TIER 1  AffiliateConversionEvent(eventType = 'academy_registration').
--           Written in exactly one place, `registration-attribution.ts`, inside
--           the registration transaction. Handled by the pass above.
--
--   TIER 2  AuditLog(action = 'AUTH_REGISTER', userId = u.id).
--           Written in exactly one place, `POST /api/auth/register`, naming the
--           REGISTERED user. `/api/admin/users` audits
--           `ADMIN_SERVICE_ACCOUNT_CREATED` against the ACTING ADMIN instead, so
--           a provisioned account never acquires this row. AuditLog is never
--           deleted by any production path.
--
-- WHY THIS SURVIVES THE CASES THAT BROKE THE OLD PREDICATE:
--
--   * an admin-created staff account, with or without a `StaffProfile`, with or
--     without notification settings, has no AUTH_REGISTER row and is NOT
--     counted -- role is never consulted, so there is nothing to evade,
--   * a learner who self-registered and was LATER PROMOTED to staff keeps their
--     AUTH_REGISTER row and IS still counted, because origin is historical and
--     role is current. §46 requires exactly that, and a role-based exclusion --
--     the obvious "fix" -- would have broken it.
--
-- WHAT IS DELIBERATELY NOT BACKFILLED. An account with neither artefact has an
-- origin this database cannot prove. §49 is explicit that uncertainty must not
-- be recorded as a self-service registration, so no event is written, the User
-- and its enrollment remain visible everywhere else, and the analytics
-- availability block declares the coverage limitation rather than showing a
-- number as if it were complete.
--
-- `NotificationSettings` is now referenced NOWHERE in this migration.
--
-- The key is identical to the pass above, so a learner covered there cannot be
-- inserted twice. occurredAt is the account's own creation time, which is the
-- registration instant by definition, normalised by the rule in the header.
--
-- G4-R2 -- THIS PASS ALSO CARRIES THE LEARNER'S FROZEN ATTRIBUTION.
--
-- It used to project `ata_reg` with a NULL `acquisitionClickId` even when
-- `AffiliateAttribution` held a frozen decision for that learner, because only
-- the conversion-ledger pass above copied those columns. Every registration
-- proven by an audit row therefore looked ORGANIC to the ledger, whatever the
-- attribution table said -- which would have made `attributionCoverageRate`
-- understate coverage, emptied the `attributed` scope, and left the acquisition
-- surface unable to see conversions that provably came from a tracked click.
--
-- The LEFT JOIN reads the ACCEPTED attribution authority and copies the decision
-- it already froze at registration. It invents nothing: a learner with no
-- attribution row still projects NULL, which is what organic means.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId",
    "acquisitionClickId", "attributionId",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'ata_reg',
    CASE WHEN typeof(u."createdAt") = 'text' THEN strftime('%s', u."createdAt") * 1000
         ELSE CAST(u."createdAt" AS INTEGER) END,
    'backfill',
    u."id",
    at."selectedClickId",
    at."id",
    'auth_register',
    'User',
    CAST(u."id" AS TEXT),
    'user:' || CAST(u."id" AS TEXT)
FROM "User" u
LEFT JOIN "AffiliateAttribution" at ON at."userId" = u."id"
-- G4-H6 -- SET-BASED, NOT CORRELATED, AND THE DIFFERENCE IS QUADRATIC.
--
-- Written as `EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."userId" = u."id" ...)`
-- this predicate cost 3.5 seconds of the 10.4-second backfill at 16k learners,
-- because `AuditLog` carries no index on `userId` or `action`, so the plan was
-- `CORRELATED SCALAR SUBQUERY -> SCAN a`: one full scan of the audit log FOR EVERY
-- USER ROW. That is O(users x auditRows) and it degrades quadratically, which is
-- exactly the shape a bigger timeout would have hidden rather than fixed.
--
-- `IN (SELECT ...)` lets SQLite build one transient index over each set and probe
-- it per user, so every source table is read ONCE. Migration 47 deliberately
-- alters no existing table, so adding an index to `AuditLog` was not an option
-- here -- and it is not needed: the set-based form is index-independent.
--
-- G4-R4 made this predicate SMALLER, not larger: one positive set membership.
WHERE u."id" IN (
    SELECT a."userId" FROM "AuditLog" a
    WHERE a."action" = 'AUTH_REGISTER' AND a."userId" IS NOT NULL
)
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" g
    WHERE g."eventType" = 'ata_reg'
      AND g."sourceOwner" = 'auth_register'
      AND g."sourceEventId" = 'user:' || CAST(u."id" AS TEXT)
);

-- curriculum_enrollment.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'curriculum_enrollment',
    CASE WHEN typeof(en."enrolledAt") = 'text' THEN strftime('%s', en."enrolledAt") * 1000
         ELSE CAST(en."enrolledAt" AS INTEGER) END,
    'backfill',
    en."userId",
    en."id",
    'curriculum_enrollment',
    'UserCurriculumEnrollment',
    CAST(en."id" AS TEXT),
    'enrollment:' || CAST(en."id" AS TEXT)
FROM "UserCurriculumEnrollment" en
WHERE NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'curriculum_enrollment'
      AND existing."sourceOwner" = 'curriculum_enrollment'
      AND existing."sourceEventId" = 'enrollment:' || CAST(en."id" AS TEXT)
);

-- level_started.
--
-- G4-H1 -- A PROGRESS ROW IS NOT A START, AND ONE FAMILY PROVES IT.
--
-- This pass used to backfill a `level_started` for EVERY `UserLevelProgress` row.
-- Three code paths create those rows and only one of them is a start:
--
--   * level-state.ts `runStartTransaction` -- the learner (or the trusted Pocket
--     registration reconciliation acting for them) explicitly starts the current
--     level. This is a real start transition and it emits `level_started`.
--
--   * checkpoint-verification.ts -- a FINANCIAL CHECKPOINT verification reached
--     `met`. It creates the `in_progress` row the completion primitive requires
--     and hands straight over. It is scaffolding created in the same breath as
--     the completion, not a start.
--
--   * staging-attestation.ts -- an OPERATOR attests a financial checkpoint, with
--     `actorId: null` precisely because the learner did not do it. Same shape.
--
-- The domain settles it: `runStartTransaction` REFUSES a financial checkpoint
-- outright (`LEVEL_START_CHECKPOINT_UNVERIFIED` -- "it is not a learning level,
-- it cannot be started"), and both non-start creators operate EXCLUSIVELY on
-- financial checkpoint levels. So a progress row on a `financial_checkpoint`
-- level was never explicitly started, and inventing a start for it would be a
-- false product history -- which §7 of the fix brief forbids more strongly than
-- it wants a tidy chart.
--
-- Excluding them here is what makes the backfill agree with the runtime, and it
-- is what stops a per-level completion rate exceeding 100%. The rate itself is
-- additionally computed as a subset ratio -- see analytics/queries.ts.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "levelDefinitionId", "levelNumber",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'level_started',
    CASE WHEN typeof(p."startedAt") = 'text' THEN strftime('%s', p."startedAt") * 1000
         ELSE CAST(p."startedAt" AS INTEGER) END,
    'backfill',
    en."userId",
    p."enrollmentId",
    p."levelDefinitionId",
    ld."levelNumber",
    'curriculum_level_progress',
    'UserLevelProgress',
    CAST(p."id" AS TEXT),
    'progress:' || CAST(p."id" AS TEXT)
FROM "UserLevelProgress" p
JOIN "UserCurriculumEnrollment" en ON en."id" = p."enrollmentId"
JOIN "LevelDefinition" ld ON ld."id" = p."levelDefinitionId"
WHERE ld."type" <> 'financial_checkpoint'
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'level_started'
      AND existing."sourceOwner" = 'curriculum_level_progress'
      AND existing."sourceEventId" = 'progress:' || CAST(p."id" AS TEXT)
);

-- level_completed.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "levelDefinitionId", "levelNumber",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'level_completed',
    CASE WHEN typeof(p."completedAt") = 'text' THEN strftime('%s', p."completedAt") * 1000
         ELSE CAST(p."completedAt" AS INTEGER) END,
    'backfill',
    en."userId",
    p."enrollmentId",
    p."levelDefinitionId",
    ld."levelNumber",
    'curriculum_level_progress',
    'UserLevelProgress',
    CAST(p."id" AS TEXT),
    'progress:' || CAST(p."id" AS TEXT)
FROM "UserLevelProgress" p
JOIN "UserCurriculumEnrollment" en ON en."id" = p."enrollmentId"
JOIN "LevelDefinition" ld ON ld."id" = p."levelDefinitionId"
WHERE p."status" = 'completed' AND p."completedAt" IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'level_completed'
      AND existing."sourceOwner" = 'curriculum_level_progress'
      AND existing."sourceEventId" = 'progress:' || CAST(p."id" AS TEXT)
);

-- academy_activation. DEFINED AS the enrollment's FIRST completed level, which
-- is a real product event with a real timestamp rather than an invented
-- engagement heuristic. One per enrollment, keyed on the enrollment, so a
-- second completion can never produce a second activation.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "levelDefinitionId", "levelNumber",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'academy_activation',
    CASE WHEN typeof(first_completion."completedAt") = 'text' THEN strftime('%s', first_completion."completedAt") * 1000
         ELSE CAST(first_completion."completedAt" AS INTEGER) END,
    'backfill',
    en."userId",
    first_completion."enrollmentId",
    first_completion."levelDefinitionId",
    ld."levelNumber",
    'curriculum_level_progress',
    'UserLevelProgress',
    CAST(first_completion."id" AS TEXT),
    'enrollment:' || CAST(first_completion."enrollmentId" AS TEXT)
FROM (
    SELECT p."id", p."enrollmentId", p."levelDefinitionId", p."completedAt",
           ROW_NUMBER() OVER (
               PARTITION BY p."enrollmentId"
               ORDER BY p."completedAt" ASC, p."id" ASC
           ) AS rn
    FROM "UserLevelProgress" p
    WHERE p."status" = 'completed' AND p."completedAt" IS NOT NULL
) AS first_completion
JOIN "UserCurriculumEnrollment" en ON en."id" = first_completion."enrollmentId"
JOIN "LevelDefinition" ld ON ld."id" = first_completion."levelDefinitionId"
WHERE first_completion.rn = 1
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'academy_activation'
      AND existing."sourceOwner" = 'curriculum_level_progress'
      AND existing."sourceEventId" = 'enrollment:' || CAST(first_completion."enrollmentId" AS TEXT)
);

-- assessment_completed. A SUBMITTED attempt, whether it passed or failed --
-- "how many learners finished the quiz" and "how many passed it" are different
-- questions and the ledger must be able to answer both.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "levelDefinitionId", "levelNumber", "metadata",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'assessment_completed',
    CASE WHEN typeof(a."submittedAt") = 'text' THEN strftime('%s', a."submittedAt") * 1000
         ELSE CAST(a."submittedAt" AS INTEGER) END,
    'backfill',
    a."userId",
    a."enrollmentId",
    a."levelDefinitionId",
    ld."levelNumber",
    json_object(
        'attemptNumber', a."attemptNumber",
        'passed', CASE WHEN a."status" = 'passed' THEN 1 ELSE 0 END
    ),
    'curriculum_assessment_attempt',
    'AssessmentAttempt',
    CAST(a."id" AS TEXT),
    'attempt:' || CAST(a."id" AS TEXT)
FROM "AssessmentAttempt" a
JOIN "LevelDefinition" ld ON ld."id" = a."levelDefinitionId"
WHERE a."submittedAt" IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'assessment_completed'
      AND existing."sourceOwner" = 'curriculum_assessment_attempt'
      AND existing."sourceEventId" = 'attempt:' || CAST(a."id" AS TEXT)
);

-- report_submitted. firstSubmittedAt, not submittedAt: a resubmission after a
-- rejection must not move the learner's original submission into a later period
-- and silently change a past month's numbers.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "levelDefinitionId", "levelNumber",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'report_submitted',
    CASE WHEN typeof(s."firstSubmittedAt") = 'text' THEN strftime('%s', s."firstSubmittedAt") * 1000
         ELSE CAST(s."firstSubmittedAt" AS INTEGER) END,
    'backfill',
    s."userId",
    s."enrollmentId",
    s."levelDefinitionId",
    ld."levelNumber",
    'curriculum_report_submission',
    'ReportSubmission',
    CAST(s."id" AS TEXT),
    'submission:' || CAST(s."id" AS TEXT)
FROM "ReportSubmission" s
JOIN "LevelDefinition" ld ON ld."id" = s."levelDefinitionId"
WHERE s."firstSubmittedAt" IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'report_submitted'
      AND existing."sourceOwner" = 'curriculum_report_submission'
      AND existing."sourceEventId" = 'submission:' || CAST(s."id" AS TEXT)
);

-- report_approved. Keyed on the SUBMISSION, not the review row: a submission is
-- approved once, and keying on the review would let a second approval of the
-- same work produce a second business event.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "levelDefinitionId", "levelNumber",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'report_approved',
    CASE WHEN typeof(r."reviewedAt") = 'text' THEN strftime('%s', r."reviewedAt") * 1000
         ELSE CAST(r."reviewedAt" AS INTEGER) END,
    'backfill',
    s."userId",
    s."enrollmentId",
    s."levelDefinitionId",
    ld."levelNumber",
    'curriculum_report_review',
    'ReportReview',
    CAST(r."id" AS TEXT),
    'submission:' || CAST(s."id" AS TEXT)
FROM "ReportReview" r
JOIN "ReportSubmission" s ON s."id" = r."submissionId"
JOIN "LevelDefinition" ld ON ld."id" = s."levelDefinitionId"
WHERE r."decision" = 'approved'
  AND r."id" = (
      SELECT MIN(r2."id") FROM "ReportReview" r2
      WHERE r2."submissionId" = r."submissionId" AND r2."decision" = 'approved'
  )
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'report_approved'
      AND existing."sourceOwner" = 'curriculum_report_review'
      AND existing."sourceEventId" = 'submission:' || CAST(s."id" AS TEXT)
);

-- mentor_review_submitted -- PARTIAL BY NECESSITY, see the header. Only rows
-- still awaiting review can be reconstructed, because for those lastProgressAt
-- IS the moment the learner submitted. An approved level's submission instant
-- was never recorded and is not invented here.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "levelDefinitionId", "levelNumber",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'mentor_review_submitted',
    CASE WHEN typeof(COALESCE(p."lastProgressAt", p."startedAt")) = 'text' THEN strftime('%s', COALESCE(p."lastProgressAt", p."startedAt")) * 1000
         ELSE CAST(COALESCE(p."lastProgressAt", p."startedAt") AS INTEGER) END,
    'backfill',
    en."userId",
    p."enrollmentId",
    p."levelDefinitionId",
    ld."levelNumber",
    'curriculum_mentor_review',
    'UserLevelProgress',
    CAST(p."id" AS TEXT),
    'progress:' || CAST(p."id" AS TEXT)
FROM "UserLevelProgress" p
JOIN "UserCurriculumEnrollment" en ON en."id" = p."enrollmentId"
JOIN "LevelDefinition" ld ON ld."id" = p."levelDefinitionId"
WHERE p."status" = 'pending_review'
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'mentor_review_submitted'
      AND existing."sourceOwner" = 'curriculum_mentor_review'
      AND existing."sourceEventId" = 'progress:' || CAST(p."id" AS TEXT)
);

-- mentor_review_approved. The completion method recorded on the progress row is
-- the durable fact that a mentor approved it.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "enrollmentId",
    "levelDefinitionId", "levelNumber",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'mentor_review_approved',
    CASE WHEN typeof(p."completedAt") = 'text' THEN strftime('%s', p."completedAt") * 1000
         ELSE CAST(p."completedAt" AS INTEGER) END,
    'backfill',
    en."userId",
    p."enrollmentId",
    p."levelDefinitionId",
    ld."levelNumber",
    'curriculum_mentor_review',
    'UserLevelProgress',
    CAST(p."id" AS TEXT),
    'progress:' || CAST(p."id" AS TEXT)
FROM "UserLevelProgress" p
JOIN "UserCurriculumEnrollment" en ON en."id" = p."enrollmentId"
JOIN "LevelDefinition" ld ON ld."id" = p."levelDefinitionId"
WHERE p."status" = 'completed'
  AND p."completedAt" IS NOT NULL
  AND p."completionMethod" = 'mentor_completion'
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'mentor_review_approved'
      AND existing."sourceOwner" = 'curriculum_mentor_review'
      AND existing."sourceEventId" = 'progress:' || CAST(p."id" AS TEXT)
);

-- pocket_reg. Keyed on the POCKET PLAYER, which is the provider-side identity
-- the idempotency contract names, and not on the local row id -- so the key
-- means the same thing to a future provider reconciliation as it does here.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId",
    "pocketTraderIdentityId", "provider",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'pocket_reg',
    CASE WHEN typeof(t."boundAt") = 'text' THEN strftime('%s', t."boundAt") * 1000
         ELSE CAST(t."boundAt" AS INTEGER) END,
    'backfill',
    t."userId",
    t."id",
    'pocket',
    'pocket_identity_binding',
    'PocketTraderIdentity',
    CAST(t."id" AS TEXT),
    'pocket:player:' || t."pocketUserId"
FROM "PocketTraderIdentity" t
WHERE t."source" = 'registration_postback'
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'pocket_reg'
      AND existing."sourceOwner" = 'pocket_identity_binding'
      AND existing."sourceEventId" = 'pocket:player:' || t."pocketUserId"
);

-- dep. Sourced from the provider event table, which owns the one-first-deposit-
-- per-player invariant, and only for rows that have been MATCHED to a learner:
-- a deposit whose owner is unknown is not yet a business fact about anybody,
-- and the pending rows remain visible in the ingress-health surface instead.
INSERT INTO "GrowthEvent" (
    "eventId", "eventType", "occurredAt", "origin", "userId", "provider",
    "amount", "currencyCode", "currencyStatus",
    "sourceOwner", "sourceEntityType", "sourceEntityId", "sourceEventId"
)
SELECT
    lower(hex(randomblob(20))),
    'dep',
    CASE WHEN typeof(pe."firstReceivedAt") = 'text' THEN strftime('%s', pe."firstReceivedAt") * 1000
         ELSE CAST(pe."firstReceivedAt" AS INTEGER) END,
    'backfill',
    pe."matchedUserId",
    'pocket',
    pe."normalizedAmount",
    pe."currencyCode",
    pe."currencyStatus",
    'pocket_first_deposit',
    'PocketProviderEvent',
    CAST(pe."id" AS TEXT),
    'pocket:player:' || pe."pocketPlayerId"
FROM "PocketProviderEvent" pe
WHERE pe."eventType" = 'first_deposit'
  AND pe."status" = 'matched'
  AND pe."matchedUserId" IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEvent" existing
    WHERE existing."eventType" = 'dep'
      AND existing."sourceOwner" = 'pocket_first_deposit'
      AND existing."sourceEventId" = 'pocket:player:' || pe."pocketPlayerId"
);

-- rdep is NOT backfilled and cannot be: no redeposit has ever been recorded,
-- because Pocket supplies no event identifier that could tell one apart from a
-- redelivery. This absence is reported as unresolved by the analytics layer and
-- never as a count of zero.

-- The outbox is populated for every backfilled event so that a future consumer
-- can replay history rather than starting from whatever happened to be next.
-- availableAt is the event's own occurrence time, so a dispatcher that ever runs
-- processes reconstructed history in the order it actually happened.
--
-- G4-M1 -- THIS STATEMENT USED TO BE THE ONE UNGUARDED ONE.
--
-- The previous wave claimed "every backfill statement is guarded, so the
-- migration is deterministic under replay". Fourteen of fifteen were. This one
-- had no NOT EXISTS, so replaying the backfill against a database that already
-- held backfilled rows failed with
-- `UNIQUE constraint failed: GrowthEventOutbox.growthEventId`. The shipped
-- integration test could not see it because its fixture was migrated while empty,
-- so the backfill produced nothing and its single replay had nothing to collide
-- with -- it stopped exactly one iteration short.
--
-- The transaction masked the defect for the migration runner. It did NOT mask it
-- for the thing the guards exist for: re-running the backfill logic to REBUILD
-- the projection after an event was lost. That repair aborted here.
--
-- The guard is on `growthEventId`, which is the outbox's own unique key, so a
-- replay skips exactly the items it already created and still creates the ones it
-- has not. It does not weaken anything: the unique index, the foreign key and the
-- event relationship all remain, so an outbox row pointing at a conflicting event
-- is still refused rather than silently accepted.
INSERT INTO "GrowthEventOutbox" ("growthEventId", "eventType", "availableAt")
SELECT g."id", g."eventType", g."occurredAt"
FROM "GrowthEvent" g
WHERE g."origin" = 'backfill'
AND NOT EXISTS (
    SELECT 1 FROM "GrowthEventOutbox" o WHERE o."growthEventId" = g."id"
);
