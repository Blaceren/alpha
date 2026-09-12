# Closed Beta Hardening Pass 8

Дата: 2026-07-01

Фокус: безопасная эксплуатация закрытого теста без редизайна и подключения production-провайдеров.

## Audit

### Ready

- Registration/login, blocked-account handling, role routing and deterministic test accounts.
- Feedback, support, task reports, exchange sandbox, notifications, protected uploads and audit logs.
- RC verification, seed cleanup, SQLite backup/restore and production readiness endpoint.

### Risks found and closed

- Новый tester не получал task progress/checkpoint/mentor-dialog: registration теперь создаёт стартовое состояние с активным шагом 1.
- Admin user detail не показывал operational состояние тестера: добавлен компактный beta summary.
- Не было отдельного безопасного beta reset: добавлен backup-first `beta:reset` с production guardrails.
- Backup не проверялся, restore принимал небезопасный relative path: добавлены SQLite verification, restore dry-run и path checks.
- `/design-lab` был публичным: теперь admin-only и отсутствует в user navigation.
- Postback simulation был доступен обычному пользователю в development: endpoint теперь admin-only всегда.
- Captcha dev token работал даже при выключенном bypass: `CAPTCHA_DEV_BYPASS=false` теперь действительно запрещает dev bypass.
- Registration всегда заявлял обязательную email verification и показывал dev token: ответ и UI теперь отражают реальный env mode без user-facing token.
- Admin feedback не имел быстрых unresolved/critical срезов и dashboard summary: добавлены фильтры и реальные queue counts.
- Выбор display achievement не попадал в audit: добавлен `ACHIEVEMENT_DISPLAY_SELECTED`.

### Intentionally out of scope

- Real captcha/email provider, Pocket bot, exchange provider, external notifications.
- PostgreSQL, S3/R2, antivirus, production scheduler and automated remote backups.
- CSP nonce/hash rewrite, production deploy, monitoring/alerting and final commercial design.

## Prisma impact

Prisma models, enums, fields and migrations не менялись.

