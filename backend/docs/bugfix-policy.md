# Bugfix Policy

The Closed Testing MVP is frozen at `0.1.0-beta.1`. Work after this point is bugfix-only unless a new planning pass explicitly reopens product scope.

## What counts as a bugfix

- A tester cannot complete an existing flow.
- A seeded/demo account or role lands on the wrong page.
- A protected API allows the wrong role or blocks the right role.
- A smoke, visual QA, readiness, backup, restore, or beta-reset check fails.
- Data cleanup leaves feedback, support, audit, upload, or smoke records dirty.
- Copy is misleading for the current beta behavior.
- A security or privacy issue is found in an existing surface.

## Allowed change types

- Bugfixes.
- Security fixes.
- Copy fixes.
- Broken-flow fixes.
- Smoke/verification fixes.
- Documentation fixes.
- Seed, backup, restore, and beta-reset fixes.

## Not allowed without a new scope decision

- New product features.
- Marker: new product features are not allowed during freeze.
- Design redesign.
- New Prisma models unless the issue is a blocker.
- Real external provider integration.
- Production infrastructure migration.
- Large refactors without a concrete failing flow.

## Verification expectation

For any bugfix, run the smallest relevant check first. Before handing a freeze build back to testers, run:

```powershell
npm.cmd run release:check
npm.cmd run db:backup
```

If a local listener was started for debugging, confirm that no process is still listening on `3009`.
