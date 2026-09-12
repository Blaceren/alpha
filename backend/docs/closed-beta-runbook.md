# Closed Beta Runbook

Version `0.1.0-beta.1` is a Closed Testing MVP in Code freeze / bugfix-only mode. It is not production-grade.

## Start locally

```powershell
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run setup:local
npm.cmd run dev
```

Open `http://127.0.0.1:3000`.

Closed beta uses local/dev provider behavior from `.env.example`: no real email provider, no real captcha provider, no real Pocket provider, local SQLite, and local uploads.

## Verify before a tester session

```powershell
npm.cmd run release:check
```

For a visual handoff, also run:

```powershell
npm.cmd run visual:qa
npm.cmd run visual:qa:gallery
```

Open `visual-qa/index.html` if manual screenshot review is needed.

## Daily operator checks

- New testers: `/admin/users`; open a user to review active step, XP, reports, exchange, feedback, support, and last activity.
- Feedback: `/admin/feedback`.
- Support: `/support`.
- Task reports: `/admin/task-reports`.
- Audit: `/admin/audit-logs`.
- Exchange operations: `/admin/exchange`.
- CRM and attribution: `/crm`.
- Readiness: `/api/health` and `/api/readiness`.

## Live test account maintenance

Production/live closed-beta test accounts must be managed with the safe upsert script, not with seed/reset commands.

Dedicated live accounts:

| Role | Email |
| --- | --- |
| Admin | `admin@test.com` |
| User | `user@test.com` |
| Support | `support@test.com` |
| Mentor | `mentor@test.com` |
| Moderator | `moderator@test.com` |
| News editor | `news@test.com` |

Do not write the live password into docs, git, chat reports, or shell history. Use the operator secure note on the live server:

```text
/home/ubuntu/trading-mvp/.secure/live-test-account-password.txt
```

Safe rotation/upsert pattern:

```bash
export TEST_ACCOUNT_PASSWORD='<ask project owner for live test password>'
node scripts/live/upsertLiveTestAccounts.cjs
```

After rotating/upserting, verify all roles with:

```bash
export TEST_ACCOUNT_PASSWORD='<ask project owner for live test password>'
BASE_URL='http://127.0.0.1:3000' node scripts/live/checkLiveTestLogins.cjs
```

The live login check validates `POST /api/auth/login`, session cookie creation, role-specific route access, and the user dashboard navigation shape. It must not print passwords, password hashes, or session cookies.

Never run `setup:local`, `prisma:seed`, `beta:reset`, `smoke:ci`, `smoke:mvp`, or any other destructive seed/reset workflow against the production DB. If a full smoke is required, run it only against an isolated local/CI DB.

## Backup

Create a verified SQLite backup:

```powershell
npm.cmd run db:backup
```

Verify a backup file:

```powershell
npm.cmd run db:backup:verify -- backups\sqlite-<timestamp>.db
```

Keep several known-good dated copies outside the active application directory. Local scripts do not provide offsite retention.

## Reset closed beta data

```powershell
npm.cmd run beta:reset
```

The command validates SQLite, creates a verified `pre-beta-reset-*` backup, runs the deterministic seed, and cleans the configured upload directory.

Verify the reset lifecycle on an isolated DB/upload directory:

```powershell
npm.cmd run beta:reset:verify
```

## Restore / rollback

Preview first:

```powershell
npm.cmd run db:restore -- backups\sqlite-<timestamp>.db --dry-run
```

Then restore:

```powershell
npm.cmd run db:restore -- backups\sqlite-<timestamp>.db
```

Restore creates a `pre-restore-*` safety backup before overwriting the active DB. After restore, run `npm.cmd run release:check`.

## Incident sequence

1. Stop any temporary listener.
2. Confirm no process is listening on `3009`.
3. Create a backup if the DB is readable.
4. Record the issue with [bug-report-template.md](bug-report-template.md).
5. Restore the last known-good DB or run `beta:reset` only when test data may be discarded.
6. Run `release:check` and create a new backup before reopening the beta.

## Bugfix-only workflow

During freeze, only fix real bugs, security issues, copy issues, broken flows, smoke/verification issues, and seed/backup/reset issues. Do not add product features, redesign, external providers, PostgreSQL, S3/R2, or production deploy work.

See [code-freeze-policy.md](code-freeze-policy.md) and [bugfix-policy.md](bugfix-policy.md).
