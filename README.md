# Alfa Trade Academy — Web V2

Последовательная образовательная платформа по трейдингу (100 уровней / 20 модулей). Pocket —
торговая площадка (деньги видны только там); ATA — обучение, progression, planning, analysis,
discipline и сопровождение. ATA не является торговым терминалом.

> **Статус: Phase D3-B — First Report Level.** Реализованы Главная (`/`), Путь (`/path`),
> Урок (`/lessons/[levelCode]`), **Библиотека уроков (`/lessons`)** и **первый отчёт
> (`/lessons/level.003`)**. Backend / CRM / Pocket / database / deploy — не подключены; все данные
> synthetic. Прогресс урока живёт в сессии браузера, черновик отчёта — в `localStorage` этого
> браузера. **Mentor verdict, practical и инструменты не начинались.**
>
> **`/lessons`** — обзор учебного материала (в отличие от Пути, который показывает допуск): выбранный
> модуль, его уровни, доминирующее «Продолжить обучение», возврат к пройденному. Направление —
> Concept B «Curriculum Index» (`docs/D2C_ART_DIRECTION.md`), реализация —
> `docs/D2C_LESSONS_LIBRARY.md`. Выбор модуля — обычное URL-состояние `?module=module.NN`.
>
> **D3 переопределена (DD-270): «Report, Practical & Mentor Review Experience».** Урок и тест в неё
> **не входят** — они закрыты в D2B. D3-A зафиксировала scope и предъявила три направления; **выбран
> Concept B «Evidence Ledger»** + компактный блок «Перед отправкой» из Concept C (DD-271). D3-B
> реализовала **только уровень 3**. Детали — `docs/D3_REPORT_SCOPE.md`,
> `docs/D3_REPORT_ART_DIRECTION.md`, `docs/D3_REPORT_EXPERIENCE.md`,
> `docs/REPORT_STATE_MACHINE.md`, `docs/REPORT_STORAGE.md`.
>
> **`/lessons/level.003`** — отчёт является **самим уровнем** (`/reports/[reportCode]` не
> используется). Пять записей по числу demo-сделок из артефакта курса, итоговое наблюдение, черновик в
> `localStorage` (`ata.report-workspace.v1`), submit с подтверждением → локальный `pending-review`.
> **Вердикт наставника не имитируется**, `approved`/`rejected` отсутствуют, уровень 4 остаётся закрыт.
>
> Канон (Артём, L18) не менялся. Полный flow отчёта живёт только под dev/test сценарием
> `?scenario=report` (`currentLevel: 3`) — он не появляется ни в одной пользовательской ссылке
> (DD-272). Practical и уровень 19 не начинались; rubric — prototype-only;
> `/lessons/[levelCode]/test` остаётся **зарезервированным**.

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
| `npm run test:e2e` | Playwright — **все behavioral suites** (Главная + Путь + Урок + Библиотека + Отчёт), 116 тестов |
| `npm run test:e2e:all` | Playwright — полный discovery, включая artifact capture (175) |
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


## Библиотека уроков — `/lessons` (D2C)

Обзор учебного **материала** — в отличие от Пути, который показывает **допуск**. Направление —
Concept B «Curriculum Index»: curriculum как содержание книги, строками, без карточек и lock-иконок.

- доминирующее «Продолжить обучение» ведёт на текущий урок (раньше `/lessons` был redirect'ом);
- desktop: индекс всех 20 модулей + содержание выбранного (его пять уровней, статусы, checkpoint);
- mobile: переключатель «Модуль NN из 20» + sheet со всеми модулями (не уменьшённый desktop);
- выбор модуля — обычное URL-состояние `?module=module.NN` (shareable, Back/Forward, безопасный откат);
  `/lessons` **не читает** `?scenario`;
- длительность показывается только там, где она реально известна (сегодня — уровень 18);
- checkpoint — **граница модуля**: только target и что открывает; Pocket не кликабелен.

Детали — `docs/D2C_LESSONS_LIBRARY.md`, направления — `docs/D2C_ART_DIRECTION.md`,
review — `design-memory/reviews/d2c-b-lessons-library-review.md`,
screenshots — `design-memory/screenshots/d2c-lessons-library/final/`.

## Урок — Learning Spine (D2B)

`/lessons/[levelCode]` — канонический маршрут урока (`level.018`).
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
