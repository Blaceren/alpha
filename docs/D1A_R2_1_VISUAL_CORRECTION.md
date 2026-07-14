# D1A_R2_1_VISUAL_CORRECTION

Точечная визуальная коррекция утверждённого направления Route Field (design-only). R2 принят
концептуально, но **не** визуально. Это не новое art direction. React ещё **не** разрешён.
Продукт — **Alfa Trade Academy**. References provisional.

## Что зафиксировано

- **Route Field сохранён** как основа Главной и Пути.
- **R2 визуально не принят**: центральная rounded-card снова стала интерфейсом, маршрут был позади карточки.
- **Card-centric implementation отклонён**: lesson context теперь — открытая асимметричная поверхность,
  сформированная route geometry (bounded top+left, open bottom-right), без generic central card.
- **Checkpoint gate требует near / boundary / far structure**: near (завершённый путь + позиция +
  условие) → boundary (две смещённые вертикальные плоскости + световой aperture + сжатие/остановка
  route + депт-сдвиг) → far (новый ранг + Chart Markup Tool + следующий module field, за воротами).
  Reward и новый ранг — **за воротами**, не floating pills.
- **Sparkline rank artifact отклонён.**
- **Route Sigil** — новое provisional направление ранга: завершённые участки маршрута свёрнуты в
  устойчивый знак (central anchor + один continuous trace + 1–4 слоя + family contour + точка ступени).
  Читается в 22px, силуэт держится в monochrome. Не chart/sparkline/hexagon/медаль/щит/буква A/пирамида/
  стрелка/монета. Четыре состояния: 22px · 40–48px · 96–120px · transition (сборка следующего слоя).
- **Финансовая иерархия checkpoint**: контрольная точка → что подтвердить → минимальное условие
  «Баланс Pocket от $200» (спокойно, не рекламный центр) → что учитывается → что откроется → CTA.
  Без giant-суммы/glow/deposit-styling/срочности/«осталось»/Pocket-CTA. Спокойный текст утверждён.
- **CTA** = route action marker: высокий контраст, минимум neon/glow, принадлежит route signal, не
  самый яркий объект и не низкоконтрастный ghost.
- **Alex Curie** — заметное provisional media presence (reserved media frame + editorial voice strip),
  привязан к node; компактно на mobile; не серый avatar/не отдельная generic-карточка/не floating chatbot.
- **Navigation** поддерживает Route Field: компактная identity, текущий раздел как route-segment, 5
  пунктов, иконки provisional.
- **Mobile** — route-first в обоих состояниях, не card stack.

## Оценка
Не общий self-балл, а **evidence matrix** из 14 критериев — все **Pass**
(`design-memory/reviews/d1a-r2-1-review.md`). Любой Fail блокировал бы React; Fail нет, но React
всё равно **не разрешён** без явного решения пользователя.

## Артефакты
- Proposals: `design-memory/proposals/d1a-r2-1/` (`correction-thesis.md`, `home-active.html`,
  `home-checkpoint.html`, `rank-sigil-study.html`, `shared.css`, `mobile-behavior.md`, `assets/route-sigil-3.svg`).
- Screenshots (final): `design-memory/screenshots/d1a-r2-1/` (5 PNG, точные размеры, console clean).
- First-pass сохранён: `design-memory/screenshots/d1a-r2-1/first-pass/`.
- Review + evidence matrix + UX audit: `design-memory/reviews/d1a-r2-1-review.md`.
- R2 (концептуальный) не перезаписан: `design-memory/proposals/d1a-r2/`, `.../screenshots/d1a-r2-high-fi/`.

## Status
Route Field visually corrected. **React implementation ещё не разрешён.** D1B не начат.
