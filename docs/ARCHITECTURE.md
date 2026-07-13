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

## Тестирование

- **Unit/компонентные (Vitest):** permission matrix, section visibility, финансовые бакеты, provider error handling, sidebar active state, breadcrumbs, роль-видимость sidebar (render).
- **E2E (Playwright, smoke):** `/today` грузится, sidebar доступен, переход в `/users`, dev role switch меняет видимость, 404, отсутствие console-ошибок.
