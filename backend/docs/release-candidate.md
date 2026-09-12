# Release Candidate / Beta Freeze

`0.1.0-beta.1` is the Closed Testing MVP freeze. The project has moved from release-candidate expansion into Code freeze / bugfix-only mode.

This is not a production-grade release. It is a controlled local/RC build for closed testers and operators.

## Included

- Auth, sessions, roles, protected pages, and security middleware.
- User dashboard, learning tasks, XP, levels, rewards, daily rewards, checkpoints, achievements, and leaderboard.
- Task reports with mentor/admin review and file attachments.
- Support dialogs, support replies, internal notes, and notifications.
- Tester feedback submission and admin feedback triage.
- Admin users/tasks/rewards/news/task reports/exchange/feedback/audit/CRM panels.
- Sandbox/manual exchange connection and protected postback handling.
- Pocket postback lifecycle normalization and CRM attribution/macros.
- Chat, mentor chat, channel moderation, promocodes, and safe cleanup tooling.
- Local storage adapter, protected file download, SQLite backup/restore, and backup-first beta reset.
- Readiness endpoint, visual QA, smoke suites, and release-check scripts.

## Not included

- Real Pocket provider.
- Real Pocket Telegram bot.
- Real email provider.
- Real captcha provider.
- PostgreSQL production migration.
- S3/R2 object storage.
- Antivirus scanning.
- CSP nonce/hash hardening.
- External monitoring/alerting.
- Production deploy.
- Final commercial design.

## Freeze rule

Allowed after this point: bugfixes, security fixes, copy fixes, broken-flow fixes, smoke fixes, docs fixes, and seed/backup/reset fixes.

Not allowed after this point: new product features, redesign, external provider integration, production infra migration, PostgreSQL migration, S3/R2 integration, or large refactors without a concrete bug.

## Verification

Full release gate:

```powershell
npm.cmd run release:check
```

Manual expanded gate:

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

After any temporary listener or smoke run, confirm that no process is listening on `3009`.

## Reset and rollback

Reset deterministic local beta data:

```powershell
npm.cmd run beta:reset
```

Verify reset lifecycle on an isolated test DB/upload directory:

```powershell
npm.cmd run beta:reset:verify
```

Create a SQLite backup:

```powershell
npm.cmd run db:backup
```

Restore with a dry-run first:

```powershell
npm.cmd run db:restore -- sqlite-<timestamp>.db --dry-run
npm.cmd run db:restore -- sqlite-<timestamp>.db
```
