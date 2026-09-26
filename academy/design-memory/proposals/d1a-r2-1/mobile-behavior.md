# D1A-R2.1 — Mobile behavior (390×844)

Mobile — route-first, **не** card stack. Bottom nav: Главная · Путь · Уроки · Инструменты · Ещё.
Профиль через avatar. Touch ≥44px. Не более одной полноценной rectangular surface на экран.

## State A — Active lesson
- Часть **предыдущего route видна с края** (снизу-слева).
- **Current node** в верхней/средней трети экрана (пространственный якорь + glow).
- **Lesson context физически раскрывается из node** как открытое поле (top+left edge = route, open
  bottom-right) — не карточка.
- **CTA «Продолжить урок» в первом viewport** (route action marker: текст + solid arrow node).
- **rank/XP/streak — instrumentation line** (Route Sigil · Наблюдатель III · 2 480 XP · Серия 6), не три карточки.
- **Checkpoint — distant boundary preview** (маршрут уходит вверх-вправо за экран = направление swipe).
- **Alex** — компактный voice fragment (1–2 строки), привязан к lesson, не в отдельной карточке.
- **Bottom navigation не перекрывает route**.

## State B — Current checkpoint
- **Gate виден в первом viewport** почти целиком: near route → boundary (две смещённые плоскости +
  aperture) → far field частично виден за ним (тусклее).
- **Прошлый route входит в gate** и останавливается перед границей.
- **Условие компактно**, не занимает весь экран; **сумма не доминирует** (обычный ink, без glow/зелёного гиганта).
- **CTA «Проверить выполнение» помещается без scroll** в первом viewport.
- **Ранг и инструмент — за boundary** (Наблюдатель IV · Chart Markup Tool, тусклее, справа/за воротами),
  не floating pills.
- **Alex** — компактное объяснение, не конкурирует с CTA.
- **Нет стандартной большой карточки по центру.**

## Общие правила
- Один glow focus (node в A / aperture ворот в B). Один primary CTA на экран; CTA не ярче route-системы.
- Route-overflow — внутри своего слоя; страница по горизонтали не скроллится.
- Служебный текст читаем без увеличения (≥12px, контраст ink-2).
