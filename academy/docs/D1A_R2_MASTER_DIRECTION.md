# D1A_R2_MASTER_DIRECTION

Утверждённое консолидированное визуальное направление Главной Alfa Trade Academy (design-only,
high-fidelity prototype). Одна система, два состояния. References — provisional. React ещё **не** утверждён.

## Master visual thesis

**Главная — участок живого маршрута обучения.** Путь проходит сквозь пространство экрана; текущий
урок раскрывается прямо из светящегося current-node как **одна система** (route ↔ lesson-plane);
контрольная точка стоит впереди как **структурные ворота**, в которые маршрут упирается. Не dashboard,
не сводка карточек. Всегда виден один очевидный следующий шаг.

## Роли трёх систем (архитектурное решение)

- **Route Field = Home/Path system** — основа Главной и глобального Пути. Маршрут — главный
  композиционный объект: completed / current / upcoming / locked-сегменты, module boundary, checkpoint
  gate, reward branch, distant continuation, return-to-current. Не обычная progress line, не stock chart.
- **Learning Spine = curriculum context** — вспомогательный паттерн для модулей, уроков, отчётов и
  истории прохождения. На Главной — только маленький индикатор текущего модуля внутри current-node
  (16 · 17 · **18** · 19 · ◇20). Полноценная вертикальная spine на Главной не показывается.
- **Constructed Artifact = milestone/rank/unlock system** — один provisional rank-artifact (собран из
  линий/слоёв: «захваченный восходящий маршрут», тир = число сегментов). Компактно на Главной; крупнее в
  checkpoint-transition. Не постоянная оболочка Главной.

**Это не значит, что все три появляются одновременно.** На обычной Главной доминирует Route Field;
Spine — маленький контекст; Artifact — компактный знак. Spine раскрывается на своих страницах
(Путь/Уроки/Отчёты/История); Artifact крупнеет только в milestone/checkpoint.

## Два состояния (одна система)

- **State A — Active lesson.** Primary action «Продолжить урок». Route — главный объект; lesson-plane
  разворачивается из current-node (route входит в плоскость); checkpoint gate виден впереди, но вторичен;
  rank Наблюдатель III компактно; XP/Серия — route instrumentation; Alex — editorial quote у маршрута.
- **State B — Current checkpoint.** Primary action «Проверить выполнение». Route компрессируется в
  **структурные ворота** (центр композиции); условие «баланс Pocket от $200» + «учитывается только
  реальный баланс, demo не засчитывается»; **без баланса пользователя, без «осталось $X», без Pocket-CTA**;
  награда Chart Markup Tool + следующий ранг Наблюдатель IV — **один объект ворот**; пройденный маршрут
  остаётся виден; Alex объясняет смысл условия без финансового давления.

## Navigation & composition
- **Top command band** (не sidebar): wordmark · Главная/Путь/Уроки/Инструменты/Ещё · уведомления · avatar.
- Mobile: bottom nav (Главная/Путь/Уроки/Инструменты/Ещё); профиль через avatar; touch ≥44px; mobile —
  самостоятельная композиция, не уменьшенный desktop.
- ≤3 прямоугольных контейнера в первом viewport; один meaningful glow focus; несколько типов surfaces
  (не «стена карточек»).

## Materials (provisional — не финальные brand HEX)
Deep navy spatial field; холодный синий для структуры; restrained cyan/green для active/completed;
тонкие световые границы; редкие data markers; один glow focus. Финальные значения — после palette
(`design-memory/references/ata-brand/MISSING_BRAND_ASSETS.md`).

## Rank artifact system
Provisional Наблюдатель III в четырёх состояниях: small (навигация/профиль), medium (Главная), locked
(следующий ранг ghost), checkpoint transition (крупнее). Развитие внутри семьи — 4 ступени (тир = число
сегментов). Все 20 рангов не создаются. Детали — `design-memory/proposals/d1a-r2/rank-artifact-study.html`.

## Artefacts
- Proposals: `design-memory/proposals/d1a-r2/` (`master-direction.md`, `home-active.html`,
  `home-checkpoint.html`, `shared.css`, `assets/rank-observer-3.svg`, `rank-artifact-study.html`, `mobile-behavior.md`).
- Screenshots: `design-memory/screenshots/d1a-r2-high-fi/` (5 PNG, точные размеры, console clean).
- Review/scoring/UX: `design-memory/reviews/d1a-r2-high-fi-review.md` (score **89/100**, no automatic fail).

## Status
Направление зафиксировано как master для Главной/Пути. **React implementation ещё не утверждён** —
требуется явное решение пользователя. D1B не начат.
