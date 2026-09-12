# IMPLEMENTATION_PLAN.md — Alfa Trade Academy CRM

> Phase 0 (обновлено в Phase 0.5) · План реализации отдельного Next.js-приложения на mock-данных. Включает **утверждённый (Locked)** стек, структуру каталогов, риски, противоречия и остаточные вопросы.
> **Код не пишется до утверждения этого блюпринта.** Ни одна команда ниже не выполняется сейчас.
> Статус: Архитектура принята; решения зафиксированы в DECISIONS.md.
>
> **Phase 0.5:** стек зафиксирован (D-03); добавлен этап State Model в mock provider; блокирующие вопросы Phase 0 закрыты (см. DECISIONS §сводка), ниже — только остаточные вопросы Phase 1.

---

## A. Утверждённый стек (Locked, DECISIONS D-03)

Зафиксировано: `Next.js App Router · TypeScript strict · Tailwind CSS · Radix UI primitives · TanStack Table · Zod · React Hook Form · Vitest · Playwright`. Последняя стабильная совместимая версия Next.js, **без experimental-функций** без отдельного решения. На первой реализации — без database, Prisma, настоящей authentication и настоящей API integration. Таблица ниже раскрывает обоснование по слоям.



| Слой | Выбор | Обоснование |
|---|---|---|
| Framework | **Next.js (App Router), React, TypeScript (strict)** | Задано контекстом; App Router — серверные компоненты, роутинг разделов, будущий SSR при API. |
| Язык | TypeScript strict | Domain-контракты из DOMAIN_MODEL требуют строгой типизации. |
| UI-компоненты | **Headless-библиотека (Radix/shadcn-подобная) + собственная дизайн-система** | Доступность из коробки, плотные таблицы, отсутствие «декоративного» стиля. |
| Стили | **Tailwind CSS** + токены дизайна | Быстрая плотная вёрстка, единая семантика цветов/статусов. |
| Таблицы | **TanStack Table + виртуализация (TanStack Virtual)** | Конфигурируемые колонки, сортировка, большие датасеты (UX §16). |
| Данные/кэш | **TanStack Query** поверх `CrmDataProvider` | Loading/stale/error-состояния, курсорная пагинация, кэш — совпадает с Result<T>. |
| Состояние UI | React state + лёгкий стор (**Zustand**) для density/saved views/фильтров | Без тяжёлого глобального стейта. |
| Формы/валидация | **React Hook Form + Zod** | Zod-схемы = runtime-валидация доменных типов, переиспользуются mock↔API. |
| Роутинг ролей | mock RBAC guard в domain-слое (`assertPermission`) | Готовность к серверному RBAC без переписывания UI. |
| Тесты | **Vitest** (unit/domain), **Testing Library** (компоненты), **Playwright** (e2e ключевых сценариев) | Проверка контракта provider и сценариев Today/User 360. |
| Качество | ESLint + Prettier + typecheck в CI; **Storybook** для компонентов состояний (empty/loading/error) | Гарантия покрытия всех UI-состояний. |
| Дата/деньги | date-fns (UTC) + деньги в minor units (без float) | Корректность финансов/freshness. |

Примечание: конкретные библиотеки — **рекомендация**, не жёсткое требование; критично лишь разделение `UI → domain → CrmDataProvider` и strict TS. Стек фиксируется при утверждении (см. блокирующий вопрос B?).

---

## B. Предлагаемая структура каталогов

```
ata-crm/                          # отдельный репозиторий
├─ docs/                          # эти блюпринты (Phase 0)
├─ src/
│  ├─ app/                        # Next.js App Router
│  │  ├─ (crm)/
│  │  │  ├─ today/
│  │  │  ├─ users/                # список
│  │  │  │  └─ [userId]/          # User 360
│  │  │  ├─ segments/
│  │  │  ├─ tasks/
│  │  │  ├─ cases/
│  │  │  ├─ mentor-queue/
│  │  │  ├─ support-queue/
│  │  │  ├─ financial-operations/
│  │  │  ├─ communications/       # placeholder
│  │  │  ├─ automations/          # placeholder
│  │  │  ├─ analytics/            # placeholder
│  │  │  ├─ audit/
│  │  │  └─ settings/
│  │  └─ layout.tsx               # AppShell
│  ├─ domain/                     # доменный слой (framework-agnostic)
│  │  ├─ entities/                # типы из CRM_DOMAIN_MODEL (CrmUser, UserStateProfile, ...)
│  │  ├─ state/                   # 5 измерений (STATE_MODEL): Lifecycle/Funding/Engagement/Value/Blocker
│  │  ├─ enums/                   # LifecycleStage, FundingStatus, SignalCode, ...
│  │  ├─ permissions/             # роли, assertPermission, matrix, финансовые бакеты, PII
│  │  └─ services/                # приоритезация, маскирование финансов (bucket), PII reveal
│  ├─ data/                       # провайдеры данных
│  │  ├─ CrmDataProvider.ts       # интерфейс (DATA_PROVIDER_CONTRACT)
│  │  ├─ mock/
│  │  │  ├─ MockCrmDataProvider.ts
│  │  │  ├─ fixtures/             # SYNTHETIC MOCK DATA (immutable, MOCK_DATA_PLAN)
│  │  │  └─ overlay/              # localStorage mutation overlay + schemaVersion + Reset (D-09)
│  │  └─ api/                     # ApiCrmDataProvider — заглушка на будущее (не реализуется в v1)
│  ├─ ui/                         # дизайн-система и переиспользуемые компоненты
│  │  ├─ components/              # DataTable, Timeline, Badge, FreshnessTag, MoneyCell, ...
│  │  ├─ patterns/               # QueueCard, ContextPanel, FilterBar, SavedViewMenu
│  │  └─ tokens/                  # цвета/семантика/плотность
│  ├─ features/                   # экраны, собранные из ui + domain + data
│  │  ├─ today/  users/  user360/  tasks/  cases/  segments/  queues/  finops/  audit/
│  ├─ lib/                        # utils (money, dates, freshness, masking, buckets)
│  └─ config/                     # env flags (MOCK), feature flags, signals.config, sla.config
├─ tests/                         # vitest + playwright
├─ .storybook/
└─ (package.json, tsconfig и т.п. — создаются на этапе 1, НЕ сейчас)
```

Ключ: `domain/` и `data/` не зависят от React/Next → провайдер меняется без затрагивания UI.

---

## C. Этапы разработки

Каждый этап: **scope · не входит · dependencies · acceptance criteria · проверки · риски**. Этапы мелкие и последовательные.

### Этап 1 — App foundation
- **Scope:** инициализация Next.js+TS+Tailwind, tsconfig strict, ESLint/Prettier, базовый CI (typecheck/lint/test), Storybook, dev-скрипты, env-флаг `MOCK`.
- **Не входит:** любые бизнес-экраны, provider, компоненты данных.
- **Dependencies:** утверждение стека и Phase 0.
- **Acceptance:** приложение запускается локально, пустая страница, зелёный CI, работает typecheck.
- **Проверки:** CI green; `tsc --noEmit`; Storybook собирается.
- **Риски:** преждевременный выбор библиотек; версии Next/React.

### Этап 2 — CRM shell
- **Scope:** AppShell (sidebar+topbar), навигация IA §1, ⌘K-палитра (навигация без поиска данных), density-переключатель, индикатор MOCK, ролевой guard (mock) скрывающий разделы, empty-routes для всех разделов.
- **Не входит:** реальные данные, таблицы, User 360.
- **Dependencies:** этап 1.
- **Acceptance:** можно перейти в любой раздел; недоступные роли скрыты; density/роль переключаются.
- **Проверки:** e2e-навигация Playwright; a11y-проверка фокуса/клавиатуры.
- **Риски:** ранняя фиксация RBAC-модели без бэкенда.

### Этап 3 — State Model + Mock provider
- **Scope:** типы 5-мерной модели (`UserStateProfile` + enums, STATE_MODEL); каталоги сигналов/SLA/бакетов из конфига (SIGNAL_CATALOG/SLA_POLICY/D-07); интерфейс `CrmDataProvider`; `MockCrmDataProvider` со всеми 13 операциями; фикстуры 30 персон (MOCK_DATA_PLAN) в 5-мерной нотации; **immutable fixtures + localStorage mutation overlay + schemaVersion + Reset** (D-09); пагинация/фильтры (по 5 измерениям)/сорт; bucket/PII-маскирование по роли; искусственные loading/stale/error; TanStack Query-обёртки; Zod-схемы.
- **Не входит:** экраны/визуализация; реальное исполнение мутаций в продукте.
- **Dependencies:** этапы 1–2, STATE_MODEL, DOMAIN_MODEL, DATA_PROVIDER_CONTRACT, DECISIONS.
- **Acceptance:** каждая операция возвращает корректный `Result<T>`; фильтры по всем 5 измерениям работают; финансы маскируются в бакеты, email — по PII-политике; overlay сохраняется и сбрасывается; contract-тесты зелёные.
- **Проверки:** Vitest на каждую операцию (happy/empty/stale/error/unauthorized); Zod-валидация фикстур; тест overlay-персистентности и Reset.
- **Риски:** дрейф фикстур от контракта; неполное покрытие состояний/бакетов.

### Этап 4 — Today
- **Scope:** экран Today, QueueCard-группы, элемент очереди с reason/evidence/priority/action/owner/due/status, recommended actions, переход в User 360; scope own/team.
- **Не входит:** реальные действия (создание задач исполняется в mock/local позже), User 360 полностью.
- **Dependencies:** этап 3, `getTodayWorkspace`, `getRecommendedActions`.
- **Acceptance:** непустой Today на mock; каждый элемент объясняет «почему»; клик ведёт к пользователю; пустой Today для нового сотрудника.
- **Проверки:** компонентные тесты групп; e2e «начало смены»; проверка empty/loading/stale/error.
- **Риски:** логика приоритезации без утверждённых правил (см. вопросы).

### Этап 5 — Users (list)
- **Scope:** DataTable с колонками IA §4, FilterBar, сортировка, курсорная пагинация, конфигурация колонок, saved views, ⌘K-поиск пользователей, preview-панель, маскирование финансов по роли.
- **Не входит:** bulk-действия (визуально готовы, отключены); export-реализация (кнопка + гейт).
- **Dependencies:** этапы 3–4, `searchUsers`, `getSegments`.
- **Acceptance:** поиск/фильтр/сорт/пагинация работают на mock; saved view сохраняется; финансы маскируются без права.
- **Проверки:** unit фильтров/сорта; e2e поиска; a11y таблицы.
- **Риски:** производительность больших таблиц → виртуализация обязательна.

### Этап 6 — User 360
> **Обновление (Phase 1B4-B…1B6):** секция «Заметки» получила локальные mutation'ы поверх overlay
> (D-09): `addNote` (1B4-B), `assignPrimaryOwner` (1B4-C), `setNotePinned` (1B4-D), `updateNoteBody`
> (1B4-E), `setNoteVisibility` — смена видимости team↔private (1B5-C, D-91…D-95) и `deleteNote` — hard
> delete authored-заметки (1B6, D-96…D-101). Все — под существующим `edit_user_notes`, только автор своей
> overlay-заметки; `private` по identity актора, не по роли; `role_restricted` не создаётся; удаление
> физически убирает row из `notes[]`, append-only `note_deleted` — защитный источник истины (D-97). User 360
> audit-preview отложен (D-95).

- **Scope:** header, секции Progression/Learning/Financial/Activity/Operations, единый Timeline с фильтрами по источнику, Operations-панель (signals/recommended/tasks/notes), freshness на финансах, evidence-popover.
- **Не входит:** реальные мутации продукта; полноценные Communications/Automations экраны.
- **Dependencies:** этап 3, `getUserById/Timeline/Tasks/Cases/Notes/Signals/RecommendedActions`.
- **Acceptance:** карточка собирается из provider; Timeline объединяет все источники; HIGH-данные маскируются по роли; per-section freshness.
- **Проверки:** компонентные тесты секций/состояний; e2e «разбор пользователя»; a11y.
- **Риски:** объём данных Timeline → виртуализация/пагинация.

### Этап 7 — Tasks
- **Scope:** списки (мои/команда/по пользователю/по кейсу), статусы, фильтры/сорт; локальные mock-мутации (create/update/assign/outcome/follow-up) с confirmation + AuditRecord(mock).
- **Не входит:** реальное исполнение задач в продукте.
- **Dependencies:** этапы 3, 6; зарезервированные `CrmMutations`.
- **Acceptance:** задачи создаются/меняются локально; всё пишется в mock-Audit; overdue/SLA видны.
- **Проверки:** unit статусной машины; e2e жизненного цикла задачи.
- **Риски:** локальное состояние мутаций vs перезагрузка (нужен in-memory стор/сброс).

### Этап 8 — Cases
- **Scope:** список кейсов с фильтрами по типу/статусу/SLA, карточка кейса (tasks/notes/timeline/SLA/outcome/closing), кейсы в User 360; локальные mock-мутации.
- **Не входит:** реальная SLA-эскалация в продукте.
- **Dependencies:** этапы 3, 6, 7.
- **Acceptance:** кейс объединяет связанные задачи/заметки/таймлайн; закрытие с reason; SLA-бейджи.
- **Проверки:** компонентные/e2e; проверка связей task↔case.
- **Риски:** согласованность связей в mock-сторе.

### Этап 9 — Segments
- **Scope:** список системных/сохранённых сегментов, состав через `searchUsers({segmentId})`, счётчики с freshness, сохранение view.
- **Не входит:** массовые действия по сегменту (future).
- **Dependencies:** этапы 3, 5.
- **Acceptance:** каждый сегмент непустой на mock; переход к составу переиспользует таблицу Users.
- **Проверки:** unit фильтров сегмента; e2e перехода.
- **Риски:** дублирование логики фильтров (решается общим FilterBar).

### Этап 10 — Queues (Mentor + Support)
- **Scope:** Mentor Queue и Support Queue: элементы с SLA/приоритетом, взять в работу, approve/reject (mentor) с follow-up, эскалация в case; ограничение данных для support.
- **Не входит:** реальная отправка/решение в продукте.
- **Dependencies:** этапы 3, 6–8, `getMentorQueue/getSupportQueue`.
- **Acceptance:** очереди сортируются по SLA; действия создают mock-задачи/кейсы + Audit; support не видит Exact financials.
- **Проверки:** e2e mentor-review и support-flow; permission-тесты.
- **Риски:** без утверждённых SLA-порогов логика приблизительна (см. вопросы).

### Этап 11 — Financial Operations + Analytics/Audit (частично) + placeholders
> **Обновление (Phase 1B5-B, D-86…D-90):** глобальный Audit-журнал реализован раньше этого этапа —
> read-only экран `/audit` (`getAuditRecords`, provider-owned safe `AuditRecordView`, gated `canViewAudit`).
> Первая версия — без фильтров (D-89). Audit-preview в User 360 остаётся будущей фазой (D-90). Остальной
> scope этапа 11 (Financial Ops, Analytics/Communications/Automations placeholder'ы) не начат.

- **Scope:** Financial Ops (approaching/grace/suspended/restored/conflicts/агрегаты) с freshness и маскированием; Audit-журнал (просмотр mock-записей) + preview в User 360; Analytics/Communications/Automations как продуманные placeholder'ы с контрактами и mock-историей в Timeline.
- **Не входит:** реальные графики Analytics; реальное исполнение Automations/Communications.
- **Dependencies:** этапы 3, 6, `getFinancialOperationsSummary`.
- **Acceptance:** grace-таймеры 24ч, conflict-флаги, suspended/restored отображаются; Audit фильтруется; placeholder'ы не выглядят «сломанными».
- **Проверки:** unit grace/decline-логики; проверка отсутствия секретов в данных; a11y.
- **Риски:** нестрогая grace-логика (24ч/2 подтверждения) без подтверждённых правил.

### Этап 12 — Integration preparation
- **Scope:** довести `ApiCrmDataProvider` до типизированной заглушки (тот же интерфейс), точки маппинга ошибок в `CrmErrorCode`, feature-flag выбора provider, документ соответствия «операция → будущий API» (FUTURE_INTEGRATION), контрактные тесты, применимые к обоим провайдерам.
- **Не входит:** реальное подключение к API/БД; отправка сообщений; deploy.
- **Dependencies:** все предыдущие этапы.
- **Acceptance:** переключение provider флагом не ломает типы/UI; contract-тесты запускаются против mock (и готовы для api); ни одна production-система не затронута.
- **Проверки:** typecheck обоих провайдеров; contract-suite; ручной аудит запретов Phase 0.
- **Риски:** расхождение будущего API с контрактом (митигируется единым contract-тестом).

**Порядок зависимостей:** 1 → 2 → 3 → 4 → 5 → 6 → (7, 8 параллельно после 6) → 9 → 10 → 11 → 12.

---

## D. Главные архитектурные риски

1. **RBAC-иллюзия безопасности.** Frontend fixture может быть ошибочно принят за реальную защиту. Митигация: явные пометки mock, `assertPermission` в domain-слое, реальный enforcement откладывается на API (FUTURE_INTEGRATION §1).
2. **Дрейф контракта mock↔API.** UI может незаметно завязаться на особенности mock. Митигация: единый `CrmDataProvider` + contract-тесты, прогоняемые против любого провайдера; Zod-схемы.
3. **Финансовая чувствительность и freshness.** Риск показать точные суммы не той роли или без freshness. Митигация: маскирование в domain-слое до отдачи в UI, обязательный `FreshnessTag`, запрет секретов на уровне типов/фикстур.
4. **Неутверждённая продуктовая логика (checkpoints/grace/signals/SLA).** Реализация «на глаз» → переделки. Митигация: вынести пороги в конфиг, изолировать в `domain/services`, дождаться ответов на блокирующие вопросы.
5. **Объём данных / производительность.** Плотные таблицы и Timeline на больших наборах. Митигация: виртуализация, курсорная пагинация, серверная (в будущем) фильтрация — заложены в контракт.
6. **Состояние mock-мутаций.** Локальные изменения теряются при перезагрузке. Митигация: in-memory стор с явным reset; не заявлять о персистентности.
7. **Версионирование lifecycle/curriculum.** Изменение правил не должно переписывать историю. Митигация: versioned lifecycle с history/evidence в модели.
8. **Расползание placeholder-разделов.** Заглушки могут «застыть» неполными. Митигация: фиксированные контракты и явная метка зрелости [PLACEHOLDER].

---

## E. Противоречия и отсутствующие продуктовые решения

> **Phase 0.5 статус:** пункты 1–10 ниже **разрешены** в DECISIONS.md (D-01…D-11) и STATE_MODEL.md. Оставлены для истории; актуальные незакрытые вопросы — в §F. Кратко: (1) владелец сигналов/lifecycle → D-02; (2)(3) пороги → D-04/SIGNAL_CATALOG; (4) SLA → D-05; (5) grace → D-06; (6) маскирование → D-07; (7) L100 → D-10; (8) ownership → D-08; (9) persistence → D-09; (10) PII → D-11. Главный дефект (mega-enum lifecycle) устранён 5-мерной моделью (D-01).

### Историческая справка (исходные противоречия Phase 0)

1. **Кто вычисляет signals/recommendations/lifecycle** — продукт или CRM-домен? Контекст описывает их как продуктовые, но CRM на mock обязана считать их сама. Нужно решение об источнике истины на этапе API.
2. **Пороги сигналов не заданы точно:** что считается «lesson_abandoned», через сколько «inactive_3_days» именно, окно «communication_fatigue» (сколько сообщений/за какой период), «frequent_redeposit_pattern» (порог count/срок), «rapid_balance_decline» (%/срок). В контексте только названия.
3. **SLA-значения** mentor/support не заданы численно (только «SLA»). Нужны конкретные часы для очередей/Today.
4. **Grace-правило v1** задано (24ч, ≥2 подтверждения, откладывание при открытых сделках), но не описаны: частота проверок баланса, что если подтверждения приходят с большим разрывом, поведение на границе checkpoint при частичном восстановлении.
5. **Curriculum после L100** — «каждые 10 уровней», но конкретная сетка сумм не задана. Для advanced/completed персон нужна политика.
6. **Маскирование финансов:** формат диапазонов/скрытия для ролей без Exact financials не специфицирован (нужны конкретные бакеты).
7. **Communications initiation:** запрещена отправка на v1, но модель Communications подразумевает будущую отправку — граница «читать vs инициировать» через API не решена.
8. **Owner-модель:** один owner на пользователя или несколько ролей-владельцев (retention + mentor + support одновременно)? Модель поддерживает одного текущего + историю; продуктовое решение о мульти-ownership не зафиксировано.
9. **Персистентность mock-действий:** ожидается ли, что демо-изменения сохраняются между сессиями, или строго in-memory? Влияет на UX демонстрации.
10. **Email/identity:** уровень маскирования и наличие любых PII в CRM (страна/локаль) требует подтверждения политики приватности.

---

## F0. Остаточные вопросы Phase 1 (не блокируют старт разработки)

Все 10 блокирующих вопросов Phase 0 **закрыты** (DECISIONS §сводка). Ниже — уточнения, которые можно решать параллельно с разработкой, не пересматривая фундамент:

1. **Точные пороги** `high_value_candidate` и `rapid_balance_decline` (dropPct/окно) — стартовые значения заданы в SIGNAL_CATALOG как предварительные; финализируются с продуктом.
2. **`advanced_learner`** — с какого уровня curriculum считать «advanced».
3. **Business calendar** для SLA (рабочие часы/праздники) — для production; в mock календарные часы.
4. **Communications initiation** — где проходит граница «CRM читает» vs «CRM инициирует» при интеграции (v1 — только чтение).
5. **Точное время авто-скрытия PII** (autoHideAt) и список reason codes.

Эти вопросы **не** блокируют Phase 1 (foundation/shell/mock provider/Today/Users/User 360), т.к. все значения конфигурируемы.

### F. (историческое) 10 блокирующих вопросов Phase 0 — ЗАКРЫТЫ

1. **Стек:** подтверждаете рекомендованный стек (Next.js App Router + TS strict + Tailwind + TanStack Table/Query + Zustand + Zod + Vitest/Playwright), или есть обязательные ограничения команды?
2. **Источник сигналов/lifecycle/recommendations:** CRM считает их сама на mock и в будущем, или это приходит готовым из продуктового API? (определяет domain-слой).
3. **Пороги сигналов:** дайте числовые определения ключевых сигналов (inactive 3/7/14/30 — по last meaningful action?; lesson_abandoned; communication_fatigue = N сообщений за M дней; frequent_redeposit_pattern; rapid_balance_decline = X% за Y часов).
4. **SLA-часы** для mentor review и support (и порог «SLA risk»).
5. **Grace-детали:** частота/источник проверок баланса и поведение при разрозненных подтверждениях/частичном восстановлении сверх правила «24ч + 2 подтверждения».
6. **Маскирование финансов:** нужные бакеты/формат для ролей без Exact financials (например `<$50 / $50–100 / $100–250 / …` или просто `funded/unfunded`).
7. **Ownership:** один owner на пользователя или мультиролевое владение одновременно?
8. **Персистентность демо:** mock-действия строго in-memory (сброс при перезагрузке) или нужна локальная персистентность для демонстраций?
9. **Curriculum > L100:** подтвердите политику checkpoint-сумм после уровня 100 (для advanced/completed персон и Progression-логики).
10. **Приватность/identity:** какой уровень маскирования email и какие поля (страна/локаль/refs) допустимы к отображению в CRM?

---

_Связано: все документы Phase 0. Реализация начинается только после утверждения этого блюпринта и ответов на блокирующие вопросы._
