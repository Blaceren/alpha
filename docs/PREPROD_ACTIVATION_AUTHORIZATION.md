# PREPROD Activation Authorization

**Status:** foundation implemented, not yet independently audited, never yet used.
**Scope:** PREPROD only. **This document does not describe a production mechanism and
must not be used to justify one.**

---

## 1. The problem this solves

The accepted curriculum-package importer and editorial-overlay importer refuse to write a
protected runtime database. That refusal is correct and stays: `protected-database.ts`
identifies a target by `(device, inode)` rather than by name, fails closed when identity
cannot be established, and offers no flag, argument or environment variable that permits a
protected target.

A real PREPROD activation nevertheless has to mutate exactly one runtime database. What it
needs is not a way to switch the guard off — it is a way to say, in reviewable form:

> this machine, this file, this rollback backup, this migration lineage, this package, this
> overlay, this deployed release set, this flag baseline, this starting state, this stage.

That is what a **PREPROD activation manifest** is, and satisfying every one of its pins is
the only thing that produces a **grant**. The guard accepts a grant that names exactly the
target in front of it; nothing else changed about it.

---

## 2. Risk acceptance — read this before anything else

The operator has consciously accepted the risk of **losing the PREPROD host itself**.
Consequently, for PREPROD only:

- an **offhost** backup copy is **not** a blocker;
- production-grade restore hardening is **not** a blocker.

Both remain **hard gates before PROD**, and neither has been closed:

| Debt | State | Blocking for |
|---|---|---|
| Genuine offhost backup destination | does not exist | **PROD** |
| Checksum-verified offhost download | not possible without the above | **PROD** |
| Isolated restore from the offhost copy | not possible without the above | **PROD** |
| Hardened `scripts/backup/restoreSqlite.ts` | **defective** — see below | **PROD** |
| Backup retention / immutability | local only, 14-day pruning window | **PROD** |

**The restore tool is known defective.** It validates only the 16-byte SQLite header: no
checksum comparison, and no post-restore integrity check. It has been demonstrated
installing a database whose `PRAGMA integrity_check` fails and exiting `0`. **Nothing in
this authorization path calls it, and nothing here trusts a verdict it produced.** What the
activation proves is narrower and honest: *a fresh local rollback artifact exists, is
private, is byte-for-byte the reviewed one, opens soundly, carries the expected migration
lineage, and holds the same rows as the database about to be mutated.* Whether restoring it
would succeed is not proven, and under the PREPROD risk policy it does not have to be —
because PREPROD is rebuildable. **On PROD it would have to be.**

The manifest records this decision explicitly as
`riskPolicy: "PREPROD_REBUILDABLE_LOCAL_BACKUP_ACCEPTED"`. It is a literal in the schema, so
a manifest that omits it or names anything else does not parse. There is no production value
and no default.

---

## 3. What is pinned

| Pin | Refusal when it moves |
|---|---|
| Manifest bytes (digest supplied **separately** on the command line) | `MANIFEST_SHA_MISMATCH` |
| Manifest shape — strict, unknown fields rejected | `MANIFEST_MALFORMED` |
| `environment: "preprod"` (a literal, not an enum) | `MANIFEST_MALFORMED` |
| Host deployment class must classify as `staging` | `ENVIRONMENT_NOT_PREPROD` |
| Machine identity — `sha256(/etc/machine-id)` | `HOST_MISMATCH` |
| Target database — must be the sanctioned constant | `TARGET_NOT_SANCTIONED` |
| Target `(device, inode)` | `TARGET_IDENTITY_MISMATCH` |
| Rehearsed state chain — schema, migration lineage, business data, curriculum, editorial | `STAGE_STATE_UNKNOWN` |
| Which reviewed state the target is in, and therefore what may run | `STAGE_OUT_OF_ORDER` |
| Content activation plan, recomputed from the transported target | `CONTENT_PLAN_MISMATCH` |
| The capability itself — issued by this process, for this operation | `GRANT_NOT_AUTHENTIC`, `GRANT_OPERATION_MISMATCH` |
| Rollback artifact present, `0600`, exact size and sha256 | `BACKUP_ARTIFACT_*` |
| Rollback artifact integrity / FK / migration lineage | `BACKUP_INTEGRITY_FAILED`, … |
| Rollback artifact holds the same rows as the pinned **entry** state | `BACKUP_SOURCE_DIGEST_MISMATCH` |
| Accepted product checkpoint size and sha256 | `PRODUCT_CHECKPOINT_MISMATCH` |
| Structural package file digest, code, revision, **full** fingerprint | `PACKAGE_MISMATCH` |
| Overlay digest, code, revision, canonical fingerprint, root hash | `OVERLAY_MISMATCH` |
| Overlay provenance labels (M-3, below) | `OVERLAY_PROVENANCE_MISMATCH` |
| Deployed Backend / Academy / CRM releases | `RELEASE_MISMATCH` |
| All ten `CURRICULUM_V2_*` flags | `FLAG_BASELINE_MISMATCH` |
| Curriculum starting-state fingerprint | `CURRICULUM_STARTING_STATE_MISMATCH` |
| Pre-overlay SAR baseline (M-1) | `UNEXPECTED_SOURCE_AUTHORITY` |
| Pre-overlay review-note baseline (M-2) | `UNEXPECTED_REVIEW_NOTE` |
| Pre-overlay video / approved-editorial baseline | `UNEXPECTED_EDITORIAL_STATE` |
| Overlay historical principals absent | `UNEXPECTED_HISTORICAL_PRINCIPAL` |
| Stage ordering and stage↔operation mapping | `STAGE_OUT_OF_ORDER`, `OPERATION_NOT_AUTHORIZED` |
| One activation at a time | `ACTIVATION_LOCK_HELD` |

Every row has a regression test that breaks exactly that pin and expects exactly that
refusal.

---

## 4. No generic bypass

These do not exist anywhere in the authorization surface, and a regression greps the shipped
sources for each of them:

```
--force   --allow-live   --unsafe   --skip-protection   --allow-protected
DISABLE_GUARD           ALLOW_LIVE          ALLOW_PROTECTED_DB
```

No environment variable produces a capability. `protected-database.ts` was **not** weakened:
its default behaviour is unchanged, and the one addition is that it will accept an
**authentic capability** for exactly the file in front of it.

### The grant is a runtime capability, not a shape

The first implementation of this document described the grant structurally and let the guard
authenticate it from its own public fields — a `kind` string, a path, a device, an inode —
and then called a method the caller had supplied, `assertStillValid()`, as the final proof.
An independent audit built one out of an eight-line object literal and watched the real
structural importer write a protected database with it. Every field the guard read was
something any caller could produce.

That design is gone. Authority now lives in a `WeakMap` private to
`preprod-activation/grant.ts`, keyed by the identity of the handle
`assertPreprodActivationAuthorization` returns. The handle's public fields are labels for
humans and carry no power; the claims that decide anything — the operation, the target, and
the revalidation closure — are held in the registry and read from there. Consequently:

* a hand-built object literal, a spread clone, `Object.assign`, a JSON round-trip, a
  `structuredClone`, a class instance and a prototype-spoofed object are all **refused** —
  not for having the wrong fields, but for never having been issued;
* **`assertStillValid` is no longer part of the contract.** Final revalidation is a closure
  built by the authorization module from its own measurements. The guard never executes
  caller-supplied code as proof of authority;
* there is **no exported `issueGrant()`**. The only path into the registry is
  `runWithGrantIssuer`, which hands an issuer to a callback and revokes it when the callback
  returns; `authorize.ts` is its only caller, and a regression asserts that;
* the guard requires `activationOperation` alongside the capability and compares it against
  the operation stored at issuance, so a structural-import capability cannot admit an
  overlay import even against the correct file.

**The sanctioned target is a constant in `src/lib/curriculum/preprod-activation/target.ts`.**
It is never read from argv, never read from the environment, and never taken from the
manifest — the manifest's declaration is *compared against* it. `ata-dev`, `ata-suite` and
`ata-prod` are additionally named in `NEVER_AUTHORIZED_DATABASE_PATHS` so that a future edit
to the constant cannot select one of them.

There is a test-only substitution (`__testOnlySanctionedTargetPath`) reachable only as a
function parameter, so the regression suite can prove a valid authorization really does
permit a write without touching the live database. No shipped CLI references it, and a
regression asserts that none ever does.

---

## 5. Threat model

This defends against **operator error**: the wrong database, the wrong host, the wrong
package, the wrong overlay, a stale backup, a stage run out of order, an environment that
drifted since review, two sessions running at once.

It does **not** defend against a hostile operator with root, who can already open the SQLite
file directly. Fail-closed operational authorization is the goal; cryptographic protection
against the machine's owner is not, and pretending otherwise would buy complexity with no
security.

---

## 6. Carried transport mitigations

The accepted transport audit left three MEDIUM findings. The activation layer is where they
are mitigated, and every manifest carries them as evidence.

**M-1 — SourceAuthorityResolution identity-axis gap.** SAR lookup is slot-based, so an
unexpected or tampered pre-existing row can coexist with the rows the overlay writes rather
than colliding with them. *Mitigation:* before the overlay stage the target's SAR count for
the imported curriculum must equal the reviewed baseline exactly — zero on a freshly
structural-imported target. Any unexpected row stops the activation. The overlay is never
allowed to absorb authority history it did not create.

**M-2 — review-note identity-axis gap.** Note identity has an axis the importer does not
range over, so a tampered note can read as an absent one. *Mitigation:* same shape — the
`EditorialReviewNote` count for the imported curriculum must equal the reviewed baseline
exactly, and any unexpected note stops the activation before the overlay runs.

**M-3 — provenance labels are not verified by the importer.** The overlay importer records
`sourceCheckpointSha256`, `sourceBackendCommit` and `sourceBackendTree` without checking
them; they are labels, not proofs. *Mitigation:* the manifest pins all three externally, and
the authorization compares the artifact against those pins **and** cross-checks them against
the rest of the reviewed activation — the declared source checkpoint against
`acceptedProduct.checkpointSha256`, the declared structural-package fingerprint against the
package this activation will actually import, and the declared Backend commit/tree against
the accepted transport baseline. An artifact that agrees with itself but disagrees with the
reviewed activation is refused.

---

## 7. Stage model

```
PREPARED → MIGRATION_41_TO_46 → STRUCTURAL_IMPORT → EDITORIAL_OVERLAY
        → CONTENT_PUBLICATION → CURRICULUM_PUBLICATION
        → BACKEND_DEPLOY → FLAG_ENABLE → SMOKE_ACCEPTANCE
```

**This build authorizes exactly two operations:** `STRUCTURAL_IMPORT` and
`EDITORIAL_OVERLAY`. Every other stage returns no operation mapping — migration,
publication, binding, deploy and flag changes are separate operational commands, and no
activation manifest can authorize them. There is no `operation: ANY`.

**Ordering is a safety property, not a convenience.** All required content publication must
complete and verify *before* curriculum publication begins, because neither has an inverse:
`publishContentVersion` archives the previous row and moves the binding forward atomically,
and the curriculum service exports no unpublish at all. Entering a stage requires every
earlier stage to be recorded complete, and a stage already recorded complete cannot be
re-run.

### Where expected state comes from

**No command tells the authorization what the database should contain.** The earlier design
took `--expect-target-sha256`, and once the migration stage had moved the lineage that value
was compared only against the file itself — so anybody who ran `sha256sum` on whatever was
there could bless it. An independent audit demonstrated a tampered post-migration database
being authorized exactly that way. The flag is gone, and so is `--completed-stages`.

Expected state is **precomputed by rehearsal**. Manifest preparation copies the verified
rollback backup into a private `0700` directory and runs the whole activation against the
copy — the sanctioned migration, the structural package, the editorial overlay, each through
the same shipped command an operator runs. Every state along the way is fingerprinted, and
the four fingerprints go into the manifest, where the externally supplied manifest digest
pins them along with everything else.

The fingerprints are **semantic, not byte-level**: SQLite page layout and the
`_prisma_migrations` timestamps differ between two runs of the same migration, so a
byte digest could never match. Each state records

| part | what it proves |
| --- | --- |
| `schemaDigest` | normalised `sqlite_master` — a column added or a constraint dropped is caught |
| `migrationLineage` | every applied migration by **name and checksum**, plus a zero-failure requirement |
| `businessContinuityDigest` | every table the activation may not touch, allow-by-default |
| `historicalPrincipals` | **every** row in each pinned editorial-principal identity class, with its cardinality, per stage |
| `activationAuditDelta` | the audit rows a sanctioned stage is allowed to have written, projected and counted |
| `curriculumDigest` | the curriculum surface, keyed by stable code and version, never by row id |
| `editorialDigest` | the evidence the overlay transports, keyed the same way |

`businessContinuityDigest` covers **every** table except the eighteen the two importers write,
so a table added by a future migration is inside the fence automatically. A tampered user, an
altered reward, a rewritten audit entry: each moves this digest, and nothing on a command line
can move it back.

**The expectation is per stage, not one value reused four times** (corrected by CORRECTION-3;
an earlier comment in `semantic-state.ts` claimed the digest was identical at all four states,
which it is not, and no code ever relied on it). Two separate things are true:

- *unaffected business state is continuous* — no sanctioned stage writes a fenced row, so any
  tamper moves this digest at whichever boundary it is measured;
- *the set of fenced tables legitimately grows* — migrations 42-46 create tables
  (`AuthoringPreviewSnapshot`, `StagingAttestation`, …) which, being new and not stage-owned,
  enter the fence at POST_MIGRATION as empty tables. The digest is taken over the per-table map,
  so gaining a key changes it. That is allow-by-default working as designed, and it is exactly
  why each of the four states carries its own rehearsal-derived fingerprint.

#### The two filtered surfaces, and why they are projections (CORRECTION-2)

Three tables cannot be digested whole, because a sanctioned stage appends rows to them whose
values are **not reproducible** between the rehearsal and the real run: a provisioned
principal's `User.passwordHash` ends in `Date.now()`, its `StaffProfile.id` is a `cuid()`, and
an `AuditLog` row gets an autoincrement id and a wall-clock time. The first implementation
handled that by removing those rows from the fence entirely, at every stage, and the
independent audit showed what that cost:

- **HIGH-1** — a `User` row on a pinned principal address, with `role = admin`, inserted at
  POST_MIGRATION moved no digest at all. The structural import was authorized against a
  database that was not the reviewed state. Backwards too: after the overlay, a principal's
  role could be changed and the target still read as exactly POST_OVERLAY.
- **MEDIUM-1** — `AuditLog` was fenced as `id <= entryMaxAuditLogId`, so every row above that
  watermark was invisible and arbitrary audit history could be appended mid-activation.

Both are now measured rather than excluded. The filters on the raw table digests are unchanged
— that is what keeps a correct database matchable — and what they remove is covered by two
components that normalise away exactly the non-reproducible columns:

`historicalPrincipals` represents **every row** in each pinned identity class, together with the
class cardinality. Absence is a value, not a missing line, which is what makes the component
stage-aware: at ENTRY, POST_MIGRATION and POST_STRUCTURAL every principal must read
`users=0 absent`, and one that appears changes the digest and therefore the classification.
Each represented row carries its **stored spelling**, role, `status` (the loginability gate —
the overlay writes `blocked`, and the login route refuses `blocked` outright), name, referral
code, e-mail-verification presence, its **credential class**, and — nested inside it — its staff
profile's display name, staff role and permission version. The credential value is never
digested, returned or logged; only its class is.

`activationAuditDelta` projects the rows above the entry watermark and carries their **count**
alongside the digest. It is `0` at ENTRY, POST_MIGRATION and POST_STRUCTURAL — neither the
migration nor the structural import writes audit history — and exactly `1` at POST_OVERLAY, the
overlay's own import event. Each row is projected as its action, entity type, entity resolved
to `code@vN` rather than a row id, the actor's e-mail rather than a user id, whether it carries
an `ip` or a `userAgent` (the activation writes neither; an application request would), and its
metadata canonicalised by the **explicit normalisation registry** described below. Lines are
sorted and joined, so a duplicate of the expected event is a second identical line and is
caught.

So the contract is: **entry state + explicit sanctioned stage delta = expected state for that
stage**. Nothing is ignored. Both components are part of `compositeDigest`, both are named
individually when they drift, and both are derived by one function — `captureStageFingerprint`
— so the rehearsal, manifest preparation, authorization and resume classification cannot
disagree about what a state is.

#### Why coverage is now a partition, not two predicates (CORRECTION-3)

The second independent audit proved the CORRECTION-2 fence was written as **two SQL predicates
over the same table, and they did not select the same rows**:

- **HIGH-1** — the raw digest removed rows with `lower("email") NOT IN (...)`, a *set* predicate,
  so every case variant of a pinned address left the fence; the projection read them back with a
  scalar `get()`, which returns *one* row. `User.email` is unique **case-sensitively**
  (`CREATE UNIQUE INDEX "User_email_key" ON "User"("email")`), so a second row on
  `Editor.One@…` beside a sanctioned `editor.one@…` belonged to no component at all. An
  unreviewed `role = admin`, `status = active` account with a usable credential measured as
  exactly the reviewed state — and at POST_MIGRATION that authorized the structural import. Both
  rows are separately reachable, because the login route resolves accounts by exact
  `findUnique({ where: { email } })`.
- **MEDIUM-1** — the credential test was `substr(hash, 1, 30) = marker`, which accepts the
  marker with a real bcrypt digest appended after it.
- **MEDIUM-2** — metadata normalisation erased *any* numeric property whose name ended in `Id`.

The fix is structural rather than a matching correction:

1. **One canonical identity, one membership decision.** `canonicalPrincipalIdentity` is the rule
   the artifact contract already applies to a `principalRef` (`z.string().trim()…toLowerCase()`),
   and `resolvePrincipalRowSets` decides class membership **once**, in JavaScript. SQL is never
   asked the question — `lower()` folds ASCII only while JavaScript `toLowerCase()` is
   Unicode-aware, and using one in each half is one of the two ways HIGH-1 could open.
   `capturePrincipalPresence` was moved onto the same rule, so no third rule exists.
2. **Both halves are driven by row ids.** The raw fence is `WHERE "id" NOT IN (<principal ids>)`
   and the projection is `WHERE "id" IN (<principal ids>)`, from the same set. They partition the
   table **by construction**, so no row can fall between them however the identity rule later
   changes. `captureSemanticCoverage` renders that partition as `total / fenced / specialised /
   unowned / ambiguous`, and the regression suite asserts `fenced + specialised == total` and
   `unowned == ambiguous == 0` on every fixture and every reviewed state.
3. **Cardinality is semantic state.** The projection represents every row in a class and carries
   the count, so `absent`, `exactly one` and `several` are three different values and a refusal
   can say *"expected 2, found 3"*.
4. **The credential test is closed.** `classifyCredential` checks the provisioner's *whole*
   format — the marker followed by `Date.now().toString(36)` and nothing else, with the base-36
   tail required to re-serialise to itself — and otherwise returns
   `bcrypt-login-credential`, `absent` or `unrecognized`. Anchoring the end is the point.
5. **Metadata normalisation is default-deny.** `AUDIT_METADATA_NORMALISATIONS` lists exact paths
   per producing action, each with its reason; everything not listed is compared by value, so a
   metadata field introduced by a future stage is protected the moment it appears. A registered
   row id is replaced by the **canonical identity of the account it names**, not by a marker, so
   a principal bound to a different account still moves the digest.

`ContentAsset` stays stage-owned. The audit observed that no stage mutated it and asked whether
it belongs there; `package/import.ts` creates a `ContentAsset` row for every asset a level's
content declares, so the ownership is real. The accepted `ata-v2.canonical-100` package simply
declares no assets yet — a fact about that package, not about the contract — and the table is
still measured, by `curriculumDigest`.

**The progression-owner tables are stage-owned, and projected in the same breath.** Package
revision 2 makes the structural importer materialize the completion owners a level's
`completionMethod` needs at runtime — the L3 report's grading contract and the twenty financial
checkpoint requirements — across nine further tables:

    LevelCheckpointRequirement            ReportRubricCriterion
    LevelReportBinding                    ReportRubricCriterionLocalization
    ReportRejectionReason                 ReportRubricScaleOption
    ReportRejectionReasonLocalization     ReportRubricScaleOptionLocalization
                                          ReportRubricVersion

Until they were declared, they fell to the business fence and manifest rehearsal reported a
legitimate import as a business-data breach, so no successor could be authorized at all. Only
`package/import.ts` and `report-authoring.ts` write them; the editorial overlay writes none of
them and no learner flow writes any of them. Every row is curriculum-version-owned — learner
grading lives in `ReportReview`, `ReportReviewScore` and `ReportSubmission`, which stay fenced and
reference these tables `onDelete: Restrict`.

Declaring ownership is only half of it. Nine matching `CURRICULUM_PROJECTIONS` entries were added
in the same commit, keyed by stable domain identity — level `stableCode`, rubric `versionNumber`,
criterion / option / reason `stableKey` — and spanning every curriculum version, so a wrong
threshold, a wrong rubric or a missing binding moves `curriculumDigest` at the POST_IMPORT gate.
Ownership without projection would have made the manifest preparable while leaving exactly the
data the successor exists to deliver unmeasured. `test:regression:curriculum-progression-owner-projection`
pins both halves.

**Historical principals: reuse is a decision, not a default.** A historical editorial principal
is an ENVIRONMENT identity — `User` and `StaffProfile` carry no `curriculumVersionId`, and
`User.email` is unique — so a successor overlay published into an environment a previous overlay
already provisioned must bind to the same account. Authorization used to require those identities
to be ABSENT, which is right for a first activation and makes every successor permanently
unauthorizable. Each declared principal is now classified into exactly one of:

| disposition | when | what the importer then does |
| --- | --- | --- |
| `CREATE` | no account in the canonical identity class, and the overlay declares `provisionIfMissing` | provisions it once, blocked and non-loginable |
| `REUSE_EXACT` | exactly one account, matching on `role`, the `StaffProfile`'s `staffRole`, and — for a `process` identity — being non-loginable | binds to that account; creates nothing |
| `REFUSE_CONFLICT` | anything else | never runs: no capability is issued |

The predicate is the overlay importer's own, restated in one place rather than re-derived, and
`curriculum-overlay-principal-reuse` fails if the two ever diverge. Refused states include a
different `role`, a different `staffRole`, a missing StaffProfile, an account that can still log
in where a process identity is declared, an absent principal the overlay may not provision, and
more than one account sharing a canonical identity — ambiguity is refused rather than resolved,
because `User.email` is unique only case-sensitively. Nothing is repaired to fit: no demotion, no
elevation, no merge. The overlay's declared principal set is additionally compared against the
manifest's reviewed `historicalPrincipalRefs`, so a validly signed overlay cannot introduce a
principal the review never saw.

### Resume policy

This is **wired**, not described. `decideStageDisposition` runs on the authorization path and
nothing reaches an importer without it:

| observed | answer |
| --- | --- |
| the stage's exact pre-state | `EXECUTE` — a capability is issued |
| the stage's exact post-state | `ALREADY_COMPLETE` — **no capability is issued**; record the stage as done |
| a different reviewed state | refused, naming which state it is actually in |
| none of them | `STAGE_STATE_UNKNOWN` — stop. Restore the backup and start the stage again |

`ALREADY_COMPLETE` is a successful outcome that authorizes nothing: the importer CLIs print
it and exit without opening the database. `UNKNOWN` is the correct answer to a partially
applied stage and the only honest one — re-running a mutation over an unknown state is how a
half-imported curriculum becomes a fully corrupted one.

### The rollback backup covers the ENTRY snapshot

That is the whole of its claim, and it is verified at **every** stage — existence,
permissions, size, digest, `integrity_check`, foreign keys, migration count — so a backup
deleted or replaced after the migration stops the remaining stages.

What it is compared against is the **entry state the manifest pins**, not the current file.
Once a sanctioned stage has run, the live database has legitimately moved on; comparing the
two at that point would either refuse every activation after the first stage or force a fresh
backup after a mutation, which would destroy the rollback point the backup exists to be.

---

## 8. Commands

### Prepare (read-only except for the manifest file)

```bash
npm run activation:manifest:prepare -- \
  --activation-id g2-preprod-2026-08-11 \
  --live-database /srv/ata-data/data/ata-preprod.sqlite \
  --backup-artifact /srv/ata-data/backups/pre-activation/ata-preprod-<TS>.sqlite \
  --package curriculum/packages/ata-v2-canonical-100.draft.json \
  --overlay /secure/path/overlay-v2.json \
  --accepted-checkpoint /home/ubuntu/ata-g2-editorial/special-l2-reviewer/ata-g2-special-l2-reviewer.sqlite \
  --transport-baseline-commit 27edeeb82e9b1c5a9575dbcfd09e04179b000abe \
  --transport-baseline-tree 362551a45278076c08d14b437be53197d19e6228 \
  --entry-migration-count 41 --target-migration-count 46 \
  --out /secure/path/activation-manifest.json
```

Every value in the manifest is **measured**, not supplied. Preparation refuses outright if
the rollback backup does not hold the same rows as the live database — the operator finds out
while re-taking a backup is still cheap.

The command prints the manifest digest. **Carry it by hand.** It is deliberately not stored
anywhere the mutation commands read automatically: a pin that travels with the file it pins
does not pin anything.

### Validate (read-only, first command of every stage)

```bash
npm run activation:manifest:validate -- \
  --activation-manifest /secure/path/activation-manifest.json \
  --expect-activation-manifest-sha256 <64hex> \
  --activation-stage STRUCTURAL_IMPORT
```

Runs the entire authorization and throws the grant away. Mutates nothing and takes no lock.

### Authorized structural import

```bash
npm run curriculum:package:import -- \
  --package curriculum/packages/ata-v2-canonical-100.draft.json \
  --database file:/srv/ata-data/data/ata-preprod.sqlite \
  --activation-manifest /secure/path/activation-manifest.json \
  --expect-activation-manifest-sha256 <64hex> \
  --activation-stage STRUCTURAL_IMPORT
```

### Authorized editorial overlay

```bash
npm run curriculum:overlay:import -- \
  --overlay /secure/path/overlay-v2.json \
  --package curriculum/packages/ata-v2-canonical-100.draft.json \
  --database file:/srv/ata-data/data/ata-preprod.sqlite \
  --activation-manifest /secure/path/activation-manifest.json \
  --expect-activation-manifest-sha256 <64hex> \
  --activation-stage EDITORIAL_OVERLAY
```

`--package` is required here too: the overlay's declared structural-package fingerprint is
compared against the package this activation actually imported.

Once `--activation-manifest` appears, **every** activation flag becomes mandatory. A run that
supplies the manifest but omits its digest, or omits the stage, is not a slightly-less-checked
activation — it is an unreviewed one, and it stops.

---

## 9. What is deliberately NOT automated

- **No migration runner change.** The migration stage remains a separate operational command.
  No manifest authorizes a migration. What the manifest does carry is the exact state the
  migration must LEAVE BEHIND — measured during the rehearsal — so the stage after it refuses
  unless the migration produced precisely that. A migration run with the wrong lineage, or a
  database touched while it ran, cannot be carried forward.
- **No publication.** `assessmentRuntimePolicy: "DEFER"` and
  `videoRuntimePolicy: "ASSET_QA_DEFERRED"` are literals in the schema. No assessment binding
  is authorized. The content activation plan is carried as a *reviewed target to check
  against*, not as something anything can act on — and it is **recomputed from the transported
  target and compared row for row**, because an audit showed that pinning the manifest's bytes
  proves the plan has not changed since review without proving it was ever right.
- **No deploy, no flag change.** Neither has an operation mapping.
- **No one-big-script.** There is no command that migrates, imports, publishes, deploys and
  flags in one go. Hard checkpoints are the point.

---

## 10. Permissions and secrets

The activation manifest and the local backup artifacts are written `0600`, in directories
created `0700`. The rehearsal copy lives in a `0700` `mkdtemp` directory and is removed by
absolute path, behind a prefix assertion — no glob is ever expanded.

**The activation lock path is a constant in `lock.ts`** (`/srv/ata-data/activation/preprod-activation.lock`).
No CLI argument, no environment variable and no manifest field selects it: an audit found that
a caller-chosen lock path let two concurrent sessions each name a different file and both
proceed, which is not mutual exclusion. Acquisition is `O_EXCL`, the record is `0600` and
names the activation, manifest digest, stage and pid, and **a held lock is always refused** —
there is no force-unlock in any activation command. A crashed activation may have stopped
part-way through a stage, and the correct next step is a human looking at it. Holding the lock
confers no database capability whatsoever. The manifest contains no credential, no token and no session value; the
preparation command never reads one. The machine id is hashed before it enters the manifest —
not because it is secret, but because a manifest is an evidence artifact that gets read in
reports and a raw machine id is a stable cross-service correlator with no reason to be
published.

---

## 11. Not valid for PROD

The manifest schema is `ata.preprod-activation-manifest/2`. A `…/v1` manifest is refused with
an explanation rather than reinterpreted: v1 authorized each stage from a digest supplied on
the command line, and reading one under these rules would mean inventing the rehearsed state
chain it does not carry.

This is intentionally PREPROD-specific. `environment` is a literal, the deployment class must
classify as `staging`, the sanctioned target is a single constant, and the risk policy names
PREPROD in its own value. There is no production support hidden in this design, and
production authorization must be designed separately **after** the offhost-backup and
restore-hardening gates close.
