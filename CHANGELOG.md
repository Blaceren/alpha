# Changelog

## 0.1.0-beta.1 - 2026-07-01

Beta Freeze / Bugfix-only Transition Pass 9.

- Froze the project as a Closed Testing MVP after Pass 8 runtime verification.
- Moved the codebase into Code freeze / bugfix-only mode.
- Updated version markers, MVP status, release-candidate notes, closed testing handoff, runbook, limitations, QA docs, and README.
- Added code-freeze and bugfix policies.
- Added bug report template and regression checklist for closed beta triage.
- Extended `release:check` with a release-docs gate.
- No design changes.
- No business logic, API, or Prisma schema changes.
- Real Pocket provider/bot, real email/captcha providers, S3/R2, PostgreSQL, production deploy, and final commercial design remain out of scope.

## 0.1.0-rc.1 - 2026-06-29

Closed Testing MVP release candidate.

### Closed Beta Hardening Pass 8 - 2026-07-01

- Added usable new-tester onboarding and compact admin tester/queue visibility.
- Added backup-first beta reset, SQLite backup verification and restore dry-run/path guards.
- Protected design-lab and postback simulation as admin-only tools.
- Made captcha/email beta behavior explicit and removed user-facing dev verification tokens.
- Added closed-beta runbook, test plan and smoke coverage for onboarding, visibility and technical-route isolation.

### Functional Finalization Pass 7 - 2026-07-01

- Removed stale localStorage task/checkpoint authority and fake API-success fallbacks.
- Wired dashboard rank, streak and leaderboard to DB-backed APIs and completed route CTAs.
- Removed the fake CRM mailing action and replaced the task-4 placeholder with the existing-account route.
- Tightened service-role routing, leaderboard current-user identity, closed support behavior, resend-verification protection, achievement fallback and reward status consistency.
- Added regression smoke for service-role dashboard denial, current-user leaderboard marking and closed support dialogs.
- Design and Prisma schema were not changed; external providers and production infrastructure remain out of scope.

### Functional Completion Pass 6

- Completed Pocket lifecycle postback normalization, macro visibility, rejected-event audit, registration-task completion, and commission/withdrawal summaries.
- Replaced the CRM mock-only list with real user, exchange, checkpoint, attribution, referral, and postback data plus operational filters and lead detail.
- Completed service-account creation, user blocking, mentor assignment, runtime double-sided referrals, and period-based XP leaderboard data.
- Completed channel selection and access checks, mentor staff dialogs, moderation rule/mute/hide actions, assignments, and dry-run retention cleanup.
- Added admin CRUD for promocodes and achievements, user redeem/display/select flows, usage history, grants, revocation, audit, and notifications.
- Expanded role, registration, CRM, referral, chat, moderation, reward, leaderboard, promocode, achievement, news editor, and internal-page smoke coverage.
- Real Pocket Telegram bot, real email/captcha provider, S3/R2, antivirus scanning, external notification delivery, and production cron remain intentionally out of scope.

### Design Pass 5 - premium UI polish

- Strengthened the public landing hierarchy, product preview, CTAs, feature cards, and learning-path presentation.
- Refined dashboard progress, XP, task, reward, checkpoint, exchange, referral, and notification surfaces.
- Improved visual states across tasks, levels, rewards, daily streak, leaderboard, community chat, mentor chat, and exchange guidance.
- Improved shared cards, tables, forms, badges, buttons, loading/empty/error states, navigation, cookie banner, and support widget.
- Increased admin/staff readability through shared admin primitives and a token-based compatibility layer for existing pages.
- Kept product behavior, permissions, API contracts, Prisma schema, and business logic unchanged.
- This pass uses automated screenshot QA without manual subjective PNG review; a manual gallery review is still recommended before public launch.

### Combined after-RC functional + Design Pass 1

- Added light/dark theme tokens, theme toggle, and a shared visual shell inspired by trading-learning SaaS references.
- Updated public landing with hero, dashboard preview, feature row, path block, and product CTAs.
- Updated login/register UI while keeping captcha abstraction, password visibility, and auth flow intact.
- Updated dashboard presentation with premium cards, XP progress, rewards, referrals, checkpoint/exchange/notification sections.
- Added shared UI primitives for cards, badges, status pills, progress, states, form fields, tables, tabs, pagination, and filters.
- Kept backend contracts, smoke flows, Pocket sandbox/manual exchange, and existing RC logic intact.
- Real Pocket Telegram bot, real email/captcha provider, S3/R2, and final art polish are still not included.

Included:

- Auth and role-based access for user, admin, support, and mentor flows.
- Dashboard, tasks, levels, and rewards skeleton connected to backend APIs.
- Task reports and mentor review flow.
- Support chat and support panel skeleton.
- Internal notifications with read/unread state.
- Protected uploads and attachments with storage adapter abstraction.
- Exchange sandbox/manual postback simulation and protected receive endpoint.
- Admin panels for CRM, open questions, audit logs, feedback, and reports.
- Feedback loop for closed testing.
- Audit, security headers, CSRF, validation, rate limit, and readiness checks.
- CI, smoke tests, RC verification scripts, and deployment/readiness docs.
- RC documentation pack.

Not included:

- Real exchange provider integration.
- PostgreSQL production database.
- S3/R2 object storage.
- Antivirus scan for uploaded files.
- External email, web-push, or Telegram notification delivery.
- Final visual design.
- Production deploy.
