# USERS_WORKSPACE.md — Alfa Trade Academy CRM (Phase 1B2)

Полноценный экран `/users`. Реализация: `src/features/users/`.

## Purpose
Дать сотруднику быстро: найти пользователя, понять его состояние и причину приоритета, отфильтровать базу по пяти измерениям, увидеть блокеры / owner / последнюю активность и перейти в будущий User 360 — **без** доступа к финансам/identity сверх прав роли. Экран — рабочий инструмент, не generic admin table.

## Information hierarchy
Главный принцип: **сначала идентичность и причина внимания, затем состояния и операционный контекст**. Порядок колонок отражает это: Пользователь → Приоритет (+причина) → состояния (Lifecycle/Funding/Engagement) → Прогресс → Блокеры → Owner → Активность.

## Columns
Основные (по умолчанию, 9):
1. **Пользователь** — avatar initials, display name (ссылка на `/users/[id]`), masked email (по identity projection), country/locale компактно.
2. **Приоритет** — человекочитаемая полоса (critical/high/normal/low, не только цвет) + краткая причина + tooltip.
3. **Lifecycle** — нейтральный бейдж (первичная стадия).
4. **Финансовый статус** (FundingStatus) — семантический бейдж.
5. **Engagement** — семантический бейдж.
6. **Прогресс** — уровень + XP + checkpoint-хинт (без per-row progress bar).
7. **Активные блокеры** — до 2 chips + `+N` (tooltip раскрывает все).
8. **Owner** — человекочитаемый.
9. **Последняя активность** — относительное время + exact в tooltip + freshness.

Опциональные (меню «Колонки», по умолчанию скрыты, состояние только в React state): Value-сегменты, Рекомендованное действие, Статус регистрации, Кампания/источник, Финансовое представление (баланс), Net deposits.

Колонка «Рекомендованное действие» печатает подпись из единого источника (D-52):
`config/labels`.`RECOMMENDATION_LABEL`, выведенной из `RECOMMENDATION_CATALOG[code].title` — тот же
канон, что у Today и User 360. Отсутствие рекомендации (и `no_action_required`) рендерится как «—»,
а не как выдуманное действие.

Row action «**Открыть профиль**» — явное действие в строке (строка целиком НЕ кликабельна). На десктопе — компактная доступная иконка (`aria-label` + `sr-only` «Открыть профиль» + tooltip), чтобы 9 дефолтных колонок помещались на 1440 без горизонтального scroll; на мобильных карточках — полнотекстовая кнопка «Открыть профиль». Имя пользователя дополнительно является обычной ссылкой на `/users/[id]`.

## Filters
Search: один input «Имя, email или ID», debounce 300 ms, ищет через provider (не локально).
Пять канонических измерений (multi-select): LifecycleStage, FundingStatus, EngagementStatus, ValueSegment, OperationalBlocker. Значения канонические (`pocket_registered`, `not_available`, `pocket_registration_incomplete`, …); пользователю показываются только человекочитаемые labels.
Вторичные (немного): priority, registrationStatus, owner.
UX: счётчик выбранных, active-chips, «Сбросить всё», очистка конкретного фильтра, совместная работа фильтров, zero-results ≠ empty dataset, на мобильном — Sheet/Drawer.

## Sorting
Provider-sorting по: priority, registeredAt, lastMeaningfulActionAt, currentLevel, owner, displayName. Индикатор направления (aria-sort). Начальная сортировка — по правилу приоритета (полоса → индекс правила → SLA → severity → last activity → stable user id); opaque score не вводится.

## Pagination
Provider cursor-pagination. Page size 20 (по умолчанию) / 50. Previous/next, диапазон «X–Y из N», disabled states. Сбрасывается при изменении search/filter. Не infinite scroll, не грузит весь датасет сразу.

## Terminology (Phase 1B2.1)
User-facing термины — единообразно русские, из `USERS_COLUMN_LABEL` (central config): **Этап**
(Lifecycle), **Активность** (Engagement), **Ответственный** (Owner), **Ценностные сегменты**,
**Регистрация Pocket**, **Чистые депозиты**. `Lifecycle/Engagement/Owner` в UI отсутствуют.
TS enum-имена не менялись. Доменные термины `Pocket`, `Grace-период`, `XP`, `FTD` сохранены.

## Responsive (Phase 1B2.1)
Стратегия колонок «состояний»: merged колонка **«Состояния»** (Этап + Финансовый статус +
Активность одним компактным стеком) на планшете и стандартном десктопе (md..2xl); индивидуальные
Этап/Финансовый/Активность — только на очень широких экранах (2xl+, ≥1536). `Ответственный` — с xl+.
- **1440×900** — компактный десктоп: user, priority, «Состояния», progress, blockers, ответственный,
  активность, действие; overflow 0 (замер), правый край не обрезан; опциональные колонки могут дать
  внутренний скролл (page overflow не создают).
- **1024×768** — намеренно компактный планшет: у пользователя скрыт email/локаль, priority reason —
  в tooltip, blocker — 1 chip + `+N` (усечён), паддинг ячеек уплотнён; overflow 0, правый край цел.
- **390×844** — mobile cards (пользователь, priority c читаемой причиной, три single-value state,
  blockers, ответственный, последняя активность, «Открыть профиль»); фильтры — Sheet с счётчиком
  «Фильтры (N)». Mobile — представление, не отдельный источник логики.

## Sticky edge columns (Phase 1B2.2)
Единственный контейнер горизонтального скролла — обёртка таблицы (`overflow-x-auto`); страница
горизонтально не скроллится. При включении опциональных колонок: **колонка идентичности** («Пользователь»)
остаётся sticky слева, **колонка действия** («Открыть профиль») — sticky справа с непрозрачным фоном,
мягким edge-separator и корректным hover (`group-hover:bg-row-hover`); опциональные колонки
прокручиваются между ними. Действие видно до и после скролла (в той же правой зоне), focus не
обрезается. Дефолтный набор без опциональных колонок помещается без скролла. Ширина колонки действия —
только под иконку.

## Toolbar (Phase 1B2.1)
Предсказуемые ряды: (1) поиск + `Колонки` (tablet/desktop) и `Фильтры`-Sheet (mobile/tablet);
(2) группа фильтров-дропдаунов — только desktop (xl+); (3) active-chips + «Сбросить всё» — отдельный
ряд на всех брейкпоинтах. `Колонки`/chips никогда не остаются одни на случайной строке.

## Roles
Проверяются: admin, retention, mentor, support, analyst, read_only. Экран/данные фильтруются через существующий permission layer и provider-проекции. См. таблицу ролей в `docs/visual-reviews/PHASE_1B2_USERS.md`.

## Financial projections
UI рендерит ТОЛЬКО provider-проекцию (`FinancialProjection`), не считает права сам:
- **exact** — только роли с правом (admin/manager/retention).
- **bucket** — человекочитаемый диапазон, без точной суммы (mentor/support/moderator/content_manager).
- **aggregated** — analyst (bucket-level, псевдонимно).
- **hidden** — различает две разные причины по `hiddenReason` (D-40): **«Недоступно для роли»**
  (значение есть, но роль не вправе его видеть — напр. read_only) и **«Нет данных»** (значение ещё
  не поступало из продукта). Раньше показывалось только первое, из-за чего роль с правом на финансы
  получала ложное сообщение о нехватке прав. Текст — из единого источника `FINANCIAL_HIDDEN_LABEL`,
  общего с User 360, поэтому семантика на обоих экранах одинакова.
- **stale** — значение видно + иконка freshness.
Provider не отдаёт точную сумму ролям без права → exact-значение физически не попадает в DOM (не в title/data-*, не скрыто только CSS). Покрыто тестом.

## Identity projection
List-контекст всегда masked (даже для привилегированных ролей — полный email в списке не показывается). analyst → pseudonymous; content_manager → hidden; moderator → display name + platform id. Реальный PII reveal НЕ реализован (вне scope).

## States
loading (skeleton header+rows, стабильная ширина), empty dataset, no-results (отдельно, CTA «Сбросить фильтры»), error (сообщение + «Повторить» для retriable; internal-код не показывается), stale (данные видимы + спокойный banner + freshness), unauthorized (без частичных данных).

## Accessibility
Semantic `<table>` на desktop, `<th scope>`, `aria-sort`, keyboard-доступные фильтры, label для search, sr-текст для icon-кнопок, focus-visible, статусы не только цветом (всегда есть текст), accessible tooltips (Radix), row action через Tab, mobile cards с корректной иерархией.

## Screenshots
`screenshots/phase-1b2-1-users-hardening/` (реальный рендер, headless Chromium 149 через
`tests-e2e/users-screenshots.spec.ts`, перегенерация — `npm run test:e2e`): admin, admin+колонки,
support, filtered — 1440×900; tablet 1024×768; mobile и mobile-filtered 390×844 — точных размеров,
консоль чистая. Ревью, найденные проблемы и исправления — `docs/visual-reviews/PHASE_1B2_1_USERS_HARDENING.md`.
(Артефакты Phase 1B2 остаются в `screenshots/phase-1b2-users/`.)

**Состав E2E (13):** `smoke.spec.ts` (5) + `users-screenshots.spec.ts` (5 канонических Users-сценариев:
admin/support/filtered/tablet/mobile — каждый со своими console/viewport/permission проверками) +
`users-sticky-action.spec.ts` (3: default, before/after horizontal scroll, keyboard focus). Sticky-тесты
вынесены отдельно, чтобы не заменять основной screenshot-suite.

## Owner: согласованность (Phase 1B4-C)
Назначение owner делается на **User 360**, не здесь (assignment UI в таблице Users **не** добавлен, D-74).
Но колонка «Ответственный», owner-фильтр и сортировка `owner` читают **effective owner** — baseline
fixture, перекрытый overlay (D-70). После назначения на User 360 Users показывает нового владельца при
следующем provider read / navigation; live cross-tab обновление открытой таблицы не реализовано (D-72).
Опции owner-фильтра теперь **выводятся** из canonical employee directory (D-67), а не из ручного списка
(прежний `emp_mod1`, которым никто не владел, убран — фильтр не возвращает пусто).

## Non-scope (Phase 1B2)
Today, User 360, localStorage mutation overlay, notes/tasks/cases, owner assignment UI в таблице (делается на User 360, 1B4-C), saved-views persistence, bulk actions, export, PII reveal, communications, backend/API/DB/Prisma/Pocket, auth, deploy.

_Связано: DATA_PROVIDER_CONTRACT.md, ROLE_PERMISSION_MATRIX.md, config/labels.ts, ARCHITECTURE.md._
