# D1A-R2.1 — Route Field Visual Correction (design-only)

Route Field остаётся **утверждённой основой** Главной/Пути. R2 принят концептуально, но **не** визуально.
Это точечный visual correction pass. Не новое art direction, не возврат к трём вариантам. React запрещён.
Продукт — **Alfa Trade Academy** (никогда «Alpha Trade»). References provisional.

## Подтверждённые проблемы R2 (что исправляем)
1. Центральная rounded-card снова стала главным интерфейсом → убрать generic central card.
2. Маршрут позади карточки, а не формирует её → route формирует lesson context.
3. Много неработающей пустоты на desktop → заполнить функциональными элементами Route Field.
4. Checkpoint gate = координатная ось → сделать структурные ворота с near/boundary/far зонами.
5. $200 + зелёная CTA = финансовое давление → снизить, $200 не рекламный центр.
6. Rank artifact = generic sparkline → заменить на **Route Sigil**.
7. Alex слишком слаб → заметное provisional media presence.
8. Top nav = generic SaaS header → nav поддерживает Route Field.
9. Mobile = stacked card → route-first mobile.
10. CTA ярче маршрута → CTA принадлежит Route Field, не самый яркий объект.
11. Reward/checkpoint как pills → часть системы (за воротами).
12. Служебные подписи мелкие/низкоконтрастные → читаемы без увеличения.

## Ключевые структурные решения

- **Lesson context = открытая асимметричная поверхность, сформированная route geometry** (open с одной
  стороны, без тяжёлой рамки по периметру, без стандартного 560×250 с одинаковым radius). Route проходит
  вдоль/через lesson context; убрать нельзя без разрушения композиции. Current node всегда виден.
- **CTA = route action marker** (продолжение маршрута со стрелкой), высокий контраст, минимум neon/glow,
  визуально принадлежит active route signal, не единственный яркий прямоугольник.
- **Checkpoint gate = near / boundary / far**:
  - *near*: завершённый путь + current position + условие (спокойный текст);
  - *boundary*: две смещённые вертикальные плоскости + световой aperture + сжатие route + депт-сдвиг;
    маршрут физически останавливается перед gate; verification/переходная точка (CTA у границы);
  - *far*: за воротами — новый ранг (Route Sigil IV) + Chart Markup Tool + следующий module field (тусклее).
  Reward и новый ранг **за воротами**, не две floating pills. В Active gate дальний/вторичный; в Checkpoint — главный объект.
- **Финансовая иерархия**: Контрольная точка → что подтвердить → минимальное условие «Баланс Pocket от
  $200» (спокойно, не гигант/не зелёный/без glow) → что учитывается → что откроется → CTA. Без deposit-
  styling, без срочности, без «осталось», без Pocket-CTA.
- **Route Sigil** заменяет sparkline-artifact (см. `rank-sigil-study.html`).
- **Alex** — reserved media frame (крупнее) + editorial voice strip, встроенный в route, привязан к node.
- **Navigation** — компактная product identity; текущий раздел как route-segment; 5 пунктов
  (Главная/Путь/Уроки/Инструменты/Ещё); не 9 одинаковых ссылок; иконки provisional, не основа бренда.

## Materials
Deep navy field; cyan/green active trace; cold blue boundary; controlled volumetric depth; fine
functional metadata; один meaningful glow focus. Убрать: одинаковый border у всех поверхностей, solid
card wall, чрезмерную button-тень, слишком яркий neon green, серый low-contrast text, floating pills,
декоративные market labels. Значения provisional — не финальные HEX.

## Typography (усилить различие ролей)
action context · lesson title · route instrumentation · checkpoint condition · milestone preview ·
mentor voice. Без крошечного tracked uppercase для критичной информации, без обилия monospace, без
debug-footer, без low-opacity основного текста. Читаемо при 1440×900 и 390×844 без увеличения.

## Evidence-based acceptance
Оценка — не общий балл, а **evidence matrix** (`design-memory/reviews/d1a-r2-1-review.md`).
Любой Fail → React не допускается.
