# Demo Script

Version: `0.1.0-beta.1`

This demo presents the Closed Testing MVP. Say clearly that the build is in Code freeze / bugfix-only mode and is not production-grade.

## Setup

```powershell
npm.cmd run release:check
npm.cmd run db:backup
npm.cmd run dev
```

Open `http://127.0.0.1:3000`.

## User demo

1. Open landing/login.
2. Login as `user@test.com` / `password123`.
3. Show dashboard baseline: XP `420`, active step `4`, unread notifications `0`.
4. Open tasks, levels, rewards, daily reward, achievements, and leaderboard.
5. Show exchange sandbox status and explain that real Pocket provider/bot is not connected.
6. Show report-required task flow at a high level.
7. Submit feedback through `/feedback`.
8. Open support and show a user dialog.

## Staff/admin demo

1. Login as `admin@test.com`.
2. Open `/admin/users` and a user detail page.
3. Open `/admin/feedback` and show feedback triage.
4. Open `/admin/task-reports`.
5. Open `/admin/exchange`.
6. Open `/crm`.
7. Open `/admin/audit-logs`.

## Support/mentor demo

- Support: `support@test.com` opens `/support`, replies, uses internal notes, and closes a dialog.
- Mentor: `mentor@test.com` reviews task reports and uses mentor chat.

## Operator safety

Show:

```powershell
npm.cmd run db:backup
npm.cmd run beta:reset:verify
```

Explain that `beta:reset` creates a safety backup and returns the local beta to deterministic seed data.

## Explicit limitations

Do not imply these are live:

- Real Pocket provider.
- Real Pocket Telegram bot.
- Real email/captcha providers.
- PostgreSQL.
- S3/R2.
- AV scan.
- External monitoring.
- Production deploy.
- Final commercial design.
