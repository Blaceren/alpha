# D1B — React App Shell & Route Field Home (реализация)

Первая настоящая React-реализация Alfa Trade Academy. Портирует в Next.js только
**оболочку приложения** и **Главную** в двух состояниях (активный урок / контрольная точка)
на базе утверждённого **Route Field**. Всё остальное — вне scope D1B.

## 1. Что реализовано

- Аутентифицированная оболочка: app bar (desktop/tablet), mobile top bar, mobile bottom nav (5 пунктов).
- Главная — состояние **Active Lesson** (`/?scenario=active`).
- Главная — состояние **Current Checkpoint** (`/?scenario=checkpoint`).
- Responsive **Route Field** (mobile top-zone route / desktop route-grid).
- Минимальный набор переиспользуемых компонентов (см. §4).
- Реальные screenshots desktop/tablet/mobile + edge (320px, zoom 200%).
- Полный visual QA после рендера в браузере (`design-memory/reviews/d1b-react-home-review.md`).

## 2. Не реализовано (вне scope, намеренно)

`/path`, страницы урока/теста/report/tools/community/news/referrals/mentor/support/profile/
settings; полная система рангов и 20 rank-ассетов; реальная авторизация; backend/API; CRM;
Pocket; Prisma/БД; deploy; D2. Возврат к отклонённым D1A-концептам (sidebar-dashboard, card-grid,
центральная dashboard-карточка, hex-rank, Route Knot как финальный ранг) запрещён.

## 3. Архитектура

```
src/
├── app/(app)/
│   ├── layout.tsx         # AppShell + импорт home.css
│   └── page.tsx           # async: читает searchParams → resolveScenario → <HomeScreen>
├── domain/
│   ├── home.ts            # чистые типы Home + resolveScenario()
│   └── progression.ts     # rankLabel() (провизорные подписи рангов)
├── data/mock/
│   └── home-scenarios.ts  # ЕДИНСТВЕННЫЙ источник состояния Home — getHomeState()
├── features/home/
│   ├── home-screen.tsx    # композиция состояния (server component)
│   └── home.css           # responsive-раскладка (mobile → tablet → desktop)
├── components/
│   ├── shell/             # brand-mark, notification-button, user-avatar, app-shell
│   ├── navigation/        # desktop-route-navigation, mobile-bottom-navigation
│   ├── progression/       # route-field, route-node, module-boundary, route-continuation,
│   │                      #   lesson-plane, module-progress, progress-instrumentation,
│   │                      #   primary-route-action, checkpoint-gate, checkpoint-requirement,
│   │                      #   checkpoint-outcome, future-checkpoint-preview
│   ├── rank/              # provisional-rank-mark
│   ├── mentor/            # mentor-media-placeholder, mentor-context
│   └── ui/                # icon, visually-hidden
└── config/navigation.ts   # каноническая модель навигации (RU labels)
```

**Server components only.** Никакого `"use client"`: детерминированная статическая разметка +
CSS-анимации. Это даёт стабильные screenshots, отсутствие hydration-drift и нулевой клиентский JS
на Главной.

## 4. Ключевые компоненты (переиспользуемые)

| Компонент | Роль |
|-----------|------|
| `AppShell` | skip-link, app bar, mobile top/bottom bars, `<main id="main">`. |
| `RouteField` | декоративный SVG-маршрут (`aria-hidden`) + `sr-only` текстовая альтернатива. Геометрия по scenario и breakpoint (`r-wide`/`r-narrow`). |
| `RouteNode` | светящийся узел текущего уровня (single DOM marker). |
| `LessonPlane` | открытое поле урока (границы top+left, открыто вниз-вправо) — не карточка. Содержит единственный `<h1>` (active). |
| `ModuleProgress` | мини-«спайн» модуля (learning-spine fragment), значение продублировано текстом. |
| `ProgressInstrumentation` | ранг + XP + серия как приборы на маршруте (не KPI-карточки). |
| `PrimaryRouteAction` | единственный CTA (кнопка, не самый яркий объект). |
| `CheckpointGate` | ворота контрольной точки (апертура, рисуется маршрутом). |
| `CheckpointRequirement` | ближняя сторона ворот: условие; `<h1>` (checkpoint); `$200` спокойно. |
| `CheckpointOutcome` | дальняя сторона: следующий ранг + инструмент (два раздельных результата). |
| `FutureCheckpointPreview` | структурный превью дальней границы (active). |
| `ProvisionalRankMark` | провизорный знак ранга (один trace + node) — **не** финальная система рангов. |
| `MentorMediaPlaceholder` / `MentorContext` | backlit-силуэт без лица + контекстная реплика Alex. |

## 5. Сценарии (детерминированные)

- Переключение только через query: `/?scenario=active` | `/?scenario=checkpoint`.
- Резолвинг: `resolveScenario(raw)` → `checkpoint` только при `raw === "checkpoint"`, иначе `active`
  (неизвестное значение безопасно → active). Никакого debug-панеля, тумблера или phase-copy в UI.
- Оба состояния читаются исключительно через `getHomeState(scenario)`. UI не импортирует фикстуры напрямую.

## 6. CTA и незавершённые адресаты

- Метки строго: `Продолжить урок` (active) / `Проверить выполнение` (checkpoint).
- Целевые страницы в D1B не построены. Временное поведение: CTA — **no-op кнопка** (`PrimaryRouteAction`),
  без навигации. Нет 404, нет фейкового «успех», нет перехода в Pocket. Реальная навигация — в фазах уроков/checkpoint.

## 7. Финансовая приватность (жёсткий инвариант)

Никогда не показывается: баланс пользователя, депозиты, выводы, «осталось $X», CTA перехода в Pocket,
deposit-кнопка, фейковые финансовые данные. Единственное разрешённое денежное значение —
`баланс Pocket от $200` + примечание `Учитывается только подтверждённый реальный баланс. Demo не учитывается.`
`$200` — не самый крупный текст (крупнее заголовок-инструкция). Инвариант закреплён тестами
(`src/features/home/home-screen.test.tsx` → privacy suite: запрещённые паттерны отсутствуют, на active
нет ни одного `$`, на checkpoint ровно один `$`).

## 8. Responsive-стратегия

> Обновлено в D1B.1 (`docs/D1B_1_RESPONSIVE_CORRECTION.md`): tablet стал отдельной 2-региональной
> композицией, geometry маршрута разбита на scenario-scoped группы, добавлены safe-area и zoom-reflow.
> Обновлено в D1B.2 (`docs/D1B_2_SHORT_VIEWPORT_FIX.md`): добавлен short-height mode (`@media (max-height:560px)`),
> canonical token `--mobile-bottom-nav-height`, единый window-scroller (`overflow-x: clip`), scroll-padding/
> scroll-margin компенсация фокуса. CTA больше не уходит под bottom nav при 200% zoom / landscape; Alex и
> checkpoint preview на 320px полностью прокручиваются выше nav. **Home завершена после D1B.2.**

- **< 900px (mobile):** stacked-композиция, маршрут в верхней зоне (`a-narrow`/`c-narrow`), mobile top bar
  + bottom nav; `padding-bottom`/`scroll-padding-bottom` учитывают `env(safe-area-inset-bottom)`.
- **900–1199px (tablet):** отдельный state. Active — 2-региональный grid (plane + preview рядом, route как
  диагональ node→preview, `a-tablet`); checkpoint — stacked с воротами сверху (`c-tablet`). Desktop app bar.
- **≥ 1200px (desktop):** grid Route Field — пустая левая колонка (маршрут) · урок (центр) · future-checkpoint
  (справа); `a-wide`/`c-wide`; чекпоинт — near/far с центральными воротами.

Breakpoint навигации (app bar ↔ mobile bars) = 900px; breakpoint композиции/маршрута = 1200px — намеренно
разные. Маршрут — три scenario-scoped группы на состояние; каждый breakpoint показывает только свою.
**200% browser zoom** reflow'ит в compact-композицию (CSS-ширина, без scale-transform), без horizontal overflow.

## 9. Токены и шрифты

Провизорные семантические токены (`src/styles/tokens.css`): deep-navy поверхности, холодный синий +
green/cyan сигнал, controlled glow, дивайдеры. Шрифты через `@fontsource-variable` (Manrope — display,
Inter — UI, JetBrains Mono — значения). Финальные HEX/шрифты остаются провизорными до assets прелендинга.

## 10. Тесты и quality gates

- Unit/component (Vitest + Testing Library): 4 файла, 32 теста — Home active/checkpoint, privacy,
  single-`<h1>`, навигация, resolveScenario, mock-state.
- E2E smoke (Playwright): 9 тестов — 6 состояний (overflow/console/CTA/one-h1) + keyboard (skip-link, CTA) +
  bottom-nav non-overlap.
- Screenshots: `npm run screenshots` → 8 кадров в `design-memory/screenshots/d1b-react-home/final/`.
- `lint`, `typecheck`, `build` — чисто. `npm audit` — 2 moderate (транзитивный внутренний postcss в Next;
  наш прямой postcss патчен; форс-даунгрейд Next отклонён). См. review §4.

## 11. Провизорность

Route Field — утверждённая база для Главной и глобального Пути. Финальная система рангов **не** зафиксирована
(`docs/RANK_IDENTITY_FUTURE_PHASE.md`): в D1B только `ProvisionalRankMark`. Роль/лицо Alex Curie и финальные
visual-tokens не фиксируются без assets.
