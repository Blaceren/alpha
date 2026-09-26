# D2A — Learning Path · Review (art-direction brief, visual QA, evidence matrix)

**Phase:** D2A — Learning Path Architecture and Core Experience.
**База HEAD:** `436aba2` (git gate: путь верный, дерево чистое, без lock, fsck чист).
**Screenshots:** `design-memory/screenshots/d2a-path/{first-pass,final}/` — реальный Next.js
рендер в Chromium (Playwright), не synthetic.

---

## 1. Art-direction note (gate context)

Route Field утверждён пользователем как база **Home и глобального Пути** ещё в D1B; D2A-бриф
предписывает композицию Пути (§8–§17) и перечисляет допустимые формы module-навигатора. Явный
выбор направления, который требует `ata-art-direction-gate`, здесь сделан самим брифом D2A.
Открытым оставался только **форм-фактор module-навигатора** — рассмотрены 3 структурных варианта
из разрешённого списка:

| Вариант | Суть | Решение |
|---------|------|---------|
| A. Compact horizontal band (segmented) | 20 сегментов-меток в одну строку над полем; состояние через tick-подчерк; meta-строка под лентой | **Выбран** — единственный, который одновременно держит все 20 модулей на одном экране desktop, сохраняет тишину дальних модулей и остаётся 44px-touch на mobile (горизонтальный скролл ленты) |
| B. Module minimap (поле силуэтов) | Миниатюра всех 20 модулей как вторая карта под полем | Отклонён: вторая карта конкурирует с Route Field и дублирует его смысл «двумя картами» |
| C. Edge navigator (только рёбра) | Переход только через соседние модули по краям поля | Отклонён как единственный способ (нарушает «дальние модули доступны»), но **сохранён как дополнение** — footer-строка соседних модулей под полем |

Ключевые пункты брифа направления (19-пунктовый формат, сжатые):
тезис — «Путь = исследуемая структура маршрута, Home = текущий момент»; user moment — L18,
середина модуля 4, до контрольной точки 2 шага; visual thesis — **окно одного модуля** на
Route Field: маршрут входит из прошлого модуля, поднимается через 4–6 уровней и упирается в
ворота контрольной точки с ответвлением инструмента; signature object — module window + gate
aperture (общая ДНК с Home, но структурная, а не моментная); DNA — deep navy, luminous line,
cold blue + green/cyan signals (refs 01–02: восходящая route trace,線→структура); mobile —
pannable focused navigator, не сжатая desktop-карта; motion — только функциональная
(auto-центрирование, pulse текущего узла, без частиц/интро); Alex — на Пути не присутствует
(его место — Home/уроки; Путь — структура); не переносится из лендинга — гигантский пустой hero,
blur-объект, низкоконтрастный body.

---

## 2. Visual QA — first-pass findings (14; критерий ≥12 выполнен)

| # | Sev | Finding | Резолюция |
|---|-----|---------|-----------|
| 1 | Major | Edge-кнопка «Модуль N →» коллизия с label ветки инструмента (все viewport'ы с branch) | Edge-кнопки вынесены из canvas в footer-строку под полем |
| 2 | Major | Edge-кнопка «← Модуль N» наезжает на label первого узла (tablet/desktop) | Тот же footer-фикс |
| 3 | Major | На mobile edge-кнопки внутри pannable canvas обрезались до «иском» | Footer вне скролл-области — не обрезается |
| 4 | Major | Landscape 844×390: поле почти целиком под fold, header слишком высокий | Short-height mode: h1 21px, cp-ahead скрыт, сжатые отступы, canvas 235px |
| 5 | Minor | Дубль «Модуль 4 из 20 · Чтение графика» (navigator meta + in-field контекст) | In-field `mod-context` удалён |
| 6 | Minor | В checkpoint-сценарии header дублировал контрольную точку двумя строками | Строка «Ближайшая контрольная точка» скрыта, когда текущий уровень — сама точка |
| 7 | Minor | Branch label мог обрезаться у правого края поля | Центрирование label над точкой ветки (translate(-50%)) |
| 8 | Minor | Label узла 19 обрезается краем canvas на mobile до pan | Природа pannable canvas; label раскрывается панорамированием — принято |
| 9 | Minor | Пустая полоса под полем на desktop 900px | Дыхание композиции; принято |
| 10 | Minor | Locked-маркеры очень мелкие | Осознанное приглушение будущего; смысл несут labels «закрыт» |
| 11 | Minor | Gate-info переносится на 2 строки | Читаемо; принято |
| 12 | Minor | Zoom-200: обрезанные «ОТК»/«Cha» у правого края | Устранено фиксами #1/#7 |
| 13 | Minor | 320: header переносится на 4 строки | Читаемо, без обрезки; принято |
| 14 | Minor | При открытом detail поле сжимается, gate у кромки | Continuation-стаб намеренно уходит за край; после #7 label не обрезается |

Все Major исправлены; final переснят и проверен покадрово.

## 3. Обязательные проверки §26 (по final-кадрам)

Path ≠ Home (структура+навигатор vs момент+CTA) ✓ · текущая позиция очевидна (glow + «текущий» + navigator) ✓ ·
масштаб 100 уровней понятен (лента 20 модулей + «Модуль 4 из 20» + «Уровни 16–20») ✓ · навигатор не перегружен ✓ ·
checkpoint читается как ворота (двойная плоскость + апертура + diamond) ✓ · route не похож на stock chart (узлы-уровни,
ворота, ветка инструмента, без осей/цен/свечей) ✓ · нет ряда одинаковых кругов (5 геометрий маркеров) ✓ · нет card grid ✓ ·
нет generic timeline ✓ · detail — anchored plane/sheet, не SaaS-modal ✓ · future module не раскрывает лишнего (названия +
«закрыт», без контента) ✓ · mobile — не длинный список (pannable окно) ✓ · управление discoverable (навигатор, рёбра,
частично видимые соседние узлы) ✓ · keyboard focus видим (outline-кольцо) ✓ · текст читаем ✓ · L85 не ломает layout ✓ ·
bottom nav ничего не перекрывает (sheet выше nav, e2e bounding-box) ✓ · no horizontal overflow (e2e на 6 viewport) ✓ ·
нет debug labels / raw enums ✓ · нет financial pressure / Pocket CTA ✓.

---

## 4. Evidence matrix (§27 — любой Fail блокирует commit)

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Route Field remains ATA-specific | **Pass** | luminous route → gate aperture → tool branch; та же ДНК, что Home/refs 01–02 |
| Path differs from Home | **Pass** | сравнение `path-active-desktop` vs `home` finals: структура+исследование vs момент+один CTA |
| 100-level scale understandable | **Pass** | лента 20 модулей, «Модуль 4 из 20», «Уровни 16–20», окно 5–6 узлов |
| Current position obvious | **Pass** | glow-узел + «текущий» + aria-current + сегмент 4 в навигаторе |
| Module structure understandable | **Pass** | границы, диапазоны, «пройдено X из Y», соседние модули в footer |
| Checkpoint meaningful | **Pass** | ворота + условие + ранг/инструмент/канал в detail; `path-checkpoint-*` |
| Tool unlock integrated | **Pass** | ветка от ворот «Откроется · Chart Markup Tool» |
| No card grid | **Pass** | все finals |
| No generic timeline | **Pass** | восходящее поле с воротами, не горизонтальная линейка карточек |
| No stock chart | **Pass** | нет осей/цен/свечей; изгибы объяснены уровнями/границей/воротами |
| Mobile transformed | **Pass** | focused pannable navigator + sheet; `path-active-mobile-390x844` |
| Contextual detail | **Pass** | `path-level-detail-{desktop,mobile}` — карта остаётся видимой |
| Navigation usable | **Pass** | e2e: navigator select (completed/future), return, keyboard, edges |
| Labels readable | **Pass** | finals 390/320/zoom; поднятый контраст D1B.1 унаследован |
| Accessibility alternative exists | **Pass** | sr-only outline (20 модулей + уровни выбранного, aria-current) — component-тест |
| Performance acceptable | **Pass** | e2e: ≤8 nodes, ≤30 SVG-элементов; без rAF/random |
| Financial privacy preserved | **Pass** | component+e2e: только target, без баланса/«осталось»/депозитов |
| No Pocket CTA | **Pass** | privacy-тесты, ручной осмотр finals |
| Cannot be renamed to generic SaaS | **Pass** | без curriculum-семантики (уровни→ворота→ранг/инструмент) экран теряет смысл |

**Ни одного Fail.**

## 5. Screenshots (final, точные PNG dimensions)

`design-memory/screenshots/d2a-path/final/`: path-active-desktop-1440x900.png (1440×900) ·
path-active-tablet-1024x768.png (1024×768) · path-active-mobile-390x844.png (390×844) ·
path-active-mobile-320x720.png (320×720) · path-mobile-landscape-844x390.png (844×390) ·
path-zoom-200.png (720×450) · path-checkpoint-desktop-1440x900.png (1440×900) ·
path-checkpoint-mobile-390x844.png (390×844) · path-module-navigator-desktop.png (1440×900) ·
path-future-module-desktop.png (1440×900) · path-level-detail-desktop.png (1440×900) ·
path-level-detail-mobile.png (390×844) · path-advanced-level-85-desktop.png (1440×900).

## 6. Quality gates

lint ✓ · typecheck ✓ · unit/component 65 (16 curriculum consistency + 16 path + 33 прочие) ✓ ·
build ✓ · e2e: 15 path-smoke + 21 home-smoke ✓ · screenshots 13 ✓ · console/pageerror/hydration = 0
(собирается в e2e) · npm audit: 2 moderate (транзитивный postcss в Next, без изменений, `--force` не выполнялся).

## 7. Scope

Только `/path` + curriculum data + навигация. Без lesson/test/report/mentor/tools/community/auth/
backend/API/CRM/Pocket/Prisma/deploy; Главная не переделана (регрессия покрыта e2e); rank identity
остаётся provisional; D2B не начат.
