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
* `.next-cache-seed`

`.next/cache` holds the webpack, swc and eslint caches that make the NEXT build
faster. Nothing serves from it. Measured on the PREPROD host before this rule
existed: a backend release was 1306 MiB, of which 650 MiB was `.next/cache` and
447 MiB a stray `.next-cache-seed` — 84% of an immutable artifact in which the
running service held zero open file descriptors.

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
