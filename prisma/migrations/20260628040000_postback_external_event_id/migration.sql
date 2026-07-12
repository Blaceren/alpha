ALTER TABLE "PostbackEvent" ADD COLUMN "externalEventId" TEXT;

CREATE UNIQUE INDEX "PostbackEvent_externalEventId_key" ON "PostbackEvent"("externalEventId");
