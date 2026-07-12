# Alfa Trade Academy (ATA) — V2 Gap Analysis

**Статус:** утверждённый read-only Gap Analysis (Pre-Phase 0 / Phase 0)
**Дата аудита:** 2026-07-12
**Источник требований:** `TradeQuest_Product_OS_Curriculum_V2_Backend_Spec.md` (v0.9)
**Официальное название продукта:** Alfa Trade Academy (ATA). `trading-mvp` и `TradeQuest` — legacy-технические названия; массовое переименование кода, таблиц и task codes запрещено.

Аудит выполнен в режиме read-only. Код, данные, runtime и инфраструктура live-проекта не изменялись.

---

## 1. Текущая V1-архитектура

- **Стек:** Next.js 15 (App Router) + Prisma 6 + SQLite, версия `0.1.0-beta.1`, Closed Testing MVP, режим code freeze / bugfix-only.
- **Curriculum V1:** плоский маршрут из 16 задач (`Task.stepNumber` 1–16, уровень = шаг). Stable codes: `lvl_01_pocket_registration` … `lvl_16_balance_2000`.
- **Типы заданий V1:** `pocket_registration`, `lesson`, `task_report`, `deposit_checkpoint`, `balance_checkpoint`, `mentor_approval`; completionMethod: `manual`, `report_approval`, `pocket_postback`, `deposit_postback`, `balance_check`.
- **Чекпоинты V1:** депозитный (шаг 4, любой первый депозит) и балансовые $500 / $1000 / $2000 (шаги 8 / 12 / 16).
- **XP:** счётчик `User.xp` + append-only леджер `XpEvent (userId, amount, source, sourceId)`. Источники: task, promocode, referral, daily reward.
- **Уровни:** таблица `Level (number, requiredXp)` — пороги 0…3500 XP; используется в UI, но **не** как условие открытия уровня.
- **Прогресс:** `UserTaskProgress (locked | active | completed)`, последовательное открытие следующего шага при completion текущего.
- **Checkpoint-модель:** `Checkpoint` — одна строка на пользователя (`userId` unique), статусы not_started/active/completed/frozen. Заморозка блокирует completion заданий с `stepNumber > checkpoint.stepId`.
- **Pocket:** endpoint `GET /api/postbacks/pocket`, поддерживает все 9 goal-типов (Registration, Email Confirmation, First Deposit, Re-deposit, Withdrawal, Commission, New/Canceled/Successful Withdrawal). Secret проверяется и редактируется из rawPayload (`[redacted]`). Идемпотентность: unique `externalEventId` + fallback-fingerprint `sha256(clickId|traderId|type|amount|date_time)`. Все 19 attribution-макросов извлекаются и сохраняются.
- **Баланс:** `ExchangeAccount.balance` накапливается инкрементами из postback-событий; провайдер `sandbox` читает это поле; `real_placeholder` не реализован. USD-конверсии нет.
- **Отчёты:** `TaskReport (pending | approved | rejected)`, unique `(userId, taskId)`, ревью mentor/admin, файлы-вложения.
- **Роли:** user / admin / support / mentor / moderator / news_editor.
- **Аудит:** `AuditLog` используется повсеместно — хороший фундамент.
- **Контент уроков:** hardcoded в `src/lib/lessonContent.ts`, по одному контрольному вопросу на урок, попытки не сохраняются.
- **Промокоды:** XP-бонус через леджер, уровни не открывает; лимит на пользователя проверяется неатомарно.
- **Инфраструктура:** git-репозитория в live-папке нет (до Pre-Phase 0A); бэкапы — tgz-архивы и папки `backups/`, `.codex-backups/`.

---

## 2. Mapping: логическая модель V2 → текущая система

| V2 (спецификация) | Текущая реализация | Оценка |
|---|---|---|
| CurriculumVersion | — | Отсутствует. Версионирования нет, маршрут один |
| ModuleDefinition | — | Отсутствует (модулей нет, только плоские шаги) |
| LevelDefinition | `Task` (code, stepNumber, kind, xpReward, balanceThreshold, completionMethod) + `Level` (requiredXp) | Частично; нет visibilityRule, contentVersionId, assessmentVersionId, привязки к модулю/версии |
| UserCurriculumEnrollment | `User.level / xp / currentTask` | Enrollment как сущности нет |
| UserLevelProgress | `UserTaskProgress` | 3 статуса вместо 8 (нет hidden, xp_eligible, pending_review, temporarily_suspended) |
| XPTransaction | `XpEvent` | Нет unique idempotencyKey, curriculumVersionId, levelNumber, metadata |
| CheckpointDefinition | `Task.isCheckpoint` + `balanceThreshold` | Определение чекпоинта зашито в задачу; нет grace, reveal-политики, requiredBelowThresholdConfirmations |
| UserCheckpointState | `Checkpoint` (1 строка на пользователя) | Нет истории чекпоинтов, firstReachedAt, grace-состояний (4 статуса вместо 9) |
| FeatureDefinition / UserEntitlement | `Reward` / `UserReward` + гейтинг `ChatChannel` (requiredLevel/requiredCheckpoint) | Нет единой модели entitlement, нет suspend/restore |
| ContentVersion | hardcoded `src/lib/lessonContent.ts` | Противоречит контракту (контент должен быть versioned, не в коде) |
| AssessmentVersion / QuestionDefinition / AssessmentAttempt | 1 вопрос на урок в коде, попытки не сохраняются | Отсутствует (нет порога 80%, банка вопросов, истории попыток) |
| FinancialBalanceSnapshot | `ExchangeAccount.balance` (одно текущее значение) | Нет снапшотов, USD-конверсии, settled/open-trades, источника verification |
| Feature Usage (journal, risk plan, …) | — | Отсутствует |
| Product Events (раздел 17) | Notification + AuditLog | Событийной таксономии нет (нет eventVersion, sessionId, idempotencyKey) |
| CRM Signals (раздел 18) | `Cohort` / `CrmUserCohort` — статические снапшоты | Живых сигналов нет |

### API mapping (раздел 19)

Есть: current state (`/api/me`, `/api/tasks`), level content (`/api/tasks/[id]`), complete, report submit/review, checkpoint check, promocode redeem, feature-подобные rewards.
Нет: GET XP history, GET entitlements, GET financial access state, GET next checkpoint как отдельные контракты; SAVE lesson progress; START/SUBMIT assessment; SAVE practice draft.

---

## 3. Отсутствующие сущности (создавать в Phase 1+)

1. CurriculumVersion, ModuleDefinition, LevelDefinition (V2, параллельно V1).
2. UserCurriculumEnrollment, UserLevelProgress (V2-статусная модель).
3. Расширение XP-леджера: idempotencyKey (unique), curriculumVersionId, levelNumber, metadata.
4. CheckpointDefinition + UserCheckpointState с историей, grace и reveal-политикой.
5. FeatureDefinition + UserEntitlement с suspend/restore.
6. ContentVersion, AssessmentVersion, QuestionDefinition, AssessmentAttempt.
7. FinancialBalanceSnapshot (+ определение settled balance, USD-конверсия).
8. Product Event pipeline (раздел 17) и CRM signals (раздел 18).

---

## 4. Несовместимости и находки

1. **Withdrawal-баг (критичный, финансовый).** В `buildPostbackAccountUpdate` события `New Withdrawal` и `Canceled Withdrawal` проваливаются в ветку `eventType === "balance"` и **перезаписывают balance суммой заявки** (`balance = amount`). Plain `Withdrawal` декрементирует balance. По продуктовым решениям: заявка/отмена не меняют финансовое состояние; в расчётах участвует только `Successful Withdrawal`. Исправляется отдельным этапом **Pre-Phase 0B** (не в 0A).
2. **XP-порог не является условием открытия уровня.** Проверяется только последовательность и заморозка чекпоинта; `Level.requiredXp` в unlock-логике не участвует. V2 требует все три условия.
3. **Заморозка без grace-периода:** один замер ниже порога сразу даёт `frozen`; нет 24-часового grace, правила двух подтверждений, отложенной suspension при открытых сделках; нет suspend/restore инструментов (entitlements).
4. **V1 level 4 = «любой депозит»**, а не `real balance >= $50`; XP начисляется по факту депозитного postback. При миграции маппится на V2 Level 4 только после проверки real balance >= $50.
5. **Реального balance-провайдера нет:** sandbox читает накопленное поле; `real_placeholder` возвращает «not implemented». Имитировать production-проверку запрещено; provider-unavailable должен стать отдельным состоянием.
6. **Промокоды: неатомарный perUserLimit.** Проверка count вне транзакции; unique `(promocodeId, userId)` добавлять нельзя — сломает `perUserLimit > 1`. Требуется отдельное атомарное решение (idempotency + лимиты).
7. **XP-источники вне V2-списка:** referral XP (100/50) и daily login XP. Решения: daily login XP в V2 отключён; referral XP в V1 сохраняется, в V2 — отдельный конфигурируемый источник, disabled до anti-abuse дизайна.
8. **Идемпотентность Pocket:** fallback-fingerprint не различит две легитимные операции с одинаковой суммой без `transaction_id`/`date_time` — риск из раздела 11.7 спецификации.
9. **Отчёты:** нет draft/resubmitted-статусов, reason codes, рубрики ментора, SLA-трекинга; одна запись на (user, task).
10. **Контент/тесты hardcoded** в route/lib-коде — переносить в versioned content.
11. **Commission:** принимается и инкрементирует totalCommission/deposit-ветку. Решение: событие можно принимать для совместимости endpoint, но оно не должно менять balance, XP, progression и CRM-состояние.
12. **SQLite:** не блокирует параллельную V2-модель в закрытом тестировании; отдельное решение по СУБД потребуется перед масштабированием (рост финансовых/event-записей).

---

## 5. Риски

- Разработка без Git прямо рядом с live-проектом (закрыто Pre-Phase 0A: санитизированная копия + git baseline).
- Финансовые расхождения из-за withdrawal-семантики (до Pre-Phase 0B).
- Одна Checkpoint-строка на пользователя не выдержит 20 чекпоинтов V2 — нужна новая модель, старую не мигрировать деструктивно.
- Ручные правки в live-папке без версионирования; наличие root-владельцев у части файлов.
- Отсутствие реального balance-провайдера делает checkpoint-логику V2 тестируемой только на sandbox.

---

## 6. Рекомендуемые фазы

- **Pre-Phase 0A (эта задача):** санитизированная рабочая копия + git baseline + документы. Без функциональных изменений.
- **Pre-Phase 0B:** исправление withdrawal-семантики с тестами — только в новой git-копии.
- **Phase 1:** CurriculumVersion / ModuleDefinition / LevelDefinition + валидация + draft/published (V2 параллельно V1, выключено).
- **Phase 2:** Enrollment + UserLevelProgress + последовательный unlock (включая XP-gate) + совместимость с V1.
- **Phase 3:** XP engine V2 (леджер с idempotencyKey, required XP, promocode-совместимость).
- **Phase 4:** ContentVersion / AssessmentVersion / attempts; вынос hardcoded-контента.
- **Phase 5:** Report workflow V2 (draft, review, rubric, reason codes).
- **Phase 6:** FeatureDefinition / UserEntitlement (unlock, suspend, restore).
- **Phase 7:** Pocket financial event expansion (withdrawal lifecycle, macros, идемпотентность).
- **Phase 8:** Balance checkpoint engine (snapshots, USD, grace, suspension, restore).
- **Phase 9+:** пилот уровней 1–10, admin curriculum management, уровни 11–100, migration framework, controlled rollout — по спецификации.

---

## 7. Данные, которые нужно запросить до Phase 1

1. Реальный payload Pocket по балансу (API/WebSocket) и по withdrawal-событиям.
2. Наличие и формат `transaction_id` у Pocket.
3. Правило USD-конверсии и список валют в финансовых событиях.
4. Определение settled balance (учёт открытых сделок).
5. Продуктовое подтверждение решений по referral / daily login XP (зафиксированы в `V2_PRODUCT_DECISIONS.md`).

*Документ не содержит secrets, паролей, реальных пользовательских данных и значений postback secret.*
