# Closed Testing Handoff

Version: `0.1.0-beta.1`

Status: Closed Testing MVP, Code freeze / bugfix-only, not production-grade.

## How to run locally

```powershell
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run setup:local
npm.cmd run dev
```

Open `http://127.0.0.1:3000`.

## How to verify

Before handing a build to testers:

```powershell
npm.cmd run release:check
```

`release:check` includes `verify:rc`.

For expanded Pass 9 evidence, also run:

```powershell
npm.cmd run visual:qa
npm.cmd run visual:qa:gallery
npm.cmd run smoke:integration
npm.cmd run smoke:mvp
npm.cmd run db:backup
```

The production smoke lifecycle uses `http://127.0.0.1:3009`. Confirm that no listener remains on `3009` after checks.

## Backup

```powershell
npm.cmd run db:backup
```

Backups are written to `backups/sqlite-<timestamp>.db`. Keep known-good copies outside the application folder for real operational use.

## Beta reset

```powershell
npm.cmd run beta:reset
```

The reset creates a verified safety backup first, reseeds deterministic data, and cleans configured local uploads.

Verify the reset lifecycle safely:

```powershell
npm.cmd run beta:reset:verify
```

## Test accounts

Use [test-accounts.md](test-accounts.md). Default password: `password123`.

Real testers should register unique email addresses. Seeded accounts are for operator/demo verification.

## What to test first

1. Registration/login and first active task.
2. Dashboard, tasks, rewards, levels, leaderboard.
3. Exchange sandbox connect/verify/postback path.
4. Task report submission, upload, mentor rejection, resubmission, approval, and completion.
5. Feedback submission from `/feedback`.
6. Support dialog with attachment and staff reply.
7. Admin user, feedback, support, reports, exchange, CRM, and audit views.

## Where operators review data

- Feedback: `/admin/feedback`
- Support: `/support`
- Task reports: `/admin/task-reports`
- Audit: `/admin/audit-logs`
- Users/testers: `/admin/users`
- Exchange: `/admin/exchange`
- CRM: `/crm`

## Bug reporting

Use [bug-report-template.md](bug-report-template.md). A blocker is any issue that prevents login, seed/setup, core task progress, report upload/review, feedback submission, readiness, backup/reset, or smoke checks.

## Known limitations

See [mvp-limitations.md](mvp-limitations.md). This beta does not include real Pocket provider/bot, real email/captcha providers, PostgreSQL, S3/R2, AV scan, external monitoring, production deploy, or final commercial design.
