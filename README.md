# Alfa Trade Academy CRM

Отдельное внутреннее приложение для команды Alfa Trade Academy (retention, mentoring, support, operations). **Полностью самостоятельный проект.** На текущем этапе — только synthetic/mock data, без backend, базы данных, Pocket и production-интеграции.

> **DEMO / MOCK MODE.** Приложение не подключается к production Alfa Trade Academy. Переключатель роли и «вход» — демонстрационные и **не являются production-безопасностью**.

Статус реализации: **Phase 1B6 — Note Delete** поверх Phase 1B5-C (Note Visibility Change), Phase 1B5-B (Global Audit Workspace), Phase 1B4-E (Note Body Edit), Phase 1B4-D (Note Pin / Unpin), Phase 1B4-C (Primary Owner Assignment), Phase 1B4-B (Notes UI), Phase 1B4-A (mutation core), Phase 1B3 Today Workspace, Phase 1C User 360, Phase 1B2 Users workspace и Phase 1B1 mock-домена.

- `/today` — полноценный **read-only** операционный центр смены: очередь внимания с конкретным доменным основанием у каждой строки, 4 секции по срочности с canonical placement, детерминированная сортировка, рекомендация, ответственный, SLA, фильтры/поиск по разрешённой проекции, состояния loading/empty/error/stale, desktop/tablet/mobile. См. `docs/TODAY_WORKSPACE.md`.
- `/users` — полноценный реестр (TanStack Table: поиск/5 измерений/compound-фильтры/сортировка/пагинация, permission-safe финансы и identity, состояния loading/empty/no-results/error/stale/unauthorized, responsive). См. `docs/USERS_WORKSPACE.md`.
- `/users/[id]` — полноценная **read-only** карточка User 360: приоритет и причина внимания, рекомендуемое действие, 5 независимых осей состояния, обучение, блокеры, сигналы, недавние события, ответственный, permission-aware identity и финансы. См. `docs/USER_360.md`.

Данные — только через `CrmDataProvider`; вся permission-проекция выполняется в провайдере **до** React.

**Последовательность этапов (D-34):** Phase 1C — User 360 и Phase 1B3 — Today Workspace выполнены. **Phase 1B4-A — mutation core** дал контракт `CrmMutations` и мутацию `addNote`. **Phase 1B4-B — UI заметок** добавил секцию «Заметки». **Phase 1B4-C — назначение primary owner** добавило вторую мутацию `assignPrimaryOwner` и её UI в секции «Ответственный и работа»; overlay расширен обратно совместимо, owner согласован в User 360 / Users / Today. **Phase 1B4-D — закрепление заметки** добавило третью мутацию `setNotePinned` и контрол закрепления в секции «Заметки»; effective pinned выводится из append-only audit (та же схема overlay v1), закрепление — часть `edit_user_notes`. **Phase 1B4-E — редактирование тела заметки** добавило четвёртую мутацию `updateNoteBody` и inline-редактор в секции «Заметки»: правит только автор своей overlay-заметки (`edit_user_notes`, строже pin), конкуренция по `expectedUpdatedAt`, возможность отдаётся провайдером через `getUserNotesView.canEditBody`; тело не попадает в result/audit/receipt. **Phase 1B5-B — глобальный Audit Workspace** заменил placeholder на read-only экран `/audit`: новая read-операция `getAuditRecords`, provider-owned safe `AuditRecordView` (никаких raw id/тела/PII/diagnostics), canonical sorter/projector (`at` DESC → `id` DESC), gated единственным `canViewAudit` (crm_admin/crm_manager); семь section-visible ролей видят пункт навигации, пять Limited получают restricted-state. Audit — reader browser-local overlay, не compliance/server log; фильтров нет; User 360 audit-preview остаётся будущей фазой. **Phase 1B5-C — смена видимости заметки** добавила пятую мутацию `setNoteVisibility` (team ↔ private) и inline visibility-editor в секции «Заметки»: правит только автор своей overlay-заметки (`edit_user_notes`), `private` — по identity актора, не по роли (смена роли при том же `actorEmployeeId` не скрывает свою заметку; другой сотрудник, включая admin, не видит); `role_restricted` не создаётся; возможность отдаётся провайдером через `getUserNotesView.canChangeVisibility`; глобальный `/audit` показывает факт `note_visibility_changed` без направления team/private. **Phase 1B6 — удаление заметки** добавила шестую мутацию `deleteNote` и inline-confirm в секции «Заметки»: автор удаляет свою overlay-заметку (`edit_user_notes`, только автор — как edit, но **hard delete** без tombstone/undo), заметка физически уходит из `notes[]`, тело не сохраняется; append-only `note_deleted` audit — защитный источник истины (canonical projection скрывает заметку с валидным поздним delete-record); replay разрешается ДО entity-lookup (retry после удаления не даёт `not_found`); повтор исходного `addNote` ключа после удаления не воскрешает заметку; возможность отдаётся провайдером через `getUserNotesView.canDelete`; глобальный `/audit` показывает факт `note_deleted` без тела/id. Следующий этап не начинается автоматически. См. `docs/IMPLEMENTATION_STATUS.md`, `docs/MUTATION_OVERLAY.md`, `docs/USER_360.md`, `docs/DATA_PROVIDER_CONTRACT.md`, `docs/DECISIONS.md` (D-82…D-101).

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
    audit/             # AuditRecord (факт действия) + AuditRecordView (safe read-model, sorter/projector)
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

## Мутации: что есть и чего нет (Phase 1B6)

**Шесть мутаций на всё приложение — добавление заметки, назначение primary owner, закрепление, редактирование тела, смена видимости и удаление заметки.** Все живут на User 360; Today и Users только читают. Секция «Заметки» — список (`getUserNotesView`), inline-композер (`addNote`), контрол закрепления (`setNotePinned`), inline-редактор тела (`updateNoteBody`), inline visibility-editor (`setNoteVisibility`) и inline delete-confirm (`deleteNote`), видны четырём ролям с `canEditUserNotes`; **редактировать/менять видимость/удалять** может только автор своей overlay-заметки — возможность отдаёт провайдер через `CrmNoteListItem.capabilities.canEditBody`/`canChangeVisibility`/`canDelete`, React не разбирает id (D-82/D-91/D-96). Удаление — **hard delete** (заметка уходит из `notes[]`, тело не сохраняется, undo нет); append-only `note_deleted` audit — защитный источник истины отсутствия (D-96/D-97). Секция «Ответственный и работа» — смена/снятие owner (`assignPrimaryOwner`), видна трём ролям с `canAssignOwner` (`crm_admin`/`crm_manager`/`retention_manager`); остальным — строка без контрола, текущий owner виден всем. Assign и Edit — **разные** права. Закрепление и редактирование — часть Edit, а не новые права (D-75/D-82). Рекомендации остаются с честной пометкой «Только просмотр».

После успеха любой мутации read перечитывается через провайдер (никакого optimistic update): у owner это refetch всего `getUser360` (owner в агрегате, D-35), у заметок — `getUserNotesView` (закреплённая всплывает наверх, порядком владеет `sortNotes`; фокус возвращается на контрол той же заметки — D-81/D-85). Диагностика (`CrmError.message`) на экран не попадает — тексты из локальных тотальных карт по `CrmErrorCode`.

Что появилось — **только под провайдером**:

- контракт `CrmMutations` с **шестью** операциями (`addNote`, `assignPrimaryOwner`, `setNotePinned`, `updateNoteBody`, `setNoteVisibility`, `deleteNote`) + read'ы `getPrimaryOwnerCandidates` и `getUserNotesView` (`canEditBody`/`canChangeVisibility`/`canDelete`); методов-заглушек нет;
- versioned localStorage overlay `ata-crm.mutation-overlay.v1` — фикстуры неизменяемы; в 1B4-C…1B6 схема расширена **аддитивно в пределах v1**, старые заметки, owner-, pin- и audit-история не теряются (regression-тест); body/visibility-edit переписывают `notes[]` на месте, а `deleteNote` — единственная мутация, **удаляющая** row из `notes[]` (append-only `note_deleted` остаётся, D-96/D-97);
- `AuditRecord{mock:true}` — discriminated union; owner-запись несёт previous/next owner, pin-запись — previous/next pinned, **body-запись — только факт** (без тела/фрагмента/длины, D-84), всё **без** PII/финансов/свободного текста; история owner и effective pinned = append-only audit (отдельных `ownerAssignments[]`/`notePins[]` нет);
- идемпотентность по ключу, `expectedOwnerId`/`expectedPinned`/`expectedUpdatedAt` против потери обновления, детерминированные id/timestamp (без `Math.random()`/`Date.now()`/crypto); у body-edit один timestamp у `note.updatedAt` и `audit.at` — replay реконструирует метаданные из audit (D-83);
- единый резолвер effective pinned (`resolveEffectivePins`) — базовый `note.pinned` ⊕ последняя `note_pin_changed`, до `sortNotes`; любая **видимая** заметка pinnable, скрытая → `not_found` (D-76);
- canonical employee directory (`domain/identity/employees.ts`) — источник кандидатов, `OWNER_LABEL` и owner-фильтра Users;
- права `canEditUserNotes` (D-53, покрывает pin — D-75, и редактирование тела — D-82) и `canAssignOwner` (существует с Phase 1A) — разные измерения матрицы, не расширялись.

**Не реализованы:** удаление заметок, редактирование чужих/фикстурных заметок, создание `role_restricted`, allowed-role selector, пагинация заметок, tasks/cases mutations, task/case assignees, смена статуса, scope `own/team/all`, bulk pin/assignment/edit/visibility, pin/assignment UI в Users/Today, закрытие сигналов, выполнение рекомендаций, reveal PII, audit-фильтры/поиск/date range, audit export/undo, audit-preview в User 360, кнопка сброса, финансовые операции, коммуникации, live cross-tab sync. Backend, база данных, Prisma и Pocket отсутствуют — мутация не покидает вкладку.

Подробности: `docs/MUTATION_OVERLAY.md`.
