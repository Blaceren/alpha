-- Phase 5B.5b: durable provider-purge receipt for private report attachments.
--
-- Documented schema insufficiency that this single additive migration fixes:
-- the Phase 5B.1 ReportAttachment model has terminal 'rejected'/'deleted'
-- states and a 'deletedAt' tombstone time, but no column can durably record
-- whether the private provider object behind 'storageKey' was actually
-- removed. Without that receipt a failed provider delete would be
-- indistinguishable from a completed one, cleanup retry after a provider
-- failure could not be represented durably, and the retry scan would need
-- unbounded rescans of all historical tombstones. The scan columns
-- ('scanProvider', 'scanReference', 'scanCompletedAt') belong to the
-- antivirus verdict and 'deletedAt' is the logical tombstone time, not a
-- provider receipt.
--
-- 'storagePurgedAt' is NULL while the provider object may still exist and is
-- set exactly once after an idempotent provider delete succeeds. No V1 or
-- existing V2 table is altered destructively. A nullable SQLite ADD COLUMN is
-- additive and compatible with the custom migration runner (no semicolons
-- inside any statement or comment).
ALTER TABLE "ReportAttachment" ADD COLUMN "storagePurgedAt" DATETIME;

-- Bounded retention scan (initiated/uploaded/quarantined older than 24h).
CREATE INDEX "ReportAttachment_status_createdAt_idx"
ON "ReportAttachment"("status", "createdAt");

-- Bounded purge-retry scan over tombstoned rows whose provider object may
-- still exist. The partial index stays SQL-only by precedent because Prisma
-- cannot express SQLite partial indexes.
CREATE INDEX "ReportAttachment_purge_pending_idx"
ON "ReportAttachment"("status", "storagePurgedAt")
WHERE "storagePurgedAt" IS NULL AND "status" IN ('rejected', 'deleted');
