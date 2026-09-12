# PREPROD OPERATIONS RUNBOOK

The canonical operational reference for the PREPROD environment. It exists
because a run of accepted phases each rediscovered the same operational facts —
which release is live, why an automated login cannot pass Basic Auth, what may
and may not be deleted — and each recorded the answer inside its own audit
package, where the next phase did not look.

**Everything here is a documented property of the environment, not a proposal.**
Nothing in this file authorises a change. Enabling Pocket, deploying PROD,
rotating a credential and deleting a release are all separately authorised
actions.

---

## 1. What is authoritative about "which release is live"

In order of authority:

1. **The running process's `cwd`.** `systemctl show <unit> -p MainPID`, then
   `readlink /proc/<pid>/cwd`. This is what is actually executing.
2. **The `current` symlink.** `/srv/ata/current/{backend,crm,academy}`. This is
   what the next restart will execute.
3. **`ATA_RELEASE_MANIFEST.json`.** Build provenance only.

### `ATA_RELEASE_MANIFEST.json`'s `activated` field means "at publish time"

It is written once, by the publisher, and is **`false` in every release
directory including the ones currently serving traffic.** The publisher does not
revisit a release after activation, deliberately — a release directory is
immutable, and an activation would have to mutate it.

So `activated: false` is **not** evidence that a release is inactive. Use the
symlink and the process `cwd`. A future change may drop the field; until then,
read it as "this release was published, not activated, by the phase that made
it", which is exactly what it recorded.

---

## 2. Release retention policy

Releases are immutable directories under `/srv/ata/releases/<component>/<commit>`.
They are large (backend ≈ 0.5–1.5 GB, CRM ≈ 0.9 GB, academy ≈ 0.9 GB), so
retention is a real decision rather than a formality.

Four classes. **Only the fourth is disposable.**

| class | definition | may be deleted |
|---|---|---|
| **ACTIVE** | the target of a `current` symlink, or the `cwd` of a running process | **never** |
| **ROLLBACK** | the immediately preceding accepted release for a component, plus any release a live handoff names as a rollback target | **never while it is named** |
| **FORENSIC** | published by an accepted phase and never activated — including a phase that was blocked | **never without an explicit authorised decision** |
| **DISPOSABLE** | build scratch that was never published as a release: `.next/cache`, throwaway rehearsal builds outside `/srv/ata/releases`, extracted `git archive` trees in a working directory | yes |

**The stale CUTOVER-1 releases are FORENSIC, not garbage.**
`/srv/ata/releases/backend/5fc23fa0…` and `/srv/ata/releases/crm/77f4d339…` were
published by a cutover that was then blocked by G4-R7. Their manifests still
record that phase, which is precisely what makes them legible as evidence of
what was built and why it was not shipped. Deleting them to reclaim ~1.5 GB
would destroy the only artifact that proves the blocked cutover's build was
real.

**If disk pressure forces a decision**, the order is: disposable build scratch
first; then the oldest releases with no manifest at all (pre-dating the
publisher, and therefore carrying no provenance to preserve); and only then, as
an explicitly authorised decision, forensic releases — oldest first, with their
manifest and tree digest recorded in the audit trail before removal, so the
evidence survives the directory.

Never delete a release by glob, by age sweep, or by any command built from a
variable. Name the exact absolute path.

---

## 3. Basic Auth on the PREPROD ingress

`nginx` protects the whole PREPROD ingress with HTTP Basic Auth
(`auth_basic "ATA PREPROD"`, `auth_basic_user_file
/etc/nginx/preprod-access.htpasswd`). It is the accepted G3 public-access
posture and sits **in front of** the application, so it answers `401` to
everyone — including a healthy application, a monitoring probe and an
unauthenticated browser — before any request reaches a service.

### The operational quirk that is NOT a product bug

Browser automation cannot answer the browser-chrome Basic Auth dialog when the
credential cache is empty. This has been mistaken for an outage more than once.
It is not one:

* the gate is healthy — `401` with `WWW-Authenticate: Basic realm="ATA PREPROD"`
  is the correct response to an unauthenticated request;
* a **human** entering the credentials in the browser succeeds;
* once cached, the same automation session proceeds normally;
* a command-line client authenticates fine, because it does not use a dialog.

**How to classify a `401` correctly**

| observation | classification |
|---|---|
| `401` + `WWW-Authenticate: Basic realm="ATA PREPROD"` | the ingress gate. Expected. Authenticate. |
| `401` from `/api/...` with a JSON error envelope | the application's own authorization. A session problem, not a gate problem. |
| `403` from `/api/crm/...` | authenticated but not authorised — a role/permission question. |
| `502`/`504` | the gate passed and the upstream failed. A service problem. |

**Do not** weaken, bypass, disable or rotate Basic Auth, and do not change the
realm, to make automation pass. The correct answer is a human sign-in, or a
client that sends the header directly.

**Do not** write the credential into a file to make a probe convenient. One such
file — a `curl -K` config carrying the live credential in plaintext — was left
behind by a probe and survived several phases before being found and removed.
Use an interactive prompt or an ephemeral environment variable.

---

## 4. Operator accounts

| principal | purpose | notes |
|---|---|---|
| operational PREPROD `crm_admin` (`User.id 57`) | the sanctioned operator account for CRM acceptance | created 2026-08-13 by an authorised enablement phase. Holds all 15 CRM permissions. `User.role = user` deliberately — CRM authority comes from `StaffProfile.staffRole`, not from the backend admin role |
| four pre-existing `crm_admin` principals | historical | **nobody holds a usable credential.** bcrypt is one-way and no plaintext was retained |
| QA operator / moderator | PREPROD QA capability | provisioned by `scripts/ops/preprod-qa-operator` |

### Rules

* **Least privilege is already applied.** `crm_admin` holds every permission
  that exists; do not grant `User.role = admin` on top to make a surface render.
  If a backend admin capability is genuinely required, that is a separate,
  explicit authorization decision.
* **Do not create a second operator.** One was authorised; one exists.
* **The four historical `crm_admin` principals are a business decision, not a
  database one.** Whether to retire, re-key or keep them is a
  credential-management call. Do not disable, delete or re-key them against the
  live database to "clean up" — a disabled operator is an outage, and the
  provisioning tool has no rotation branch by design.
* **Credential rotation** has no automated path. Any rotation is a new,
  explicitly authorised phase. The provisioning tool refuses an address that is
  already taken, so re-running it is not a recovery route.
* **Never place a learner or staff email, password or session value in an audit
  package, a log, a screenshot or a bug report.** Internal identifiers and
  counts only.

---

## 5. Configuration files

`/srv/ata/config/backend.env` is the runtime environment file.

**Do not `source` it.** It is env-file-safe (systemd `EnvironmentFile=` parses
it correctly) but **not shell-source-safe**: at least one value contains `&`,
and `. backend.env` silently yields an empty variable, after which the
application fails closed with a misleading "required in production" message.
That message has cost debugging time before.

To read one value safely:

```bash
sudo sed -n 's/^KEY_NAME=//p' /srv/ata/config/backend.env | head -1
```

`.env.example` in the repository is a **template**. It carries placeholders, not
this or any other environment's values, and nothing at runtime reads it.

---

## 6. Health versus readiness

| endpoint | asserts |
|---|---|
| `GET /api/health` | the process is alive and the database answers |
| `GET /api/readiness` | every dependency required to serve this build's contract is usable: database, **schema**, storage, environment |

`readiness` includes a **schema** check: every migration the deployed release
ships must be applied and finished. A database behind the release answers
`ok:false` with the missing migration named. This is what makes readiness usable
as a deploy gate — before it existed, readiness answered `ok:true` on a database
missing the Growth schema entirely, on which five routes returned 500.

Readiness is read-only and cheap. It never applies a migration; discovering a
missing one is a signal, not a licence.

---

## 7. Operator tooling

All shipped in the release, so the version that ran is always identifiable.

| tool | purpose |
|---|---|
| `scripts/ops/verifyGrowthLedgerProjection.ts` | read-only Growth ledger verification. Reports MISSING / ORPHANED / **DIVERGENT** events. Divergence is the case migration 47's `NOT EXISTS` guards skip silently. Exit 0 clean, 1 divergence, 2 could not run |
| `scripts/ops/auditPackageLeakScan.ts` | bounded, symlink-safe leak scan of one explicit audit-package path. Reports location and class, never the matched text |
| `scripts/ops/verifyCrmSessionPermissionContract.ts` | cross-repository session permission contract. **Run before publishing any CRM release** — its absence is what caused G4-R7 |
| `/srv/ata/bin/ata-backup-sqlite` | verified online backup. Migration floor is derived from the deployed release |

### Safety rules every operator tool follows, and every new one must

* fail-closed — an error is never a pass;
* explicit absolute paths — no default root, no glob, no `cwd` fallback;
* symlink-safe — `lstat`, never follow, record that one was skipped;
* bounded — file, size and depth ceilings that fail loudly rather than
  truncating silently;
* never print a secret, a payload or a matched credential — location and class
  only;
* never `rm -rf "$var"`, never delete by glob, never delete by age sweep;
* never `source` an env file.

Point read-only tools at a **copy** of the database, not the live file.

---

## 8. Host hygiene

* `/srv/ata-data/data/ata-preprod.sqlite.sha256` was a stale sidecar and is
  **not** identity truth. Compute the digest from the file. Nothing reads it;
  the backup script writes its own sidecars into the backup destination.
* Temporary probe material must not be written into
  `/srv/ata/config/secrets/`. That directory holds sanctioned runtime
  credentials owned by `ata`; anything else there is a leftover.
* `/tmp` is a 5.7 GB tmpfs and has reached 80 % from accumulated scratch. SQLite
  reports exhaustion as a generic `disk I/O error` — if a regression fails that
  way, re-run with `TMPDIR` on the root filesystem before suspecting the code.
* Before deleting anything on the host: prove the exact absolute path, prove it
  is not a symlink (`lstat`), prove no process holds it open (`lsof`), prove no
  unit, config or script references it. Then remove that one path by name.
