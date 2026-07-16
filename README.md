# Alfa Trade Academy — Web V2

Последовательная образовательная платформа по трейдингу (100 уровней / 20 модулей). Pocket —
торговая площадка (деньги видны только там); ATA — обучение, progression, planning, analysis,
discipline и сопровождение. ATA не является торговым терминалом.

> **Статус: Phase D2B — Core Lesson Experience.** Реализованы Главная (`/`), Путь (`/path`) и
> Урок (`/lessons/[levelCode]`). Backend / CRM / Pocket / database / deploy — не подключены; все данные
> synthetic, прогресс не сохраняется. Отчёты, mentor review и инструменты **не начинались**.
> D2C автоматически не начинается.

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
| `npm run test:e2e` | Playwright — **все behavioral suites** (Главная + Путь + Урок), 78 тестов |
| `npm run test:e2e:all` | Playwright — полный discovery, включая artifact capture (121) |
| `npm run screenshots` | Playwright — реальные screenshots Главной (D1B) |

> **Два слоя E2E (D2B.1).** `*smoke.spec.ts` — behavioral regression: ничего не пишет на диск, входит в
> стандартный `npm run test:e2e`. `*screenshots.spec.ts` — artifact capture: пишет PNG в `design-memory/`
> и в стандартный gate **не** входит, потому что перезапуск screenshot-спеки прошлой фазы переписывает
> historical evidence. Новый behavioral spec попадает в gate автоматически, если назван `*smoke.spec.ts`.

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


## Урок — Learning Spine (D2B)

`/lessons/[levelCode]` — канонический маршрут урока (`level.018`; `/lessons` ведёт на текущий урок).
Основная fixture — **уровень 18 «Поддержка и сопротивление»** (модуль 4).

- видео **перед** проверкой (в DOM, на всех viewport);
- проверка видна заранее, но закрыта до **50%** подтверждённого просмотра; полный просмотр не требуется;
- перемотка просмотром не считается, прогресс монотонный;
- один вопрос за раз; неверный ответ **ничего не отнимает** и не раскрывает правильный вариант;
- completion = 50% + все обязательные вопросы (**provisional frontend rule, не backend-контракт**);
- следующий уровень закрыт до completion; XP не начисляется; Pocket CTA и сумм внутри урока нет;
- прогресс хранится в **сессии браузера** (`sessionStorage`, `ata.lesson-progress.v1`) — это **не**
  backend persistence: закрытие сессии может его потерять, и UI говорит ровно это;
- пользовательские ссылки **не** используют `scenario`: после завершения CTA ведёт на чистый
  `/lessons/level.019`, который открыт по записи сессии (новая вкладка без marker — снова locked).

Dev-сценарии — **только для разработки и тестов** (`?scenario=initial|watching|threshold-49|
threshold-50|testing|incorrect|completed`; для уровня 19 — `locked|unlocked`; неизвестное → `initial`).
Механизмом пользовательского progression они не являются.

> **Контент урока — provisional development fixture.** Утверждённого редакционного сценария и записи нет.
> Каноничны продуктовые правила и UX, а не формулировки; production lesson authoring не реализован.

Детали — `docs/D2B_LESSON_EXPERIENCE.md`, `docs/LESSON_STATE_MACHINE.md`, `docs/LESSON_ACCESSIBILITY.md`.
