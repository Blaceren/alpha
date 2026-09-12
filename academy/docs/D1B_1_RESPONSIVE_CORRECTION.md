# D1B.1 — Responsive / Zoom / Safe-Area Correction

Небольшой корректирующий этап поверх принятого **D1B**. Архитектура D1B и **Route Field**
приняты и **не пересматриваются**. D1B.1 исправляет только обнаруженные проблемы реальной
React-реализации. Никакого нового art-direction, `/path`, lesson page, tools, rank identity,
backend/Pocket, dependency upgrade или deploy.

## Что исправлено

### 1. 200% browser zoom (reflow)
Раньше zoom сохранял desktop-раскладку и обрезал правую часть (checkpoint preview за viewport).
Теперь responsive определяется фактически доступной CSS-шириной: при 200% zoom окна 1440×900 CSS
layout viewport = 720×450 → интерфейс переходит в **compact-композицию** (мобильные бары, маршрут в
верхней зоне), без горизонтальной прокрутки, с доступными lesson title и CTA. Решение не зависит от
`transform: scale()` / CSS `zoom` — только медиазапросы по ширине. Playwright-ассерт:
`document.documentElement.scrollWidth <= clientWidth` на 720×450.

### 2. Tablet Active (1024×768) — отдельный state
Раньше — «уменьшенный desktop» с пустой правой зоной, маршрут заканчивался в верхнем левом углу,
checkpoint preview выглядел случайным блоком внизу. Теперь tablet — **отдельная 2-региональная
композиция** (breakpoint 900–1199):

- `grid-template-areas: "plane fcp" / "instr fcp" / "mentor mentor"`;
- lesson plane занимает бÓльшую часть ширины; checkpoint preview — рядом справа (использует правую зону);
- маршрут — одна **диагональ**: current node (угол plane) → upcoming → checkpoint preview (`a-tablet` геометрия);
- instrumentation под plane, Alex во всю ширину ниже;
- CTA остаётся над сгибом.

Реализовано через `.lesson-anchor { display: contents }` в tablet-диапазоне (дети plane/instr/mentor
становятся элементами grid). Отдельная `a-tablet` группа маршрута.

### 3. Bottom navigation safe-area / overlap
`.home-main` получил `padding-bottom` и `scroll-padding-bottom` = `calc(92px + env(safe-area-inset-bottom))`.
Фиксированный bottom nav больше не перекрывает контент; **последний содержательный элемент полностью
прокручивается выше верхней границы nav** (проверено скролл-скриншотом и smoke-ассертом bounding-box).
Прокрутка — на окне (`.home` растёт выше 100dvh), а не на `.home-main`.

### 4. Checkpoint mobile
Оба результата за границей доступны: CTA в первом viewport, первый результат виден сразу, второй —
коротким естественным скроллом; bottom nav не перекрывает текст; far-side иерархия сохранена; проверено
на длинное имя инструмента и потенциальную польскую локализацию.

### 5. 320px
CTA видна; заголовок не обрезан; progress в границах; rank/XP/streak переносятся; Alex прокручивается;
5 nav items помещаются; touch-таргеты ≥44px; логотип-знак с accessible name `Alfa Trade Academy`;
notification и avatar не конфликтуют; нет horizontal overflow.

### 6. Контраст
Подняты токены `--text-secondary` (#c2ccdb→#cdd6e3) и `--text-muted` (#9aa6ba→#aab4c7); подняты opacity
`rc-upcoming`/`rc-distant`. Три уровня иерархии (primary/secondary/muted) сохранены; opacity не является
единственным механизмом иерархии для текста.

## Breakpoints (итог)

| Диапазон | Навигация | Композиция | Маршрут |
|----------|-----------|------------|---------|
| < 900px | mobile top + bottom nav | stacked | `a-narrow` / `c-narrow` (верхняя зона) |
| 900–1199px | desktop app bar | tablet 2-региональный grid (active) / stacked (checkpoint) | `a-tablet` / `c-tablet` |
| ≥ 1200px | desktop app bar | Route Field grid | `a-wide` / `c-wide` |

Геометрия маршрута — три scenario-scoped группы на состояние (`a-*` active, `c-*` checkpoint); каждый
breakpoint показывает только свою группу, поэтому SVG двух сценариев не конфликтуют.

## Что НЕ менялось

Desktop Active/Checkpoint композиции, lesson plane с открытыми сторонами, геометрия Route Field на
desktop, спокойная CTA, financial privacy, ProvisionalRankMark, MentorMediaPlaceholder, top navigation,
отсутствие sidebar/card-grid. Зависимости не менялись; `npm audit fix --force` не выполнялся.

## Blocker (перенесён из D1B)

no-op CTA допустима только для локального D1B-прототипа. До staging CTA должна вести в существующий
lesson/checkpoint flow. Расширять scope созданием lesson page в D1B.1 запрещено.

## Тесты

- Unit/component: 32 (без изменений — privacy/one-h1/nav/scenario).
- E2E smoke: 15 (добавлены — 200% zoom reflow overflow, per-breakpoint route geometry, tablet-distinct,
  last-outcome-above-nav, landscape, 320px).
- Screenshots: 10 состояний в `design-memory/screenshots/d1b-1-responsive-fix/final/`.

Детали и evidence matrix — `design-memory/reviews/d1b-1-responsive-fix-review.md`.

**Следующий этап после принятия D1B.1 — полноценный `/path`.**
