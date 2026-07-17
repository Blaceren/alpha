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

**Мутации — отдельный контракт** `CrmMutations` (Phase 1B4-A), тот же `Result<T>` / `CrmError`, без параллельной error system. `MockCrmDataProvider implements CrmDataProvider, CrmMutations` — без приведений типов. Реализована ровно одна мутация (`addNote`); методов-заглушек на будущее нет. См. `docs/MUTATION_OVERLAY.md`.

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

**Мутационные права живут здесь же**, а не в провайдере: `canEditUserNotes` (Phase 1B4-A, D-53) — измерение Edit матрицы §1, суженное до заметок. Право не выводится из видимости финансов и не переиспользует `assign_owner` — это другие измерения. Провайдер только вызывает хелпер; React решения о правах не получает.

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

Начиная с Phase 1B4-A мутации существуют, но **persistence по-прежнему локальный**: versioned localStorage overlay (`ata-crm.mutation-overlay.v1`), фикстуры неизменяемы, ничего не уходит за пределы вкладки. Backend не появился. См. `docs/MUTATION_OVERLAY.md`.

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
- **Итого:** unit/компонентные — **569**, E2E — **41** (прежние 439 unit и все 41 E2E сохранены; ни один suite не заменён). Phase 1B4-A не добавляла E2E: UI не менялся.

### Mutation layer (Phase 1B4-A)

```
domain/notes/       note.ts (модель + нормализация) · note-projection.ts (единое правило приватности)
domain/audit/       audit.ts (AuditRecord, без тела заметки)
data/contracts/     CrmMutations.ts (addNote)
data/mock/overlay/  storage.ts (KeyValueStorage/Memory) · mutation-overlay.ts (схема+parse+store) · fingerprint.ts
```

Направление зависимостей не нарушено: `domain/notes` и `domain/audit` не знают ни про React, ни про storage; overlay-адаптер живёт в `data/mock` и внедряется в провайдер через опции. `CrmNote` определён в домене и ре-экспортируется контрактом — как `TodayWorkspace` (D-50) и `User360` (D-35), поэтому второго несовместимого типа заметки не существует.

**Регрессия доказана подменой:** projector «всё видно» роняет 15 тестов, permission-правило «всем можно» — 20.
