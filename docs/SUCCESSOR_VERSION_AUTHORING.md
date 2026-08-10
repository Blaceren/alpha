# Successor-version authoring

**Phase:** G2 SUCCESSOR · **Migration:** `20260811000000_assessment_successor_lineage` (45 → 46)

How a level whose Content and Assessment are already **runtime-published** gets
re-authored: a draft successor is written, validated, previewed, submitted and
reviewed while the learner keeps receiving the predecessor, and the bank's
already-adjudicated source authority follows the successor without anybody
pretending to decide it again.

---

## 1. Runtime version vs authoring candidate

The platform has always had two truthful answers to "which version of this
level?" and only one word for them.

| | Runtime version | Authoring candidate |
|---|---|---|
| Question | which version does a learner receive? | which version is being edited? |
| Answer | `LevelResourceBinding`, else highest `versionNumber` | the version the caller names |
| Who decides | the admin-gated publish transaction | the author, per request |
| Function | `pickRuntimeVersion` | `resolveCandidate` |

`pickRuntimeVersion` is the accepted rule, unchanged to the byte and renamed from
`pickWorkingVersion`. The rename is the point: that name is what let the Studio,
validation, submit and approve reuse a **runtime** answer for an **authoring**
question. Once a published v1 is bound and a draft v2 exists, the two answers
diverge and the runtime one used to win everywhere.

Both live in `src/lib/curriculum/authoring-candidate.ts`. There is exactly one
implementation of each; `authoring-validation-service` no longer carries the
private copy that let Content and Assessment resolve by two different rules on
one level.

**A candidate is never a default.** Omitting it reproduces the accepted
behaviour exactly. There is deliberately no "highest draft wins" rule, because
that would move learners without anyone deciding to.

## 2. Candidate-aware validation

```ts
validateLevelAuthoring({
  curriculumVersionId,
  levelDefinitionId,
  candidate?: { contentVersionId?, assessmentVersionId?, videoProductionVersionId? },
})
```

Each axis is optional and independent. A supplied id is resolved against
candidates **already scoped to the level**, so an id from another level is simply
absent and refused with `AUTHORING_CANDIDATE_INVALID` (422). The cross-level
guard is a property of the query, not a check somebody has to remember.

Cross-section rules (answer leakage between body and bank) run over the resolved
candidate set, so validation always judges a coherent trio.

The HTTP surfaces accept the same three ids as optional query parameters:
`GET /levels/{id}`, `GET /levels/{id}/validate`.

## 3. Version-specific submit and approve

Submit and approve always knew the version they were acting on — `(kind, id)` —
and threw it away after using it to find the level. They now pass
`candidateForAxis(kind, id)` into validation.

- **Submit** validates the version being submitted.
- **Approve** validates the version being approved.

This matters in both directions: a repaired successor is no longer blocked by a
defective bound predecessor, and a defective successor is no longer waved through
by a clean predecessor. Approval is the four-eyes gate, so a `validationPassed`
computed against a version nobody looked at was the more serious of the two.

## 4. Assessment predecessor lineage

`AssessmentVersion.predecessorVersionId` — nullable, self-referencing,
`ON DELETE RESTRICT`, indexed.

- Written **only** by `cloneAssessmentVersion`, from the id it was given. It
  appears in no create or update command schema, so no caller can claim a descent
  it did not perform.
- NULL means "no recorded predecessor" — every bank that predates the migration.
- RESTRICT rather than SET NULL: silently erasing lineage would convert a bank
  whose authority is *inherited* into one that appears to have none.

Nothing is inferred. Not `versionNumber - 1`, not a timestamp, not an `AuditLog`
row. Only the explicit relation is load-bearing.

## 5. Inherited authority

A successor may inherit the **effect** of an ancestor's decision. It never
inherits authorship of it.

**Resolution order** (`readSourceAuthority`):

1. Active local `SourceAuthorityResolution` rows for this bank.
2. For slots still uncovered, walk `predecessorVersionId` and take the **nearest**
   ancestor's decision for that exact slot.
3. Re-evaluate it against **this bank's** live values with the unchanged
   `evaluateApplication`.
4. Apply the inheritance guards (§6).
5. Inherit only if all of the above hold.

**Local always beats inherited.** Re-adjudicating one field is how an author
legitimately changes a prompt; an older decision reasserting itself over the
newer one would undo that silently.

**Nothing is materialised.** No resolution row is copied. The successor owns zero
rows and the predecessor's seven are untouched. Every inherited decision carries
the original `decidedById`, `decidedAt`, `rationale`, `evidenceRef`,
`evidenceSha256`, `batchId` and both value hashes, and is marked:

```ts
inherited: true
originAssessmentVersionId: <the bank the row lives on>
inheritanceDepth: <1 for the immediate predecessor>
inheritanceRefusal: null | "VALUE_MOVED" | "SOURCE_CONTRACT_CHANGED"
                         | "SOURCE_DOCUMENT_CHANGED" | "SLOT_IDENTITY_CHANGED"
                         | "ANCESTOR_UNPROJECTABLE"
```

**An inherited decision is not a new human adjudication**, and no surface may
present it as one. The authority states (`ADJUDICATED_CURRENT`,
`ADJUDICATED_BLUEPRINT`, `ADJUDICATED_MIXED`, …) are unchanged and generic across
CURRENT/BLUEPRINT/MIXED; inheritance is reported as metadata beside them rather
than as a new state, so no consumer has to learn a new vocabulary to stay correct.

**Multi-generation.** v3 inherits through v2 from v1 when no closer decision
exists. The walk is bounded at 32, detects cycles, and stops — failing closed —
on a missing ancestor or one from another level or curriculum version. Stopping
yields *fewer* inherited decisions, so the failure direction is always "this slot
still blocks".

## 6. Stale safety

An inherited decision survives only while the truth it was made about survives.

| Guard | Source | Refusal |
|---|---|---|
| the bank still serves the adjudicated value | `currentValueHash` / `blueprintValueHash` | `VALUE_MOVED` |
| the same question occupies the ordinal | `stableKey` at that index, vs the ancestor's | `SLOT_IDENTITY_CHANGED` |
| the same canonical source contract | `contractFingerprintAtDecision` | `SOURCE_CONTRACT_CHANGED` |
| the same canonical Blueprint document | `blueprintSourceDocumentSha256` | `SOURCE_DOCUMENT_CHANGED` |
| the ancestor's bank can be read at all | projection | `ANCESTOR_UNPROJECTABLE` |

A refused inheritance is reported as `STALE` with its reason, not silently
dropped: a reviewer needs to know an ancestor decided this slot and the decision
no longer reaches it, which is different information from "nobody ever decided".

### What is deliberately NOT a guard

`bankFingerprintAtDecision` and `assessmentRevisionAtDecision` remain **historical
evidence**. The full bank fingerprint moves whenever a distractor, an option
order or an explanation changes — exactly what a successor exists to do. Using it
as a guard would refuse every legitimate successor and force a human to re-decide
authority truth that never moved, which is fabricated adjudication.

`contractFingerprintAtDecision` is the opposite: computed over the **source**
contract, which no amount of bank authoring can move. It answers "is this still
the same proposal?" precisely, and this phase makes it load-bearing for
inheritance only.

## 7. The canonical source follows the lineage

`VideoProductionAssessmentLink.videoProductionVersionId` is unique, so one
production version pins exactly one bank and a clone **cannot** carry its
predecessor's link row.

The rule, in precedence order:

1. The bank's own durable link (`linkOrigin: "own"`).
2. Otherwise the nearest **ancestor's** link (`linkOrigin: "lineage"`). A clone is
   a copy of its ancestor's questions, so the proposal it must be measured against
   is the one its ancestor is pinned to.
3. Otherwise the level's working production version (`linkOrigin: "none"`),
   reporting only — `sourceLinked` is false and adjudication is refused.

This is **narrower** than the old fallback, not wider: it can only select a
contract some ancestor was deliberately linked to. Without it a cloned bank fell
through to "the level's newest contract", which silently compared a successor
against a proposal its predecessor was never measured against.

Adjudication (`resolveSourceAuthority`) accepts an own or lineage link. Refusing
lineage would leave a successor able to *inherit* authority but never to correct
it — inheriting a decision while permanently unable to re-decide a slot the
author legitimately changed.

## 8. Fingerprints

Two hashes, two questions. Keeping them apart is what lets every
already-adjudicated bank keep its recorded value byte-identically.

| | Answers | Successor that inherits |
|---|---|---|
| `resolutionFingerprint` | **what** was decided | **same** as the ancestor — it is the same adjudication |
| `authorityLineageFingerprint` | **how** it was reached | **differs** — reached by inheritance |

`authorityLineageFingerprint` binds slot, decision, origin version, inheritance
depth and application state, in sorted order. It moves when a decision is re-made
locally, when the chain changes shape, or when a decision stops applying. It does
not move for a distractor, an option order or an explanation, because none of
those is an adjudication.

## 9. Permissions

Unchanged. Nothing in this phase widens any authority.

| Step | Capability |
|---|---|
| clone, edit, submit a successor | `curriculum_author` (`content_manager`) |
| request changes, approve | `curriculum_approve` (`crm_admin`), different actor |
| adjudicate / re-adjudicate a slot | `curriculum_source_authority` |
| publish, archive, set/clear binding | **`UserRole=admin`** |

Four-eyes is enforced in the domain: `violatesSelfApproval` checks both
`lastAuthoredById` and `submittedById`. An inherited decision confers nothing —
adjudication is not approval, and approval is not publication.

## 10. Publication stays separate

Approval writes `editorialState`, `approvedById`, `approvedAt` and nothing else.
It never touches `status`, `publishedAt` or a binding.

Activation remains one admin-gated transaction that archives the replaced
version, publishes the successor and moves the binding atomically. A failed
activation leaves the old runtime intact. Until it runs, the learner is on the
predecessor and the approved successor waits indefinitely — a stable resting
state, not a half-state.

## 11. Out of scope: assessment runtime binding

Every `LevelResourceBinding` in the corpus has `assessmentVersionId = NULL`, so
no level currently serves an assessment to learners. **This phase does not change
that.** It makes assessment successors authorable and reviewable; whether
assessments should become learner-bound at all is a separate product decision,
and binding one for the first time is an activation choice, not a recovery step.

## 12. Tests

`npm run test:regression:successor-authoring` — 36 checks covering selection,
candidate validation, the content successor workflow end to end, lineage
inheritance, the full stale matrix, multi-generation and cycle safety,
local-over-inherited precedence, preview isolation and runtime non-regression.
