# `curriculum/candidates/` — NOT PUBLISHABLE

Everything in this directory is a **source-only candidate**. Nothing here is
published, importable by the release path, or part of any live curriculum.

The publishable packages live in `curriculum/packages/`. The importer
(`scripts/curriculum/importCurriculumPackage.ts`) is pointed at those files and
at no point reads this directory.

## Current state

- **Live / published:** `ata-v2` **revision 3**, from
  `curriculum/packages/ata-v2-first-slice.rev3.approved.json`.
- **This directory:** the L4VC-1 rev4 **candidate** checkpoint requirement.
  It has not been approved, has not been imported, and creates no curriculum
  revision.

## Why the requirement is here and not in the package

A `LevelCheckpointRequirement` is not curriculum content — it is operational
configuration for the verification engine (which threshold, in which currency,
for which integration). Publishing curriculum revision 4 is a separate act with
its own approval; L4VC-1 deliberately does not perform it.

`ata-v2-checkpoint-requirement.rev4-candidate.json` is therefore a deterministic
fixture describing the intended requirement, consumed only by the L4VC-1
regression suites so the engine can be proven against the real intended values.
