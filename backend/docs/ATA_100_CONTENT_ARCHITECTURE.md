# ATA-100 content architecture (Phase C)

The canonical 100-level model, where its truth lives, how it is validated, and
exactly how much of it is written today.

## 1. One source of truth

Before Phase C the same facts lived in three places that could disagree:

| Source | Held | Status now |
|---|---|---|
| `academy/src/data/curriculum/fixture.ts` | 100 levels, 20 modules, checkpoints, unlocks | preview/test data — **not** business truth |
| `academy/les-prog.txt` | editorial brief for 100 levels | an INPUT to authoring |
| `backend/curriculum/packages/ata-v2-first-slice.*` | 4 approved production levels | still the approved slice, unchanged |

Backend is now authoritative for level numbers, stable codes, module grouping,
level type, completion method, XP, progression, gates and unlock metadata.
Academy is **not modified in this phase** and nothing was deleted.

| Path | Owns |
|---|---|
| `src/lib/curriculum/product-ata-100.ts` | structure: 100 levels, 20 modules, titles, kinds, checkpoints |
| `src/lib/curriculum/product-vocabulary.ts` | tool / rank / community vocabulary, obsolete-brand list |
| `curriculum/canonical/ata-100-editorial-source.json` | the transferred editorial BRIEF + its provenance manifest |
| `scripts/curriculum/buildCanonical100.ts` | the deterministic converter |
| `curriculum/packages/ata-v2-canonical-100.draft.json` | the generated canonical DRAFT artifact |
| `src/lib/curriculum/package/ata-profile.ts` | the ATA-100 product profile validator |

Provenance is recorded exactly: Academy @ `4c4ced398d2b2a73cdf8d95652b9171b425fdf06`,
with the sha256 of each transferred file in the file headers. Values were
transferred once, by hand, and are never read again — a regression test fails if
any Backend file imports or reads a path inside the Academy checkout.

## 2. Structure

100 levels, 1..100 continuous, 20 modules, each module ending in its checkpoint.
Module 1 is levels 1–4 and module 2 is 5–10; modules 3–20 are five levels each
(4 + 6 + 18×5 = 100).

| Kind | Count | Package pair | Content contract |
|---|---:|---|---|
| `registration` (L1) | 1 | `external_event : pocket_postback` | gate copy; xpReward 0 |
| `video_test` | 58 | `lesson : assessment_pass` | content + assessment; the ATA video profile requires exactly 4 takes and 4 questions — see [VIDEO_PRODUCTION_CONTRACT.md](VIDEO_PRODUCTION_CONTRACT.md) |
| `report` (L3) | 1 | `report : report_approval` | report assignment + instructions |
| `practical`, mentor-reviewed | 7 | `mentor_review : mentor_review` | practical instructions |
| `practical`, remaining | 13 | `lesson : manual` | practical instructions |
| `checkpoint` | 20 | `financial_checkpoint : balance_check` | gate copy; xpReward 0 |

The practical mapping is the accepted Phase-A decision (R1) and is not reopened
here; the profile delegates to `resolvePracticalLevelContract` rather than
restating it. The learner-facing label stays «Практика». There is no generic
practice owner.

Identity is `v2.lNNN.<slug>` (V2_PRODUCT_DECISIONS.md §8), **not** Academy's
`level.NNN`. The slug is a deterministic transliteration of the canonical title —
it reproduces all four approved codes character for character, which is the
evidence that the scheme is the canonical one. `legacyAcademyLevelCode` /
`levelNumberFromLegacyAcademyCode` give the exact, total mapping from the old
fixture ids.

## 3. Gates stay exactly as accepted

L1 remains `external_event : pocket_postback` with `xpReward = 0` and integration
code `pocket.registration`. Every checkpoint remains
`financial_checkpoint : balance_check` with `xpReward = 0` and integration code
`checkpoint.module-NN`.

Their preprod QA capability is the Phase-A staging-attestation domain and lives
nowhere near curriculum content. The package contains no staging, attestation or
environment vocabulary at all, and a regression test asserts that.

## 4. XP — DECIDED IN PHASE F

Phase C shipped this section saying *"no XP schedule was invented"*, which was
true then and is no longer true. The ATA XP schedule is now an approved product
decision, owned by `src/lib/curriculum/product-xp-policy.ts`:

| completion pair | XP | levels | subtotal |
| --- | --- | --- | --- |
| `lesson : assessment_pass` | 100 | 58 | 5 800 |
| `lesson : manual` | 150 | 13 | 1 950 |
| `mentor_review : mentor_review` | 250 | 7 | 1 750 |
| `report : report_approval` | 500 | 1 | 500 |
| `financial_checkpoint : balance_check` | 0 | 20 | 0 |
| `external_event : pocket_postback` | 0 | 1 | 0 |
| **total** | | **100** | **10 000** |

The policy is keyed on the canonical **completion pair** and on nothing else —
not the level number, not the module, not the rank, not the unlock level, not a
fixture. A level is worth what its kind of work is worth.

`xpRewardStatus` is `approved` on all 100 levels of the canonical draft; there
are no `unresolved` rewards left. The validators that police it:

* every level's reward must equal the policy's (`ATA100_XP_REWARD_MISMATCH`);
* every level's status must equal the policy's (`ATA100_XP_REWARD_STATUS_MISMATCH`);
* each pair's level count and subtotal must match (`ATA100_XP_SCHEDULE_BUCKET_MISMATCH`);
* the package must sum to exactly 10 000 (`ATA100_XP_TOTAL_MISMATCH`);
* gate pairs must still be exactly 0 (`LEVEL_GATE_REWARD_UNSUPPORTED` derived
  from the completion owner, plus `ATA100_GATE_XP_NONZERO` as a product fact);
* `xpReward` remains a bounded non-negative integer in the package schema;
* XP is awarded only from the immutable `LevelDefinition.xpReward` by the one
  completion engine. Phase F creates no second XP source.

**The historical first-slice packages are unchanged.** They still declare
`xpReward: 0` with no `xpRewardStatus`, and their fingerprints still recompute to
the values they shipped with. The canonical ATA-100 builder applies the schedule
as an *overlay* when it carries L1–L4 across, because XP is runtime product
policy rather than editorial content — the Blueprint did not author it, and
nothing rewrites the record to suggest it did.

## 5. Generic engine vs ATA product profile

`validate.ts` answers *"is this a valid curriculum package?"* for a curriculum of
any size. `ata-profile.ts` answers *"is this THE ATA product?"*. The 4-level
approved first slice must keep passing the first and is never judged by the
second.

The profile reports two kinds of finding:

* **issues** — structural violations. Always blocking.
* **gaps** — editorial incompleteness. The expected state of a draft; blocking
  only for an `approved` package.

Collapsing them would make a draft either permanently "failing" (so everyone
learns to ignore it) or "passing" (so nothing measures production progress).

### Generic validator additions in this phase

| Code | Meaning |
|---|---|
| `CONTENT_BODY_FORMAT_UNKNOWN` / `_VERSION_UNSUPPORTED` / `_BLOCK_INVALID` / `_LEGACY_INVALID` | body format contract |
| `CONTENT_ASSET_REFERENCE_MISSING` / `_KIND_MISMATCH` | block → asset resolution |
| `CONTENT_ASSET_CODE_DUPLICATE` / `_ORDER_DUPLICATE` | asset table integrity |
| `CONTENT_VIDEO_DURATION_REQUIRED` | video asset without a declared duration |
| `CONTENT_TOOL_CODE_UNKNOWN` | tool code outside the product vocabulary |
| `CONTENT_BODY_LEARNER_EMPTY` | approved content below the teaching-text floor |
| `CONTENT_RISK_DISCLAIMER_MISSING` | approved content with no risk disclaimer |
| `OBSOLETE_BRAND_IN_APPROVED_PACKAGE` | a retired product brand in an approved package |

Also changed: `CONTENT_BEARING_TYPES` was split into three questions —
*may carry content* (now includes `report` and `mentor_review`, matching
`READABLE_LEVEL_TYPES` in the runtime read path), *may carry an assessment*
(unchanged), *must carry content when approved* (unchanged, so the approved slice
stays valid). Placeholder matching moved from `String.includes` on an
upper-cased blob to word-boundary patterns, so «рынок скоро вернётся» and
«готовиться к сессии» are no longer false positives while `TODO`, `lorem ipsum`,
«заглушка», «в разработке» and «скоро будет» still are.

### ATA profile codes

Structural: `ATA100_LEVEL_COUNT`, `ATA100_LEVEL_NUMBER_GAP`,
`ATA100_LEVEL_NUMBER_DUPLICATE`, `ATA100_LEVEL_NUMBER_OUT_OF_RANGE`,
`ATA100_MODULE_COUNT`, `ATA100_MODULE_MISSING`, `ATA100_MODULE_CODE_MISMATCH`,
`ATA100_MODULE_TITLE_MISMATCH`, `ATA100_MODULE_CHECKPOINT_MISMATCH`,
`ATA100_STABLE_CODE_MISMATCH`, `ATA100_TITLE_MISMATCH`,
`ATA100_LEVEL_MODULE_MISMATCH`, `ATA100_COMPLETION_CONTRACT_MISMATCH`,
`ATA100_PRACTICAL_MAPPING_MISMATCH`, `ATA100_PRACTICAL_CONTRACT_UNOWNED`,
`ATA100_GATE_MISSING`, `ATA100_GATE_NOT_EXPECTED`,
`ATA100_GATE_INTEGRATION_MISMATCH`, `ATA100_GATE_XP_NONZERO`,
`ATA100_PROGRESSION_MISMATCH`, `ATA100_CHECKPOINT_PREREQUISITE_SET`,
`ATA100_CURRICULUM_CODE`, plus the vocabulary checks
`ATA100_TOOL_UNLOCK_*`, `ATA100_COMMUNITY_UNLOCK_*`, `ATA100_RANK_*`.

Editorial gaps: `ATA100_CONTENT_MISSING`, `ATA100_CONTENT_NOT_PUBLISHED`,
`ATA100_CONTENT_LOCALE_MISSING`, `ATA100_CONTENT_NOT_AUTHORED`,
`ATA100_ASSESSMENT_MISSING`, `ATA100_ASSESSMENT_QUESTION_COUNT`,
`ATA100_REPORT_MISSING`, `ATA100_REPORT_INSTRUCTIONS_MISSING`,
`ATA100_MENTOR_INSTRUCTIONS_MISSING`.

## 6. Unlock metadata — where the truth lives

**Domain progression** (`unlockLevel` on a tool, channel or rank) lives in
`product-vocabulary.ts` and in the checkpoint level structure. 19 curriculum
tools at the 19 non-L4 checkpoints, 5 community channels (L4, L20, L35, L45,
L85), 20 rank transitions. `validateAtaUnlockVocabulary()` proves the two lists
agree, independently of any package.

**Display metadata** is everything else, including any `tool_link` or `cta` block
in lesson content. A content block unlocks nothing and gates nothing: learner
access never depends on a decorative block.

`tool.secret` is referral-gated, has no unlock level, and is deliberately outside
`CURRICULUM_TOOLS` so it can never be mistaken for progression — while still
being a legal thing for content to mention.

## 7. The canonical draft artifact — honest numbers

`curriculum/packages/ata-v2-canonical-100.draft.json`, 443 KB, status **draft**,
`approval.approvedBy = null`, 153 `pendingApprovals` entries.

```
STRUCTURAL_COMPLETENESS   100 / 100 levels        = 100 %
EDITORIAL_COMPLETENESS      2 / 79  levels        =   2.5 %
PRODUCTION_READY            4 levels
```

*Editorial completeness is measured over the 79 levels that require original
authoring (58 lessons + 20 practicals + 1 report). Measured over all 100 the same
package reads 23 %, because the 21 gate levels never had an authoring
requirement — that number flatters and is reported separately as
`levelsWithNoEditorialGap`.*

| Kind | Total | Structural | No editorial gap | Production-ready |
|---|---:|---:|---:|---:|
| registration | 1 | 1 | 1 | 1 |
| video_test | 58 | 58 | 1 | 1 |
| report | 1 | 1 | 1 | 1 |
| practical | 20 | 20 | 0 | 0 |
| checkpoint | 20 | 20 | 20 | 1 |

The audit baseline was **4 production levels, 1 content-rich lesson**. This
artifact claims exactly that and no more: levels 1–4 are carried over verbatim
from the approved slice, and every other level is draft.

What the other 96 levels DO have: canonical identity, module, type, completion
pair, gate, progression, and a schema-valid v2 content body built from the
editorial brief (77 levels) — which proves every level can be represented in the
new model. Each of those bodies is `status: "draft"`, carries
`approvalRequired: true` provenance, and has an explicit `pendingApprovals` entry.
No filler was inserted to make validation green; where the brief has no material
for a slot, the block is simply absent and the body is short.

## 8. The converter

```bash
npm run curriculum:canonical100:build    # regenerate the artifact
npm run curriculum:canonical100:check    # fail if the artifact has drifted from its inputs
```

Reads three Backend-owned inputs (structure module, editorial JSON, approved
slice), no other repository, no database, no network, no clock, no randomness.
Same inputs → byte-identical output → identical fingerprint. It refuses to emit a
package that contains an obsolete brand, that fails generic validation, or that
has ATA profile issues — and it can never produce an `approved` package.

## 9. The approved first slice

`curriculum/packages/ata-v2-first-slice.rev3.approved.json` is **not deleted and
not changed**. It remains the historical approved slice, the backward-
compatibility fixture (the only shipped legacy-v1 content body), a regression
source, and the input from which the canonical package inherits levels 1–4. It
still passes generic validation with zero warnings and an unchanged fingerprint
`860751bf…`.

## 10. What Phase C did NOT do

No deploy, no release, no symlink change, no migration applied, no migration file
created, no import, no publication, no env change, no flag change, no service
restart, no live database access, no Academy modification.
