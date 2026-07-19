-- CRM Foundation Slice 1: staff identity axis.
--
-- Adds a StaffProfile identity linked 1:1 to an existing User, on a separate
-- StaffRole axis that does NOT extend UserRole. effectivePermissions are never
-- stored here. The server computes effectivePermissions from staffRole. The backfill maps the
-- existing service UserRole accounts to their CRM StaffRole once, is guarded by
-- NOT EXISTS so it is safe to re-run, and never creates a profile for learners
-- (role = user). No V1 / learner / progression / report model is touched.
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "staffRole" TEXT NOT NULL,
    "permissionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");

CREATE INDEX "StaffProfile_staffRole_idx" ON "StaffProfile"("staffRole");

INSERT INTO "StaffProfile" ("id", "userId", "displayName", "staffRole", "permissionVersion", "createdAt", "updatedAt")
SELECT
    lower(hex(randomblob(16))),
    "User"."id",
    CASE WHEN trim(coalesce("User"."name", '')) <> '' THEN "User"."name" ELSE 'Сотрудник' END,
    CASE "User"."role"
        WHEN 'admin' THEN 'crm_admin'
        WHEN 'support' THEN 'support'
        WHEN 'mentor' THEN 'mentor'
        WHEN 'moderator' THEN 'moderator'
        WHEN 'news_editor' THEN 'content_manager'
    END,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
WHERE "User"."role" IN ('admin', 'support', 'mentor', 'moderator', 'news_editor')
  AND NOT EXISTS (SELECT 1 FROM "StaffProfile" "sp" WHERE "sp"."userId" = "User"."id");
