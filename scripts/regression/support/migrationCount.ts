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
 */
export const EXPECTED_MIGRATION_COUNT = 40;

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
