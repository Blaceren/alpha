# Alfa Trade Academy — Web V2

Последовательная образовательная платформа по трейдингу (100 уровней / 20 модулей). Pocket —
торговая площадка (деньги видны только там); ATA — обучение, progression, planning, analysis,
discipline и сопровождение. ATA не является торговым терминалом.

> **Статус: Phase D4-B — Tools Hub + Trading Journal.** Реализованы Главная (`/`), Путь (`/path`),
> Урок (`/lessons/[levelCode]`), **Библиотека уроков (`/lessons`)**, **первый отчёт
> (`/lessons/level.003`)** и **Инструменты (`/tools`, `/tools/[toolCode]`)** с первым рабочим
> инструментом **Trading Journal**. Backend / CRM / Pocket / database / deploy — не подключены; все
> данные synthetic. Прогресс урока живёт в сессии браузера, черновик отчёта и записи журнала — в
> `localStorage` этого браузера. **Risk Calculator и прочие инструменты не реализованы; mentor verdict
> и practical не начинались.**
>
> **Инструменты (D4-B):** hub `/tools` — operational ledger всей последовательности инструментов;
> доступ вычисляется каноническим progression-резолвером (для Артёма L18 открыты Trading Journal L10 и
> Risk Calculator L15; дальше — locked). Trading Journal — browser-local (`ata.tools.trading-journal.v1`,
> `docs/TOOLS_STORAGE.md`): ручные записи по сделкам/решениям (ПЛАН → ИСПОЛНЕНИЕ → УРОК), create/edit/
> list, без агрегатов/баланса/broker sync. Risk Calculator честно показан как «Открыт по прогрессу ·
> инструмент готовится» без рабочего CTA. Направление — «Structured Operational Spine» (hub A + journal
> C, DD-308). Подпись «Записи вводятся вручную и не синхронизируются с брокером.»
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
> `localStorage` (с D3-C — ключ `ata.report-workspace.v2`; валидные v1-черновики мигрируют, v1 не
> удаляется), submit с подтверждением → локальный `pending-review`.
> **Вердикт наставника не имитируется** (в D3-B `approved`/`rejected` отсутствовали; `approved` добавлен
> терминальным dev/test-вердиктом в D3-D — см. ниже); уровень 4 закрыт, пока отчёт не одобрен.
>
> Канон (Артём, L18) не менялся. Полный flow отчёта живёт только под dev/test сценарием
> `?scenario=report` (`currentLevel: 3`) — он не появляется ни в одной пользовательской ссылке
> (DD-272). Practical и уровень 19 не начинались; rubric — prototype-only;
> `/lessons/[levelCode]/test` остаётся **зарезервированным**.
>
> **D3-C выполнена целиком.** D3-C-A предъявила три направления
> (`docs/D3_REVISION_ART_DIRECTION.md`); выбран **B «Revision Pass»** + два элемента из A
> (комментарий проверки над ледгером и ссылки-переходы; DD-289). D3-C-B реализовала цикл
> `pending-review → «Нужна доработка» → правка того же отчёта → повторная отправка → «На проверке»`
> без `approved`: хранилище **`ata.report-workspace.v2`** с односторонней миграцией валидных
> v1-черновиков (v1 не удаляется; DD-290), вердикт — только dev/test adapter
> `?verdict=revision-requested` при `?scenario=report` (DD-291), правило повторной отправки —
> готовность ∧ содержательное изменение после вердикта (DD-292). Library/Path показывают
> «Нужна доработка» / «Готов к повторной отправке»; канонический Артём (L18) не затронут.
> Детали — `docs/D3_REVISION_EXPERIENCE.md`.
>
> **D3-D выполнена целиком.** Терминальный вердикт `approved`: хранилище поднято до **v3**
> (`ata.report-workspace.v3`) с односторонней миграцией v1 → v2 → v3 (v1/v2 не удаляются; DD-296),
> вердикт — только dev/test adapter `?verdict=approved` при `?scenario=report` (exact-match; DD-298).
> `approved` терминален (read-only, review сохранён как история, XP не меняется; DD-297); completion
> уровня 3 **выводится** из report workspace и проецируется на сессию через
> `sessionWithApprovedReports` — `ata.lesson-progress.v1` **не** пишется, следующий уровень открывает
> существующий резолвер. Ключевая граница — **base-completed vs approval-induced** (DD-300): «Одобрено»
> показывается только на report-экране при approval-induced completion; Library/Path показывают L3
> «Завершён» (не «Одобрено»), следующий шаг — контрольная точка · Уровень 4; primary CTA «Посмотреть
> Путь» → чистый `/path` (DD-293, DD-294). При каноническом L18 локальный approved ничего не
> переименовывает. Home не тронут (DD-295); это provisional frontend prototype state, не
> аутентифицированная backend-истина (DD-299). Детали — `docs/D3_APPROVED_EXPERIENCE.md`. **Mentor
> thread, practical и D4 не начинались.**

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
| `npm run test:e2e` | Playwright — **все behavioral suites** (Главная + Путь + Урок + Библиотека + Отчёт + Доработка + Одобрение + **Инструменты**), 177 тестов / 10 smoke-файлов |
| `npm run test:e2e:all` | Playwright — полный discovery, включая artifact capture (280) |
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

## Инструменты — `/tools` + Trading Journal (D4-B)

Первый production Tools vertical slice. **Hub `/tools`** — operational ledger всей последовательности
инструментов на одной светящейся нити (не card grid / marketplace): узлы подписаны уровнем открытия,
current-инструмент подсвечен и имеет один CTA, locked/coming-soon — спокойные строки. Доступ
вычисляется **каноническим progression-резолвером** (`levelProgressState`) — React не сравнивает уровни
вручную. Для Артёма (L18): Trading Journal (L10) открыт и рабочий; Risk Calculator (L15) открыт, но
честно «инструмент готовится» без CTA; дальше — locked.

**`/tools/[toolCode]`** диспетчеризует по резолву: unknown → not-found; locked → target level без формы;
unlocked-но-не-реализован → coming-soon; available → workspace. Единственный реализованный инструмент —
**Trading Journal**: browser-local (`ata.tools.trading-journal.v1`), ручные записи по сделкам/решениям
на вертикальном spine, триптих **ПЛАН → ИСПОЛНЕНИЕ → УРОК** (урок доминирует, денежный результат —
вторичная метка), create/edit/list (без delete), honest empty/saved/storage-error/corrupt-storage
states. Никаких агрегатов (сумма/P&L/win-rate/%/equity), баланса, broker sync или влияния на XP/уровни.
Направление — «Structured Operational Spine» (hub A + journal C, DD-308…DD-310). Хранилище —
`docs/TOOLS_STORAGE.md`; visual review — `docs/visual-reviews/D4_B_TRADING_JOURNAL.md`; screenshots —
`design-memory/screenshots/d4-trading-journal/final/`. `?scenario=` — dev/test адаптер маркера,
в пользовательских ссылках не появляется.

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
