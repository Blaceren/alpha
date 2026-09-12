# ATA-PREPROD-RELEASE-BUILD-PROVENANCE-CORRECTION-1 — FINAL REPORT

**Verdict: PASSED** · RELEASE-BUILD-PROVENANCE-1 = **CLOSED** · 0 BLOCKER · 0 HIGH · 2026-08-16

Release tooling only. No Academy or Community product behaviour was changed, no schema, no
migration, no deletion, no PROD.

---

## A. Exact root cause

The publisher had **two verification systems that never met.**

| System | What it proves | What it never looks at |
|---|---|---|
| Tree verification | every file `git ls-tree -r --name-only <commit>` names is in the artifact byte-for-byte | `.next` — it is gitignored, so it is never enumerated |
| Production artifact gate (§B) | `.next` IS a production build, has valid manifests, compiled output, and SERVES under `next start` | the source — every check is satisfied by *any* valid production build of *any* revision |

**Nothing in the publisher related `.next` to `$COMMIT`.** The gap is structural — not a bug in any
single line — which is why it survived a gate that had already been hardened once, and why
`.gitignore` is what made it invisible: the artifact is deliberately untracked, and the verification
loop only walks tracked files.

Confirmed on all four components: `.next` is gitignored in backend, academy, crm and partner.

---

## B. Original failure reproduction

### Forensic — the actual incident artifact, still on disk

Release `03f981a1`:

| Field | Value |
|---|---|
| manifest `source_commit` | `03f981a1…` (correct) |
| manifest `source_tree` | `eb0ee29e…` (correct) |
| manifest `tree_verification` | "matches git tree … with zero differences (1091 files)" (true) |
| `src/app/api/learner-ops/cases/route.ts` → `learnerOpsCaseLevel` | **2 occurrences — source correct** |
| `src/lib/learner-ops/learner-projection.ts` | **present — source correct** |
| `.next/server/app/api/learner-ops/cases/route.js` → `levelNumber` | **0 occurrences — artifact stale** |

Corrected release `e5214ce4` had `levelNumber` present. Everything the release *claimed* was true;
the compiled code was from an earlier source state.

### Mechanical — reproduced against the publisher's own expressions

`tools/tests/build-provenance.test.sh` builds a synthetic component, commits A, "builds" A, moves
the source to B without rebuilding, and asserts (RED):

- tree verification **passes** for B while `.next` holds A's output;
- the enumeration **never names `.next`**, so it cannot check it;
- the stale artifact **satisfies every structural artifact check**;
- source says B, compiled output says A.

All four RED assertions pass — the defect is reproducible on demand.

---

## C. Affected components

All four, identically. Each is a Next.js app whose generated output is untracked.

| Component | Build | Artifact | Identity | Source workspace |
|---|---|---|---|---|
| backend | `next build` | `.next` | `BUILD_ID` | `learner-ops-v1/backend` |
| academy | `next build` | `.next` | `BUILD_ID` | `learner-ops-v1/academy` |
| crm | `next build` | `.next` | `BUILD_ID` | `learner-ops-v1/crm` |
| partner | `next build` | `.next` | `BUILD_ID` | `affiliate-work/partner` |

Legitimate per-component differences were **preserved**, not flattened: partner's artifact gate still
counts compiled *pages* rather than route handlers (it has no API routes by design), and each
component keeps its own readiness probe and smoke configuration.

---

## D. Chosen provenance model

**Model B — a build-owned provenance record the publisher requires** (brief §3B).

### "Publisher builds" was evaluated first, and rejected — with reasons

It is the strongest model, and it would have coupled the publisher to **every component's runtime
configuration**: the Academy build fails without `ACADEMY_MODE`, the CRM needs its mode and origin,
the Backend needs a `DATABASE_URL` for Prisma. Those live in `/srv/ata/config/*.env`, which is
`drwx------ ata:ata` and also holds secrets.

Making the publisher build would have meant a publisher that cannot run for a component whose runtime
config is not installed on that host, and that drags secret-bearing files toward a step with no need
of them. Headroom was not the constraint (41 GiB free, ~200 MiB–1 GiB per candidate) — **coupling
was**.

The chosen split keeps environment knowledge in one tooling place and leaves the publisher verifying
only the result. Stale artifacts are impossible either way.

### The invariant

```
the artifact in .next was produced by tools/build-release.sh
FROM EXACTLY the commit and tree being published
```

### Two bindings, because there are two ways to drift

| Binding | Catches |
|---|---|
| `source_commit` + `source_tree` vs git HEAD | **STALE ARTIFACT** — source moved on after the build. *This is the incident.* |
| `build_id` vs actual `.next/BUILD_ID` | **STALE RECORD** — `.next` was rebuilt by other means (bare `npm run build`, an IDE, a dev server), so the record no longer describes what is there |

Plus `component` (another app's record cannot satisfy this one), `schema` (an unknown record shape is
refused, not read optimistically), and a non-empty `build_env_identity`.

**Explicitly not accepted as proof:** mtimes, "the build directory is newer than the source", a clean
workspace, or operator recollection. *The workspace was clean throughout the incident.*

---

## E. Publisher changes

Three files, all in the source-owned release tooling location. No product commits were made to
exercise publishing.

| File | Role |
|---|---|
| `tools/build-release.sh` (new) | the canonical build; the only supported way to produce a publishable artifact |
| `tools/verify-build-provenance.sh` (new) | **the single implementation of the rule** |
| `tools/publish-release.sh` (changed) | calls the verifier at §B1b, before the smoke test and before staging |

**Why the verifier is its own script.** The publisher resolves `$SRC` from a fixed per-component
mapping and must keep doing so — the caller may name a component, never a path, and that is a safety
property. It therefore cannot be pointed at a synthetic workspace, so a regression would have had to
*reimplement* the rule, and a test that restates its subject proves nothing about shipped code. One
implementation; the publisher and the regression both call it.

**The build script:** refuses a dirty tracked workspace → captures commit and tree → builds under the
component's canonical environment → **re-checks that commit, tree and cleanliness did not change
during the build** (a build takes minutes and a workspace is live) → writes the record. It deletes
any prior record *before* building, so a failed build cannot leave a record describing something else.

**Environment safety (§10).** No runtime env file is ever sourced; no `env $(cat … | xargs)`. Keys
are read line-anchored, one at a time, from a **hard allowlist** (`READABLE_CONFIG_KEYS`) checked
*before* anything opens the file — because the read elevates, and an elevated read of an arbitrary
key from a secret-bearing file would be a credential-reading primitive wearing a build script's name.
Only key *names* reach argv; values are captured into variables and never echoed, logged or written
to any manifest. The Backend builds against a **throwaway** `DATABASE_URL`, never the live database.

`build_env_identity` digests the build **contract**; `build_env_keys` names exactly the keys that
digest covers, so the record cannot disagree with itself about its own scope. Host tuning
(`NODE_OPTIONS`, needed or this host OOMs during static generation) is recorded separately and kept
out of the digest — a bigger heap on one machine does not make the artifact a different thing.

---

## F. Manifest changes

`ATA_RELEASE_MANIFEST.json` gained a `build_provenance` block, and the record itself now travels
inside the release at `.next/ATA_BUILD_PROVENANCE.json` — so "what source produced this running
artifact?" is answerable from the release directory alone, without the manifest and without the
publisher.

Live release `69fd1597`:

```json
"build_provenance": {
  "schema": "ata.build.provenance/1",
  "verified": "the artifact was produced by tools/build-release.sh from source_commit/source_tree above; BUILD_ID matches the record",
  "build_env_identity": "f15b3b18fac90fde…",
  "built_at_utc": "2026-08-16T17:48:42Z",
  "record_in_release": ".next/ATA_BUILD_PROVENANCE.json"
}
```

The publisher re-asserts the record on the **staged copy** — commit and BUILD_ID — exactly as it
already does for `BUILD_ID`, so a truncated copy cannot become a release.

---

## G. Negative regression matrix

`tools/tests/build-provenance.test.sh` — **46 assertions, 0 failures**. Every refusal below is
produced by the **shipped verifier**, invoked exactly as the publisher invokes it.

| Case | Result |
|---|---|
| source changed after build (the incident) | `REFUSE:commit` |
| wrong source tree (commit patched, tree stale) | `REFUSE:tree` |
| wrong component provenance | `REFUSE:component` |
| record not matching the present artifact | `REFUSE:build_id` |
| artifact has no `BUILD_ID` at all | `REFUSE:build_id` |
| missing `build_env_identity` | `REFUSE:env` |
| missing provenance | `REFUSE:missing` |
| malformed provenance (invalid JSON) | `REFUSE:malformed` |
| unknown provenance schema | `REFUSE:schema` |
| **canonical build of the published commit** | **ACCEPT** |
| accepted artifact's compiled output matches source | asserted |

Structural assertions: publisher invokes the contract; the verifier binds all six fields; builder
captures commit/tree, refuses a dirty workspace, binds to `BUILD_ID`, sources no env file, uses no
`xargs`; publisher and builder resolve the **same** source workspaces; all four components have a
workspace mapping **and** a declared build environment; the record is **not** excluded by packaging;
the publisher re-asserts it on the staged copy; the manifest records it.

Run against disposable `mktemp` workspaces (§5) — never live application source.

---

## H. Positive build/publish regression

Every component built canonically and verified:

| Component | BUILD_ID | Bound to | Env identity | Verify |
|---|---|---|---|---|
| backend | `GC3GlmiUThoqa5x8yZSsH` | `69fd1597…` | `f15b3b18…` | ACCEPT |
| academy | `NnWbgeJHjuC5a2VNqkPAt` | `6ff93eaf…` | `e22557c4…` | ACCEPT |
| crm | `HvhG5S4FvACFTkvF0KPgC` | `49f16ada…` | `58fa9e03…` | ACCEPT |
| partner | `p2-tG_Oxx2P00N2_jnDqv` | `2265f436…` | `c38f271a…` | ACCEPT |

Four distinct environment identities, each covering that component's real contract:
backend `DATABASE_URL NEXT_TELEMETRY_DISABLED NODE_ENV` · academy `ACADEMY_MODE BACKEND_ORIGIN …` ·
crm `CRM_BACKEND_ORIGIN CRM_MODE …` · partner `PARTNER_BACKEND_ORIGIN …`.

---

## I. Exact stale-build refusal / rebuild proof

Reproduced **twice on the real publisher and the real Backend**, not in a fixture.

**Proof 1** — workspace at `e4bc4e98`, artifact built from `e5214ce4`:

```
REFUSING: STALE ARTIFACT. The artifact in .next was built from e5214ce4…, but
  e4bc4e98… is being published. This is the exact defect this gate exists for:
  the source is correct and the compiled output is from an earlier revision.
      tools/build-release.sh backend
```
→ no release directory created. Then `build-release.sh backend` → publish → **ACCEPT**.

**Proof 2** — workspace at `69fd1597`, artifact built from `e4bc4e98`: same refusal, same absence of
a release directory. Then canonical build → publish → **ACCEPT** → cutover.

This is §17 exactly: a developer changes Backend source, the workspace still holds an older
successful `.next`, they invoke the canonical publisher — and it refuses with the rebuild command
instead of publishing the old artifact under the new SHA.

---

## J. Live PREPROD proof

The candidate was a **genuinely needed** source-owned documentation correction (§16), not a change
invented to obtain a SHA: the release contract document stated that tree verification is what makes a
release trustworthy, which was materially wrong after this finding.

| Step | Result |
|---|---|
| commit `e4bc4e98` — document the provenance contract | backend tests 282 passed |
| publish with stale artifact | **REFUSED** |
| canonical build → publish `e4bc4e98` | ACCEPT (published, not activated) |
| commit `69fd1597` — document identity scope and the config read | — |
| publish with stale artifact | **REFUSED** |
| canonical build → publish `69fd1597` | ACCEPT, tree-verified 1092/1092 |
| cutover `69fd1597` | active/running, `NRestarts=0` |

**Product behaviour verified unchanged** after cutover, in the live browser on the Academy L14
surface: mentor feedback still renders with `MENTOR-FEEDBACK-CANARY-7413`; the internal note remains
absent; the completion moment still shows *Уровень 14 завершён · +250 XP · 14 из 100*; the CTA is
still quiet; the material handoff still present. A documentation-only change is behaviourally inert —
which is the point: the publisher refused it anyway, because the rule is about provenance, not about
whether the change happens to matter.

---

## K. Cache / tree-verification regression

`tools/tests/release-packaging.test.sh` — **17 assertions, 0 failures, unchanged and not weakened.**

`.next/cache` and `.next-cache-seed` absent from the artifact · `.git` excluded · runtime `.next/server`,
`.next/static` and manifests retained · `node_modules` a real directory · the tracked-path guard still
refuses an exclusion covering committed files · the size gate still measures what is actually written
· tar and du exclusion lists still in step · the RED proof still shows the old packaging leaking both
paths.

Verified on the published release: `.next/cache` absent, `.next-cache-seed` absent. Tree verification
is **retained in full** (§7) — the provenance gate is additional, never a replacement, and the new
regression asserts the provenance record is *not* excluded by packaging.

---

## L. Release and receipt health

| Component | Current release | Rollback receipt | Resolves | Service |
|---|---|---|---|---|
| backend | `69fd15970b80a98b6aa18972d84ef06187054b26` | `e5214ce4…` | ✅ | active |
| academy | `6ff93eafd6634b7f746e000ff7c958812c5a1783` | `99b2b72f…` | ✅ | active |
| crm | `49f16adad7b4910907e97807f4c67296fa3569a2` | `d181d331…` | ✅ | active |
| partner | `2265f436edf08380261369599e2d9a61b81582c5` | `68ade762…` | ✅ | active |

Only Backend was republished/cut over. Academy, CRM and Partner releases were **not touched**; their
workspaces gained provenance records, which changes nothing about what is published or running.

---

## M. Database consistency

Migration **52** · integrity **ok** · FK violations **0**. No migration created, no schema change, no
product mutation.

---

## N. Documentation

`backend/docs/RELEASE_ARTIFACT_CONTENTS.md` now states, as the contract rather than as commentary:

- source verification alone is insufficient for generated applications, **and exactly why** — the
  enumeration walks tracked files and `.next` is untracked;
- the incident, named, with the release that shipped it;
- the invariant now enforced, and the two bindings that enforce it;
- what is **not** accepted as proof;
- the three-step flow (`build-release.sh` → `publish-release.sh` → `cutover.sh`);
- why the publisher does not build;
- what the environment identity covers and what it deliberately excludes;
- how the runtime config is read without reading secrets.

---

## O. RELEASE-BUILD-PROVENANCE-1

**Severity: HIGH** — a release could claim one source revision while serving compiled code from
another.

| Close condition | Status |
|---|---|
| root cause reproduced | ✅ forensically on the incident artifact, and mechanically in a disposable workspace |
| tooling corrected | ✅ canonical builder, single-owner verifier, publisher gate, manifest, carried record |
| negative regression passes | ✅ 46/46, all refusals from the shipped verifier |
| positive regression passes | ✅ all four components build, verify and publish |
| real PREPROD proof passes | ✅ refused twice, accepted after canonical rebuild, cut over, service healthy |

**RELEASE-BUILD-PROVENANCE-1 = CLOSED.**

No further BLOCKER or HIGH findings in this scope.

---

## P. Current root free space

```
/dev/sda1   96G total   56G used   41G available   58%
```

Two Backend releases were added (~208 MiB each). Nothing was deleted; reclamation remains a
deliberate human decision under `docs/RELEASE_RETENTION.md`.

---

## Q. Readiness to resume the product roadmap

The correction is complete and self-contained. Academy product behaviour is unchanged and verified
live. The previous phase (`ATA-PREPROD-ACADEMY-EXPERIENCE-COMPLETION-1`) remains PASSED and was not
reopened.

**Remaining non-blocking observations, for the record:**

1. **The release tooling is not version controlled.** `/home/ubuntu/learner-ops-v1/tools/` is not
   inside any git repository, so this correction — like the publisher hardening before it — has no
   commit history, no review trail and no rollback. That is a larger gap than the one just closed and
   deserves its own decision.
2. **Release `e4bc4e98` is published but was never activated.** It is a valid, verified release; its
   record was written minutes before the identity-scope clarification, so its `build_env_keys` lists
   `NODE_OPTIONS` while its digest covers the three contract keys. All load-bearing bindings
   (component, commit, tree, `BUILD_ID`) are correct and it verifies clean under the current tooling.
3. **The contract binds to the git tree, not to a digest of build inputs.** A build whose *inputs*
   change without the tree changing — a `node_modules` swap, a different Node major — is not caught.
   `node_version`, `npm_version` and `package_lock_sha256` are recorded, so the evidence to detect it
   exists; enforcing it was out of scope here.

---

# ATA-PREPROD-RELEASE-BUILD-PROVENANCE-CORRECTION-1 — FINAL VERDICT = **PASSED**

Stopping here. Not starting Community, full ATA E2E/business acceptance, backup transfer, Data
Engineering, PROD, or storage cleanup.
