# MVP Status

## Current state

- Version: `0.1.0-beta.1`
- Status: Closed Testing MVP
- Code mode: Code freeze / bugfix-only
- Production-grade readiness: Not production-grade
- Commercial product readiness: not final

Closed Beta Hardening Pass 8 is complete: runtime checks passed, visual QA produced `210/210` clean screenshots, `smoke:integration` passed `96/96`, `smoke:mvp` passed `59/59`, `verify:rc` passed, a SQLite backup was created, and the temporary listener was stopped.

Pass 9 freezes this state for closed beta. Design work is paused. New product features are paused. API, Prisma, and business logic should only change for real blocker/bug/security fixes.

## Objective readiness after freeze

- Functional MVP: ready for controlled closed testing.
- Technical stability: strong local/RC baseline with automated smoke, visual QA, backup, restore, and beta-reset checks.
- Closed Testing readiness: ready.
- Production-grade readiness: not ready.
- Commercial product readiness: not ready.

## Included in the Closed Testing MVP

- Auth, sessions, CSRF, role-based access, protected pages, and service-role routing.
- User dashboard, tasks, XP, rewards, levels, checkpoints, reports, and upload/download flow.
- Mentor report review flow.
- Support dialogs with attachments, staff notes, status changes, and notifications.
- Feedback form for testers and admin feedback triage.
- Admin users, reports, rewards, news, exchange, audit, CRM, promocodes, achievements, and operational summaries.
- Sandbox/manual exchange flow and idempotent postback handling.
- Pocket lifecycle postback normalization and attribution/macros visibility for admin/CRM.
- Chat, mentor chat, channels, moderation, and safe cleanup tooling.
- Local SQLite backup/restore scripts and backup-first beta reset.
- Health/readiness endpoints.
- Visual QA gallery and smoke coverage.

## Not included

See [mvp-limitations.md](mvp-limitations.md). The important non-goals are real Pocket provider/bot integration, real email/captcha providers, PostgreSQL, S3/R2, AV scanning, external monitoring, production deploy, and final commercial design.

## Required freeze verification

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

For a combined release gate, use:

```powershell
npm.cmd run release:check
```

Then create a final backup with `npm.cmd run db:backup`.
