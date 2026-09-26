# IMPLEMENTATION_STATUS.md — Alfa Trade Academy CRM

## Phase 0 — Product & Architecture Blueprint ✅
Спроектированы продуктовый контекст, IA, доменная модель, роли/права, контракт провайдера, план mock-данных, UX-блюпринт, будущая интеграция, план реализации. Только документы.

## Phase 0.5 — Blueprint Correction & Decision Lock ✅
Единый lifecycle mega-enum заменён на 5-мерную модель состояний (STATE_MODEL). Зафиксированы решения D-01…D-12 (DECISIONS): источники истины, стек, пороги сигналов (SIGNAL_CATALOG), SLA (SLA_POLICY), grace, финансовые бакеты, ownership, mock persistence, checkpoints>L100, PII (PII_ACCESS_POLICY). Только документы.

## Phase 1A — Application Foundation & CRM Shell ✅ (текущий)

### Выполнено
- Отдельное Next.js 14 (App Router) + TypeScript strict приложение; конфиги Tailwind/ESLint/Vitest/Playwright; env-валидация (Zod, без секретов); скрипты dev/build/start/lint/typecheck/test/test:run/test:e2e.
- Строгая структура каталогов; domain-слой не зависит от React/Next.
- Domain contracts в коде: `CrmRole`, `Permission`, `LifecycleStage`, `FundingStatus`, `EngagementStatus`, `ValueSegment`, `OperationalBlocker`, `StateEvidence`, `UserStateProfile`, `FinancialBucket`, `DataSensitivity`, `SignalCode`, `SignalSeverity`, `TaskStatus`, `CaseStatus`.
- Централизованный permission-слой (`canViewSection`, `canViewExactFinancials`, `canViewIdentity`, `canRevealPii`, `canAssignOwner`, `canExport`, `canViewAudit`, `canManageSettings`) по ROLE_PERMISSION_MATRIX.
- `CrmDataProvider` (13 операций, типизирован) + `MockCrmDataProvider` (2–3 synthetic записи, dev-задержка, controllable error mode). UI читает данные только через application/provider.
- CRM shell: desktop layout, sidebar (сворачивание, tooltips, активный route, мобильный drawer, ролевая фильтрация разделов), topbar (breadcrumbs, поиск-заглушка, DEMO MODE, employee menu), dev-only role switch (9 ролей).
- Mock employee session (typed, без реальных PII).
- Все routes: `/login`, `/today`, `/users`, `/users/[id]`, `/segments`, `/tasks`, `/cases`, `/mentor`, `/support`, `/financial`, `/communications`, `/automations`, `/analytics`, `/audit`, `/settings`; `/` → `/today`; переиспользуемый `SectionPlaceholder`.
- UI-фундамент: Button, IconButton, Badge, StatusBadge, Avatar, Tooltip, DropdownMenu, Sheet/Drawer, Dialog, Skeleton, EmptyState, ErrorState, StaleDataIndicator, PageHeader, SectionPlaceholder.
- Состояния: root error boundary, route loading, not-found, empty/error/stale.
- Accessibility: skip-to-content, семантическая навигация, aria-label для icon-only, keyboard nav, focus-visible, focus-trap диалогов, no color-only meaning, reduced-motion.
- Тесты: 20 unit/компонентных (Vitest) — permissions, section visibility, buckets, provider errors, sidebar active state, breadcrumbs, sidebar role visibility. Playwright smoke-suite написана.
- Документация: README, ARCHITECTURE, IMPLEMENTATION_STATUS, DECISIONS (Phase 1A запись).

### Результаты проверок
- `typecheck` — ✅ (0 ошибок)
- `lint` — ✅ (0 warnings/errors)
- `test:run` — ✅ (20/20 passed)
- `build` — ✅ (17 routes, production build успешна)
- `test:e2e` (Playwright) — ⚠️ не запущен в текущем окружении: не удалось загрузить бинарник Chromium (лимиты sandbox). Suite и конфиг готовы; запускается локально после `npx playwright install chromium`.
- Runtime-проверка через server-rendered HTML — ✅ для всех маршрутов (`/today`, `/`→307, `/users`, `/login`, 404).

### Не входит в Phase 1A (сознательно)
- Полноценные Today, Users, User 360 (только каркас/placeholder).
- Реальные таблицы (TanStack Table), фильтры, saved views, timeline.
- localStorage mutation overlay для мутаций (task/case/note) и Reset — контракт зарезервирован, реализация в Phase 1B.
- Реальная аутентификация/RBAC, база данных, API-интеграция, отправка коммуникаций, deploy.
- Полный набор из 30 mock-персон (сейчас 3 для smoke).
- Пиксельные скриншоты/визуальные снапшоты (нет браузера в sandbox).

### Известные заметки
- `next@14.2.33` при установке показывает предупреждение о security-обновлении (декабрь 2025). Рекомендуется поднять до патч-версии 14.2.x на следующем этапе; на функциональность Phase 1A не влияет.

## Phase 1B1 — Synthetic dataset & derivation layer ✅ (текущий)

### Выполнено
- **Dependency gate:** Next.js `14.2.33 → 14.2.35` (последний патч 14.x, без major/React-19), postcss `8.4.49 → 8.5.17` (закрывает XSS-advisory), @playwright/test `1.48.2 → 1.61.1`. Осталось 11 advisories внутри `next@14.2.35` — **не устранены**; экспозиция ограничена локальным mock-инструментом, локальную разработку не блокируют; публичный staging/production запрещён до отдельного security-review (DECISIONS D-26).
- **FixedMockClock** (`src/lib/clock.ts`): Clock/SystemClock/FixedMockClock + relative-хелперы; `MOCK_NOW = 2026-07-13T09:00Z`.
- **30 synthetic users** (`src/data/mock/fixtures/`): raw offsets → build(clock) → MockUser; identity/state(5 dims)/progression/learning/financial/operations; финансовая формула согласована; edge cases покрыты.
- **Zod-валидация** (`validate.ts`): 30 пользователей, уникальность, enum, формулы, checkpoint/freshness consistency, coverage; невалидный fixture падает в тестах.
- **Signals engine** (`domain/signals/engine.ts`): 23 сигнала чистыми функциями + suppression; пороги из `config/signals.config.ts`.
- **Recommendations** (`domain/recommendations/`): 18 объяснимых действий, запрещённых финансовых действий нет; fatigue-suppression; no_action fallback.
- **Priority model** (`domain/priority/priority.ts`): полосы critical/high/normal/low по явным правилам + детерминированный tie-break.
- **Today builder** (`domain/today/builder.ts`): 12 очередей, дедупликация, permission-aware финансы.
- **Projections:** financial (exact/bucket/aggregated/hidden) и identity (full/masked/pseudonymous/hidden).
- **Segments** (`domain/segments/`): 14 вычисляемых сегментов (membership через предикаты).
- **MockCrmDataProvider:** все 13 read-операций с pagination/filter(§13)/sort/permission-projection/stale/error/empty; детерминизм; sort по точным финансам без права → `invalid_input` (не утекает).
- **Human labels** (`config/labels.ts`): централизованные подписи enum; UI не показывает raw-коды; ProviderSmoke → dev-only диагностика; «Каркас · Phase 1A» только в dev.
- **Docs:** MOCK_DATA_IMPLEMENTATION (coverage matrix), SIGNAL_ENGINE, RECOMMENDATION_CATALOG, TODAY_QUEUE_RULES.

### Результаты проверок
- `typecheck` ✅ · `lint` ✅ · `test:run` ✅ **72/72** · `build` ✅ (17 routes). `npm audit` — 11 next-внутренних advisories (см. выше, не скрыты). `test:e2e` — ⚠️ браузер не скачивается в sandbox; UI менялся минимально, скриншот не блокирует этап.

### Не входит в Phase 1B1 (сознательно)
Полноценные экраны Today/Users/User 360; TanStack-таблица; localStorage mutation overlay и мутации; реальный timeline UI; реальная аутентификация/RBAC/БД/API/deploy; PII reveal flow (только контракты/проекция).

## Phase 1B1.1 — Domain semantics & repository integrity patch ✅ (текущий)

### Выполнено
- **Git integrity gate:** `git fsck --full` чист (только безвредные dangling-объекты от прежних попыток), HEAD = `0d3ae55` (ожидаемый), status чист. Обнаружены зависшие `.git/index.lock` и `.git/HEAD.lock` (0 байт, git-процессов нет → доказанно stale), но FUSE-mount возвращает `Operation not permitted` на unlink — удалить штатно нельзя (см. отчёт).
- **Fresh install verification:** из `git archive HEAD` → `npm ci` (next 14.2.35, postcss 8.5.17, playwright 1.61.1) → typecheck/test(76)/build — зелёные.
- **Pocket semantic rename (D-23):** `pocket_connected→pocket_registered`, `not_connected→not_available`, `pocket_not_connected→pocket_registration_incomplete`, `help_connect_pocket→help_complete_pocket_registration`, поле `connectionStatus→registrationStatus`. Без backward-алиасов. Старых кодов в src/docs нет (consistency search).
- **onboarding_attention (D-24):** 13-я очередь; users 001/002/003 покрыты; финансы скрыты; identity projection; единый `src/config/queues.ts`.
- **Queue-code consistency:** канон `critical_attention`; bare `critical` как кода нет.
- **Audit wording (D-26):** advisories описаны как не устранённые; staging/production — только после security-review.

### Результаты проверок
- `typecheck` ✅ · `lint` ✅ · `test:run` ✅ **76/76** · `build` ✅ (17 routes) · fresh `npm ci` ✅. `npm audit` — 11 не устранённых next-внутренних advisories (см. D-26).

### Semantic finalization (registrationStatus)
`financial.registrationStatus` финализирован до **трёх** значений: `not_registered / registration_pending / registered` (`confirmed` и `deregistered` удалены, D-27). `registered` = backend-confirmed affiliate registration. ATA email confirmation — отдельная ось `identity.emailConfirmed`; сигнал `email_not_confirmed` зависит только от неё. Pocket «Email Confirmation» отложен до backend/API contract (FUTURE_INTEGRATION §4). Добавлен фильтр `registrationStatus` (только 3 значения). Тесты: **86/86** ✅ (+10 registration-status); typecheck/lint/build ✅. Прогон выполнен в изолированной копии (node_modules проекта — macOS-нативные; в проекте reinstall не делался).

## Phase 1B2 — Users workspace ✅ (текущий)

### Выполнено
- **Экран `/users`** больше не placeholder: `src/features/users/` (feature-папка: `hooks/`, `columns/`, `components/`, `users-workspace.tsx`, `users-toolbar.tsx`, `users-filters.tsx`, `users-table.tsx`, `users-pagination.tsx`, `users-summary.tsx`, `users-states.tsx`). Данные — только через `CrmDataProvider` (fixtures в UI не импортируются).
- **TanStack Table** (`manualSorting` + `manualPagination`): 9 дефолтных колонок (Пользователь, Приоритет, Lifecycle, Финансовый статус, Engagement, Прогресс, Активные блокеры, Owner, Последняя активность) + 6 опциональных через меню «Колонки» (Value-сегменты, Рекомендация, Регистрация, Кампания/источник, Баланс, Net deposits; состояние — только React state). Действие в строке — доступная иконка «Открыть профиль» (десктоп) / полнотекстовая кнопка (mobile); имя — ссылка на `/users/[id]`.
- **Поиск** через provider (debounce 300 ms, сброс страницы). **Фильтры**: 5 канонических измерений (multi-select) + owner/priority/registrationStatus; active-chips, счётчики, «Сбросить всё», zero-results ≠ empty dataset; на мобильном — Sheet.
- **Sorting** (provider): priority, registeredAt, lastMeaningfulActionAt, currentLevel, owner, displayName; `aria-sort`. **Pagination** (provider): 20/50, prev/next, диапазон, disabled, сброс при изменении search/filter.
- **Permission-safe** финансы (exact/bucket/aggregated/hidden/stale) и identity (list-контекст всегда masked) — берутся из provider-проекции; exact-значение не попадает в DOM ролям без права (тест). Подтверждено скриншотами: admin `$90` (exact) vs support `$50–99` (bucket).
- **UI-состояния**: loading (skeleton), empty dataset, no-results (CTA «Сбросить фильтры»), error (+«Повторить»), stale (баннер + данные видимы), unauthorized. **Responsive**: 1440 (все 9 колонок без h-scroll, замер overflow 0 px), 1024 (второстепенные колонки скрыты, toolbar-wrap), 390 (карточки + Sheet). **A11y**: semantic table, `th scope`, `aria-sort`, keyboard-фильтры, label поиска, sr-текст иконок, focus-visible, статусы не только цветом.
- **Provider-дополнения (реальные пробелы контракта):** `UserSortField` += `owner`; `UserFilters` += `priority: PriorityBand[]`, `registrationStatus`. (D-28.)
- **Мелкие фиксы, найденные UI:** убран ошибочный stale-флаг у «Последней активности» (staleness баланса ≠ активности); добавлен `src/app/icon.svg` (устраняет 404 favicon в консоли); действие в строке → компактная доступная иконка (устраняет horizontal overflow на 1440). (D-29.)
- **Docs:** `USERS_WORKSPACE.md`, `visual-reviews/PHASE_1B2_USERS.md`; `screenshots/phase-1b2-users/` (+README).

### Результаты проверок
- `typecheck` ✅ · `lint` ✅ · `test:run` ✅ **110/110** (+24 к 1B1.1: hook-query, workspace/states, permissions) · `build` ✅ (`/users` = 22.3 kB / 191 kB first load; `/users/[id]` остаётся placeholder). `npm audit` — те же 11 не устранённых next-внутренних advisories (D-26, `--force` не выполнялся). `test:e2e` ✅ — **5/5** реальных screenshots (headless Chromium 149), консоль чистая.
- Прогон гейтов — в изолированной Linux-копии (node_modules проекта macOS-нативные; в проекте reinstall не делался). Screenshots сгенерированы реальным браузером (см. visual-review).

### Не входит в Phase 1B2 (сознательно)
Today, User 360, localStorage mutation overlay и любые мутации, notes/tasks/cases, owner reassignment, saved-views persistence, bulk actions, export, PII reveal flow, communications, backend/API/БД/Prisma/Pocket, аутентификация, deploy. `/users/[id]` остаётся placeholder.

## Phase 1B2.1 — Users visual hardening ✅ (текущий)

### Выполнено (только presentation `/users`)
- **Русская терминология** через `USERS_COLUMN_LABEL` (central config): Этап/Активность/Ответственный/
  Ценностные сегменты/Регистрация Pocket/Чистые депозиты. `Lifecycle/Engagement/Owner` в UI нет;
  TS enum-имена не тронуты.
- **Responsive колонки:** merged «Состояния» (Этап+Финансовый+Активность одним стеком) на md..2xl;
  индивидуальные оси на 2xl+; `Ответственный` — xl+. Замер overflow: **0 на 1024 и 1440**, page
  overflow 0 на всех ширинах — намеренный компактный планшет без обрезанного правого края.
- **Плотность строк:** owner nowrap («Support 1» одной строкой); blockers 2/1 + `+N` (tooltip);
  priority reason 1 строка (desktop) / читаема без hover (mobile); planshet скрывает email + reason.
- **Toolbar:** предсказуемые ряды (поиск+Колонки/Фильтры · фильтры desktop · chips+«Сбросить всё»).
- **Row action:** доступное имя «Открыть профиль <имя>»; иконка desktop/tablet, кнопка mobile.
- **Docs:** USERS_WORKSPACE обновлён; visual-review `PHASE_1B2_1_USERS_HARDENING.md`;
  screenshots `screenshots/phase-1b2-1-users-hardening/` (7 шт).

### Результаты проверок
- `typecheck` ✅ · `lint` ✅ · `test:run` ✅ **116/116** (+6 hardening) · `build` ✅ (`/users` 22.8 kB;
  `/users/[id]` placeholder) · `test:e2e` ✅ **12/12** одним прогоном (5 smoke + 7 screenshots),
  консоль чистая. `npm audit` — те же 11 не устранённых next-внутренних advisories (D-26).

### Не входит (сознательно)
Provider/domain/permissions/financial projection не менялись. Today, User 360, mutation overlay,
`/users/[id]`, backend/DB/Pocket — не начинались.

## Phase 1B2.2 — Users sticky row-action ✅ (текущий)

### Выполнено (только presentation `/users`)
- **Sticky edge-колонки:** идентичность sticky слева, действие «Открыть профиль» sticky справа
  (`position: sticky`, непрозрачный фон + edge-separator + `group-hover`); опциональные колонки
  скроллятся между ними внутри `overflow-x-auto`. Действие видно до/после горизонтального скролла
  (та же правая зона, замер Δx < 6px), focus не обрезан, page overflow ≤ 1px на 1440 и 1024.
- **Blocker/owner spacing:** blocker-бейджи — controlled truncation (`max-w` + tooltip с полным
  значением), гарантированный зазор до «Ответственный» (e2e-замер gap > 2px). Дефолтный набор не
  регрессировал (помещается без скролла).
- **Tests:** +1 unit (`UsersTable` с включёнными опциональными колонками содержит действие) → **117**.
- **E2E-состав восстановлен (1B2.2):** прежние 5 Users-сценариев сохранены отдельными тестами в
  `tests-e2e/users-screenshots.spec.ts` (admin/support/filtered/tablet/mobile — каждый со своими
  проверками console/viewport/permission), а 3 sticky-теста вынесены в отдельный
  `tests-e2e/users-sticky-action.spec.ts` (default, before/after scroll, focus). Итог: **13/13**
  (5 smoke + 5 Users + 3 sticky) одним прогоном.
- **Docs:** USERS_WORKSPACE (sticky), DECISIONS D-33; screenshots `screenshots/phase-1b2-2-users-sticky-action/`.

### Результаты проверок
- `typecheck` ✅ · `lint` ✅ · `test:run` ✅ **117/117** · `build` ✅ · `test:e2e` ✅ **13/13** одним
  прогоном, консоль чистая. `npm audit` — те же 11 не устранённых next-внутренних advisories (D-26).

### Не входит (сознательно)
Provider/domain/permissions/financial projection не менялись. Today, User 360, mutation overlay,
`/users/[id]`, backend/DB/Pocket — не начинались.

## Phase 1C — User 360 (read-only) ✅ (текущий)

### Выполнено
- **`/users/[id]` больше не placeholder:** полноценный read-only User 360.
  `src/features/user-360/` (`user-360-workspace.tsx`, `user-360-states.tsx`, `hooks/`,
  `components/`: header, identity-summary, attention-panel, recommendations, state-overview,
  blockers, signals, learning-progress, activity-timeline, financial-summary, owner-context,
  section-card). Данные — только через `CrmDataProvider`.
- **Data contract first (D-35):** аудит показал, что `getUserById` отдаёт плоскую list-проекцию
  (identity всегда masked, нет learning/grace/SLA/сигналов/рекомендаций/событий). Добавлена **одна
  read-only операция** `getUser360(ctx, {userId}) → Result<User360>`; существующие 13 не менялись.
  Read-модель — `domain/users/user-360.ts`, проекция — `domain/users/user-360-projection.ts`.
- **Permissions до React (D-36):** вся проекция — внутри провайдера. Запрещённые значения физически
  отсутствуют в payload/DOM/props/`title`/`aria`/data-* и в сериализованных данных страницы.
  Закрыта **арифметическая утечка**: сетка checkpoint (публичная константа L10=$100) + «осталось 10%»
  давали support точный баланс $90 → для ролей без exact-финансов `nextCheckpointRequiredUsd = null`
  и балансо-производные пояснения сигналов вырезаны. HIGH-события (депозиты) не отдаются.
- **IA:** header (back, identity, ID, приоритет, ответственный, активность, статус данных) ·
  «Почему требует внимания» (приоритет + причина + рекомендация с основанием/срочностью/адресатом) ·
  5 независимых осей состояний · блокеры · сигналы · обучение · недавние события · sticky-контекст
  (финансы + ответственный). Один факт представлен **дважды и по-разному** (состояние vs сигнал),
  интерпретация ссылается бейджем «Основание приоритета» (`PriorityResult.sourceSignalCodes`, D-38).
- **Read-only честно:** рекомендации помечены «Только просмотр», кнопок выполнения нет,
  `allowedForRole` показывает «не для вашей роли». Fake success отсутствует (тест).
- **States:** loading (skeleton в форме реального layout), not-found (с `h1`, ID, ссылкой назад,
  без выдуманного профиля), unauthorized (provider-driven; ни одна роль его не вызывает — D-37),
  error (retry только при `retriable`), stale (баннер + данные видимы, `Freshness` от `FixedMockClock`).
- **Responsive:** 1440 (первый экран отвечает «почему открыт») · 1024 (намеренная компактность) ·
  390 (собственный операционный порядок, проверен замером) · 200% zoom = CSS-viewport 720×450 (reflow).
  Page overflow **0** на всех ширинах.
- **A11y:** один h1 (в т.ч. в терминальных состояниях), `<section aria-labelledby>` + `useId`,
  timeline как `<ol>`/`<time>`, статусы не только цветом, keyboard + focus-visible.
- **Точечные исправления домена (D-38):** `FinancialProjection.hiddenReason` («нет данных» vs «нет
  прав»), `PriorityResult.sourceSignalCodes`, нейтральный текст `review_checkpoint_grace`.
- **Docs:** `USER_360.md`, `visual-reviews/PHASE_1C_USER_360.md`, DECISIONS D-34…D-38;
  screenshots `screenshots/phase-1c-user-360/{first-pass,final}/`.

### Результаты проверок
- `typecheck` ✅ · `lint` ✅ · `test:run` ✅ **173/173** (117 прежних сохранены + 56 новых:
  25 projection, 12 permissions-in-DOM, 19 workspace) · `build` ✅ (18 routes; `/users/[id]` —
  8.55 kB / 167 kB, больше не placeholder) · `test:e2e` ✅ **26/26** одним прогоном
  (5 smoke + 5 Users + 3 sticky сохранены + 13 новых User 360), консоль чистая, hydration-warnings нет.
  `npm audit` — те же 11 не устранённых next-внутренних advisories (D-26, `--force` не выполнялся).
- Зависимости не менялись: `package.json` / `package-lock.json` не тронуты.

### Не входит (сознательно)
Редактирование, notes/tasks/cases mutations, смена owner/статуса, закрытие сигналов, финансовые
операции, коммуникации, PII reveal-flow, полный финансовый history, **Today (Phase 1B3 — отложен)**,
**mutations overlay (Phase 1B4 — отложен)**, backend/API/database/Prisma/Pocket, production auth,
deploy. Следующий этап **не начинается автоматически**.

### Известные долги (не скрыты)
- `getUserTimeline` по-прежнему игнорирует `ctx` и отдаёт HIGH-события любой роли (D-36). User 360 её
  не использует; исправление — вместе с Today/аудитом контракта.
- `FinancialCell` в Users workspace показывает «Недоступно для роли» и при отсутствии данных
  (не использует новый `hiddenReason`) — latent-неточность, вне scope 1C (D-38).
- Русская карта подписей `StateEvidence` не сделана: raw evidence не рендерится в User 360.

## Phase 1C.1 — Provider privacy consistency ✅ (текущий)

Ограниченный consistency pass: закрыты две неточности, зафиксированные как долги в конце Phase 1C-A.
Матрица прав **не менялась**, User 360 visual design **не менялся**, Today и mutations не начинались.

### Выполнено
- **Fix A — `getUserTimeline` стала permission-aware (D-39).** Причина была не в «забытой проверке», а
  в **дублировании**: у `getUserTimeline` и `getUser360` были две независимые реализации ленты.
  Первая принимала контекст как `_ctx` и игнорировала его → HIGH financial events (подтверждённые
  депозиты) уходили любой роли; вторая имела корректный гейт, но свой набор событий, заголовки,
  сортировку и дедупликацию. Введён **единый canonical projector**
  `src/domain/users/user-timeline.ts` (`buildUserTimeline` → `projectTimelineEvent` /
  `projectTimeline` → `buildProjectedUserTimeline`), который используют **обе** операции.
  Permission-логики вне projector нет; User 360 только **сужает форму** события.
- **Инвариант «без сумм»:** ни одно поле события не содержит суммы — депозит несёт только факт и
  время. Скрытое событие невозможно восстановить; проверено по всем 30 фикстурам.
- **Побочно исправлено проектором:** дублирующиеся `id` у нескольких redeposit, нестабильная
  сортировка, отсутствие дедупликации. Визуальный результат User 360 не изменился (173 прежних теста
  зелёные без правок).
- **Fix B — семантика скрытых финансов (D-40).** `FinancialCell` показывал «Недоступно для роли» на
  любой hidden — т.е. сообщал admin'у о нехватке прав там, где значения просто нет, и противоречил
  User 360. Теперь оба рендерера читают `hiddenReason` и единый источник текста `HIDDEN_LABEL`
  (реэкспорт `FINANCIAL_HIDDEN_LABEL`): **«Нет данных»** vs **«Недоступно для роли»**.
  `label` самой проекции берётся из того же источника → read-модель не противоречит экрану.
- **Desktop/mobile:** mobile-карточка Users намеренно не содержит финансового представления →
  расхождения нет; закреплено regression-тестом.
- **Layout не менялся:** только текст скрытого финансового состояния.

### Результаты проверок
- `typecheck` ✅ · `lint` ✅ · `test:run` ✅ **234/234** (все 173 прежних сохранены + 61 новый:
  43 timeline-privacy, 18 FinancialCell) · `build` ✅ (18 routes) · `test:e2e` ✅ **30/30**
  (все 26 прежних сохранены + 4 новых privacy-сценария), консоль чистая. `npm audit` — те же
  11 не устранённых next-внутренних advisories (D-26); `audit fix` не выполнялся.
  `package.json` / `package-lock.json` не менялись.
- **Regression доказан:** временная подмена projector на «старое» поведение (игнор `ctx`) роняет
  **15** тестов, включая явный «the provider context changes the result».

### Не входит (сознательно)
Today (Phase 1B3) и mutations overlay (Phase 1B4) — по-прежнему отложены и не начинались.
Матрица прав, identity-проекция и exact-financial visibility **не расширялись**.
Backend/database/Prisma/Pocket отсутствуют. Зависимости не добавлялись.

### Закрытые долги Phase 1C-A
- ~~`getUserTimeline` игнорирует `ctx`~~ → закрыт (D-39).
- ~~`FinancialCell` не различает «нет данных» и «нет прав»~~ → закрыт (D-40).
- Остаётся: русская карта подписей `StateEvidence` (raw evidence в User 360 не рендерится);
  фильтры `from`/`to` у `getUserTimeline` в контракте описаны, но не реализованы (вне scope 1C.1).

## Последовательность этапов (решение зафиксировано)

Следующим этапом **намеренно выбран User 360**. Каноническое название — **Phase 1C — User 360**
(не «Phase 1B3»; нумерация 1B3 закреплена за Today и не переиспользуется).

| Этап | Каноническое название | Статус |
|---|---|---|
| Phase 1C | **User 360** | выполнен |
| Phase 1B3 | **Today Workspace** | выполнен (read-only) — см. раздел ниже |
| Phase 1B4-A | **Mutation core + addNote (provider-only)** | выполнен — см. раздел ниже |
| Phase 1B4-B | **User 360 Notes + Add Note UI** | выполнен — см. раздел ниже |
| Phase 1B4-C | **Primary Owner Assignment** | выполнен — см. раздел ниже |
| Phase 1B4-D | **User 360 Note Pin / Unpin** | выполнен — см. раздел ниже |
| Phase 1B4-E | **User 360 Note Body Edit** | выполнен — `updateNoteBody`, provider-owned `canEditBody`, inline-редактор; D-82…D-85, docs/MUTATION_OVERLAY.md §§ (1B4-E) |
| Phase 1B5-B | **Global Audit Workspace** | выполнен — read-only `/audit`, `getAuditRecords`, provider-owned safe `AuditRecordView`, canonical sorter/projector; `canViewAudit` — единственный data-gate (crm_admin/crm_manager), section-visible Limited-роли → restricted-state; D-86…D-90 |
| Phase 1B5-C | **User 360 Note Visibility Change** | выполнен — `setNoteVisibility` (team↔private), provider-owned `canChangeVisibility`, inline visibility-editor, пятый audit-член `note_visibility_changed`; private по identity актора, не по роли; role_restricted отложен; D-91…D-95 |
| Phase 1B6 | **User 360 Note Delete** | выполнен — `deleteNote` (hard delete authored overlay-note), provider-owned `canDelete`, inline delete-confirm, шестой audit-член `note_deleted`; append-only audit — защитный источник истины (canonical `hideDeletedNotes`); replay до entity-lookup; add-replay после удаления не воскрешает; D-96…D-101 |

Обоснование: провайдер, derivation-слой (signals/priority/recommendations) и permission-проекции
готовы с Phase 1B1, а `/users/[id]` оставался единственным placeholder-ом в уже реализованном
пути «Users → профиль». User 360 закрывает этот путь и не требует mutations overlay, т.к. read-only.
Today (1B3) и mutations (1B4) остаются запланированными и не начинаются автоматически. См. D-34.

---

## Phase 1B3 — Today Workspace (read-only) ✅

`/today` перестал быть placeholder-ом и стал полноценным операционным центром смены.
Подробности: `docs/TODAY_WORKSPACE.md`, ревью: `docs/visual-reviews/PHASE_1B3_TODAY.md`, решения D-41…D-51.

### Выполнено
- **Provider-driven очередь.** `getTodayWorkspace(ctx, query)` возвращает уже спроецированный агрегат: React не вычисляет права, не пересчитывает приоритет, не решает состав очереди. Placeholder-контракт Phase 1A (`TodayGroupKey`, приведение `key: q.code as never`) заменён реальной моделью в `domain/today/today.ts` (D-50).
- **Две оси вместо 13 параллельных очередей.** Основание (`TodayBasisCode`, те же 13 кодов — почему) × секция (`TodaySectionKey`, 4 — насколько срочно). Ни один предикат Phase 1B1 не потерян; они же стали фильтром «тип основания».
- **Членство по реальному основанию.** 11 attention-оснований; ценностные сегменты не дают места в очереди (D-43). 30 пользователей → 22 в очереди, 7 спокойных отсутствуют.
- **Canonical placement.** Один пользователь — ровно одна секция (`overdue → critical_now → today → watch`); пустые секции не возвращаются.
- **Детерминированная сортировка** внутри секций: `urgency` (default) / `last_activity` / `owner`; без `Math.random` и без часов браузера.
- **Причина строки** — предложение домена с числами; «Требует внимания» без объяснения запрещено тестом. Один факт печатается один раз (D-48).
- **Summary** — 4 операционных числа, следуют за фильтрами, без финансовых сумм.
- **Фильтры** — приоритет / основание / SLA / ответственный / поиск; опции строит provider из реальной очереди роли, поэтому мёртвых контролов нет. `scope` не реализован осознанно (D-44).
- **Приватность.** Точные суммы, checkpoint-проценты и полные email не строятся для ролей без прав — их нет ни в тексте, ни в DOM, ни в атрибутах. Правило балансо-производной редакции вынесено в общий с User 360 модуль (D-46). Поиск идёт только по разрешённой identity-проекции.
- **Состояния** — loading / error / stale / нет работы / фильтры пусты / пустая база. Пустая очередь никогда не выдаётся за отсутствие прав.
- **Desktop 1440×900 / tablet 1024×768 / mobile 390×844 / zoom 720×450**, без горизонтального overflow.
- **A11y** — один h1, секции с заголовками, семантический список, приоритет и SLA текстом, пользователь в accessible name ссылки, 44px тач-таргеты.

### Закрытые долги
- ~~`getUserTimeline` не применяет `from`/`to`~~ → закрыт (D-41), 17 regression-тестов.
- ~~Нет русской карты `StateEvidence`~~ → закрыт (D-42): типизированный enum из 23 кодов + единая карта + consistency-тест.

### Результаты проверок
- `typecheck` — ✅ 0 ошибок
- `lint` — ✅ 0 warnings/errors
- `test:run` — ✅ **425/425** (было 234; +191: timeline range, evidence-карта, Today builder/privacy/provider, workspace, permissions)
- `build` — ✅ production build успешна
- `test:e2e` — ✅ **41/41** (было 30; +11 Today). Ни один прежний suite не заменён и не удалён
- `npm audit` — без изменений; `package.json` / `package-lock.json` не трогались
- Browser console — чисто, hydration warnings отсутствуют (проверяется в каждом E2E-сценарии)

### Не входит (сознательно)
Мутации, выполнение рекомендаций, назначение owner, задачи, кейсы, заметки, массовые операции,
drag-and-drop, коммуникации, автоматизации — **Phase 1B4**, не начинается автоматически.
Матрица прав, identity-проекция и exact-financial visibility **не расширялись**.
Backend / database / Prisma / Pocket API / production auth отсутствуют. Зависимости не добавлялись.

### Известный предсуществующий долг (вне scope 1B3)
~~`RECOMMENDATION_CATALOG[code].title` и `RECOMMENDATION_LABEL[code]` содержат **две разные русские
строки** на один код~~ → закрыт в **Phase 1B3.1** (D-52). При закрытии выяснилось, что расхождений
было **три**, а не одно, как записано здесь изначально: помимо `remind_email_confirmation`
разошлись `review_risk_material` и `celebrate_learning_return`. См. раздел ниже.

---

## Phase 1B3.1 — Recommendation label consistency ✅

Небольшой consistency prerequisite перед Phase 1B4. Только подписи рекомендаций: права, провайдер-семантика
и layout всех трёх экранов не менялись. Решение — D-52.

### Выполнено
- **Один канонический источник.** `RECOMMENDATION_CATALOG[code].title` (`domain/recommendations/catalog.ts`) —
  подпись рядом с кодом рекомендации. `config/labels.ts` → `RECOMMENDATION_LABEL` теперь **выводится**
  из каталога (`Object.entries(...).map(...)`) и не содержит собственных литералов. Двух наборов из 18
  русских строк больше нет — расхождение стало **непредставимым**, а не «проверяемым тестом».
- **Три расхождения устранены** принятием более полной формулировки каталога. Строки не редактировались:
  удалён второй набор, канон применился сам. Остальные 15 подписей не тронуты.
  - `remind_email_confirmation` → «Напомнить о подтверждении email»
  - `review_risk_material` → «Предложить материал по управлению риском»
  - `celebrate_learning_return` → «Отметить возвращение к обучению»
- **Потребители приведены к одному mapping.** Users (`misc-cells.tsx`) и Today (`today-next-step.tsx`)
  уже читали `RECOMMENDATION_LABEL` — не изменились. User 360 (`user-recommendations.tsx`) печатал
  `rec.title` из read-модели → теперь резолвит подпись из кода через тот же mapping. Read-модель и
  провайдерский контракт не менялись: `User360Recommendation.title` остаётся и тождественен канону
  по построению.
- **Комментарий-источник в `domain/today/today.ts`** обновлён: он объявлял единым источником
  `config/labels`, что после выведения стало неточным (источник — каталог, `config/labels` — единый
  mapping для UI).
- **Цикла нет:** `domain` не импортирует `@/config/labels`; `catalog.ts` тянет только `identity/roles`
  и `signals/signal` (оба type-only), поэтому `labels.ts → catalog.ts` (value-импорт) безопасен —
  тот же приём, что у `FINANCIAL_HIDDEN_LABEL` (D-40).

### Результаты проверок
- `typecheck` ✅ · `lint` ✅ · `test:run` ✅ **439/439** (все 425 прежних сохранены + 14 новых:
  10 map-consistency, по 1–2 экранных на Users/Today/User 360) · `build` ✅ · `test:e2e` ✅ **41/41**
  (прежний состав сохранён полностью, новых не добавлялось — layout не менялся, скриншоты не требуются).
  `npm audit` — те же 11 не устранённых next-внутренних advisories (D-26); `audit fix` не выполнялся.
  `package.json` / `package-lock.json` не менялись.
- Экранные тесты берут ожидаемую строку **из каталога**, а не из вставленного литерала — они проверяют
  «экран согласен с каноном». Три конкретные строки дополнительно пиняются литералами, иначе
  self-referential проверка `label === title` прошла бы и при откате к короткому варианту.

### Не входит (сознательно)
Mutations и Phase 1B4 — **не начаты**. Права, identity-проекция, exact-financial visibility, провайдер-семантика
не менялись. `reason`/`urgency`/`permissions` рекомендаций не трогались, tone of voice не переписывался.
Backend / database / Prisma / Pocket отсутствуют. Зависимости не добавлялись.

---

## Phase 1B4-A — Mutation core + addNote (provider-only) ✅

Первая часть Phase 1B4. Mutation infrastructure и одна реальная мутация **только** на уровне
domain/provider/storage. Подробности: `docs/MUTATION_OVERLAY.md`, решения D-53…D-57.

**UI не создавался и не менялся в этой фазе.** Формы добавления заметки нет, кнопки нет, оптимистичного
React-состояния нет. *Обновлено: экранная часть выполнена в **Phase 1B4-B** (см. раздел ниже) — заметку
теперь можно добавить из секции «Заметки» на User 360.*

### Permission preflight (до кода)
Матрица позволила определить Edit-роли однозначно, поэтому этап не останавливался. §0 относит `notes`
к измерению Edit; §1 задаёт объём. Решающее наблюдение: среди ролей с Edit=Limited **`support` —
единственная**, в чьей скобке перечислены `notes` («support cases/tasks/**notes**»), тогда как у
mentor («mentor tasks/cases, reports»), moderator («moderation cases») и content_manager
(«content-related») их нет. Перечисление прочитано как **исчерпывающее** — это чтение матрицы, а не
новая матрица (D-53).

**Разрешено:** `crm_admin`, `crm_manager`, `retention_manager` (Edit=Full) + `support` (Limited, notes названы явно).
**Запрещено:** `mentor`, `moderator`, `content_manager` (Limited без notes), `analyst`, `read_only` (Edit=None).

### Выполнено
- **Отдельный контракт `CrmMutations`** (`data/contracts/CrmMutations.ts`) с **ровно одной** операцией
  `addNote(ctx, command)`. Пустых методов будущих мутаций не добавлено: член интерфейса без реализации —
  обещание, которого провайдер не держит, а `as never` ради placeholder-формы уже удаляли в D-50.
  `MockCrmDataProvider implements CrmDataProvider, CrmMutations` — без приведений типов.
- **Централизованное mutation-право.** `Permission` += `edit_user_notes`; `access.ts` → `canEditUserNotes(role)`.
  Не выводится из видимости финансов и не переиспользует `assign_owner` — это другие измерения §1.
  Существующие права просмотра identity/financials **не расширялись**.
- **Notes domain** (`domain/notes/`). `CrmNote` перенесён из контракта в домен и **ре-экспортируется**
  контрактом — как `TodayWorkspace` (D-50) и `User360` (D-35); второго несовместимого типа нет.
  Поля: `id, userId, caseId, authorEmployeeId, body, visibility, pinned, createdAt, updatedAt, mock: true`
  (`authorId` → `authorEmployeeId`, добавлены `updatedAt` и mock-маркер).
- **Единый canonical note projector** (`domain/notes/note-projection.ts`) — единственное место правила
  «кому видна заметка»: `team` — всем 9 ролям (User 360 доступен всем, §2); `private` — **только автору**;
  `role_restricted` — **скрыта всегда**; неизвестное значение — скрыта (D-55).
- **`getUserNotes` больше не игнорирует `ctx`.** Объединяет fixture-generated и overlay-заметки, проецирует
  через тот же projector **до** пагинации, затем сортирует (`pinned` → `createdAt desc` → `id`).
  Скрытые не входят в `page.total`, не заменяются плейсхолдером, их тело не протекает через `Result`.
  **User 360 заметки не читает вообще** — второго пути чтения нет, расхождению правил неоткуда взяться.
  *(Обновлено в Phase 1B4-B: читатель появился и использует тот же `getUserNotes` — D-58.)*
- **AuditRecord** (`domain/audit/`) — immutable, `action: "note_added"`, `reasonCode` — закрытый enum,
  `mock: true`. **Тела заметки, email, телефона, финансовых значений и произвольного текста не содержит.**
  Audit UI и read endpoint не создавались.
- **Versioned overlay** `ata-crm.mutation-overlay.v1` (`version/sequence/notes/auditRecords/idempotencyReceipts`).
  Не смешан с `ata-crm.mock-state.v1` и `ata-crm.mock-role.v1`. Fail-closed parse: corrupt JSON / unknown version /
  invalid shape / потерянный `mock` / чужой `visibility` → **пустой overlay целиком**. SSR не обращается к
  localStorage. Запись атомарно заменяет весь overlay; есть `clear()` для будущей кнопки сброса (**UI сброса не делался**).
  Фикстуры неизменяемы.
- **Storage ownership.** Один adapter на провайдер (создаётся в конструкторе, не на каждый вызов);
  `getCrmDataProvider` кэширует провайдер → одна browser session = один adapter. Тесты внедряют
  `MemoryKeyValueStorage` через `MockProviderOptions` — **ни один unit-тест не трогает настоящий localStorage**;
  тот же путь даёт controlled initial overlay.
- **Детерминизм (D-57).** `note_mock_0001` / `audit_mock_0001` из персистентного `sequence`;
  timestamp = `clock.nowMs() + sequence`; tie-break по `id`. Ни `Math.random()`, ни случайных UUID,
  ни настоящего `Date.now()`. `idempotencyKey` как entity id не используется.
- **Идемпотентность.** Тот же ключ + тот же нормализованный payload → исходный результат, `replayed: true`,
  без второй заметки и без второго audit. Тот же ключ + другой `userId`/`body`/actor → `conflict`.
  Receipt хранит fingerprint (два прохода FNV-1a с префиксами длины), **не тело**; crypto-зависимость не добавлялась.
- **Валидация.** `body`: trim, пустое → `invalid_input`, > **2000** → `invalid_input`, plain text (не HTML).
  `idempotencyKey`: обязателен, trim, непустой, ≤ **200**.
- **Коды ошибок.** Существующие `Result<T>`/`CrmError`; параллельной системы нет. Отказ по правам —
  **`unauthorized`**, а не новый `forbidden`: такого кода в `CrmErrorCode` не существует, и второй код
  с тем же смыслом — та самая рассинхронизация, которую закрывали D-40 и D-52 (**D-56**).

### Результаты проверок
- `typecheck` ✅ 0 ошибок · `lint` ✅ 0 warnings/errors
- `test:run` ✅ **569/569** (все 439 прежних сохранены + 130 новых: 66 add-note, 23 overlay, 18 notes-privacy,
  15 note-projection, 8 `canEditUserNotes`)
- `build` ✅ production build успешна (18 routes; размеры страниц не изменились)
- `test:e2e` ✅ **41/41** — прежний состав сохранён полностью, новых не добавлялось (UI не менялся, скриншоты не требуются)
- `npm audit` — те же 11 не устранённых next-внутренних advisories (D-26); `audit fix` не выполнялся.
  `package.json` / `package-lock.json` не менялись.
- **Regression доказан подменой:** projector «всё видно» роняет **15** тестов (включая явный
  «getUserNotes — context actually matters»); permission-правило «всем можно» — **20**.
- **Скриншоты не коммитятся.** Прогон E2E перезаписал 8 исторических PNG. Проверено декодированием в TIFF:
  6 из них — шум (11–87 байт, дельта ≤ 3), а `today-filtered` расходится **сам с собой между двумя прогонами
  одного и того же кода** (8.8%) → недетерминированный скриншот. Для `users-columns-after-scroll` (3.8%)
  проведён контрольный опыт: E2E на **чистом HEAD** (мои изменения в stash) даёт байт-в-байт **тот же**
  файл, что и с изменениями (0 байт разницы), и **то же** расхождение с закоммиченным PNG (148667 байт).
  Вывод: расхождение предсуществующее и средовое (прежние фазы гоняли гейты в изолированной Linux-копии,
  текущая машина — macOS), к изменениям Phase 1B4-A отношения не имеет. Все PNG восстановлены к HEAD.

### Не входит (сознательно)
UI-форма добавления заметки, кнопка, оптимистичное React-состояние, пересчёт очереди Today —
**Phase 1B4-B** (форма и список выполнены там; оптимистичного состояния не появилось и там — D-60;
пересчёт очереди Today не делался). Не реализованы: `createTask`, `updateTask`, `createCase`, `updateCase`,
owner assignment, signal resolution, recommendation acceptance, reveal PII, audit-экран, reset-кнопка в UI,
редактирование/удаление заметок. Матрица прав, identity-проекция и exact-financial visibility **не расширялись**
(добавлено ровно одно право `edit_user_notes`). Today derivation и подписи рекомендаций не менялись.
Backend / API / database / Prisma / Pocket отсутствуют. Зависимости не добавлялись. Secrets/.env не появлялись.

### Известные ограничения (не скрыты)
- `private` и `role_restricted` **невозможно создать** через `addNote` (D-54) и они fail-closed при чтении (D-55).
  Полноценная поддержка требует metadata-контракта (владелец приватной записи, список разрешённых ролей) — отдельное решение.
- Заметки **нигде не отображаются**: `getUserNotes` полностью реализован и permission-aware, но потребителя-экрана
  у него пока нет. Это ожидаемо для provider-only фазы, а не упущение. *Закрыто в Phase 1B4-B: потребитель —
  секция «Заметки» на User 360.*
- `AuditRecord` только пишется — читать его пока нечем (audit read endpoint/экран вне scope).


---

## Phase 1B4-B — User 360 Notes + Add Note UI ✅

Вторая часть Phase 1B4: у заметок появился экран. Подробности: `docs/USER_360.md` §Заметки,
ревью: `docs/visual-reviews/PHASE_1B4_B_ADD_NOTE.md`, решения D-58…D-63.

**Это единственная мутация во всём приложении.** Today и Users не менялись; рекомендации по-прежнему
без контрола выполнения.

### Выполнено
- **Композиционный корень отдаёт один инстанс.** `application/provider.ts`: внутренний
  `resolveProvider(state)` + `getCrmDataProvider()` (read) и `getCrmMutations()` (мутации). Оба
  **сужают один и тот же** закэшированный `CrmDataProvider & CrmMutations` — без `as unknown as`,
  без `as never`, без `new MockCrmDataProvider()` в хуках. Это не эстетика: провайдер владеет одним
  overlay-адаптером (MUTATION_OVERLAY §3), поэтому второй инстанс был бы вторым адаптером над тем же
  storage, и запись через один могла бы не читаться через другой — недетерминированно и только в
  браузере. Закреплено regression-тестом на идентичность (D-58, `provider.test.ts`).
- **Секция «Заметки»** в основной колонке User 360 после «Недавних событий», на существующем
  `SectionCard` (мутирующий контрол в `aside` не кладётся — контракт компонента это запрещает).
  Файлы: `components/user-notes.tsx`, `components/note-composer.tsx`, `hooks/use-user-notes.ts`,
  `hooks/use-add-note.ts`, `lib/note-error.ts`; строки — в `config/labels.ts` (`NOTES_LABEL`,
  `NOTE_VISIBILITY_LABEL`).
- **Заметки — отдельный permission-aware read (D-58),** а не поле агрегата: правило приватности
  на каждой заметке живёт в одном projector'е, чей единственный потребитель — `getUserNotes`.
  React список **не фильтрует и не сортирует**. Второе чтение изолировано: его loading не задерживает
  профиль, его ошибка не подменяет экран `ErrorState`, retry действует только на секцию. Читается тот
  же default-provider state, что и в `useUser360Query` (Today demo-state не читается — это был бы
  другой инстанс).
- **Права — только `canEditUserNotes(role)` (D-59).** Форма у `crm_admin`, `crm_manager`,
  `retention_manager`, `support`. Пяти запрещённым ролям **не рендерится ни textarea, ни submit, ни
  disabled-контрол** — только строка «Ваша роль не может добавлять заметки». Список заметок остаётся
  виден всем девяти ролям (чтение — «View User 360», другое право). Матрица прав, identity- и
  financial-проекции **не расширялись**. Смена роли при открытом композере убирает форму на том же
  рендере; провайдер остаётся последней защитой.
- **Inline-композер (D-59):** desktop — textarea в секции; mobile — свёрнут в кнопку 44 px с
  `aria-expanded` и раскрытием inline (не Dialog, не Sheet). `maxLength` и клиентская валидация берут
  `NOTE_BODY_MAX_LENGTH` и `normalizeNoteBody` **из домена** — литерала `2000` в UI нет. Тело —
  plain text, HTML не интерпретируется.
- **Idempotency-ключ (D-61):** `` `${useId()}:${userId}:${attempt}` `` — без `Math.random`, `Date.now`,
  `crypto` и новых зависимостей. Повторяется на retry после `internal` и на двойном submit; обновляется
  после success и после conflict; правка черновика ключ не создаёт; пользователю не показывается.
- **Двойной submit** не создаёт дубль на обоих уровнях: `disabled` + ref-guard в UI и replay по тому же
  ключу в провайдере (`produce()` после `gate` синхронен, поэтому второй вызов видит receipt первого).
- **Никакого optimistic update (D-60):** submit → provider result → refetch `getUserNotes` → перерисовка.
  Доказано тестом: провайдер продолжает отвечать «заметок нет» → экран говорит «заметок нет».
  `replayed: true` обрабатывается как обычный успех, без техносообщений.
- **Ошибки (D-62):** локальная **тотальная** `Record<CrmErrorCode, string>` — новый код союза не
  скомпилируется. `ErrorState` намеренно не переиспользован: его ветка `internal` печатает
  `error.message` сырым, а `addNote` возвращает там английское `"Mock overlay could not be persisted."`.
- **A11y:** заголовок секции, видимая подпись поля, счётчик через `aria-describedby`, `aria-invalid`,
  ошибка `role="alert"`, success `role="status"`/`aria-live` без таймера, pending словами
  («Сохраняем…») и `aria-busy`, возврат фокуса в textarea, `aria-expanded` у мобильного раскрытия,
  запрещённая роль не получает hidden/disabled контролов, keyboard submit, 200 % zoom.
- **Исправлены два дефекта фикстуры (D-63),** ставшие видимыми, когда у заметок появился читатель:
  тело засеянной заметки печатало **raw enum-код** `support_blocked` (ловилось существующим тестом
  «shows no raw enum codes anywhere»), а `createdAt = now` делал её неотличимой от только что
  написанной («только что» на каждой загрузке). Теперь — человеческая фраза и детерминированная дата
  «2 дня назад». Схема overlay не менялась.

### Результаты проверок
- `typecheck` ✅ 0 ошибок · `lint` ✅ 0 warnings/errors
- `test:run` ✅ **633/633** (все 569 прежних сохранены + 64 новых: 5 provider-composition,
  20 permissions × 9 ролей, 39 notes UI — состояния списка, валидация, mutation, ключ, ошибки)
- `build` ✅ production build успешна (19 routes; `/users/[id]` 8.55 kB → **10.4 kB** / 174 kB)
- `test:e2e` ✅ **59/59** (все 41 прежний сохранён + 18 новых). Консоль чистая, hydration-warnings нет
- `npm audit` — те же 11 не устранённых next-внутренних advisories (D-26); `audit fix` не выполнялся.
  `package.json` / `package-lock.json` не менялись, зависимости не добавлялись
- **Один существующий тест-хелпер поправлен:** `stubProvider` в `user-360-workspace.test.tsx` теперь
  отвечает и на `getUserNotes`. Это следствие настоящего второго чтения экрана, а не ослабление:
  ни одна проверка не удалена и не изменена, все 19 сценариев сохранили смысл
- **Hydration:** client-mount pattern, необходимый `<input type="search">` в тулбарах (autofill-агент
  Chromium), для `<textarea>` не понадобился — проверено эмпирически, 0 warnings в каждом E2E-сценарии

### Не входит (сознательно)
Редактирование и удаление заметок, pin/unpin, выбор `visibility` (новая заметка всегда `team`, D-54),
пагинация заметок (рендерится первая страница, `pageSize: 50`), заметки в Today и в таблице Users,
toast-инфраструктура, audit-экран и read endpoint, кнопка сброса overlay, `createTask`/`updateTask`/
`createCase`/`updateCase`, owner assignment, signal resolution, recommendation completion, reveal PII.
Матрица прав, identity-проекция и exact-financial visibility **не расширялись**. Backend / API /
database / Prisma / Pocket отсутствуют. Зависимости не менялись. Secrets/.env не появлялись.

### Известные ограничения (не скрыты)
- **Пагинации нет:** если у пользователя когда-нибудь окажется больше 50 видимых заметок, UI покажет
  первую страницу и не предложит подгрузить остальное.
- **Ключ не воспроизводим между монтированиями композера** (`useId` берёт префикс из счётчика на
  реалм). Для idempotency-ключа это правильно — свежий композер не должен наследовать израсходованный
  ключ, — и ни на что не влияет: ключ не entity id и не рендерится (D-61).
- **`conflict` из корректного UI практически недостижим** (ключ обновляется после успеха); ветка
  реализована и покрыта тестами как защитная.
- **`not_found` проверяется в провайдере раньше `unauthorized`**, поэтому запрещённая роль могла бы
  зондировать существование пользователя через `addNote`. Из UI путь недостижим (формы у этих ролей
  нет), импакт нулевой (User 360 открыт всем девяти ролям), но свойство зафиксировано.
- **Заметка «нигде больше не отображается»** — долг 1B4-A закрыт для User 360 и остаётся для Today и
  Users, где заметок нет и не планировалось.

---

## Phase 1B4-C — Primary Owner Assignment ✅

Вторая мутация CRM: назначение/снятие primary owner на User 360. Решения D-64…D-74. Ревью:
`docs/visual-reviews/PHASE_1B4_C_ASSIGN_OWNER.md`.

### Выполнено
- **Overlay расширен аддитивно в пределах v1** (D-64): тот же ключ `ata-crm.mutation-overlay.v1`, та же
  `version: 1`. История владельца — записи `primary_owner_changed` в существующем `auditRecords`
  (D-65), отдельного `ownerAssignments[]` нет. Guard'ы приняли по одному новому допустимому значению
  action/entityType/reasonCode/receipt-kind; всё прочее по-прежнему fail-closed. Обязательный
  regression-тест: raw overlay 1B4-B собран вручную, читается новым парсером без потерь, после
  owner-мутации старые заметки и новый owner-change сосуществуют.
- **AuditRecord → discriminated union** по `action` (D-66); owner-запись несёт `previousOwnerId`/
  `nextOwnerId` (LOW/CRM-owned, сам факт изменения; `null` = снят). Без PII/финансов/свободного текста/
  ключа/лейбла. Audit UI и read endpoint не создаются.
- **Canonical employee directory** `src/domain/identity/employees.ts` (D-67): `employeeId`/`displayName`/
  `primaryOwnerCandidate`. `OWNER_LABEL` и опции owner-фильтра Users **выводятся** из него; убран дрейф
  (было 9/6/5 разных списков). Кандидаты === distinct non-null владельцы baseline (consistency-тест).
  Raw id больше не fallback-подпись — неизвестный → «Неизвестный сотрудник».
- **`getPrimaryOwnerCandidates`** (D-68): узкий permission-aware read, отдельно от `getUser360`; роли без
  Assign → `unauthorized`, не пустой список. Возвращает только id и подпись.
- **`assignPrimaryOwner`** (D-69): actor из ctx; `ownerId: null` = снятие; `expectedOwnerId` = оптимистичная
  конкуренция (D-72). Права — `crm_admin`/`crm_manager`/`retention_manager`, матрица не расширена; `support`
  пишет заметки, owner не назначает. Порядок `invalid_input → not_found → unauthorized → conflict → write`.
- **Один effective-owner resolver** (D-70): baseline, перекрытый последней owner-записью; fixtures
  неизменяемы (мелкий клон). User 360 / Users (колонка/фильтр/сортировка) / Today (row/фильтр/
  `summary.unassigned`/`filterOptions.owners`) / task-case / queue — все читают отсюда. Derived-cache
  сверяет owner и инвалидируется, в т.ч. при записи другим инстансом над тем же storage.
- **Автор засеянной заметки заморожен** по baseline (D-71): переназначение не переписывает авторство.
- **UI** в секции «Ответственный и работа» (D-74): нативный `<select>` (5 кандидатов + «Без
  ответственного»), явная кнопка «Сохранить», три роли получают форму / шесть — строку без контрола.
  Никакого optimistic update — refetch всего `getUser360`. Состояния: unchanged / pending / success /
  conflict / forbidden / not_found / internal / upstream_unavailable. Тотальная `Record<CrmErrorCode,
  string>` — raw `CrmError.message` в UI не рендерится. A11y: label, aria-live/role=alert, keyboard,
  44px, focus-возврат, 200% zoom, no overflow.
- **Соседний фикс** `useAddNote` (D-74): idempotency attempt сбрасывается при смене session identity.

### Результаты проверок
- `lint` ✅ 0 · `typecheck` ✅ 0 · `build` ✅ (19 routes; `/users/[id]` → 11.3 kB)
- `test:run` ✅ **799/799** (прежние 633 сохранены + 166 новых: overlay-backcompat 20, employees 13,
  assign-owner 62, owner-consistency 13, owner UI 57, notes-regression +1)
- `test:e2e` ✅ **85/85** (прежние 59 сохранены + 26 новых; консоль чистая, hydration-warnings нет)
- `npm audit` — те же не устранённые next-внутренние advisories (D-26); `audit fix` не выполнялся.
  `package.json`/`package-lock.json` не менялись, зависимости не добавлялись.
- **Адаптированы (не ослаблены) существующие тесты:** `today-provider` read-only-скан (теперь допускает
  ровно `assignPrimaryOwner` и запрещает Today-мутаторы), `user-360-workspace` stub (+`getPrimaryOwnerCandidates`;
  read-only-проверка рекомендаций сужена до своей секции), `user-notes.spec` локаторы формы (scoped к
  форме заметок — на экране теперь две формы). Ни одна проверка не удалена, смысл сохранён.

### Не входит (сознательно)
Task/case mutations, task/case assignees, notes edit/delete/pin, signal resolution, recommendation
completion, team management, scope `own/team/all`, bulk assignment, assignment UI в таблице Users и в
Today, audit-экран и read endpoint, reset-overlay UI, reveal PII, backend/API/database/Prisma/Pocket.
Матрица прав, identity-проекция, exact-financial visibility **не расширялись**. Зависимости не менялись.
Secrets/.env не появлялись.

### Известные ограничения (не скрыты)
- **Live cross-tab sync нет** (D-72): открытая старая вкладка Users/Today/User 360 может остаться stale
  до следующего read/remount/navigation; storage-listener не добавлен.
- **`not_found` раньше `unauthorized`** — сохранённая mock-семантика (то же свойство, что у `addNote`):
  запрещённая роль могла бы зондировать существование пользователя, но из UI путь недостижим (формы нет),
  импакт нулевой (User 360 открыт всем).
- **Полный `UserOwner`** (ownerRole/assignedBy/reasonCode/структурированная history) — будущая форма; mock
  хранит owner скаляром + audit-лог как историю.

---

## Phase 1B4-C.1 — Zoom Reflow Acceptance Fix ✅

Узкая acceptance-коррекция Phase 1B4-C: без изменения продукта. Mutation/overlay/permissions/fixtures не
тронуты.

### Root cause
Acceptance-кадр 200% zoom (`final/owner-zoom-200.png`) снимался неверным методом — `documentElement.style.
zoom = "2"` на viewport 1440×900. Это не моделирует браузерный zoom (media queries по-прежнему видят
1440px, layout не reflow'ится — десктопная 2/3+1/3-композиция масштабируется 2× и обрезается), а
использованная метрика `documentElement.scrollWidth − clientWidth` под CSS `zoom` даёт ложный 0, тогда как
реальный overflow (34px) сидел во вложенном `#crm-content`. Ровно этот анти-паттерн 1C-suite задокументировала
как неверный.

### Правка
Только метод capture в тесте: 200% zoom моделируется как **halved CSS-viewport 720×450** (принятая модель
1C/Today-suite). При ней уже существующий responsive-shell reflow'ится штатно: `lg:`-sidebar скрыт,
workspace одноколоночный, «Состояния» → `sm:grid-cols-3` (столкновение текста исчезает), owner-секция
full-width в пределах viewport. Продуктовый CSS/layout не менялся — это была бы подгонка под ложную метрику.

### Тесты
Zoom-тест переписан и усилен до проверки реальной геометрии (document + вложенный `#crm-content` overflow,
секции в пределах viewport и не свёрнуты, bbox-непересечение подписей/значений «Состояний», owner
select/Save достижимы и ≥44px, keyboard, не-обрезанность success, чистые console/hydration; обратная
regression против скрытия колонки и пустого полотна). E2E **85 → 86** (один тест заменён двумя; прежние
сохранены). Unit/component — **799** без изменений.

### Результаты проверок
- `lint` ✅ 0 · `typecheck` ✅ 0 · `build` ✅ (19 routes) · `test:run` ✅ 799/799 · `test:e2e` ✅ 86/86
- `npm audit` — те же baseline-advisories (D-26), fix не выполнялся; `package.json`/`package-lock.json` не менялись.
- Скриншоты: `screenshots/phase-1b4-c-assign-owner/zoom-acceptance-fix/` (4 кадра 720×450); `final/` и
  прошлые фазы не перезаписаны.

---

## Phase 1B4-D — User 360 Note Pin / Unpin ✅

Третья мутация CRM: закрепление/открепление заметки на User 360. Решения D-75…D-81. Ревью:
`docs/visual-reviews/PHASE_1B4_D_NOTE_PIN.md`.

### Выполнено
- **`setNotePinned(ctx, command)`** в `CrmMutations` (теперь ровно `addNote` + `assignPrimaryOwner` +
  `setNotePinned`). Actor из `ctx`, никогда из команды. Команда — конечное состояние `pinned` +
  `expectedPinned` (D-78). Порядок: `invalid_input → not_found → unauthorized → idempotency → expectedPinned
  → write`; отказ по правам — `unauthorized` (D-56).
- **Право переиспользовано** `canEditUserNotes` / `edit_user_notes` (D-75): pin — это редактирование
  заметки. Матрица не расширена, нового permission нет. Закрепляют `crm_admin`/`crm_manager`/
  `retention_manager`/`support`; пять остальных ролей контрола не видят вовсе (D-59).
- **Любая видимая заметка pinnable** (D-76): fixture, authored, `private` для автора. Поиск заметки в
  мутации — через тот же `resolveEffectivePins → projectNotes`, что и чтение, поэтому скрытая заметка и
  несуществующая дают один `not_found` — API нельзя использовать как зонд.
- **Effective pin из audit-лога** (D-77): единый резолвер `resolveEffectivePins` (`domain/notes/
  note-projection`): базовый `note.pinned` ⊕ последняя `note_pin_changed` для `note.id` (по `at`, затем
  по audit id), применяется ДО `sortNotes`. Ни fixture, ни overlay-заметка не мутируются. Отдельного
  `notePins[]` нет.
- **Overlay расширен аддитивно в v1** (D-64/D-77): тот же ключ, `version:1`. Новый член union
  `AuditRecord` (`note_pin_changed` c `previousPinned`/`nextPinned` — только факт, без body/PII/финансов/
  ключа), новый receipt-kind `note_pin_change`. Guard'ы приняли по одному значению; всё прочее fail-closed.
  Обязательный regression: raw 1B4-B и 1B4-C overlay читаются без потерь, pin сосуществует с заметками и
  owner-историей.
- **UI** в секции «Заметки»: у каждой видимой заметки нативная кнопка (pin-глиф, accessible name — полная
  инструкция), `aria-pressed`, ≥44×44, клавиатура, focus-visible. Закреплённая — спокойный бейдж
  «Закреплено» (info-тон, без toast/красного/glow). Никакого optimistic update — refetch `getUserNotes`
  (D-79); порядок реально меняется. Состояния: idle/pending/success(«Заметка закреплена/откреплена»)/
  conflict(перечитать + «Состояние заметки уже изменилось…»)/forbidden(нет контрола)/not_found/internal/
  upstream_unavailable. `CrmError.message` в UI не рендерится — тотальный `Record<CrmErrorCode, string>`
  (`note-pin-error.ts`, D-62).
- **Фокус** возвращается на контрол той же заметки после settled refetch, даже если она всплыла наверх —
  по `note.id`, не по DOM-позиции (D-81). Смена роли очищает pending/success/error и сбрасывает attempt.
- **Pin не влияет** на Today/Users/priority/SLA/owner/tasks/cases/financials/visibility/body (D-80).

### Результаты проверок
- `lint` ✅ 0 · `typecheck` ✅ 0 · `build` ✅ (19 routes; `/users/[id]` → 12.4 kB)
- `test:run` ✅ **872/872** (прежние 799 сохранены + 73 новых: set-note-pinned 37, note-pin UI 19,
  note-projection resolver +7, overlay-backcompat +10). Адаптирован (не ослаблен) `today-provider`
  read-only-скан: допускает ровно `assignPrimaryOwner` + `setNotePinned`, Today-мутаторы запрещены.
- `test:e2e` ✅ **100/100** (прежние 86 сохранены + 14 новых; консоль чистая, hydration-warnings нет)
- `npm audit` — те же baseline-advisories (D-26), fix не выполнялся; `package.json`/`package-lock.json`
  не менялись, зависимости не добавлялись.
- Скриншоты: `screenshots/phase-1b4-d-note-pin/{first-pass,final}/` (9 final-кадров); прошлые фазы не
  перезаписаны (restored к HEAD после прогона).

### Не входит (сознательно)
Note body edit, note delete, note visibility change, `private`/`role_restricted` creation, task/case
mutations, task/case assignees, signal resolution, recommendation completion, owner changes, bulk pin,
pin в таблице Users и в Today, audit-экран и read endpoint, cross-tab listener, toast-инфраструктура,
reset-overlay UI, backend/API/database. Матрица прав, identity-проекция, exact-financial visibility **не
расширялись**. Зависимости не менялись. Secrets/.env не появлялись.

### Известные ограничения (не скрыты)
- **Live cross-tab sync нет** (как в 1B4-C): открытая старая вкладка может остаться stale до следующего
  read/remount/navigation; storage-listener не добавлен.
- **`not_found` раньше `unauthorized`** — сохранённая mock-семантика (та же, что у `addNote`/
  `assignPrimaryOwner`): запрещённая роль могла бы зондировать существование, но из UI путь недостижим
  (контрола нет), импакт нулевой (User 360 открыт всем).

---

## Phase 1B5-B — Global Audit Workspace (read-only) ✅

`/audit` перестал быть `SectionPlaceholder` и стал полноценным read-only ledger-экраном
browser-local mutation-overlay audit-записей. Подробности решений: D-86…D-90; ревью:
`docs/visual-reviews/PHASE_1B5_B_AUDIT_WORKSPACE.md`.

- **Provider contract:** новая read-операция `getAuditRecords(ctx, { page? }) → Result<Paginated<AuditRecordView>>`.
  Порядок: `canViewAudit` → unauthorized при false (до чтения storage) → read overlay → project → sort → paginate.
  `CrmMutations` не изменён (ровно addNote/assignPrimaryOwner/setNotePinned/updateNoteBody).
- **Safe read-model:** `AuditRecordView` (`domain/audit/audit-view`) — discriminated union, provider-owned;
  никаких raw employee/note/user id, тела/фрагмента заметки, email/телефона/финансов, idempotency key,
  reasonCode, storage diagnostics. `id` — только React key и tie-break, не рендерится.
- **Canonical sorter/projector:** `sortAuditRecords` (`at` DESC, затем `id` DESC, на копии, без мутации
  append-only массива) + `projectAuditRecord`/`projectAuditRecords`. Имена: actor/owner через `ownerLabel`
  (unknown → «Неизвестный сотрудник», null → «Не назначен»), target через dataset display name
  (unknown → «Неизвестный пользователь»); raw id никогда не fallback.
- **Permissions:** данные — только crm_admin/crm_manager (`canViewAudit`). Семь section-visible ролей видят
  пункт навигации; пять Limited (retention_manager/mentor/support/moderator/analyst) на `/audit` получают
  restricted-state; content_manager/read_only не видят пункт и при прямом заходе тоже получают restricted-state.
  Матрица/`SECTION_VISIBILITY`/`canViewAudit` не изменены.
- **Overlay safety:** только новый reader существующих `auditRecords`; storage key/`version`/структура/guards/
  receipts/sequence/resolvers не тронуты. Corrupt overlay → fail-closed empty-state; storage failure
  (`gate`/errorMode → `upstream_unavailable`) → локализованный error-state с retry, без raw diagnostics.
- **UI:** одна плотная chronological ledger-секция (не dashboard, не карточка-на-событие); pin direction
  словами; page size 20, pagination только при наличии следующей страницы; browser-local demo-подпись,
  без дублирования верхнего DEMO MODE. Один h1, headings у empty/restricted/error, клавиатурная pagination,
  реальный 200% reflow (720×450), zero horizontal overflow.
- **Отложено (D-90):** note-visibility-aware audit projection и User 360 Limited audit-preview — будущие фазы;
  текущая фаза не создаёт private/role_restricted notes.

---

## Phase 1B5-C — User 360 Note Visibility Change ✅

Автор заметки (с правом `edit_user_notes`) меняет видимость своей overlay-заметки
team ↔ private в секции «Заметки» User 360. Решения: D-91…D-95; ревью:
`docs/visual-reviews/PHASE_1B5_C_NOTE_VISIBILITY.md`.

- **Mutation:** `setNoteVisibility(ctx, { userId, noteId, visibility: "team"|"private",
  expectedUpdatedAt, idempotencyKey })`. Порядок и инварианты — как `updateNoteBody`
  (D-93): desired end-state, `expectedUpdatedAt` concurrency, replay до предусловия,
  один mutation-timestamp, атомарный write; переписываются только `visibility`+`updatedAt`.
- **role_restricted отложен (D-91):** не в UI, не принимается командой → `invalid_input`;
  остаётся будущей фазой до появления модели allowed roles.
- **Authored + author-only (D-91):** менять можно только заметку в overlay `notes[]`,
  созданную тем же `actorEmployeeId`; фикстурная → `invalid_input`; чужая → `unauthorized`.
- **Private — по identity (D-92):** private-заметку видит только автор; смена **роли**
  при неизменном `actorEmployeeId` её не скрывает; другой сотрудник (включая admin)
  не видит; провайдер отдаёт `getUserNotesView.capabilities.canChangeVisibility`.
- **Overlay/audit аддитивны (D-93):** ключ/version/поля неизменны; пятый union-член
  `note_visibility_changed`, receipt kind `note_visibility_change`; guard'ы fail-closed
  на role_restricted/неизвестных значениях; legacy 1B4-B…1B5-B читается без потерь.
- **Global audit (D-94):** `/audit` показывает факт «изменил доступ к заметке», без
  направления team/private, без тела/id/diagnostics; permission и pagination не тронуты.
- **UI:** inline visibility-editor (native select) в строке заметки; один редактор на
  строку (body/visibility взаимоисключающи, draft не теряется молча); контрол-«щит»,
  отличный от pencil/pin; «Приватная заметка» спокойным тоном, словами. Состояния:
  idle/editing/unchanged/pending/success/conflict/invalid/not_found/forbidden/storage/role-change.
- **User 360 Audit Preview НЕ реализован (D-95):** ни read-op, ни permission/helper,
  ни секция; отложен до реального actorId + team/owner scope.
- **Тесты:** unit/component 1087 (было 1021, +66), E2E 143 (было 130, +13), discovery
  143 в 12 файлах.

## Phase 1B6 — User 360 Note Delete ✅

Автор заметки (с правом `edit_user_notes`) удаляет свою overlay-заметку в секции
«Заметки» User 360. Решения: D-96…D-101; ревью:
`docs/visual-reviews/PHASE_1B6_NOTE_DELETE.md`.

- **Mutation:** `deleteNote(ctx, { userId, noteId, expectedUpdatedAt, idempotencyKey })`
  → `Result<DeleteNoteResult{ noteId, deletedAt, audit, replayed }>` (без CrmNote/тела).
  **Hard delete** (D-96): row физически уходит из overlay `notes[]`, tombstone/`deletedAt`
  в `CrmNote` не добавляется, тело в localStorage не остаётся, undo нет.
- **Порядок с replay ДО entity-lookup (D-98):** ключ → ISO `expectedUpdatedAt` → noteId →
  fingerprint → replay(receipt) → user → видимость → `canEditUserNotes` → фикстурная →
  автор → `expectedUpdatedAt` → атомарный write. Replay перед lookup'ом — иначе retry
  после успешного удаления вернул бы `not_found`.
- **Authored + author-only (D-96):** удалять можно только заметку в overlay `notes[]`,
  созданную тем же `actorEmployeeId`; фикстурная → `invalid_input`; чужая видимая →
  `unauthorized`; скрытая чужая/неизвестная → `not_found`. Private удаляется автором по
  тем же правилам, что team.
- **Audit — защитный источник истины (D-97):** append-only `note_deleted` (шестой
  union-член, базовые поля); canonical `hideDeletedNotes` в projection скрывает заметку
  с валидным поздним delete-record (даже в corrupt/legacy overlay с уцелевшим row);
  stale/corrupt delete-record не скрывает; структурно битая запись валит парс fail-closed;
  фикстуру через нормальный путь скрыть нельзя. Старые audit-записи заметки не удаляются.
- **Add-replay после удаления (D-98):** повтор исходного `addNote` ключа возвращает
  original result с `replayed:true`, но заметку НЕ воскрешает (реконструкция из
  audit + payload, без записи row обратно); тело не попадает в receipt/audit; ровно один
  `note_added` и один `note_deleted` в журнале.
- **Overlay аддитивен (D-98):** ключ/version/поля неизменны; receipt kind `note_delete`
  (kind/key/fingerprint/auditId); все шесть audit-actions сосуществуют; legacy
  1B4-B…1B5-C читается без потерь.
- **Global audit (D-99):** `/audit` показывает факт «удалил заметку у …», `detail=null`,
  без тела/visibility/pin/id/diagnostics; permission/pagination/sorting/page-size(20)
  не тронуты.
- **UI (D-100):** provider-owned `canDelete`; отдельный destructive Trash-контрол
  (≥44px, отличим от pencil/shield/pin), нейтральный в idle; inline confirm в строке
  («Удалить заметку?» + «Действие нельзя отменить. История изменения останется в Audit.»,
  «Отменить»/«Удалить»), destructive-тон только в confirm; один active mode на строку;
  без Dialog/Sheet/toast/`confirm()`/undo/bulk. Состояния idle/confirming/pending
  (aria-busy, «Удаляем…», single-call)/success (строка исчезает, `page.total`−1, «Заметка
  удалена», focus → composer)/conflict/not_found/unauthorized/invalid_input/storage
  (confirm остаётся, retry тем же ключом)/role-change; raw `CrmError.message` не рендерится
  (exhaustive `Record<CrmErrorCode, string>`).
- **Tasks/Cases/Signals/Recommendations остаются отложенными (D-101):** до честной
  identity/policy-модели (реальный actorId + scope).
- **Тесты:** unit/component 1155 (было 1087, +68), E2E 156 (было 143, +13), discovery
  156 в 13 файлах.
