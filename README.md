# Alfa Trade Academy — Web V2

Последовательная образовательная платформа по трейдингу (100 уровней / 20 модулей). Pocket —
торговая площадка (деньги видны только там); ATA — обучение, progression, planning, analysis,
discipline и сопровождение. ATA не является торговым терминалом.

> **Статус: Phase D1A** — application foundation + art-direction board. Реальный продукт ещё не
> реализован: построены foundation, дизайн-токены, shell и три концепта Главной. Backend / CRM /
> Pocket / database / deploy — не подключены. Все данные synthetic.

## Требования

- Node.js ≥ 18.18 (разработка велась на Node 25)
- npm (не смешивать с другими package managers)

## Установка

```bash
npm install
npx playwright install chromium   # для e2e и screenshots
```

## Скрипты

| Скрипт | Действие |
|--------|----------|
| `npm run dev` | dev-сервер |
| `npm run build` | production build |
| `npm run start` | запуск production build |
| `npm run lint` | ESLint (flat config, eslint-config-next) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run test` / `npm run test:run` | Vitest (watch / однократно) |
| `npm run test:e2e` | Playwright smoke suite |
| `npm run screenshots` | Playwright — реальные screenshots Главной (D1B) |

## Главная — Route Field Home (D1B)

Реализована оболочка приложения и Главная на базе утверждённого **Route Field** в двух
детерминированных состояниях (переключение только через query):

- `/?scenario=active` — активный урок (Продолжить урок);
- `/?scenario=checkpoint` — текущая контрольная точка (Проверить выполнение);
- неизвестное значение scenario безопасно → active.

Детали — `docs/D1B_REACT_HOME_IMPLEMENTATION.md`, review —
`design-memory/reviews/d1b-react-home-review.md`, screenshots —
`design-memory/screenshots/d1b-react-home/final/`.

Финальная система рангов в D1B не фиксируется — используется только `ProvisionalRankMark`
(`docs/RANK_IDENTITY_FUTURE_PHASE.md`). D1A art-direction board и `/concepts`-маршруты сняты:
`/` теперь production-Главная.

## Путь — `/path` (D2A)

Первая полноценная страница «Путь»: typed curriculum (20 модулей / 100 уровней / 20 контрольных
точек), лента модулей, окно одного модуля на Route Field, contextual level detail,
«К текущему уровню», keyboard/a11y. Сценарии: `/path?scenario=active|checkpoint|early|advanced|completed`
(неизвестное → active). Прогресс — mock-adapter; backend не подключён. Детали —
`docs/D2A_PATH_ARCHITECTURE.md`, review — `design-memory/reviews/d2a-path-review.md`,
screenshots — `design-memory/screenshots/d2a-path/final/`.

## Документация

Source of truth — `docs/` (product context, IA, design system, page inventory, curriculum,
user flows, states, motion, content/tone, QA-протокол, implementation plan/status, decisions),
главный бриф — `ATA_PRODUCT_DESIGN_BRIEF_V1.md`, guidance для агентов — `CLAUDE.md`.
Frontend-архитектура — `docs/FRONTEND_ARCHITECTURE.md`.

## Финансовая приватность

Продукт никогда не показывает баланс/депозиты/выводы пользователя и не рассчитывает «осталось $X».
Единственное денежное значение в UI — target ближайшей контрольной точки.
