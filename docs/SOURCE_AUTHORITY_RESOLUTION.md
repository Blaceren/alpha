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
sha, the evidence sha, decider and decision time — sorted by path. It answers
"is this the same adjudication?", and it is bound into the handoff bundle
fingerprint, so two bundles differing only in which authority won are different
handoffs.

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

## What this is not

It is not a source-**amendment** mechanism. It decides which of two existing
sources wins; it cannot correct a defect present in both. L18's approved
`SOURCE_BACKED` bank being passable 4/4 by the longest-answer heuristic is that
other, still-open problem, and is deliberately out of scope here.
