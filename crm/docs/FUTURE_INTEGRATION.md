# FUTURE_INTEGRATION.md — Alfa Trade Academy CRM

> Phase 0 (обновлено в Phase 0.5) · Перечень будущих API от backend Alfa Trade Academy, чтобы `ApiCrmDataProvider` заменил `MockCrmDataProvider` без переписывания UI.
> **Это НЕ проектирование прямого подключения к базе.** CRM никогда не ходит в production DB, Prisma или Pocket напрямую — только через отдельный защищённый API продукта.
> Статус: Draft / запрос к backend-команде.
>
> **Phase 0.5 (DECISIONS D-02):** зафиксировано разделение источников истины. Продукт отдаёт **сырые/производные данные** (identity, Pocket, XP, progression, reports, deposits/withdrawals, balance, checkpoints, historical completion). **CRM владеет операционным слоем** (LifecycleStage, signals, value segments, recommended actions, приоритеты, primary owner, tasks, cases, notes, communication fatigue, automation runs, outcomes, employee audit) и **не пересчитывает** balance/XP/checkpoint. FundingStatus/EngagementStatus вычисляются CRM-доменом из продуктовых данных по SIGNAL_CATALOG.

---

## 0. Границы интеграции

```
CRM UI → domain layer → CrmDataProvider
                          ├─ MockCrmDataProvider   (сейчас)
                          └─ ApiCrmDataProvider     (позже)
                               → HTTPS → отдельный защищённый CRM-facing API продукта
                                          → (внутри продукта) DB / Pocket / бизнес-логика
```

**Правила:**
1. CRM получает только **read-model проекции** доменных сущностей (DOMAIN_MODEL), не сырые таблицы.
2. Никаких секретов Pocket/postback в ответах API — они остаются на стороне продукта.
3. Реальный RBAC, аутентификация сотрудников и enforcement прав — на стороне API; frontend fixture не является безопасностью.
4. Все мутации CRM (tasks/cases/notes/assignments) — через API продукта, с audit на бэкенде.
5. Контракт API должен отображаться 1:1 на операции DATA_PROVIDER_CONTRACT.md, чтобы `ApiCrmDataProvider` был тонким адаптером.

---

## 1. Аутентификация и авторизация сотрудников

- **Auth API:** вход сотрудников (SSO/OAuth/OIDC — на усмотрение продукта), сессии/токены для `crm.<domain>`, отдельные от пользовательской авторизации.
- **RBAC/authz API:** роли сотрудника, разрешения, scope (own/team/all). CRM отправляет токен, backend возвращает effective permissions и enforced-фильтрацию данных.
- **Employee directory API:** список сотрудников (id, имя, роль) для owner-назначений и отображения actor.

---

## 2. User read-model API (наполняет User 360 и списки)

- **Search/List users:** серверный поиск/фильтр/сортировка/курсорная пагинация → `UserListRow` (проекции). Эквивалент `searchUsers`.
- **Get user aggregate:** полный `CrmUser` по id (identity, lifecycle, progression, learning, financial, pocket, entitlements). Эквивалент `getUserById`.
- **Identity:** masked email, подтверждение email, страна/локаль — без полного email/PII.
- **Lifecycle:** LifecycleStage (5-мерная модель) — **CRM-owned** (D-02). Продукт отдаёт сырые сигнальные данные; CRM вычисляет и хранит LifecycleStage с historical/versioned. API продукта отдаёт лишь данные-основания, не сам stage.
- **Progression:** уровни, XP, checkpoints, lockedReason, completionHistory.
- **Learning:** уроки/тесты/reports/mentor reviews/streak.
- **Entitlements:** granted/locked/suspended по доступам.

---

## 3. Financial read-model API (Pocket-derived)

- **Financial summary:** real balance + **freshness/asOf**, FTD, redeposits, successful withdrawals, net/gross deposits, redepositCount, nextCheckpoint, grace-состояние, история suspended/restored. Эквивалент части `getUserById` и `getFinancialOperationsSummary`.
- **Financial operations:** списки по checkpoint approaching/grace/suspended/restored, data conflicts, агрегаты Net/Gross/Redeposit.
- **Требования:**
  - каждое значение с timestamp/freshness и числом подтверждений (для grace-логики 24ч/2 подтверждения);
  - агрегированные проекции для analyst без сырых персональных сумм;
  - **никаких** postback secret, сырых playerId/clickid в ответах;
  - конфликты данных (продукт vs Pocket) отмечаются флагом, а не скрываются.

---

## 4. Pocket status API (производное, не прямой Pocket)

- **Pocket affiliate registration status** — только три канонических значения: `not_registered / registration_pending / registered`. `registered` выставляется бэкендом при получении подтверждённого события регистрации Pocket по affiliate flow (не по клику/форме/депозиту/наличию финансовых данных/подтверждению email).
- **Pocket «Email Confirmation» — отдельное provider-событие, НЕ смоделировано на mock-этапе.** Оно не является тем же, что `identity.emailConfirmed` (подтверждение email аккаунта ATA). Отдельное представление статуса Pocket Email Confirmation будет определено будущим backend/API contract (сейчас намеренно не придумываем для него status).
- lastEvent, tokenState, dataConflict.
- Нормализованные Pocket-события (по продуктовому mapping из PROJECT_CONTEXT §5) для Timeline — **уже очищенные** от секретов и сырых attribution-макросов.

---

## 5. Signals & Recommendations API

- **Signals:** активные/исторические `UserSignal` с evidence, severity, expiresAt. Эквивалент `getUserSignals`.
- **Recommended actions:** `RecommendedAction` с rationale/basedOnSignals/evidence. Эквивалент `getRecommendedActions`.
- Открытый вопрос: сигналы/рекомендации считаются на стороне продукта или CRM-домена (см. IMPLEMENTATION_PLAN, риски). API должен отдавать evidence в любом случае.

---

## 6. Timeline API

- Нормализованный поток `UserTimelineEvent` из всех источников (product/pocket/employee/communication/automation/lifecycle/signal/task/case), курсорная пагинация по времени, фильтры по источнику/типу/датам. Эквивалент `getUserTimeline`.
- Per-event sensitivity для маскирования.

---

## 7. Work items API (CRM-owned, но исполняется/хранится на бэкенде)

- **Tasks:** CRUD + назначение + смена статуса + outcome/follow-up. Эквивалент `getUserTasks` + `CrmMutations`.
- **Cases:** CRUD + связка tasks/notes + SLA + закрытие. Эквивалент `getUserCases`.
- **Notes:** CRUD + visibility. Эквивалент `getUserNotes`.
- **Owner assignment:** назначение/переназначение + история. 
- Все с idempotency, reasonCode, серверным audit.

Открытый вопрос: где «живут» CRM-сущности — в основной БД продукта или в отдельном CRM-хранилище за API. На Phase 0 не решается; контракт от этого не зависит.

---

## 8. Queues API

- **Mentor queue:** элементы проверок с SLA. Эквивалент `getMentorQueue`.
- **Support queue:** обращения/блокеры с SLA. Эквивалент `getSupportQueue`.
- Действия очередей (взять/approve/reject/эскалация) — через Work items/Cases API.

---

## 9. Segments API

- Системные и сохранённые сегменты (описание + фильтр + count с freshness). Эквивалент `getSegments`; состав — через users search с segment-фильтром.

---

## 10. Communications & Automations API

- **Communications:** история отправленных коммуникаций, лимиты частоты (fatigue), suppression. CRM v1 не отправляет; в будущем — чтение и, возможно, инициирование через API продукта с его правилами.
- **Automations:** правила (trigger/conditions/exclusions/priority/cooldown/re-entry/action/outcome window/suppression) и runs. CRM отображает; исполнение — на стороне продукта.

---

## 11. Analytics / Aggregates API

- Агрегированные метрики и воронки (Net/Gross/Redeposit, Retained Funded 30/90/180/365, Checkpoint Completion, Progression, Reactivation, SLA), северная звезда Retained Funded Progressing Users — только агрегаты, без сырого PII/финансов вне права.

---

## 12. Audit API

- Append-only журнал действий (actor/action/entity/before/after/reason/source/time). CRM пишет через API продукта; читает с фильтрами. Реальный (не mock) audit — обязательно на бэкенде.

---

## 13. Нефункциональные требования к API

- Курсорная пагинация, серверные фильтры/сортировка (совпадают с DATA_PROVIDER_CONTRACT).
- Явные `freshness/asOf` в финансовых и агрегатных ответах; поддержка stale-ответов.
- Единый формат ошибок, маппящийся на `CrmErrorCode` (unauthorized/not_found/invalid_input/rate_limited/upstream_unavailable/stale_data/conflict/internal).
- Rate limiting и защита от перебора; только HTTPS; принцип наименьших привилегий (CRM-facing scope, а не полный доступ к БД).
- Версионирование API (напр. `/v1/`), совместимое с версионированием lifecycle/curriculum.
- Idempotency-ключи для мутаций.

---

## 14. Что backend-команде НЕ нужно делать для Phase 0

- CRM на Phase 0 **не требует** ни одного из этих API прямо сейчас — они реализуются на этапе интеграции.
- Никаких изменений в production DB/Prisma/Pocket/production-коде ради CRM на текущем этапе.
- Данный документ — **запрос-заготовка** для планирования, не обязательство к немедленной реализации.

---

_Связано: DATA_PROVIDER_CONTRACT.md (1:1 операции), CRM_DOMAIN_MODEL.md (проекции), ROLE_PERMISSION_MATRIX.md (реальный RBAC на бэкенде), IMPLEMENTATION_PLAN.md (этап integration preparation)._
