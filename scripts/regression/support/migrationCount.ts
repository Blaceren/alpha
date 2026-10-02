/**
 * The canonical expected migration count, in exactly one place.
 *
 * WHY THIS FILE EXISTS. Before AFD-2 this number was written out longhand in
 * six assertions across four CRM regression suites, all of them pinned to 33
 * while the repository had already reached 36 — so those assertions had been
 * failing for three phases and no longer guarded anything. A count that lives
 * in one place is updated once per migration phase and stays true.
 *
 * AFD-3B2 finished the job: `curriculumReportRequiredWhenRegression` still held
 * its own copy of the number, pinned to 34 and failing for four phases, and now
 * imports this constant like everything else. There is no hand-written migration
 * count left in the repository.
 *
 * WHY IT IS NOT DERIVED FROM THE FILESYSTEM. Counting the directory and then
 * asserting the count matches the directory would always pass and prove
 * nothing. The value is deliberately typed by hand so that an unplanned
 * migration — one nobody intended to add — fails the gate.
 *
 * UPDATE IT when a phase adds a migration, in the same commit as the migration.
 *
 * PROGRAM STRUCTURE: 60 -> 61. One additive migration,
 * `20261002120000_program_structure`: four nullable columns (a module's chapter
 * number and title, a level's learner-facing kind, a question's rewatch
 * second) and two tables (LevelToolUnlock, LessonMediaAsset). Its one data
 * statement writes, for every version that already existed, the tool-unlock
 * rule those versions were read by; it rewrites no existing row.
 *
 * ACCOUNT RECOVERY: 59 -> 60. One additive migration,
 * `20261001120000_account_action_token`, which creates AccountActionToken and
 * its three indexes. It alters no existing table, so a Backend built before it
 * never queries the table and rollback is inert.
 *
 * THAT BUMP WAS MISSED IN ITS OWN COMMIT, which is exactly the failure this
 * file describes. The migration shipped on 2026-10-01 with the constant still
 * at 59; the vitest suite does not read it, the three regressions run for that
 * release do not either, and the seventeen that do were not run. Every one of
 * them failed its "every migration applied" check from that commit until this
 * one. Found the same day by the journal regression. The rule above stands; the
 * lesson is that a release with a migration runs the regressions that count
 * migrations, not only the ones about its feature.
 *
 * TOOLS-V2: 54 -> 59. Five additive migrations, one per tool slice that
 * stores anything, each bumping this constant in its own commit:
 *
 *   20260921120000_tool_trade_card        ToolTradeCard
 *   20260921180000_tool_trading_journal   ToolJournalEntry, ToolJournalViolation
 *   20260921200000_tool_risk_plan         ToolRiskPlan
 *   20260921220000_tool_entry_check       ToolEntryCheck
 *   20260921230000_news_calendar          NewsItem, ToolNewsPlan
 *
 * Each creates tables and indexes only, so a Backend built before it never
 * queries them and rollback is inert.
 *
 * LEARNER SESSION STORE: 53 -> 54. One additive migration,
 * `20260831120000_learner_session_store`, which creates UserSession and its
 * three indexes — including the partial unique index that makes "one live
 * session per user" a database constraint rather than an application habit.
 * It alters no existing table and rewrites no existing row, so a Backend built
 * before it never queries the table and rollback is inert.
 *
 * BUMPED IN THE SAME COMMIT AS THE MIGRATION, which is what this file's own
 * header asks for and what the previous five drifts failed to do.
 *
 * LEARNER-OPS AND COMMUNITY: 50 -> 53. THREE migrations, none of which bumped
 * this constant when it landed:
 *
 *   20260816000000_learner_operations_v1
 *   20260816120000_learner_ops_review_work_item_anchors
 *   20260816180000_community_v1
 *
 * THE FIFTH TIME THIS HAS DECAYED, and the first time it went unnoticed for a
 * different reason than before. The four CRM HTTP suites that read this value
 * could not START: they spawn `next dev --turbopack`, and this workspace's
 * node_modules is a farm of symlinks into /srv/ata/repos, so Turbopack failed
 * to resolve the Next package and the server never bound. A suite that cannot
 * run cannot go red, so the count drifted with nothing to report it.
 *
 * The runtime is fixed in the same closure. This is the correction that makes
 * the assertion start guarding again.
 *
 * G4 GROWTH FOUNDATION: 46 -> 47. One additive migration,
 * `20260813000000_growth_event_foundation`, which creates GrowthEvent,
 * GrowthEventOutbox and ProviderIngressEvent and backfills the ledger from the
 * owner tables. It alters no existing table and rewrites no existing row.
 *
 * IT WAS NOT BUMPED WHEN THE MIGRATION LANDED, and this file exists precisely
 * to stop that: five assertions across the Pocket suites read this constant,
 * so they had been failing on the accepted, deployed release with nobody
 * attributing the failure — the fourth time this exact decay has happened, and
 * the first time it survived a cutover. Corrected during the product-wide
 * deferred-work closure, which found it by running the suites and attributing
 * every failure rather than accepting a red suite as normal.
 *
 * AFFILIATE-PLATFORM-V1: 49 -> 50. ONE migration for the whole platform wave,
 * `20260815000000_affiliate_platform_v1`, deliberately not four: the five
 * capabilities it adds are not independent — a partner human must exist before
 * a tracking link can name one as its author, a terms version before a
 * qualification can point at one, a qualification before a commission can be
 * what it produced. Splitting them would create intermediate states in which a
 * foreign key names a table that is not there yet.
 *
 * It creates seven tables (AffiliatePartnerUser, AffiliateCampaignTerms,
 * AffiliateCpaQualification, AffiliateCommission, AffiliatePostbackEndpoint,
 * AffiliatePostbackDelivery, AffiliatePostbackAttempt) and rebuilds two:
 * AffiliateTrackingLink, so `createdByUserId` may be NULL when a PARTNER
 * created the link and a CHECK requires exactly one of the two creator axes;
 * and AffiliateConversionEvent, so `redeposit`/`pocket_redeposit` join the
 * vocabulary and the money CHECK covers both deposit families.
 *
 * IT CREATES NO MONEY. Not one commission, not one qualification, no backfill
 * of any kind for the conversions that already exist — §34 of the brief, obeyed
 * literally. Both rebuilds copy every existing row column-for-column.
 *
 * POCKET-DEP-RDEP-FINANCIAL-INGRESS-1: 48 -> 49. One migration,
 * `20260814120000_pocket_redeposit_financial_event`, which rebuilds
 * PocketProviderEvent to carry redeposits: it widens `eventType` to
 * ('first_deposit','redeposit'), adds the derived-identity and temporal columns
 * (providerEventKey, providerEventLocal, providerEventAt, providerEventAtRaw,
 * providerEventAtStatus), and REPLACES the compound unique
 * `(provider, eventType, pocketPlayerId)` with two PARTIAL unique indexes —
 * one keeping exactly one first_deposit per player, one keying redeposits on
 * the derived providerEventKey. Existing rows are preserved by the rebuild.
 *
 * THE INDEX CHANGE IS WHY THE COUNT ALONE WAS NOT ENOUGH THIS TIME. The Pocket
 * suite also names the required indexes explicitly, and the old compound unique
 * is deliberately gone, so that list was corrected in the same commit rather
 * than loosened — the same discipline this file records.
 *
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1: 47 -> 48. One migration,
 * `20260814000000_normalize_legacy_timestamp_storage`, which normalises 70
 * legacy TEXT datetime values in 19 columns to the integer epoch milliseconds
 * migration 47 established as canonical. It creates and drops one guard table
 * and performs no other DDL, adds no table, no column and no index, and deletes
 * nothing. Every UPDATE is guarded by `typeof(col) = 'text'`, so it is a no-op
 * on a fresh database and on a second run.
 *
 * THIS COUNT MOVING IS THE POINT OF THE ASSERTION. Three suites read it, and
 * they went red the moment migration 48 appeared — which is exactly the guard
 * working. It is corrected here deliberately, in the same commit as the
 * migration, rather than by relaxing the assertions.
 *
 * PHASE-G2 SUCCESSOR: 45 -> 46. One additive migration,
 * `20260811000000_assessment_successor_lineage`, which adds the nullable
 * `AssessmentVersion.predecessorVersionId` self-relation and its index. No
 * existing migration file is edited, no existing row is rewritten, and every
 * pre-existing AssessmentVersion keeps a NULL predecessor. This is the ONLY
 * change this phase makes to a Pocket- or agent-facing fixture: those suites
 * assert the canonical count, and the count legitimately moved.
 *
 * PHASE-G2 FOUNDATION: 44 -> 45. One additive migration,
 * `20260810000000_source_authority_resolution`, which adds the
 * SourceAuthorityResolution table and its indexes. No existing migration file
 * is edited and no existing row is rewritten.
 *
 * PHASE-G0 CORRECTION: 43 -> 44. One additive migration,
 * `20260808120000_authoring_foundation_corrections`, which adds the durable
 * video/assessment link table and the preview snapshot's video pin. The G0
 * migration file itself is untouched.
 *
 * PHASE-G0: 41 -> 43. TWO migrations, not one. The authoring foundation adds
 * `20260808000000_authoring_foundation`, and the constant was ALREADY one behind
 * before this phase started — `20260807000000_staging_attestation` landed
 * without bumping it, so the five assertions that read this value had been
 * failing on the accepted Phase-F base and were guarding nothing, exactly the
 * decay this file was created to stop. Correcting the drift here is what makes
 * them start guarding again.
 */
export const EXPECTED_MIGRATION_COUNT = 61;

/** Directory entries under prisma/migrations that are not migrations. */
export const NON_MIGRATION_ENTRIES = ["migration_lock.toml"] as const;

/**
 * The expected count with `excluded` migrations removed, for upgrade rehearsals
 * that build a "database as it was before this phase" fixture. Expressed
 * relative to the canonical total so it cannot drift away from it.
 */
export function expectedPriorMigrationCount(excluded: number): number {
  return EXPECTED_MIGRATION_COUNT - excluded;
}
