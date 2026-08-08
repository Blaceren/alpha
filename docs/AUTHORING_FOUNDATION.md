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
