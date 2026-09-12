# QA Checklist

Version `0.1.0-beta.1` is frozen for closed testing. QA should focus on existing flows and regressions, not new feature requests.

## Required commands

```powershell
npm.cmd run release:check
npm.cmd run visual:qa
npm.cmd run visual:qa:gallery
npm.cmd run db:backup
```

Confirm no listener remains on `3009`.

## Smoke coverage

- [ ] `smoke:integration` passes.
- [ ] `smoke:mvp` passes.
- [ ] `verify:rc` passes.
- [ ] Visual QA summary is clean.
- [ ] Visual QA gallery exists.
- [ ] Backup exists.

## Manual closed beta checks

- [ ] Auth and logout.
- [ ] User dashboard.
- [ ] Tasks and task completion.
- [ ] Task reports with upload/download.
- [ ] Exchange sandbox flow.
- [ ] Rewards and daily reward.
- [ ] Promocodes.
- [ ] Achievements.
- [ ] Leaderboard.
- [ ] Chat and locked channel behavior.
- [ ] Mentor chat.
- [ ] Support with attachments.
- [ ] Feedback submission.
- [ ] Admin users.
- [ ] Admin reports.
- [ ] Admin exchange.
- [ ] CRM.
- [ ] Audit.
- [ ] Beta reset and baseline restoration.
- [ ] Backup/restore dry-run.

## Bugfix-only reminder

Design changes, new product features, provider integrations, Prisma changes, and infrastructure migrations are out of scope unless a real blocker requires a narrow fix.
