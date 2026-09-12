# RELEASE ARTIFACT CONTENTS

A release is the artifact that SERVES. It is not a copy of the workspace.

## What a release contains

* `.next/server`, `.next/static`, `.next/types` and the manifests
  (`BUILD_ID`, `routes-manifest.json`, `required-server-files.json`) — what
  `next start` reads;
* `node_modules` — a real directory, never a symlink, because the deployment
  model runs the release in place;
* `src`, `scripts`, `prisma` and the other tracked sources, which the tree
  verification checks byte-for-byte against the published commit;
* `.next/ATA_BUILD_PROVENANCE.json` — the record binding the compiled artifact to
  the commit it was built from (see "Source verification alone is not enough").

## What a release deliberately omits

* `.git`
* `.next/cache`
* `.next-cache-seed` (see below)

`.next/cache` holds the webpack, swc and eslint caches that make the NEXT build
faster. Nothing serves from it. Measured on the PREPROD host before this rule
existed: a backend release was 1306 MiB, of which 650 MiB was `.next/cache` — half
an immutable artifact in which the running service held zero open file descriptors.

`.next-cache-seed` is not listed here because it no longer exists in the
repository. It was 447 MiB of committed webpack packs that `.gitignore` never
covered (`.next/` does not match the sibling path), so the publisher was correct
to ship it: excluding TRACKED files would break the release-matches-git guarantee.
It was untracked at the repository level instead, and
`scripts/regression/repositoryHygieneRegression.ts` keeps it out. Only once it was
untracked could the publisher exclude it: packaging copies the filesystem, so a
workspace may still keep the directory for local build speed without shipping it.

Shipping them cost three ways: the releases themselves, the headroom the publish
gate demanded before each publish, and the DISK-HEADROOM stops that followed.

## The source workspace keeps its caches

Nothing is deleted from the working tree. The next local build is exactly as
fast as it was. This is a packaging rule, not a cleanup.

## The size gate measures the artifact

`publish-release.sh` computes candidate size with the same exclusions the
packaging step applies, so the guard can no longer refuse a publish because of
bytes that were never going to be written. The 2 GiB safety margin is unchanged.

The exclusions are declared once, in `RELEASE_EXCLUDE_PATHS`, and asserted on the
STAGED copy — the promise is verified on the artifact, not trusted from a flag.

## Where a release comes from

`publish-release.sh` resolves the candidate workspace per component, because they
do not all live in one place:

| component | source workspace |
|---|---|
| backend, crm, academy | `/home/ubuntu/learner-ops-v1/<component>` |
| partner | `/home/ubuntu/affiliate-work/partner` |

That mapping used to be a single hardcoded `learner-ops-v1/<component>`, which
was right for three components and had never been right for the partner console.
The effect was not a wrong release but no release: the publisher refused with
"candidate workspace does not exist", so Partner sat outside the canonical flow
while every other partner-specific branch in the publisher — the compiled-pages
artifact gate, the `/login` readiness probe — was already written and waiting.

`ATA_RELEASE_MANIFEST.json` records the workspace the artifact was actually built
from. It used to record a fixed string that had stopped being true for three of
the four components; provenance a reader cannot trust is worse than none.

## Source verification alone is not enough (RELEASE-BUILD-PROVENANCE-1)

**Tree verification proves the SOURCE in a release matches git. It proves nothing
about the compiled artifact beside it.**

The reason is structural, not a bug in any one line: tree verification iterates
`git ls-tree -r --name-only <commit>`, which enumerates TRACKED files only.
`.next` is gitignored in all four components, so the generated artifact was never
enumerated and never compared against anything. The production artifact gate
proves `.next` IS a production build and SERVES — but every one of those checks
is satisfied by any valid production build of any revision.

Neither system crossed the gap, and a real release fell through it. Backend
`03f981a1` shipped correct source, a truthful manifest naming the correct commit
and tree, a passing artifact gate and a running service — and a compiled route
that did not contain the code its own source declared, because `.next` had been
built before the source edit. It was found by querying the live API, not by any
gate.

### The invariant now enforced

```
the artifact in .next was produced by tools/build-release.sh
FROM EXACTLY the commit and tree being published
```

### How it works

`tools/build-release.sh <component>` is the only supported way to produce a
publishable artifact. It refuses a dirty workspace, captures the commit and tree
before building, builds under the component's canonical environment, re-checks
that the source did not move during the build, and writes
`.next/ATA_BUILD_PROVENANCE.json` binding what it produced to what it built from.

`tools/verify-build-provenance.sh` is the single implementation of the rule.
`publish-release.sh` calls it, and so does the regression — one implementation,
and it is the one that runs in production.

**Two bindings, because there are two ways to drift:**

| binding | catches |
|---|---|
| `source_commit` / `source_tree` | a STALE ARTIFACT — the source moved on after the build. This is the incident. |
| `build_id` vs `.next/BUILD_ID` | a STALE RECORD — `.next` was rebuilt by other means (a bare `npm run build`, an IDE, a dev server), so the record no longer describes what is there. |

The record also names its `component`, so another app's record cannot satisfy
this one, and a `build_env_identity` digest over the exact non-secret build
variables used, so two artifacts can be compared for build-contract equality.

### What the environment identity covers, and what it deliberately does not

`build_env_identity` is a digest over the build CONTRACT — the compile-relevant
variables the component declares. `build_env_keys` names exactly the keys that
digest covers, so the record can never disagree with itself about its own scope.

Host tuning is recorded separately, in `build_host_tuning`, and is **not** in the
digest. Today that is `NODE_OPTIONS`: this host needs a larger heap or the
Backend build is killed during static generation. Needing a bigger heap on one
machine does not make the resulting artifact a different thing, so two artifacts
built from the same source under the same contract still compare equal.

### Reading the runtime config without reading secrets

The per-component environment comes from `/srv/ata/config/<component>.env`,
which is `drwx------ ata:ata` — an ordinary build user cannot open it. The build
script therefore elevates for the read, and that is exactly why the keys it may
read are a hard allowlist (`READABLE_CONFIG_KEYS`) checked *before* anything
opens the file. An elevated read of an arbitrary key from a file that also holds
secrets would be a credential-reading primitive wearing a build script's name;
the worst this one can fetch is a mode or an origin.

Only the key NAME reaches argv. The value arrives on stdout, is captured into a
variable, and is never echoed, logged, or written to any manifest. The file is
never sourced, and no line other than the matched one is read.

**Not accepted as proof:** mtimes, "the build directory is newer than the
source", a clean workspace, or an operator's recollection. The workspace was
clean throughout the incident.

### Publishing, end to end

```
tools/build-release.sh   <component>
tools/publish-release.sh <component> <commit> <tree>
tools/cutover.sh         <component> <commit> <build-id>
```

### Where that tooling lives, and who owns it

**Canonical source:** `/home/ubuntu/ata-release-tooling` (its README is the full
contract).
**Active execution path:** `/home/ubuntu/learner-ops-v1/tools` — unchanged, and
deliberately a different directory from the source.

This document lives in Backend because Backend owns the release *documentation*.
It does **not** own the release *tooling*, and should not: the publisher publishes
Backend, so a Backend release would contain the publisher that produced it, and
under the provenance contract above a tooling edit committed here would force a
Backend rebuild, publish and cutover — or leave Backend HEAD drifting ahead of its
release. The tooling serves all four components and belongs to none of them
(RELEASE-TOOLING-SOURCE-OWNERSHIP-1).

```
VERSION-CONTROLLED SOURCE          →  install  →  ACTIVE TOOLING PATH
/home/ubuntu/ata-release-tooling                  /home/ubuntu/learner-ops-v1/tools
```

**Direct manual edits to the active path are not the canonical workflow.** Edit the
source, prove it, commit it, then:

```bash
/home/ubuntu/ata-release-tooling/install-release-tooling.sh --install
/home/ubuntu/ata-release-tooling/install-release-tooling.sh --check
```

The active path carries `ATA_TOOLING_INSTALLED.json`, naming the source repository,
commit, tree and a sha256 per installed file — so "which revision is running?" is
answerable without trusting a modification time. `--check` reports `ok`, `DIFFERS`
or `MISSING` per file and never repairs drift silently.

**Regressions** (all must be green before an install):

```bash
bash tools/tests/build-provenance.test.sh
bash tools/tests/release-packaging.test.sh
bash /home/ubuntu/ata-release-tooling/tests/install-contract.test.sh
```

**Rollback** is by revision, not by memory: `git checkout <good>` in the source
repository, `--install`, `--check`, then re-run the regressions. There is no second
live copy kept as a fallback — two sources of truth where one is silently stale is
the failure `/srv/ata/previous/` already demonstrated.

A verified git bundle lives at `/srv/ata/source-bundles/release-tooling-<short>.bundle`.

A `.next` without a matching record is refused with the exact rebuild command.
Building is a separate step rather than something the publisher does, so the
publisher stays free of every component's runtime configuration — the Academy
needs `ACADEMY_MODE`, the CRM its mode and origin, the Backend a `DATABASE_URL`
for Prisma, and those live in root-owned files the publisher has no business
reading. The build script owns that knowledge in one place; the publisher
verifies only the result.

The build environment is never sourced from a runtime env file. Each component
declares an explicit allowlist of non-secret, compile-relevant keys, read
line-anchored, so a secret cannot be picked up even if one is added to those
files later. The Backend builds against a throwaway `DATABASE_URL`, never the
live database.

## Rollback authority — one owner, no second opinion

**The canonical rollback anchor for every component is:**

```
/srv/ata-data/access-control/.cutover-rollback-<component>
```

`cutover.sh` writes it, and nothing else does. It is written before the symlink
swap, from the link's own current target, so it always names a release that was
serving traffic a moment earlier. It advances on every cutover.

Read it, and confirm the directory it names still exists, before planning any
rollback or any release deletion. A release named by a receipt is live rollback
state, not history.

**`/srv/ata/previous/` is retired.** It was an earlier rollback pointer that the
receipt mechanism superseded. Nothing read or wrote it — not systemd, not nginx,
not the publisher, not the cutover tool, not any timer — and because nothing
maintained it, it drifted: `previous/backend` still named `4208e719` across seven
subsequent cutovers, and it never had entries for academy or partner at all. Two
rollback pointers where one is silently stale is worse than one, which is why the
stale one is gone rather than repaired (ROLLBACK-ANCHOR-DRIFT-1).

If you find a `previous/` reference in an older phase report, it is historical
text describing this problem, not an instruction.
