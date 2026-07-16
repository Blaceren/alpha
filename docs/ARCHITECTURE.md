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
- **application/** — композиционный корень: `getCrmDataProvider()` выбирает провайдера по `env.CRM_MODE`; `contextFromSession()` строит `CrmContext`.
- **components/**, **app/** — UI. Получают данные только через application/provider, **никогда** не импортируют `data/mock/*` напрямую (запрещено ESLint-правилом `no-restricted-imports`).

## Provider boundary

Единственная граница между UI и данными — `CrmDataProvider` (13 операций, `docs/DATA_PROVIDER_CONTRACT.md`). Сейчас его реализует `MockCrmDataProvider`; позже — `ApiCrmDataProvider` с тем же интерфейсом. UI не переписывается при смене источника. Каждый результат — единый `Result<T>` со статусами `ok | loading | stale | empty | error`, `freshness` и дискриминированной ошибкой `CrmError`.

Живое доказательство границы — `ProviderSmoke` на экране Today: данные приходят строго через провайдер; loading/empty/error-состояния отрабатываются реально.

## Permission boundary

Централизованный слой прав `domain/identity/` (`roles.ts`, `permissions.ts`, `access.ts`) — единственное место проверок. Хелперы: `canViewSection`, `canViewExactFinancials`, `canViewIdentity`, `canRevealPii`, `canAssignOwner`, `canExport`, `canViewAudit`, `canManageSettings`. Соответствует `docs/ROLE_PERMISSION_MATRIX.md`.

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

Phase 1A — самостоятельное приложение на mock-данных (DECISIONS D-09/D-12). Нет базы, Prisma, SQLite, настоящей аутентификации и API-интеграции. Данные — immutable synthetic fixtures за провайдером; будущий localStorage mutation overlay и подключение к реальному API — на следующих этапах, без изменения UI-контрактов. Это исключает любой риск для production Alfa Trade Academy.

## Derivation layer (Phase 1B1)

Между fixtures и провайдером добавлен чистый доменный слой (framework-agnostic, инъекция `Clock`):

```
fixtures (MockUser[])
  → signals/engine.computeSignals(user, clock)        // 23 сигнала, suppression
  → priority/priority.computePriority(user, signals)  // полосы + правила
  → recommendations/derive.deriveRecommendations(...)  // объяснимые действия
  → today/builder.buildTodayWorkspace(users, clock, role)  // 12 очередей + dedup
  → financial/projection + identity/identity-projection    // permission-aware
```

Всё детерминировано (`FixedMockClock`). Провайдер (`data/mock/MockCrmDataProvider`) — тонкая обёртка: фильтры/сортировка/пагинация + вызов derivation + проекции по роли. Пороги/лейблы/SLA живут в `src/config/*`. Правило безопасности: сортировка по точным финансам без права → `invalid_input`, чтобы порядок не утекал.

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

Структура: `user-360-workspace.tsx` (композиция + состояния), `user-360-states.tsx`,
`hooks/use-user-360-query.ts` (один read), `components/*` (header, identity-summary, attention-panel,
recommendations, state-overview, blockers, signals, learning-progress, activity-timeline,
financial-summary, owner-context, section-card). DOM-порядок = порядок чтения = mobile-порядок;
на `lg+` контекст (финансы + ответственный) становится sticky-колонкой.

## Тестирование

- **Unit/компонентные (Vitest):** permission matrix, section visibility, финансовые бакеты, provider error handling, sidebar active state, breadcrumbs, роль-видимость sidebar (render).
- **E2E (Playwright, smoke):** `/today` грузится, sidebar доступен, переход в `/users`, dev role switch меняет видимость, 404, отсутствие console-ошибок.
- **E2E (Playwright, screenshots — Phase 1B2):** `tests-e2e/users-screenshots.spec.ts` — реальный рендер `/users` в 5 сценариях (admin/support/filtered 1440×900, tablet 1024×768, mobile 390×844), точные размеры + assert чистой консоли. Артефакты — `screenshots/phase-1b2-users/`.
- **Component (Vitest, Phase 1B2):** `use-users-query` (search/5 измерений/compound/registration/sort/pagination), `users-workspace` (рендер + состояния + отсутствие raw-кодов), `users-permissions` (exact отсутствует в DOM у support; masked identity).
- **Provider/projection + component (Vitest, Phase 1C):** `user-360-projection` (25 — контракт результата, детерминизм, все 9 ролей, невозможность реконструкции баланса, «нет данных» vs «нет прав»), `user-360-permissions` (12 — для каждой роли разрешённое присутствует / запрещённое отсутствует в `innerHTML`), `user-360-workspace` (19 — один h1, секции, независимость осей, отсутствие тройного дублирования и mutation-контролов, loading/not-found/unauthorized/error+retry/stale, keyboard).
- **E2E (Playwright, Phase 1C):** `tests-e2e/user-360.spec.ts` — 13 сценариев (admin/support/high-priority/calm/onboarding 1440×900, tablet 1024×768, mobile 390×844 с замером порядка блоков, 200% zoom = CSS-viewport 720×450, unknown id, навигация `/users → профиль → назад`, keyboard focus, analyst, read_only). Артефакты — `screenshots/phase-1c-user-360/{first-pass,final}/`. Итого E2E — **26** (прежние 13 сохранены).
