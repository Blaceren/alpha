# Closed Beta Test Plan

Version: `0.1.0-beta.1`

Status: Closed Testing MVP, bugfix-only, not production-grade.

## Before testing

```powershell
npm.cmd run release:check
npm.cmd run db:backup
```

Optional visual evidence:

```powershell
npm.cmd run visual:qa
npm.cmd run visual:qa:gallery
```

## First flows to test

1. Register a new tester and confirm active task step 1.
2. Login/logout and session status.
3. Dashboard, task list, levels, rewards, daily reward, achievements, and leaderboard.
4. Exchange sandbox connect and verify.
5. Pocket registration postback path through the sandbox/manual flow.
6. Task report upload, submit, reject, resubmit, approve, and complete.
7. Feedback submission at `/feedback`.
8. Support dialog with attachment and staff reply.
9. Admin user detail and operational summary.
10. Admin feedback, support, task reports, exchange, CRM, and audit review.

## Role coverage

- User: learning, reports, rewards, feedback, support.
- Admin: users, reports, exchange, feedback, CRM, audit.
- Support: support queue only.
- Mentor: task report review and mentor chat.
- Moderator: chat moderation.
- News editor: news management.

## What not to test as production behavior

- Real Pocket provider or bot.
- Real email delivery.
- Real captcha provider.
- PostgreSQL.
- S3/R2.
- Antivirus scanning.
- External monitoring.
- Production deployment.
- Final commercial design.

## Bug intake

Use [bug-report-template.md](bug-report-template.md). Mark severity as blocker, major, minor, or polish. Link the related `/admin/feedback` item if the tester submitted it in-app.
