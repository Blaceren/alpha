-- CRM Learner Owner History (OH-1): one immutable row per real owner transition.
--
-- Purely additive. One new table, four foreign keys, one unique index and three
-- Restrict-support indexes. No existing table is rebuilt, no existing row is
-- modified, no data is backfilled and no enum is mutated, so this migration
-- cannot alter accepted behaviour. History begins AFTER this migration: every
-- learner starts with zero history rows and no synthetic transition is created.
-- CrmUserOwner and its version semantics are left exactly as they are.
--
-- id is the primary key. userId is the learner whose ownership changed.
-- actorStaffId is the authenticated StaffProfile that made the change and is
-- NOT NULL, so attribution is mandatory and is never supplied by a request body.
-- previousOwnerId and nextOwnerId point to StaffProfile when non-null. A null
-- previous means assigned-from-unowned and a null next means unassigned.
-- ownerVersion is the RESULTING current owner version after the transition.
--
-- All four foreign keys are ON DELETE RESTRICT: deleting the learner, the actor
-- or either referenced owner fails loudly instead of silently erasing the
-- record or its attribution. ON UPDATE CASCADE matches the repository
-- convention for actor/target relations. SetNull is deliberately NOT used for
-- any column because it would erase attribution the record exists to preserve.
--
-- The CHECK constraint makes the DATABASE, not only TypeScript, reject an
-- invalid transition. It rejects null to null and A to A, and permits exactly
-- three shapes: assign (previous NULL, next NOT NULL), unassign (previous NOT
-- NULL, next NULL), and reassign (both NOT NULL and different).
CREATE TABLE "CrmUserOwnerHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "actorStaffId" TEXT NOT NULL,
    "previousOwnerId" TEXT,
    "nextOwnerId" TEXT,
    "ownerVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmUserOwnerHistory_transition_check" CHECK (
        ("previousOwnerId" IS NULL AND "nextOwnerId" IS NOT NULL)
        OR ("previousOwnerId" IS NOT NULL AND "nextOwnerId" IS NULL)
        OR ("previousOwnerId" IS NOT NULL AND "nextOwnerId" IS NOT NULL AND "previousOwnerId" <> "nextOwnerId")
    ),
    CONSTRAINT "CrmUserOwnerHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrmUserOwnerHistory_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrmUserOwnerHistory_previousOwnerId_fkey" FOREIGN KEY ("previousOwnerId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrmUserOwnerHistory_nextOwnerId_fkey" FOREIGN KEY ("nextOwnerId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- A resulting owner version is claimed by at most one history row per learner.
-- This is the concurrency backstop AND the keyset the list query walks: a
-- userId filter, then ownerVersion DESC for newest-transition-first, with no
-- tie-breaker needed because ownerVersion is unique and monotonic per learner.
CREATE UNIQUE INDEX "CrmUserOwnerHistory_userId_ownerVersion_key" ON "CrmUserOwnerHistory"("userId", "ownerVersion");

-- Support the Restrict deletion lookups (does any history name this staff) across
-- all three attribution axes, matching the CrmUserOwner and CrmUserNote
-- convention of indexing each Restrict-referenced staff foreign key.
CREATE INDEX "CrmUserOwnerHistory_actorStaffId_idx" ON "CrmUserOwnerHistory"("actorStaffId");
CREATE INDEX "CrmUserOwnerHistory_previousOwnerId_idx" ON "CrmUserOwnerHistory"("previousOwnerId");
CREATE INDEX "CrmUserOwnerHistory_nextOwnerId_idx" ON "CrmUserOwnerHistory"("nextOwnerId");
