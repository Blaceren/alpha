# Curriculum V2 packages (CV-1)

A **package** is a versioned, human-reviewable JSON description of one curriculum
version — structure, content, assessment, report definitions — plus the
provenance of every content element. It is the only supported way to import a
curriculum outside the admin authoring API.

## Files

| Path | Purpose |
|---|---|
| `src/lib/curriculum/stable-code.ts` | the ONE canonical stable-code contract |
| `src/lib/curriculum/package/schema.ts` | package format (`ata.curriculum.package/1`) |
| `src/lib/curriculum/package/fingerprint.ts` | deterministic sha256 over the semantic projection |
| `src/lib/curriculum/package/validate.ts` | strict validation |
| `src/lib/curriculum/package/import.ts` | transactional, idempotent importer |
| `scripts/curriculum/importCurriculumPackage.ts` | CLI |
| `scripts/curriculum/fingerprintCurriculumPackage.ts` | fingerprint / `--check` |
| `curriculum/packages/*.json` | the packages themselves |

## Stable codes — read this first

Level stable codes MUST match `STABLE_CODE_PATTERN`:

```
^v2\.l(\d{3})\.[a-z0-9]+(?:-[a-z0-9]+)*$      e.g. v2.l002.kak-ustroen-put
```

`NNN` must equal the level's `levelNumber`.

This matters more than it looks. `GET /api/curriculum/v2/current` does **not**
validate stable codes — it returns whatever is stored. But
`GET /api/curriculum/v2/levels/{stableCode}/content` parses the code with that
pattern *before any content lookup*, so a non-conformant code makes every level's
content unreachable while the home and path screens look perfectly healthy. That
is exactly the defect CI-2 shipped and CV-1 closes.

Always go through `src/lib/curriculum/stable-code.ts`. Never re-declare the regex.

## Usage

```bash
# validate only (no database needed)
npm run curriculum:package:import -- --package curriculum/packages/<file>.json --validate-only --json

# recompute the fingerprint after editing a package
npm run curriculum:package:fingerprint -- curriculum/packages/<file>.json

# verify a package has not drifted
npm run curriculum:package:fingerprint -- curriculum/packages/<file>.json --check

# dry run, then import, against an EXPLICIT synthetic database
npm run curriculum:package:import -- --package curriculum/packages/<file>.json --database file:/abs/path.sqlite --dry-run
npm run curriculum:package:import -- --package curriculum/packages/<file>.json --database file:/abs/path.sqlite
```

`--database` is mandatory — there is no default target. The live DEV database,
and any symlink resolving to it, are refused.

## Guarantees

- All validation completes before the transaction opens.
- One transaction; any failure rolls back every row.
- Re-importing the identical package is a no-op.
- The same `(curriculumCode, versionNumber)` with different content is rejected
  as drift — bump the version instead.
- Published and active versions are immutable.
- The importer never publishes, activates, enrols, or writes learner rows.
- Correct answers live only in `QuestionDefinition.correctAnswer` and never reach
  a learner DTO.

## draft vs approved

A `draft` package may omit content that has no authoritative source, and record
the gap in `pendingApprovals[]`. An `approved` package may not: pending
approvals, non-production provenance, placeholder markers, missing content on a
content-bearing level and missing report definitions are all hard errors. This is
what keeps an incomplete package from ever being labelled publishable.

## Tests

```bash
npm run test:regression:curriculum-package            # validation, fingerprint, importer, guards, code corpus
npm run test:regression:curriculum-package-roundtrip  # real /current -> /content against an isolated Backend
```
