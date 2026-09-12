# TODAY_QUEUE_RULES.md — Alfa Trade Academy CRM (Phase 1B1, переосмыслено в 1B3)

Правила вывода очередей Today. Реализация: `src/domain/today/builder.ts` (чистые функции, без React).

> **Статус после Phase 1B3.** Всё ниже действует, но 13 «очередей» теперь называются
> **основаниями** (`TodayBasisCode`) и отвечают на вопрос «почему пользователь в очереди».
> «Насколько срочно» стало отдельной осью из 4 секций с canonical placement — пользователь
> попадает ровно в одну. Предикаты членства не изменились. Изменилось два правила:
> ценностные сегменты (`new_funded_users`, `repeat_funders`) **не дают** места в очереди (D-43),
> а финансы показываются только там, где помогают триажу (D-49).
> Экран и его правила: **`docs/TODAY_WORKSPACE.md`**. Решения: D-43…D-51.

## Priority model (`src/domain/priority/priority.ts`)
Приоритет — одна из полос `critical / high / normal / low`, определяется **явными упорядоченными правилами** (без opaque score). Первое совпавшее правило выигрывает; каждый результат несёт `reasonCode` и `evidence`:

1. critical — critical support issue (`support_blocked`)
2. critical — financial access suspended
3. high — financial data conflict (`pocket_data_conflict`)
4. high — SLA breach (mentor_review due passed)
5. high — checkpoint grace near expiration (≤8ч)
6. high — report/mentor blocker
7. high — rapid balance decline
8. normal — returned user
9. normal — progression stalled / long inactivity
10. normal — ordinary follow-up · иначе low

**Tie-break** (`comparePriority`, детерминированно): полоса → индекс правила → SLA dueAt (раньше выше) → severity сигнала → last meaningful action (старее выше) → stable user id.

## 13 очередей
Единый typed источник — `src/config/queues.ts` (`TodayQueueCode`, `QUEUE_TITLE`, `QUEUE_PRIORITY`, `TODAY_QUEUE_ORDER`). Канонический код — `critical_attention` (никогда `critical`).

`critical_attention, onboarding_attention, sla_breached, due_today, mentor_review, support_blockers, checkpoint_attention, learning_stalled, returned_users, new_funded_users, repeat_funders, communication_suppression, data_quality_issues`.

Членство (кратко): critical_attention = priority critical; **onboarding_attention = registration_no_start / pocket_registration_incomplete / email_not_confirmed**; sla_breached = SLA просрочен; due_today = due в пределах 24ч; mentor_review = report_pending/mentor_sla_risk/rejected или mentorState≠none; support_blockers = support_blocked; checkpoint_attention = grace/approaching/suspended; learning_stalled = stalled/lesson_abandoned/test_failure/inactive_7/dormant; returned_users = returned; new_funded_users = first_depositor или FTD ≤24ч; repeat_funders = value repeat/frequent; communication_suppression = communication_fatigue; data_quality_issues = pocket_data_conflict/balance_data_stale.

**onboarding_attention** отвечает на «кто требует внимания сегодня» для новых пользователей (001/002/003). Приоритет очереди — normal, но глобальный более высокий priority пользователя сохраняется (напр. одновременный support/SLA/conflict). Финансовые значения в этой очереди **не показываются** (`financial.mode = hidden`, `QUEUES_WITHOUT_FINANCIALS`). Каждый элемент несёт identity projection.

## Queue item
Каждый элемент: `userId, displayName, queueCode, priority, reason, reasonCode, evidence, ownerId, dueAt, recommendedAction (top), signalCodes, freshness {asOf, isStale}, financial (permission-aware projection), identity (permission-aware projection)`.

## Дедупликация → canonical placement (изменено в 1B3)
Пользователь по-прежнему может держать **несколько оснований** (напр. 026 — support_blockers +
critical_attention + sla_breached + checkpoint_attention). Но на экране он появляется **ровно один
раз**: `placeIn()` — единственное место, где решается секция, первое совпадение выигрывает
(`overdue → critical_now → today → watch`). Прежний `distinctUserCount` больше не нужен: дубликата,
который он считал, не существует. Тест: «puts each user in exactly ONE section».

## Permission projection
Финансовое представление строится через `projectFinancial(role, …)`: retention/manager/admin →
exact; analyst → aggregated; mentor/support/moderator/content → bucket; иначе hidden. UI не решает
сам, что показывать.

**Уточнено в 1B3:** баланс проецируется только для оснований, где он помогает триажу
(`TODAY_BASES_WITH_FINANCIALS`: checkpoint, качество данных) — иначе `financial: null`, и строка не
показывает баланс вообще (D-49). Балансо-производные пояснения (`checkpoint_approaching`,
`rapid_balance_decline`) заменяются нейтральным текстом для ролей без exact-прав — общее с User 360
правило в `domain/financial/financially-derived.ts` (D-46).

_Связано: SIGNAL_ENGINE.md, RECOMMENDATION_CATALOG.md, DATA_PROVIDER_CONTRACT.md._
