# MVP Limitations

`0.1.0-beta.1` is a Closed Testing MVP. It is intentionally not production-grade and not the final commercial product.

## Not included

- Real Pocket provider; no real Pocket provider is connected in this beta.
- Real Pocket Telegram bot.
- Real email provider.
- Real captcha provider.
- PostgreSQL production database.
- S3/R2 object storage.
- Antivirus scan for uploaded files.
- CSP nonce/hash hardening.
- External monitoring, alerting, and incident automation.
- Production deploy.
- Final commercial design.

## Current local/RC assumptions

- SQLite is the MVP database.
- Local filesystem storage is the upload backend.
- Exchange integration is sandbox/manual and uses protected postback simulation/receive flows.
- Email verification and captcha behavior are beta/local abstractions, not production provider integrations.
- Notifications are in-app only.
- Rate limiting is process-local and not a distributed production control.
- Backups are local SQLite file copies; offsite retention is operator responsibility.

## What this means for testers

Testers can validate the core product journey, role access, feedback, support, reports, rewards, exchange sandbox, CRM views, and admin operations. They should not treat the build as connected to real Pocket infrastructure, real email/captcha delivery, production file storage, or a public production deployment.

## What requires a future production pass

- Production database and migration plan.
- Real provider credentials, signatures, reconciliation, and monitoring.
- Remote object storage and upload malware scanning.
- External monitoring/alerting and backup retention.
- Final browser/device/product design review.
- Deployment, rollback, and incident runbooks for a real hosting environment.
