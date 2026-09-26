# Regression Checklist

Use this checklist for bugfix-only changes during `0.1.0-beta.1`.

## Core

- [ ] Auth
- [ ] Dashboard
- [ ] Tasks
- [ ] Reports
- [ ] Exchange
- [ ] Rewards
- [ ] Daily
- [ ] Promocodes
- [ ] Achievements
- [ ] Leaderboard

## Communication

- [ ] Chat
- [ ] Mentor chat
- [ ] Support
- [ ] Feedback

## Admin / staff

- [ ] Admin users
- [ ] Admin reports
- [ ] Admin exchange
- [ ] CRM
- [ ] Audit

## Data and files

- [ ] Uploads
- [ ] Beta reset
- [ ] Backup/restore

## Verification commands

Run the smallest relevant check for the bug. Before handing a freeze build back to testers, run:

```powershell
npm.cmd run release:check
npm.cmd run db:backup
```

If visual or layout behavior changed because of a bugfix, also run:

```powershell
npm.cmd run visual:qa
npm.cmd run visual:qa:gallery
```

Confirm no listener remains on `3009`.
