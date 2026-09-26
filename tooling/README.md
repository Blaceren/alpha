# ATA PREPROD release tooling — canonical source

This repository is the **canonical source owner** of the PREPROD release tooling:
build provenance, artifact verification, publishing, cutover, rollback receipts,
source selection, cache exclusions and release manifests.

Until `ATA-PREPROD-RELEASE-TOOLING-SOURCE-OWNERSHIP-1` that tooling existed only as
mutable, unversioned files on the live filesystem. Corrections to it had no commit,
no review trail, no rollback and no reconstruction point.

## Why a dedicated repository, and not Backend

Backend owns the release *documentation* (`docs/RELEASE_ARTIFACT_CONTENTS.md`,
`docs/RELEASE_RETENTION.md`) and it was the obvious candidate. It is the wrong owner
for the *tooling*, for two concrete reasons:

1. **Circularity.** The publisher publishes Backend. Putting it inside Backend means a
   Backend release contains the publisher that produced it.
2. **Forced coupling.** Under the build-provenance contract, a commit to Backend that
   is not rebuilt cannot be published — so a pure tooling edit would either force a
   Backend rebuild, publish and cutover, or leave Backend HEAD drifting ahead of its
   release. That cost was paid once, in the provenance wave, to land a documentation
   change. Repeating it for every tooling edit is not a workflow.

Every other repository on the host is a product application repository
(backend / academy / crm / partner). There was no cross-component engineering owner,
so one exists now. The tooling serves all four components and belongs to none of them.

## Layout

```
install-release-tooling.sh      the install contract — the only sanctioned way to
                                change the active tooling
tools/publish-release.sh        publish one candidate as an immutable release
tools/build-release.sh          the canonical build; writes build provenance
tools/verify-build-provenance.sh   the single implementation of the provenance rule
tools/cutover.sh                repoint `current` and write the rollback receipt
tools/tests/                    the release-tool regressions
tests/install-contract.test.sh  the install contract regression
```

## Source vs active path

```
VERSION-CONTROLLED SOURCE          →   install   →   ACTIVE TOOLING PATH
/home/ubuntu/ata-release-tooling                     /home/ubuntu/learner-ops-v1/tools
```

They are deliberately different directories. The active path is unchanged from before
this repository existed: nothing on the host references it by another name, no systemd
unit or timer invokes it, and the publisher resolves its verifier as a sibling — so
moving it would have been operational risk bought for tidiness.

**Direct manual edits to the active path are not the canonical workflow.** They are
detectable (`--check` reports `DIFFERS`) and they are lost on the next install.

## Updating the tooling

```bash
# 1. edit HERE, in the source repository
vim tools/publish-release.sh

# 2. prove it
bash tools/tests/build-provenance.test.sh
bash tools/tests/release-packaging.test.sh
bash tests/install-contract.test.sh

# 3. commit — the installer refuses a dirty tree, because the commit it records
#    would otherwise be a lie
git commit -am "..."

# 4. install
./install-release-tooling.sh --install

# 5. confirm
./install-release-tooling.sh --check
```

## Which revision is active

The installer writes `ATA_TOOLING_INSTALLED.json` into the active path:

```json
{
  "schema": "ata.tooling.installed/1",
  "source_repository": "/home/ubuntu/ata-release-tooling",
  "source_commit": "…",
  "source_tree": "…",
  "files": { "tools/publish-release.sh": "<sha256>", … }
}
```

`--check` compares every enumerated file against the source and reports `ok`,
`DIFFERS` or `MISSING`. Modification times are never evidence of anything.

## Rollback

A bad tooling commit is recovered the same way a bad release is — by revision, not by
memory:

```bash
git -C /home/ubuntu/ata-release-tooling log --oneline    # find the last good revision
git -C /home/ubuntu/ata-release-tooling checkout <good>  # detached HEAD is fine
./install-release-tooling.sh --install
./install-release-tooling.sh --check
bash tools/tests/build-provenance.test.sh
bash tools/tests/release-packaging.test.sh
```

There is deliberately **no second live copy** kept as a fallback. Two sources of truth
where one is silently stale is the failure `/srv/ata/previous/` already demonstrated
for rollback pointers.

## What the installer refuses

| Condition | Why |
|---|---|
| source file missing | a publisher without its verifier is worse than neither |
| source not a git repository | there is no revision to record |
| dirty source working tree | the recorded commit would be a lie |
| source file differs from its committed content | an uncommitted edit would ship unreviewed |
| non-executable source tool | it would install something the operator cannot run |
| destination does not exist | a release-tooling path is never created implicitly |
| relative destination | scope must be unambiguous |
| path containing `..` | it could write outside the destination |
| unknown or absent mode | there is no implicit install |
| active file differs (`--check`) | drift is reported, never silently repaired |

It writes only the files on its enumerated list. There is no `rsync`, no recursive
copy and no recursive remove; the only removals target its own temporary files, and
unrelated files in the destination are left untouched. Each file is staged in the
destination directory and moved into place with `mv`, so a reader never observes a
half-written publisher.

## Preservation

A git bundle of this repository lives at `/srv/ata/source-bundles/release-tooling.bundle`,
alongside the product bundles, and is verified by reconstruction.
