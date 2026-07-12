ALTER TABLE "ExchangeAccount" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE "ExchangeAccount" ADD COLUMN "externalAccountId" TEXT;
ALTER TABLE "ExchangeAccount" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'not_connected';
ALTER TABLE "ExchangeAccount" ADD COLUMN "depositAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "ExchangeAccount" ADD COLUMN "tradesCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExchangeAccount" ADD COLUMN "lastVerifiedAt" DATETIME;
ALTER TABLE "ExchangeAccount" ADD COLUMN "verifiedAt" DATETIME;
ALTER TABLE "ExchangeAccount" ADD COLUMN "rejectionReason" TEXT;
CREATE INDEX "ExchangeAccount_provider_status_idx" ON "ExchangeAccount"("provider", "status");
CREATE INDEX "ExchangeAccount_externalAccountId_idx" ON "ExchangeAccount"("externalAccountId");

PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PostbackEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "exchangeAccountId" INTEGER,
  "externalEventId" TEXT,
  "type" TEXT NOT NULL,
  "eventType" TEXT NOT NULL DEFAULT '',
  "amount" REAL,
  "status" TEXT NOT NULL,
  "rawPayload" TEXT NOT NULL,
  "payload" JSONB,
  "rejectionReason" TEXT,
  "processedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostbackEvent_exchangeAccountId_fkey" FOREIGN KEY ("exchangeAccountId") REFERENCES "ExchangeAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PostbackEvent" ("id", "exchangeAccountId", "externalEventId", "type", "eventType", "amount", "status", "rawPayload", "createdAt")
SELECT "id", "exchangeAccountId", "externalEventId", "type", "type", "amount", "status", "rawPayload", "createdAt" FROM "PostbackEvent";
DROP TABLE "PostbackEvent";
ALTER TABLE "new_PostbackEvent" RENAME TO "PostbackEvent";
CREATE UNIQUE INDEX "PostbackEvent_externalEventId_key" ON "PostbackEvent"("externalEventId");
PRAGMA foreign_keys=ON;
