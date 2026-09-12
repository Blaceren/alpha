# Version

## 0.1.0-beta.1

- Freeze date: 2026-07-01
- Status: Closed Testing MVP
- Code state: Code freeze / bugfix-only
- Environment: local/RC closed beta
- Production-grade: no
- Commercial product readiness: not final

This marker freezes the current MVP for closed testing after Closed Beta Hardening Pass 8. Further code changes should go through the bugfix-only workflow unless a separate post-beta product planning pass is opened.

## Verification baseline

The beta freeze baseline requires:

```powershell
npm.cmd run release:check
npm.cmd run db:backup
```

`release:check` runs the RC verification path and checks that the required freeze documentation is present.

## Previous markers

- `0.1.0-rc.1` - initial closed testing release candidate, 2026-06-29.
- Functional Completion Pass 6 - completed remaining closed-MVP product flows.
- Functional Finalization Pass 7 - removed fake success states and browser-state authority.
- Closed Beta Hardening Pass 8 - verified runtime checks, visual QA, smoke suites, RC check, backup, and listener shutdown.
