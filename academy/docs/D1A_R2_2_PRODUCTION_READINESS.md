# D1A_R2_2_PRODUCTION_READINESS

Финальная design-only коррекция Route Field перед React. Продукт — **Alfa Trade Academy**.
References provisional. React ещё **не** разрешён.

## Зафиксировано

- **Route Field утверждён** как основа Главной, глобального Пути, отображения текущего уровня и
  приближения к контрольной точке. Новое art direction не искать; к Product Portal / Market Atlas /
  Editorial Academy не возвращаться; dashboard/card-grid не возвращать.
- **R2.2 — последняя design-only correction перед React.**
- **Nested-square Route Sigil отклонён.**
- **Route Knot** — provisional rank система: пройденный маршрут, свёрнутый в компактный асимметричный
  узел (один continuous trace · central anchor · open + closed endpoints · 1–4 captured nodes ·
  асимметричный силуэт · без рамки-контейнера, без полного круга, без направления графика). Ступень
  I–IV = число captured nodes (меняется структура узла; IV замыкает внутренний маршрут). Читается в
  22px, силуэт держится в monochrome, не похож на wallet/camera/scanner/QR/chart/target/shield/medal/
  букву A/пирамиду/стрелку/монету.
- **React разрешается только после ручного просмотра R2.2** и явного решения пользователя. **Отсутствие
  Fail в evidence matrix не заменяет пользовательское approval.**

## Что сделано (точечно)

- Active desktop: улучшена route density (18→19→граница 20), lesson plane открыт (grown from node), ни
  одна линия не проходит через текст.
- Active mobile: устранён реальный дефект — marker 17 и route больше не заходят под lesson title; node с
  безопасным отступом над plane; heading полностью читается.
- Future checkpoint preview стал структурным (desktop: дальняя граница + level 20 + rank/tool за
  воротами; mobile: компактный structural preview ≤110px, не строка, не pills).
- Checkpoint desktop: композиция сохранена и поднята (верхняя половина не пустая), aperture глубже, far
  field читается, near/boundary/far не сломаны.
- Checkpoint mobile: результаты разделены (Следующий ранг / Наблюдатель IV · Новый инструмент / Chart
  Markup Tool) — структурная линия + один Route Knot + минимальные разделители, не две карточки.
- Финансовая иерархия спокойная: первые две строки объединены, «$200» не крупнее heading, без glow/
  deposit-styling/urgency/«осталось»/Pocket-CTA. CTA «Проверить выполнение» — Route Field action language.
- Debug copy удалён из пользовательских кадров (phase labels / «design-only» / «Route Field · State A» /
  постоянная инструкция «маршрут можно двигать» / технические стрелки-подсказки).
- Alex media-frame улучшен: cinematic crop без лица, directional light, явная asset-layer boundary; имя
  нормально; «наставник курса» вторично; сообщение 1–3 строки; на mobile компактный.
- Navigation компактная: active = короткий route segment (не только цвет), «Ещё» последним, secondary
  labels чуть контрастнее, 5 пунктов.

## Артефакты
- Proposals: `design-memory/proposals/d1a-r2-2/` (`final-correction.md`, `home-active.html`,
  `home-checkpoint.html`, `route-knot-study.html`, `shared.css`, `mobile-behavior.md`,
  `assets/route-knot-3.svg`, `assets/alex-media.svg`).
- Screenshots: `design-memory/screenshots/d1a-r2-2/final/` (5 PNG, точные размеры, console clean,
  без overflow) + `.../first-pass/`.
- Review + evidence matrix (все Pass) + UX audit: `design-memory/reviews/d1a-r2-2-review.md`.
- R2 / R2.1 не перезаписаны.

## Status
Route Field готов к реализации на уровне направления. **React implementation ещё не разрешён** — только
после ручного review R2.2 и явного решения пользователя. D1B не начат.
