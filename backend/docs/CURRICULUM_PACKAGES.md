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
| `src/lib/curriculum/package/ata-profile.ts` | the ATA-100 PRODUCT profile (Phase C) |
| `src/lib/curriculum/content-body.ts` | body format identity + v1/v2 compatibility reader |
| `src/lib/curriculum/content-blocks.ts` | Content Body v2 block catalog |
| `src/lib/curriculum/content-safe-text.ts` | the shared sanitizer contract |
| `src/lib/curriculum/product-ata-100.ts` | canonical 100-level structural source |
| `src/lib/curriculum/product-vocabulary.ts` | canonical tool / rank / community vocabulary |
| `scripts/curriculum/importCurriculumPackage.ts` | CLI |
| `scripts/curriculum/fingerprintCurriculumPackage.ts` | fingerprint / `--check` |
| `scripts/curriculum/buildCanonical100.ts` | deterministic ATA-100 converter |
| `curriculum/canonical/*.json` | source-controlled canonical inputs |
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

## Generic engine vs ATA product profile (Phase C)

`validate.ts` is the GENERIC engine: it validates a curriculum of any size and
knows nothing about ATA having a hundred levels. `ata-profile.ts` is the ATA-100
PRODUCT contract — exactly 100 levels, 20 modules, canonical codes and titles, the
committed unlock vocabulary, the approved gate and practical structure — applied
deliberately, only to a package that claims to be the full ATA curriculum.

The 4-level `ata-v2.first-slice` therefore keeps passing generic validation and is
never judged against the 100-level product contract. It stays in the repository as
the historical approved slice, the backward-compatibility fixture for legacy v1
content bodies, and the source of levels 1–4 in the canonical package.

The profile separates structural **issues** (always blocking) from editorial
**gaps** (blocking only for an `approved` package) and returns a completeness
report. See `docs/ATA_100_CONTENT_ARCHITECTURE.md`.

## Content body format

`ContentLocalization.body` accepts legacy **v1** (no format tag) and **v2**
(`{"format":"ata.lesson.blocks","version":2,…}`), triaged by an explicit tag
before any branch schema runs. No database migration is involved — the column is
`JSONB CHECK (json_valid(...))`. See `docs/CONTENT_BLOCKS_V2.md`.

## Canonical ATA-100 package

```bash
npm run curriculum:canonical100:build   # regenerate curriculum/packages/ata-v2-canonical-100.draft.json
npm run curriculum:canonical100:check   # fail if the artifact has drifted from its inputs
```

Deterministic: same inputs → identical bytes and fingerprint. Reads no other
repository, no database and no network, and can never emit an `approved` package.

The target curriculum version is an explicit build input defaulting to 3, and
each version writes to its own file, so a successor is built beside its
predecessor rather than over it:

```bash
npx tsx scripts/curriculum/buildCanonical100.ts --curriculum-version-number 4
# -> curriculum/packages/ata-v2-canonical-100.v4.draft.json
```

The importer keeps sole authority over nothing but what the artifact declares —
there is no import-time version override. See
**[CURRICULUM_SUCCESSOR_ARTIFACT.md](CURRICULUM_SUCCESSOR_ARTIFACT.md)** for the
accepted v3/v4 identities and the successor rules.

## Tests

```bash
npm run test:regression:curriculum-package            # validation, fingerprint, importer, guards, code corpus
npm run test:regression:curriculum-package-roundtrip  # real /current -> /content against an isolated Backend
npm run test:regression:curriculum-content-blocks     # body format, block catalog, sanitizer, assets, tools
npm run test:regression:curriculum-ata100             # ATA-100 profile, unlock vocabulary, converter determinism
npm run test:regression:curriculum-video-blueprint    # 58 video contracts, 232 takes/questions, fingerprint coherence
npm run test:regression:curriculum-canonical-successor # the version build contract, v3/v4 equivalence, successor import
```

## Video+test production contracts

The 58 `video_test` levels carry a production contract that binds each video to
its test: four testable takes `T{level}.1–4`, four single-choice questions, and a
one-to-one take↔question mapping. It is a separate domain from learner content —
source, approval and production state are three independent axes, and
`PROPOSED` is never recorded as `MISSING`.

See **[VIDEO_PRODUCTION_CONTRACT.md](VIDEO_PRODUCTION_CONTRACT.md)** for the
source chain, the workflow, the fingerprint invalidation rules and the Phase-G
editor contract.
