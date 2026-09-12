# FRONTEND_ARCHITECTURE

Frontend foundation Alfa Trade Academy Web V2, заложенный в Phase D1A. Provisional —
развивается в следующих фазах. Backend/CRM/Pocket/database не подключены.

## Стек

| Слой | Выбор | Заметки |
|------|-------|---------|
| Framework | Next.js 16 (App Router, Turbopack) | stable, без experimental-функций |
| Язык | TypeScript strict | + `noUncheckedIndexedAccess`, `noImplicitOverride` |
| Стили | Tailwind CSS 3 + CSS variables | semantic tokens в `src/styles/tokens.css` |
| UI-примитивы | Radix (`@radix-ui/react-tooltip`) | только там, где реально нужно |
| Иконки | `lucide-react` | один согласованный icon set |
| Шрифты | `@fontsource-variable/*` | self-hosted variable fonts (без внешнего fetch) |
| Тесты (unit) | Vitest + Testing Library + jsdom | |
| Тесты (e2e/screens) | Playwright (Chromium) | реальный рендер |
| Package manager | npm | не смешивается с другими |

## Структура

```
src/
  app/
    layout.tsx              # root: fonts, globals, <html lang="ru">
    icon.svg                # provisional favicon
    (app)/
      page.tsx              # "/" — redirect на /concepts (реальная Главная не строится в D1A)
    concepts/               # DEV-ONLY art-direction routes (вне production sitemap)
      page.tsx              # доска сравнения
      product-portal/page.tsx
      market-atlas/page.tsx
      editorial-academy/page.tsx
  components/
    shell/                  # AppShell, TopBar, LogoPlaceholder, NotificationButton
    navigation/             # AppNavigation (desktop), MobileNavigation (bottom + Ещё)
    progression/            # RankBadge, XPIndicator, LearningStreak, ModuleProgress,
                            # PathPreview, PathNode, CheckpointPreview, ToolUnlockPreview
    dashboard/              # PrimaryAction, AlexMessage, homes/{ProductPortal,MarketAtlas,Editorial}
    ui/                     # Button, IconButton, Badge, Tooltip, Surface, Avatar,
                            # VisuallyHidden, icon (lucide registry)
  design-system/
    tokens/tokens.ts        # typed semantic token references
    typography/typography.ts# provisional type scale
    motion/motion.ts        # provisional motion tokens
  domain/
    progression.ts          # pure domain types + label helpers (no UI, no data)
  application/              # (reserved for use-cases; empty in D1A)
  data/
    contracts/              # future backend contract shapes (no network)
    mock/                   # synthetic-state (shared across concepts) + tests
  config/                   # navigation model, concepts metadata
  lib/                      # cn() classname helper
  styles/                   # tokens.css (values), globals.css
  test/                     # vitest setup
  types/                    # ambient module decls (CSS packages)
e2e/                        # Playwright: smoke.spec.ts, screenshots.spec.ts
```

### Правила слоёв
- `domain/` — только типы и чистые функции; без React, без данных.
- `data/mock/` — synthetic-данные, удовлетворяющие `data/contracts/`.
- Визуальные компоненты не содержат бизнес-логики (данные приходят пропсами из page-уровня).
- Нет giant `page.tsx` / `components.tsx` / `types.ts`.

## Design tokens

Значения — в `src/styles/tokens.css` (`:root`, dark-only, provisional). Tailwind (`tailwind.config.ts`)
маппит семантические имена на `var(--token)`. TS-код ссылается на токены через
`src/design-system/tokens/tokens.ts` (`token("accent-primary")`), не хардкодит hex. Полный список из
25 семантических токенов реализован (background-base/deep, surface-*, border-*, text-*, accent-*,
success/warning/danger/info, locked/completed/active/suspended, focus-ring, overlay, path-line/glow).
При получении палитры прелендинга меняются только значения в `tokens.css`.

## Application shell

`AppShell` — общий для трёх направлений: desktop sidebar (`AppNavigation`, одинаковые RU labels) +
`TopBar` (page context, уведомления, avatar) + `MobileNavigation` (bottom, 5 пунктов с «Ещё»;
профиль через avatar). Небольшие композиционные различия допускаются через `sidebarClassName` /
`mainClassName`; navigation model и labels идентичны. Главная колонка grid имеет `min-w-0`, контент —
`overflow-x-clip`, чтобы горизонтальные скроллеры (путь) не давали page-level overflow.

## Данные (D1A)

Единственный источник — `SYNTHETIC_DASHBOARD` (synthetic). Реализует `DashboardProvider`
(`data/contracts`). Никаких реальных данных, secrets, сети, backend. Контракт намеренно **не имеет**
поля баланса пользователя — surface только checkpoint target.

## Скрипты

`dev` · `build` · `start` · `lint` (eslint flat, `eslint-config-next`) · `typecheck` (tsc --noEmit) ·
`test` / `test:run` (vitest) · `test:e2e` (Playwright smoke) · `screenshots` (Playwright captures).

## Известные ограничения D1A

- Реальная Главная и остальные production-маршруты не реализованы (только концепты).
- Логотип, палитра, фото/видео Alex Curie — provisional placeholders.
- Только functional-motion; milestone-сцены вне scope.
- Next lint удалён в Next 16 → ESLint запускается напрямую (flat config).

## Дополнение D1B — React App Shell & Route Field Home

- `/` стал production-Главной: `app/(app)/page.tsx` (async, читает `searchParams`) →
  `resolveScenario` → `HomeScreen`. D1A-концепты и `/concepts`-маршруты сняты.
- **Server components only** на Главной: детерминированная статическая разметка + CSS-motion,
  нулевой клиентский JS, стабильные screenshots.
- Единый источник состояния — `data/mock/home-scenarios.ts` (`getHomeState`); UI не импортирует
  фикстуры напрямую. Контракт по-прежнему без поля баланса пользователя.
- Responsive: два breakpoint — навигация на 900px, композиция/маршрут на 1200px (DD-218).
- Тесты: Vitest (component/unit) + Playwright (`test:e2e` = smoke, `screenshots` = 8 кадров).
- Детали — `D1B_REACT_HOME_IMPLEMENTATION.md`.

## Дополнение D2A — Learning Path

- `/path` — production-страница: server `page.tsx` (async searchParams → `resolvePathScenario`) →
  client `PathWorkspace` (выбор/окно/detail/клавиатура). Главная остаётся server-only.
- Слои: `domain/curriculum.ts` (типы) → `data/curriculum/fixture.ts` (typed канон, 100 уровней) →
  `features/path/model/` (scenario adapter, layout engine, visible window) → `features/path/components/`.
  UI читает только fixture+adapter; raw `les-prog.txt` не импортируется.
- AppShell рендерится страницей (per-page `activeId`); layout `(app)` несёт только CSS.
  `Путь` — реальный Link в обеих навигациях (BUILT_ROUTES = home, path).
- Координатная модель Пути: проценты одного контейнера для DOM и SVG (`PATH_LAYOUT_ENGINE.md`).
- Детали — `D2A_PATH_ARCHITECTURE.md`.

## Дополнение D2B — Lesson Experience

- `/lessons/[levelCode]` — production-страница: server `page.tsx` (async params/searchParams →
  `parseLevelCode` + `resolveLessonScenario`) → client `LessonWorkspace`. `/lessons` — server-redirect
  на текущий урок. `[levelCode]` = стабильный код (`level.018`), другой схемы URL нет (DD-242).
- Слои: `features/lesson/model/` (чистая логика: `lesson.ts` типы, `lesson-progress.ts` media/watch,
  `assessment.ts` вопросы, `lesson-state-machine.ts` композиция) → `features/lesson/data/lesson-fixtures.ts`
  (контент уровня 18 + stub уровня 19) → `features/lesson/hooks/` (reducer + единственный таймер) →
  `features/lesson/components/`. Curriculum fixture остаётся каноном структуры; тело урока в нём не живёт.
- **Вся бизнес-логика — в `model/`**: чистые функции, без React, без `Date.now()`, без `Math.random()`,
  без мутаций. Компоненты рендерят производное состояние и диспатчат события; giant component отсутствует.
- Progress marker переиспользуется из `features/path/model/path-state.ts` — Главная, Путь и Урок читают
  одну и ту же последовательность, поэтому подмена на backend не затронет UI.
- `lesson-scenarios.ts` — dev adapter: **только seed** стартовой сессии, в production-модель не входит.
- Сессия живёт в runtime страницы: без backend, без базы, без localStorage (DD-250).
- Тесты: 136 unit/component + 30 E2E. Детали — `D2B_LESSON_EXPERIENCE.md`, `LESSON_STATE_MACHINE.md`.
