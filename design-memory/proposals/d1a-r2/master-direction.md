# D1A-R2 — Master Direction (consolidated, high-fidelity, design-only)

Art-direction gate brief for the **one** consolidated Главная system. Design-only (standalone
HTML/CSS/SVG in `design-memory/`), no React. Product name **Alfa Trade Academy** (never «Alpha Trade»).
Terminology RU user-facing (Контрольная точка / Ранг / Отчёт / Сообщество). References are provisional.

## Architectural decision (approved)

- **Route Field = primary system** for Главная and the global Путь.
- **Learning Spine = secondary curriculum pattern** — on Главная only a small current-module indicator
  inside the current-node context (16 · 17 · **18** · 19 · ◇20); it never competes with the route.
- **Constructed Artifact = milestone/rank/unlock system** — one provisional rank artifact
  (Наблюдатель III), compact on Главная, larger only in checkpoint transition. Not a permanent shell.

This does **not** mean all three appear at once.

## The 19-point gate

1. **Product thesis.** Alfa Trade Academy ведёт трейдера по фиксированному маршруту из 100 уровней;
   всегда один очевидный следующий шаг.
2. **User moment.** Артём, уровень 18, модуль 4 «Чтение графика», урок «Поддержка и сопротивление», в
   двух уровнях от контрольной точки L20 (State A). Либо: завершил учебные требования L20 и стоит на
   контрольной точке (State B).
3. **Visual thesis.** Главная — **участок живого маршрута обучения**: путь проходит сквозь пространство
   экрана, текущий урок раскрывается прямо из светящегося current-node как **одна система** (route ↔
   lesson plane), а контрольная точка стоит впереди как **структурные ворота**. Не dashboard.
4. **Stable DNA used.** Luminous line used as structure; one dominant meaningful object; chaos→system;
   deep navy spatial field; fine contextual metadata; restrained cinematic depth; constructed object from lines/layers (rank).
5. **Provisional idea tested.** Route Field как основной canvas (проверено структурно в R1) в high-fi.
6. **Signature object.** Диагональная **Luminous Route Trace**, сквозь которую проходит lesson-plane;
   впереди — **checkpoint gate** (структурный объект). Плюс rank **Constructed Artifact** (компактно).
7. **Signature functional meaning.** Маршрут кодирует completed/current/upcoming/locked-сегменты,
   module boundary, checkpoint gate, reward branch, distant continuation, return-to-current. Rank
   artifact кодирует семью/тир и завершённые контрольные точки. Ничего декоративного.
8. **Desktop composition (1440×900).** Компактный top command band (не sidebar); маршрут — главный
   объект по диагонали через экран; current node — пространственный якорь со светом/глубиной; из него
   **как продолжение маршрута** разворачивается lesson-plane; впереди справа — checkpoint gate с наградой
   и rank-preview как единым объектом. ≤3 прямоугольных контейнера.
9. **Navigation model.** **Top command band**: wordmark · компактный navigation cluster (Главная/Путь/
   Уроки/Инструменты + «Ещё») · уведомления · avatar. Понятно, но не доминирует. Не левый sidebar.
10. **Progression model.** Диагональная линия слева-снизу (пройдено, мягкий устойчивый свет) → current
    node (фокус) → upcoming/locked (тускнеет) → checkpoint gate (упор). Внутри node — mini-spine модуля.
11. **Current lesson placement.** Разворачивается **из current node**; route-линия входит в lesson-plane
    (одна система), а не отдельная карточка над линией.
12. **Checkpoint placement.** Впереди по маршруту как **gate** (сжатие маршрута + вертикальная граница).
    В State A виден, но не забирает primary attention. В State B — центр композиции.
13. **Reward placement.** Часть gate: Chart Markup Tool + следующий ранг Наблюдатель IV — **один объект
    ворот**, не два отдельных badge.
14. **Rank placement.** Компактный artifact Наблюдатель III у current-node/top; в checkpoint-transition
    крупнее (превью будущей награды/следующего ранга).
15. **Alex Curie placement.** **Editorial quote, встроенный в маршрут** + reserved portrait frame с явно
    заменяемым asset-layer (не серый avatar, не отдельная generic-карточка, не floating chatbot). В State A
    объясняет тему; в State B — смысл условия без финансового давления.
16. **Typography.** Взрослая, спокойная, но **читаемая**: (1) следующий шаг, (2) урок/контрольная точка,
    (3) положение на маршруте, (4) ранг/прогресс, (5) Alex, (6) вторичные инструменты. Служебный текст —
    technical, но не debug overlay. Без low-opacity основного текста, tiny labels, экстремального tracking.
17. **Surface/materials.** Deep navy field; холодный синий для структуры; restrained cyan/green для
    active/completed; тонкие световые границы; редкие data markers; **один meaningful glow focus** (current
    node в A / gate в B). Не «стена серых карточек», не яркая SaaS-кнопка, не glow на каждом элементе.
18. **Motion concept.** Functional: центрирование node, разворот lesson-plane, лёгкий ambient current-node
    (пауза/off при reduced-motion). Milestone (rank-up/checkpoint transition) — вне первого экрана. (Статично на screenshot.)
19. **Mobile transformation (390×844).** Не уменьшенный desktop: current node в центральной зоне,
    соседние уровни частично, маршрут уходит диагонально за экран (движимый), lesson рядом с node, CTA
    полностью виден, rank/XP/streak — строкой (не 3 карточки), checkpoint preview вторичен; bottom nav
    (Главная/Путь/Уроки/Инструменты/Ещё), профиль через avatar, touch ≥44px. В State B — gate центральный,
    условие без длинного scroll, CTA «Проверить выполнение» в первом viewport.

## Deltas

- **Not from landing.** Низкий контраст; giant empty hero; tiny tracked labels; декоративные цены;
  постоянный blur; giant A; grid perspective; ghost-CTA как правило; scroll-driven сцены (manifest §C/§B).
- **Why not renameable to another SaaS.** Экран построен на **последовательном маршруте обучения с
  контрольной точкой-воротами и rank-артефактом из завершённых checkpoints** — это ATA-progression.
- **Difference from rejected D1A.** Нет sidebar, нет card-grid, нет KPI-плиток, нет гексагон-ранга,
  path — сам экран (не виджет-плитки в карточке).
- **References used.** Route/line (prelanding 01–03, hero-сцена) + spine/nodes (04); constructed rank
  artifact — принцип «object from lines/layers» (02–03). ≥2 источников.

## Two states
- **State A — Active lesson:** primary action «Продолжить урок»; checkpoint виден впереди, вторичен.
- **State B — Current checkpoint:** primary action «Проверить выполнение»; gate — центр; условие «баланс
  Pocket от $200», «учитывается только реальный баланс, demo не засчитывается»; без баланса пользователя,
  без «осталось $X», без Pocket-CTA; награда + ранг Наблюдатель IV в воротах; пройденный маршрут виден.

Full anti-generic scoring, QA findings and UX audit: `design-memory/reviews/d1a-r2-high-fi-review.md`.
Mobile behavior detail: `mobile-behavior.md`. Rank system: `rank-artifact-study.html`.
