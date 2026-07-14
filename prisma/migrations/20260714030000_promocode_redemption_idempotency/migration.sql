-- Additive parent keys used only to enforce durable request ownership.
-- The redemption key starts with the already-unique id and therefore does not
-- restrict multiple redemptions by the same user for one promocode.
CREATE UNIQUE INDEX "PromocodeRedemption_id_userId_promocodeId_key"
ON "PromocodeRedemption"("id", "userId", "promocodeId");

CREATE UNIQUE INDEX "XPTransaction_id_userId_key"
ON "XPTransaction"("id", "userId");

-- Durable request identity for concurrency-safe, exactly replayable redemption.
-- Non-XP reward types store NULL xpAwarded while XP rewards must remain positive.
CREATE TABLE "PromocodeRedemptionRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "promocodeId" INTEGER NOT NULL,
    "redemptionId" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL CHECK (
        length("requestId") BETWEEN 8 AND 128
        AND "requestId" GLOB '[A-Za-z0-9]*'
    ),
    "requestFingerprint" TEXT NOT NULL CHECK (
        "requestFingerprint" GLOB 'sha256:[0-9a-f]*'
        AND length("requestFingerprint") = 71
    ),
    "xpAwarded" INTEGER CHECK ("xpAwarded" IS NULL OR "xpAwarded" > 0),
    "v2XpTransactionId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromocodeRedemptionRequest_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PromocodeRedemptionRequest_promocodeId_fkey"
        FOREIGN KEY ("promocodeId") REFERENCES "Promocode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PromocodeRedemptionRequest_redemptionId_userId_promocodeId_fkey"
        FOREIGN KEY ("redemptionId", "userId", "promocodeId")
        REFERENCES "PromocodeRedemption" ("id", "userId", "promocodeId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PromocodeRedemptionRequest_v2XpTransactionId_userId_fkey"
        FOREIGN KEY ("v2XpTransactionId", "userId")
        REFERENCES "XPTransaction" ("id", "userId")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PromocodeRedemptionRequest_redemptionId_key"
ON "PromocodeRedemptionRequest"("redemptionId");

CREATE UNIQUE INDEX "PromocodeRedemptionRequest_v2XpTransactionId_key"
ON "PromocodeRedemptionRequest"("v2XpTransactionId");

CREATE UNIQUE INDEX "PromocodeRedemptionRequest_userId_requestId_key"
ON "PromocodeRedemptionRequest"("userId", "requestId");

CREATE UNIQUE INDEX "PromocodeRedemptionRequest_redemptionId_userId_promocodeId_key"
ON "PromocodeRedemptionRequest"("redemptionId", "userId", "promocodeId");

CREATE UNIQUE INDEX "PromocodeRedemptionRequest_v2XpTransactionId_userId_key"
ON "PromocodeRedemptionRequest"("v2XpTransactionId", "userId");

CREATE INDEX "PromocodeRedemptionRequest_promocodeId_createdAt_idx"
ON "PromocodeRedemptionRequest"("promocodeId", "createdAt");

CREATE INDEX "PromocodeRedemptionRequest_userId_createdAt_idx"
ON "PromocodeRedemptionRequest"("userId", "createdAt");
