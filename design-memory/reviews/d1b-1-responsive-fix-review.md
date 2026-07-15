# D1B.1 — Responsive / Zoom / Safe-Area Correction · Review

**Phase:** D1B.1 (corrective) — фиксы responsive/zoom/safe-area/contrast поверх принятого D1B.
**База HEAD:** `9c78b0b` (git gate пройден: чистое дерево, без lock, fsck чист).
**Screenshots (source of truth):** `design-memory/screenshots/d1b-1-responsive-fix/final/`
**Метод:** реальный Next.js dev-server в Chromium через Playwright (не synthetic).

Захвачено 10 состояний:

| Файл | Состояние | Размер |
|------|-----------|--------|
| `active-desktop-1440x900.png` | Active · desktop | 1440×900 |
| `active-tablet-1024x768.png` | Active · tablet | 1024×768 |
| `active-mobile-390x844.png` | Active · mobile | 390×844 |
| `active-mobile-320.png` | Active · min-width | 320×720 |
| `active-zoom-200.png` | Active · 200% zoom reflow | 720×450 |
| `checkpoint-desktop-1440x900.png` | Checkpoint · desktop | 1440×900 |
| `checkpoint-tablet-1024x768.png` | Checkpoint · tablet | 1024×768 |
| `checkpoint-mobile-390x844.png` | Checkpoint · mobile | 390×844 |
| `checkpoint-mobile-scrolled.png` | Checkpoint · mobile, прокручено к последнему outcome | 390×844 |
| `mobile-landscape.png` | Active · landscape | 844×390 |

---

## 1. First-pass findings (visual QA)

| # | Sev | Finding | Резолюция |
|---|-----|---------|-----------|
| 1 | Critical | 200% zoom сохранял desktop min-width и обрезал правую часть (checkpoint preview за viewport). | Responsive-разметка теперь опирается на фактическую CSS-ширину; при 720px (=200% zoom 1440) интерфейс переходит в compact-композицию. Тест 200% zoom заменён на честный reflow (viewport 720×450, без CSS scale). |
| 2 | Major | Tablet Active был как «уменьшенный desktop»: пустая правая зона, route заканчивался в верхнем левом углу, checkpoint preview — случайный блок внизу. | Введена отдельная tablet-композиция: 2-региональный grid (plane + preview рядом), route — одна диагональ node→preview, instrumentation под plane, Alex во всю ширину, CTA над сгибом. Отдельная `a-tablet` геометрия маршрута. |
| 3 | Critical | Fixed bottom nav перекрывал контент; на checkpoint mobile «Новый инструмент» уходил под nav. | `padding-bottom`/`scroll-padding-bottom` = `calc(92px + env(safe-area-inset-bottom))`; последний outcome полностью прокручивается выше nav (см. `checkpoint-mobile-scrolled.png`). |
| 4 | Major | Скролл-тест захватывал не тот контейнер (`.home-main` не является скроллером — скроллится окно, т.к. `.home` растёт выше 100dvh). | Тест исправлен на `window.scrollTo(...)`; скролл-скриншот теперь достоверный. |
| 5 | Minor | Вторичные/muted подписи слегка бледны (route/checkpoint metadata, Alex role, module context, distant continuation). | Токены подняты (`--text-secondary` #cdd6e3, `--text-muted` #aab4c7); opacity `rc-upcoming`/`rc-distant` подняты. Три уровня иерархии сохранены. |
| 6 | Minor | Landscape mobile: CTA ниже сгиба на 390px высоте. | Приемлемо: контент прокручивается, nav не перекрывает видимый контент; edge-состояние. |
| 7 | Minor | Мёртвое CSS-правило `.rc-edge` (грани удалены ещё в D1B). | Удалено. |
| 8 | Minor | Tablet checkpoint preview: перенос строк («Уровень 20», «Наблюдатель IV») в узкой колонке. | Приемлемо (читаемо); проверено на длинное имя инструмента / PL-локализацию. |

Critical и Major (#1–#4) исправлены и переотсняты. Desktop-композиция не тронута концептуально.

---

## 2. Evidence matrix (любой Fail блокирует этап)

| # | Критерий | Verdict | Evidence |
|---|----------|---------|----------|
| 1 | Desktop regression-free | **Pass** | `active-desktop` / `checkpoint-desktop` идентичны принятой D1B композиции (route→node, gate, outcome). |
| 2 | Tablet composition intentional | **Pass** | `active-tablet` — 2-региональный grid, диагональ route→preview; smoke «tablet distinct» + «route geometry» тесты. |
| 3 | Mobile 390 usable | **Pass** | `active-mobile-390x844`, `checkpoint-mobile-390x844`. |
| 4 | Mobile 320 usable | **Pass** | `active-mobile-320`: CTA видна, 5 nav items, нет overflow (smoke 320 тест). |
| 5 | 200% zoom reflows | **Pass** | `active-zoom-200` (720×450) — compact-композиция, ничего не обрезано; smoke zoom тест. |
| 6 | No horizontal page overflow | **Pass** | smoke: `scrollWidth ≤ clientWidth` для всех viewport + zoom + landscape. |
| 7 | Bottom nav does not hide content | **Pass** | `checkpoint-mobile-scrolled`; smoke «last outcome clears nav» + «nav not over CTA». |
| 8 | Checkpoint outcomes fully accessible | **Pass** | scrolled-скриншот: оба результата + «…и следующий модуль пути» выше nav. |
| 9 | CTA in first viewport | **Pass** | desktop/tablet/mobile/320 — CTA видна без скролла; smoke visible-тесты. |
| 10 | Contrast readable | **Pass** | токены подняты; three-level иерархия сохранена. |
| 11 | Financial privacy preserved | **Pass** | privacy-тесты без изменений: active без `$`, checkpoint ровно `баланс Pocket от $200`, нет Pocket-CTA/«осталось». |
| 12 | Route Field remains primary | **Pass** | маршрут — главный объект во всех состояниях. |
| 13 | No central generic card | **Pass** | нет card-grid/центральной карточки; plane остаётся открытым полем. |
| 14 | No backend/Pocket integration | **Pass** | изменения только CSS/SVG/тесты/доки; нет сети/БД/CRM/Pocket. |

**Ни одного Fail. D1B.1 evidence matrix пройден.**

---

## 3. Anti-generic (регрессия)

Композиция и сигнатурный объект (Route Field + gate) не изменены концептуально; tablet стал более осмысленным (route как диагональная траектория). Desktop-оценка D1B (91/100, PASS) сохраняется; tablet перестал быть «scaled desktop» → структурная оригинальность на планшете улучшена. Auto-fail условия: sidebar+card-grid — PASS; stacked-desktop mobile — PASS (mobile/tablet — разные композиции); low-contrast body — PASS (контраст поднят).

---

## 4. Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test:run` | Pass — 32 |
| `npm run build` | Pass — `/` static |
| `npm run test:e2e` (smoke) | Pass — 15/15 (вкл. zoom-reflow, route-geometry, tablet-distinct, last-outcome-above-nav, landscape, 320) |
| `npm run screenshots` | Pass — 10 состояний |
| `npm audit` | 2 moderate, транзитивный внутренний postcss в Next (без изменений; `--force` не выполнялся) |

**Browser console:** ошибок/hydration-warning нет (smoke собирает `console.error` + `pageerror` = 0 для всех viewport).

---

## 5. Scope conformance

Только responsive/zoom/safe-area/contrast корректировки. Нет нового art-direction, redesign Route Field, `/path`, lesson page, tools, community, rank identity, backend/CRM/Pocket/DB, dependency upgrade, deploy. Desktop-композиция и financial privacy сохранены. no-op CTA остаётся локальным blocker до lesson-интеграции.
