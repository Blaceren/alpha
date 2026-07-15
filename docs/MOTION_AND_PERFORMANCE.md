# MOTION_AND_PERFORMANCE

Правила движения и производительности. Motion служит понятности и премиальности, а не декору. Два режима: functional (сдержанно) и emotional (milestone).

---

## 1. Классы анимации

### Functional animation (везде)
Навигация, tabs, path, node state, progress, dialog, sheet, autosave-индикатор.
- Длительность: 140–240 ms (`--motion-fast` 140, `--motion-base` 200, `--motion-slow` 240).
- Easing: `--ease-standard` cubic-bezier(0.2, 0, 0, 1).
- Никакого scroll lock, никаких длинных задержек перед контентом.

### Emotional animation (только milestone)
rank-up, checkpoint completion, module completion, tool unlock, community unlock, referral reward, level 100.
- Длительность: 2000–4000 ms, `--motion-milestone`.
- Всегда **skippable**.
- Controlled glow, depth, subtle particles, объёмные rank emblems, короткие cinematic transitions.
- После анимации — показать practical unlock (что именно открылось).

---

## 2. Жёсткие правила

- **No scroll lock** — контент всегда прокручиваем.
- **No long animation before content** — контент не ждёт анимацию.
- Обычный переход 140–240 ms; milestone 2–4 c.
- Любая milestone-анимация **skippable** (кнопка «Пропустить»).
- Быстрый scroll **не ломает** состояние (path, node, центрирование).
- Тяжёлые эффекты **отключаются** на слабых устройствах.
- Скрытая вкладка (hidden tab) **ставит ambient-анимацию на паузу**.
- OS `prefers-reduced-motion` **не ломает UI**: milestone заменяется мгновенным конечным состоянием, ambient/particles выключаются, glow — статичен.

---

## 3. Путь (специфика)

- Автоцентрирование текущего уровня — плавно, ≤ 240 ms при программном переходе.
- Кнопка «К текущему уровню» — мгновенный, но анимированный возврат; не блокирует ввод.
- Ambient-движение линии пути (мотив рынка) — низкой интенсивности, на паузе в hidden tab и при reduced-motion.
- Node state transitions (locked→active→completed) — functional-класс.

---

## 4. Reduced-motion матрица

| Эффект | Обычно | Reduced-motion |
|--------|--------|----------------|
| rank-up сцена | 2–4 c cinematic | мгновенный результат + practical unlock |
| path ambient | лёгкое движение | статично |
| particles/glow pulsing | вкл | выкл / статичный glow |
| page transition | 200 ms fade/slide | мгновенно или ≤120 ms fade |
| autosave pulse | лёгкий | статичный индикатор |

---

## 5. Производительность (targets, provisional)

- Первый значимый контент не блокируется анимацией.
- Path остаётся отзывчивым при быстрой прокрутке (виртуализация дальних nodes; hidden/locked не рендерятся тяжело).
- Milestone-сцены не грузят критический путь загрузки страницы (ленивая инициализация).
- Video: сохранять позицию, subtitles обязательны; без обязательного автоплея тяжёлых сцен.
- Ambient и particle-эффекты имеют бюджет кадра; при его превышении на устройстве — деградация до статики.
- Изображения (chart uploads, journal screenshots) — оптимизируются/ленивая загрузка.

Точные метрики (LCP/INP/бюджеты кадра) фиксируются в D9 вместе с visual QA.

---

## 6. Где motion запрещён/минимален

- Functional-страницы (уроки, тесты, reports, tools, community, news, support, mentor, profile, settings) — без ambient-сцен прелендинга.
- Внутри форм (reports, tools) — только микрофидбек (focus, autosave), без отвлекающего движения.
- Никаких казино-эффектов на rank-up/reward.

## 7. D1B.1 — примечание (responsive/zoom)

Корректирующий этап D1B.1 (responsive/zoom/safe-area/contrast) **не менял motion-стратегию**.
Единственная анимация Главной — CSS-пульс текущего узла (`node-pulse`), отключаемый через
`prefers-reduced-motion`. 200% zoom-reflow достигается медиазапросами (CSS-ширина), без
`transform: scale()`/CSS `zoom`, поэтому не влияет на анимацию и не создаёт layout-трэшинга.
Reduced-motion проверен в e2e. Детали — `docs/D1B_1_RESPONSIVE_CORRECTION.md`.
