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
| Target size and sha256 | `TARGET_DIGEST_MISMATCH` |
| Applied migration count for the stage | `TARGET_MIGRATION_MISMATCH` |
| Rollback artifact present, `0600`, exact size and sha256 | `BACKUP_ARTIFACT_*` |
| Rollback artifact integrity / FK / migration lineage | `BACKUP_INTEGRITY_FAILED`, … |
| Rollback artifact holds the same rows as the live database | `BACKUP_SOURCE_DIGEST_MISMATCH` |
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

No environment variable produces a grant. `protected-database.ts` was **not** weakened: its
default behaviour is unchanged, and the one addition is that it will accept a grant naming
exactly the path and `(device, inode)` in front of it, after which it calls the grant's own
`assertStillValid()` before returning.

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

### Which digest is authority, and when

While the target is still at the **entry lineage**, nothing this activation authorizes has
run, so the database must still hold exactly the bytes the manifest and the rollback backup
were prepared from — the operator does not get to nominate a different value. Once the
migration stage has moved the lineage forward, the manifest cannot know the new digest (a
migration's output was not predictable at preparation time), so the operator states it per
stage with `--expect-target-sha256` and it is checked against the file. Either way, no stage
runs against a target whose contents were not stated in advance.

### Resume policy

Three answers, and only the first two are safe:

- **PRE_STAGE** — the stage demonstrably has not run: execute it.
- **POST_STAGE** — the stage demonstrably completed: record it and move on, do **not** re-run.
- **UNKNOWN** — the observed state matches neither: **STOP**. This is a partially applied or
  externally modified database. Restore the rollback artifact and start the stage again.

Re-running a mutation over an unknown state is how a half-imported curriculum becomes a
fully corrupted one, so `UNKNOWN` never proceeds.

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
  --activation-stage STRUCTURAL_IMPORT \
  --expect-target-sha256 <64hex> \
  --completed-stages PREPARED,MIGRATION_41_TO_46
```

Runs the entire authorization and throws the grant away. Mutates nothing and takes no lock.

### Authorized structural import

```bash
npm run curriculum:package:import -- \
  --package curriculum/packages/ata-v2-canonical-100.draft.json \
  --database file:/srv/ata-data/data/ata-preprod.sqlite \
  --activation-manifest /secure/path/activation-manifest.json \
  --expect-activation-manifest-sha256 <64hex> \
  --activation-stage STRUCTURAL_IMPORT \
  --expect-target-sha256 <64hex> \
  --completed-stages PREPARED,MIGRATION_41_TO_46
```

### Authorized editorial overlay

```bash
npm run curriculum:overlay:import -- \
  --overlay /secure/path/overlay-v2.json \
  --package curriculum/packages/ata-v2-canonical-100.draft.json \
  --database file:/srv/ata-data/data/ata-preprod.sqlite \
  --activation-manifest /secure/path/activation-manifest.json \
  --expect-activation-manifest-sha256 <64hex> \
  --activation-stage EDITORIAL_OVERLAY \
  --expect-target-sha256 <64hex> \
  --completed-stages PREPARED,MIGRATION_41_TO_46,STRUCTURAL_IMPORT
```

`--package` is required here too: the overlay's declared structural-package fingerprint is
compared against the package this activation actually imported.

Once `--activation-manifest` appears, **every** activation flag becomes mandatory. A run that
supplies the manifest but omits its digest, or omits the stage, is not a slightly-less-checked
activation — it is an unreviewed one, and it stops.

---

## 9. What is deliberately NOT automated

- **No migration runner change.** The migration stage remains a separate operational command.
  Its pre/post state is specified by the manifest (`entryMigrationCount` → `targetMigrationCount`)
  and verified by the validate command, but no manifest authorizes a migration.
- **No publication.** `assessmentRuntimePolicy: "DEFER"` and
  `videoRuntimePolicy: "ASSET_QA_DEFERRED"` are literals in the schema. No assessment binding
  is authorized. The content activation plan is carried as a *reviewed target to check against*,
  not as something anything can act on.
- **No deploy, no flag change.** Neither has an operation mapping.
- **No one-big-script.** There is no command that migrates, imports, publishes, deploys and
  flags in one go. Hard checkpoints are the point.

---

## 10. Permissions and secrets

The activation manifest and the local backup artifacts are written `0600`, in directories
created `0700`. The manifest contains no credential, no token and no session value; the
preparation command never reads one. The machine id is hashed before it enters the manifest —
not because it is secret, but because a manifest is an evidence artifact that gets read in
reports and a raw machine id is a stable cross-service correlator with no reason to be
published.

---

## 11. Not valid for PROD

v1 is intentionally PREPROD-specific. `environment` is a literal, the deployment class must
classify as `staging`, the sanctioned target is a single constant, and the risk policy names
PREPROD in its own value. There is no production support hidden in this design, and
production authorization must be designed separately **after** the offhost-backup and
restore-hardening gates close.
