# Editorial Transport — structural package + editorial overlay

How an accepted editorial baseline moves from the database it was produced in to
a different one, without re-running human review and without depending on row
ids that mean different things in the two places.

**Nothing described here publishes anything.** Importing an overlay makes a
curriculum *approvable*. It does not make it live.

---

## 1. Two layers, two jobs

| Layer | Artifact | Carries |
|---|---|---|
| 1. Structural | `CurriculumPackage` (`curriculum/packages/*.json`) | the **pre-editorial baseline**: modules, levels, the content bodies and banks as they stood when the file was cut |
| 2. Editorial | `EditorialOverlay v2` (`ata.editorial-overlay/2`) | the **reviewed payload delta** — the bodies, banks, answer keys and localizations the review actually produced — **and** the evidence for it: who authored, submitted and approved each version and when; video production contracts; video↔bank links; source-authority history; review notes; the principals all of that refers to |

**The structural package is a PRE-EDITORIAL baseline, not the approved state.** A
review phase edits content, and the accepted G2 corpus edited a great deal of it:
77 of 79 content bodies and 164 of 236 correct answers changed after the package
was cut. The package cannot know that — it was written first.

So the overlay carries both halves of what a review produced. An earlier version
of this format carried only the evidence, on the assumption that the package
already held the approved bytes. It did not, and the result was content marked
`approved`, signed by the reviewer, at the reviewer's timestamp, over the
pre-review skeleton — which `publishContentVersion` then accepted. **Approval
evidence is only valid over the payload it approved**, and v2 enforces that
rather than assuming it.

`ata.editorial-overlay/1` is refused by name. It is not a subset of v2: reading
one would mean treating its silence about the payload as "payload unchanged",
which is exactly the defect.

They stayed separate on purpose. The package's `contentFingerprint` is the anchor
proving a target's structure came from one specific file; extending the package
schema would change that fingerprint and invalidate every artifact, validator and
roundtrip test built on it.

---

## 1b. Structural baseline, accepted state, and the three-way rule

Every entry the package also carries declares **two** hashes over the same
normalisation (`src/lib/curriculum/editorial-overlay/payload.ts`):

| Hash | Means |
|---|---|
| `expectedStructuralHash` | what the target holds if it has had the structural import and nothing else. Projected **from the package**, through the structural importer's own `questionCode → stableKey`, `optionCodes → options`, `correctOptionCodes → correctAnswer` mapping — never inferred from the edited checkpoint, which no longer contains the pre-review bytes |
| `acceptedReviewedHash` | what the reviewer approved, and what the target must hash to when the import finishes |

The importer then has three answers and no fourth:

```
target == expectedStructuralHash  →  write the reviewed payload
target == acceptedReviewedHash    →  already imported, unchanged
anything else                     →  CONTRADICTION, refuse before any write
```

There is no "overwrite whatever is there". A target holding a third state — a
changed answer, an edited body, a deleted question — is a fact this import has no
authority to erase, and it never receives an approval.

**The invariant, asserted inside the transaction:** before the commit, every
content and assessment version that carries imported approval is re-read and
proven to hash to its `acceptedReviewedHash`. If it does not, nothing is written.

**What the reviewed hash covers:** every learner-visible string and JSON body, the
answer key, the option set, the stable/take key, the question number, the pass
mark, the attempt limit, the explanation policy.

**What it deliberately does not, and why:**

- row ids and foreign keys — target-local by construction;
- `updatedAt` — Prisma's `@updatedAt` owns it; it records when a row was last
  written *in this database*;
- `status` / `publishedAt` / `archivedAt` — PUBLICATION lifecycle. This transport
  never publishes, and an operator publishes content *after* the import;
  including them would make a replay fail the moment that happened;
- `revision` and the four-eyes actors and instants — carried and compared
  separately, as evidence rather than as content.

`createdAt` on a version **is** carried, in both modes. A structural import stamps
the instant it ran, so without it a transported version reads as created today and
submitted for review a week earlier — a chronology that is not untidy but false.

## 1c. Level structural identity

A `stableCode` is only a name. The overlay's `levels[]` binds each code to the
`levelNumber`, module and type the package gives it, and preflight checks the
target against that. A target where two levels have **swapped** codes — the right
set, the wrong rows — fails before any write, instead of giving one level's
approval to another level's content.

---

## 2. Why no row id travels

The editorial source and a live target overlap in **every** integer id space —
`CurriculumVersion`, `LevelDefinition`, `ContentVersion`, `AssessmentVersion`,
`QuestionDefinition`, `AuditLog` and, most dangerously, `User`. In the accepted
corpus, source `User` 2 is the reviewer who approved 194 aggregates; in live
PREPROD, id 2 is an unrelated support account. A transport keyed on raw ids would
attribute that reviewer's work to someone who never did it.

A structural import then introduces a **third** id space, because it allocates
fresh ids in the target.

So the overlay addresses things by what they mean:

| Entity | Key | Backed by |
|---|---|---|
| Curriculum | `(code, versionNumber)` | `CurriculumVersion_code_versionNumber_key` |
| Level | `stableCode` | `LevelDefinition_curriculumVersionId_stableCode_key` |
| Content / Assessment version | `(level.stableCode, versionNumber)` | the per-level version unique indexes |
| Question | `(assessment key, stableKey)` | `QuestionDefinition_assessmentVersionId_stableKey_key` |
| Video production | `(level.stableCode, versionNumber)` | `VideoProductionVersion_levelDefinitionId_versionNumber_key` |
| Video↔bank link | the video's key (one link per production) | `@unique` on `videoProductionVersionId` |
| Authority decision | `(assessment key, questionIndex, field)` | `SourceAuthorityResolution_active_slot_key` |
| Review note | `noteKey` — a hash of target, revision, author, time and body | none exists; see §7 |
| Principal | canonical address + declared `kind` | `User.email` |

Every key is backed by a real unique index, so resolution is deterministic by
construction rather than by convention.

---

## 3. Historical principals

The editorial layer refers to process identities — an author role and a reviewer
role — under `.invalid`, which RFC 2606/6761 reserves as guaranteed
non-resolvable. They are **not** mailboxes and not people. The overlay says so
explicitly: each principal declares `kind: "process" | "human"`, so the importer's
safety rules read a declared fact instead of re-deriving a naming convention.

**Matching a process principal requires a non-loginable target account.** Address
equality is not identity equality, and neither is address plus role: an account at
the same address that can still *log in* is a different thing — very possibly a
real person — and attaching a review's approvals to it would attribute that review
to whoever holds it. So a `process` principal matches only a target user whose
status is `blocked`; an `active` account with the same address and the same roles
is a refusal, before any editorial write. The human account is never demoted to
make it fit. What their evidence
asserts is *"an author-role principal authored this and a **distinct**
reviewer-role principal approved it, so four-eyes was satisfied"*, and that
survives being re-established elsewhere under the same address and role.

Rules the importer enforces:

- resolve by address only;
- require `role` **and** `staffRole` to match — an account reusing an address
  with a different role is a different principal, and binding a reviewer's
  approvals to it is precisely the misattribution the model exists to prevent;
- **never** substitute the operator, an admin, or a live user whose integer id
  happens to collide;
- fail before any editorial write when a principal is missing or incompatible.

An overlay may mark a principal `provisionIfMissing`. The exporter sets that only
for `.invalid` addresses; a real account must already exist. Even then the
importer will not create it unless the caller passes
`--allow-principal-provisioning`, because minting identities is an identity
operation, not a data one.

Provisioned principals are created **`status = "blocked"`** with a locally
generated, non-recoverable password placeholder. The login route rejects
`blocked` with 403, so the row can carry history and can never act. No credential
is ever read from the source or written into an artifact.

Nothing in the domain requires a *historical* actor to be active — liveness is
asserted only for the actor **performing** an operation (`assertAdminActor`).

---

## 4. Four-eyes provenance and timestamps

Transported per aggregate: `editorialState`, `revision`, `lastAuthoredBy/At`,
`submittedBy/At`, `changesRequestedBy/At`, `approvedBy/At`, and `createdBy`.

Historical instants stay historical. A content version approved on 2026-08-09 and
imported on 2026-08-10 still reads `approvedAt = 2026-08-09`, and still reads it
after it is published. Writing `approvedAt = now()` would assert a review that
happened today; writing the operator's id would assert they performed it.

`updatedAt` is the one timestamp deliberately **not** carried. Every transported
model declares it `@updatedAt`, so the ORM owns it: it records when a row was last
written *in this database*, which after an import genuinely is now.

---

## 5. Source authority is evidence transfer, not adjudication

The overlay carries each decision verbatim: `decision`, both value hashes, the
Blueprint document sha, the contract and bank fingerprints, the bank revision at
decision time, the rationale, the evidence ref and its sha, the batch id, and the
original `decidedBy`/`decidedAt`.

The importer writes those rows directly and **never** calls the adjudication
command, which would stamp a fresh actor, time, batch and audit event and thereby
claim the decision was made during an import.

What the overlay does **not** carry, because the domain derives it:
`application` (`APPLIED` / `STALE` / `DECIDED_NOT_APPLIED`), `inherited`,
`originAssessmentVersionId`, `inheritanceDepth`, `linkOrigin`,
`linkLineageDepth`. `evaluateApplication()` is a pure function of the stored
hashes against the target's live values; transporting its conclusion would let an
overlay assert a decision is in force when the bank no longer serves the value
that won.

On the accepted corpus, after transport the domain independently recomputes the
L2 successor as `linkOrigin = lineage`, `linkLineageDepth = 1`,
`ADJUDICATED_CURRENT`, 7 raw / 7 resolved / **0 blocking**, 7 decisions, **7
inherited, 0 local**, `CURRENT` ×7, `APPLIED` ×7.

### The link that looks wrong and is not

One video production links to the **predecessor** bank rather than the level's
latest one. That is the design: the predecessor owns the physical link and the
approved successor derives its source through lineage. Rewriting it to point at
the successor would be tidier and would destroy the evidence `linkOrigin =
lineage` exists to express. The overlay transports it verbatim.

---

## 6. Cross-database fingerprint caveat

`resolutionFingerprint` and the authority lineage fingerprint both hash
target-local integers (`decidedById`, `originAssessmentVersionId`). Two databases
holding **identical** editorial truth will therefore produce **different** values
for them.

This is not a defect to route around by changing the algorithms — doing that
would alter already-accepted artifacts. It means:

- byte equality of those fingerprints is **not** a semantic-equivalence criterion
  and must be excluded from cross-database comparisons;
- within a single database they remain deterministic and meaningful;
- an authoring handoff bundle is an environment-local artifact. A bundle produced
  after transport will never be byte-identical to one produced in the source,
  even when nothing editorial differs. Compare semantics, not bytes.

---

## 7. Idempotency, atomicity, contradiction

**Idempotency.** Applying the identical overlay twice reports everything
`unchanged` and writes no row — payload included. Each class has an identity:
version keys for aggregates, the unique link column, the active-slot index for
authority, and `noteIdentity` for review notes, needed because
`EditorialReviewNote` has no unique index at all.

`noteIdentity` is **which** note — target, revision, path, author, instant, plus
an ordinal for the case where one author really did leave two notes at the same
millisecond on the same aggregate. It deliberately does **not** include the body.
An earlier version hashed the body in, so a target note whose text had been
altered simply failed to match and a replay wrote a second one beside it. The body
is now COMPARED against whatever carries that identity: equal is `unchanged`,
different is a contradiction, and neither ever creates a duplicate.

`mode` (`update` / `create`) states what the **structural package** carries, not
what the target must lack. After a first apply the successor exists; a replay
recognises it rather than treating its own earlier work as a collision.

**Atomicity.** The whole editorial layer, including any principal provisioning
and the import audit event, is one transaction. A failure anywhere leaves zero
partial state — no half-approved content, no orphaned authority rows, no
provisioned principals.

**Contradiction is a refusal.** A target already holding *different* truth fails
closed **before** the transaction opens, read-only. Overwriting would erase a fact
the import has no authority over. Only a row at the structural baseline (`draft`,
no author, no submission, no approval) may be moved editorially, and only a
payload at `expectedStructuralHash` may be replaced.

Every transported field participates, not a sample of them. A source-authority row
is compared on all seventeen of its historical fields — including `rationale`,
`evidenceRef`, `evidenceSha256`, `batchId` and the three at-decision fingerprints —
and a video production on its whole state including `contractPayload`. Reporting
`unchanged` while the evidence differs would be the quietest possible way to lose
history, so a difference anywhere is a contradiction.

**Dry run.** `--dry-run` performs parsing, validation, full structural preflight,
the payload three-way, principal resolution and every contradiction check, then
reports the counts the real apply would produce — including how many reviewed
payloads would move — and writes nothing. It provisions no principal and emits no
audit event. The file is byte-identical afterwards.

---

## 8. The import audit event

One `G2_EDITORIAL_BASELINE_IMPORTED` row against the target curriculum, carrying
the overlay fingerprint, the source checkpoint sha, the structural package
fingerprint, the source backend commit and tree, per-class counts, the principal
map, and the operator's id.

It records the **import**. It is not, and must never be read as, an approval or
an adjudication — that evidence lives on the rows, with its original actors and
times. Historical `AuditLog` from the source is deliberately **not** copied:
those actions did not happen in this database, and asserting they did would
corrupt the one log an operator needs to trust.

---

## 9. Protected-database guard

Both importers share `src/lib/curriculum/protected-database.ts`, which protects
**files, not names**:

0. **fail closed where protection could not be established.** An explicitly
   configured protected database (`DATABASE_URL`, `ATA_PROTECTED_DATABASES`, a
   deployment `.env`) whose identity cannot be resolved — it exists, or may exist,
   but cannot be `stat`-ed — leaves the inode comparison with nothing to compare
   against, and every alias of it then reads as an ordinary file. That is refused
   outright (`PROTECTED_IDENTITY_UNRESOLVED`). The refusal is scoped to
   *configured* entries: the conventional floor names runtime databases that
   legitimately do not exist on most hosts, and an absent file has no alias, so
   refusing every import because a DEV path is missing would protect nothing;
1. a coarse substring net over the requested path, so a protected database
   that is not mounted here is still refused;
2. symlinked targets refused outright — resolvable or not, which closes the
   dangling-symlink hole that used to fail open;
3. an unresolvable parent directory refused;
4. `(st_dev, st_ino)` identity against the protected set — this is the
   load-bearing check, and it closes hardlinks, bind mounts, `../` traversal,
   second mount points and any alternate name in one comparison;
5. resolved-path equality and a second substring pass.

The protected set is the built-in floor (which includes live PREPROD) plus
anything discovered from `DATABASE_URL`, `ATA_PROTECTED_DATABASES` and readable
runtime EnvironmentFiles.

`assertSafeDatabaseTarget` returns the resolved path, and callers open **that**,
never the raw argument. `assertTargetIdentityUnchanged` re-verifies immediately
before connecting, narrowing the TOCTOU window to that interval; it cannot close
it entirely, which is documented on the type.

**There is no bypass.** A future privileged path that intends to write a runtime
database must bring its own audited mechanism.

---

## 10. Commands

```bash
npm run curriculum:overlay:export -- \
  --source file:/abs/path/to/accepted-checkpoint.sqlite \
  --package curriculum/packages/ata-v2-canonical-100.draft.json \
  --out curriculum/overlays/ata-v2-g2-editorial.json

npm run curriculum:overlay:validate -- --overlay curriculum/overlays/<file>.json

npm run curriculum:overlay:import -- \
  --overlay curriculum/overlays/<file>.json \
  --database file:/abs/path/to/disposable-target.sqlite \
  --dry-run

npm run test:regression:editorial-overlay
```

`--allow-principal-provisioning` enables §3. `--import-actor <userId>` names the
operator for the audit event.

**The exporter requires the structural package** (`--structural-package`, or the
older `--package`): the baseline half of every three-way comparison is projected
from it, and the exporter refuses if the checkpoint's package marker does not
match the file it was handed.

**The exporter never opens the source with a writable client.** It byte-copies the
checkpoint into a private `0700` temp directory, runs every query against the
copy, deletes the copy, and re-checks the source's size, mtime and digest before
returning. Read-only by construction, not by intent.

---

## 11. Ordering, and what is out of scope

The transport is a **data** step. Activation is separate and has an irreversible
trap in it:

```
migrate → structural import → overlay import → verify
        → publish CONTENT (all of it)
        → publish CURRICULUM
        → flags → smoke
```

**Content must be published while the curriculum version is still `draft`.**
Publishing the curriculum first makes its content immutable
(`CONTENT_PUBLISHED_IMMUTABLE`), and curriculum publication cannot be undone by
any domain primitive — `publishCurriculumVersion` accepts only drafts and no
unpublish exists. After that point the only rollback is a database restore.

The overlay importer never publishes a curriculum, never publishes content, never
sets `LevelResourceBinding.assessmentVersionId`, and never reads or writes a
feature flag. Content published after the import is the **accepted reviewed**
content: the invariant in §1b guarantees the bytes carrying the approval are the
bytes that were approved.

Explicitly out of scope for this transport:

- **assessment runtime activation** — banks arrive approved with bindings NULL,
  which is the state the accepted corpus was closed in;
- **video asset and QA** — `NOT_RECORDED` / `QA_PENDING` are transported as
  truth, and the validator refuses `QA_PASSED` on a never-recorded asset;
- **live activation** — no command here targets a runtime database, by design.
