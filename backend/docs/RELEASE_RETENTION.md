# Release retention and safe reclaim

POCKET-REG-SECURITY-CLOSURE-1 (F5/P1). The publisher refuses to run without
headroom and **never deletes anything**; this document is what a human reads
when it refuses.

## Why this exists

The Pocket REG ingress phase ran the filesystem down to ~1.2 GB free while three
~1 GB release trees were in flight, and lost two production builds to it. The
failures were not obvious — a build killed under disk pressure reports whatever
happened to fail first, which sent the phase looking for a source defect that
did not exist. Headroom is now a gate in `tools/publish-release.sh`:

```
needed = size(candidate) + 2 GiB margin
```

Insufficient headroom fails **before** the build is copied, with a message
pointing here.

## Measured requirements (backend, 2026-08-14)

| item | measured |
|---|--:|
| candidate worktree incl. `node_modules` and `.next` | ~750 MiB |
| published release tree | ~730 MiB |
| `.next/cache` inside a fresh build | ~400 MiB |
| peak transient during `next build` | ~1.2 GiB above steady state |

A wave that publishes backend + CRM + academy needs roughly **3 GiB** of real
headroom, plus the 2 GiB margin the guard enforces.

## SAFE to reclaim

Regenerable, owned by the current phase, and reproducible from source:

* `.next/cache/` inside a **working candidate** — pure build cache;
* `.next/` of a candidate that was **never published**;
* `.next/` inside a completed-phase **worktree** (not a release);
* `node_modules/.cache/`;
* the npm cache (`npm cache clean --force`);
* a `.partial-<commit>` staging directory left behind by a **failed** publish,
  after confirming no publish is in flight;
* this phase's own scratch copies of the database.

## NEVER reclaim automatically

* the **active** release of any component (`/srv/ata/current/*` targets);
* any **rollback** release named in a phase's rollback material;
* a **forensic** release retained as incident evidence;
* audit packages and their evidence;
* database backups in `/srv/ata-data/backups/`;
* migration files.

Removing a release requires a human decision with the rollback chain in front of
them. "It looked old" is not a reason: the parent phase's rollback target was
three days old and was the only thing that restored service.

## How to reclaim

Delete by **literal, complete path**, one at a time, having listed it first.

Never build a deletion target from a variable, a glob over a release root, or a
`find … -exec rm`. A wrong expansion here removes the release the platform is
currently serving.

```bash
du -sh /home/ubuntu/<exact-worktree>/.next
rm -rf /home/ubuntu/<exact-worktree>/.next
```

## If the guard still refuses

Do not lower the margin to get past it. Either reclaim from the SAFE list, or
stop and get more disk. The margin exists because the failure it prevents —
a truncated release that passes a file check and dies at activation — costs far
more than the wait.
