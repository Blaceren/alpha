# SIGNAL_ENGINE.md — Alfa Trade Academy CRM (Phase 1B1)

Как вычисляются сигналы. Реализация: `src/domain/signals/engine.ts`. Пороги: `src/config/signals.config.ts` (зеркало SIGNAL_CATALOG.md, DECISIONS D-04).

## Принципы
- **Чистые функции.** `computeSignals(user, clock)` — детерминированная функция от synthetic-данных и `Clock`. Сигналы не хранятся как статические бейджи и не берутся из fixtures.
- **Нет opaque score.** Каждый сигнал — объяснимый: `code, severity, reasonCode, reason (human), evidence[], calculatedAt, expiresAt, recommendedActionCodes, suppression`.
- **Пороги — из конфига.** `SIGNAL_THRESHOLDS`; в компонентах/движке не хардкодятся.

## Каталог (23 сигнала) и триггеры

| Signal | Severity | Триггер (mock) |
|---|---|---|
| registration_no_start | medium | not_started + нет действий + ≥24ч с регистрации |
| pocket_registration_incomplete | high | registrationStatus not_registered/registration_pending + ≥24ч (не для registered) |
| email_not_confirmed | medium | identity.emailConfirmed = false + ≥12ч (независимо от Pocket registration) |
| lesson_abandoned | medium | урок 0<progress<100 + ≥24ч без активности |
| progression_stalled | medium | доступен next level + ≥72ч без действия |
| repeated_test_failure | high | testAttempts ≥ 3 |
| report_pending | medium | reportState = pending |
| report_rejected_no_return | high | reportState rejected + ≥48ч |
| mentor_sla_risk | high | sla mentor_review, elapsed ≥80% (warn) / ≥100% (breach) |
| checkpoint_approaching | medium | balance < required, delta ≤15% |
| checkpoint_grace_active | high | grace.active |
| financial_access_suspended | critical | accessSuspended (suppressesOutbound) |
| balance_data_stale | medium | balance_unknown или ageMinutes ≥60 |
| pocket_data_conflict | high | pocketConflict |
| inactive_3_days | medium | ≥72ч без действия |
| inactive_7_days | high | ≥7д |
| dormant_14_days | high | ≥14д |
| dormant_30_days | high | ≥30д |
| returned_after_absence | medium | engagement = returned |
| communication_fatigue | high | comms24h > 2 или comms7d > 5 (suppressesOutbound) |
| support_blocked | high | supportState blocked / blocker support_blocked |
| frequent_redeposit_pattern | low | redeposits ≥ 4 |
| rapid_balance_decline | high | (prev−cur)/prev ≥40% в окне |

## Suppression
Лестница неактивности схлопывается — активным остаётся самый глубокий сигнал: `dormant_30 ⊳ dormant_14 ⊳ inactive_7 ⊳ inactive_3`. Подавлённые получают `suppressedBy` и не возвращаются. `financial_access_suspended` и `communication_fatigue` несут `suppressesOutbound: true` (подавляют новые исходящие коммуникации/nudge'и в derive-слое).

## Границы (тесты)
Пороговые тесты проверяют переход ровно на границе (71ч → нет `inactive_3_days`, 73ч → есть), корректность severity, наличие evidence, а также совместное срабатывание нескольких сигналов (029: grace + conflict + rapid decline).

_Связано: RECOMMENDATION_CATALOG.md (signal→action), TODAY_QUEUE_RULES.md._
