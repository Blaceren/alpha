# RELEASE ARTIFACT CONTENTS

A release is the artifact that SERVES. It is not a copy of the workspace.

## What a release contains

* `.next/server`, `.next/static`, `.next/types` and the manifests
  (`BUILD_ID`, `routes-manifest.json`, `required-server-files.json`) — what
  `next start` reads;
* `node_modules` — a real directory, never a symlink, because the deployment
  model runs the release in place;
* `src`, `scripts`, `prisma` and the other tracked sources, which the tree
  verification checks byte-for-byte against the published commit.

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
