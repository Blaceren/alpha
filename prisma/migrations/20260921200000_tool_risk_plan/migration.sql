-- TOOLS-V2 — Risk Calculator (L15), the third tool of the rebuilt block.
--
-- ADDITIVE, AND NOTHING ELSE. One CREATE TABLE and one index. No existing table
-- is altered, no existing row is rewritten, nothing is deleted. A Backend
-- release built before this migration never queries the table, which keeps
-- that release a valid rollback target after the table has rows.
--
-- HAND-WRITTEN for the same reason as every recent migration here.
--
-- A RISK PLAN IS KEPT IN VERSIONS. Every save adds a row and the newest row is
-- the plan in force. Rows are never edited in place and never deleted by the
-- application, so the table has no updatedAt.
--
-- THE CAPITAL IS THE LEARNER'S OWN NUMBER, typed as the plan's input, in minor
-- units. It is never read from Pocket and is not a balance. The share of risk
-- per trade is one of the four the lessons teach. Timestamps are integer epoch
-- milliseconds with typeof CHECKs, as everywhere else.
CREATE TABLE "ToolRiskPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "capitalMinor" INTEGER NOT NULL CHECK (typeof("capitalMinor") = 'integer' AND "capitalMinor" BETWEEN 100 AND 100000000),
    "payoutPercent" INTEGER NOT NULL CHECK (typeof("payoutPercent") = 'integer' AND "payoutPercent" BETWEEN 1 AND 100),
    "riskPercent" INTEGER NOT NULL CHECK (typeof("riskPercent") = 'integer' AND "riskPercent" IN (1, 2, 3, 5)),
    "dailyLimitPercent" INTEGER NOT NULL CHECK (typeof("dailyLimitPercent") = 'integer' AND "dailyLimitPercent" BETWEEN 1 AND 100),
    "scenario" TEXT NOT NULL CHECK (length(trim("scenario")) > 0),
    "cancelCondition" TEXT NOT NULL CHECK (length(trim("cancelCondition")) > 0),
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000) CHECK (typeof("createdAt") = 'integer'),
    CONSTRAINT "ToolRiskPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The learner's versions, newest first.
CREATE INDEX "ToolRiskPlan_userId_createdAt_idx" ON "ToolRiskPlan"("userId", "createdAt");
