# ATA-PREPROD-RELEASE-TOOLING-SOURCE-OWNERSHIP-1 — FINAL REPORT

**Verdict: PASSED** · RELEASE-TOOLING-SOURCE-OWNERSHIP-1 = **CLOSED** · 0 BLOCKER · 0 HIGH · 2026-08-16

Release tooling ownership only. No product behaviour changed, no product release published, no
schema, no migration, no deletion of any release or workspace, no PROD.

---

## A. Initial unversioned tooling inventory

`/home/ubuntu/learner-ops-v1/tools` — **not inside any git repository**. Six files, 1,361 lines, all
`0775 ubuntu:ubuntu`, **no symlinks**.

| File | Lines | Role |
|---|---|---|
| `publish-release.sh` | 453 | publish one candidate as an immutable release |
| `build-release.sh` | 295 | canonical build; writes build provenance |
| `tests/build-provenance.test.sh` | 317 | provenance regression |
| `tests/release-packaging.test.sh` | 117 | packaging regression |
| `verify-build-provenance.sh` | 102 | the single implementation of the provenance rule |
| `cutover.sh` | 77 | repoint `current`, write the rollback receipt |

**Classification:** all six are canonical release operation. The directory contained **no unrelated
phase utilities**, so nothing was excluded — the classification was performed, and came back empty.

Accepted-state SHA256 recorded before any write (§4):

```
42f3b35d…  build-release.sh          797337c7…  publish-release.sh
82052c15…  cutover.sh                4ed61c69…  verify-build-provenance.sh
2149036b…  tests/build-provenance.test.sh   410f2cae…  tests/release-packaging.test.sh
```

---

## B. Active callers and dependencies

**No external callers.** Nothing under `/etc/systemd`, `/srv/ata/systemd`, `/etc/cron*` or
`/srv/ata/bin` references the tooling path — it is operator-invoked only.

Internal dependency graph (one real edge):

- `publish-release.sh` → `verify-build-provenance.sh`, resolved as
  `$(dirname "$(readlink -f "$0")")/verify-build-provenance.sh` — a **sibling**, which makes the flat
  layout load-bearing and the set relocatable as a unit.
- `build-release.sh`, `cutover.sh`, `verify-build-provenance.sh` — standalone; they name each other
  only inside printed operator hints.
- Both test suites default to the live paths and accept overrides as `$1/$2/$3`, so they can be
  pointed at any installed copy.

---

## C. Selected canonical source owner

**A new dedicated repository: `/home/ubuntu/ata-release-tooling`.**

**Why a new one was required.** Every git repository on this host is a *product application*
repository — backend, academy, crm, partner, across phase workspaces. There is no engineering or
infrastructure repository. The tooling publishes all four components and belongs to none of them.

**Why Backend — the obvious candidate — is the wrong owner.** It already owns
`docs/RELEASE_ARTIFACT_CONTENTS.md` and `docs/RELEASE_RETENTION.md`, and the brief explicitly warns
that this does not make it the tooling owner. Two concrete hazards, not preferences:

1. **Circularity.** The publisher publishes Backend. Inside Backend, a Backend release would contain
   the publisher that produced it.
2. **Forced coupling.** Under the build-provenance contract accepted in the previous wave, a Backend
   commit that has not been rebuilt cannot be published. A pure tooling edit would therefore either
   force a Backend rebuild + publish + cutover, or leave Backend HEAD drifting ahead of its release.
   **That cost was paid once already**, in the provenance wave, to land a documentation change.
   Repeating it for every tooling edit is not a workflow — and §19 of this brief forbids publishing
   product for tooling changes.

**Why not the other candidates.** Academy, CRM and Partner are further from release concerns than
Backend and carry the same circularity for their own publishes. `/srv/ata/repos/*` are canonical
product mirrors with attached worktrees, root/ata-owned — commits there would require elevation for
routine tooling work.

**Alternative considered and rejected:** `git init` in the live path itself. It makes source and
active path the same directory, which reinstates "edit the live path forever" as the workflow and
leaves no install step to verify — precisely the shape §3 asks us to move away from.

---

## D. Files and tests brought under version control

| Path in source repo | Origin |
|---|---|
| `tools/publish-release.sh` | verbatim import |
| `tools/build-release.sh` | verbatim import |
| `tools/verify-build-provenance.sh` | verbatim import |
| `tools/cutover.sh` | verbatim import |
| `tools/tests/build-provenance.test.sh` | verbatim import |
| `tools/tests/release-packaging.test.sh` | verbatim import |
| `install-release-tooling.sh` | new — the install contract |
| `tests/install-contract.test.sh` | new — the install regression |
| `README.md` | new — the ownership record |

**The regression suites are source-owned (§5).** A critical tool without its regression suite is not
preserved, so both release-tool suites travel with the tooling, and the installer has its own.

Four commits, deliberately separated so the import can be diffed against the live filesystem without
this repository's own additions in the way:

```
92819f6  align the install regression with the corrected mapping
3c737b5  fix the source→destination mapping, and pin it
0d595d7  add the install contract, its regression, and the ownership record
f245c7b  import the canonical PREPROD release tooling, exactly as accepted
```

---

## E. Accepted-tooling hash comparison

Three comparisons, all byte-for-byte identical:

| Comparison | Result |
|---|---|
| accepted tooling → first commit (`f245c7b`) | **IDENTICAL** (6/6) |
| version control → fresh clone, no file copied from the live path | **IDENTICAL** (6/6) |
| accepted tooling → active path after install from source | **IDENTICAL** (6/6) |

**Ownership moved; the tooling did not change.** Every piece of hardening earlier phases paid for was
verified present in the imported source: the per-component source mapping including partner in the
affiliate workspace, the real `source_repository` in the manifest, both packaging exclusions and the
tracked-file exclusion guard, the production artifact gate, build provenance and the stale-artifact
refusal, and the cutover rollback receipt as the single rollback authority.

---

## F. Install / sync contract

`install-release-tooling.sh` — `--check` (compare, change nothing) and `--install`.

**Enumerated, never wildcard.** Six destination-relative names. No `rsync`, no recursive copy, no
recursive remove; the only removals target its own temporary files, asserted by regression on the
code with comments stripped.

**Fail-closed before touching anything.** Every source file is verified to exist, be non-empty, be
executable, and match its *committed* blob, before any destination is written.

**Atomic per file.** Each file is staged as a temp file **in the destination directory** and moved
with `mv` — a rename within one filesystem — so a reader can never observe a half-written publisher.
The staged copy's hash is re-checked before the move.

**Bounded blast radius.** Unrelated files in the destination are left untouched — proven by
regression, and proven accidentally in practice (see §I).

---

## G. Active tooling source identity

`/home/ubuntu/learner-ops-v1/tools/ATA_TOOLING_INSTALLED.json`:

```json
{
  "schema": "ata.tooling.installed/1",
  "source_repository": "/home/ubuntu/ata-release-tooling",
  "source_commit": "92819f6758828ae54de42519c4d003e9e7314f6b",
  "source_tree": "…", "source_branch": "main",
  "files": { "publish-release.sh": "<sha256>", … }
}
```

`--check` compares every enumerated file and reports `ok` / `DIFFERS` / `MISSING`. **Modification
times are never used.** No secret is present, and the installer never opens a runtime config file —
asserted by regression.

---

## H. Negative install tests

`tests/install-contract.test.sh` — **31 assertions, 0 failures**, every one running the real
installer against disposable directories.

| Refusal | Verified |
|---|---|
| source file missing (partial tooling set) | ✅ *and nothing installed before the refusal* |
| source not a git repository | ✅ |
| dirty source working tree | ✅ |
| source file differs from committed content | ✅ (code path present) |
| non-executable source tool | ✅ |
| destination does not exist | ✅ not created implicitly |
| relative destination | ✅ |
| path containing `..` | ✅ structural |
| unknown mode / no mode | ✅ no implicit install |
| active file hand-edited (`--check`) | ✅ reported `DIFFERS`, **and not repaired** |

Plus: unrelated destination files survive with contents intact; executable modes preserved; manifest
valid, names the exact commit, hashes all six files, carries no secret; no recursive remove or copy;
the enumerated set matches every shipped tool; and the source→destination mapping is pinned (§I).

---

## I. Reconstruction proof

Performed under `/srv/ata-data/tooling-ownership-verify`, removed afterwards (§9).

A **fresh clone from version control alone** — no file copied from the live path — reproduced all six
canonical files **byte-for-byte identical** to the accepted tooling.

### A real defect this wave found in its own work

The first installer wrote its file list repo-relative (`tools/publish-release.sh`) and used the same
string under **both** roots, producing `<active>/tools/publish-release.sh` — a parallel tree beside
the real tooling.

Nothing was damaged: the installer only writes files it names, so the six canonical scripts were
verified **byte-for-byte unchanged** afterwards. But nothing was *updated* either, and `--check` then
compared against the parallel copy and reported everything correct. **A verification that can be
satisfied by a directory nobody executes is not a verification.**

Fixed by making the list destination-relative with the source composed explicitly as
`$SRC_ROOT/$SRC_SUBDIR/<name>` — two expressions instead of one path doing double duty. Assertion 13
now pins it: tools land at the top of the destination, suites under `tests/`, no `tools/` tree inside
the destination, and publisher and verifier land as siblings (load-bearing — the publisher resolves
its verifier by `dirname $0`). The parallel tree was removed by literal path and the install redone.

---

## J. Release-tool regression result

Run from the **installed** tooling after the ownership cutover:

| Suite | Result | Previously |
|---|---|---|
| build provenance | **46 passed, 0 failed** | 46 |
| release packaging | **17 passed, 0 failed** | 17 |
| install contract | **31 passed, 0 failed** | new |
| **Total** | **94 passed, 0 failed** | |

No previously accepted assertion was weakened to accommodate the new design.

---

## K. Stale-artifact regression

Re-proved on a **disposable workspace** using the installed tooling:

```
REFUSING: STALE ARTIFACT. The artifact in .next was built from 3fdd7597…, but
  cf9e2cb2… is being published.
```
…then ACCEPT after a canonical build of B.

Additionally confirmed **live**: Backend HEAD is now `d2a091f0` (the documentation commit) while its
release is `69fd1597`, and the gate refuses a publish of that HEAD — the drift §19 sanctions is
visible to the contract rather than silent.

**RELEASE-BUILD-PROVENANCE-1 remains CLOSED.** Nothing in this wave contradicted it.

---

## L. Four-component compatibility

Verified through the installed tooling, no component published:

| Component | Source resolution | Provenance | Env identity |
|---|---|---|---|
| backend | `learner-ops-v1/backend` | ACCEPT `GC3Glmi…` | `f15b3b18…` |
| academy | `learner-ops-v1/academy` | ACCEPT `NnWbgeJ…` | `e22557c4…` |
| crm | `learner-ops-v1/crm` | ACCEPT `HvhG5S4…` | `58fa9e03…` |
| partner | `affiliate-work/partner` | ACCEPT `p2-tG_O…` | `c38f271a…` |

Component-specific behaviour preserved: partner's compiled-**pages** artifact gate (it has no API
routes by design) versus route handlers elsewhere; per-component readiness probes and smoke configs;
the cutover allowlist `backend|academy|crm|partner`.

---

## M. Tooling rollback procedure and proof

```bash
git -C /home/ubuntu/ata-release-tooling log --oneline    # find the last good revision
git -C /home/ubuntu/ata-release-tooling checkout <good>
./install-release-tooling.sh --install
./install-release-tooling.sh --check
bash tools/tests/build-provenance.test.sh && bash tools/tests/release-packaging.test.sh
```

**Proved by reconstruction, without deploying broken tooling:** a clone was rolled back to `3c737b5`,
installed into a disposable destination, `--check` confirmed *"active tooling matches 3c737b5"*, and
the restored tooling passed **46 + 17** assertions.

**No second live copy is kept as a fallback.** Two sources of truth where one is silently stale is
the failure `/srv/ata/previous/` already demonstrated for rollback pointers.

---

## N. Source bundle / preservation

The existing convention is `<name>-<shortsha>.bundle` plus a `.bundle.sha256` sidecar, `0600 ata:ata`
in `/srv/ata/source-bundles/`. Product bundles did **not** cover this tooling, so:

```
/srv/ata/source-bundles/release-tooling-92819f6.bundle          42,381 bytes
/srv/ata/source-bundles/release-tooling-92819f6.bundle.sha256
```

**Verified by reconstruction, not by existence:** sha256 matches its sidecar; a clone *from the bundle
alone* restored all 4 commits and produced tooling **byte-for-byte identical to the running copy**.

The full project backup phase was not started.

---

## O. Documentation result

- **`ata-release-tooling/README.md`** — the full contract: why this repository rather than Backend,
  the source-vs-active split, the update workflow, revision identity, rollback, and the complete
  refusal table.
- **`backend/docs/RELEASE_ARTIFACT_CONTENTS.md`** — a pointer section naming the canonical source
  owner, the active path, install/check commands, how the running revision identifies itself, how
  regressions are run, how rollback works, and **that direct manual edits to the active path are not
  the canonical workflow**. It also records why this file lives in Backend while the tooling does not.

Both are source-owned. Per §19, the Backend documentation commit (`d2a091f0`) was **not** published —
no product runtime was republished for a tooling/documentation change.

---

## P. RELEASE-TOOLING-SOURCE-OWNERSHIP-1

**Severity: HIGH** — critical release/cutover authority existed only as mutable, unversioned
filesystem state.

| Close condition | Status |
|---|---|
| version-controlled owner exists | ✅ `/home/ubuntu/ata-release-tooling`, reasoned selection |
| current accepted tooling represented there | ✅ byte-for-byte, verified three ways |
| regression suites preserved | ✅ both release-tool suites + a new install suite |
| active tooling maps deterministically to a source commit | ✅ `ATA_TOOLING_INSTALLED.json` + `--check` |
| reconstruction passes | ✅ from clone and from bundle |
| rollback procedure proven | ✅ installed an earlier revision, regressions green |

**RELEASE-TOOLING-SOURCE-OWNERSHIP-1 = CLOSED.**

---

## Q. RELEASE-BUILD-INPUT-IDENTITY-1 — carried

**Status: OPEN · NON-BLOCKING HARDENING · not worked in this wave** (per §18).

Provenance records `node_version`, `npm_version` and `package_lock_sha256`; acceptance enforces
source commit/tree plus `BUILD_ID`. A build whose *inputs* changed without the tree changing — a
`node_modules` swap, a different Node major — is not caught. The evidence to detect it is recorded;
enforcement is not.

**No concrete evidence exists that any current release was built with incompatible dependencies.**
All four components report `node v22.14.0` / `npm 10.9.2`. This must not delay Community as a
theoretical concern.

---

## R. Product, release and database health

| Component | Release | Service | Receipt | Resolves |
|---|---|---|---|---|
| backend | `69fd15970b80a98b6aa18972d84ef06187054b26` | active | `e5214ce4…` | ✅ |
| academy | `6ff93eafd6634b7f746e000ff7c958812c5a1783` | active | `99b2b72f…` | ✅ |
| crm | `49f16adad7b4910907e97807f4c67296fa3569a2` | active | `d181d331…` | ✅ |
| partner | `2265f436edf08380261369599e2d9a61b81582c5` | active | `68ade762…` | ✅ |

**All four releases are unchanged from the accepted baseline.** No product release was published or
cut over in this wave.

Migration **52** · integrity **ok** · FK violations **0** · no product data mutation · root free 41G.

Live product spot-check after the ownership cutover — Academy Home renders unchanged:
*Модуль 3 · уровень 15 из 100 · Проверка контрольной точки недоступна · 1700 XP · Завершено 14 из 100*.

One operational note, recorded because it was mine: during reconstruction I briefly widened
`/srv/ata-data/staging` from `0700` to `0755`. It was restored to `0700` immediately and the
verification was redone under a phase-owned directory that has since been removed. No file in that
directory was read, written or deleted.

---

## S. Readiness for Community

The release path is now fully accounted for:

- **what is published** — tree verification (unchanged);
- **what produced it** — build provenance (RELEASE-BUILD-PROVENANCE-1, closed);
- **what produced the tooling** — source ownership (this wave, closed).

Four components build, verify and publish under source-owned tooling; 94 tooling assertions green;
reconstruction and rollback proven; a verified bundle exists; all four applications healthy and
unchanged; database consistent.

`RELEASE-BUILD-INPUT-IDENTITY-1` is carried as non-blocking hardening and should not gate Community.

---

# ATA-PREPROD-RELEASE-TOOLING-SOURCE-OWNERSHIP-1 — FINAL VERDICT = **PASSED**

Stopping here. Not starting Community, full ATA E2E/business acceptance, backup transfer, Data
Engineering, PROD, or storage cleanup. Awaiting explicit human direction.
