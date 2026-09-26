# ATA Authoring Foundation (Phase G0)

The durable foundation the visual Authoring Studio (G1) is built on: an
editorial lifecycle, four-eyes review, aggregate concurrency, durable
video-production contracts, review notes, and a staff-authorization bridge.

**G0 ships no UI and activates nothing.** `CURRICULUM_V2_ADMIN_ENABLED` remains
off everywhere, no migration was applied to any live database, and no editorial
content was approved.

---

## 1. Two lifecycles, never merged

The single most important decision in this phase is that **editorial readiness
and runtime publication are different axes**, on different columns, changed by
different operations.

| | Column | Vocabulary | Owner | Answers |
|---|---|---|---|---|
| **Runtime** | `status` | `draft / published / archived` | the existing publish domain | "does the runtime serve this?" |
| **Editorial** | `editorialState` | `draft / submitted_for_review / changes_requested / approved` | `authoring-lifecycle.ts` | "did a human editorial process accept it?" |

`published` was **not** reinterpreted as editorial approval. Two facts make that
reading impossible:

- a version can be **approved and unpublished** — the normal case, because
  approval must never activate content for learners;
- a version can be **published and never reviewed** — which is every row that
  existed before this migration.

**`approveVersion` does not publish.** It writes `editorialState`, `approvedById`
and `approvedAt`, and touches nothing else. Activation stays a deployment
decision made by the publish endpoints that already own it.

### What history got

Every pre-existing `ContentVersion` and `AssessmentVersion` — published or not —
migrated to `editorialState = 'draft'`, `revision = 1`, with every actor and
timestamp column `NULL`.

This is the only honest option. There is no submission, no reviewer and no
approval timestamp anywhere in the database for those rows. Defaulting them to
`approved` would invent a decision nobody made, and the ATA-100 package's 154
open editorial gaps would silently read as closed. `draft` states the truth —
*this content exists and no editorial decision is recorded for it* — and costs
nothing at runtime, because the runtime reads `status` and never
`editorialState`.

Proved by `test:regression:authoring-migration` checks 6 and 7.

---

## 2. Permission matrix

Three permissions, appended to the canonical `CRM_PERMISSIONS` (now fourteen).
Every addition **appends**, so no client that pinned an earlier position changes
meaning.

| StaffRole | `curriculum_read` | `curriculum_author` | `curriculum_approve` |
|---|---|---|---|
| `crm_admin` | ✅ | ✅ | ✅ |
| `crm_manager` | ✅ | — | — |
| `content_manager` | ✅ | ✅ | — |
| `read_only` | ✅ | — | — |
| `retention_manager` | — | — | — |
| `mentor` | — | — | — |
| `support` | — | — | — |
| `moderator` | — | — | — |
| `analyst` | — | — | — |

**Every grant is derived from a marker the matrix already carried**, never from
what a role name sounds like:

- **`curriculum_approve` → `crm_admin` alone.** `manage_settings` is this
  matrix's own marker for *owns configuration rather than merely reads it*, and
  `crm_admin` is the only role holding it. Editorial approval decides what the
  product teaches, which is that kind of authority.
  **`crm_manager` was considered and excluded**: it holds `view_audit`, which
  AFD-5A established as the marker for broad supervisory *read*. Granting an
  authority on a read discriminator would be a first for this matrix.
- **`curriculum_author` → `content_manager` and `crm_admin`.** This is
  `content_manager`'s first permission, so the authoring gate demonstrably
  cannot be satisfied by any pre-existing grant. `crm_admin` receives it because
  an administrator who cannot fix a typo routes every correction through someone
  else — and given the self-approval rule, this grant *removes* power in the
  case that matters: an admin who authors a revision can no longer approve it.
- **`curriculum_read` → the two above, plus `crm_manager` (`view_audit`) and
  `read_only`**, whose entire product meaning is *may look, may not touch*.
  `read_only` gaining its first permission is the point: a read-only role
  receiving a read permission cannot widen anything.

`mentor` and `support` receive nothing. They hold learner-facing duties; a
mentor reviews **learners**, never the curriculum.

### Operational consequence

`crm_admin` is the only approving role, so **at least two distinct `crm_admin`
staff profiles are required** for any content a `crm_admin` also authored — or
the author must be a `content_manager`. This is a staffing decision, not a
schema one, and is deliberately visible rather than worked around.

---

## 3. Self-approval rule

> An actor may not approve a revision they authored or submitted.

Enforced in `approveVersion`, **inside the approving transaction**, on identity —
never by the CRM hiding a button. A direct API call by a permitted approver is
refused exactly the same way.

Two actors are checked:

- **`lastAuthoredById`** — the rule as specified: whoever made the latest
  substantive mutation, rewritten on every `revision` bump so it always names
  the actor whose work is under review. (`createdById` cannot serve this: it is
  fixed at creation and says nothing about who wrote the text.)
- **`submittedById`** — checked as well. Submitting asserts the work is ready;
  four-eyes means two humans looked, and an actor who both asserted readiness
  and confirmed it is one human twice. **This is a deliberate strengthening
  beyond the literal specification.**

`NULL` is not a match. A version with no recorded author — every pre-migration
row — excludes nobody. The rule blocks a *known* identity collision and never
guesses one.

Proved by `test:regression:authoring-foundation` checks 10 and 11, including the
case where a *different* actor submitted.

---

## 4. Concurrency

**Aggregate, not per-row.** `revision` on `ContentVersion`,
`AssessmentVersion` and `VideoProductionVersion` covers the version **and every
child under it**:

| Aggregate | Covers |
|---|---|
| `ContentVersion` | localizations (body, title, subtitle, objective, summary, transcript), assets |
| `AssessmentVersion` | questions, question localizations, options, answer key |
| `VideoProductionVersion` | the whole contract payload |

A per-child revision would not have stopped the lost update it exists to stop.
Two editors on one lesson usually touch **different** children — one rewrites a
block, one swaps an image — so per-child guards both succeed and the lesson ends
in a state neither editor reviewed. Guarding the aggregate makes *the lesson
changed under me* the observable event, which is the only event an editor can
act on.

**The contract.** Every substantive mutation requires `expectedRevision`.
`bumpAggregate` runs `UPDATE … WHERE id = ? AND revision = ?` and inspects the
affected row **count** — atomic at the database, not in application logic, so
two transactions cannot both observe `N`. On mismatch it throws
`AUTHORING_REVISION_CONFLICT` (**HTTP 409**) carrying `actualRevision`.

**It must be called in the same transaction as the child write**, so a losing
writer's children roll back with it. Proved directly:

- content: editor A loads `N`, editor B writes a child and moves `N → N+1`,
  editor A's write is refused and **B's title survives byte-identically**;
- assessment: the losing writer's brand-new question row does **not** persist,
  and the winner's answer key is intact.

Last-write-wins is not implemented anywhere.

---

## 5. Review notes

`EditorialReviewNote` — append-only staff commentary about staff authoring work.

- **Not `ReportReview`.** That model reviews a *learner's* submitted report,
  carries rubric scores, and its rows are learner-visible. Reusing it would have
  put staff commentary one join from a learner surface.
- **Three nullable foreign keys, exactly one set.** Enforced by a database
  `CHECK` **and** re-asserted by the domain. The alternative — one untyped
  integer plus a discriminator — carries no referential integrity: a note could
  outlive its target or point at a row of the wrong kind and nothing would
  notice.
- **`targetRevision`** is read inside the transaction, never accepted, so a note
  can never claim a revision that never existed and the UI can mark a note as
  possibly stale rather than reattributing it to new text.
- **No hard delete in the normal workflow.** No `deletedAt`, no delete
  operation. A note is closed by `resolvedAt` / `resolvedById`. Resolving twice
  is an error, not a silent no-op.
- **No learner PII.** No learner relation, no email, no name — there is nowhere
  to put one.
- **`path`** is a closed grammar (identifiers, dots, bracketed integers) so a
  block-highlighting UI never has to guess.

---

## 6. Video-production authority

| Concern | Owner |
|---|---|
| Canonical provenance, bootstrap input | `curriculum/canonical/ata-video-production-contracts.v1.json` (**source**) |
| Editable production draft | `VideoProductionVersion.contractPayload` (**database**) |
| Approved production version | `VideoProductionVersion` at `editorialState = approved` (**database**) |
| Structural product truth (levels, codes, XP, unlocks, ranks) | **source**, unchanged |
| Package handoff | the existing package pipeline (**source-controlled**) |

**No dual-write.** The source file is never written back to. `contractPayload`
is the one writable authoring surface and holds the **exact** accepted contract
object — no production field invented, none dropped.

Everything else on the row is identity, lifecycle, or a **server-derived
projection** of that payload, recomputed on every write by `projectContract`:
`levelNumber`, `contractVersion`, `sourceProvenance`, `scriptState`,
`videoState`, `qaState`, plus the fingerprints. They exist so the readiness view
can filter without deserialising 58 JSON documents; a caller may supply none of
them.

### Fingerprint authority

`calculateContractFingerprint`, `calculateAssessmentFingerprint` and
`isProductionEvidenceStale` are the **existing Phase-C functions**. There is no
second implementation in the authoring domain and none in the CRM.

A caller cannot supply a fingerprint: the accepted contract schema is
`strictObject`, so a payload carrying `contractFingerprint` is **rejected
outright** rather than having the field silently dropped.

**Staleness follows the accepted semantics and this phase does not re-decide
them:**

- a **semantic** edit (take text, question prompt, correct answer) moves
  `contractFingerprint` → evidence reviewed against the old fingerprint becomes
  stale → the UI shows *«Видео QA устарело после изменения контракта»*. The QA
  state is **retained and marked stale**, never silently reset, so the UI can
  say the QA is out of date rather than pretend it never happened.
- a **non-semantic** edit (shot list, target duration, acceptance checklist) is
  excluded from the fingerprint projection, so re-wording a shot list does not
  invalidate 58 recorded videos.

### Provenance is not approval

`sourceProvenance` (`SOURCE_BACKED` / `PROPOSED_CANON`) and `editorialState` are
two columns precisely so they cannot be conflated.

The bootstrap writes **every** row as `editorialState: draft` regardless of the
source contract's own `approval` field. Consequently:

- the **57 PROPOSED_CANON** banks remain proposals;
- **L18** remains `SOURCE_BACKED` and **not approved** — its source
  `AWAITING_APPROVAL` is preserved inside `contractPayload` as provenance;
- the **L2 source conflict** (7 field-level disagreements between the Blueprint
  proposal and the approved first slice) survives unresolved.

There is no code path in this phase that could mass-approve any of them.

---

## 7. Validation ownership

`authoring-validation.ts` **validates nothing itself.** It orchestrates the
accepted validators and translates their output into `AuthoringIssue`:

| Rule | Accepted implementation |
|---|---|
| body schema (v1 + v2) | `parseContentBody` |
| 15-block contract, closed CTA/callout vocabularies, table rectangularity | `contentBodyV2Schema` |
| safe text | `content-safe-text.ts` (`blocks_v2`) |
| asset kind compatibility | `contentBodyAssetReferences` (from `BLOCK_ASSET_REFERENCES`) |
| tool vocabulary | `isProductToolCode` |
| Unicode placeholder detection | `containsPlaceholder` in `package/validate.ts` |
| 4×4 take mapping, T1–T4 | `ATA_VIDEO_*` constants, `parseTakeId`, `takeIdFor` |
| staleness | `isProductionEvidenceStale` |

**The placeholder matcher was exported, not copied.** A second regex is exactly
how the Unicode bug documented in `package/validate.ts` happened — two matchers
drift, one loses its Russian markers, and «Скоро будет доступно» ships to a
learner. One matcher, every caller.

The one thing this module *does* decide is **cross-panel leak detection**, because
nothing previously held the learner body, the answer key and the production
contract at once:

- an internal **take identifier** (`T18.3`) in learner prose → blocking;
- a **correct answer** reproduced verbatim in the lesson body → reported, with a
  24-character floor so ordinary shared vocabulary does not produce a warning
  editors learn to click past.

**Client validation is convenience; the backend is authority.** `approveVersion`
takes `validationPassed` as a **required** argument with no default — a default
of `true` would approve unvalidated content when a caller forgets, and `false`
would silently block every approval.

### Prose floors

- **400 characters** — the submission floor. Separates *a lesson* from *a
  heading and a CTA*. Blocking.
- **1 200 characters** — the ATA-100 editorial-completeness floor applied by the
  package profile. Reported as a **warning**, because refusing to submit a
  legitimately short level for review is not this validator's call.

---

## 8. Source vs durable authoring authority

**Source-controlled (source wins on disagreement):** curriculum structure, level
identity and `stableCode`, completion pairs, XP policy, tool-unlock vocabulary,
ranks, all generic validation logic, and the canonical video-contract
provenance file.

**Durable authoring (database is authoritative):** learner copy, structured
blocks, assessment questions/options/answer keys, asset references, editorial
review state and notes, and the editable production draft.

Where they disagree, **source wins**, and the package importer is the only
legitimate reconciliation path. Phase G0 moves exactly one thing across that
line — the *editable* production draft — because a source file is the wrong home
for an authoring workflow: moving a lesson from `SCRIPT_PENDING` to
`SCRIPT_READY` would otherwise mean an engineering commit per editorial action.

---

## 9. Staff authorization bridge

Two axes already existed, both correct for what they guard:

- `requireAdmin()` → `User.role === "admin"` — what every `/api/admin/**` route
  has always meant;
- `resolveCrmSession()` → `StaffProfile.staffRole` → `CrmPermission[]` — what
  every `/api/crm/**` route means.

**No identity translation was invented, because the two axes are already the
same identity.** Both read the same HMAC-signed `trading_platform_session`
cookie and resolve the same `session.userId`; `StaffProfile.userId` is `@unique`,
so a staff profile is a 1:1 extension of that very `User` row. One cookie, one
User, optionally one StaffProfile.

`gateCurriculumAuthoring` resolves the session **once** and accepts either:

- **Path A (compatibility):** `UserRole = admin` — exactly the authority the 87
  accepted endpoints already grant, so nothing is widened and existing
  integrations keep working byte-identically;
- **Path B (staff):** a `StaffProfile` whose **stored** role grants the specific
  permission the operation needs.

The paths are alternatives, never a merge. A CRM staff actor **does not become
an admin**, gains nothing outside curriculum authoring, and is refused by every
other `/api/admin/**` route exactly as before. No client-supplied role,
permission list or actor id is ever consulted.

Gate order: **flag → actor → rate limit → CSRF**. The flag answers **404** first,
so an environment that has not activated the studio does not disclose that these
routes exist. CSRF is checked last, once the actor is known, so a CSRF failure
can be audited against a real identity.

Server-owned and never accepted from a caller: `actorId`, `approvedBy`,
`approvedAt`, `submittedBy`, `revision`, `contractFingerprint`,
`assessmentFingerprint`, `productionEvidenceStale`, `targetRevision`.

---

## 10. Preview architecture decision

**An `AuthoringPreviewSnapshot` table is required. Existing version ids are not
enough.**

A preview must render an **exact** draft state. Draft rows are mutable by design
— that is what `revision` is for — and the previous state is retained nowhere.
Naming a `ContentVersion` id therefore names a moving target: by the time the
renderer reads it, revision `N` may already be `N+1`, and staff would review text
that no longer exists while believing they reviewed what they clicked. Freezing
the render input is the only way to make a preview exact.

- `snapshotCode` is an **identifier, not a credential**. It is opaque and unique
  so it can sit in a URL path, and it grants nothing: the preview route must
  still resolve the caller's session and re-check `curriculum_read`. **No bearer
  secret ever goes in a preview URL.**
- `payload` freezes only the learner-facing render input and its asset table —
  no internal production metadata, no correct answers, no learner data.
- `(contentVersionId, contentRevision)` and the assessment pair are all-or-nothing
  `CHECK`s: a frozen revision without its version proves nothing, and a snapshot
  with no target is not a preview.

**G0 scope:** the table and its integrity land here so the migration happens
once. The creation domain and the Academy render route are G1.

---

## 11. Migration

One migration: `prisma/migrations/20260808000000_authoring_foundation`.

**Purely additive.** Ten nullable columns plus two defaulted columns on each of
`ContentVersion` and `AssessmentVersion`; three new tables. No existing column is
dropped, renamed, retyped or backfilled with a computed value; no existing row is
rewritten; no table is rebuilt; no learner or runtime table is touched.

SQLite refuses a `CHECK` on `ALTER TABLE ADD COLUMN`, so the two `editorialState`
columns carry their vocabulary in the Prisma enum and the domain layer. The three
**new** tables declare their `CHECK`s inline, which is why exactly-one-target is
a real database constraint.

`prisma/migrate.ts` splits on `;`, so no comment in the migration contains one.

**Rehearsal.** `test:regression:authoring-migration` applies every migration
*before* this one, seeds realistic pre-Phase-G data through that older schema
(published content, a localization, a published assessment bank, an enrollment,
an XP transaction), then applies **only** this migration and asserts every
pre-existing column is byte-identical and no row gained an approval. Applying the
whole chain and then inserting rows would prove nothing about `ALTER TABLE`
against populated tables.

**Rollback.** Dropping the three new tables and the twenty added columns returns
the schema to exactly its previous shape. No data migration is needed in either
direction, because nothing was backfilled.

Not applied to any live database by this phase.

---

## 12. Flag policy

`config/flag-policy/curriculum-v2-flag-policy.{dev,preprod}.schema5.json` moved
to **schema/6**, which adds one optional field: `optional_explicit_boolean`.

`CURRICULUM_V2_ADMIN_ENABLED` moved from `required_false_or_absent` into it. The
key reaches the 87 accepted curriculum admin endpoints the studio is built on, so
the policy has to be able to **authorise** its activation rather than forbid it —
otherwise turning the studio on would always mean editing the policy in the same
breath, and the policy would never be the thing that permitted the change.

**Every safety property is preserved.** The key stays `KNOWN`, so the fail-closed
unknown-`CURRICULUM_V2_` rule is untouched; it must still be exactly `true` or
`false` when present; and **absence remains legal and remains OFF**, because
`isCurriculumV2AdminEnabled()` requires the literal string `"true"`. A key may
not carry two contradictory declarations — the evaluator now fails configuration
that tries.

**Phase G0 sets it nowhere. Live preprod carries no such key and stays that way.**

`CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED` is now **registered** as
`required_false_or_absent` in both profiles. Phase F introduced the key in
`src/lib/env.ts` but no policy declared it, so under `forbid_unknown_prefix` any
environment writing it — even the honest `false` — failed `unknown-flag`.
Declaring it fixes that hole and changes no live value: preprod does not carry
the key, absence is legal, it stays off. **Activation remains a separate, later,
explicit phase.**

The policy files keep their `.schema5` filenames and the suite keeps its
`test:regression:flag-policy-schema5` name: four accepted acceptance manifests
record that script as one they ran, and renaming it would rewrite the history of
already-accepted phases.

---

## 13. Audit

Eight new actions, deliberately distinct from `CONTENT_VERSION_PUBLISHED` /
`ASSESSMENT_VERSION_PUBLISHED` — those record a **runtime activation**, these
record a **human editorial decision**, and an operator reading the trail must
never have to guess which happened:

```
AUTHORING_SUBMITTED_FOR_REVIEW      AUTHORING_REVIEW_NOTE_ADDED
AUTHORING_CHANGES_REQUESTED         AUTHORING_REVIEW_NOTE_RESOLVED
AUTHORING_APPROVED                  AUTHORING_VIDEO_PRODUCTION_CREATED
                                    AUTHORING_VIDEO_PRODUCTION_UPDATED
                                    AUTHORING_VIDEO_PRODUCTION_BOOTSTRAPPED
```

Every row carries actor, action, target type, target id and timestamp. The
approval row additionally records `authoredBy` and `submittedBy`, so the trail
proves the two humans were different without a second query and a later audit can
re-verify the rule held. Note bodies are **not** copied into audit metadata — the
note row is already the durable record, and duplicating staff prose into
`AuditLog` would move it into a table with a different retention story for no
gain.

`AUTHORING_APPROVED` never implies publication.

---

## 14. Test surface

```
npm run test:regression:authoring-foundation   # 39 checks
npm run test:regression:authoring-migration    # 10 checks
npm run test:regression:flag-policy-schema5    # +4 new schema/6 checks
```

Both new suites build a throwaway SQLite database from the migration chain and
delete it. Neither touches preprod, and no test sets
`CURRICULUM_V2_ADMIN_ENABLED` on any real environment.

---

## 15. What G1 still has to build

The foundation is done; **none of the studio is**.

| Area | Remaining work |
|---|---|
| **HTTP** | Authoring routes over the domain: submit / request-changes / approve, review-note CRUD, validation endpoint, video-contract read+write, preview-snapshot create+read. `gateCurriculumAuthoring` exists and is unused by any route in G0. |
| **Concurrency wiring** | The **existing** content/assessment child endpoints (localization, asset, question, question-localization) still do not accept `expectedRevision`. The primitive exists and is proved; threading it through those endpoints and their schemas is G1. Until then those endpoints remain last-write-wins. |
| **Preview** | Snapshot creation domain; Academy staff-gated route rendering the frozen payload through `ContentSections`; staff-only gate; no progress/XP mutation. |
| **CRM Studio** | Overview, filters, level editor, 15-block editor, assessment editor, production panel, L2 conflict surface, review surface, readiness view. G0 added permission vocabulary only — no section, no route, no page. |
| **Package handoff** | Deterministic projection of approved authoring content into the canonical package, with validation before anything may claim approved. |
| **Activation** | `CURRICULUM_V2_ADMIN_ENABLED` is now *permitted* on dev/preprod; turning it on is a separate explicit phase, as is `CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED`. |
| **Editorial closeout** | The 154 gaps (77 `ATA100_CONTENT_NOT_AUTHORED` + 77 `ATA100_CONTENT_NOT_PUBLISHED`), the 57 proposals, L18's approval and the L2 conflict are all **untouched** and remain the G2 work queue. |

---

# PHASE-G0 FOUNDATION CORRECTIONS

The independent audit `ATA-PRODUCT-PHASE-G0-FINAL-TARGETED-AUDIT-1` found one
BLOCKER and two MEDIUM gaps in the foundation above. This section records what
changed, and — as importantly — what deliberately did not.

## The BLOCKER: a whole mutation surface obeyed none of the new rules

G0 built the editorial lifecycle, the aggregate revision and the four-eyes rule,
and wired them to **nothing**. The 30 accepted `/api/admin/curriculum/**`
mutation endpoints kept writing `ContentLocalization`, `ContentAsset`,
`QuestionDefinition` and `QuestionLocalization` with no `expectedRevision`, no
`editorialState` read and no author attribution — and `gatePhase4Admin` and
`gateCurriculumAuthoring` are governed by the **same**
`CURRICULUM_V2_ADMIN_ENABLED` flag, so activating the Studio activated the
unguarded surface with it.

Because approval deliberately does not publish, an APPROVED version stays runtime
`draft`, and `assertDraftContent` only ever inspected runtime `status`. The
approved state was therefore the *most* exposed, not the least.

### One boundary, not a second API

`authoring-mutation-guard.ts` is the single entry point. It is a thin, named
wrapper over the G0 primitives — `bumpAggregate` still does the work — and it is
called from the **domain commands**, not from the routes. A route-level check
would have left `updateContentLocalization()` unsafe for scripts, the importer
and the future Studio. There is deliberately no `legacySafeUpdate` beside a
`studioSafeUpdate`: G1 will call the very functions the legacy routes call.

The accepted routes keep their exact paths and methods.

### The revision transport contract

`expectedRevision` is a **required body field** on every substantive mutation: a
positive integer, `1 .. 2147483646`, validated by the accepted `strictBody` path
because every Phase-4 route already parses a strict JSON body. It rides the
command schemas, so omitting it is a schema rejection before any transaction
opens.

There is **no defaulting**. A `expectedRevision ?? current.revision` anywhere
would restore last-write-wins, so the surface guard suite fails the build if such
a pattern ever appears.

DELETE routes that previously accepted an empty body now accept exactly this one
field.

### What is guarded, and what is not

| Operation | Class | Guarded |
|---|---|---|
| content/assessment version PATCH, DELETE | authoring (aggregate root) | **yes** |
| localization POST/PATCH/DELETE | authoring (learner text) | **yes** |
| asset POST/PATCH/DELETE | authoring (learner media) | **yes** |
| question POST/PATCH/DELETE | authoring (assessment semantics) | **yes** |
| question localization POST/PATCH/DELETE | authoring (prompt, options) | **yes** |
| version POST (create) | aggregate creation | no — there is no revision to be stale against until the row exists |
| publish, archive | runtime lifecycle | no |
| content-binding, assessment-binding | structural resource binding | no |

Deleting an aggregate uses `guardAggregateSelfMutation`: it cannot bump a
revision it is about to destroy, but the editorial state and the expected
revision are still both checked, so an approved version cannot be erased outright.

### A refusal is a product answer, not an internal fault

`runSanitized` in both domains deliberately masks unrecognised errors as
`*_INTERNAL_ERROR`. It now re-throws `AuthoringDomainError` unchanged. Masking it
would have turned "the lesson moved under you" into an opaque 500 and discarded
the `actualRevision` an editor needs in order to reload. `phase4Exception` maps
the vocabulary through the domain's own `authoringErrorStatus`: 409 for a
conflict or an immutable state, 403 for self-approval, 422 for a validation
refusal.

## PUBLISH DOES NOT REQUIRE EDITORIAL APPROVAL — reported, not changed

`publishContentVersion` and `publishAssessmentVersion` consult runtime `status`
and the accepted publication validation. Neither reads `editorialState`. **A
version that no human has editorially approved can still be published**, which
means the new review workflow can be bypassed at the publication step by anyone
holding the existing publish authority.

This is left **exactly as it is**. The correction was asked to enforce reachable
authoring mutations, not to invent publication policy, and coupling publication
to `editorialState` would change what the platform is allowed to serve — a
product decision with its own migration and rollout questions. It is recorded
here as the open decision it is: *should runtime publication require
`editorialState = approved`?*

## MEDIUM: video evidence could not go stale

G0 stored an `assessmentFingerprint` computed from the video contract's own
embedded questions, so both sides of every comparison came from the same JSON
document and editing the real bank changed nothing.

`VideoProductionAssessmentLink` is a new table, not three nullable columns,
because SQLite refuses a CHECK on `ALTER TABLE ADD COLUMN` and a half-set link is
a **false** link rather than a partial one. Every column is NOT NULL, so "linked"
is a row that exists. `videoProductionVersionId` is UNIQUE: one bank per
contract, and an ambiguous level gets no row at all.

`authoring-assessment-projection.ts` reads `QuestionDefinition` and its canonical
`ru` `QuestionLocalization` and returns the accepted fingerprint input.
**It hashes nothing** — `calculateAssessmentFingerprint` does, unchanged.

Take **identities** (`T{level}.1..4`) are included; take **text** is not. Take
text is a video artifact already covered by `contractFingerprint`, and including
it would have meant rewording a shot marked the *question bank* as changed —
false, and exactly the kind of warning reviewers learn to ignore.

Staleness is **derived on read**, never written. Writing a flag during assessment
mutation would take a lock on an unrelated aggregate inside someone else's
transaction and create a second copy of a fact that is already derivable. The
bank is the only authority for what the bank says; the stored fingerprint is
evidence of what was *reviewed*.

`readVideoProductionCoherence` reports a closed vocabulary: `UNLINKED`,
`COHERENT`, `ASSESSMENT_BANK_CHANGED`, `ASSESSMENT_REVISION_MOVED`,
`ASSESSMENT_UNPROJECTABLE`. An unlinked contract reads **stale**, never fresh —
absence of evidence is not evidence of freshness.

### L2, L18 and the 57 proposals are untouched

`resolveCanonicalAssessmentVersion` prefers the `LevelResourceBinding`, which is
what the runtime actually serves. That is what keeps L2 honest: its existing
bound bank stays the durable identity and the Blueprint's PROPOSED_CANON
questions remain a proposal inside `contractPayload`. L18 stays SOURCE_BACKED and
unapproved. The bootstrap links where it can and **counts** what it could not
link rather than guessing.

## MEDIUM: the preview snapshot could not pin video production

Two nullable columns plus a real FOREIGN KEY (which `ALTER TABLE` does accept).
The pairing rule is domain-enforced in `authoring-preview-snapshot.ts` and proven
by regression, for the same SQLite reason G0 documented for `editorialState`.

Every revision is **read server-side** inside the transaction, never accepted, so
a caller cannot claim a snapshot was taken at a revision that never existed. The
existing `has_target` CHECK is left alone: a preview is a learner frame, and a
video production contract is production metadata attached to a lesson, never a
lesson on its own.

Learner frame and internal metadata stay separable: `payload` holds the
learner-facing render input, and the internal side is reachable only through the
pinned **ids** by a separately authorized staff-side reader. `snapshotCode`
remains an identifier — nothing in the domain or the authorization layer treats
possession of it as permission.

## LOW: a note could be resolved by knowing its id

`resolveReviewNote` now requires the aggregate target and verifies the note
belongs to it. A mismatch is reported as `AUTHORING_NOTE_NOT_FOUND` rather than a
distinct code, because "that note exists, but not here" would confirm the
existence of notes on aggregates the caller was never authorized to see.

## LOW: a four-eyes refusal left no trace

It is now recorded — **outside** the refused transaction, because a row written
inside it would roll back with the refusal. The write runs only on the throw
path, so it can never manufacture a record for an approval that succeeded; the
original error is rethrown unconditionally; and if the audit write itself fails
the outcome is a refusal with no record, which is exactly the previous behaviour.
It carries actor, target, action, reason and time, and **no draft content**.

---

# PHASE-G0 PUBLISH GATE

The corrections above closed the reachable authoring mutations but left one
question open and explicitly reported it: *runtime publication did not consult
`editorialState`, so a version nobody approved could still be published.* That
decision has now been taken.

## The rule, and its deliberate asymmetry

**Approval does not publish. Publication requires approval.**

The two lifecycles remain independent — this is a precondition, not an
equivalence:

- `approveVersion` still touches no publication column and no binding. Deciding
  content is correct and deciding learners should receive it are different
  decisions, frequently made by different people, and the correction preserves
  that: the approver and the publisher in the regression are deliberately
  different actors.
- `publishContentVersion` / `publishAssessmentVersion` now refuse unless
  `editorialState = approved`. Nothing on the publish path writes
  `editorialState`, `approvedById` or `approvedAt`, so publishing can never
  manufacture the approval it demands.

## One invariant, not a Studio-only check

`assertEditoriallyApproved` lives in `authoring-lifecycle.ts` beside
`assertEditable`, and each publish transaction calls it exactly once, from
inside its own transaction, reading the snapshot it had already loaded. There is
no second implementation and no per-caller variant — a `UserRole=admin` calling
the legacy route directly is refused identically, and the regression asserts
that no local `editorialState === "approved"` comparison exists anywhere else.

Both publish command schemas are `strictObject` with no editorial field, so the
gate cannot be satisfied from the wire: smuggling `editorialState`,
`approvedById` or `approvedAt` into the body is a schema rejection.

## It guards the transition, not the history

Every row that predates the G0 migration is `published` with
`editorialState = draft`. That combination stays **legal, readable and
untouched**. The check runs on the way *into* `published` and nowhere else —
asserting it over stored rows would have meant either unpublishing live lessons
or backfilling approvals nobody granted, which is precisely the fabrication the
G0 migration was written to avoid. Archive, a runtime *removal*, remains
available on those rows, so the existing estate stays operable without inventing
an approval for anything.

## Content and assessment gate independently

No atomic paired publication was invented — the product still allows a level to
carry a published lesson and no published bank. What the regression proves is
that approval does not travel: publishing an approved lesson does not carry its
unapproved assessment into the runtime, and approving a bank does not license an
unapproved lesson.

## Error contract

The gate runs **after** the accepted publication validation and **before** any
write. Both are preconditions, so the safety is identical either way, and this
order preserves every accepted diagnostic: an author whose lesson is missing a
localization still receives `CONTENT_PUBLICATION_INVALID` with its issue codes
and its audit row, rather than being told only "get it approved" and discovering
the real problem after review. Governance is the last thing standing between a
valid version and the runtime.

One consequence worth stating plainly: an APPROVED version that then fails
publication validation is immutable, because approved evidence may not be edited
in place. The remedy is the documented one — create a new version. That is not a
new rule; it is the approved-immutability rule meeting the publish gate.

`AUTHORING_APPROVAL_REQUIRED`, mapped to **409** by the domain's own
`authoringErrorStatus`. It is its own code rather than `AUTHORING_STATE_INVALID`
because the remedy differs: the transition is legal and the caller may well hold
publish authority — what is missing is the product precondition, and the answer
is "get it reviewed". Both publish wrappers now re-throw `AuthoringDomainError`
unchanged rather than flattening it into a 500, for the same reason the mutation
boundary does. No database detail is exposed.

## No migration

This is a domain invariant over the existing G0 schema. `prisma/` is untouched
and the migration count stays 44.

---

# PHASE-G1 — THE STUDIO ON TOP OF THIS FOUNDATION

G0 §15 listed what G1 still had to build. This records what it built, and the
two things the foundation itself needed changing for.

## The domain gate had to widen too, not only the HTTP edge

G0's §9 bridge was written for the HTTP layer, and the correction wired it to
nothing. Wiring it to the accepted `/api/admin/curriculum/**` routes was not
sufficient: `content.ts` and `assessment.ts` carry their OWN actor assertions
(`CONTENT_ACTOR_FORBIDDEN`, `ASSESSMENT_ACTOR_FORBIDDEN`), which is what makes
those commands safe for a script, the importer and any future caller that never
passes through a gate. The first G1 test run showed the consequence plainly:
every studio save was refused by the layer beneath the one that had been opened.

So `assertContentAuthor` / `assertAssessmentAuthor` accept the SAME two
alternatives the bridge does — `UserRole=admin`, or a stored StaffProfile role
granting `curriculum_author` — resolved through the same accepted
`resolveEffectivePermissions` / `canAuthorCurriculum` pair. There is no second
permission table.

`assertContentAdmin` / `assertAssessmentAdmin` are UNCHANGED and still guard
publication, archival and resource binding. A content editor cannot activate
content for learners or rebind a level, and that refusal lives in the domain
rather than in a hidden button.

## The publish gate stands, and so does the historical carve-out

Nothing in G1 publishes. `approveVersion` still touches no publication column,
the approve route returns `published: false` explicitly, and the studio has no
control named «Опубликовать» anywhere. Rows that are `published` with
`editorialState = draft` remain legal; the studio labels them as historical and
never offers them as a shortcut to approval.

## No schema change

`prisma/` is untouched. The migration count stays 44. Everything G1 needed —
the lifecycle, the aggregate revision, review notes, the preview snapshot with
its three pins, the production contract and its assessment link — was already in
the G0 schema.

## What G1 added

| Area | What |
|---|---|
| Read projections | `authoring-read.ts` — the 100-level overview and one level's workspace, computed server-side and returned summary-shaped |
| Readiness | `authoring-readiness.ts` — separate named counts, handoff blockers and the G2 work queue. No percentage anywhere, and no ATA backlog total is written in the file |
| Blueprint comparison | `authoring-conflict.ts` — field-level differences between the durable contract's proposal and the bound bank, derived from server truth. READ-ONLY: there is no resolution command, and the response says so |
| Validation service | `authoring-validation-service.ts` — loads the aggregates and runs the ACCEPTED validators. Adds no rule |
| Preview | `authoring-preview.ts` — the learner-safe payload builder (whose Prisma select does not contain `correctAnswer`) and the two reads: the frozen learner frame, and the staff drift inspection |
| Version clone | `authoring-version-clone.ts` — §36/§37. One transaction, `revision: 1`, `draft`, source byte-identical afterwards |
| Handoff | `authoring-handoff.ts` + `scripts/curriculum/emitAuthoringHandoff.ts` — a deterministic, fingerprinted bundle. Refuses ambiguity and unresolved content; writes no curriculum row; never reaches git |
| HTTP | 20 narrow routes under `/api/admin/curriculum/authoring/**`, plus the accepted Phase-4 surface widened to curriculum staff |

## Test surface

```
npm run test:regression:authoring-studio        # 31 domain checks
npm run test:regression:authoring-studio-http   # 47 checks against the real routes
```

The HTTP suite closes the G0 LOW-1 gap: check `PIN` pins a snapshot at content 4
/ assessment 7 / video 3, moves all three aggregates to 5 / 8 / 4, and requires
the real preview route to still answer 4 / 7 / 3 with the frozen body. A
follow-latest implementation fails it.

Cross-repo, both candidates and a disposable database:

```
node <backend>/node_modules/tsx/dist/cli.mjs \
  scripts/phaseG1CrossRepoIntegration.ts --backend <backend>   # in the Academy worktree
```

## The ATA take-slot invariant (engineering)

`T{level}.1` … `T{level}.4` are **positional slots**, not a reassignable
mapping. For every ATA video-profile assessment:

```
QuestionDefinition.stableKey === takeIdFor(levelNumber, questionNumber)
```

stated once, in `authoring-level-profile.expectedTakeIdFor`, and asked by the
validator, the readiness projection, both assessment mutation commands and the
importer. `occupiesCanonicalTakeSlot` and `takeSlotViolation` are the only
predicates over it.

**Why positional.** `authoring-assessment-projection` has always derived a
question's `takeId` as `takeIdFor(levelNumber, ordinal)` where `ordinal` is
`questionNumber`, and `VideoProductionVersion.assessmentFingerprint` is computed
over that projection. The G1 closeout measured what happened when the stored key
and that derivation disagreed:

| reader | binding after a Q1↔Q2 permutation |
|---|---|
| `validateAuthoringAssessment` (old rule: complete set) | accepted |
| handoff bundle (`stableKey`) | Q1 → `T5.2` |
| projection / video evidence fingerprint (positional) | Q1 → `T5.1` |

Two durable artifacts, contradictory facts, nothing detecting it. The evidence
*did* go stale — but only because the projection's `questionId` field carries
`stableKey`; re-approving recomputed the fingerprint over the unchanged
positional binding, so the staleness cleared while the contradiction remained.

**The resolution aligns the product with the fingerprint, not the reverse.**
`calculateAssessmentFingerprint` is untouched and no bank fingerprint moved. What
changed is that a permutation is no longer a state the domain will accept:

* the write schemas still permit the generic lowercase vocabulary, because
  non-ATA banks depend on it — the slot rule is applied only where
  `isAtaVideoProfileLevel` holds;
* `updateAssessmentQuestion` and `createAssessmentQuestion` assert the pair that
  results from the write, so the two halves cannot be moved apart one call at a
  time;
* `questionNumber` cannot be changed on an ATA bank at all, because it is half of
  the take identity and renumbering would be reassignment under another name;
* the validator reports `ASSESSMENT_TAKE_SLOT_MISMATCH` per question rather than
  asserting set membership;
* `mappedTakeCount` counts questions **in their own slot**, so readiness and the
  handoff cannot drift from the validator.

**A patch that touches neither field is left alone on purpose.** An imported or
legacy bank that is already out of slot must stay editable enough to be
repaired; validation, approval, readiness and the handoff all keep refusing it
until it is.

`@@unique([assessmentVersionId, stableKey])` makes a *duplicate* take
unreachable even with raw table access, so the only adversarial shape that needs
defending is the permutation — and
`curriculumAuthoringTakeSlotGateRegression` forces one, plus a missing take, a
generic key and a foreign-level take, and proves each closes validation,
approval, readiness and both handoff scopes.
