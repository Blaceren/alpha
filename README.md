# Alfa Trade Academy CRM

Отдельное внутреннее приложение для команды Alfa Trade Academy (retention, mentoring, support, operations). **Полностью самостоятельный проект.** На текущем этапе — только synthetic/mock data, без backend, базы данных, Pocket и production-интеграции.

> **DEMO / MOCK MODE.** Приложение не подключается к production Alfa Trade Academy. Переключатель роли и «вход» — демонстрационные и **не являются production-безопасностью**.

Статус реализации: **Phase 1C — User 360 (read-only)** поверх Phase 1B2 Users workspace и Phase 1B1 mock-домена.

- `/users` — полноценный реестр (TanStack Table: поиск/5 измерений/compound-фильтры/сортировка/пагинация, permission-safe финансы и identity, состояния loading/empty/no-results/error/stale/unauthorized, responsive). См. `docs/USERS_WORKSPACE.md`.
- `/users/[id]` — полноценная **read-only** карточка User 360: приоритет и причина внимания, рекомендуемое действие, 5 независимых осей состояния, обучение, блокеры, сигналы, недавние события, ответственный, permission-aware identity и финансы. См. `docs/USER_360.md`.

Данные — только через `CrmDataProvider`; вся permission-проекция выполняется в провайдере **до** React.

**Последовательность этапов (D-34):** следующим этапом намеренно выбран User 360 — каноническое название **Phase 1C — User 360** (не «Phase 1B3»). **Phase 1B3 — Today Workspace** и **Phase 1B4 — mutations overlay** **отложены** до отдельного решения и **не выполнены**. Экран User 360 — read-only: мутаций нет. Следующий этап не начинается автоматически. См. `docs/IMPLEMENTATION_STATUS.md`.

## Стек

Next.js 14.2.35 (App Router) · TypeScript strict · Tailwind CSS · Radix UI · TanStack Table · Zod · React Hook Form · Vitest + Testing Library · Playwright. Без базы данных, Prisma и настоящей аутентификации (см. `docs/DECISIONS.md` D-03/D-18).

## Запуск

```bash
npm install
npm run dev        # http://localhost:3000  (открывает /today)
```

Опциональная конфигурация — скопируйте `.env.example` в `.env.local`. Реальных секретов в проекте нет.

```
NEXT_PUBLIC_CRM_MODE=mock              # единственный режим в Phase 1A
NEXT_PUBLIC_ENABLE_ROLE_SWITCH=true    # dev-only переключатель роли
```

## Команды

| Скрипт | Назначение |
|---|---|
| `npm run dev` | Локальный dev-сервер (mock mode). |
| `npm run build` | Production-сборка Next.js. |
| `npm run start` | Запуск собранного приложения. |
| `npm run lint` | ESLint (включая запрет прямого импорта mock-фикстур в UI). |
| `npm run typecheck` | `tsc --noEmit` (strict). |
| `npm run test` | Vitest в watch-режиме. |
| `npm run test:run` | Vitest один прогон (unit + компонентные). |
| `npm run test:e2e` | Playwright smoke (нужен установленный браузер: `npx playwright install chromium`). |

## Mock mode и demo-переключатель роли

- Все данные — синтетические (`src/data/mock/`), доступ **только** через `CrmDataProvider`. UI/компоненты не импортируют фикстуры напрямую (проверяется ESLint).
- В dev-режиме в топбаре есть переключатель роли (9 ролей). Он меняет **видимость интерфейса** для проверки прав и **не является production RBAC**. Рядом всегда виден бейдж **DEMO MODE**.
- Настоящая аутентификация и авторизация появятся при интеграции с backend (`docs/FUTURE_INTEGRATION.md`).

## Отсутствие production-интеграции

Проект не открывает и не меняет основной сайт Alfa Trade Academy, его backend, production-базу, Prisma-схему или Pocket. Никаких реальных пользовательских данных, Pocket payload, секретов или deploy. Интеграция позже — через отдельный защищённый API, без переписывания UI.

## Структура проекта

```
src/
  app/                 # Next.js App Router (routes)
    (crm)/             # разделы внутри CRM shell
    login/  page.tsx  error.tsx  not-found.tsx
  components/
    crm-shell/         # AppShell, sidebar, topbar, session, role switch
    navigation/        # sidebar-nav, breadcrumbs, section-placeholder
    ui/                # Button, Badge, Avatar, Tooltip, Dialog, Sheet, Skeleton…
    states/            # empty / error / stale-data
  domain/              # framework-agnostic контракты (НЕ импортируют React/Next)
    identity/  lifecycle/  signals/  financial/  tasks/  cases/  users/  shared/
  application/         # provider factory + context (boundary к данным)
  data/
    contracts/         # CrmDataProvider + Result/Paginated/CrmError
    mock/              # MockCrmDataProvider + synthetic fixtures
  config/              # env-валидация, навигация
  lib/  styles/  test/
docs/                  # блюпринты Phase 0/0.5 + ARCHITECTURE / IMPLEMENTATION_STATUS
tests-e2e/             # Playwright smoke
```

Подробнее — `docs/ARCHITECTURE.md`.

## Отсутствие мутаций (Phase 1C)

User 360 — **только чтение**. Редактирование пользователя, notes/tasks/cases, смена owner/статуса, ручное закрытие сигналов, финансовые операции и коммуникации **не реализованы**; действия, которые их потребовали бы, либо отсутствуют, либо явно помечены «Только просмотр» с честным объяснением. Fake success не создаётся. Права принадлежат провайдеру, а не компонентам.
