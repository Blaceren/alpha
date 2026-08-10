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

### The HTTP surface

`GET /levels/{id}` and `GET /levels/{id}/validate` accept the same three ids as
optional query parameters:

```
GET /api/admin/curriculum/authoring/levels/2/validate
      ?contentVersionId=79&assessmentVersionId=59&videoProductionVersionId=1
```

> **Review-surface correction.** This sentence used to be documentation of an
> intention rather than of behaviour. `gateAuthoringRead` closes the query string
> against an allowlist, the three candidate axes were never added to it, and the
> gate runs before the route body — so every request above was answered
> `400 INVALID_QUERY` and the reachable HTTP surface could only ever open the
> runtime version. The allowlist now names them. It is still **closed**: an
> unknown parameter is still `400 INVALID_QUERY`.

**Query validation is strict, and a bad id is never a fallback.**

| input | answer |
|---|---|
| `79` | accepted |
| `0`, `-1`, `1.5`, `7e1`, `0x4f`, `+79`, `%2079%20`, ``, `NaN`, `abc` | `400 AUTHORING_INPUT_INVALID` |
| the same parameter twice | `400 AUTHORING_INPUT_INVALID` — an ambiguous selection is refused, never resolved by position |
| a version of another level, or of nothing | `422 AUTHORING_CANDIDATE_INVALID` |
| an unknown parameter name | `400 INVALID_QUERY` |

None of these is answered about the runtime version. A caller that names a
version it may not have is asking a different question, and answering it about
the bound predecessor is the silent substitution this phase exists to remove.

**HTTP and the domain agree exactly.** For one candidate set, the HTTP report is
byte-identical to `validateLevelAuthoring({ candidate })`, and the workspace's
`opened` is byte-identical to `readLevelAuthoringWorkspace({ candidate })`. No
HTTP layer strips a candidate selection.

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

Both build the candidate from the **path** id via `candidateForAxis`, never from
the query string, so neither was affected by the query-gate defect above.

**Review notes** target the aggregate named in the path as well: a note written
while a reviewer has the successor open lands on the successor.

## 3a. The runtime summary vs the editorial candidate

A level mid-succession has two truthful versions per axis at once, and the two
questions have separate names everywhere.

| | Runtime | Editorial candidate |
|---|---|---|
| Question | which version does the level SERVE? | which version is somebody supposed to be WORKING on? |
| Function | `pickRuntimeVersion` | `pickEditorialCandidate` |
| On `AuthoringLevelSummary` | `content` / `assessment` / `video` | `editorial.content` / `.assessment` / `.video` |
| On `AuthoringReadiness` | every top-level counter | the `editorial` block |
| Moved by | the admin-gated publish transaction | submitting, returning or approving a version |

**Neither overwrites the other.** `pickRuntimeVersion` is untouched, the level
summary still describes the served version, and every pre-existing readiness
counter keeps its meaning — `contentSubmittedLevels` counts levels whose SERVED
content is submitted, which for a level serving a published predecessor is
correctly `0`. The editorial block answers the other question beside it. Adding
the two together is meaningless, which is why they are named apart.

### How the editorial candidate is chosen

Deterministic, from the lifecycle columns already stored. **No new durable
pointer**, nothing inferred from `versionNumber - 1`, from a timestamp or from an
audit row.

1. Take every version of the axis that is not runtime-`archived`.
2. Rank by whose desk it is on — `submitted_for_review` (reviewer) →
   `changes_requested` (author) → `approved` (publisher, i.e. approved and not
   yet published) → `draft`.
3. Best rank wins. Within `draft`, the highest `versionNumber` wins.
4. Within any of the three **active** ranks, a tie is **ambiguity**: the
   candidate is withheld (`versionId: null`, `ambiguous: true`, competing ids
   listed) and the queue raises `NEEDS_PRODUCT_DECISION`. **Fail closed** — two
   versions submitted for review is not a state anything should resolve by id
   order.

The runtime version is a candidate like any other. Excluding it would break a
level with no successor, and — because `pickRuntimeVersion` returns the highest
version when nothing is bound, and no `LevelResourceBinding` binds an
assessment — "everything except the runtime version" is exactly the set of
*older* banks on the assessment axis.

## 3b. The version-specific review queue

Every non-structural `WorkQueueEntry` now carries `levelDefinitionId` and a
`candidate` naming the exact version:

```ts
candidate: {
  versionId, versionNumber, revision, editorialState,
  runtimeStatus, isRuntimeVersion, isRuntimeBound, predecessorVersionId,
} | null
```

`null` only for `structure` entries and for an ambiguous axis, where withholding
the id is the point. A reviewer reads `versionId` off the queue and feeds it
straight back into `GET /levels/{levelDefinitionId}?contentVersionId={versionId}`
— **no out-of-band artifact is needed to find a successor.**

Three review buckets, one per axis: `READY_FOR_CONTENT_REVIEW`,
`READY_FOR_ASSESSMENT_REVIEW`, `READY_FOR_VIDEO_REVIEW`. The last two are new; a
submitted bank previously surfaced as `NEEDS_ASSESSMENT_APPROVAL` — "a Blueprint
proposal nobody has approved", which is the right desk with the wrong story — and
a submitted production version produced no entry at all.

Source integrity (`SOURCE_CONFLICT`, `SOURCE_UNAVAILABLE`) is emitted
**unconditionally**, not as the `else` of a lifecycle branch. A conflict is owed
to a reviewer whatever desk the bank is on; it used to disappear from the queue
while a bank sat in `changes_requested`.

**The queue carries no source-authority evidence** — no decisions, hashes,
fingerprints or rationale. That is a different question for a different person,
and it has its own surface.

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

`GET /assessments/{id}/source-authority` and the handoff bundle both report
`linkOrigin` and `linkLineageDepth`, so a reader can tell a bank that was
deliberately pinned to a proposal from one whose ancestor was. Both are
**staff-only**; neither reaches a learner payload. They are deliberately absent
from the handoff **fingerprint** projection: `authorityLineageFingerprint`
already binds the origin version and depth of every decision, and adding a field
to the fingerprint would move the recorded identity of every bundle ever
produced.

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

The review-surface correction widened no authority either. `curriculum_read` can
now *reach* a candidate it could always have been shown; it still cannot approve,
adjudicate, publish or rebind.

## 10. Publication stays separate

Approval writes `editorialState`, `approvedById`, `approvedAt` and nothing else.
It never touches `status`, `publishedAt` or a binding.

Activation remains one admin-gated transaction that archives the replaced
version, publishes the successor and moves the binding atomically. A failed
activation leaves the old runtime intact. Until it runs, the learner is on the
predecessor and the approved successor waits indefinitely — a stable resting
state, not a half-state.

While it waits, the approved successor remains the level's **editorial
candidate** with `waitingOn: "publisher"`, and the runtime summary keeps naming
the version being served. The queue therefore shows the level as neither
"finished" nor "needing an author" — it shows the one step that is actually
outstanding.

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

`npm run test:regression:review-surface-correction` — 31 checks over the staff
surfaces: the candidate-precedence matrix as a unit table (only-runtime, draft,
submitted, changes-requested, approved-unpublished, abandoned newer draft,
multi-generation, archived, insertion-order independence, ambiguity per desk),
and over a real HTTP server: candidate GET accepted, every malformed and
duplicated id refused, foreign and nonexistent candidates refused, HTTP/domain
equivalence, the successor in the queue with its exact id, that id reopening the
version, review notes landing on the opened version, `linkOrigin` exposure,
`curriculum_read` still unable to approve, runtime binding untouched, inherited
authority unchanged, no learner leakage, and ambiguity failing closed.
