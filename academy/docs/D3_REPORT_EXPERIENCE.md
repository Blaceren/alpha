# D3-B — First Report Level

Реализация первого и единственного report-уровня. Baseline: `54c4cdb` (`design: define ATA report experience`).

Смежные документы: `D3_REPORT_SCOPE.md` (scope и решения), `D3_REPORT_ART_DIRECTION.md` (направления),
`REPORT_STATE_MACHINE.md` (lifecycle), `REPORT_STORAGE.md` (хранилище).

---

## 1. Выбор направления

**Пользователь выбрал Concept B «Evidence Ledger»** с одним дополнением из Concept C: компактным
блоком **«Перед отправкой»** (DD-271).

| | Решение |
|---|---|
| Concept B «Evidence Ledger» | **принят** как основа |
| Concept C — компактный блок «Перед отправкой» | **перенесён** |
| Concept C — полная правая dashboard-плита | **отклонена** |
| Concept A «Report Desk» | **отклонён** |

Главный объект экрана — **ледгер из пяти записей**, соответствующих пяти demo-сделкам. Количество не
макетное решение: артефакт curriculum — «Отчёт по 5 demo-сделкам», то есть структуру диктует курс.

## 2. Маршрут

**`/lessons/level.003`** — отчёт является самим curriculum-уровнем (DD-264).
`/reports/report.003` **не создан**; код `report.NNN` существует только как внутренний идентификатор
определения и никогда не является адресом.

Маршрут `/lessons/[levelCode]` перехватывает report-уровни до логики урока: если для уровня есть
report-определение, рендерится `ReportWorkspace`, иначе всё идёт прежним путём D2B. Уровень 18 и
уровень 19 не затронуты.

## 3. Сценарий и канон

Канон (DD-234) — Артём на **уровне 18**. Единственный report-уровень — **3**. История
«submit → pending → уровень 4 закрыт» связна **только** для пользователя, стоящего на уровне 3.

Поэтому D3-B добавляет **explicit dev/test сценарий `report`** (`currentLevel: 3`) рядом с
существующими early/advanced/checkpoint (DD-271/DD-272). Правила:

- канон **не меняется**: Артём остаётся на 18, Home / Path / Library / урок L18 не переделаны;
- полный flow draft → ready → submit → pending → уровень 4 locked живёт **только** под `?scenario=report`;
- сценарий — только для разработки, E2E и screenshots; **не включается автоматически**;
- **ни одна пользовательская ссылка** его не содержит (закреплено unit- и E2E-тестами);
- без сценария уровень 3 для канонического Артёма остаётся **завершённым** (`mode: archive`);
- локальный pending-маркер **не может** задним числом закрыть уровни 4–18;
- статус отчёта **никогда** не понижает уже достигнутый canonical progression;
- инструментовка сценария скопирована из `early` — новых XP-правил не выдумано (DD-250).

## 4. Композиция

**Desktop** (`report-empty|partial|ready-desktop-1440x900.png`):
канонический shell → breadcrumb «← Уроки · Модуль 01 · Первое знакомство» → заголовок уровня →
требование + пометка «Структура задания уточняется редакцией» → строка browser-local сохранения →
компактная строка readiness → **пять строк ледгера, одна раскрыта** → закрывающая зона
(итоговое наблюдение слева, «Перед отправкой» справа ≈ ¼ ширины) → submit в естественном конце.

Свёрнутая строка — **не карточка**: ни рамки, ни радиуса, ни заливки; различает их **состояние
сигнала**, а не контейнер. Открытая запись — **свет вместо рамки**: левая кромка `--signal-active` и
углублённая поверхность. Итоговое наблюдение — **третий материал** (бордер), потому что это рефлексия,
а не evidence.

**Не использовано:** grid карточек, hero-панель, permanent outline слева, полноценная правая
dashboard-sidebar, progress ring, проценты, stock chart, торговый терминал, красный error UI, glass
blur, gradient glow.

**Mobile** (`report-mobile-390x844.png`) — **не уменьшенный desktop**: свёрнутые строки скрываются
(и покидают tab order, поэтому дублирующихся focusable-контролов между брейкпоинтами нет), их
состояние несёт полоса из пяти точек рядом со счётчиком, работа идёт **по одной записи** с кнопками
«Предыдущая/Следующая запись» (≥44px), summary после пятой записи, «Перед отправкой» и submit —
inline, **не** sticky над bottom navigation.

Один DOM обслуживает оба вьюпорта; переключает CSS на брейкпоинте продукта (900px).

## 5. Модель

```
src/features/report-level/
├── data/report-fixtures.ts        # определение уровня 3 (единственного)
├── model/report.ts                # типы, поля, derived-список report-уровней
├── model/report-draft.ts          # схема, parse/serialize, правило готовности, мутации
├── model/report-store.ts          # порт localStorage
├── model/report-experience.ts     # деривация lifecycle/mode/progression
├── hooks/use-report-draft.ts      # autosave + save state
├── hooks/use-report-workspace.ts  # read-only статус для Library и Path
├── components/…                   # workspace, entry, before-submit, dialog
└── report-level.css
```

Разделение владения — прецедент DD-243: curriculum fixture остаётся каноном (номер, модуль, название,
kind, artifact, sequence), а фича владеет только тем, что нужно **сверх** этого: числом записей и
названиями полей. `reportLevelNumbers()` **выводится** из curriculum, а не хардкодится — тест
закрепляет, что report-уровень ровно один.

## 6. Prototype-only структура полей

| Поле | Обязательное |
|---|---|
| `Когда` | нет |
| `Что решил` | нет |
| `Что заметил после сделки` | **да** — единственное, на которое смотрит правило готовности |
| `Итоговое наблюдение` (одно на отчёт) | **да** |

Это **prototype-only editorial structure**, а не canonical trading methodology (DD-268/DD-274). Текста
задания в fixture нет, поэтому canonical instructions не выдуманы.

**Намеренно отсутствуют и не добавляются без продуктового решения:** asset, trade amount,
profit/loss, entry price, exit price, volume, leverage, win/loss, финансовая оценка результата,
торговая рекомендация. Закреплено тестами (модель, компонент, E2E).

## 7. Интеграции

**Библиотека уроков.** Для уровня 3: `draft → Черновик`, `ready → Готов к отправке`,
`pending-review → На проверке`. Доминирующее «Продолжить обучение» ведёт на `/lessons/level.003` в
любом состоянии; при pending действие — «Открыть отчёт». Следующий уровень **не** становится текущим.
`/lessons` начал читать `?scenario=` как dev-адаптер — явная поправка к DD-263 (DD-273): модульный
параметр остаётся пользовательским состоянием, сценарий — адаптером, и они не смешиваются.

**Путь.** Деталь уровня 3 показывает «Отчёт: На проверке» + честную приписку. Уровень 4 остаётся
закрыт. Баланса, «осталось до $50» и Pocket CTA нет. Попутно устранено нарушение DD-172: деталь
инлайнила собственные подписи типов, включая английское «Structured report» — теперь единственный
владелец подписей `kindLabel` (DD-262).

**Главная** визуально не переделана.

> **D3-C-B реализовал цикл доработки** поверх этого экрана: `revision-requested` («Нужна
> доработка») → правка того же отчёта → повторная отправка → `pending-review`. Хранилище переехало
> на `ata.report-workspace.v2` с односторонней миграцией. Детали — `D3_REVISION_EXPERIENCE.md`;
> границы ниже описывают состояние на момент D3-B.

## 8. Границы

Не реализованы: `approved`, `rejected`, `revision requested`, `resubmit`, mentor comments, section
comments, version history, attachments, upload, mentor thread, mentor avatar, countdown, practical
assignments, уровень 19, инструменты, backend/API/database/Pocket, XP reward, отдельный
`/lessons/[levelCode]/test`, новые зависимости.

Curriculum fixtures, checkpoint thresholds и XP-правила не изменялись. Урок 18 визуально не менялся.

## 9. Проверки

| Проверка | Результат |
|---|---|
| `npm run lint` | ✅ чисто |
| `npm run typecheck` | ✅ чисто |
| `npm run test:run` | ✅ **435** (308 прежних сохранены + 127) |
| `npm run build` | ✅ |
| `npm run test:e2e` (gate) | ✅ **116** в 7 файлах (88 прежних сохранены + 28) |
| `npm run test:e2e:all` (discovery) | **175** в 15 файлах |
| `npm audit` | ⚠️ 2 moderate, pre-existing (`next → postcss`), fix не запускался |
| Horizontal overflow (1440/1024/390/320/720) | ✅ 0px |
| Console errors / hydration warnings | ✅ 0 |

Visual QA: 2 прохода, 8 findings (2 critical, 3 major, 3 minor) —
`design-memory/reviews/d3-b-report-review.md`.

---

## D3-D — Approved (расширение)

Терминальный вердикт `approved` и его проекция на прогрессию описаны отдельно —
см. [D3_APPROVED_EXPERIENCE.md](D3_APPROVED_EXPERIENCE.md). Кратко: `pending-review → approved`
(терминальный, read-only, review сохранён, XP не меняется, DD-297); completion L3 выведена из
report workspace, `ata.lesson-progress.v1` не пишется; storage поднят до **v3**
(`ata.report-workspace.v3`, DD-296); «Одобрено» показывается только на report-экране при
approval-induced completion, Library/Path показывают L3 «Завершён» (DD-293, DD-300).
