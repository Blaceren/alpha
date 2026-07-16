# D2A — Learning Path Architecture (реализация)

Первая полноценная версия страницы **Путь** (`/path`). Архитектурная и визуальная основа:
typed curriculum (20 модулей / 100 уровней), module navigator, focused Route Field, contextual
level detail, keyboard/a11y, deterministic scenarios, тесты и реальные screenshots.

> **Статус: D2A закрывается только после D2A-R1.** Архитектура (curriculum data, layout engine,
> visible window, scenarios, a11y) принята в D2A и в R1 **не менялась**; R1 исправил только
> **presentation layer** — см. §12. D2B не начат.

## 1. Ответы страницы

1. **Где я?** — header «Сейчас: Уровень 18 · … — модуль 4 из 20», glow-узел с «текущий», сегмент в навигаторе.
2. **Что пройдено?** — зелёные сегменты навигатора, filled-узлы «пройден», «пройдено X из Y».
3. **Следующий шаг?** — узел «следующий» + detail текущего уровня с CTA.
4. **Ближайшая контрольная точка?** — строка в header + ворота в конце модуля с условием.
5. **Что откроется?** — ветка инструмента у ворот; ранг/канал в detail контрольной точки.
6. **Другой модуль?** — лента 20 модулей + рёбра соседних модулей под полем.
7. **Вернуться?** — кнопка «К текущему уровню» (header) + Home key.

## 2. Данные

- `src/domain/curriculum.ts` — типы: Curriculum, CurriculumModule, CurriculumLevel,
  CheckpointDefinition, ToolUnlock, CommunityUnlock, RankTransition, ReportRequirement,
  MentorReviewRequirement + `formatThresholdUsd`.
- `src/data/curriculum/fixture.ts` — **единственный** typed-источник: все 100 уровней
  (канонические названия), 20 модулей, 20 checkpoints (пороги $50…$10 000), 19 tool unlocks,
  5 community unlocks, 7 обязательных mentor reviews. Raw `les-prog.txt` в React не импортируется.
- Consistency-тесты (`fixture.test.ts`, 16) пиновали структуру к канону: счётчики, диапазоны,
  пороги, mentor L14/29/44/59/74/84/94, community L4/20/35/45/85, 19 tools без `tool.secret`,
  отсутствие «TradeQuest»/«Alpha Trade» в пользовательских строках.

## 3. Состояние (mock, не production)

`src/features/path/model/path-state.ts` — scenario adapter. Прогресс — маркер
`currentLevel` (все ниже — completed); состояния **выводятся**, не хранятся:
`completed | current | available | locked` + checkpoint-уточнения
(`checkpoint-completed/-current/-ahead`) + trait-маркеры (tool/community/report/mentor/module-start/-complete).

Сценарии `/path?scenario=`: `active` (L18) · `checkpoint` (L20 gate) · `early` (L2) ·
`advanced` (L85 gate, модуль 17) · `completed` (все 100). Неизвестное → active. Query невидим
пользователю, debug-контролов нет, на production-архитектуру не влияет (adapter заменяется backend'ом).

## 4. Визуальное окно (масштаб 100 уровней)

Одновременно рендерится **окно одного модуля**: 4–6 уровней + ворота + вход из прошлого модуля +
continuation к следующему. Остальные 99 уровней существуют в данных и доступны через навигатор /
рёбра / клавиатуру. DOM-бюджет: ≤8 узлов, ≤30 SVG-элементов (закреплено e2e). Дальние модули — не
80 кружков, а сегменты ленты + подписи соседей.

## 5. Layout

`layout-engine.ts` + `visible-window.ts` — детерминированная геометрия (см. `PATH_LAYOUT_ENGINE.md`).
Без random, без rAF-циклов.

## 6. Компоненты

`src/features/path/` — components: path-workspace (client-оркестратор), path-header,
module-navigator, path-viewport, path-node, path-detail-layer, path-accessible-outline;
model: curriculum-независимые path-state, layout-engine, visible-window; hooks: use-path-keyboard.
Гейт и ветка инструмента рисуются слоем соединений внутри viewport (не отдельные абстракции на сегмент).

## 7. Взаимодействие

- **Click/tap** узла — выбор + detail. **Лента модулей** — переключение окна.
- **Keyboard**: ←/→ соседние уровни (пересекают границы модулей со сменой окна), Enter/Space — detail,
  Escape — закрыть (фокус возвращается на узел), Home — к текущему. Roving tabindex; focus-кольцо видимо.
- **Mobile**: canvas 720px панорамируется нативным горизонтальным скроллом (`touch-action: pan-x pan-y` —
  вертикальный scroll страницы не блокируется; случайных CTA-активаций нет), автоцентрирование выбранного узла;
  detail — fixed sheet выше bottom nav; навигатор — той же лентой с горизонтальным скроллом.
- **Return-to-current** — в header (виден только когда пользователь ушёл от текущего) + Home key.

## 8. Detail layer

Desktop/tablet — плоскость, **привязанная к выбранному узлу**: leader-линия идёт от узла к кромке
панели, панель примыкает к полю без зазора и работает как его правая стена (строгая геометрия, один
выразительный boundary edge; не округлая карточка, не центральная modal, не sidebar приложения).
Mobile — **непрозрачный** sheet (solid deep-navy, alpha = 1) над мягким scrim'ом; scrim не накрывает
bottom nav, полоса Route Field сверху остаётся контекстом. Содержимое: уровень/модуль, состояние текстом, требования
(video+test / артефакт / mentor review), связанная контрольная точка, для checkpoint — условие +
примечание про demo + «за точкой» (ранг/инструмент/канал). Locked — причина (какой шаг нужен),
без контента сверх brief. Primary-действия — dev-safe no-op кнопки (DD-219), без 404 и fake success.

## 9. Checkpoint-правила

Пороги канона L4=$50 … L100=$10 000 (fixture + тест). Показывается только: номер, минимальное
условие («Баланс Pocket от $X»), состояние ворот, следующий ранг, награда, примечание «Demo не
учитывается». Никогда: баланс пользователя, «осталось $X», проценты достижения, депозиты/выводы,
история, Pocket CTA (закреплено component/e2e-тестами).

## 10. Responsive

- **≥900**: полный canvas (без скролла), detail — колонка справа.
- **<900**: pannable canvas + sheet; bottom nav компенсация — канонический токен D1B.2.
- **max-height 560** (landscape/zoom-200): сжатый header (cp-ahead скрыт), canvas 235px, приоритет
  первого экрана — контекст модуля + маршрут + текущий узел.

## 12. D2A-R1 — исправления presentation layer

Данные и геометрия не тронуты; изменён только слой представления:

- **Compact checkpoint summary** (`.cp-summary`) — вне панорамируемой канвы, поэтому порог и награда
  не могут быть обрезаны краем. На умеренно коротких экранах переносится над полем.
- **Short-height — два уровня.** 421–560px (200% zoom, малые окна): сводка КТ над полем, оба
  элемента в первом экране. ≤420px (landscape-телефоны): приоритет маршруту и текущему узлу,
  сводка уходит ниже фолда (страница скроллится). Шапка схлопывается в одну строку, подписи узлов —
  в одну строку; высота канвы выводится из места, которое реально оставляет фиксированный bottom nav
  (маршрут держит ≥16px до бара; фактически 18–20px).
- **Pan discoverability** — edge-fade + сдержанная одноразовая метка на `.path-stage`; гаснет после
  первого реального жеста (программное авто-центрирование жестом не считается); vertical scroll не блокируется.
- **Navigator** — scale marker `N / 20`, четыре главы по 5, distant-модули компактнее; роли переданы
  геометрией: current = залитая точка, viewed = рамка-скобка.
- **Композиция** — поле в рамке с угловыми скобками (workspace), выше канва на desktop, мёртвая
  нижняя зона сокращена.

Детали и evidence matrix — `design-memory/reviews/d2a-r1-path-correction-review.md`.

## 11. Что осталось за пределами D2A

Lesson/test/report/mentor/tools/community страницы; production progress/XP; полная rank identity
(provisional, `RANK_IDENTITY_FUTURE_PHASE.md`); backend/API/CRM/Pocket/Prisma/auth; deploy.
**D2B не начинается автоматически.**
