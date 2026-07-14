# D1A-R2.2 — Final production-readiness correction (design-only)

Last design-only correction before React. Route Field **окончательно утверждён** как основа Главной,
глобального Пути, отображения текущего уровня и приближения к контрольной точке. Не новое art
direction. Продукт — **Alfa Trade Academy**. References provisional. React ещё **не** разрешён.

## Что сохранено (не потеряно)
deep navy field · active cyan/green route · cold blue checkpoint boundary · открытый lesson plane
(не полная rounded-card) · Route Field как главный объект · current node как источник контекста ·
спокойный CTA · near/boundary/far checkpoint · нет balance пользователя · нет Pocket CTA · нет
card-grid · нет постоянного sidebar · отдельная mobile composition · компактная top navigation ·
Alex без случайного stock-person.

Не возвращено: яркая SaaS-кнопка · центральная dashboard-card · floating reward pills · generic
hexagonal/sparkline rank · огромная сумма · ряд KPI · декоративный market chart.

## Точечные коррекции

- **Active desktop — route density.** Участок 18→19→граница 20 читается: current node 18, level 19
  как будущий учебный узел, module boundary, продолжение к контрольной точке; маршрут занимает больше
  функциональной площади, без cards и без плотной диаграммы. Lesson plane открыт (node = верхний левый
  anchor, horizontal trace = верх, vertical trace = левая грань, право/низ открыты). Ни одна линия не
  проходит через текст; node полностью виден; module progress внутри plane; CTA — route action.
- **Active mobile — устранён реальный дефект.** Marker 17 и route больше **не заходят под lesson title**:
  current node с безопасным отступом над plane, previous marker вне типографики, route входит в node, но
  не проходит через текст, heading полностью читается, route crop намеренный.
- **Future checkpoint preview — структурный.** Desktop: дальняя граница (boundary graphic) + «Контрольная
  точка · Уровень 20» + следующий ранг/инструмент за воротами (не текстовая строка). Mobile: компактный
  structural preview (≤110px) вместо строки — фрагмент границы + «Контрольная точка · Уровень 20» + две
  строки результата (Следующий ранг: Наблюдатель IV / Откроется: Chart Markup Tool). Не две pills.
- **Checkpoint desktop.** Композиция сохранена; поднята (верхняя половина не пустая), aperture глубже,
  far field не бледный, ранг и инструмент читаются, CTA не ярче gate, Alex не теряется. near/boundary/far
  не сломаны.
- **Checkpoint mobile — результаты разделены.** Вместо «За границей — Наблюдатель IV · Chart Markup Tool»
  — два отдельных результата (Следующий ранг / Наблюдатель IV; Новый инструмент / Chart Markup Tool) как
  far-side preview с общей структурной линией, одним Route Knot placeholder и минимальными разделителями.
  «Наблюдатель IV» не разбивается на три строки; понимается за 3 секунды.
- **Финансовая иерархия.** Спокойная: первые две строки объединены («Для продолжения подтверди условие:
  баланс Pocket от $200.»), «$200» не крупнее heading, без glow/deposit-styling/urgency/«осталось»/
  Pocket-CTA. CTA «Проверить выполнение» — часть Route Field action language.
- **Debug copy удалён** из пользовательских кадров: `D1A-R2.1`, `Route Field · State A`, `design-only`,
  phase labels, debug-footer, постоянная инструкция «маршрут можно двигать», технические стрелки-подсказки.
- **Alex media-frame улучшен**: cinematic crop placeholder без лица, subtle directional light, явная
  asset-layer boundary для замены; имя «Alex Curie» нормально (без debug letter-spacing), «наставник
  курса» вторично; сообщение 1–3 строки; на mobile frame компактный.
- **Navigation**: компактная, active как короткий route segment (не только цвет), «Ещё» последним,
  secondary labels чуть контрастнее, 5 пунктов (не 9), без radial.
- **Rank**: nested-square Route Sigil **отклонён** → **Route Knot** (см. `route-knot-study.html`).

## Route Knot (новая provisional rank система)
Пройденный маршрут складывается в компактный асимметричный узел: один continuous trace · central
anchor · open endpoint · closed endpoint · 1–4 captured nodes · асимметричный силуэт · без рамки-
контейнера, без полного круга, без направления графика. Наблюдатель I–IV = 1–4 captured nodes (меняется
структура узла; IV замыкает внутренний маршрут). Читается в 22px, силуэт держится в monochrome, не похож
на wallet/camera/scanner/QR/chart/target/shield/medal/hexagon/букву A/пирамиду/стрелку/монету.

## Оценка
Evidence matrix (`design-memory/reviews/d1a-r2-2-review.md`) — все Pass. Любой Fail блокирует React.
Отсутствие Fail **не заменяет** пользовательское approval: React разрешается только после ручного
просмотра R2.2 и явного решения.
