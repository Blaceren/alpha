# Alfa Trade Academy (ATA) — V2 Product Decisions

**Статус:** зафиксированные продуктовые решения перед Curriculum V2
**Дата:** 2026-07-12
**Связанный документ:** `V2_GAP_ANALYSIS.md`

---

## 1. Product name

- Официальное название продукта: **Alfa Trade Academy**.
- Сокращение: **ATA**.
- `trading-mvp` и `TradeQuest` — legacy-технические названия.
- Массовое переименование существующего кода, таблиц, task codes и routes запрещено.

## 2. Compatibility

- Curriculum V1 остаётся активным.
- Curriculum V2 создаётся параллельно как отдельная версионируемая модель.
- Existing task codes (`lvl_01_*` … `lvl_16_*`) не переименовываются.
- `Task` и `UserTaskProgress` не ломаются и не мигрируются деструктивно.
- Новые уровни получают codes формата `v2.l001.*`.
- Published Curriculum Version не редактируется задним числом; правки — через новую версию.

## 3. XP

- Базовый XP начисляется за completion обязательных уровней — это основа маршрута.
- XP не списывается.
- XP не начисляется за real/demo trades.
- XP не начисляется за deposit или потерю balance.
- Promocode XP может участвовать в достижении XP-порога (XP-gate).
- Promocode XP не обходит последовательность уровней и не обходит checkpoint.
- Daily login XP в V2 отключён: простой вход не является meaningful action.
- Referral XP в V1 пока сохраняется без изменений.
- Referral bonus в V2 — отдельный конфигурируемый источник, **выключенный по умолчанию** до anti-abuse правил.
- Legacy V1 XP history не удаляется и не переписывается; корректировки — только отдельными `migration_adjustment`-транзакциями, видимыми в audit.

## 4. Pocket Commission

- Endpoint может принимать событие `Commission` для совместимости.
- Событие не изменяет balance, XP, progression или CRM state.
- Событие не используется для персональных product actions.
- Secret не сохраняется, не логируется, не попадает в CRM.
- Партнёрская выручка может сверяться отдельно по агрегированным отчётам Pocket, вне Product OS.

## 5. Withdrawal semantics

- `New Withdrawal` = заявка на вывод. Не меняет финансовое состояние.
- `Canceled Withdrawal` = отмена заявки. Не меняет финансовое состояние и не считается депозитом.
- `Successful Withdrawal` = подтверждённый вывод. Только он участвует в финансовом учёте (уменьшает Net Deposits).
- Plain `Withdrawal` (статусное событие) не участвует в финансовых формулах до отдельного решения.
- Request/cancel не должны перезаписывать balance (текущее поведение — баг, исправляется в Pre-Phase 0B).
- Balance в идеале приходит от отдельного provider, а не вычисляется из заявок.

## 6. Balance

- Financial checkpoint проверяет **real account balance**, а не cumulative deposits.
- Demo balance игнорируется.
- Валюты приводятся к USD equivalent (правило конверсии — запросить).
- Реальный balance provider пока отсутствует (`real_placeholder` не реализован).
- Имитировать production-проверку баланса запрещено.
- `provider unavailable` должен быть отдельным явным состоянием (verification_unavailable), а не «замером ниже порога».

## 7. Promocode concurrency

- Нельзя добавлять unique `(promocodeId, userId)`, не проверив `perUserLimit`: такой констрейнт навсегда ограничит промокоды одним использованием и сломает лимиты > 1.
- Требуется отдельное атомарное решение: idempotency каждого запроса, атомарное соблюдение `perUserLimit`, защита от параллельных redemption, поддержка лимитов больше одного.
- Promocode race не исправляется «первой попавшейся уникальностью»; дизайн — отдельной задачей.

---

*Документ не содержит secrets, паролей, реальных пользовательских данных и значений postback secret.*
