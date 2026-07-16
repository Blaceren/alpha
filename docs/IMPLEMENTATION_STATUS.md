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
| Phase 1C | **User 360** | выполняется / выполнен (см. ниже) |
| Phase 1B3 | Today Workspace | **отложен** до отдельного решения — не выполнен |
| Phase 1B4 | Mutations overlay | **отложен** до отдельного решения — не выполнен |

Обоснование: провайдер, derivation-слой (signals/priority/recommendations) и permission-проекции
готовы с Phase 1B1, а `/users/[id]` оставался единственным placeholder-ом в уже реализованном
пути «Users → профиль». User 360 закрывает этот путь и не требует mutations overlay, т.к. read-only.
Today (1B3) и mutations (1B4) остаются запланированными и не начинаются автоматически. См. D-34.
