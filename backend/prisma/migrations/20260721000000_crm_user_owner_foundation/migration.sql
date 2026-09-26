-- CRM Learner Owner v1: one current owner per learner, or null.
--
-- Purely additive. One new table, two foreign keys, one index. No existing
-- table is rebuilt, no existing row is modified, no data is backfilled and no
-- enum is mutated, so this migration cannot alter accepted behaviour. Every
-- current learner therefore starts in the pristine, never-mutated state, which
-- is the ABSENCE of a CrmUserOwner row (owner null, version 0) — no initial
-- owner row is created here.
--
-- `userId` is the PRIMARY KEY: a learner has at most one owner-state row. The
-- learner foreign key is ON DELETE RESTRICT so deleting a learner that has an
-- owner-state row fails loudly instead of silently dropping it.
--
-- `ownerId` is NULLABLE and its foreign key is ON DELETE RESTRICT: an assigned
-- owner (a StaffProfile) cannot be deleted out from under a learner, while an
-- unassigned row (ownerId = null, version > 0) keeps no dangling reference.
-- ON UPDATE CASCADE matches the repository convention for actor/target
-- relations.
--
-- `version` defaults to 1 (the value written by the FIRST real assignment, when
-- the row is created). It is monotonic and never reset. Unassignment sets
-- ownerId = null and increments version. There is no row-deletion path in
-- Owner v1. There is deliberately no history, actorId, reason, comment,
-- deletedAt, workload or team column: current state only.
CREATE TABLE "CrmUserOwner" (
    "userId" INTEGER NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrmUserOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrmUserOwner_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Supports the owner-deletion RESTRICT lookup ("does this StaffProfile own any
-- learner?") and any future "learners owned by X" read.
CREATE INDEX "CrmUserOwner_ownerId_idx" ON "CrmUserOwner"("ownerId");
