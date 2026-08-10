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
export const EXPECTED_MIGRATION_COUNT = 45;

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
