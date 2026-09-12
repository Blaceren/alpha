# ART_DIRECTION_BOARD

Phase D1A. Сравнение трёх арт-направлений Главной страницы Alfa Trade Academy.
**Победитель на этом этапе не выбирается** — доска готовит решение продуктовой команды.

## Цель сравнения

Найти визуальный язык Главной, который: сохраняет преемственность с прелендингом (dark, cold,
controlled glow), premium, даёт один очевидный следующий шаг, корректно показывает горизонтальный
путь и масштабируется на 100 уровней и 20 инструментов — без generic dashboard, LMS-ощущения и
casino. Три направления намеренно различаются, но построены на одной базовой палитре и одном
наборе компонентов.

## Invariant content (одинаково во всех трёх)

Один и тот же synthetic-пользователь и данные (`src/data/mock/synthetic-state.ts`):

- навигация приложения (RU labels, одинаковый порядок) и identity Alfa Trade Academy;
- доступ к уведомлениям; профиль через avatar;
- current rank (Наблюдатель III), current level (18 «Поддержка и сопротивление»);
- XP (2 480), module progress (Модуль 4 «Чтение графика», 2/5), Серия обучения (6 · лучшая 11);
- один primary action — «Продолжить урок»;
- horizontal path fragment (уровни 15–21);
- next checkpoint target (Уровень 20, от $200) — **без баланса пользователя**;
- ближайшая награда (Chart Markup Tool) и доступные инструменты (Trading Journal, Risk Calculator);
- сообщение Alex Curie.

Меняются только композиция, глубина, типографическая иерархия, материалы, характер пути,
плотность и роль Alex Curie — не состав сущностей.

## Три направления

### A — Product Portal (`/concepts/product-portal`)
Премиальный пространственный центр прогресса. Кинематографичный hero, текущий шаг — центральный
объект, путь как «портал» в следующие этапы; controlled glow, глубокие слои, ранг как артефакт,
минимум карточной дробности.

### B — Market Atlas (`/concepts/market-atlas`)
Прогресс как профессиональная карта рынка и навыков. Технично и плотно: метрик-тайлы, чёткая
сетка, точные подписи; горизонтальный путь — главный структурный объект; инструменты как рабочие
capabilities; premium terminal feeling без имитации терминала.

### C — Editorial Academy (`/concepts/editorial-academy`)
Спокойная премиальная образовательная среда: урок, эксперт и ясный следующий шаг. Сильная
типографика, больше воздуха, меньше glow; Alex Curie заметнее; путь встроен как компактная
editorial progression strip.

## Критерии выбора

Связь с прелендингом · премиальность · ясность следующего шага · горизонтальный путь · читаемость ·
плотность · mobile · масштабируемость на 100 levels · масштабируемость на tools · роль Alex Curie ·
риск generic dashboard · риск LMS · риск game/casino · performance. Полная оценка и рейтинги —
`design-memory/reviews/d1a-art-directions-review.md`.

## Ссылки

Routes (development-only, не входят в production sitemap):
- Доска: `/concepts`
- A: `/concepts/product-portal`
- B: `/concepts/market-atlas`
- C: `/concepts/editorial-academy`

Screenshots: `design-memory/screenshots/d1a-art-directions/` (6 концепт-PNG + `concepts-board-desktop.png`).
Review: `design-memory/reviews/d1a-art-directions-review.md`.

## No winner yet

Направление сознательно не выбрано. Возможные к комбинированию элементы перечислены в review
(hero-портал из A, плотность/капабилити из B, editorial-типографика и роль Alex из C).
