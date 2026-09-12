-- AFD-5B1 -- event-date analytics read indexes.
--
-- INDEX-ONLY AND ADDITIVE. This migration creates two indexes and does nothing
-- else. It adds no table, no column, no constraint and no default, it rewrites
-- no row, and it changes the semantics of no existing entity. Dropping both
-- indexes returns the schema to exactly its migration 39 shape, which is what
-- makes the rollback rehearsal meaningful.
--
-- NOTE ON STYLE. No comment in this file contains a statement separator, because
-- the repository migration runner splits this file on that character.
--
-- WHY THESE TWO AND NOT MORE. Every other analytics query was MEASURED with
-- EXPLAIN QUERY PLAN against a copied database at migration 39 and already
-- resolves through a covering index -- clicks by classification and time, clicks
-- by tracking link and time, conversion events by type and time, and provider
-- events by status and first-received time. Those needed nothing and got
-- nothing. Only the two plans below were unsafe.

-- MEASURED BEFORE: SCAN PocketTraderIdentity
--
-- The trusted Pocket-registration metric counts rows of this table by boundAt.
-- At migration 39 the table carried indexes on userId, pocketUserId and clickId
-- only, so a date-ranged count had no index to use and read every row. This
-- table grows by one row for every Pocket registration the platform ever earns,
-- and the metric is recomputed for every summary, every breakdown row and every
-- bucket of every time series, so the full scan was the one genuinely unbounded
-- read in the phase.
--
-- The leading source column matches the query, which filters the provenance
-- explicitly rather than relying on the CHECK constraint that currently permits
-- a single value. When a second provenance is one day added, this index still
-- serves the narrowed query.
CREATE INDEX "PocketTraderIdentity_source_boundAt_idx"
ON "PocketTraderIdentity"("source", "boundAt");

-- MEASURED BEFORE: SEARCH PocketProviderEvent USING INDEX
--   PocketProviderEvent_status_firstReceivedAt_idx (status=?)
--
-- Conflicting deposit events are counted by conflictDetectedAt, which is a
-- DIFFERENT column from the one the existing composite index carries. The status
-- equality was index-driven but the date range was not, so every quarantined row
-- was examined regardless of the period asked about. Conflicts are expected to
-- be rare, and this index is what keeps that an expectation rather than a
-- dependency: a provider fault that produced many of them must not also make
-- every analytics response slow.
CREATE INDEX "PocketProviderEvent_status_conflictDetectedAt_idx"
ON "PocketProviderEvent"("status", "conflictDetectedAt");
