-- CRM User Notes v1: immutable append-only learner notes.
--
-- Purely additive. One new table, two foreign keys, two indexes. No existing
-- table is rebuilt, no existing row is modified, no data is backfilled and no
-- enum is mutated, so this migration cannot alter accepted behaviour.
--
-- Both foreign keys are ON DELETE RESTRICT: deleting a learner that has notes,
-- or a StaffProfile that authored notes, fails loudly instead of silently
-- orphaning or erasing operational history. ON UPDATE CASCADE matches the
-- repository convention for actor/target relations.
--
-- There is no updatedAt, deletedAt, visibility, pinned, category, caseId,
-- owner, team, version or author display-name snapshot: Notes v1 is
-- append-only, and the author's name is always resolved live through
-- StaffProfile.
CREATE TABLE "CrmUserNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmUserNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrmUserNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "StaffProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Exactly the keyset the list query walks: userId filter, then the
-- (createdAt DESC, id DESC) cursor tuple.
CREATE INDEX "CrmUserNote_userId_createdAt_id_idx" ON "CrmUserNote"("userId", "createdAt", "id");

CREATE INDEX "CrmUserNote_authorId_idx" ON "CrmUserNote"("authorId");
