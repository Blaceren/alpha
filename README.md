# Alfa Trade Academy CRM

Отдельное внутреннее приложение для команды Alfa Trade Academy (retention, mentoring, support, operations). **Полностью самостоятельный проект.** На текущем этапе — только synthetic/mock data, без backend, базы данных, Pocket и production-интеграции.

> **DEMO / MOCK MODE.** Приложение не подключается к production Alfa Trade Academy. Переключатель роли и «вход» — демонстрационные и **не являются production-безопасностью**.

Статус реализации: **Phase 1B4-C — Primary Owner Assignment** поверх Phase 1B4-B (Notes UI), Phase 1B4-A (mutation core), Phase 1B3 Today Workspace, Phase 1C User 360, Phase 1B2 Users workspace и Phase 1B1 mock-домена.

- `/today` — полноценный **read-only** операционный центр смены: очередь внимания с конкретным доменным основанием у каждой строки, 4 секции по срочности с canonical placement, детерминированная сортировка, рекомендация, ответственный, SLA, фильтры/поиск по разрешённой проекции, состояния loading/empty/error/stale, desktop/tablet/mobile. См. `docs/TODAY_WORKSPACE.md`.
- `/users` — полноценный реестр (TanStack Table: поиск/5 измерений/compound-фильтры/сортировка/пагинация, permission-safe финансы и identity, состояния loading/empty/no-results/error/stale/unauthorized, responsive). См. `docs/USERS_WORKSPACE.md`.
- `/users/[id]` — полноценная **read-only** карточка User 360: приоритет и причина внимания, рекомендуемое действие, 5 независимых осей состояния, обучение, блокеры, сигналы, недавние события, ответственный, permission-aware identity и финансы. См. `docs/USER_360.md`.

Данные — только через `CrmDataProvider`; вся permission-проекция выполняется в провайдере **до** React.

**Последовательность этапов (D-34):** Phase 1C — User 360 и Phase 1B3 — Today Workspace выполнены. **Phase 1B4-A — mutation core** дал контракт `CrmMutations` и мутацию `addNote`. **Phase 1B4-B — UI заметок** добавил секцию «Заметки». **Phase 1B4-C — назначение primary owner** добавило вторую мутацию `assignPrimaryOwner` и её UI в секции «Ответственный и работа»; overlay расширен обратно совместимо, owner согласован в User 360 / Users / Today. Других мутаций нет, следующий этап не начинается автоматически. См. `docs/IMPLEMENTATION_STATUS.md`, `docs/MUTATION_OVERLAY.md`, `docs/USER_360.md`, `docs/DECISIONS.md` (D-64…D-74).

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
    notes/             # CrmNote + единый canonical note projector
    audit/             # AuditRecord (факт действия, без тела заметки)
  application/         # provider factory + context (boundary к данным)
  data/
    contracts/         # CrmDataProvider + CrmMutations + Result/Paginated/CrmError
    mock/              # MockCrmDataProvider + synthetic fixtures
      overlay/         # versioned localStorage mutation overlay + storage seam
  config/              # env-валидация, навигация
  lib/  styles/  test/
docs/                  # блюпринты Phase 0/0.5 + ARCHITECTURE / IMPLEMENTATION_STATUS
tests-e2e/             # Playwright smoke
```

Подробнее — `docs/ARCHITECTURE.md`.

## Мутации: что есть и чего нет (Phase 1B4-C)

**Две мутации на всё приложение — добавление заметки и назначение primary owner.** Обе живут на User 360; Today и Users только читают (assignment UI туда не добавлен). Секция «Заметки» — список (`getUserNotes`) и inline-композер (`addNote`), видна четырём ролям с `canEditUserNotes`. Секция «Ответственный и работа» — смена/снятие owner (`assignPrimaryOwner`), видна трём ролям с `canAssignOwner` (`crm_admin`/`crm_manager`/`retention_manager`); остальным — строка без контрола, текущий owner виден всем. Assign и Edit — **разные** права: `support` пишет заметки, owner не назначает. Рекомендации остаются с честной пометкой «Только просмотр».

После успеха обеих мутаций read перечитывается через провайдер (никакого optimistic update): у owner это refetch всего `getUser360` (owner в агрегате, D-35), кандидаты — отдельный read `getPrimaryOwnerCandidates`. Диагностика (`CrmError.message`) на экран не попадает — тексты из локальных тотальных карт по `CrmErrorCode`.

Что появилось — **только под провайдером**:

- контракт `CrmMutations` с **двумя** операциями (`addNote`, `assignPrimaryOwner`) + read `getPrimaryOwnerCandidates`; методов-заглушек нет;
- versioned localStorage overlay `ata-crm.mutation-overlay.v1` — фикстуры неизменяемы; в 1B4-C схема расширена **аддитивно в пределах v1**, старые заметки не теряются (regression-тест);
- `AuditRecord{mock:true}` — discriminated union; owner-запись несёт previous/next owner, **без** PII/финансов/свободного текста; история owner = append-only audit (отдельного `ownerAssignments[]` нет);
- идемпотентность по ключу, `expectedOwnerId` против потери обновления, детерминированные id/timestamp (без `Math.random()`/`Date.now()`/crypto);
- canonical employee directory (`domain/identity/employees.ts`) — источник кандидатов, `OWNER_LABEL` и owner-фильтра Users;
- права `canEditUserNotes` (D-53) и `canAssignOwner` (существует с Phase 1A) — разные измерения матрицы, не расширялись.

**Не реализованы:** редактирование/удаление заметок, pin/unpin, выбор visibility, пагинация заметок, tasks/cases mutations, task/case assignees, смена статуса, scope `own/team/all`, bulk assignment, assignment UI в Users/Today, закрытие сигналов, выполнение рекомендаций, reveal PII, audit-экран, кнопка сброса, финансовые операции, коммуникации, live cross-tab sync. Backend, база данных, Prisma и Pocket отсутствуют — мутация не покидает вкладку.

Подробности: `docs/MUTATION_OVERLAY.md`.
