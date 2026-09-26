# ART_DIRECTION_RESET

Phase D1A-R0. Сброс арт-направления Alfa Trade Academy: D1A отклонён, новые provisional references
проанализированы, задан курс на следующую итерацию (D1A-R1 — **не** начата на этом этапе).

## Почему D1A отклонён

Три направления D1A (Product Portal / Market Atlas / Editorial Academy) технически работали, но
визуально были вариациями **одного generic AI dashboard**. Конкретика по каждому кадру —
`design-memory/references/anti-examples/d1a-generic/WHY_REJECTED.md`. Кратко, со ссылками на
rejected screenshots:

- `product-portal-desktop.png` / `product-portal-mobile.png` — «портал» = ряд `rounded-2xl`
  node-плиток в рамочной карточке; sidebar generic; синий accent без брендовой причины; rank —
  запрещённый гексагон; Alex приклеен карточкой; mobile = сложенный desktop. Не выглядит порталом.
- `market-atlas-desktop.png` / `market-atlas-mobile.png` — KPI-плитки + карточки инструментов =
  generic analytics dashboard; «карта» = dashboard-строка на пунктирной линии. Не выглядит картой.
- `editorial-academy-desktop.png` / `editorial-academy-mobile.png` — тот же skeleton, чуть уже
  колонка; нет журнальной типо-системы. Не выглядит editorial.
- `concepts-board-desktop.png` — три одинаковые карточки (feature-grid).

Сквозные причины: один skeleton (sidebar + card-grid) на все три; card-grid мышление; generic
sidebar; accent без брендовой причины; одинаковые материалы и radius; Lucide вместо идентичности;
нет signature object; Alex не встроен; mobile = stacked desktop; любой экран переименовывается в
произвольный SaaS; нет связи с прелендингом.

## Что показали новые references

Анализ четырёх provisional кадров (`REFERENCE_MANIFEST.md`) зафиксировал:

- **Spatial depth** — глубокое navy-пространство со слоями.
- **Restrained luminous line** — тонкая светящаяся линия: зелёная восходящая route (01–03) и вертикальный green spine (04) как **несущая структура**.
- **Green/cyan signals** — редкие сигнальные акценты поверх холодной синей базы.
- **Monumental object** — единый объект-артефакт (буква A: blurred → wireframe-with-data → solid faceted; точка-сигнал в 03).
- **Fine market metadata** — тонкие координаты/цены/подписи-узлы вокруг объекта.
- **Transition from chaos to system** — сквозной направленный нарратив (явно в 04: «Переходи от хаоса к понятной системе»; нумерованный спайн 01→06).
- **Low-density cinematic composition** — разреженная, спокойная, кинематографичная сцена.

## Что нельзя копировать (landing-only)

- Низкий контраст; oversized empty zones; landing navigation logic; tiny tracked labels; blur-heavy
  «читаемость»; декоративный график без продуктового смысла. Полный список — `REFERENCE_MANIFEST.md` §C.

## Что технически можно сохранить (из D1A foundation)

- Next.js foundation; типизированные synthetic data; архитектура semantic-токенов; responsive-утилиты;
  testing-инфраструктура (Vitest/Playwright); screenshot-tooling; доступные primitives.

## Что визуально нужно заменить

- Текущий shell; card-grid dashboard; текущий rank emblem (гексагон); текущие path-nodes (плитки);
  текущий mobile stacking; язык текущей primary-кнопки (generic blue); зависимость от generic-иконок.

## Куда дальше

Следующий шаг — **D1A-R1** (art-direction exploration через `ata-art-direction-gate`): ≥3 структурно
разных low-fi композиции на основе Stable DNA + по одной provisional-идее (route / spine / artifact).
**На этом этапе (D1A-R0) новый дизайн не начинается и направление не выбирается.**

## Итог reset (D1A-R1 → D1A-R2)

- **D1A-R1** дал три структурно разных low-fi направления (Route Field / Learning Spine / Constructed
  Artifact), все прошли anti-generic gate (88/87/86).
- **D1A-R2** консолидировал их в **одну** high-fidelity систему с зафиксированными ролями:
  - **Route Field = Home/Path system** (основа Главной и Пути);
  - **Learning Spine = curriculum context** (модули/уроки/отчёты/история; на Главной — мини-индикатор);
  - **Constructed Artifact = milestone/rank/unlock system** (компактный rank на Главной, крупнее в checkpoint).
  Не все три появляются одновременно. Направление проверено в двух состояниях (Active lesson / Current
  checkpoint), score 89/100, references остаются provisional. Детали — `docs/D1A_R2_MASTER_DIRECTION.md`.
  **React implementation ещё не утверждён.**
