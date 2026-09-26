# Canonical curriculum successor artifacts

**Phase:** G2-CURRICULUM-SUCCESSOR-ARTIFACT-1 · **Migration:** 46, unchanged

`ata-v2@v3` reached `published` with its 58 `lesson:assessment_pass` levels
unbound. `assertParentDraft` freezes a published curriculum's resources and the
domain implements no `published → draft` transition, so that version cannot be
repaired in place — the repair is a **successor curriculum version** built from
the same source.

This document is the accepted identity of the successor artifact and the rules
that produced it.

---

## 1. Why the version is a build input and not an import option

The importer takes `curriculumVersionNumber` from the package and from nowhere
else. That is the design, not an omission: the artifact is the release identity,
its `contentFingerprint` covers that identity, and an accepted fingerprint stops
meaning anything the moment a runtime flag can retarget the artifact it names.
So `--override-version` and its relatives do not exist, and
`curriculumCanonicalSuccessorRegression` fails if one appears.

What was missing was the ability to *build* an artifact declaring a different
version. `scripts/curriculum/buildCanonical100.ts` hard-coded `3`. It now takes:

```bash
npm run curriculum:canonical100:build   # the retained default: v3, at its historical path
npm run curriculum:canonical100:check   # fail if that artifact drifted from its inputs

npx tsx scripts/curriculum/buildCanonical100.ts --curriculum-version-number 4
npx tsx scripts/curriculum/buildCanonical100.ts --curriculum-version-number 4 --check
```

The value is **explicit and source-defined**. It is never allocated from a
database, an environment variable, a clock or "one more than the highest row in
PREPROD" — any of those would make the artifact a function of live state, so two
builds of the same source could disagree and no fingerprint could be pinned in
advance. The parse accepts digits only: `4.0`, `+4`, `0x4`, `4e0` and `" 4 "` are
all refused rather than coerced, because a coerced value here becomes a
curriculum identity in a published database.

Each version writes to its own file, so a build can never overwrite an accepted
artifact:

| version | path |
|---|---|
| 3 (default) | `curriculum/packages/ata-v2-canonical-100.draft.json` |
| *n* ≠ 3 | `curriculum/packages/ata-v2-canonical-100.v{n}.draft.json` |

v3 keeps its unsuffixed name deliberately: the accepted activation manifest pins
that path and the ATA-100 regression reads it by name.

---

## 2. Accepted artifact identities

| | v3 (predecessor, live) | v4 (successor) |
|---|---|---|
| curriculum | `ata-v2@v3` | `ata-v2@v4` |
| package code | `ata-v2.canonical-100` | `ata-v2.canonical-100` |
| package revision | 1 | 1 |
| path | `curriculum/packages/ata-v2-canonical-100.draft.json` | `curriculum/packages/ata-v2-canonical-100.v4.draft.json` |
| artifact sha256 | `b55137e139351512741c11a06ec9e043591bb98f83df06bd64901c22bb9595f0` | `7477ae2798ca0ab3200f3203c0b2eeafb8fa65b00e4a77e7c05738752ba2b3aa` |
| package fingerprint | `412449e532bd56fc10f5588900ae67700965207a4b438b9fc6d83c2c5909a882` | `fa9f4f989b62a6947a4a57164eeb04dfd3e0ba008abfd9e923eab875b0c653ac` |
| semantic equivalence digest | `9a178e104cf4e12384f0aeb28cf8da420bd8c50ef13dfad06e3651b6934e0165` | *same* |
| bytes | 1 012 094 | 1 012 094 |
| status | `draft` | `draft` |

`packageRevision` stays 1 on purpose. It denotes the editorial revision of the
package's content, and the content did not change; the successor identity is
carried by `curriculumVersionNumber` alone. The pair is not unique anywhere — the
importer's marker (`ata-package:<code>@<revision>:<fingerprint>`) disambiguates
by fingerprint.

The v4 artifact is **new** and is not covered by the v3 activation manifest.
That manifest remains historical evidence for the v3 activation and is not
rewritten.

---

## 3. What a version bump is allowed to change

Exactly two fields differ between the two artifacts, in 1 012 094 bytes:

| field | v3 | v4 | derivation |
|---|---|---|---|
| `curriculumVersionNumber` | `3` | `4` | the release decision itself; passed to the builder |
| `contentFingerprint` | `412449e5…` | `fa9f4f98…` | `calculateFingerprint`, whose canonical projection includes `curriculumVersionNumber` |

Nothing else moves — not the module set or its order, the 100 levels or their
order, the stable codes, level kinds, completion methods, XP, checkpoint
thresholds, unlock semantics, lesson bodies, content payloads, the 232 questions,
their options, the answer keys, `passPercent`, the manual and mentor-review
tasks, the report contract, the Pocket-registration level, the 154 pending
approvals or the embedded source references.

### The semantic-equivalence digest

Different fingerprints are expected here and are also exactly what makes "nothing
educational changed" unprovable from fingerprints alone. So
`src/lib/curriculum/package/successor-equivalence.ts` takes the **same** canonical
projection the real fingerprint is taken over, removes exactly one key —
`curriculumVersionNumber` — and hashes the result with the **same** serialiser.
Equal digests therefore mean the two packages teach, test and grade identically.

It is **not** a package fingerprint and must never be stored or accepted as one:
it is deliberately blind to the field that separates a predecessor from its
successor, so treating it as an identity would let v4 be imported where v3 was
accepted. Nothing in the runtime, the importer or the publication path calls it.

---

## 4. What a successor import does, and what it still refuses

Proved by `npm run test:regression:curriculum-canonical-successor` on a throwaway
fixture holding a published v3:

- v4 imports as a **distinct draft** `CurriculumVersion`; no `VERSION_IMMUTABLE`,
  no version collision, no manual override;
- it carries 20 modules, 100 levels, 78 content versions, 78 content bindings,
  58 assessment versions and **58 assessment bindings** — the correction from
  `8c88d74` applies to the successor;
- no duplicate binding rows, no assessment bound to a foreign level or a foreign
  version, no `assessment_pass` level left unbound;
- v3 is byte-for-byte unchanged, still `published`;
- re-importing v3 is still refused `VERSION_IMMUTABLE`; re-importing v4 is a
  no-op, not a second version.

**A package-only v4 still cannot be published.** 57 of the 58 banks ship as
drafts (level 2's is the single approved precedent and ships published), so
`publishCurriculumVersion` refuses with `CURRICULUM_INVALID` and 57 ×
`LEVEL_ASSESSMENT_NOT_PUBLISHED`, and the version is still `draft` afterwards.
That is correct. The completeness gate is not to be weakened to make a
package-only publication pass — the editorial and assessment lifecycle is a
genuine prerequisite:

```
v4 import → v4 editorial overlay → content publication
          → assessment publication → completeness check → curriculum publication
```

---

## 5. Lineage: no migration 47

Descent is recorded by `AssessmentVersion.predecessorVersionId`, added by
`20260811000000_assessment_successor_lineage` — migration 46, already applied
everywhere. Every v4 bank has exactly one v3 predecessor, found by the stable
level code both versions share, so all 58 links are representable on the existing
schema and `ON DELETE RESTRICT` keeps the evidence from disappearing. **No schema
change is required and the migration count stays 46.**

The importer writes no lineage. It is not told about a predecessor and must not
guess one; the links are established by the phase that performs the repair.

---

## 6. Producing the v4 editorial overlay

The overlay's target is derived entirely from the structural package handed to
the exporter — `binding.curriculumCode`, `binding.curriculumVersionNumber` and
`binding.structuralPackageFingerprint` all come from
`pkg.shape.*` — so a v4-targeted overlay is exported by naming the v4 package:

```bash
npx tsx scripts/curriculum/exportEditorialOverlay.ts \
  --source file:/absolute/path/to/<accepted-checkpoint-containing-v4>.sqlite \
  --structural-package curriculum/packages/ata-v2-canonical-100.v4.draft.json \
  --out curriculum/overlays/<name>.json
```

Two constraints follow from `exportEditorialOverlay`, and both are prerequisites
rather than obstacles:

1. **The source checkpoint must itself contain `ata-v2@v4`**, whose `changeNotes`
   marker must equal `ata-package:ata-v2.canonical-100@1:fa9f4f98…`. A checkpoint
   holding only v3 cannot export a v4 overlay. Importing the v4 package into a
   copy of the accepted editorial checkpoint produces exactly that marker.
2. **The reviewed editorial payloads must be projected onto the v4 rows** in that
   checkpoint before export. A fresh import leaves them at package state.

The projection is well defined and lossless because the overlay keys its entries
by `code#v{versionNumber}` and those keys are identical across the two versions:
against a copy of the accepted checkpoint, all **78/78** content targets and
**58/58** assessment targets match one-to-one, so every editorial decision has
exactly one v4 destination and up to 58 assessment approvals can be represented.
The successor import mints no principals — the `User` rows are untouched — so
historical reviewers and approvers are reused rather than duplicated.

Overlay provenance is stamped from `git rev-parse HEAD` in the exporter's cwd, so
it must be run from a checkout of whatever transport baseline the receiving
manifest names.

---

## 7. Tests

```bash
npm run test:regression:curriculum-canonical-successor   # the version contract, equivalence, import, refusal, lineage
npm run test:regression:curriculum-ata100                # ATA-100 profile and converter determinism
npm run test:regression:curriculum-assessment-binding-sequence  # the binding correction this successor carries
npm run test:regression:curriculum-package               # generic validation, fingerprint, importer guards
```

Both artifacts are reproducible and addressable, and both are checked in. A
successor build is byte-identical across repeated runs: three independent builds
of v4 produced the same 1 012 094 bytes and the same sha256.
