# D2A-R1 — Path Visual Hierarchy & Responsive Correction · Review

**Phase:** D2A-R1 (corrective, presentation layer only).
**База HEAD:** `811cf2d` (git gate: путь `/Users/mm/Desktop/atadesign`, дерево чистое, без lock, fsck чист).
**Screenshots:** `design-memory/screenshots/d2a-r1-path-correction/{first-pass,final}/`
**Метод:** реальный Next.js dev-server в Chromium (Playwright) + числовые bounding-box замеры.
Старый evidence matrix D2A как доказательство не принимался — все 13 D2A-кадров пересмотрены заново.

---

## 1. Подтверждённые проблемы (собственный осмотр D2A final)

| # | Sev | Подтверждено на кадре | Что именно |
|---|-----|----------------------|------------|
| 1 | Critical | `path-level-detail-mobile.png` | Sheet полупрозрачен: сквозь него читаются «Разметка графика / следующий», свечение текущего узла, а «Поддержка и сопротивление / текущий» накладывается прямо на «Видео-урок и тест»; сквозь CTA просвечивают рёбра модулей |
| 2 | Critical | `path-zoom-200.png` | Справа обрезаны «ОТКРОЕТ…», «Chart Marku…» и сумма; подпись текущего узла уходит под bottom nav |
| 3 | Critical | `path-mobile-landscape-844x390.png` | Bottom nav срезает текущий узел — виден только верхний край свечения, подпись целиком под баром |
| 4 | Major | `path-level-detail-desktop.png` | Detail — округлая (r14) карточка, «висящая» в правой колонке, без визуальной связи с выбранным узлом 18 |
| 5 | Major | `path-active-mobile-320x720.png` | Подписи соседних узлов рубятся по краям канвы без единого сигнала → читается как случайная обрезка |
| 6 | Major | `path-module-navigator-desktop.png` | 20 одинаковых номеров в ряд; просматриваемый (1) и текущий (4) отличаются практически только цветом рамки |
| 7 | Major | `path-active-desktop-1440x900.png` | Большая мёртвая нижняя зона (~170px); граница модуля едва различима; масштаб «20 модулей» не ощущается |

---

## 2. Что сделано (только presentation)

- **Mobile detail** → solid `--surface-context` (computed alpha = 1), scrim над workspace без blur/glassmorphism, scrim **не** накрывает bottom nav (бар остаётся рабочим), close 44×44, sheet `overflow-y: auto`, полоса Route Field сверху как контекст, focus-return сохранён.
- **Desktop detail** → строгая геометрия (radius 2), один выразительный boundary edge (`.d-edge`), **leader-линия** от выбранного узла к кромке панели, `gap: 0` — панель стала правой стеной поля (не карточка, не modal, не sidebar). Иерархия: level → state → requirement → next boundary → action.
- **Compact checkpoint summary** (`.cp-summary`) — **вне** панорамируемой канвы: порог и награда физически не могут быть обрезаны краем. На умеренно коротких экранах (zoom) перенесён **над** полем.
- **Short-height** — два уровня: 421–560px (zoom) — сводка над полем; ≤420px (landscape) — приоритет маршруту, сводка ниже фолда (§7 разрешает). Шапка схлопывается в одну строку, подписи узлов — в одну строку.
- **Pan discoverability** — edge-fade слева/справа + сдержанная одноразовая метка (»), привязанные к `.path-stage`; исчезает после первого **реального** жеста; вертикальный scroll не блокируется.
- **Navigator** — scale marker `4 / 20`, 4 главы по 5 со слабыми границами, distant-модули компактнее, **current = залитая точка, viewed = рамка-скобка** (геометрия, не цвет), touch-полоса ≥44px.
- **Композиция** — поле в рамке с угловыми скобками (workspace), канва выше (≥1200: `clamp(380px,52vh,540px)`), мёртвая зона ~170px → ~50px.

Не менялись: curriculum entities/ranges/thresholds, tool/report/mentor/community mapping, scenario semantics, layout engine, Home, routes, dependencies.

---

## 3. First-pass findings (10; critical/major исправлены до final)

| # | Sev | Finding | Резолюция |
|---|-----|---------|-----------|
| 1 | Critical | Scrim дублировал accessible-имя кнопки закрытия → два одинаковых контрола «Закрыть детали уровня» в a11y-дереве *(найдено тестом)* | Scrim → `aria-hidden` div; реальные контролы — close-кнопка и Escape |
| 2 | Critical | Авто-центрирование само помечало pan-подсказку как «использованную» → она не показывалась никогда *(найдено тестом)* | Считаются только реальные жесты (pointerdown/wheel/touchstart), не программный scroll |
| 3 | Major | Scrim накрывал bottom nav → бар не нажимался при открытом sheet | Высота scrim обрезана по верху бара |
| 4 | Major | Подпись нижнего узла (16) обрезалась низом канвы (`overflow-y: hidden`) при короткой высоте | Подписи в short-height — одна строка (номер + название инлайн); высоты канвы пересчитаны под вмещение |
| 5 | Major | Leader не доходил до панели ~24px (grid gap) | `gap: 0` в detail-open; панель — правая стена поля |
| 6 | Major | Pan-подсказка привязана к верху поля → в short-height попадала на сводку КТ | Панорамируемая зона обёрнута в `.path-stage`; подсказка по центру канвы |
| 7 | Minor | Маршрут в 8–13px от бара (< требуемых 16) | Формулы высоты канвы дотюнены → фактически 18–20px |
| 8 | Minor | Прежний D2A-тест искал фразу, которую новая презентация разбила на два элемента | Тест адаптирован на сводку (§3 разрешает менять Path-тесты); смысл проверки сохранён и усилен |
| 9 | Minor | Landscape: сводка КТ у самой кромки бара | Принято: §7 явно разрешает checkpoint ниже фолда; страница скроллится, padding-bottom очищает бар |
| 10 | Minor | Zoom: «Chart Mar…» всё ещё обрезан внутри канвы | Принято: полное имя гарантировано сводкой над полем, а edge-fade делает обрезку читаемой как pan (не как дефект) |

## 4. Числовые проверки (Chromium, реальный рендер)

| Viewport | Узел над баром | Нижний элемент маршрута над баром | Подписи обрезаны канвой | Сводка КТ в 1-м экране | H-overflow |
|----------|---------------:|----------------------------------:|------------------------:|:----------------------:|-----------:|
| zoom 720×450 | 58px | **20px** ✓ | 0 | **да** ✓ | 0 |
| landscape 844×390 | 56px | **20px** ✓ | 0 | ниже фолда (§7) | 0 |
| mobile 390×844 | 197px | 89px | 0 | да | 0 |
| 320×720 | 73px | — | 0 | скроллом | 0 |
| tablet 1024×768 | 274px | 154px | 0 | да | 0 |
| desktop 1440×900 | 335px | 194px | 0 | да | 0 |

---

## 5. Evidence matrix (§16 — любой Fail блокирует commit)

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Mobile detail opaque and readable | **Pass** | `final/path-level-detail-mobile.png`; e2e: computed background alpha = 1 + z-order над scrim + отсутствие backdrop-текста в области панели |
| Desktop detail contextually anchored | **Pass** | `final/path-level-detail-desktop.png`; e2e: leader на одной высоте с узлом (<6px) и доходит до кромки панели (<8px) |
| Zoom critical content fully visible | **Pass** | `final/path-zoom-200.png`; e2e: узел над баром, сводка в 1-м экране, «$200» + «Chart Markup Tool» + «Наблюдатель IV» целиком, боксы внутри viewport |
| Landscape nav overlap absent | **Pass** | `final/path-mobile-landscape-844x390.png`; e2e: узел и весь маршрут ≥16px над баром (факт 20px), страница скроллится |
| Mobile pan discoverable | **Pass** | `final/path-active-mobile-320x720.png` (fade + »); e2e: canvas overflows, affordance до жеста, гаснет после, `touch-action` содержит `pan-y` |
| Module navigator hierarchy improved | **Pass** | `final/path-module-navigator-desktop.png`; e2e: 20 модулей, current = node-mark, viewed = bracket (разные псевдоэлементы), полосы ≥44px |
| Path differs from Home | **Pass** | рамка-viewport + scale marker + лента 20 модулей + сводка КТ + detail-стена — на Home ничего этого нет; Home — момент и один CTA |
| Current position obvious | **Pass** | glow-узел + «текущий» + `aria-current="step"` + точка на модуле 4 + «Сейчас: Уровень 18» |
| Checkpoint meaningful | **Pass** | ворота + сводка «Уровень 20 — баланс Pocket от $200 · Откроется: Наблюдатель IV · Chart Markup Tool» |
| Future module understandable | **Pass** | `final/path-future-module-desktop.png`: viewed 12 ≠ current 4, «К текущему уровню», locked-маршрут различим, причина — в detail, контент не раскрыт |
| Financial privacy preserved | **Pass** | e2e privacy (active+checkpoint): только `от $X`; нет баланса/«осталось»/депозитов/выводов |
| No Pocket CTA | **Pass** | e2e: `a[href*="pocket"]` = 0; нет «перейти/открыть Pocket» |
| Accessibility preserved | **Pass** | 67 unit (один h1, aria-current, sr-outline, клавиатура); e2e: клавиатура ←→/Home, focus-return, ≥44px, scrim вне a11y-дерева |
| Performance preserved | **Pass** | e2e performance envelope без изменений (≤8 узлов, ≤30 SVG-элементов); без random/rAF; зависимости не добавлялись |
| No architecture regression | **Pass** | curriculum fixture, layout engine, path-state, scenarios не изменены (git diff); 16 consistency-тестов зелёные; Home e2e 21/21 |

**Ни одного Fail.**

## 6. Screenshots (final, точные PNG dimensions)

`design-memory/screenshots/d2a-r1-path-correction/final/`:
path-active-desktop-1440x900.png (1440×900) · path-active-tablet-1024x768.png (1024×768) ·
path-active-mobile-390x844.png (390×844) · path-active-mobile-320x720.png (320×720) ·
path-mobile-landscape-844x390.png (844×390) · path-zoom-200.png (720×450) ·
path-level-detail-desktop.png (1440×900) · path-level-detail-mobile.png (390×844) ·
path-module-navigator-desktop.png (1440×900) · path-future-module-desktop.png (1440×900) ·
path-checkpoint-mobile-390x844.png (390×844).
First-pass: тот же набор в `first-pass/`.

## 7. Quality gates

lint ✓ · typecheck ✓ · unit/component **67** (было 65: +2 навигатор current/viewed) ✓ ·
build ✓ (`ƒ /path`) · e2e **86** (было 75: +11 R1) ✓ · npm audit — 2 moderate (транзитивный postcss
в Next; без изменений, `--force` не выполнялся). Console/pageerror/hydration = 0 (собирается в e2e;
dev-log чист). `package.json`/lock не менялись.
