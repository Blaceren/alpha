# Functional Completion Pass 6

Дата: 2026-06-30

Статус: closed-testing MVP functional gap pass.

## Цель

Проверить обсуждённые функциональные gaps после RC и закрыть только безопасные недостающие части без подключения реальных внешних сервисов и без изменения продуктовой логики.

## Закрыто в проекте

- Pocket sandbox/postback lifecycle: normalize macros, store attribution, handle duplicates, audit rejected/unmatched events.
- Pocket registration task: registration check endpoint, existing-account help flow, task step integration.
- Balance/checkpoint provider: sandbox/manual provider boundary, daily sync script, frozen/restored checkpoint logic.
- CRM: user list reads real database users, filters by cohort/status/level/checkpoint/Pocket attribution/macros/events.
- Roles/service accounts: `admin`, `support`, `mentor`, `moderator`, `news_editor`; admin can create/block service accounts.
- Referrals: referral code/link, inviter and invited bonuses, double-award protection.
- Mentor chat: separate mentor dialog flow, locked/unlocked state, staff access.
- Community chat: channels, locked visible channels, mentor/moderator assignments, basic retention cleanup.
- Chat moderation: stop words, link blocking, mutes, hide message, moderation logs.
- Daily reward: daily streak endpoint/page and notification/audit integration.
- Leaderboard: periods, blocked/service exclusion, user display.
- Promocodes: admin CRUD and user redemption flow.
- Achievements: catalog, admin grant/revoke, user visibility and selected display.
- News editor flow: `news_editor` role can manage drafts/publishing without full admin access.
- Open questions/internal visibility: admin-only board with persisted status updates.
- Admin navigation: central admin hub and role-scoped navigation.
- Smoke coverage: integration smoke, MVP smoke, visual QA, RC verify, cleanup checks.

## Intentionally out of scope

- Real Pocket Telegram bot.
- Real exchange provider credentials/signature reconciliation.
- Real email provider, real captcha provider, external notification delivery.
- PostgreSQL migration and managed production DB.
- S3/R2 object storage and antivirus scanning.
- Production scheduler/worker infrastructure for cleanup/sync jobs.
- Final commercial design and public production deploy.

## Verification gates

Functional pass is accepted only when these commands pass:

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
```

If all gates are green, create a SQLite backup:

```powershell
npm.cmd run db:backup
```
