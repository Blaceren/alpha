# D1B.2 — Short Viewport & Bottom Navigation Final Fix

Финальный корректирующий этап Главной. D1B.1 принят частично; оставались три responsive blocker:
CTA под fixed bottom nav при (1) 200% zoom и (2) mobile landscape, и (3) неподтверждённая прокрутка
Alex выше nav на 320px. D1B.2 закрывает их. **Route Field, desktop, tablet и основные mobile-композиции
не переделываются.**

## Причина перекрытия

Мобильный вертикальный ритм (`mtop` 54 + top-padding 20 + `node-narrow` 100 + gaps + header плоскости)
был фиксирован независимо от высоты viewport → primary CTA всегда оказывался на ~y357–408. При высоте
viewport ≤~450px (landscape-телефон, 200% zoom) этот Y попадал в полосу `position: fixed` bottom nav, и
nav визуально перекрывал CTA. Отсутствовал **short-height breakpoint**. Вертикальное центрирование не было
причиной — на mobile контент течёт от верха. (Числовые замеры до/после — в review.)

Дополнительно: `.home-main` имел `overflow-y: auto`, из-за чего было два потенциальных скроллера (окно и
main); `scroll-padding` стоял на `.home-main`, а реальным скроллером было окно → компенсация фокуса не
срабатывала.

## Canonical bottom-navigation height token

```css
:root { --mobile-bottom-nav-height: 60px; }  /* tokens.css — единственный источник */
```

Используется в одном месте для всей компенсации:

- `.bottomnav { min-height: var(--mobile-bottom-nav-height) }`;
- `.home-main { padding-bottom: calc(var(--mobile-bottom-nav-height) + env(safe-area-inset-bottom) + 24px) }`;
- `html { scroll-padding-bottom: calc(var(--mobile-bottom-nav-height) + env(safe-area-inset-bottom) + 16px) }`;
- `.cta { scroll-margin-bottom: calc(var(--mobile-bottom-nav-height) + env(safe-area-inset-bottom) + 20px) }`.

Компенсация не дублируется в компонентах — она выведена из одного токена в слое разметки Главной.
На ≥900px (bottom nav скрыт) `scroll-padding` сбрасывается в 0.

## Единый scroller

`.home-main { overflow-x: clip }` (вместо `overflow-x: hidden; overflow-y: auto`). `clip` сдерживает
декоративный SVG по горизонтали, но **не** делает `.home-main` вложенным скроллером — окно остаётся
единственным скроллером, поэтому `scroll-padding`/`scroll-margin` работают предсказуемо (в т.ч. для
клавиатурного фокуса и `scrollIntoView`).

## Short-height responsive strategy

```css
@media (max-height: 560px) {  /* landscape-телефоны и 200% zoom */
  .mtop { height: 46px; }
  .home-main { padding-top: 10px; }
  .content { gap: 12px; }
  .content--active .node-narrow { height: 44px; }
  .lesson-plane { padding: 12px 24px 16px 20px; }
  .lesson-title { font-size: clamp(21px, 4.4vw, 27px); }   /* floor 21px — читаемо */
  .cta-wrap { margin-top: 12px; }
  .content { align-content: start !important; min-height: 0 !important; }  /* grid не клипует */
}
```

Short-height mode:

- переводит вертикальное центрирование grid в начало потока;
- сохраняет естественный scroll (ничего не скрыто `overflow: hidden`);
- держит Route Field в верхней части;
- показывает node → title → module progress → CTA в первом viewport над nav;
- не уменьшает текст ниже читаемого (title ≥ 21px);
- не использует CSS scale для интерфейса.

Приоритет первого landscape viewport соблюдён: current node, lesson title, module progress, CTA;
rank/Alex/checkpoint — ниже по scroll.

## Результаты

| Viewport | До | После |
|----------|----|-------|
| zoom 720×450 | CTA под nav на 8px | CTA выше nav на 98px |
| landscape 844×390 | CTA целиком под nav | CTA выше nav на 38px (после focus 96px) |
| 320×720 Alex/checkpoint | не подтверждено | весь MentorContext и preview прокручиваются выше nav |
| checkpoint 390×844 | — | без регресса; outcomes выше nav (+63px), без пустого хвоста |

Последний содержательный элемент во всех состояниях прокручивается ≥24px выше bottom nav (§5 требовал 16–24).

## Keyboard / focus

`scroll-padding-bottom` (root) + `scroll-margin-bottom` (CTA) гарантируют, что фокус/`scrollIntoView`
не помещает CTA (и другие focusable) под fixed nav. Проверено e2e: focus CTA на zoom/landscape/mobile →
CTA остаётся над nav.

## Что не менялось

Route Field geometry, desktop/tablet композиции, product content, financial privacy, ProvisionalRankMark,
MentorMediaPlaceholder, отсутствие sidebar/card-grid. Зависимости не менялись; `/path`/Lesson/Rank Identity
не начинались; backend/CRM/Pocket/DB не подключались.

## Тесты

- E2E smoke: 21 (добавлены — 200% zoom CTA-над-nav+focusable, landscape CTA-над-nav+scrollable,
  320 Alex/checkpoint-над-nav, checkpoint regression, focus-не-под-nav). Reusable helper
  `assertElementAboveBottomNavigation(page, selector, gap)` — проверка по реальным bounding-box.
- Screenshots: 11 состояний в `design-memory/screenshots/d1b-2-short-viewport-fix/final/`.
- Unit: 32 (без изменений).

Детали и evidence matrix — `design-memory/reviews/d1b-2-short-viewport-fix-review.md`.

## Статус

**Home считается завершённой после D1B.2.** Следующий этап — полноценный `/path` (не начинать без запроса).
