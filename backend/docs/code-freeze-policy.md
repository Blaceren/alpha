# Code Freeze Policy

Version `0.1.0-beta.1` freezes the project as a Closed Testing MVP.

The codebase is now in bugfix-only mode. This means the current product scope is preserved for closed beta testers while the team records and fixes real issues found by testers, smoke checks, or operator review.

## Allowed during freeze

- Bugfixes for broken or inconsistent flows.
- Security fixes.
- Copy and documentation fixes.
- Smoke-test fixes.
- Seed, backup, restore, or beta-reset fixes.
- Small diagnostics that make an existing issue safer to reproduce or verify.

## Not allowed during freeze

- New product features.
- Design redesign or new visual direction.
- New Prisma models or migrations unless a blocker cannot be fixed safely without them.
- External provider integration.
- Real Pocket provider or real Pocket Telegram bot connection.
- Real email/captcha provider connection.
- S3/R2 storage integration.
- PostgreSQL migration.
- Production deploy or production infrastructure migration.
- Broad refactors unrelated to a specific bug.

## Review rule

Every code change during freeze should name the bug or safety issue it fixes and list the verification that proves it. If a change cannot be tied to a real bug, it should wait for a post-beta planning pass.
