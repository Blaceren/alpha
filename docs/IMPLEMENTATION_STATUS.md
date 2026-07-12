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

## Следующий этап (рекомендация)
**Phase 1B — Today workspace + Users table** на реальном mock-провайдере: полный набор из 30 персон, TanStack-таблица Users с фильтрами по 5 измерениям, приоритезированные очереди Today, и localStorage mutation overlay (D-09).
