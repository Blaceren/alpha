# Source-authority resolution (PHASE-G2 foundation)

The primitive that lets a human decide which of two competing **sources** is
authority for a field, durably and reversibly-auditable, without rewriting either
side and without destroying the evidence that they disagreed.

## The gap this closes

`authoring-conflict.ts` compares the Blueprint proposal against the durable bank
on `prompt` and `correctAnswerText`, per question ordinal, and stops. G1 said so
explicitly: *"The Backend contains no conflict RESOLUTION domain — there is no
accepted command that promotes a proposal over an approved bank, decides which
wording wins, or records that a human chose."*

The consequences were concrete. `conflictCount` is recomputed live on every read,
`resolveProvenance` mapped `conflictCount > 0` straight to `CONFLICTING`
*before* checking approval, and `levelHandoffStatus` blocked on the same number.
So the only mechanical ways to stop a conflict blocking were:

1. edit one side until the strings matched — destroying one authority's wording, or
2. relabel `sourceProvenance` — asserting something historically false.

Neither records **that a decision was made**, by whom, on what evidence.

## The two counts

The single most important rule here is that **a conflict that has been decided
still exists**.

| | meaning |
|---|---|
| `conflictCount` | RAW field-level disagreements, exactly as before. Never reduced by a decision. |
| `blockingConflictCount` | Raw conflicts with no *in-force* decision. This is what readiness and the work queue act on. |

`resolveProvenance` now takes `blockingConflictCount` (falling back to
`conflictCount` when absent, so every pre-existing caller behaves identically).
`ASSESSMENT_SOURCE_CONFLICT` fires on the blocking count.

### The blocking count fails closed (CORRECTION-1)

`blockingConflictCount` is **initialised to the full raw count** and is only ever
lowered by a resolution that was actually read and actually applies. It is never
built up from zero.

This is the difference between "nothing is outstanding" and "nothing is proven
settled", and the initialiser is what says so. An earlier shape started it at `0`
and raised it from the adjudication record, so any failure of that one query — a
Prisma client/schema skew, a transient database error — left the optimistic zero
standing: a bank with real unadjudicated conflicts reported `0` blocking,
provenance `APPROVED_CURRENT`, and became **handoff-ready**, silently. That is the
one outcome this whole primitive exists to prevent.

If the adjudication record cannot be read:

| | |
|---|---|
| `conflictCount` | unchanged — the raw disagreement is still visible |
| `blockingConflictCount` | the **full** raw count — nothing can be shown settled, so nothing is |
| `authorityResolution` | `null` |
| `authorityReadUnavailable` | `true` |
| provenance | stays `CONFLICTING` |
| readiness | `ASSESSMENT_SOURCE_CONFLICT` retained, never handoff-ready |
| work queue | reports the **storage failure**, not "unadjudicated" |

`authorityReadUnavailable` exists so a null projection is never mistaken for a
settled one: it distinguishes "seven conflicts nobody has decided" from "seven
conflicts whose decisions we could not load". The two need different people.

It is about the adjudication **record**. Its sibling
`sourceContractUnavailable` is about the other side of the comparison — the
**proposal** — and is described under "`NO_CONFLICT` is not `SOURCE_UNAVAILABLE`"
below. Both fail closed; neither is ever a learner-visible field.

**Deliberate exception — no raw conflict.** When `conflictCount` is `0`, an
unreadable authority record changes nothing: authority resolution answers "which
of two disagreeing sources wins", and with no disagreement there is nothing for it
to settle. The exception is scoped strictly to `rawConflictCount === 0` and cannot
widen the path above it. `authorityReadUnavailable` is still reported honestly.

## Decision vs application

A decision is not a content migration. Choosing `BLUEPRINT` does not move a
single character into the bank; a later authoring act has to do that. Until it
does, the decision is real, recorded, and **not in force**.

`evaluateApplication` is the only place that decides whether a stored decision is
currently in force:

```
live blueprint value changed          -> STALE      (whichever side won)
decision CURRENT   & bank unchanged   -> APPLIED
decision CURRENT   & bank moved       -> STALE
decision BLUEPRINT & bank now = BP    -> APPLIED
decision BLUEPRINT & bank still = old -> DECIDED_NOT_APPLIED
decision BLUEPRINT & bank = neither   -> STALE
```

Only `APPLIED` stops a raw conflict from blocking.

## Derived state

`NO_CONFLICT` · `UNRESOLVED_CONFLICT` · `ADJUDICATION_STALE` ·
`ADJUDICATED_CURRENT` · `ADJUDICATED_BLUEPRINT` · `ADJUDICATED_MIXED`

Order of derivation: blocking first (an outstanding decision outranks any badge),
then staleness, then the set of winners. `ADJUDICATED_MIXED` exists so a bank
whose fields were decided differently is never given an invented single winner.

`ADJUDICATION_STALE` is separate from `UNRESOLVED_CONFLICT` because the remedies
differ: one needs a decision, the other needs a decision **re-made** against
values that moved underneath it.

## Provenance is untouched

Origin and authority are two axes and stay two fields. After the L2-shaped
adjudication a level reads, all four true at once:

```
sourceProvenance      PROPOSED_CANON     (where the material came from)
conflictCount         7                  (they did disagree, and still do)
authority state       ADJUDICATED_CURRENT
blockingConflictCount 0
```

Nothing claims the Blueprint originally matched the approved bank.

## Schema

`SourceAuthorityResolution` — one row per adjudicated **field**.

Identity of the conflict: `assessmentVersionId`, `videoProductionVersionId`,
`levelDefinitionId`, `curriculumVersionId`, `questionIndex`, `field`,
`conflictPath`.

The decision: `decision` (`CURRENT` | `BLUEPRINT`).

What it was decided against: `currentValueHash`, `blueprintValueHash`,
`blueprintSourceDocumentSha256`, `contractFingerprintAtDecision`,
`bankFingerprintAtDecision`, `assessmentRevisionAtDecision`.

Why, who, when: `rationale`, `evidenceRef`, `evidenceSha256`, `batchId`,
`decidedById`, `decidedAt`.

History: `supersededAt` / `supersededById`, with a **partial unique index** on
`(assessmentVersionId, questionIndex, field) WHERE supersededAt IS NULL`. At most
one active decision per slot; superseded rows accumulate freely. **No code path
deletes a row.**

Values are stored by hash, never copied. The competing strings stay where they
already live — the bank and the contract payload — so this table can never become
a second, drifting home for learner-facing text.

## The command

`resolveSourceAuthority` — one transaction, all-or-nothing:

1. `expectedAssessmentRevision` and `expectedVideoProductionRevision` guards.
2. The bank must be linked to a contract (`AUTHORING_ASSESSMENT_LINK_MISSING`).
3. Raw conflicts are recomputed **inside** the transaction.
4. **Scope completeness**: the decision set must cover the raw conflicts in the
   requested scope exactly — no missing, no extra. `scope: question` therefore
   rejects "prompt decided, correctAnswerText open".
5. **Value identity**: the caller's hashes must match the live values. A reviewer
   can only adjudicate the pair they were actually shown.
6. Idempotent replay of an identical decision is a no-op. A contradicting replay
   is refused. Re-deciding a `STALE` slot requires explicit `supersedeStale`.
7. An `AUTHORING_SOURCE_AUTHORITY_RESOLVED` audit row records actor, time, scope,
   the raw conflict paths, every decision with both hashes, the evidence, and the
   authority state and blocking count **before and after**.

It does **not** bump the assessment aggregate, touch `editorialState`, approve
anything, or write one learner-facing character.

## Permission

New `CrmPermission`: `curriculum_source_authority`, granted to **`crm_admin`
only**, derived from the same `manage_settings` marker `curriculum_approve` uses.
New `AuthoringCapability`: `adjudicate`.

### The domain authorises the actor itself (CORRECTION-1)

`resolveSourceAuthority` does **not** take the caller's word for who is deciding.
The first statement of its transaction verifies, against stored truth, that the
actor exists, is `active`, and is either `UserRole=admin` (the accepted
compatibility authority the HTTP gate's PATH A recognises) or holds a staff role
granting `adjudicate` — resolved through the same
`staffRoleGrantsCurriculumCapability` the gate uses.

The row this command writes says a **named human** chose a source of truth. A
command that took that name on trust would let any future internal caller — a
script, an importer, a batch job — attribute a source-authority decision to
anyone at all, including a blocked account. Refusal is `AUTHORING_ACTOR_FORBIDDEN`
(403) and happens **before** any resolution row, supersession or audit event, so
an unauthorised call leaves nothing behind.

The rule is deliberately the SAME one the gate applies, not a stricter one: a
domain stricter than its gate would refuse every adjudication the Studio makes,
at the layer beneath the gate. The HTTP gate remains in place as defence in depth,
and `decidedById` and the audit actor are always the one verified actor — a caller
can never authenticate as one identity and persist another.

`content_manager` holds `curriculum_author` and is deliberately excluded — an
author who could also decide which source wins would be settling the question
their own draft depends on. Asserted by regression across every role.

Adjudication is **not** approval (§13): after it, the bank still goes through
`submitted_for_review` → independent approval, and self-approval protection is
unchanged.

## Fingerprints

`assessmentFingerprint` (contract-derived) and `assessmentBankFingerprint`
(bank-derived) keep their exact meanings and **do not move** because authority
was adjudicated. A CURRENT adjudication changes no question, and making it look
like a content edit would mark recorded video QA stale for nothing.

`calculateAuthorityResolutionFingerprint` is a **separate** hash over the active
decisions — ordinal, field, decision, both value hashes, the Blueprint document
sha, the evidence sha, decider and decision time — sorted by **`questionIndex`
then `field`**, numerically on the ordinal. It answers "is this the same
adjudication?", and it is bound into the handoff bundle fingerprint, so two
bundles differing only in which authority won are different handoffs.

The ordering is deliberately NOT lexicographic on `conflictPath`: sorting the
rendered path as a string would place `questions[10]` before `questions[2]` and
make the hash depend on how many questions a bank happens to have. Row order from
the database never reaches the hash — the projection is sorted before it is
serialised, so two reads of an unchanged database always agree.

## Surfaces

- `GET  /levels/[levelId]/conflicts` — unchanged comparison, now with
  `currentValueHash` / `blueprintValueHash` per conflict, the authority
  projection, and the two expected revisions.
- `GET  /assessments/[id]/source-authority` — the lineage alone.
- `POST /assessments/[id]/source-authority` — the adjudication command.

The handoff bundle carries `assessment.sourceAuthority` (state, three counts,
resolution fingerprint, per-field decisions with actor/time/evidence). It reads
the contract through the **durable link**, not through the approved video row, so
a bank adjudicated before its video is approved is not falsely reported stale.

Learner payloads are untouched, and a regression asserts the preview frame
contains none of it.

## The canonical source (CORRECTION-1, completed by CORRECTION-2)

`VideoProductionAssessmentLink` is unique on `videoProductionVersionId` but **not**
on `assessmentVersionId`, so one bank may legitimately be linked from several
production versions — a level's v1 and its v2 clone both bound to the same
approved bank.

### One resolver, and the list of everyone who uses it

`resolveAuthoritySource` is the single answer to "which contract is THE Blueprint
proposal for this bank, and can it be read". **Every** authority reader calls it,
and the list is exhaustive on purpose:

| caller | what it does with the answer |
|---|---|
| `readAuthoringOverview` | the assessment summary's conflict counts, provenance and authority projection |
| `authoringLevelConflictsRoute` (`GET …/conflicts`) | the compared values, their hashes and the expected revisions |
| `authoringSourceAuthorityReadRoute` (`GET …/source-authority`) | the lineage projection and the expected video revision |
| `projectLevelFromDatabase` (handoff bundle) | the bundled `sourceAuthority` |
| `resolveSourceAuthority` (the command) | via `resolveCanonicalAuthorityLink`, which requires a real link |

CORRECTION-1 fixed the command and the handoff. The dedicated staff GET was
**missed**, and an independent re-audit reproduced it reading
`videoProductionLinks[0]` — insertion order — and reporting state `NO_CONFLICT`,
`0` raw and `0` blocking for a bank that owed eight decisions, while readiness on
the same row said `CONFLICTING` and refused the handoff. A lineage surface that
can disagree with the command about *which source it is describing* is worse than
no surface. A source guard in the Correction-2 regression now fails the build if
any `src/**` file indexes the link relation again.

### The rule

The accepted one, not a new one: `authoring-read`'s `pickWorkingVersion` defines a
level's working production version as the **highest `versionNumber`** (there is no
`LevelResourceBinding` column for video, so its binding branch cannot apply). The
canonical link applies that same rule to the linked set — among the production
versions actually bound to this bank, the newest is the proposal in force.
`versionNumber` is unique per level, so the choice has no ties to break and cannot
depend on row order.

### Compatibility is checked (CORRECTION-2)

`versionNumber` is unique **per level**, not globally. A link naming a production
version from another level or another curriculum version would therefore let a
foreign `v99` outrank this level's `v2` and become the canonical proposal — the
re-audit demonstrated exactly that. Compatibility is now read off the accepted
schema: `LevelDefinition` is keyed `(id, curriculumVersionId)` and every authoring
aggregate is scoped by that composite, so a production version must share **both
halves** with the bank.

An incompatible link is **refused, not filtered**:
`AUTHORING_ASSESSMENT_LINK_INVALID` (409), and `resolveAuthoritySource` reports
`SOURCE_LINK_INCOMPATIBLE` with **no** version selected. Quietly picking one of the
remaining rows would adjudicate against a source while hiding that the durable
record disagrees with itself — the presence of the corruption *is* the lineage
ambiguity.

### With no link at all

There is no canonical proposal, so the command refuses with
`AUTHORING_ASSESSMENT_LINK_MISSING` rather than picking a candidate.

The **read** surfaces still report against the level's working production version,
which is the rule `readAuthoringOverview` has always applied and the reason an
unlinked-but-conflicting bank still blocks today. It is a reporting fallback only:
the projection carries `sourceLinked: false`, `GET …/conflicts` answers
`resolutionAvailable: false`, and the command still refuses. Making an unlinked
bank unreadable instead would have turned the accepted, counted `UNLINKED` state
(`videoUnlinkedLevels`, a G0 *warning*) into a hard blocker for every level that
was never linked — a change the correction deliberately does not make.

## `NO_CONFLICT` is not `SOURCE_UNAVAILABLE` (CORRECTION-2)

The two are different facts and the platform used to report the second as the
first.

| | meaning |
|---|---|
| `NO_CONFLICT` | the canonical contract parsed, the comparison ran, and the two sides agree |
| `SOURCE_UNAVAILABLE` | the comparison could not be made at all |

An independent re-audit found that an unparseable `contractPayload` produced
`conflictCount` `0`, `blockingConflictCount` `0`, provenance `APPROVED_CURRENT`,
`ready: true`, **and a successful handoff bundle** — for a bank with eight real
unadjudicated disagreements. The defect predates this phase: the swallowing
`catch` in `authoring-read` came from the accepted G1 base, and its comment —
"a payload that no longer parses is reported by validation, not here" — was simply
untrue. `validateLevelAuthoring` never parsed the payload and returned `ok: true`
with zero issues.

When the canonical source cannot be established:

| | |
|---|---|
| `conflictCount` / `blockingConflictCount` | `0`, because **nothing was computed** — never because the sides agree |
| `sourceContractUnavailable` | `true` |
| `sourceContractUnavailableReason` | `SOURCE_CONTRACT_UNPARSEABLE` or `SOURCE_LINK_INCOMPATIBLE` |
| provenance | `SOURCE_UNAVAILABLE` — computed **before** any count is consulted |
| `SourceAuthorityProjection.state` | `SOURCE_UNAVAILABLE`, `comparable: false` |
| readiness | `ASSESSMENT_SOURCE_CONTRACT_UNREADABLE`, never handoff-ready |
| work queue | its own `SOURCE_UNAVAILABLE` bucket — an operator repairs a contract, a reviewer decides a conflict |
| validation | `VIDEO_CONTRACT_UNPARSEABLE`, a **blocker** |
| the command | `AUTHORING_SOURCE_CONTRACT_UNREADABLE` (409) |
| the handoff | refuses; it never falls back to an older linked contract |

No count is invented and no count is trusted: the level is blocked by the **flag**,
because a number cannot express "we did not get to count". The blocker is its own
code rather than `ASSESSMENT_SOURCE_CONFLICT` for the same reason the work-queue
bucket is separate.

**Provenance is `SOURCE_UNAVAILABLE`, not `CONFLICTING`.** Claiming a disagreement
nobody observed would be the same class of error in the other direction.

**Scope.** This is strictly the failure path. A bank whose contract parses and
whose sides agree is still `NO_CONFLICT`, `APPROVED_CURRENT` and handoff-ready,
and a level with no production version at all is unaffected — no proposal is not
an unreadable proposal.

### Error contract

Both new refusals are `409`, for the same reason the handoff refusals are: the
request is well formed and the caller may hold every permission — what is wrong is
the durable **state**, and it becomes right when the linkage or the stored
contract is repaired. `authoringException` serialises the code and nothing else;
no message, stack trace or Prisma internal ever reaches a client.

## Known limitations, deliberately retained

These were raised by the independent audit and are kept, not fixed. Each fails
closed, and a future L2 adjudication session needs to know about all three.

**Evidence identity is immutable once a decision is recorded.** A replay counts as
the same act only if the decision, both value hashes, `evidenceRef` **and**
`evidenceSha256` all match. Re-submitting an already-decided slot under *different*
evidence is therefore refused with `AUTHORING_SOURCE_AUTHORITY_ALREADY_DECIDED`,
at question scope as well as assessment scope. This is intentional: the evidence a
decision was made on is part of the record, and silently rewriting it would let a
second editorial act pass as a replay of the first. The only route to a genuinely
new decision is the one the design already provides — the adjudicated values move,
the decision becomes `STALE`, and `supersedeStale` re-decides it while the old row
survives. Practically: **settle a bank's conflicts in one batch under one evidence
artifact.** L2's seven conflicts fit a single request.

**An exact replay still writes an audit event.** It records `created: 0`,
`superseded: 0`, `unchanged: N`, so it can never be mistaken for a new decision,
and the batch identity is unchanged. The event is kept because a request genuinely
was received and answered; dropping it would make the trail silent about who
re-submitted and when.

**`conflictPath` is a rendering, not a key.** Every lookup — projection and
command — now joins on `(questionIndex, field)`, the identity the partial unique
index itself enforces, so the stored path string can no longer steer a match. The
column stays because a row should be readable without reconstructing it, but no
code path parses it back. Tying the two together at the database level would need
a schema change, and no migration was warranted for a divergence that is now
structurally unreachable.

**Original CURRENT wording is retained by identity, not by copy.** A resolution row
pins the original value by sha256 plus `evidenceRef`/`evidenceSha256`; it never
copies the string, so this table can never become a second, drifting home for
learner-facing text. Historical *identity* is always recoverable from the platform
alone. Recovering the original *wording* after the bank has moved on requires the
external evidence artifact, so **that artifact must be preserved for as long as the
decision matters** — for L2, `l2-conflict-evidence.json` and
`l2-conflict-decision.md`.

## Successor banks (PHASE-G2 SUCCESSOR)

A decision is stored against one `assessmentVersionId`, which is **storage, not
semantics**: what it is *about* is a pair of values at a named slot. A cloned bank
therefore used to report every adjudicated conflict as unresolved again — not
because the adjudication had stopped being true, but because nothing recorded
which bank the clone descended from.

`AssessmentVersion.predecessorVersionId` records that descent, and
`readSourceAuthority` walks it to find a candidate ancestor decision for any slot
the successor has not decided itself. The ancestor's decision is then
**re-evaluated against the successor's own live values** by the unchanged
`evaluateApplication`, plus source-lineage guards. Descent is permission to look,
never permission to apply.

Nothing is copied: the successor owns no resolution row, the predecessor's rows
are untouched, and every inherited decision carries the original adjudicator,
time, rationale and evidence while being explicitly marked `inherited`. A local
decision always overrides an inherited one for its slot.

`bankFingerprintAtDecision` and `assessmentRevisionAtDecision` stay historical
evidence and are **not** inheritance guards — both move for legitimate
non-authority authoring. `contractFingerprintAtDecision` and
`blueprintSourceDocumentSha256` are, because they describe the source side, which
bank authoring cannot move.

Full design: [SUCCESSOR_VERSION_AUTHORING.md](SUCCESSOR_VERSION_AUTHORING.md).

## What this is not

It is not a source-**amendment** mechanism. It decides which of two existing
sources wins; it cannot correct a defect present in both. L18's approved
`SOURCE_BACKED` bank being passable 4/4 by the longest-answer heuristic is that
other, still-open problem, and is deliberately out of scope here.
