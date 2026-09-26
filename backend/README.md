# Trading Learning Platform MVP

Closed Testing MVP for a gamified trading education platform.

Current version: `0.1.0-beta.1`.

Status: Closed Testing MVP, Code freeze / bugfix-only, not production-grade.

Latest stage: Beta Freeze / Bugfix-only Transition Pass 9. Design is paused and new product features are paused.

## Quick Start

```powershell
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run setup:local
npm.cmd run dev
```

Open:

- http://127.0.0.1:3000
- http://127.0.0.1:3000/login

Demo accounts are listed in [docs/test-accounts.md](docs/test-accounts.md).

## Verification

Full freeze/release gate:

```powershell
npm.cmd run release:check
```

Expanded local evidence:

```powershell
npm.cmd run prisma:generate
npm.cmd run prisma:migrate
npm.cmd run prisma:seed
npm.cmd run lint
npm.cmd run build
npm.cmd run visual:qa
npm.cmd run visual:qa:gallery
npm.cmd run smoke:integration
npm.cmd run smoke:mvp
npm.cmd run verify:rc
npm.cmd run db:backup
```

After any production smoke/listener work, confirm that no process is listening on `3009`.

## Backup and beta reset

Create a SQLite backup:

```powershell
npm.cmd run db:backup
```

Reset closed beta data with a verified safety backup:

```powershell
npm.cmd run beta:reset
```

Verify the reset lifecycle on an isolated test DB/upload directory:

```powershell
npm.cmd run beta:reset:verify
```

## Freeze rules

Allowed after `0.1.0-beta.1`: bugfixes, security fixes, copy fixes, broken-flow fixes, smoke fixes, docs fixes, and seed/backup/reset fixes.

Not allowed without a new planning pass: new product features, redesign, external providers, production infrastructure migration, PostgreSQL migration, S3/R2 integration, or broad refactors.

## Docs

- [Version marker](docs/version.md)
- [MVP status](docs/mvp-status.md)
- [Release candidate / beta freeze](docs/release-candidate.md)
- [Code freeze policy](docs/code-freeze-policy.md)
- [Bugfix policy](docs/bugfix-policy.md)
- [Closed testing handoff](docs/closed-testing-handoff.md)
- [Closed beta runbook](docs/closed-beta-runbook.md)
- [Closed beta test plan](docs/closed-beta-test-plan.md)
- [Test accounts](docs/test-accounts.md)
- [QA checklist](docs/qa-checklist.md)
- [Demo script](docs/demo-script.md)
- [MVP limitations](docs/mvp-limitations.md)
- [Bug report template](docs/bug-report-template.md)
- [Regression checklist](docs/regression-checklist.md)
- [Backup and restore](docs/backup-restore.md)
- [Environment variables](docs/env.md)
- [Storage](docs/storage.md)
- [Visual QA](docs/visual-qa.md)
