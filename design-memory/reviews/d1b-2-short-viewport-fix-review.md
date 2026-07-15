# D1B.2 — Short Viewport & Bottom Navigation Final Fix · Review

**Phase:** D1B.2 (corrective) — три конкретных responsive blocker поверх принятого D1B.1.
**База HEAD:** `01fcda2` (git gate: чистое дерево, без lock, fsck чист).
**Screenshots:** `design-memory/screenshots/d1b-2-short-viewport-fix/final/`
**Метод:** реальный Next.js dev-server в Chromium (Playwright) + числовые bounding-box замеры.

## Точная причина overlap (числа)

Замер CTA vs fixed bottom nav **до** фикса:

| Viewport | CTA bottom | Nav top | Overlap |
|----------|-----------:|--------:|--------:|
| zoom 720×450 | 403 | 395 | **+8** (под nav) |
| landscape 844×390 | 404 | 335 | **+69** (CTA целиком под nav) |
| mobile 390×844 | 454 | 789 | −335 (ок) |
| 320×720 | 473 | 665 | −192 (CTA ок) |

Причина: мобильный вертикальный ритм (mtop 54 + top-padding 20 + `node-narrow` 100 + gaps + header
плоскости) фиксирован независимо от высоты viewport → CTA всегда на ~y357–408. При высоте ≤~450px этот
Y попадает в полосу fixed bottom nav. **Не было short-height breakpoint.** Вертикальное центрирование —
НЕ причина (mobile контент течёт от верха).

Замер **после** фикса:

| Viewport | CTA overlap (init) | CTA overlap (focus) | last element clears nav |
|----------|-------------------:|--------------------:|------------------------:|
| zoom 720×450 | −98 | −98 | +24 |
| landscape 844×390 | −38 | −96 | +24 |
| mobile 390×844 | −330 | −330 | +24 |
| 320×720 | −187 | −187 | +24 |
| checkpoint 390×844 | −259 | −259 | +63 |

Все CTA полностью выше nav в первом viewport; последний элемент прокручивается ≥24px выше nav; focus не
уводит CTA под nav.

## Решение

1. **Canonical token** `--mobile-bottom-nav-height: 60px` (tokens.css) — единственный источник компенсации.
2. **Единый scroller:** `.home-main { overflow-x: clip }` (вместо `hidden`+`overflow-y:auto`) — окно
   становится единственным скроллером; `scroll-padding-bottom` на `html`.
3. **Компенсация в одном месте:** `.home-main` padding-bottom = `calc(token + env(safe-area-inset-bottom) + 24px)`;
   `.cta { scroll-margin-bottom: calc(token + safe + 20px) }` — focus не под nav.
4. **Short-height mode** `@media (max-height: 560px)`: компактный mtop (46px), `node-narrow` 44px, gaps 12px,
   компактный header плоскости, title floor 21px (читаемо) → node/title/progress/CTA в первом viewport над nav.
   Grid-композиции при короткой высоте → `align-content: start; min-height: 0` (естественный scroll, без clip).

## Evidence matrix (любой Fail блокирует этап)

| Criterion | Pass/Fail | Screenshot | Evidence |
|-----------|-----------|-----------|----------|
| 200% zoom CTA accessible | **Pass** | `active-zoom-200-initial.png` (720×450) | CTA целиком над nav (overlap −98); smoke «200% zoom CTA above nav». |
| landscape CTA accessible | **Pass** | `active-mobile-landscape-initial.png` (844×390) | CTA над nav (−38); node→title→progress→CTA в первом viewport; smoke landscape. |
| CTA does not overlap navigation | **Pass** | `active-zoom-200-cta-visible.png`, `active-mobile-landscape-cta-visible.png` | bounding-box helper `assertElementAboveBottomNavigation`. |
| 320 Alex accessible | **Pass** | `active-mobile-320-alex-scrolled.png` (320×720) | весь MentorContext (avatar + последняя строка) над nav (gap 16). |
| 320 checkpoint accessible | **Pass** | `active-mobile-320-checkpoint-scrolled.png` (320×720) | FutureCheckpointPreview (до «Chart Markup Tool») над nav. |
| focus does not land under navigation | **Pass** | — | smoke: focus CTA (zoom/landscape/mobile) → CTA остаётся над nav; `scroll-margin-bottom`. |
| no horizontal overflow | **Pass** | все | smoke: `scrollWidth ≤ clientWidth` (zoom, landscape, 320, mobile, desktop, tablet). |
| checkpoint regression-free | **Pass** | `checkpoint-mobile-regression.png`, `-scrolled.png` (390×844) | CTA в первом viewport; outcomes над nav (gap 63); нет чрезмерного пустого хвоста. |
| Route Field preserved | **Pass** | все active-кадры | маршрут + узел сохранены; не card-layout. |
| desktop/tablet regression-free | **Pass** | `active-desktop-regression.png` (1440×900), `active-tablet-regression.png` (1024×768) | идентичны принятым D1B.1 композициям. |

**Ни одного Fail. D1B.2 пройден.**

## Пути и размеры screenshots

`design-memory/screenshots/d1b-2-short-viewport-fix/final/`:

| Файл | Viewport / PNG |
|------|----------------|
| active-zoom-200-initial.png | 720×450 |
| active-zoom-200-cta-visible.png | 720×450 |
| active-mobile-landscape-initial.png | 844×390 |
| active-mobile-landscape-cta-visible.png | 844×390 |
| active-mobile-320-initial.png | 320×720 |
| active-mobile-320-alex-scrolled.png | 320×720 |
| active-mobile-320-checkpoint-scrolled.png | 320×720 |
| checkpoint-mobile-regression.png | 390×844 |
| checkpoint-mobile-regression-scrolled.png | 390×844 |
| active-desktop-regression.png | 1440×900 |
| active-tablet-regression.png | 1024×768 |

## Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test:run` | Pass — 32 |
| `npm run build` | Pass — `/` static |
| `npm run test:e2e` (smoke) | Pass — 21/21 (incl. reusable `assertElementAboveBottomNavigation`) |
| screenshots | 11 состояний |
| `npm audit` | 2 moderate, транзитивный postcss в Next (без изменений; `--force` не выполнялся) |

**Browser console:** ошибок/hydration нет (smoke собирает `console.error`+`pageerror` = 0; dev-log чист).

## Scope

Только responsive/short-height/scroll/safe-area стили + тесты + screenshots + доки. Без redesign Route
Field, без изменения desktop composition, product content, новых блоков, `/path`, Lesson, Rank Identity,
dependencies, backend/CRM/Pocket/DB, deploy. **Home считается завершённой после D1B.2; следующий этап — `/path`.**
