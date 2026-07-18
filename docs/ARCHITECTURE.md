# ARCHITECTURE.md — Alfa Trade Academy CRM (Phase 1A)

Как устроено приложение и почему. Реализует границы, утверждённые в Phase 0/0.5.

## Слои и направление зависимостей

```
app/ (routes)  ─┐
components/     ├─►  application/  ─►  data/contracts (CrmDataProvider)
                │                          ▲
                └──────────────────────────┘ (через application, не напрямую)
                                    data/mock (MockCrmDataProvider) ─► реализует contract
domain/  ◄─ используется всеми слоями; сам НИ от кого не зависит (no React/Next)
```

Правила зависимостей:

- **domain/** — чистые типы и функции (enums, `UserStateProfile`, permissions, `toFinancialBucket`). Не импортирует React, Next или data-слой. Источник истины — документы Phase 0/0.5.
- **data/contracts/** — интерфейс `CrmDataProvider`, `Result<T>`, `Paginated<T>`, `CrmError`. Зависит только от domain.
- **data/mock/** — `MockCrmDataProvider` + synthetic fixtures. Реализует contract.
- **application/** — композиционный корень: внутренний `resolveProvider(state)` строит и кэширует провайдера по `env.CRM_MODE`; `getCrmDataProvider()` отдаёт read-интерфейс, `getCrmMutations()` — мутирующий, **оба сужают один и тот же закэшированный объект**; `contextFromSession()` строит `CrmContext`.
- **components/**, **app/** — UI. Получают данные только через application/provider, **никогда** не импортируют `data/mock/*` напрямую (запрещено ESLint-правилом `no-restricted-imports`).

## Provider boundary

Единственная граница между UI и данными — `CrmDataProvider` (14 read-операций, `docs/DATA_PROVIDER_CONTRACT.md`). Сейчас его реализует `MockCrmDataProvider`; позже — `ApiCrmDataProvider` с тем же интерфейсом. UI не переписывается при смене источника. Каждый результат — единый `Result<T>` со статусами `ok | loading | stale | empty | error`, `freshness` и дискриминированной ошибкой `CrmError`.

Живое доказательство границы — `ProviderSmoke` на экране Today: данные приходят строго через провайдер; loading/empty/error-состояния отрабатываются реально.

**Мутации — отдельный контракт** `CrmMutations` (Phase 1B4-A), тот же `Result<T>` / `CrmError`, без параллельной error system. `MockCrmDataProvider implements CrmDataProvider, CrmMutations` — без приведений типов. Реализованы ровно четыре мутации (`addNote`, `assignPrimaryOwner`, `setNotePinned`, `updateNoteBody`); методов-заглушек на будущее нет. См. `docs/MUTATION_OVERLAY.md`.

**Один инстанс на обе половины границы (Phase 1B4-B).** Провайдер владеет одним mutation-overlay
адаптером, создаваемым в конструкторе, поэтому `getCrmDataProvider()` и `getCrmMutations()` обязаны
возвращать **один и тот же** объект: второй инстанс был бы вторым адаптером над тем же storage, и
запись через один могла бы не читаться через другой — недетерминированно и только в браузере.
Аксессоры **сужают** общий `CrmDataProvider & CrmMutations`, а не приводят типы (`as unknown as`
компилировался бы и после того, как половины разошлись). Идентичность закреплена тестом
`src/application/provider.test.ts`.

**Единственный мутирующий экран — User 360** (Phase 1B4-B): секция «Заметки» читает `getUserNotes`
**отдельным** permission-aware вызовом (не через `getUser360` — D-58) и пишет через `addNote`.
После успеха выполняется refetch, а не optimistic insert: видимостью владеет projector, порядком —
провайдер (D-60). `CrmError.message` — диагностика для разработчика и в UI не рендерится (D-62).

## Permission boundary

Централизованный слой прав `domain/identity/` (`roles.ts`, `permissions.ts`, `access.ts`) — единственное место проверок. Хелперы: `canViewSection`, `canViewExactFinancials`, `canViewIdentity`, `canRevealPii`, `canAssignOwner`, `canExport`, `canViewAudit`, `canManageSettings`, `canEditUserNotes`. Соответствует `docs/ROLE_PERMISSION_MATRIX.md`.

**Мутационные права живут здесь же**, а не в провайдере: `canEditUserNotes` (Phase 1B4-A, D-53) — измерение Edit матрицы §1, суженное до заметок; `canAssignOwner` (существует с Phase 1A, потребитель появился в 1B4-C) — измерение Assign. Это **разные** измерения: `edit_user_notes` не выводится из видимости финансов и не переиспользует `assign_owner`, а `support` пишет заметки, но owner не назначает. Провайдер только вызывает хелпер; React решения о правах не получает (и списка ролей не держит — форму owner показывает единственный `canAssignOwner`).

Проверки не размазаны по JSX — компоненты вызывают хелперы (например, sidebar фильтрует разделы через `canViewSection`). **Это frontend-видимость, не production-безопасность** — реальный RBAC будет на backend (D-12).

## Route layout

- `app/layout.tsx` — корневой layout (html lang=ru, глобальные стили, `robots: noindex`).
- `app/page.tsx` — `/` → `redirect('/today')`.
- `app/login/page.tsx` — вход-заглушка (без реальной аутентификации), вне CRM shell.
- `app/(crm)/layout.tsx` — оборачивает разделы в `AppShell` (sidebar + topbar + content).
- `app/(crm)/{today,users,users/[id],segments,tasks,cases,mentor,support,financial,communications,automations,analytics,audit,settings}/page.tsx`.
- `app/(crm)/loading.tsx` — route-level skeleton.
- `app/error.tsx` — root error boundary; `app/not-found.tsx` — 404.

Разделы, не реализованные в Phase 1A, используют переиспользуемый `SectionPlaceholder` (без ложных данных и графиков).

## CRM shell

`AppShell` (client) владеет только локальным UI-состоянием (свёрнутость sidebar, мобильный drawer) — оно хранится в localStorage. Внутри: `SessionProvider` (mock-сессия + dev role switch), `TooltipProvider`, `Sidebar` (desktop), мобильный `Sheet`-drawer, `Topbar` (breadcrumbs, поиск-заглушка, DEMO MODE, role switch, уведомления-заглушка, employee menu) и `<main>` с skip-to-content.

## Дизайн-фундамент

Семантические CSS-переменные в `src/styles/tokens.css` (**provisional** — брендбук не подтверждён), маппятся в Tailwind через `hsl(var(--token) / <alpha-value>)`. Поддержаны светлая/тёмная системная тема, focus-visible, `prefers-reduced-motion`, плотные отступы. Никаких декоративных дашбордов — спокойный операционный вид.

## Почему нет базы данных

Самостоятельное приложение на mock-данных (DECISIONS D-09/D-12). Нет базы, Prisma, SQLite, настоящей аутентификации и API-интеграции. Данные — immutable synthetic fixtures за провайдером; подключение к реальному API — на следующих этапах, без изменения UI-контрактов. Это исключает любой риск для production Alfa Trade Academy.

Начиная с Phase 1B4-A мутации существуют (заметки; owner — 1B4-C; закрепление заметок — 1B4-D), но **persistence по-прежнему локальный**: versioned localStorage overlay (`ata-crm.mutation-overlay.v1`, схема расширена аддитивно в пределах v1 — owner- и pin-история выводятся из append-only `auditRecords`, отдельных структур нет), фикстуры неизменяемы, ничего не уходит за пределы вкладки. Backend не появился. См. `docs/MUTATION_OVERLAY.md`.

## Derivation layer (Phase 1B1)

Между fixtures и провайдером добавлен чистый доменный слой (framework-agnostic, инъекция `Clock`):

```
fixtures (MockUser[])
  → signals/engine.computeSignals(user, clock)        // 23 сигнала, suppression
  → priority/priority.computePriority(user, signals)  // полосы + правила
  → recommendations/derive.deriveRecommendations(...)  // объяснимые действия
  → today/builder.buildTodayWorkspace({users, clock, role, query})  // основания × секции
  → financial/projection + identity/identity-projection    // permission-aware
```

Всё детерминировано (`FixedMockClock`). Провайдер (`data/mock/MockCrmDataProvider`) — тонкая обёртка: фильтры/сортировка/пагинация + вызов derivation + проекции по роли. Пороги/лейблы/SLA живут в `src/config/*`. Правило безопасности: сортировка по точным финансам без права → `invalid_input`, чтобы порядок не утекал.

## Today: две оси вместо параллельных очередей (Phase 1B3)

Phase 1B1 моделировала «почему» как 13 очередей, в которых пользователь мог сидеть одновременно.
Это отвечает на «какая работа бывает», но не на «что открыть следующим». Phase 1B3 разводит оси:

```
BASIS   (почему)      TodayBasisCode   — те же 13 кодов; их может быть несколько; это же фильтр
SECTION (насколько срочно) TodaySectionKey — overdue → critical_now → today → watch; ровно одна
```

Предикаты членства Phase 1B1 сохранены (`BASIS_MEMBERSHIP`) и переосмыслены как основания.
Единственное место, где решается секция — `placeIn()`, поэтому пользователь не может попасть в две.
Ценностные сегменты (`new_funded_users`, `repeat_funders`) основанием **не являются** — они
описывают, кто пользователь, а не что нужно сделать (D-43); их обслуживает домен Segments.
Детали: `docs/TODAY_WORKSPACE.md`.

## Feature layer (Phase 1B2 — Users)

Экранная логика вынесена в `src/features/<feature>/` и общается с доменом **только** через `CrmDataProvider` (fixtures в компоненты не импортируются). `src/features/users/`:

```
users-workspace.tsx        # композиция: summary + toolbar + (states | table + pagination)
users-toolbar.tsx          # поиск (debounce, provider) + инлайн-фильтры + Sheet(mobile) + «Колонки»
users-filters.tsx          # 5 измерений (multi-select) + owner/priority/registrationStatus, chips
users-table.tsx            # TanStack Table (manualSorting/Pagination) + mobile-карточки
users-pagination.tsx       # 20/50, prev/next, диапазон
users-summary.tsx          # заголовок: всего/фильтров/freshness (без графиков/KPI)
users-states.tsx           # loading/empty/no-results/error/stale/unauthorized
hooks/use-users-query.ts   # состояние запроса к провайдеру (search/filters/sort/page)
hooks/use-column-visibility.ts   # видимость опциональных колонок (React state)
columns/columns.tsx        # ColumnDef[]: 9 дефолтных + 6 опциональных + действие
components/*                # ячейки: identity/priority/state-badges/blockers/financial/…
```

Разделение обязанностей: провайдер = данные/фильтр/сортировка/пагинация/проекции; feature = presentation + локальный UI-state (видимость колонок, ввод фильтров). Financial/identity-видимость **не** пересчитывается в компонентах — рендерится готовая provider-проекция (exact/bucket/aggregated/hidden vs masked/pseudonymous/hidden). Лейблы — из `config/labels.ts` (raw enum-коды в UI не появляются).

## Feature layer (Phase 1C — User 360, read-only)

`/users/[id]` — полноценный read-only экран. Ключевое архитектурное решение: **одна** read-операция
вместо композиции четырёх.

```
data/contracts/CrmDataProvider.getUser360(ctx, {userId}) → Result<User360>   # 14-я операция, read-only
  └─ MockCrmDataProvider: derive(signals/priority/recommendations) + freshness + slaState
       └─ domain/users/user-360-projection.projectUser360(...)   # ЕДИНСТВЕННОЕ место решений о правах
            → domain/users/user-360.User360                      # уже спроецированная read-модель
src/features/user-360/                                            # presentation + локальный UI-state
```

Почему агрегат, а не 4 вызова (`getUserById` + `getUserTimeline` + `getUserSignals` +
`getRecommendedActions`): `getUserById` возвращает `UserSummary` — плоскую list-проекцию с
`context: "list"` (identity всегда masked даже для admin), без learning/grace/SLA/сигналов/
рекомендаций/событий. Композиция дала бы четыре loading/error-состояния и, главное, **сборку прав в
UI**. Единый агрегат выполняет проекцию в провайдере **до** React, поэтому запрещённое значение
физически отсутствует в payload, DOM, props, `title`/`aria`, data-атрибутах и сериализованных данных
страницы — оно не «прячется CSS». Существующие 13 операций не менялись (D-35).

**Permission boundary в User 360** (D-36): identity — `projectIdentity(context: "detail")` (полный
email только ролям с `view_identity_full_email`); суммы — только `FinancialProjection`; плюс защита от
**арифметической** утечки: публичная сетка checkpoint + «осталось N%» позволяли восстановить точный
баланс, поэтому балансо-производные пояснения и `nextCheckpointRequiredUsd` скрываются вместе с
суммами. HIGH-события не отдаются ролям без exact-финансов.

### Canonical timeline projector (Phase 1C.1, D-39)

Событийная лента имеет **один** источник правды на оба провайдерских чтения:

```
domain/users/user-timeline.ts
  buildUserTimeline(user)                 # все события + sensitivity, детерминированно
  projectTimelineEvent(entry, role)       # ЕДИНСТВЕННОЕ решение о видимости события
  projectTimeline(entries, role)
  buildProjectedUserTimeline(user, role)  # ← getUserTimeline И getUser360
```

До этого у каждой операции была своя лента: `getUserTimeline` игнорировала контекст (`_ctx`) и
отдавала HIGH-события любой роли, а `getUser360` имела корректный гейт, но собственный набор событий,
заголовки, сортировку и дедупликацию — один пользователь давал разные события с разными правилами
приватности в зависимости от операции. Теперь permission-логика живёт только в projector; вызывающая
сторона может **сузить форму** (User 360 → `User360Event`), но не решает видимость.
Инвариант: событие никогда не содержит суммы (только факт и время), поэтому скрытое событие
невозможно восстановить.

### Единая семантика скрытых финансов (Phase 1C.1, D-40)

Все рендереры `FinancialProjection` (ячейка таблицы Users, блок «Финансы» User 360) читают
`hiddenReason` и единый источник текста `HIDDEN_LABEL` (`domain/financial/projection.ts`,
реэкспорт `FINANCIAL_HIDDEN_LABEL` в `config/labels.ts`): «Нет данных» ≠ «Недоступно для роли».
`label` самой проекции берётся оттуда же, поэтому read-модель не может противоречить экрану.

Структура: `user-360-workspace.tsx` (композиция + состояния), `user-360-states.tsx`,
`hooks/use-user-360-query.ts` (один read), `components/*` (header, identity-summary, attention-panel,
recommendations, state-overview, blockers, signals, learning-progress, activity-timeline,
financial-summary, owner-context, section-card). DOM-порядок = порядок чтения = mobile-порядок;
на `lg+` контекст (финансы + ответственный) становится sticky-колонкой.

## Feature layer (Phase 1B3 — Today, read-only)

```
src/domain/today/
  today.ts            # permission-projected read model (как user-360.ts)
  today-query.ts      # фильтры + сортировка; семантика принадлежит домену, не React
  builder.ts          # derive → bases → membership → place → sort → PROJECT → filter → summarize
src/features/today/
  today-workspace.tsx today-states.tsx
  hooks/use-today-query.ts
  model/filter-defs.ts    # опции строятся из TodayFilterOptions провайдера, не хардкодятся
  components/         # header, summary, toolbar, filters, queue-section, queue-item,
                      # mobile-card, priority, identity, reason, next-step, due-chip,
                      # activity, balance, freshness
```

Порядок в builder'е нагружен смыслом: **проекция идёт до фильтрации**, поэтому поиск может
совпасть только с identity, которую роль вправе видеть (§24), а summary считает ровно те строки,
на которые смотрит пользователь. `getTodayWorkspace` — единственная read-операция экрана.

### Общее правило балансо-производной редакции (Phase 1B3, D-46)

`FINANCIALLY_DERIVED_SIGNALS` вынесен из `user-360-projection.ts` в
`domain/financial/financially-derived.ts` и используется Today и User 360. Две поверхности с
личными копиями списка — это то, как редакция расходится молча: сигнал, добавленный в один
список и не добавленный в другой, был бы скрыт в профиле и раскрыт в очереди.

## Тестирование

- **Unit/компонентные (Vitest):** permission matrix, section visibility, финансовые бакеты, provider error handling, sidebar active state, breadcrumbs, роль-видимость sidebar (render).
- **E2E (Playwright, smoke):** `/today` грузится, sidebar доступен, переход в `/users`, dev role switch меняет видимость, 404, отсутствие console-ошибок.
- **E2E (Playwright, screenshots — Phase 1B2):** `tests-e2e/users-screenshots.spec.ts` — реальный рендер `/users` в 5 сценариях (admin/support/filtered 1440×900, tablet 1024×768, mobile 390×844), точные размеры + assert чистой консоли. Артефакты — `screenshots/phase-1b2-users/`.
- **Component (Vitest, Phase 1B2):** `use-users-query` (search/5 измерений/compound/registration/sort/pagination), `users-workspace` (рендер + состояния + отсутствие raw-кодов), `users-permissions` (exact отсутствует в DOM у support; masked identity).
- **Provider/projection + component (Vitest, Phase 1C):** `user-360-projection` (25 — контракт результата, детерминизм, все 9 ролей, невозможность реконструкции баланса, «нет данных» vs «нет прав»), `user-360-permissions` (12 — для каждой роли разрешённое присутствует / запрещённое отсутствует в `innerHTML`), `user-360-workspace` (19 — один h1, секции, независимость осей, отсутствие тройного дублирования и mutation-контролов, loading/not-found/unauthorized/error+retry/stale, keyboard).
- **E2E (Playwright, Phase 1C):** `tests-e2e/user-360.spec.ts` — 13 сценариев (admin/support/high-priority/calm/onboarding 1440×900, tablet 1024×768, mobile 390×844 с замером порядка блоков, 200% zoom = CSS-viewport 720×450, unknown id, навигация `/users → профиль → назад`, keyboard focus, analyst, read_only). Артефакты — `screenshots/phase-1c-user-360/{first-pass,final}/`.
- **Domain/provider + component (Vitest, Phase 1B3):** `today/builder` (61 — членство, canonical placement, детерминизм сортировки, «один факт один раз», окно, freshness, все 9 ролей), `today/today-privacy` (53 — точные суммы/проценты/identity для каждой роли), `data/mock/today-provider` (11 — конверт результата, режимы, read-only), `today-workspace` (17 — один h1, порядок секций, причина, рекомендация, фильтры/сортировка, три разных empty-состояния, loading/error/stale), `today-permissions` (24 — запрещённое отсутствует в `innerHTML`/атрибутах, поиск только по разрешённой проекции), `config/evidence-labels` (11 — полнота карты, безопасный fallback), `user-timeline` (+17 — from/to).
- **E2E (Playwright, Phase 1B3):** `tests-e2e/today-screenshots.spec.ts` — 11 сценариев (admin/support/retention/high-priority/filtered/empty/stale 1440×900, tablet 1024×768, mobile 390×844, mobile filter sheet, 200% zoom = 720×450). Артефакты — `screenshots/phase-1b3-today/{first-pass,final}/`.
- **Domain/provider (Vitest, Phase 1B4-A):** `note-projection` (15 — team/private/role_restricted для всех 9 ролей, fail-closed, сортировка, нормализация тела), `overlay/mutation-overlay` (23 — ключ, fail-closed parse: corrupt/unknown version/invalid shape, пересоздание адаптера, отказ записи, fingerprint), `add-note` (66 — валидация, все 9 ролей, идемпотентность и conflict, детерминизм id/timestamp, персистентный sequence, неизменяемость фикстур, AuditRecord без тела), `notes-privacy` (18 — зависимость от ctx, скрытые вне `total`, отсутствие плейсхолдера и утечки тела, порядок), `access` (+8 — `canEditUserNotes` по матрице).
- **Domain/provider/UI (Vitest, Phase 1B4-C):** `overlay/overlay-backcompat` (20 — raw overlay 1B4-B парсится без потерь, legacy+owner сосуществуют, fail-closed на битой owner-записи/receipt/version), `identity/employees` (13 — directory ↔ фикстуры ↔ derived-списки, unknown id не печатается), `assign-owner` (62 — assign/unassign, все 9 ролей, валидация кандидата, идемпотентность/conflict/expectedOwner, storage failure, неизменяемость фикстур, audit без PII), `owner-consistency` (13 — один owner во всех reads, derived-cache не скрывает изменение, автор заметки заморожен), `owner-assignment` UI (57 — 9 ролей, 6 состояний, refetch, conflict, role change, safe errors, a11y), + notes-regression (сброс ключа при смене роли).
- **Итого:** unit/компонентные — **799**, E2E — **85** (прежние 633 unit и 59 E2E сохранены; ни один suite не заменён, ослаблений нет — расширены лишь ставшие неоднозначными локаторы/сканеры).

### Mutation layer (Phase 1B4-A)

```
domain/notes/       note.ts (модель + нормализация) · note-projection.ts (единое правило приватности)
domain/audit/       audit.ts (AuditRecord, без тела заметки)
data/contracts/     CrmMutations.ts (addNote)
data/mock/overlay/  storage.ts (KeyValueStorage/Memory) · mutation-overlay.ts (схема+parse+store) · fingerprint.ts
```

Направление зависимостей не нарушено: `domain/notes` и `domain/audit` не знают ни про React, ни про storage; overlay-адаптер живёт в `data/mock` и внедряется в провайдер через опции. `CrmNote` определён в домене и ре-экспортируется контрактом — как `TodayWorkspace` (D-50) и `User360` (D-35), поэтому второго несовместимого типа заметки не существует.

**Регрессия доказана подменой:** projector «всё видно» роняет 15 тестов, permission-правило «всем можно» — 20.

### Mutation layer (Phase 1B4-C — owner assignment)

Вторая мутация — `assignPrimaryOwner` — легла на ту же инфраструктуру **аддитивно**:

```
domain/identity/    employees.ts (canonical employee directory: id, displayName, primaryOwnerCandidate)
domain/audit/       audit.ts (AuditRecord → discriminated union по action; owner-запись с previous/next)
data/contracts/     CrmMutations.ts (+assignPrimaryOwner) · CrmDataProvider.ts (+getPrimaryOwnerCandidates)
data/mock/overlay/  mutation-overlay.ts (guard'ы приняли owner-action/receipt; схема не менялась) · fingerprint.ts (+owner)
features/user-360/  components/owner-assign-form.tsx · hooks/use-assign-owner.ts · hooks/use-owner-candidates.ts · lib/owner-error.ts
```

- **Overlay расширен в пределах v1** (D-64): тот же ключ и `version`, история owner — записи
  `primary_owner_changed` в `auditRecords` (D-65), отдельной структуры нет. Fail-closed сохранён:
  приняты по одному новому допустимому значению action/entityType/reasonCode/receipt-kind, всё прочее
  по-прежнему роняет overlay целиком. Regression-тест собирает raw overlay 1B4-B вручную и доказывает,
  что заметки и owner-change сосуществуют.
- **Один effective-owner resolver** в провайдере (D-70): baseline fixture, перекрытый последней
  owner-записью; fixtures неизменяемы (мелкий клон, `defaultDataset` мемоизирован и общий для инстансов).
  Все reads (User 360 / Users / Today / task-case / queue) берут owner отсюда — расходиться неоткуда
  (тот же инвариант, что D-39/D-40 закрыли для timeline и финансов). Derived-cache сверяет owner и
  инвалидируется при расхождении, в т.ч. когда overlay записан другим инстансом над тем же storage.
- **Права не расширены** (D-69): `assign_owner` существовал с Phase 1A; owner-мутация — его первый
  потребитель. `canAssignOwner` и `canEditUserNotes` — разные измерения; `support` пишет заметки, owner
  не назначает. Автор засеянной заметки заморожен по baseline (D-71): переназначение не переписывает
  авторство. Соседний дефект `useAddNote` (attempt не сбрасывался при смене роли) исправлен.
- **Регрессия доказана подменой:** `canAssignOwner` → «всем можно» роняет owner permission-тесты
  (по всем 9 ролям, сверка с `CRM_ROLES`).

### Mutation layer (Phase 1B4-D — note pin/unpin)

Третья мутация — `setNotePinned` — легла на ту же инфраструктуру **аддитивно**:

```
domain/audit/       audit.ts (+NotePinChangedAuditRecord: третий член union, previous/nextPinned)
domain/notes/       note-projection.ts (+resolveEffectivePins: единый резолвер effective pinned)
data/contracts/     CrmMutations.ts (+setNotePinned)
data/mock/overlay/  mutation-overlay.ts (+note_pin_changed action, +note_pin_change receipt-kind) · fingerprint.ts (+setNotePinned)
features/user-360/  components/user-notes.tsx (pin-контрол) · hooks/use-set-note-pinned.ts · lib/note-pin-error.ts
```

- **Overlay расширен в пределах v1** (D-64/D-77): тот же ключ и `version`, effective pinned выводится из
  записей `note_pin_changed` в `auditRecords`, отдельного `notePins[]` нет. Fail-closed сохранён; приняты
  по одному новому значению action/reasonCode/receipt-kind. Regression: raw 1B4-B и 1B4-C overlay читаются
  без потерь, pin сосуществует с заметками и owner-историей.
- **Один effective-pin resolver** `resolveEffectivePins` (D-77): базовый `note.pinned` ⊕ последняя
  `note_pin_changed` для `note.id` (по `at`, затем по audit id), применяется ДО `sortNotes`. Ни fixture,
  ни overlay-заметка не мутируются. Единственный источник pinned во всех note-reads.
- **Права не расширены** (D-75): pin — часть `edit_user_notes`; те же четыре роли, что и `addNote`.
  Любая видимая заметка pinnable; скрытая → `not_found` через тот же canonical projector (D-76) — API не
  зонд. UI без optimistic update — refetch `getUserNotes` (D-79); фокус возвращается на контрол той же
  заметки после reorder (D-81). Pin не влияет на Today/Users/priority/SLA/owner/tasks/cases (D-80).

### Mutation layer (Phase 1B4-E — note body edit)

Четвёртая мутация — `updateNoteBody` — легла на ту же инфраструктуру **аддитивно**:

```
domain/audit/       audit.ts (+NoteBodyChangedAuditRecord: четвёртый член union, только базовые поля)
data/contracts/     CrmMutations.ts (+updateNoteBody) · CrmDataProvider.ts (+getUserNotesView, CrmNoteListItem.canEditBody)
data/mock/overlay/  mutation-overlay.ts (+note_body_changed action, +note_body_change receipt-kind) · fingerprint.ts (+updateNoteBody)
features/user-360/  components/user-notes.tsx (inline-редактор) · hooks/use-update-note-body.ts · hooks/use-user-notes.ts (→getUserNotesView) · lib/note-edit-error.ts
```

- **Единственная мутация, переписывающая `notes[]` на месте** (тело нельзя честно вывести из append-only
  лога и оно не должно попасть в audit): тот же id/createdAt/author/visibility/baseline pinned, меняются
  только `body`+`updatedAt` (= mutation-timestamp = `audit.at`, D-83). Overlay в пределах v1; regression:
  raw 1B4-B/1B4-C/1B4-D overlay читаются без потерь, body-edit сосуществует с owner/pin-историей.
- **PII-безопасность** (D-84): `UpdateNoteBodyResult` без `CrmNote`/тела (после повторной правки старое тело
  не реконструируемо — возвращаем только id + timestamp); audit `note_body_changed` — только факт; receipt
  без тела/фрагмента/длины; fingerprint по нормализованному телу, но хранит лишь хеш (crypto нет).
- **Права не расширены, но строже** (D-82): `edit_user_notes` + **только автор своей overlay-заметки**;
  фикстурная неизменна (видимая non-overlay → `invalid_input`, не `not_found`). Возможность отдаётся
  провайдером через `getUserNotesView.capabilities.canEditBody` — React не разбирает id заметки.
- **Конкуренция `expectedUpdatedAt`** (D-83); UI без optimistic — refetch `getUserNotesView` (D-85);
  Escape отменяет, фокус возвращается на «Изменить»; storage-fail держит черновик, retry тем же ключом.

### Phase 1B5-B — Global Audit Workspace (read-only)

```
domain/audit/       audit-view.ts (AuditRecordView — safe discriminated union; sortAuditRecords + projectAuditRecords)
data/contracts/     CrmDataProvider.ts (+getAuditRecords, GetAuditRecordsInput; ре-экспорт AuditRecordView)
data/mock/          MockCrmDataProvider.ts (+getAuditRecords: canViewAudit → read → project → sort → paginate)
config/             labels.ts (+AUDIT_LABEL, auditRowText, UNKNOWN_USER_LABEL)
features/audit/     audit-workspace.tsx · audit-ledger.tsx · audit-states.tsx · audit-pagination.tsx · hooks/use-audit-query.ts
app/(crm)/audit/    page.tsx (заменил SectionPlaceholder на AuditWorkspace)
```

- **Только новый reader** существующих `auditRecords`: storage key/`version`/структура overlay/guards/
  receipts/sequence/owner-pin resolvers не тронуты, лог append-only. `CrmMutations` неизменен.
- **Safe read-model** (D-87): UI получает не сырой `AuditRecord`, а provider-owned `AuditRecordView` —
  только резолвнутые имена, `at`, direction pin (`pinned`), owner before/after имена; никаких raw id,
  тела/фрагмента, PII, финансов, idempotency key, reasonCode, storage diagnostics. `id` — только React
  key и tie-break. Canonical `sortAuditRecords` (`at` DESC → `id` DESC) на копии, без мутации массива.
- **Единственный data-gate — `canViewAudit`** (D-86): данные у crm_admin/crm_manager; проверка ПЕРВОЙ, до
  чтения overlay. Семь section-visible ролей видят пункт навигации; пять Limited → restricted-state.
- **Fail-closed** (D-88): corrupt overlay → empty-state; storage failure (`gate`/errorMode) → локализованный
  error с retry, raw diagnostics в DOM не попадают. Один h1, реальный 200% reflow, zero horizontal overflow.
- **Направление зависимостей не нарушено:** `domain/audit/audit-view` не знает про React/storage/fixtures —
  резолверы имён внедряются провайдером (из `ownerLabel` и dataset). `config/labels` зависит от домена.

### Phase 1B5-C — User 360 Note Visibility Change

```
domain/audit/       audit.ts (+NoteVisibilityChangedAuditRecord: пятый член union, previous/nextVisibility ∈ {team,private})
                    audit-view.ts (+note_visibility_changed — базовые поля, направление НЕ проецируется)
data/contracts/     CrmMutations.ts (+setNoteVisibility) · CrmDataProvider.ts (+CrmNoteListItem.canChangeVisibility)
data/mock/overlay/  mutation-overlay.ts (+note_visibility_changed action, +note_visibility_change receipt-kind, isWritableVisibility guard) · fingerprint.ts (+setNoteVisibility)
data/mock/          MockCrmDataProvider.ts (+setNoteVisibility; getUserNotesView отдаёт canChangeVisibility)
config/             labels.ts (+NOTE_VISIBILITY_EDIT_LABEL, +auditRowText note_visibility_changed; private → «Приватная заметка»)
features/user-360/  components/user-notes.tsx (inline visibility-editor; один редактор на строку) · hooks/use-set-note-visibility.ts · lib/note-visibility-error.ts
```

- **Как `updateNoteBody`** (D-93): переписывает authored-заметку в `notes[]` на месте — тот же
  id/createdAt/author/userId/body/baseline pinned, меняются только `visibility`+`updatedAt`
  (= mutation-timestamp = `audit.at`, D-83). Overlay в пределах v1; regression: raw 1B4-B…1B5-B overlay
  читается без потерь, visibility-запись сосуществует с owner/pin/body-историей.
- **role_restricted не writable** (D-91): команда и guard fail-closed на нём и на неизвестных значениях.
- **Private — по identity, не по роли** (D-92): `canViewNote` сверяет `authorEmployeeId === actorId`;
  смена роли при том же actorId не скрывает свою private-заметку; foreign (включая admin) не видит.
  Возможность — `getUserNotesView.capabilities.canChangeVisibility` (те же 4 условия, что `canEditBody`).
- **Global audit fact-only** (D-94): `AuditRecordView` для `note_visibility_changed` несёт только базовые
  поля — направление team/private не раскрывается; `/audit` рендерит «изменил доступ к заметке» без изменений.
- **UI**: один inline-editor на строку (body XOR visibility, контролы скрыты при открытом редакторе, draft не
  теряется молча); контрол-«щит» отличается от pencil/pin; реальный 200% reflow, zero overflow.
- **Направление зависимостей не нарушено:** `domain` не знает про React/storage; `config/labels` зависит от домена.

### Phase 1B6 — User 360 Note Delete

```
domain/audit/       audit.ts (+NoteDeletedAuditRecord: шестой член union, базовые поля)
                    audit-view.ts (+note_deleted — базовые поля, ни тела, ни id)
domain/notes/       note-projection.ts (+hideDeletedNotes — скрывает note с валидным поздним note_deleted)
data/contracts/     CrmMutations.ts (+deleteNote, DeleteNoteCommand/Result) · CrmDataProvider.ts (+CrmNoteListItem.canDelete)
data/mock/overlay/  mutation-overlay.ts (+note_deleted action guard, +note_delete receipt-kind) · fingerprint.ts (+fingerprintDeleteNote)
data/mock/          MockCrmDataProvider.ts (+deleteNote; orderedVisibleNotes → hideDeletedNotes; getUserNotesView отдаёт canDelete; addNote replay реконструирует после удаления)
config/             labels.ts (+NOTE_DELETE_LABEL, +auditRowText note_deleted)
features/user-360/  components/user-notes.tsx (inline delete-confirm; один active mode на строку; post-delete focus) · components/note-composer.tsx (inputRef для focus-цели) · hooks/use-delete-note.ts · lib/note-delete-error.ts
```

- **Hard delete + append-only audit** (D-96/D-97): `deleteNote` физически убирает row из overlay `notes[]`
  (единственная мутация, удаляющая заметку), tombstone/тело не остаётся, undo нет; `note_deleted` audit —
  защитный источник истины. `hideDeletedNotes` выполняется ПЕРВОЙ в `orderedVisibleNotes` (до pin-resolve/
  projectNotes/sort), поэтому удалённая заметка вне `items` и `page.total`; latest-by-`at`-then-`id`, скрывает
  только если delete `at` ≥ note `updatedAt` (stale/corrupt не скрывает; структурно битая валит парс fail-closed).
- **Replay ДО entity-lookup** (D-98): idempotency-replay разрешается до user/note lookup — иначе retry после
  успешного удаления вернул бы `not_found`. Fingerprint `[userId, actorId, role, noteId]`, без `expectedUpdatedAt`.
- **Add-replay после удаления не воскрешает** (D-98): узкая lifecycle-ветка `addNote` реконструирует `CrmNote`
  из audit + payload (тело гарантированно то же по fingerprint), НЕ записывая row обратно; тело не в receipt/audit.
- **Author-only** (D-96): только автор своей overlay-заметки; фикстурная → `invalid_input`, чужая видимая →
  `unauthorized`, скрытая/неизвестная → `not_found`. Возможность — `getUserNotesView.capabilities.canDelete`.
- **Global audit fact-only** (D-99): `AuditRecordView` для `note_deleted` — только базовые поля; `/audit` рендерит
  «удалил заметку у …», без тела/visibility/pin/id.
- **UI**: provider-owned `canDelete`; Trash-контрол нейтрален в idle, destructive-тон только в inline confirm;
  один active mode на строку; post-delete focus → composer (иначе безопасный section-target); zero overflow.
- **Направление зависимостей не нарушено:** `domain` не знает про React/storage; `config/labels` зависит от домена.
