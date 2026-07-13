# MOCK_DATA_IMPLEMENTATION.md — Alfa Trade Academy CRM (Phase 1B1)

Как устроен детерминированный синтетический mock-домен. Всё synthetic, без production-данных.

## Слои

```
personas.ts (raw offsets)  ──►  build.ts (+ Clock)  ──►  MockUser[]  ──►  derivation
persona-types.ts (RawPersona)        │                        │            (signals / priority /
validate.ts (Zod + rules) ◄──────────┘                        │             recommendations / today)
                                                              ▼
                                             MockCrmDataProvider (read ops)
```

- **Детерминизм.** `personas.ts` хранит только относительные смещения (`registeredDaysAgo`, `lastActionHoursAgo`, `balanceAgeMinutes`, `grace.endsInHours`, …). `build.ts` разрешает их в абсолютные ISO-строки через `Clock`. Итоговые относительные строки в fixtures не записываются (§2). Один и тот же clock → идентичный датасет (тест это проверяет).
- **FixedMockClock.** Единая опорная точка `MOCK_NOW = 2026-07-13T09:00:00Z` (`src/lib/clock.ts`). `SystemClock` — для будущего runtime. Все derivation-функции и тесты используют инъекцию clock.
- **Финансовая согласованность.** `netDepositsUsd = FTD + Σ redeposits − Σ successful withdrawals` вычисляется в билдере и проверяется валидатором. Balance не обязан равняться net deposits.

## Валидация (`validate.ts`)

`validateDataset(users)` возвращает список проблем; `assertValidDataset` бросает. Проверяется: ровно 30 пользователей; уникальные id и synthetic-email; email только `@example.test`; trader id только `pp_mock_*`; `highestCompletedLevel ≤ currentLevel`; уровень 1–100 или `future_checkpoint_not_defined` при >100; финансовая формула; freshness-consistency (баланс без timestamp только при `balance_unknown`); checkpoint-consistency (grace/suspended согласованы); один primary owner; покрытие всех обязательных persona-сценариев. Невалидный fixture падает в тестах, а не отображается молча.

## 30 personas

`usr_mock_001..030`, у каждого свой основной сценарий. Ниже — coverage matrix (сгенерирована из движка при `FixedMockClock`).

Легенда: dims = Lifecycle / Funding / Engagement. Сигналы — активные (после suppression). Queues — членство в очередях Today.

| ID | Сценарий | Приоритет | Dims | Ключевые сигналы | Top-рекомендация | Queues | Owner | SLA |
|----|----------|-----------|------|------------------|------------------|--------|-------|-----|
| 001 | new registered / no start | normal | registered/not_available/not_started | registration_no_start, pocket_registration_incomplete | help_complete_pocket_registration | onboarding_attention | — | — |
| 002 | pocket registration incomplete | normal | registered/not_available/not_started | pocket_registration_incomplete | help_complete_pocket_registration | onboarding_attention | ret1 | — |
| 003 | email not confirmed | normal | pocket_registered/unfunded/active | email_not_confirmed | remind_email_confirmation | onboarding_attention | — | — |
| 004 | pre-FTD | low | pre_ftd/unfunded/active | — | no_action_required | — | ret1 | — |
| 005 | active learner | low | active/funded/active | — | no_action_required | — | ret2 | — |
| 006 | lesson abandoned | normal | active/funded/active | lesson_abandoned | continue_current_lesson | learning_stalled | ret2 | — |
| 007 | 3 failed tests | normal | active/funded/active | repeated_test_failure | review_failed_test | learning_stalled | men1 | — |
| 008 | report pending | high | active/funded/active | report_pending, mentor_sla_risk | mentor_follow_up | due_today, mentor_review | men1 | mentor_review |
| 009 | report rejected no return | high | at_risk/funded/progression_stalled | report_rejected_no_return, progression_stalled | mentor_follow_up | mentor_review, learning_stalled | men1 | — |
| 010 | mentor SLA warning | high | active/funded/active | mentor_sla_risk (warn) | mentor_follow_up | due_today, mentor_review | men1 | mentor_review |
| 011 | mentor SLA breached | high | at_risk/funded/active | mentor_sla_risk (breach) | mentor_follow_up | sla_breached, mentor_review | men1 | mentor_review |
| 012 | checkpoint approaching | normal | active/funded/active | checkpoint_approaching | review_checkpoint_grace | checkpoint_attention, repeat_funders | ret1 | — |
| 013 | checkpoint grace | high | at_risk/checkpoint_grace/active | checkpoint_grace_active | review_checkpoint_grace | checkpoint_attention | ret1 | — |
| 014 | financial access suspended | critical | at_risk/financial_access_suspended/active | financial_access_suspended | restore_learning_path | critical_attention, checkpoint_attention | ret1 | — |
| 015 | financial access restored | normal | active/funded/active | checkpoint_approaching | review_checkpoint_grace | checkpoint_attention, repeat_funders | ret1 | — |
| 016 | first depositor (FTD today) | low | first_depositor/funded/active | — | no_action_required | new_funded_users | ret2 | — |
| 017 | repeat funder | low | active/funded/active | — | no_action_required | repeat_funders | ret2 | — |
| 018 | frequent repeat funder + high value | normal | active/funded/active | frequent_redeposit_pattern | open_pause_protocol | repeat_funders | mgr | — |
| 019 | high-value candidate / advanced | low | active/funded/active | — | no_action_required | repeat_funders | mgr | — |
| 020 | progression stalled | normal | at_risk/funded/progression_stalled | progression_stalled | restore_learning_path | learning_stalled | ret2 | — |
| 021 | inactive 3d (+ stale balance) | normal | at_risk/funded/inactive_3d | inactive_3_days, balance_data_stale | restore_learning_path | learning_stalled, data_quality_issues | ret2 | — |
| 022 | inactive 7d | normal | at_risk/funded/inactive_7d | inactive_7_days | restore_learning_path | learning_stalled, data_quality_issues | ret2 | — |
| 023 | dormant 14d (balance stale) | normal | dormant/balance_unknown/dormant_14d | dormant_14_days, balance_data_stale | restore_learning_path | learning_stalled, data_quality_issues | — | — |
| 024 | dormant 30d (no timestamp) | normal | dormant/balance_unknown/dormant_30d | dormant_30_days, balance_data_stale | restore_learning_path | learning_stalled, data_quality_issues | — | — |
| 025 | returned after absence | normal | reactivated/funded/returned | returned_after_absence | review_checkpoint_grace | returned_users, checkpoint_attention | ret1 | — |
| 026 | support blocked | critical | at_risk/funded/active | support_blocked | support_follow_up | critical_attention, sla_breached, support_blockers | sup1 | support_high |
| 027 | communication fatigue | normal | active/funded/active | communication_fatigue | reduce_communication_frequency | communication_suppression, repeat_funders | ret2 | — |
| 028 | completed curriculum (post-L100) | low | completed_current_curriculum/funded/active | — | no_action_required | repeat_funders | mgr | — |
| 029 | pocket conflict + rapid decline | high | at_risk/checkpoint_grace/active | pocket_data_conflict, rapid_balance_decline, checkpoint_grace_active | review_checkpoint_grace | sla_breached, checkpoint_attention, data_quality_issues | ret1 | financial_data_conflict |
| 030 | withdrawal requested, no completion | low | active/funded/active | — | no_action_required | repeat_funders | ret2 | — |

owner: ret1/ret2 = retention, men1 = mentor, sup1 = support, mgr = manager, — = unassigned.

### Edge cases покрыты
Отсутствующий balance timestamp (024), stale balance (021–024), `balance_unknown` (023–024), post-L100 `future_checkpoint_not_defined` (028), несколько параллельных blockers (011), несколько value segments (018, 019, 028), пользователь без owner (001, 023, 024), длинное имя и длинный campaign (018), нулевой баланс/депозиты (004), withdrawal request без successful withdrawal (030), два одинаковых redeposit как две легитимные операции (018).

## Persistence
Данные — immutable in-memory fixtures за провайдером. localStorage mutation overlay (DECISIONS D-09) в Phase 1B1 **не реализован** (следующий этап). Никакой базы/Prisma.

_Связано: STATE_MODEL.md, SIGNAL_ENGINE.md, RECOMMENDATION_CATALOG.md, TODAY_QUEUE_RULES.md._
