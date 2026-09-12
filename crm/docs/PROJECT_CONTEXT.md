# PROJECT_CONTEXT.md — Alfa Trade Academy CRM

> Phase 0 (обновлено в Phase 0.5) · Systematized product context. Документ фиксирует, **что** мы строим и **в каких границах**, до написания кода.
> Статус: Архитектура принята; продуктовые решения зафиксированы в DECISIONS.md. Источник: Project Instructions + Project Context (synced 2026-07-12).
> **Phase 0.5:** §6 переписан под 5-мерную модель состояний (STATE_MODEL.md); зафиксированы источники истины (D-02) и checkpoints >L100 (D-10).

---

## 1. Резюме

Alfa Trade Academy — образовательная платформа по трейдингу с последовательным маршрутом обучения (уровни → уроки → тесты → сценарии → практика → reports → mentor review), системой XP и финансовыми checkpoints, привязанными к реальному балансу торгового аккаунта в Pocket.

**Alfa Trade Academy CRM** — отдельное внутреннее приложение для сотрудников (retention, mentoring, support, moderation, analytics, product operations). Это **не** админ-панель для редактирования таблиц, а операционная система сопровождения пользователя: она отвечает на вопрос «кто требует внимания сегодня и что с этим делать».

CRM разрабатывается **полностью отдельно** от основного продукта, на первом этапе — только на synthetic/mock data, без какого-либо доступа к production. Реальные данные подключаются позже через отдельный защищённый API, **без переписывания UI**.

---

## 2. Два продукта, одна доменная модель

| | Основной продукт (учебная платформа) | CRM (эта разработка) |
|---|---|---|
| Пользователь | Ученик-трейдер | Сотрудник команды |
| Команда | Отдельная backend-команда | Отдельная CRM-команда |
| Репозиторий | Существующий, **не трогаем** | Новый, отдельный |
| Домен размещения | `<domain>` | `crm.<domain>` (отдельный поддомен) |
| Авторизация | Пользовательская | Отдельная, только для сотрудников |
| База данных | Production (Prisma) — **не трогаем** | Нет БД; mock provider → позже API |
| Pocket-интеграция | Владеет ею | **Не трогает**; читает производные данные через будущий API |

CRM и продукт разделяют **понятийную модель** (уровни, XP, checkpoints, lifecycle, Pocket-события), но не разделяют код, БД или процессы деплоя.

---

## 3. Назначение CRM: вопросы, на которые она отвечает

CRM должна давать сотруднику ответы на операционные вопросы по каждому пользователю и по всей базе:

- Кто требует внимания сегодня и почему?
- На каком этапе маршрута находится пользователь и что его блокирует?
- Что произошло недавно (единая хронология)?
- Какой следующий шаг рекомендован и на каком основании?
- Кто отвечает за пользователя (owner)?
- Какие действия уже предпринимались и был ли результат?
- Есть ли открытая mentor-, support- или финансовая проблема?
- Какие автоматизации сработали?
- Какие коммуникации пользователь получил и не перегружен ли он ими?

Ключевой принцип продукта: **объяснимость**. Каждый сигнал, приоритет и рекомендация должны сопровождаться evidence (данными-основанием), а не непрозрачным score.

---

## 4. Продуктовая механика (что CRM обязана отражать корректно)

### 4.1 Последовательность уровней
Уровни проходятся строго по порядку. Уровень открывается только если: (1) завершён предыдущий обязательный уровень, (2) хватает XP, (3) активна нужная финансовая контрольная точка.

### 4.2 XP
XP **не списывается**, может копиться заранее, но **не** позволяет перепрыгнуть уровень или пройти финансовый checkpoint. XP **не** начисляется за реальные/demo сделки, депозит или потерю баланса. XP — это учебная прогрессия, не финансовая.

### 4.3 Финансовые checkpoints
Checkpoint проверяет **подтверждённый real balance Pocket**. Не используются: demo balance, сумма одного депозита, cumulative deposit, XP.

Целевая сетка (уровень → требуемый real balance, USD):

`4 → 50 · 10 → 100 · 15 → 150 · 20 → 200 · 25 → 300 · 30 → 400 · 35 → 500 · 40 → 750 · 45 → 1 000 · 50 → 1 500 · 55 → 2 000 · 60 → 2 500 · 65 → 3 000 · 70 → 4 000 · 75 → 5 000 · 80 → 6 000 · 85 → 7 000 · 90 → 8 000 · 95 → 9 000 · 100 → 10 000`.

**После уровня 100 (DECISIONS D-10):** суммы **не придумываются**. Состояние checkpoint — `future_checkpoint_not_defined`; UI показывает «Следующая программа находится в разработке», без финансовой суммы и без фальшивого прогресса.

### 4.4 Падение баланса и grace period
Если real balance падает ниже требования последнего достигнутого checkpoint: completed levels, XP и история checkpoint **сохраняются**; начинается grace period; доступ **после** checkpoint может временно приостановиться; уровни **до** checkpoint включительно остаются доступны; при восстановлении баланса доступ возвращается.

Рабочее правило v1: grace period **24 часа**; минимум **два подтверждения** ниже threshold; при открытых сделках решение по возможности откладывается; восстановление доступа — сразу после подтверждения достаточного баланса.

### 4.5 Pocket-события и их mapping
Ожидаемые события: Registration, Email Confirmation, First Deposit, Re-deposit, New/Canceled/Successful Withdrawal, balance updates, trade opened/closed, token expired.

Продуктовый mapping (внешнее → внутреннее): `Registration → pocket_registration_confirmed`, `Email Confirmation → pocket_email_confirmed`, `First Deposit → first_deposit_confirmed`, `Re-deposit → redeposit_confirmed`, `New Withdrawal → withdrawal_requested`, `Canceled Withdrawal → withdrawal_cancelled`, `Successful Withdrawal → withdrawal_completed`.

**Net Deposits = First Deposits + Re-deposits − Successful Withdrawals.**

Финансовый postback может содержать goal, sum, clickid, playerid, опционально date_time и attribution-макросы. **Postback secret нельзя хранить в CRM, events, logs или visible payload** — ни в mock, ни в будущем API.

---

## 5. Главные показатели и северная звезда

Отслеживаемые показатели: Net Deposit Volume, Gross Deposit Volume, Redeposit Volume, Redeposit Count, Redeposit Depth per FTD, Retained Funded Users (30/90/180/365 д.), Financial Checkpoint Completion, Learning Progression, Reactivation, Mentor/Support SLA.

**Северная звезда — Retained Funded Progressing Users:** пользователи со связанным Pocket-аккаунтом, продолжающие осмысленную учебную активность, двигающиеся по уровням, сохраняющие/восстанавливающие funded status и возвращающиеся на горизонте недель и месяцев.

Из этого следует, что CRM оптимизирует не «клики», а **удержание платящих прогрессирующих пользователей** — все сигналы и очереди работают на эту метрику.

---

## 6. Модель состояний пользователя (5 измерений — обновлено в Phase 0.5)

> **Phase 0.5, DECISIONS D-01:** прежний единый lifecycle mega-enum заменён на **пять ортогональных измерений**, потому что состояния разной природы сосуществуют (пользователь одновременно `active` + `funded` + `repeat_funder` + `inactive_7d` + `support_blocked`). Канон — **STATE_MODEL.md**.

1. **LifecycleStage** (ровно 1, versioned): `registered, pocket_registered, pre_ftd, first_depositor, active, at_risk, dormant, reactivated, completed_current_curriculum`.
2. **FundingStatus** (1): `not_available, unfunded, funded, checkpoint_grace, financial_access_suspended, balance_unknown`.
3. **EngagementStatus** (1): `not_started, active, progression_stalled, inactive_3d, inactive_7d, dormant_14d, dormant_30d, returned`.
4. **ValueSegment** (0..N теги): `first_depositor, repeat_funder, frequent_repeat_funder, high_value_candidate, advanced_learner`.
5. **OperationalBlocker** (0..N теги): `email_unconfirmed, pocket_registration_incomplete, report_pending, mentor_blocked, support_blocked, financial_data_conflict, communication_fatigue`.

`LifecycleStage` — versioned (current/previous/enteredAt/reason/evidence/history/override), чтобы изменения правил не переписывали историю. Остальные измерения несут evidence, reasonCode, calculatedAt и expiresAt (где применимо).

**Источники истины (DECISIONS D-02):** backend продукта владеет identity, Pocket, XP, progression, уроками/тестами, reports, deposits/withdrawals, balance, checkpoints, historical completion. CRM владеет операционным слоем: LifecycleStage, signals, value segments, recommended actions, приоритеты очередей, primary owner, tasks, cases, notes, communication fatigue, automation runs, outcomes, employee audit. **CRM не пересчитывает balance, XP и checkpoint completion.**

---

## 7. Границы и запреты первого этапа

**Запрещено на Phase 0/первой стадии:**
подключаться к backend или production database Alfa Trade Academy; использовать production users; отправлять реальные сообщения; менять реальные lifecycle/owner; инициировать финансовые операции; делать production deploy; выдавать frontend role fixture за production RBAC.

**Разрешено:** проектировать; работать с synthetic/mock data; строить UI и контракты. Все изменяющие действия в UI **явно** помечаются как mock/local.

**Архитектурная граница (не пересматривается):**
`CRM UI → application/domain layer → CrmDataProvider (interface) → MockCrmDataProvider`, позже `→ ApiCrmDataProvider → отдельный защищённый API продукта`. UI не переписывается при замене provider.

---

## 8. Что персонализирует CRM, а что — нет

CRM **персонализирует сопровождение**: приоритет, owner, timing, channel, recommended action, mentor/support intervention, cooldown, частоту коммуникаций.

CRM **не меняет** фиксированный curriculum: порядок уроков, условия XP, checkpoints, финансовые требования, историческую completion. Учебная программа фиксирована; персонализируется только работа команды вокруг пользователя.

---

## 9. Глоссарий

- **FTD** — First Time Deposit (первый подтверждённый депозит).
- **Checkpoint** — финансовая контрольная точка на реальном балансе Pocket.
- **Grace period** — окно (24 ч v1) до приостановки доступа при падении баланса.
- **Signal** — временный, объяснимый индикатор состояния с evidence и сроком жизни.
- **Owner** — сотрудник, отвечающий за пользователя.
- **User 360** — полная карточка пользователя.
- **Provider** — реализация `CrmDataProvider` (mock сейчас, API позже).
- **Net Deposits** — First + Re-deposits − Successful Withdrawals.
- **Retained Funded Progressing User** — северная звезда (см. §5).

---

_Связанные документы: CRM_INFORMATION_ARCHITECTURE.md, CRM_DOMAIN_MODEL.md, ROLE_PERMISSION_MATRIX.md, DATA_PROVIDER_CONTRACT.md, MOCK_DATA_PLAN.md, UX_BLUEPRINT.md, FUTURE_INTEGRATION.md, IMPLEMENTATION_PLAN.md._
