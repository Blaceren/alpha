ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
UPDATE "User" SET "referralCode" = 'user-' || "id" WHERE "referralCode" IS NULL;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

ALTER TABLE "ExchangeAccount" ADD COLUMN "totalCommission" REAL NOT NULL DEFAULT 0;

CREATE TABLE "XpEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "sourceId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "XpEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "XpEvent_userId_createdAt_idx" ON "XpEvent"("userId", "createdAt");
CREATE INDEX "XpEvent_source_sourceId_idx" ON "XpEvent"("source", "sourceId");

DROP INDEX "PromocodeRedemption_promocodeId_userId_key";
CREATE INDEX "PromocodeRedemption_promocodeId_userId_idx" ON "PromocodeRedemption"("promocodeId", "userId");
