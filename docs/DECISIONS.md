# DECISIONS.md — Alfa Trade Academy CRM

> Phase 0.5 · Decision Lock. Зафиксированные продуктовые и технические решения. Все остальные документы обязаны соответствовать этим записям.
> Формат: `D-NN · Решение · Обоснование · Влияние`. Статус каждого — **Locked** (утверждено заказчиком в Phase 0.5).

---

## D-01 · Модель состояний разделена на 5 измерений — **Locked**

Прежний единый lifecycle mega-enum смешивал независимые состояния. Заменён на пять ортогональных измерений: **LifecycleStage** (1, versioned), **FundingStatus** (1), **EngagementStatus** (1), **ValueSegment** (0..N), **OperationalBlocker** (0..N).

- **Обоснование:** пользователь одновременно бывает `active` + `funded` + `repeat_funder` + `inactive_7d` + `support_blocked`. Один enum это выразить не может и приводит к перезаписи/потере данных.
- **Влияние:** STATE_MODEL.md (канон), CRM_DOMAIN_MODEL (`UserLifecycle` → `UserStateProfile`), фильтры/saved views, mock-персоны, UX-бейджи. Старый mega-enum удалён из всех документов.

---

## D-02 · Источники истины: продукт vs CRM — **Locked**

**Backend Alfa Trade Academy — источник истины** для: identity, регистрации, Pocket connection, XP, progression, уроков/тестов, reports, deposits, withdrawals, balance, checkpoints, historical completion.

**CRM владеет операционным слоем:** LifecycleStage, signals, value segments, recommended actions, приоритеты очередей, primary owner, tasks, cases, notes, communication fatigue, automation runs, outcomes, employee audit.

- **Правило:** CRM **не пересчитывает** Pocket balance, XP или checkpoint completion — только читает и операционализирует.
- **Влияние:** CRM_DOMAIN_MODEL (source-of-truth колонки), FUTURE_INTEGRATION, DATA_PROVIDER.

---

## D-03 · Стек будущей реализации — **Locked**

`Next.js App Router · TypeScript strict · Tailwind CSS · Radix UI primitives · TanStack Table · Zod · React Hook Form · Vitest · Playwright`.

- Последняя стабильная версия Next.js, совместимая с окружением; **без experimental-функций** без отдельного решения.
- На первой реализации: **без database, без Prisma, без настоящей authentication, без настоящей API integration.**
- **Влияние:** IMPLEMENTATION_PLAN (раздел стека переписан как Locked).

---

## D-04 · Пороги сигналов конфигурируемы, стартовые значения зафиксированы — **Locked**

Начальные mock-значения (полный список и структура — в SIGNAL_CATALOG.md):

`registration_no_start` 24 ч · `pocket_registration_incomplete` 24 ч · `email_not_confirmed` 12 ч · `lesson_abandoned` 24 ч · `progression_stalled` 72 ч (при доступном следующем уровне) · `repeated_test_failure` 3 провала за 24 ч · `report_rejected_no_return` 48 ч · `inactive_3d` 72 ч · `inactive_7d` 7 дней · `dormant_14d` 14 дней · `dormant_30d` 30 дней · `returned_after_absence` meaningful action после ≥7 дней · `communication_fatigue` >2 сообщений за 24 ч или 5 за 7 дней · `balance_data_stale` warning 15 мин / stale 60 мин (mock).

- **Правило:** пороги **не hardcode** в UI-компонентах; берутся из конфига.
- **Влияние:** SIGNAL_CATALOG.md (новый), STATE_MODEL (Engagement-пороги).

---

## D-05 · SLA-политика — **Locked**

`Mentor review 24 ч · Retention follow-up 24 ч · Support critical 1 ч · Support high 4 ч · Support normal 24 ч · Financial data conflict 4 ч`.

- Модель SLA поддерживает: timezone, business calendar, paused state, warning threshold, breached state, resolvedAt. Для mock — календарные часы.
- **Влияние:** SLA_POLICY.md (новый), DATA_PROVIDER (queue SLA-поля), UX (SLA-бейджи).

---

## D-06 · Grace policy — **Locked**

`grace period 24 ч · минимум 2 подтверждения баланса ниже threshold · при известных открытых сделках suspension откладывается · доступ восстанавливается сразу после подтверждённого достаточного баланса`.

- **Правило:** backend продукта — authoritative по suspension; **CRM только отображает и операционализирует** состояние (`FundingStatus.checkpoint_grace` / `financial_access_suspended`).
- **Влияние:** STATE_MODEL (FundingStatus), CRM_DOMAIN_MODEL (GraceState), UX (grace-таймер).

---

## D-07 · Финансовая видимость и бакеты — **Locked**

Точные суммы видят: `crm_admin`, `crm_manager`, `retention_manager`.
`analyst` — только агрегированные и псевдонимизированные данные.
`mentor`, `support`, `moderator`, `content_manager` — по умолчанию **бакеты**:

`below_50 · 50_99 · 100_199 · 200_499 · 500_999 · 1000_2499 · 2500_4999 · 5000_9999 · 10000_plus`.

- `support` может получить точные значения **только** через отдельный permission + audit.
- **Влияние:** ROLE_PERMISSION_MATRIX (обновлена), DATA_PROVIDER (маскирование), UX (`MoneyCell` bucket-aware), PII_ACCESS_POLICY.

---

## D-08 · Ownership — **Locked**

`Один primary owner на пользователя` + отдельные assignees у task и у case. История смены primary owner сохраняется. **Два одновременных primary owner запрещены.**

- **Влияние:** CRM_DOMAIN_MODEL (`UserOwner` + assignee на CrmTask/CrmCase), ROLE_MATRIX (Assign).

---

## D-09 · Mock persistence — **Locked**

`Immutable synthetic fixtures` + `versioned localStorage mutation overlay`.

- Исходные 30 персон не изменяются; в localStorage сохраняются только synthetic-мутации: notes, mock tasks, mock cases, owner changes, saved views, preferences, mock audit records.
- Есть кнопка **Reset mock environment**; localStorage имеет `schemaVersion` для безопасного сброса несовместимых данных.
- **Никакой SQLite/Prisma/database.**
- **Влияние:** IMPLEMENTATION_PLAN (mock provider + overlay), MOCK_DATA_PLAN, UX (Reset-кнопка).

---

## D-10 · Checkpoints после level 100 — **Locked**

Суммы **не придумываются**. Состояние: `future_checkpoint_not_defined`. UI-copy: **«Следующая программа находится в разработке»** — без финансовой суммы и без фальшивого прогресса.

- **Влияние:** CRM_DOMAIN_MODEL (CheckpointRef + статус), PROJECT_CONTEXT (сетка), UX (empty-copy), MOCK persona `completed_current_curriculum`.

---

## D-11 · PII policy — **Locked**

Users list — email всегда masked (`a***@gmail.com`).
User 360 — полный email: `crm_admin`, `crm_manager`, `retention_manager`; `support` — только с отдельным permission; `mentor` — masked; `moderator` — display name + platform ID; `analyst` — pseudonymous ID; `content_manager` — без identity.
Reveal полного PII в будущем production требует: явного действия, reason code, audit, автоматического повторного скрытия.

- **Влияние:** PII_ACCESS_POLICY.md (новый), ROLE_MATRIX, DATA_PROVIDER (reveal-операция), UX (Reveal-flow).

---

## D-12 · Границы этапа подтверждены — **Locked**

Никакого доступа к production DB/Prisma/Pocket/основному backend; только synthetic/mock data; все изменяющие действия помечены mock/local; mock RBAC **не** заявляется как production security; интеграция позже — через отдельный защищённый API без переписывания UI.

---

## Сводка соответствия «вопрос Phase 0 → решение»

| Вопрос (IMPL §F) | Решение |
|---|---|
| 1. Стек | D-03 |
| 2. Источник сигналов/lifecycle | D-02 (CRM владеет lifecycle/signals; продукт — данные) |
| 3. Пороги сигналов | D-04 / SIGNAL_CATALOG |
| 4. SLA-часы | D-05 / SLA_POLICY |
| 5. Grace-детали | D-06 |
| 6. Маскирование финансов | D-07 |
| 7. Ownership | D-08 |
| 8. Персистентность демо | D-09 |
| 9. Curriculum > L100 | D-10 |
| 10. Приватность/identity | D-11 / PII_ACCESS_POLICY |

Все 10 блокирующих вопросов Phase 0 закрыты.

---

_Связано: STATE_MODEL.md, SIGNAL_CATALOG.md, SLA_POLICY.md, PII_ACCESS_POLICY.md, и все обновлённые Phase 0 документы._

---

## Phase 1A — записи реализации (Application Foundation & CRM Shell)

## D-13 · Версии стека зафиксированы — **Locked**

Next.js `14.2.33` (App Router, стабильная, без experimental), React `18.3.1`, TypeScript `5.6`, Tailwind `3.4`, Radix UI, TanStack Table `8.20`, Zod `3.23`, React Hook Form `7.53`, Vitest `2.1`, Playwright `1.48`. Выбран Next 14 (а не 15) для максимальной совместимости Radix/TanStack на React 18.

- **Заметка безопасности:** npm предупреждает о security-обновлении для 14.2.33 — поднять до патча 14.2.x на следующем этапе (не влияет на Phase 1A).

## D-14 · Границы слоёв защищены линтером — **Locked**

ESLint-правило `no-restricted-imports` запрещает `components/` и `app/` импортировать `data/mock/*` напрямую; допустимо только через `application/` и `data/`. Гарантирует, что UI ходит за данными исключительно через `CrmDataProvider`.

## D-15 · Иконки: lucide-react — **Locked**

Для операционного UI используется `lucide-react` (нейтральные линейные иконки). Это не элемент брендбука; при появлении фирменного стиля может быть заменено.

## D-16 · Icon-set и токены — provisional — **Noted**

CSS-токены (`src/styles/tokens.css`) помечены как provisional до утверждения брендбука Alfa Trade Academy. Меняются централизованно, без переписывания компонентов.

## D-17 · E2E-браузер вне sandbox — **Noted**

Playwright smoke-suite и конфиг включены в репозиторий, но бинарник Chromium не скачивается в текущем sandbox (лимиты). Запуск — локально: `npx playwright install chromium && npm run test:e2e`. В Phase 1A выполнена runtime-проверка через server-rendered HTML для всех маршрутов.

---

## Phase 1B1 — записи реализации (Synthetic dataset & derivation)

## D-18 · Next.js остаётся на 14.x (патч 14.2.35) — **Locked**

Обновление `14.2.33 → 14.2.35` (последний патч линии 14.2, дист-тег `next-14`) + postcss `8.5.17` + @playwright/test `1.61.1`. **Не** переходим на 15/16, т.к. это major + React 19 (риск дестабилизации доменного слоя). Остаточные 11 advisories — внутри next 14.2.35; устраняются только major-апгрейдом и **отложены** до отдельного migration-этапа.

**Формулировка риска (уточнено в Phase 1B1.1, см. D-26):** advisories остаются **не устранёнными**. Текущая экспозиция ограничена локальным mock-инструментом (нет production-деплоя, middleware, image-optimization, i18n, недоверенного трафика), поэтому они **не блокируют локальную разработку**. Публичный staging/production деплой **запрещён** до отдельного dependency/security review и upgrade-gate. Findings не скрыты (см. IMPLEMENTATION_STATUS).

## D-19 · Детерминированное время (FixedMockClock) — **Locked**

Единая опорная точка `MOCK_NOW = 2026-07-13T09:00:00Z`. Fixtures хранят относительные смещения; абсолютные времена и все производные состояния (SLA, grace, inactivity) вычисляются от `Clock`. Тесты и данные не зависят от реального времени.

## D-20 · Приоритет — правила, не score — **Locked**

Приоритет = полоса `critical/high/normal/low`, определяемая упорядоченными правилами с `reasonCode`+`evidence`. Никакого непрозрачного числового score. Tie-break детерминирован (SLA → severity → last action → user id).

## D-21 · Запрет финансово-давящих рекомендаций — **Locked**

Каталог рекомендаций не содержит `deposit_now/recover_losses/increase_trade_size/trade_more/restore_balance_by_deposit/urgent_redeposit` (проверяется тестом). После падения баланса — только образовательные/mentor/support/communication-suppression действия, с `humanApprovalRequired`.

## D-22 · Сортировка по точным финансам без права → invalid_input — **Locked**

Чтобы порядок по точной сумме не «утекал» неавторизованным ролям через UI-контракт, провайдер отклоняет sort по `balance`/`netDeposits` без `view_exact_financials` (ошибка `invalid_input`), а не молча переупорядочивает.

---

## Phase 1B1.1 — записи (Domain semantics & repository integrity patch)

## D-23 · Pocket: регистрация, а не подключение — **Locked**

Пользователь не «подключает» существующий Pocket-аккаунт — он проходит **регистрацию** Pocket, а продукт подтверждает статус. Финальный semantic rename (нет backward-алиасов, т.к. persistence/API ещё нет — один канонический набор кодов):

- LifecycleStage `pocket_connected` → **`pocket_registered`**
- FundingStatus `not_connected` → **`not_available`** (финансовый статус неприменим, пока регистрация Pocket не подтверждена)
- OperationalBlocker `pocket_not_connected` → **`pocket_registration_incomplete`**
- SignalCode `pocket_not_connected` → **`pocket_registration_incomplete`**
- RecommendedAction `help_connect_pocket` → **`help_complete_pocket_registration`** («Помочь завершить регистрацию Pocket»)
- Внутреннее поле `financial.connectionStatus` → **`registrationStatus`**. Финальные значения зафиксированы в D-27 (три значения; `confirmed`/`deregistered` удалены).

UI-формулировки «Подключить Pocket», «Связать аккаунт», «Pocket connection» не используются; допустимы «Регистрация Pocket / не завершена / проверяется / подтверждена / Помочь завершить регистрацию». Обновлены types, fixtures, engine, recommendations, filters, provider, labels, coverage matrix, docs, tests.

## D-24 · Очередь onboarding_attention — **Locked**

Добавлена 13-я Today-очередь `onboarding_attention` для новых пользователей (сигналы `registration_no_start` / `pocket_registration_incomplete` / `email_not_confirmed`). Приоритет очереди — normal; глобальный более высокий приоритет пользователя сохраняется. Финансовые значения не показываются (`QUEUES_WITHOUT_FINANCIALS`); элемент несёт identity projection. Единый typed источник queue codes/labels — `src/config/queues.ts`; канонический код `critical_attention` (никогда `critical`).

## D-25 · Git lock handling policy — **Locked**

Запрещено обходить lock-файлы через git plumbing (`commit-tree`, ручной `update-ref`, прямую запись `.git/refs`, альтернативный index). При появлении `.git/*.lock`: (1) проверить активный git-процесс; (2) не удалять lock при активном процессе; (3) удалять только доказанно stale lock штатным `rm`; (4) если удалить/закоммитить штатно нельзя — **остановиться и сообщить**, не обходить. (В Phase 1B1 commit был завершён плумбингом из-за зависших lock; политика введена, чтобы это не повторялось.)

## D-26 · Staging dependency security gate — **Locked**

Оставшиеся npm advisories (внутри next 14.2.35) описываются как **не устранённые**, не «риск ≈ 0». Экспозиция ограничена локальным mock-инструментом; локальную разработку не блокируют. **Публичный staging/production deploy запрещён** до отдельного dependency/security review и upgrade-gate (major-апгрейд Next/React выполняется отдельной задачей).

## D-27 · registrationStatus финализирован — три значения — **Locked**

`financial.registrationStatus` содержит **ровно три** значения: `not_registered`, `registration_pending`, `registered`. Значения `confirmed` и `deregistered` **удалены** (без backward-алиасов — persistence/API ещё нет).

Семантика:
- **`not_registered`** — регистрация Pocket не подтверждена, активная backend/provider verification сейчас не выполняется.
- **`registration_pending`** — пользователь выполнил/подтвердил регистрационное действие, но backend/provider ещё не подтвердил результат (не означает успешное завершение).
- **`registered`** — backend получил и принял подтверждённое событие регистрации Pocket по affiliate flow. Нельзя выставлять по клику, локальной форме, ручному предположению CRM, email confirmation, депозиту или наличию финансовых данных.

`deregistered` удалён, потому что **подтверждённого production-события дерегистрации нет** (было придумано по аналогии со старым `disconnected`). `confirmed` слит в `registered` (единственное «успешно завершено» состояние = получен `pocket_registration_confirmed`).

## D-28 · Provider contract-дополнения из Users UI — **Locked**

Экран `/users` выявил реальные пробелы контракта `CrmDataProvider` (не косметика): (1) сортировка по **owner** отсутствовала в `UserSortField`; (2) фильтры по **priority** (`PriorityBand[]`) и **registrationStatus** отсутствовали в `UserFilters`, хотя оба заявлены как вторичные фильтры Users. Добавлены в контракт и в `MockCrmDataProvider` (owner-sort с детерминированным tie-break `￿` для «без owner»; priority/registrationStatus — membership-фильтры). Провайдер остаётся единственным источником pagination/search/filter/sort/projection — UI логику не дублирует.

## D-29 · Users table density & assets — **Locked**

Три исправления, продиктованные реальным браузерным рендером (visual-review §первый pass), не меняющие доменную модель:
- **Действие в строке** на десктопе — компактная доступная иконка (`ArrowRight` + `aria-label` + `sr-only` «Открыть профиль» + tooltip); на мобильных карточках сохранена полнотекстовая кнопка. Причина: 9 дефолтных колонок + текстовое действие давали горизонтальный overflow на 1440 (`Owner`/действие обрезались). После уплотнения (перенос заголовков, `px-2`, ограничение ширины «тяжёлых» ячеек, иконка) замер `scrollWidth − clientWidth = 0`. «Явное действие в строке» сохранено (иконка — дискретный контрол, не implicit-клик по всей строке).
- **`src/app/icon.svg`** добавлен: устраняет автоматический запрос `/favicon.ico` → 404 (требование «no failed assets» в консоли).
- **Stale-флаг** у «Последней активности» убран: ранее ошибочно брался из `balance.stale` (staleness баланса ≠ staleness meaningful activity).

## D-31 · Users search input mounted-gate (hydration) — **Locked**

Поле поиска в `UsersToolbar` рендерится реальным `<input>` только после mount; на сервере/первом
клиентском рендере — визуально идентичный placeholder-бокс. Причина: Chromium form/autofill-агент
интермиттентно впрыскивает inline-`style` в SSR-узел input в окне гидратации → dev-warning
«Extra attributes from the server: style» (сервер `style` не отдаёт, код не ставит — доказано).
Клиентски создаваемый input не гидратируется, узла для сверки нет. Не `suppressHydrationWarning`,
визуал не меняется.

## D-32 · Phase 1B2.1 Users visual hardening — **Locked**

Только пресентационная полировка `/users`; provider/domain/permissions/financial projection не
менялись, `/users/[id]` — placeholder, User 360 и Today не начинались.
- **Терминология:** user-facing термины единообразно русские через `USERS_COLUMN_LABEL`
  (Этап/Активность/Ответственный/Ценностные сегменты/Регистрация Pocket/Чистые депозиты).
  `Lifecycle/Engagement/Owner` в UI отсутствуют; TS enum-имена неизменны.
- **Responsive колонки:** merged «Состояния» (три оси одним стеком) на md..2xl; индивидуальные
  колонки — на 2xl+. `Ответственный` — с xl+. Причина: 9 отдельных колонок с русскими подписями не
  помещались рядом с 240px-сайдбаром → горизонтальный overflow. Итог: page overflow = 0 на 1024/1440.
- **Плотность строк:** owner `whitespace-nowrap` (одна строка); blockers 2 (desktop) / 1 (tablet) +
  `+N` с tooltip; priority reason — одна строка (desktop) / полн. читаема без hover (mobile); planshet
  скрывает email и reason ради компактности.
- **Toolbar:** предсказуемые ряды (поиск+Колонки/Фильтры · группа фильтров desktop · chips+Сбросить
  всё отдельным рядом).
- **Row action:** доступное имя `Открыть профиль <имя>`; иконка на desktop/tablet, текстовая кнопка
  на mobile; вся строка не является скрытой clickable-зоной.

## D-33 · Users table sticky edge columns — **Locked**

Колонка идентичности sticky слева, колонка действия sticky справа (`position: sticky`, не fixed);
опциональные колонки прокручиваются между ними внутри `overflow-x-auto` (страница горизонтально не
скроллится). Sticky-ячейки — непрозрачный фон (`bg-surface` header / `bg-background
group-hover:bg-row-hover` строки), мягкий edge-separator (border), корректный z-index, ширина
действия только под иконку. Причина: при включении опциональных колонок действие уходило за правый
край viewport (blocker). Blocker-бейджи получили controlled truncation (`max-w` + tooltip с полным
значением), чтобы не соприкасаться с «Ответственный». Permission-проекции не менялись; sticky-ячейка
действия не содержит финансовых данных.

**ATA email confirmation — отдельная identity-ось:** `identity.emailConfirmed` относится только к email аккаунта Alfa Trade Academy и **не** означает Pocket registration, Pocket «Email Confirmation» или affiliate verification. Сигнал `email_not_confirmed` зависит **только** от `identity.emailConfirmed`. Pocket «Email Confirmation» (отдельное provider-событие) на mock-этапе **не моделируется** — представление откладывается до backend/API contract (FUTURE_INTEGRATION §4). Persona 003 доказывает независимость осей: `registrationStatus = registered` + `emailConfirmed = false` + blocker `email_unconfirmed` + сигнал `email_not_confirmed`.

---

## Phase 1C — записи реализации (User 360, read-only)

## D-34 · Следующий этап — Phase 1C User 360; 1B3/1B4 отложены — **Locked**

Следующим этапом **намеренно выбран User 360**. Каноническое название — **Phase 1C — User 360**.
Переименование в «Phase 1B3» запрещено: номер 1B3 закреплён за Today Workspace и не переиспользуется.

- **Phase 1B3 — Today Workspace** — **отложен** до отдельного решения (не выполнен, не начат).
- **Phase 1B4 — mutations overlay** — **отложен** до отдельного решения (не выполнен, не начат).

- **Обоснование:** derivation-слой и permission-проекции готовы с Phase 1B1; `/users/[id]` оставался
  единственным placeholder-ом внутри уже реализованного пути «Users → профиль». User 360 read-only
  не требует mutations overlay, поэтому не зависит от 1B4.
- **Влияние:** IMPLEMENTATION_STATUS (раздел «Последовательность этапов»), README, USER_360.md.
  Следующий этап после 1C **не начинается автоматически** — только по отдельному заданию.

## D-35 · `getUser360` — единственная read-операция User 360 — **Locked**

Контракт `CrmDataProvider` расширен **одной read-only** операцией (14-й):
`getUser360(ctx, { userId }) → Result<User360>`. Существующие 13 операций не менялись.

- **Обоснование:** `getUserById` возвращает `UserSummary` — плоскую list-проекцию с
  `context: "list"` (identity всегда masked даже для admin), без learning/grace/SLA-состояния/
  сигналов/рекомендаций/событий. Сборка экрана из `getUserById` + `getUserTimeline` +
  `getUserSignals` + `getRecommendedActions` дала бы четыре loading/error-состояния и, что важнее,
  **композицию прав в UI**. Единый агрегат позволяет выполнить всю permission-проекцию внутри
  провайдера до React.
- **Правило:** вся проекция — в `domain/users/user-360-projection.ts`; UI рендерит полученное и
  никогда не решает видимость сам. Мутирующего аналога у операции нет.
- **Влияние:** DATA_PROVIDER_CONTRACT (§3 дополнен), USER_360.md, ARCHITECTURE.

## D-36 · Балансо-производные пояснения скрываются вместе с суммами — **Locked**

Для ролей без `view_exact_financials` провайдер отдаёт `learning.nextCheckpointRequiredUsd = null`,
а у финансово-производных сигналов (`checkpoint_approaching`, `rapid_balance_decline`)
`reason = null`, `evidence = []`. Сам сигнал роль по-прежнему видит.

- **Обоснование:** сетка контрольных точек — **опубликованная константа** (L10 = $100,
  PROJECT_CONTEXT §4.3), а `checkpoint_approaching` объясняет себя как «осталось 10%». Роль с
  бакетом `$50–99` вычисляла точный баланс арифметикой: `100 − 10% = $90`. Строки `$90` в DOM при
  этом не было — утечка **арифметическая**, а не текстовая. Маскирование только строк её не ловит.
- **Также:** HIGH-события (депозиты) не попадают в `activity` ролям без exact-финансов
  (DATA_PROVIDER_CONTRACT §4); отсутствие тихое, чтобы не раскрывать существование денежных событий.
  Анонимизация — ось целиком: при identity `hidden`/`pseudonymous` не отдаются
  `country/locale/timezone/acquisitionSource/campaign`.
- **Долг (закрыт в Phase 1C.1, см. D-39):** `getUserTimeline` игнорировала `ctx` и отдавала
  HIGH-события любой роли. Теперь обе операции используют единый canonical projector.
- **Влияние:** USER_360.md (§Financial privacy), visual-review PHASE_1C.

## D-37 · Unauthorized реализован, но ни одна роль его не вызывает — **Noted**

Состояние `unauthorized` реализовано, provider-driven и покрыто component-тестом со stub-провайдером.
Однако при **текущей утверждённой** матрице (ROLE_PERMISSION_MATRIX §2: User 360 = F/F/F/L/L/L/L/L/L
и PII_ACCESS_POLICY §5: `content_manager` — «без identity, обезличенный контекст обучения/контента»)
User 360 доступен **всем девяти ролям** хотя бы в ограниченном/обезличенном виде.

- **Следствие:** E2E-сценарий и скриншот `unauthorized` **не создавались** — это потребовало бы либо
  debug-контрола в UI (запрещён), либо сужения утверждённых прав ради артефакта.
- **Прецедент:** `UsersUnauthorized` в Users workspace (Phase 1B2) находится ровно в том же
  положении — состояние существует как защитная обработка контракта, ролью не достигается.
- **Открытый вопрос для заказчика:** нужно ли закрыть индивидуальную карточку пользователя для
  `content_manager` (identity = hidden делает карточку малоосмысленной). Требует решения по политике,
  а не кода.

## D-38 · Точечные исправления домена, выявленные User 360 — **Locked**

Экран показал три дефекта, которые не были видны в списочных экранах. Исправлены минимально:

1. **`FinancialProjection.hiddenReason`** (`"no_data" | "not_permitted"`). `mode: "hidden"` смешивал
   «нет данных» и «нет прав» → admin у пользователя без баланса видел ложное «Недоступно для роли».
   В Phase 1C-A исправлен только User 360; `FinancialCell` в Users сохранял прежний текст
   (latent-неточность зафиксирована как долг). **Долг закрыт в Phase 1C.1 — см. D-40.**
2. **`PriorityResult.sourceSignalCodes`** — какие активные сигналы интерпретировало сработавшее
   правило. Лестница правил остаётся единственным источником истины. Позволяет UI **ссылаться** на
   основание приоритета вместо третьего бейджа с тем же фактом (D-20 не нарушается: score не вводится).
3. **Текст `review_checkpoint_grace`** → «Разобрать контрольную точку / Финансовая контрольная точка
   требует внимания: приближение или активный grace-период». Прежняя формулировка утверждала
   «Активен grace period» пользователю **без** grace, т.к. действие триггерится и
   `checkpoint_approaching`, и `checkpoint_grace_active`. Коды не менялись, только user-facing текст.

- **Влияние:** projection.ts, priority.ts, catalog.ts, labels.ts, today/builder.ts (константа),
  USER_360.md, visual-review PHASE_1C.

---

## Phase 1C.1 — записи реализации (Provider privacy consistency)

## D-39 · Единый canonical timeline projector — **Locked**

Событийная лента строится и проецируется **одним** модулем `src/domain/users/user-timeline.ts`:
`buildUserTimeline(user)` → `projectTimelineEvent(entry, role)` / `projectTimeline(entries, role)` →
`buildProjectedUserTimeline(user, role)`. Его используют **обе** операции провайдера —
`getUserTimeline` и `getUser360`.

- **Обоснование:** до этого каждая операция имела свою реализацию ленты. `getUserTimeline` принимала
  контекст как `_ctx` и **игнорировала** его → HIGH financial events (подтверждённые депозиты)
  отдавались любой роли вопреки DATA_PROVIDER_CONTRACT §4 и политике User 360 (D-36). Параллельно
  `getUser360.projectActivity` имела правильный гейт, но собственный набор событий, свои заголовки,
  свою сортировку и свою дедупликацию. Один и тот же пользователь давал **разные события с разными
  правилами приватности** в зависимости от того, какая операция спросила.
- **Правило:** permission-логика живёт только в projector. Вызывающая сторона может **сузить форму**
  (User 360 берёт `id/at/source/kind/title` в `User360Event`), но **не принимает решений о видимости**.
- **Политика:** событие с `sensitivity: "HIGH"` не отдаётся ролям без `view_exact_financials`
  (crm_admin / crm_manager / retention_manager — единственные, кто их видит). Скрытие **тихое**:
  плейсхолдер не выводится, чтобы отсутствие не сообщало о существовании денежных событий.
- **Инвариант:** ни одно поле события никогда не содержит сумму — депозит несёт только **факт** и
  время (именно факт и делает его HIGH). Поэтому скрытое событие нельзя восстановить, а разрешённая
  роль не узнаёт из ленты ничего точного. Проверяется тестом по всем 30 фикстурам.
- **Побочно исправлено:** дублирующиеся `id` при нескольких redeposit (`redeposit_confirmed_N`);
  нестабильная сортировка (теперь `at desc`, tie-break по `id`); отсутствие дедупликации
  `meaningful_action` ↔ `learning_activity`. Визуальный результат User 360 **не изменился**
  (подтверждено неизменными 173 прежними тестами).
- **Сохранено:** неизвестный пользователь по-прежнему даёт `empty`-страницу, не ошибку; пагинация,
  фильтр по `sources`, детерминизм и `FixedMockClock` не менялись.
- **Не расширено:** матрица прав не менялась; `RESTRICTED` не моделируется как событие — секреты
  (postback secret, сырой playerId) в CRM не попадают вовсе (ROLE_PERMISSION_MATRIX §4.2).
- **Влияние:** MockCrmDataProvider, user-360-projection, user-360.ts (`User360Event.source`),
  DATA_PROVIDER_CONTRACT §4, USER_360.md.

## D-40 · Единая семантика скрытого финансового значения — **Locked**

`FinancialProjection.hiddenReason` (введён в D-38) теперь **используется всеми** рендерерами
проекции. Человекочитаемый текст — единый источник `HIDDEN_LABEL` в
`domain/financial/projection.ts`, реэкспортируемый как `FINANCIAL_HIDDEN_LABEL` в `config/labels.ts`:

| Причина | Текст | Когда |
|---|---|---|
| `no_data` | **«Нет данных»** | значение ещё не поступало из продукта |
| `not_permitted` | **«Недоступно для роли»** | значение существует, но роль его видеть не вправе |

- **Обоснование:** `FinancialCell` в Users показывал «Недоступно для роли» для **любого** hidden —
  т.е. сообщал admin'у (у которого право есть), что ему не хватает прав, хотя значения просто нет.
  Это ложное утверждение о правах. User 360 уже различал случаи (D-38) → десктоп-таблица и карточка
  пользователя противоречили друг другу на одних и тех же данных.
- **Единственный источник:** `label` самой проекции берётся из того же `HIDDEN_LABEL`, поэтому
  read-модель не может противоречить экрану. Тест пиннит `p.label === FINANCIAL_HIDDEN_LABEL[reason]`.
  `FINANCIAL_MODE_SUFFIX` («диапазон» / «агрег.») тоже вынесен в единый источник.
- **Отсутствующая проекция** трактуется как отсутствие данных, а не как отказ в доступе.
- **Bucket / aggregated / exact** не менялись: диапазон, агрегированное представление и точная сумма
  (только разрешённым ролям) остаются как были. Матрица прав и identity-проекция не трогались.
- **Desktop/mobile:** mobile-карточка Users намеренно **не содержит** финансового представления
  (финансовые колонки — опциональные и только для таблицы), поэтому расхождения desktop/mobile нет;
  зафиксировано regression-тестом, чтобы будущая правка не внесла его молча.
- **Влияние:** financial/projection.ts, config/labels.ts, features/users/components/financial-cell.tsx,
  features/user-360/components/user-financial-summary.tsx, USERS_WORKSPACE.md, USER_360.md.

---

# Phase 1B3 — записи реализации (Today Workspace, read-only)

## D-41 · `getUserTimeline` from/to — включительные границы — **Locked**

Контракт объявлял `from`/`to`, реализация их **игнорировала**: любое окно возвращало весь таймлайн.

- **Обе границы включительные.** Контракт называет их нижней и верхней границей без уточнений, а полуоткрытый верх молча терял бы событие, которое вызывающий запросил по точной метке. Операционные окна CRM (начало суток → `clock.now`) строятся из меток, реально попадающих на границу.
- **Сравнение по epoch ms, не по строке.** Вызывающий вправе передать любое корректное написание ISO-8601 (`…T09:00:00Z` и `…T09:00:00.000Z` — один момент, но разный лексикографический порядок).
- **Порядок конвейера:** projection → sources → range → paginate. Окно сужает уже спроецированный список и не может его расширить; иначе `page.total` считал бы события, о существовании которых роль не должна знать.
- **`from > to`** → `invalid_input` через `Result`, без throw в UI. Пустой результат скрыл бы ошибку вызывающего за правдоподобными данными. Проверка идёт **до** поиска пользователя, поэтому ответ одинаков для существующего и несуществующего id (нет side-channel).
- **Пустое окно** → `empty`, как у всех остальных операций провайдера.
- **Влияние:** domain/users/user-timeline.ts (`parseTimelineRange`, `filterTimelineByRange`), MockCrmDataProvider, DATA_PROVIDER_CONTRACT.md. 17 regression-тестов.

## D-42 · `StateEvidence` получает типизированный код и единую русскую карту — **Locked**

`StateEvidence.label` был **свободной английской строкой** («hours since registration»), а `value` мог нести сырой enum (`registration_pending`). Enum'а не существовало вообще.

- **`StateEvidenceCode`** (23 значения) в `domain/shared/primitives.ts`; `label` заменён на `code`.
- **Одна презентационная карта** `STATE_EVIDENCE_LABEL` + `formatEvidence()` в `config/labels.ts` — объявленном единственном источнике пользовательских строк. Не в компонентах Today: evidence читают и другие потребители.
- **Severity остаётся доменной** (severity сигнала / полоса приоритета) и не кодируется строкой — иначе они могли бы разойтись.
- **Значение тоже переводится:** `support_state = blocked` → «Состояние поддержки · Заблокирован», а не сырой член enum (§22).
- **Fallback для неизвестного кода — нейтральный** («Системный признак»), а не `humanizeCode(code)`: гуманизация печатает тот же snake_case обратно по-английски. Consistency-тест делает эту ветку недостижимой для известных кодов, поэтому потеря детали — правильный отказ.
- **`kind` стал нести смысл:** `metric` (измеренное число) против `reference` (флаг/enum-состояние). Потребители, ограниченные в месте, показывают метрики и отбрасывают ссылки: «Открыт support-блокер» + «Состояние поддержки · Заблокирован» — один факт дважды.
- **Влияние:** primitives.ts, signals/engine.ts, config/labels.ts. 11 тестов карты.

## D-43 · Today: ценностный сегмент — не основание для внимания — **Locked**

`new_funded_users` и `repeat_funders` **не дают** места в очереди Today.

- **Обоснование:** оба описывают, **кто** пользователь, а не **что нужно сделать**. Repeat funder без блокера, без срока и без остановки прогресса не требует сегодня ничего; допуск таких в очередь только раздул бы её и заставил спокойных конкурировать с реальной работой (§7).
- Оба уже обслуживаются доменом Segments (`repeat_funders`, `frequent_repeat_funders`) и Users Workspace — это не потеря функциональности, а возврат вопроса туда, где он живёт.
- Коды **не удалены**: `TODAY_SEGMENT_BASES` фиксирует решение, предикаты сохранены и протестированы.
- **Спокойные пользователи вне очереди целиком** (не «в конце списка»): 30 в датасете → 22 в очереди, 7 без сигналов отсутствуют. `hasCalmUsers` позволяет UI сказать «нет работы», а не «ничего не найдено».

## D-44 · `scope: own | team` не реализован — **Locked**

Контракт Phase 1A объявлял `GetTodayInput.scope`. Не реализовано намеренно.

- **Обоснование:** mock-сессия выдаёт всем ролям один `emp_mock_admin`, тогда как владельцы фикстур — `emp_ret1` / `emp_men1` / `emp_ret2`. «Моя очередь» всегда возвращала бы пусто — фильтр, который выглядит настоящим и отвечает неправильно (§12: не создавать фильтр, который provider не может применить корректно).
- **Честный эквивалент:** фильтр `ownerId`, включая «Без ответственного», построенный из реальных владельцев очереди.
- Вернуть `scope` можно, когда у сессии появится настоящий `actorId` из бэкенда.

## D-45 · Операционное окно Today — рабочие сутки, и только для «сегодняшнего события» — **Locked**

`operationalWindow(clock)` = начало суток UTC → `clock.now`. На MOCK_NOW: `2026-07-13T00:00:00Z … 09:00:00Z`.

- **Окно не определяет членство в очереди.** Активный блокер, поднятый неделю назад, — это текущее **состояние**, и оно не устаревает от того, что сегодня ничего не произошло (§21).
- **Состояние и событие разделены:** `lastActivityAt` (абсолютное, сколь угодно давнее) против `todayEvent` (внутри окна, либо `null`).
- Окно читается через исправленный `from`/`to` (D-41) и канонический permission-aware projector — то есть HIGH-события не протекают в Today.

## D-46 · Правило балансо-производной редакции вынесено в общий модуль — **Locked**

`FINANCIALLY_DERIVED_SIGNALS` жил приватно в `user-360-projection.ts`. Вынесен в `domain/financial/financially-derived.ts` и используется обоими экранами.

- **Обоснование:** две поверхности с личными копиями списка — это то, как редакция молча расходится: сигнал, добавленный в один список и не добавленный в другой, был бы скрыт в профиле и раскрыт в очереди.
- Поведение User 360 не изменилось.

## D-47 · Today: свежесть доски ≠ возраст самых старых данных пользователя — **Locked**

`TodayFreshness` описывает **момент генерации доски**, а не возраст самого старого баланса среди её участников.

- **Обоснование:** первая реализация брала минимальный `balanceTimestamp` и объявляла всю доску устаревшей на 14 дней из-за одного пользователя, пока каждый SLA на экране был актуален. Это ложное описание экрана.
- Возраст данных конкретного пользователя остаётся при нём: `financial.stale` и основание `data_quality_issues`.
- `ageMinutes` считает **provider против своего Clock** — React не зовёт `Date.now()` (§20).
- `staleMode` — dev-превью на 75 минут (выше порога `balance_data_stale.staleMinutes = 60`): mock выводит очередь из часов при каждом вызове и сам устареть не может.

## D-48 · Today не печатает `priorityReasonCode` — **Locked**

Поле есть в read-модели (паритет с `UserSummary.priorityReasonCode`), но строка очереди его **не рендерит**.

- **Обоснование:** лестница приоритета и основания читают один и тот же каталог сигналов, поэтому reason всегда оказывается более грубым пересказом причины, которую строка уже печатает: «Критический support-блокер» прямо над «Открыт support-блокер.». Измерение подтвердило структурность: после дедупликации поле было бы непустым у **0 из 22** строк — то есть ветка рендера мертва.
- Разделение обязанностей: бейдж отвечает «насколько срочно», причина — «почему», а сама лестница остаётся на виду в User 360 («Основание приоритета»).
- **Производные основания** (`critical_attention`, `sla_breached`, `due_today`) по той же причине не выводятся чипами «ещё основания» — их уже говорят бейдж приоритета и чип срока. Как **значения фильтра** они полноценны: «покажи всех с нарушенным SLA» — реальный вопрос.

## D-49 · Today: баланс — `null`, а не «скрытая» проекция, когда он не нужен строке — **Locked**

`TodayQueueItem.financial` = `FinancialProjection | null`.

- **Обоснование:** `FinancialHiddenReason` отвечает «нет данных» или «нет прав». Для админа, которому баланс на строке про отчёт просто не нужен, **ни то, ни другое не является правдой** — «Недоступно для роли» было бы ложным утверждением о правах (та же ошибка, что чинил D-40).
- **Релевантность — решение Today** (`TODAY_BASES_WITH_FINANCIALS`: checkpoint, качество данных), **право — решение проекции**. Оси не смешиваются.
- D-24 сохранено и усилено: onboarding по-прежнему без финансов, теперь по более строгому правилу (тест на непересечение с `QUEUES_WITHOUT_FINANCIALS`).

## D-50 · Контракт Today переписан; placeholder-форма Phase 1A удалена — **Locked**

`TodayGroupKey` (`today_tasks`, `no_progress`, `new_ftd`, …) никогда не соответствовал тому, что производил builder — провайдер приводил `key: q.code as never`, то есть контракт документировал форму, которую никто не возвращал.

- Today-модель теперь живёт в домене (`domain/today/today.ts`) и ре-экспортируется контрактом — ровно как `User360`.
- `getTodayWorkspace(ctx, query)` возвращает уже спроецированный агрегат: React не вычисляет права, не пересчитывает приоритет и не решает, кто попадает в очередь.
- Приведений типов не осталось; regression-тест проверяет, что ключи секций реальны.

## D-51 · Dev-only переключатель состояния данных — **Noted**

`config/demo-state.ts` + `getCrmDataProvider(state)` — localStorage-ключ `ata-crm.mock-state.v1` (`stale` / `empty` / `error`).

- **Зачем:** mock выводит очередь из фиксированных часов и не может устареть или опустеть сам, а это реальные продуктовые состояния, которые обязаны просматриваться в настоящем браузере (§29 требует их скриншотов).
- Тот же механизм, что у dev role switch; за пределами development игнорируется; **не влияет на права** — меняет только, из какого синтетического источника читаем.

## D-52 · Один канонический источник подписи рекомендации — **Locked**

Канон — **`RECOMMENDATION_CATALOG[code].title`** (`domain/recommendations/catalog.ts`). Подпись живёт рядом с кодом рекомендации; `config/labels.ts` → `RECOMMENDATION_LABEL` **выводится** из каталога и не содержит собственных литералов. Все экраны (Users, Today, User 360) читают подпись через этот единый mapping.

- **Причина.** Существовали два независимо поддерживаемых набора из 18 русских строк. Они разошлись на **трёх** кодах (документация Phase 1B3 фиксировала только один — расхождение было шире, чем считалось):

  | Код | Канон (catalog) | Устаревший вариант (labels) |
  |---|---|---|
  | `remind_email_confirmation` | Напомнить о подтверждении email | Напомнить подтвердить email |
  | `review_risk_material` | Предложить материал по управлению риском | Материал по управлению риском |
  | `celebrate_learning_return` | Отметить возвращение к обучению | Отметить возвращение |

  Users и Today печатали короткие варианты, User 360 — полные: одно действие читалось по-разному на двух экранах.
- **Победил каталог** (более полные формулировки). Строки при этом **не редактировались**: удалён второй набор, и канон применился сам. Остальные 15 подписей не менялись.
- **Почему выведение, а не тест на равенство.** Два набора + consistency-тест оставляют расхождение *представимым* и ловят его постфактум. Выведение делает его **непредставимым**: добавленный код физически не может получить вторую формулировку. Тесты пиняют контракт (и три конкретные строки), а не текущую реализацию.
- **User 360 больше не печатает `title` из read-модели**, а резолвит подпись из кода через тот же mapping — как Today (D-50) и Users. Read-модель и провайдерский контракт (`User360Recommendation.title`, `RecommendedAction.title`) **не менялись**: поле остаётся, но теперь тождественно канону по построению.
- **Аудит.** Будущие audit-записи Phase 1B4, называющие действие, обязаны брать подпись из этого же источника — иначе журнал и экран разойдутся в формулировке одного и того же кода.
- **Влияние:** catalog.ts (канон + комментарий), config/labels.ts (выведение), user-recommendations.tsx (через mapping), today.ts (комментарий об источнике). Права, провайдер-семантика и layout не затронуты. Phase 1B4 не начат.

## D-53 · Edit → notes: разрешены admin / manager / retention / support — **Locked**

`Permission` += `edit_user_notes`; `access.ts` → `canEditUserNotes(role)`. Право централизовано в общем permission-слое; провайдер и React его не выводят.

- **Как прочитана матрица.** §0 определяет Edit как «изменение сущностей CRM (tasks/cases/**notes**/lifecycle override)», значит заметки — часть измерения Edit. Дальше §1 читается буквально:

  | Роль | Edit (§1) | notes | addNote |
  |---|---|---|---|
  | crm_admin | Full | Full покрывает все сущности | ✅ |
  | crm_manager | Full (team) | то же | ✅ |
  | retention_manager | Full (own+team retention) | то же | ✅ |
  | support | Limited (support cases/tasks/**notes**) | названы явно | ✅ |
  | mentor | Limited (mentor tasks/cases, reports) | не названы | ❌ |
  | moderator | Limited (moderation cases) | не названы | ❌ |
  | content_manager | Limited (content-related) | не названы | ❌ |
  | analyst | None | — | ❌ |
  | read_only | None | — | ❌ |

- **Решающий довод.** Среди Edit=Limited ролей `support` — **единственная**, в чьей скобке перечислены `notes`. Если бы скобки были иллюстративными, это слово было бы избыточным. Значит перечисление **исчерпывающее**: заметки даются там, где Edit=Full, либо где `notes` названы явно. Это прочтение матрицы, а не новая матрица.
- **Перекрёстная проверка.** §5 («матрица чувствительных действий») строки для заметок вообще не содержит — она не расширяет ничьи права на notes. §3 подтверждает: mentor — «создавать mentor-задачи/кейсы» (без заметок); content_manager — «не видит персональные операционные данные пользователей сверх нужного», а заметка о пользователе — именно они.
- **Чем право НЕ является.** Не выводится из видимости финансов (support пишет заметки, но точных сумм не видит) и не переиспользует `assign_owner` (support заметки пишет, owner не назначает) — это разные измерения §1. Существующие права просмотра identity/financials **не расширены**: у support добавился ровно один член массива.
- **Fail-closed при сомнении.** Для mentor/moderator/content_manager документация не даёт положительного разрешения — значит его нет. Роли «на всякий случай» не расширялись.

## D-54 · Новая заметка создаётся только с `visibility: "team"` — **Locked**

`AddNoteCommand` = `{ userId, body, idempotencyKey }`. Поля `visibility` в команде **нет**.

- **Причина.** Для `private` и `role_restricted` нет полного metadata-контракта: неизвестно, кто владелец приватной записи и каким ролям адресована ограниченная. Дать записать режим, который потом нечем корректно прочитать, — создать данные, которые система не умеет обслуживать.
- Значения enum **не удалены**: существующие/засеянные заметки этих режимов продолжают существовать и читаются по D-55.
- Actor (`actorId`, `role`) в команду тоже не входит — только из доверенного `CrmContext`, иначе вызывающий назначал бы себя кем угодно.
- Запись `private`/`role_restricted` вернётся вместе с их metadata-контрактом, не раньше.

## D-55 · `private` — только автор; `role_restricted` — скрыта всегда — **Locked**

Единый canonical projector `domain/notes/note-projection.ts`; `getUserNotes` — его единственный потребитель.

- **`team`** — виден всем 9 ролям: право чтения заметок в контракте — «View User 360» (§7), а User 360 по §2 матрицы доступен всем ролям. Отказа на уровне роли нет; видимость решается **на каждой заметке**.
- **`private` → только автор.** Контракт §7 противоречит сам себе: комментарий к `includePrivate` говорит «только автору/**manager+**», а строка Filters — «`private` — **только автор**». Побеждает **узкое** прочтение: автор проходит по обоим вариантам, manager — только по одному. Расширять права на основании противоречия нельзя.
- **`role_restricted` → скрыта всегда**, включая автора. §7 говорит «по роли», но в модели `CrmNote` **нет поля с разрешёнными ролями** — вопрос «каким именно ролям?» не на чем вычислить. Вопрос без ответа отклоняется, а не угадывается.
- **Скрытая ≠ помеченная.** Запрещённая заметка удаляется из выдачи, а не заменяется плейсхолдером: строка «скрыто» раскрыла бы сам факт существования записи. Проекция идёт **до пагинации**, поэтому скрытые не входят и в `page.total`.
- **Второго пути чтения нет.** User 360 заметки не читает вообще, поэтому расхождению правил (как у timeline в D-39 и у скрытых финансов в D-40) неоткуда взяться. Любой будущий читатель обязан переиспользовать projector. *Уточнено D-58: с Phase 1B4-B у `getUserNotes` появился читатель — секция «Заметки» на User 360. Она читает **через него**, а не вторым путём, и видимость заново не выводит, поэтому вывод этой записи в силе.*
- **Доказано регрессией:** подмена projector на «всё видно» роняет 15 тестов, включая явный «getUserNotes реально зависит от контекста».

## D-56 · Отказ по правам — `unauthorized`, а не новый код `forbidden` — **Locked**

- **Причина.** В `CrmErrorCode` кода `forbidden` **не существует**; для отказа по правам во всём проекте и во всей документации (§7, §14 контракта, D-37) используется `unauthorized`. Завести рядом второй код с тем же смыслом — создать ровно ту рассинхронизацию «одно понятие, две формы», которую уже пришлось закрывать в D-40 (скрытые финансы) и D-52 (подписи рекомендаций).
- Параллельная error system не создавалась: используются существующие `Result<T>` / `CrmError` и коды `invalid_input`, `not_found`, `unauthorized`, `conflict`, `internal`.
- Если `forbidden` когда-нибудь понадобится как отдельная семантика («аутентифицирован, но не разрешено» против «не аутентифицирован»), это отдельное решение с миграцией всех операций разом, а не частный случай одной мутации.

## D-57 · Детерминированные id, timestamp и fingerprint без crypto-зависимости — **Locked**

Ни `Math.random()`, ни случайных UUID, ни настоящего `Date.now()` в доменной логике mock-провайдера.

- **id из sequence:** `note_mock_0001` / `audit_mock_0001`. `sequence` персистится в overlay и продолжается после пересоздания адаптера.
- **timestamp:** `clock.nowMs() + sequence` мс. `FixedMockClock` возвращает один и тот же инстант — без смещения две заметки получили бы одинаковый `createdAt`, и порядок стал бы неустойчивым. Сортировка дополнительно имеет tie-breaker по `id`.
- **`idempotencyKey` не используется как entity id:** он приходит снаружи, не обязан быть уникальным в пространстве id и не обязан быть безопасным для показа.
- **Fingerprint** — два прохода FNV-1a по `[userId, actorId, role, body]`, каждая часть с префиксом длины (иначе `("ab","c")` и `("a","bc")` сериализуются одинаково и две разные команды выглядели бы взаимным replay). **Crypto-зависимость не добавлена**: это защита от случайного переиспользования ключа, а не от подбора коллизии, и требование детерминизма mock'а важнее криптостойкости. Зависимости проекта не менялись.
- **Receipt хранит fingerprint, а не команду:** тело уже лежит на самой заметке, повторять его открытым текстом второй раз — вторая копия пользовательского текста без читателя.

## D-58 · Заметки на User 360 — отдельный permission-aware read, не часть `getUser360` — **Locked**

Экран делает **два** независимых чтения: `getUser360` (агрегат) и `getUserNotes` (заметки).

- **Почему не в агрегате.** Правило видимости заметки — **на каждой заметке**, а не на роли (D-55), и живёт в единственном месте — `domain/notes/note-projection.ts`, чей единственный потребитель — `getUserNotes`. Вложить заметки в `User360` означало бы либо продублировать projector, либо отдать агрегату заметки, которые он обязан перефильтровать. Это ровно то расхождение, которое пришлось разбирать в D-39 (timeline) и D-40 (скрытые финансы).
- **Чем это не является.** D-35 запрещал не «второй вызов», а **композицию прав в React**: экран собирался из четырёх частичных чтений и сам решал, что показать. Здесь прав в UI нет — `getUserNotes` отдаёт уже спроецированный список, React его печатает.
- **Изоляция отказов.** Loading заметок не задерживает профиль; ошибка заметок не подменяет весь экран `ErrorState`; retry действует только на секцию. Профиль обязан открываться, даже когда заметки недоступны.
- **Первая страница без пагинации.** `pageSize` = 50 (контракт §7). Контрол «ещё» не делается: у фикстурной персоны одна засеянная заметка плюс написанные в этой вкладке — кнопка никогда не имела бы что подгружать. Ограничение зафиксировано в `docs/USER_360.md`.

## D-59 · Inline-композер; запрещённым ролям — отсутствие формы, а не disabled-контрол — **Locked**

- **Inline, не dialog и не sheet.** Секция существует ради списка; модалка спрятала бы список, к которому присоединяется новая заметка. Новая заметка сортируется **наверх** (`createdAt desc`), поэтому композер над списком держит результат рядом с местом ввода. `Dialog` в этом коде занят заглушками topbar, `Sheet` — транзиентными фильтрами; ни один из них не является поверхностью авторинга.
- **Право — только `canEditUserNotes(role)`** (D-53). Список ролей в React не дублируется: второй список — это список, который разойдётся с матрицей.
- **Запрещённой роли форма не рендерится вообще**, вместо неё — спокойная строка «Ваша роль не может добавлять заметки». Не disabled-кнопка: мёртвый контрол рекламирует возможность, которой у роли не будет никогда, не получает фокус и потому не может объясниться screen reader'у. Матрица прав не расширялась.
- **Список остаётся виден всем 9 ролям:** чтение заметок — это «View User 360» (§2 матрицы), другое право; видимость решает projector на каждой заметке.
- **Смена роли при открытом композере** пересчитывает право на том же рендере; провайдер остаётся последней защитой (`unauthorized`).

## D-60 · Никакого optimistic update — после успеха выполняется provider refetch — **Locked**

Порядок: submit → provider result → refetch `getUserNotes` → перерисовка.

- **Почему.** Видимостью владеет projector, порядком (`pinned` → `createdAt desc` → `id`) — провайдер. Вставить возвращённую заметку в локальный массив означало бы, что React знает, **кому** она видна и **куда** встаёт, т.е. держит второе мнение о правилах — класс ошибок D-39/D-40.
- **Цена нулевая:** мутация локальная, латентность синтетическая, сети нет. `useOptimistic` не используется.
- Покрыто тестом «провайдер продолжает отвечать „заметок нет“ → экран говорит „заметок нет“»: оптимистичная вставка показала бы заметку, о которой провайдер не сообщает.

## D-61 · Idempotency-ключ в UI: `useId` + счётчик попытки — **Locked**

`key = ` `` `${useId()}:${userId}:${attempt}` ``

- Без `Math.random()`, без `Date.now()`, без `crypto.randomUUID()`, без новой зависимости.
- **Жизненный цикл:** правка черновика ключ **не** создаёт (ключ не зависит от тела); retry после `internal` повторяет ключ — ничего не записано, и именно повтор делает retry безопасным; двойной submit повторяет ключ, и провайдер отвечает replay вместо второй записи; **успех** и **conflict** продвигают счётчик (в первом случае команда завершена, во втором ключ уже принят под другую команду и конфликтовал бы вечно).
- **Не воспроизводим между монтированиями** — `useId` берёт префикс из счётчика на реалм. Это правильно: свежий композер не должен наследовать израсходованный ключ. Ничего от этого не зависит: ключ не является entity id и никогда не рендерится (MUTATION_OVERLAY §4).
- Двойной submit безопасен и на уровне провайдера: `addNote` выполняет `produce()` синхронно после `gate`, поэтому второй вызов видит receipt первого. UI-guard (`disabled` + ref) — про UX, а не про целостность.

## D-62 · Локальный исчерпывающий маппер ошибок; `CrmError.message` в UI не попадает — **Locked**

- **Почему не переиспользован `ErrorState`.** Его ветка `internal` печатает `error.message` **сырым** (`src/components/states/error-state.tsx`), а `addNote` возвращает там английскую диагностику `"Mock overlay could not be persisted."`. Для полностраничного отказа это приемлемо, для мутации — утечка внутренностей на экран.
- **Форма — тотальная `Record<CrmErrorCode, string>`**, а не `switch` с `default`: новый член объединения тогда **не компилируется**, вместо того чтобы молча отрендерить fallback. Покрыты все 8 существующих кодов проекта, включая те, что `addNote` не документирует (`upstream_unavailable` приходит от dev-демо-состояния `error`).
- `CrmError.message` трактуется как диагностика для разработчика — тот же инвариант, что уже действует для `TIMELINE_RANGE_MESSAGE` и `NOTE_BODY_MESSAGE`. Regression-тест: для каждого кода строка `message` отсутствует в отрендеренном HTML.
- В ошибке не появляются: тело заметки, email, телефон, финансовые значения, idempotency-ключ, employee id, storage key, JSON overlay, stack trace.
- Клиентская валидация — через ту же доменную функцию `normalizeNoteBody`, лимит — из `NOTE_BODY_MAX_LENGTH`. Литерала `2000` в UI нет: две копии лимита — два контракта.

## D-63 · Засеянная заметка: убран raw enum-код и «только что» — **Locked**

Два дефекта фикстуры, которые существовали с Phase 1B4-A и стали видимы ровно тогда, когда у заметок появился читатель (прецедент — D-29: UI находит настоящие ошибки данных).

- **Raw-код.** Тело собиралось как `` `Синтетическая заметка: ${u.state.reasonCode}.` `` и печатало на экран `support_blocked` — то, что `config/labels` существует, чтобы не допускать. В отличие от остальных кодов экрана, у `state.reasonCode` **нет карты подписей** (её имеет только `priority.reasonCode` — `PRIORITY_REASON_LABEL`), а data-слой и не может резолвить лейблы: русский текст живёт в `config`, который зависит от `domain`, а не наоборот. Поэтому засеяна человеческая фраза. Существующий тест «shows no raw enum codes anywhere» ловил это.
- **Дата.** `createdAt` был равен `clock.nowIso()`, поэтому засеянная заметка на каждой загрузке читалась как «только что» и была неотличима от заметки, которую сотрудник действительно только что написал. Теперь она датирована на два дня назад — по-прежнему детерминированно (от `FixedMockClock`), и порядок стал видимым: авторские заметки штампуются `nowMs + sequence` и встают выше.
- Тела фикстурных заметок ни один тест не проверял (только `id`), схема overlay не менялась.

---

## Phase 1B4-C — записи реализации (Primary Owner Assignment)

## D-64 · Overlay расширен аддитивно в пределах v1 — **Locked**

Ключ `ata-crm.mutation-overlay.v1` и `version: 1` **не меняются**. Owner-мутация не добавила ни одного нового поля верхнего уровня в `MutationOverlay`: история владельца — это записи `primary_owner_changed` в уже существующем `auditRecords` (D-65), поэтому старому overlay Phase 1B4-B **нечего терять**.

- **Fail-closed сохранён и остался fail-closed.** `parseOverlay` по-прежнему отвергает overlay целиком при любой сломанной записи, неизвестной `version`, неизвестном `action`/`entityType`/`reasonCode` и неизвестном `receipt.kind`. Расширение — это **одно новое допустимое значение** в каждом из этих измерений, а не дыра. Обоснование прямо из MUTATION_OVERLAY §2: fail-closed вводился против **повреждённых** данных, а не против **более старых, но целых**; отсутствие поля, которого в v1 никогда не было, — не повреждение.
- **Не v2, не миграция, не новый key** (явное решение задачи). Толерантное чтение сохраняет заметки без кода миграции; §2 говорит «`version !== 1` → пустой overlay», и переход на v2 без миграции сам по себе стёр бы заметки.
- Regression-тест обязателен и добавлен (`overlay-backcompat.test.ts`): raw overlay Phase 1B4-B собирается вручную, читается новым парсером (заметки/audit/receipts/sequence целы), выполняется owner-мутация, overlay перечитывается — старые заметки и новый owner-change сосуществуют.

## D-65 · История владельца выводится из append-only audit, отдельного `ownerAssignments[]` нет — **Locked**

Текущий primary owner = baseline fixture owner, перекрытый **последней** записью `primary_owner_changed` для пользователя. «Последняя» — по порядку в массиве (записи только добавляются, store пишет в порядке `sequence`).

- **Почему не отдельная структура.** Append-only лог уже отвечает и на «кто владелец сейчас» (последняя запись), и на «как мы к этому пришли» (D-08 требует хранить историю). Вторая структура с теми же фактами — вторая структура, которая может разойтись с первой (прецедент D-39/D-40).
- **Влияние:** `AuditRecord` стал discriminated union по `action`; `previousOwnerId`/`nextOwnerId` живут на owner-записи (D-66).

## D-66 · `AuditRecord` — discriminated union; owner-запись несёт previous/next — **Locked**

`AuditRecord = NoteAddedAuditRecord | PrimaryOwnerChangedAuditRecord`, дискриминант — `action`.

- **Почему union, а не общая плоская запись с `previousOwnerId?`/`nextOwnerId?`.** Плоская запись позволила бы note-записи нести owner-поля, а owner-записи — их опустить, и ничто бы это не поймало. В union note-запись **не может** иметь owner-полей, а owner-запись **невозможно собрать** без них.
- Owner employee id — LOW/CRM-owned (CRM_DOMAIN_MODEL §14) и здесь это **сам факт** изменения, а не содержимое: owner-change, не говорящий что изменилось, не фиксирует ничего. `null` с любой стороны — реальное значение (снят), а не отсутствие.
- В audit по-прежнему нет: email, телефона, имени пользователя, финансов, свободного текста, idempotency-ключа, UI-лейбла, тела заметки, диагностики storage. `reasonCode` — закрытый enum (`primary_owner_changed_by_employee`). Audit UI и read endpoint не создаются.

## D-67 · Canonical employee directory; `OWNER_LABEL`/owner-фильтр выводятся из него — **Locked**

Один типизированный `EMPLOYEE_DIRECTORY` (`src/domain/identity/employees.ts`): `employeeId`, `displayName`, `primaryOwnerCandidate`. Убирает дрейф между `OWNER_LABEL` (было 9 id), `OWNER_IDS` Users-фильтра (было 6) и фактическими владельцами фикстур (5).

- **Не HR-модель:** нет email, телефона, команды, нагрузки, role scope, fake active/inactive — ничего из этого нет в фикстурах, а выдумать значило бы показать поле, которое выглядит авторитетным и отвечает неверно (тот же довод, что в D-44).
- `primaryOwnerCandidate: true` — только для владельцев, **реально присутствующих** в baseline (`emp_ret1`, `emp_ret2`, `emp_men1`, `emp_mgr`, `emp_sup1`). Consistency-тест: множество кандидатов === множество distinct non-null `primaryOwnerId` фикстур. Кандидат, которым никто не владеет, — опция, которую нельзя показать; владелец-фикстура без кандидата — владелец, которого picker не смог бы восстановить.
- `OWNER_LABEL` и опции owner-фильтра Users теперь **выводятся** отсюда. Directory включает и не-кандидатов (`emp_admin`, `emp_mod1`, `emp_an1`, `emp_mock_admin`), чтобы `ownerLabel()` не потерял подписи.
- **Raw id больше не fallback-подпись.** Прежний fallback `humanizeCode` печатал `emp_xyz` как «Emp xyz» — id с заглавной буквы. Неизвестный id теперь → нейтральное «Неизвестный сотрудник», код не выводится.

## D-68 · `getPrimaryOwnerCandidates` — узкий permission-aware read, не часть `getUser360` — **Locked**

Кандидаты назначения — отдельная read-операция контракта, возвращает `{ employeeId, displayName }[]`.

- **Отдельно от `getUser360`** (D-35 остаётся в силе): список не про конкретного пользователя — он один для всех, и складывать его в агрегат значило бы перечитывать весь профиль ради выпадающего списка. **Текущий** owner остаётся частью `getUser360`.
- **Permission-aware:** доступно только при `canAssignOwner(ctx.role)`; остальным — `unauthorized`, а не пустой список (пустой список утверждает «некого назначить» — другое и неверное утверждение). UI запрещённых ролей операцию не вызывает вовсе.
- Возвращает только id и подпись: role, email, команда, нагрузка, пользователи сотрудника, финансы — **не** возвращаются. React список не собирает и не копирует.

## D-69 · `assignPrimaryOwner`; scope не моделируется, boolean `canAssignOwner` — **Locked**

`CrmMutations` += ровно один метод. Заглушек прочих мутаций нет (тот же принцип, что в D-50). Команда: `{ userId, ownerId: EmployeeId|null, expectedOwnerId: EmployeeId|null, idempotencyKey }`; actor — только из `CrmContext`.

- **Права не расширены.** Назначают `crm_admin`/`crm_manager`/`retention_manager` — это уже существовавший с Phase 1A `assign_owner`, у которого до сих пор не было потребителя. Матрица не менялась. `support` пишет заметки и owner **не** назначает — Edit и Assign — разные измерения (D-53).
- **Scope `own/team/all` не реализован** (решение задачи; тот же довод, что D-44): mock-сессия даёт всем один `emp_mock_admin`, employee→team-модели нет, поэтому team-проверка могла бы отвечать только угадыванием. Вернуть — когда у сессии появится настоящий actor/team из бэкенда.
- **`ownerId: null`** (снятие) — first-class: «без ответственного» уже реальное состояние везде (фикстуры, фильтры Users/Today, `summary.unassigned`).
- Порядок проверок совместим с `addNote`: `invalid_input` → `not_found` → `unauthorized` → (idempotency) → `conflict` → write. `not_found` раньше `unauthorized` — сохранённая mock-семантика (то же известное свойство, что у `addNote`).

## D-70 · Один canonical effective-owner resolver; fixtures неизменяемы — **Locked**

Единственная точка в провайдере (`effectiveUsers`/`effectiveUser`) накладывает overlay-owner поверх baseline. Fixture **никогда** не мутируется: `defaultDataset` мемоизирует один массив на `FixedMockClock` и раздаёт те же `MockUser` всем инстансам провайдера — in-place присваивание протекло бы между demo-состояниями и сломало бы инвариант «датасет побайтово равен себе после мутации». Клон мелкий (30 персон, стоимость незначима).

- Все reads берут owner отсюда: `getUser360`, `searchUsers`, `getUserById`, task/case synthetic owner, mentor/support queue, и через `buildTodayWorkspace(effectiveUsers())` — Today row/фильтр/`summary.unassigned`/`filterOptions.owners`. Не дублируется в каждом методе.
- **Derived cache** держал ссылку на user и мог отдать старого owner. Запись сравнивает закэшированный `primaryOwnerId` с запрошенным и пересчитывает при расхождении; мутация дополнительно инвалидирует запись target-пользователя. Работает и когда overlay записан **другим** инстансом провайдера над тем же storage (storage читается заново). Signals/priority от owner не зависят и не пересчитываются содержательно.

## D-71 · Автор засеянной заметки заморожен по baseline fixture — **Locked**

`fixtureNotes` берёт `authorEmployeeId` из **baseline** владельца (поиск по нетронутому датасету), а не из `u`, который теперь несёт effective owner.

- Авторство — исторический факт: сотрудник, написавший заметку два дня назад, её и написал; переназначение сегодня не должно переписывать автора задним числом. Чтение с `u` делало бы ровно это, как только `u` начал носить effective owner. Тест: прочитать заметку → сменить owner → прочитать снова → `authorEmployeeId` тот же. Raw author id в User 360 по-прежнему не выводится.

## D-72 · `expectedOwnerId` — оптимистичная конкуренция без поля версии — **Locked**

Перед записью provider сравнивает `command.expectedOwnerId` с текущим effective owner; при расхождении — `conflict`, ничего не пишется, прежний overlay побайтово цел.

- **Почему не синтетический revision.** Owner **и есть** состояние; сравнить его напрямую дешевле и честнее, чем заводить версию ради одного скаляра. Заметкам это не требовалось — добавление заметки не может её потерять; замена owner — может (вторая вкладка молча затёрла бы первую).
- **Порядок critical:** replay уже совершённой команды проверяется **до** `expectedOwnerId`. После успеха текущий owner = назначенному, поэтому исходный `expectedOwnerId` устарел; проверь предусловие первым — и каждый безопасный retry успешной записи вернул бы `conflict`. `expectedOwnerId` по этой же причине **не входит** в fingerprint (D-73).
- **Live cross-tab sync не реализован** (решение задачи): storage-listener не добавлен; открытая старая вкладка может остаться stale до следующего read/remount/navigation. Users/Today получают новое значение при следующем provider read.

## D-73 · Idempotency owner-мутации: fingerprint + discriminated receipt — **Locked**

Fingerprint через существующий `stableFingerprint` (length-prefix): `[userId, actorId, role, ownerId ?? UNASSIGNED_OWNER_TOKEN]`. `expectedOwnerId` в него **не входит** (D-72). Crypto нет (D-57).

- Тот же key + та же command identity → `replayed: true`, второй audit не создаётся, возвращается исходный результат. Другой user/owner/actor → `conflict`. Snятие отличается от назначения. Storage failure **не сжигает** key (ничего не записано — повтор безопасен).
- **Receipt — discriminated union:** legacy note-receipt (без `kind`, отсутствие дискриминанта = note) и owner-receipt (`kind: "primary_owner_change"`, `auditId`, без `noteId`). Общий тип **не** привязан к `noteId` — именно эта привязка делала его note-only. Ключ, потраченный на note, потрачен и для owner-команды даёт `conflict`, и наоборот.

## D-74 · UI назначения — inline в «Ответственный и работа», нативный select, явный Save — **Locked**

Контрол живёт в существующей секции `UserOwnerContext`, не в диалоге/шите/тулбаре/Users/Today.

- **Нативный `<select>`**, не combobox/typeahead: кандидатов пять плюс «Без ответственного» — typeahead ничего не решает, но добавляет a11y-поверхность. Нативный бесплатно даёт клавиатуру, фокус и мобильный picker.
- **Явный «Сохранить», не auto-submit:** в отличие от добавления заметки это **замена** значения; промах по списку из пяти молча затёр бы текущего владельца без отмены. Лишний клик — и есть отмена. Save disabled при unchanged (мутация, ничего не меняющая, — ложная запись в audit).
- **Три роли** получают форму, **шесть** — спокойную строку «Ваша роль не может менять ответственного», без hidden/disabled-контрола (D-59); текущий owner виден всем девяти. Решает единственный `canAssignOwner(role)`; списка ролей в React нет.
- **Никакого optimistic update** (D-60): success → refetch **всего** `getUser360` (owner в агрегате, D-35) → owner из canonical read-model; `retry` проброшен из `useUser360Query` в секцию. Состояния: unchanged / pending (`aria-busy`, ref-guard, один вызов) / success (`role=status`, без raw id и метаданных, фокус возвращается на select) / conflict (перечитать, показать актуального, сбросить выбор, новый attempt) / forbidden (формы нет) / not_found / internal (retry тем же ключом) / upstream_unavailable. `CrmError.message` в UI не рендерится — тотальная `Record<CrmErrorCode, string>` (`owner-error.ts`, тот же инвариант D-62).
- **Смена роли:** кандидаты перечитываются, право переоценивается, форма у запрещённой роли исчезает, несохранённый выбор сбрасывается, success/error очищаются, attempt сбрасывается. Заодно исправлен соседний дефект `useAddNote`: attempt заметки тоже сбрасывается при смене session identity (иначе key, выписанный под прежней ролью, при fingerprint по роли дал бы ложный `conflict`).

---

## D-75 · Закрепление заметки — часть `edit_user_notes`, не новое право — **Locked**

Pin/unpin — это редактирование заметки, а не новая возможность. Право переиспользуется существующее — `canEditUserNotes(role)` / `edit_user_notes` (D-53): те же четыре роли (`crm_admin`, `crm_manager`, `retention_manager`, `support`) закрепляют, что и добавляют. Матрица ролей **не расширяется**, нового permission и нового `CrmErrorCode` не появляется; отказ по правам — `unauthorized` (D-56), а не `forbidden`. Запрещённым пяти ролям контрол не рендерится вовсе (D-59) — ни активный, ни disabled, ни скрытый мутатор; заметки, разрешённые projector'ом, они по-прежнему видят.

## D-76 · Закреплять можно любую видимую заметку; скрытая → `not_found` — **Locked**

Закрепить/открепить можно любую заметку, которую текущая роль видит через canonical note projector: overlay/authored, засеянную fixture-заметку и `private`-заметку, видимую её автору. Поиск заметки в мутации идёт через тот же `resolveEffectivePins` → `projectNotes`, что и чтение, поэтому невидимая заметка (`private` не автора, `role_restricted`) и несуществующая дают **один и тот же** `not_found` — mutation API нельзя превратить в зонд существования скрытых заметок. Порядок проверок: `invalid_input → not_found (user, note, видимость) → unauthorized → idempotency → expectedPinned → write`; `not_found` раньше `unauthorized` — сохранённая mock-семантика (та же, что у `addNote`/`assignPrimaryOwner`), импакт нулевой (User 360 открыт всем).

## D-77 · Effective pin выводится из audit-лога; fixtures и overlay-заметки не мутируются — **Locked**

Заметка «рождается» с `pinned:false`; закрепление — запись `note_pin_changed` в существующем `auditRecords`, а НЕ перезапись заметки. Отдельного `notePins[]`/`noteOverrides[]` и нового top-level поля overlay нет (как и `ownerAssignments[]`, D-65): append-only лог — это и есть состояние, второй структуре не с чем разойтись. Effective pinned вычисляет **единый** резолвер `resolveEffectivePins` (`domain/notes/note-projection`): базовый `note.pinned` ⊕ последняя запись `note_pin_changed` для `note.id`, «последняя» — детерминированно по `at`, затем по audit `id`, никогда по позиции в массиве. Применяется ДО `sortNotes` (иначе pinned-first сортировал бы по устаревшему базовому значению). Ни fixture, ни overlay-заметка не мутируются — изменённая заметка это мелкий клон. Overlay расширен аддитивно в пределах **v1** (тот же ключ, `version:1`, D-64): новый член union `AuditRecord` (`note_pin_changed` с `previousPinned`/`nextPinned` — только факт и направление, без body/PII/финансов/ключа/лейбла), новый receipt-kind `note_pin_change` (fingerprint по `userId`/`noteId`/`actorId`/`role`/желаемому состоянию, без `expectedPinned`; отдельный дискриминант, без старого `noteId`-поля), guard'ы приняли по одному новому допустимому значению — всё прочее по-прежнему fail-closed (весь overlay → пустой). Regression: raw 1B4-B и 1B4-C overlay читаются без потерь, после pin старые заметки, owner-история и pin-запись сосуществуют.

## D-78 · Команда задаёт конечное состояние + `expectedPinned` — **Locked**

`setNotePinned` принимает `pinned` (желаемое конечное состояние, не blind toggle — toggle, посланный дважды, гонит сам себя) и `expectedPinned` (оптимистичная конкуренция без поля версии, как `expectedOwnerId`: boolean и есть состояние). Отказы: `pinned === expectedPinned` → `invalid_input` (команда не описывает изменение — она неправильная, а не гонка); `expectedPinned` не совпал с текущим effective-состоянием → `conflict`, ничего не пишется. Idempotency: тот же key + та же command identity → `replayed:true` без второго audit; другой user/note/actor/role/желаемое состояние → `conflict`; receipt `addNote` и receipt owner нельзя переиспользовать под pin; storage failure не сжигает ключ (retry тем же key). Без Math.random/Date.now/UUID/crypto (D-57).

## D-79 · Никакого optimistic update — provider refetch — **Locked**

После мутации выполняется canonical `getUserNotes` refetch (D-60), локального переупорядочивания/splice нет — иначе React держал бы второе мнение о порядке (дрейф D-39/D-40). success и `conflict` перечитывают (показать актуальное), storage failure не трогает список (писать было нечего). Единственный источник порядка — `sortNotes` в провайдере: pinned-first, затем существующий вторичный порядок; UI рендерит `note.pinned` из read-model и никогда не выставляет его оптимистично.

## D-80 · Pin не влияет на Today/Users/priority/SLA/owner/tasks/cases — **Locked**

Закрепление меняет ТОЛЬКО порядок заметок в секции User 360. Оно не входит ни в один вход Today (membership/priority/SLA/attention basis), Users, primary owner, tasks/cases, financial projections, note visibility или note body. `derivedCache` не инвалидируется (pin не участвует в derive). Узкий blast-radius — сознательное свойство среза.

## D-81 · Фокус явно восстанавливается на контрол заметки после reorder — **Locked**

После settled refetch фокус возвращается на контрол ТОЙ ЖЕ заметки, даже если она переместилась вверх/вниз (закреплённая всплывает наверх). Контрол находится по стабильному `note.id` через Map ref, не по DOM-позиции, а эффект восстановления ключается на `result`+`status`, поэтому срабатывает и после re-read (success/conflict), и после ошибки без re-read. `aria-pressed` отражает состояние, accessible name — полная инструкция («Закрепить заметку»/«Открепить заметку»), pending сообщается словами (`aria-busy` + «Сохраняем…»); disabled только у собственного in-flight контрола. Смена session identity очищает pending/success/error и сбрасывает attempt (fingerprint по роли — иначе ложный `conflict`). `CrmError.message` в UI не рендерится — узкий тотальный `Record<CrmErrorCode, string>` (`note-pin-error.ts`, инвариант D-62).

## D-82 · Редактирование тела — только authored overlay-заметки, только автор, право `edit_user_notes` — **Locked**

Тело заметки редактируемо только если заметка физически лежит в overlay `notes[]` (сгенерированная фикстурная заметка `${userId}_note_1` — неизменяемая демонстрационная запись; никаких fixture body override, новой top-level коллекции или резолвера тела фикстур). Право — существующее `edit_user_notes` (`canEditUserNotes`), та же ось Edit→notes, что у addNote/setNotePinned; матрица НЕ расширяется, новое право не заводится (как D-53/D-75). Разрешённые роли: crm_admin, crm_manager, retention_manager, support. Строже, чем pin (D-76): помимо роли требуется авторство — `note.authorEmployeeId === ctx.actorId`, иначе `unauthorized` даже у роли с правом; редактирование меняет чужой авторский текст. Видимость неизменна — невидимая или несуществующая заметка → `not_found` (неразличимы, mutation не зонд). Видимая non-overlay (фикстурная) → `invalid_input`, НЕ `not_found`: она визуально присутствует, «её нет» было бы ложью. Возможность решается провайдером: `getUserNotesView` отдаёт `CrmNoteListItem { note, capabilities: { canEditBody } }`; React НЕ определяет editable по форме id (`note_mock_*`), не знает про overlay-членство — иначе вторая расходящаяся копия правила (провал D-39/D-40). Персистентный `CrmNote` и схема overlay неизменны.

## D-83 · `expectedUpdatedAt` — оптимистичная конкуренция; один timestamp; replay до предусловия — **Locked**

Предусловие конкуренции — `expectedUpdatedAt` (не last-write-wins, не «ожидаемое прежнее тело», не синтетическая ревизия). Правка ДЕЙСТВИТЕЛЬНО переписывает stored note (в отличие от pin/owner, которые выводятся из лога), поэтому `updatedAt` реально сдвигается и служит настоящим version-токеном; это строка, читаемая из заметки, а не контент — безопасно нести в команде, в отличие от прежнего тела. Один mutation-timestamp: `note.updatedAt` новой заметки === `audit.at` — по нему replay реконструирует метаданные результата из audit-записи в одиночку. Порядок: replay (по receipt) проверяется ДО сравнения `expectedUpdatedAt` — после успешной правки `updatedAt` сдвинулся, поэтому безопасный retry с исходным `expectedUpdatedAt` обязан всё равно replay-нуться, а не конфликтовать (как D-72). `expectedUpdatedAt` НЕ входит в fingerprint (как D-72/D-78). Полный порядок проверок: ключ → нормализация тела → ISO-форма `expectedUpdatedAt` → user → видимость(projector) → not_found → `canEditUserNotes`→unauthorized → фикстурная/non-overlay→invalid_input → чужой автор→unauthorized → replay → «без изменений»→invalid_input → `expectedUpdatedAt` mismatch→conflict → один атомарный write.

## D-84 · Тело — PII: его нет в result, audit, receipt; fingerprint хранит только хеш — **Locked**

Result правки НЕ содержит `CrmNote` и НЕ содержит тела: `UpdateNoteBodyResult { noteId, updatedAt, audit, replayed }`. Причина: receipt хранит лишь `auditId`, audit тоже без тела, поэтому после повторной правки старый `CrmNote` не реконструируем; вернуть ТЕКУЩУЮ заметку на replay было бы нечестно (это результат другой правки), а хранить тело в receipt/audit чтобы «починить» — запрещено. Возвращаем только всегда-честно-реконструируемое: `noteId` и timestamp правки (= `note.updatedAt` = `audit.at`, D-83). Audit-запись `note_body_changed` — строжайшая: только базовые поля (`id, actorEmployeeId, actorRole, targetUserId, entityId, at, action, reasonCode, mock`), никаких previous/next, фрагмента, длины, диффа или нормализованного тела: тело — авторский PII, запись фиксирует ЧТО правка была, не что стало. Receipt (`kind: "note_body_change"`, key, fingerprint, auditId) — без тела, фрагмента, длины и без noteId (восстановим из audit). Fingerprint `[userId, actorId, role, noteId, normalizedBody]` через существующий `stableFingerprint` (FNV-1a, length-prefix, crypto нет — D-57); хранится только 16-hex дайджест. Никаких Math.random/Date.now/UUID/новых зависимостей. `CrmError.message` никогда не рендерится — узкий тотальный `Record<CrmErrorCode,string>` (`note-edit-error.ts`, инвариант D-62).

## D-85 · UI правки — inline в строке заметки, без optimistic, provider refetch — **Locked**

Правка — inline внутри существующей строки заметки (не Dialog/Sheet/toast/новая глобальная форма), как composer D-59: секция существует чтобы показывать заметки, модалка спрятала бы правимую. Idle-строка собственной authored-заметки: тело + pin + «Изменить»; фикстурная и чужая заметки — без «Изменить». В режиме правки тело заменяется labelled textarea (prefill текущим телом, счётчик, «Сохранить»/«Отменить»); pin-контрол строки скрыт; одновременно правится только одна заметка. Save задизейблен при пустом/слишком длинном/неизменном нормализованном черновике (провайдер всё равно отвергает защитно). Никакого optimistic body replacement: после success И после conflict — refetch `getUserNotesView`, чтобы тело, видимость, pin и порядок остались provider-owned (как D-79). Storage-fail сохраняет черновик, retry тем же idempotency-ключом. Escape отменяет; фокус возвращается на «Изменить» той же заметки после save/cancel/conflict (по стабильному `note.id`, не по DOM-позиции). Смена session identity сбрасывает черновик, чистит сообщения, сбрасывает attempt, рефетчит под новой проекцией. Доступность: видимый label «Новый текст заметки» (отличается от composer «Текст заметки»), счётчик в `aria-describedby`, `aria-invalid`+`role=alert`, `role=status`/`aria-live=polite` на успех, 44px тач-таргеты, реальный 200% reflow (720×450), zero horizontal overflow.

## D-86 · Global Audit на `/audit`; `canViewAudit` — единственный глобальный data-gate; section-visible Limited-роли → restricted-state — **Locked**

Глобальный Audit Workspace заменяет `SectionPlaceholder` на `/audit` (read-only). НЕ добавляется audit-preview в User 360 (это будущая фаза). Канонический доступ к данным — ТОЛЬКО `canViewAudit(ctx.role)` (право `view_audit`): данные получают crm_admin и crm_manager. Матрица прав, роли, `SECTION_VISIBILITY` и `canViewAudit` НЕ меняются. Навигационная видимость раздела шире data-gate — сознательно: семь section-visible ролей (все кроме content_manager/read_only) видят пункт Audit, но пять из них (retention_manager, mentor, support, moderator, analyst) на `/audit` получают спокойный restricted-state «Ваша роль не может просматривать глобальный журнал действий.», НЕ empty-state (это была бы ложь «действий просто нет»). content_manager/read_only не видят пункт в навигации; при прямом открытии `/audit` тоже получают defensive restricted-state, не данные. Провайдер проверяет `canViewAudit` ПЕРВЫМ, до чтения overlay: отказанная роль не читает storage и не получает ни одной записи.

## D-87 · `getAuditRecords`: provider-owned safe `AuditRecordView`; canonical sorter/projector; имена через `ownerLabel`/dataset — **Locked**

Новая read-операция контракта `getAuditRecords(ctx, { page? }) → Result<Paginated<AuditRecordView>>`. Порядок: `canViewAudit` → unauthorized при false → read overlay → project → sort → paginate. `CrmMutations` НЕ меняется (ровно addNote/assignPrimaryOwner/setNotePinned/updateNoteBody). UI НИКОГДА не получает сырой storage `AuditRecord`: провайдер отдаёт безопасный discriminated `AuditRecordView` (`domain/audit/audit-view`) — только резолвнутые имена, `at`, direction pin (`pinned` из `nextPinned`), owner before/after имена; НИКОГДА actorEmployeeId, targetUserId как видимый текст, entityId, тело/фрагмент заметки, email, телефон, финансы, idempotency key, reasonCode, storage diagnostics. `id` (audit id) — только стабильный React key и tie-break, не рендерится. Canonical sorter/projector в `domain/audit/audit-view`: сортировка `at` DESC, затем `id` DESC как стабильный tie-break, на КОПИИ (исходный append-only массив не мутируется, не полагается на позицию в `overlay.auditRecords`). Резолв имён через resolver-колбэки, которые провайдер строит из канонического `ownerLabel` (unknown employee → «Неизвестный сотрудник», null owner → «Не назначен») и dataset display name (unknown target → «Неизвестный пользователь»). Raw id НИКОГДА не fallback. Page size 20, newest first, `total` в метаданных секции.

## D-88 · Audit читает browser-local overlay, fail-closed; это НЕ compliance/server log — **Locked**

Audit Workspace — только новый reader существующих `auditRecords` из mutation-overlay. НЕ меняются: storage key `ata-crm.mutation-overlay.v1`, `version: 1`, структура `MutationOverlay`, guards audit-actions, receipt architecture, mutation sequence, owner/pin effective resolvers, четыре union-члена audit. Overlay остаётся append-only. Corrupt overlay сохраняет существующее fail-closed поведение: parser отдаёт пустой overlay, экран показывает честный empty-state — никаких повреждённых, частично восстановленных данных и raw diagnostics. Storage read failure, различимый существующим adapter/result contract (`gate`/errorMode → `upstream_unavailable`), даёт локализованный error-state с retry; raw `CrmError.message` в DOM не попадает. Копирайт header/подписи честны: это browser-local demo-журнал («Локальный demo-журнал. Серверная история пока не подключена.»), НЕ «неизменяемый журнал системы» без уточнения browser-local semantics, НЕ compliance/server log. Используется существующий верхний DEMO MODE badge + спокойная demo-подпись, без дублирования.

## D-89 · Первая версия без filters; pin direction словами; без entityType-иконок — **Locked**

Первая версия Audit НЕ содержит: фильтров, поиска, date range, actor-filter, user-filter, filters toolbar, infinite scroll, export/CSV/PDF, undo/rollback, редактирования/удаления записей, cross-tab listener, reset-overlay UI, server timestamps. Presentation: направление pin-события показывается СЛОВАМИ («закрепил заметку»/«открепил заметку»), цвет не единственный сигнал; entityType-иконки не показываются. Тексты действий — единый источник (`auditRowText` в config/labels), содержимое заметки (старое/новое тело) не раскрывается никогда, включая `note_body_changed`. Одна плотная chronological ledger-секция, не отдельная тяжёлая карточка на событие и не dashboard/KPI. Один h1, корректные headings у empty/restricted/error, loading озвучивается, pagination доступна с клавиатуры, реальный 200% reflow (720×450), zero horizontal overflow.

## D-90 · Note-visibility-aware audit projection и User 360 Limited audit-preview отложены — **Locked**

Текущая фаза не создаёт private/role_restricted заметок, а глобальный Audit доступен только двум Full-ролям (crm_admin/crm_manager), поэтому отдельная note-visibility-aware фильтрация audit-записей сейчас НЕ внедряется. Зафиксировано на будущее: если появятся private/role_restricted notes ЛИБО Limited audit-preview (например в User 360), note-scoped audit records ОБЯЗАНЫ пройти отдельную canonical privacy projection ДО показа — как `projectNotes` (D-55) для самих заметок. User 360 Limited audit-preview остаётся будущей фазой и в этой фазе не реализуется.

## D-91 · Смена видимости: только team↔private; role_restricted отложен; authored + только автор; право `edit_user_notes` — **Locked**

Новая мутация `setNoteVisibility` меняет видимость заметки между **team** и **private**. `role_restricted` НЕ поддерживается: у него нет модели allowed-roles («ограничена для кого?» — вопрос без ответа, D-55), поэтому он остаётся readable-fail-closed, но **не writable** — попытка задать его (как и любое неизвестное значение) → `invalid_input`. Право — существующее `edit_user_notes` (`canEditUserNotes`), та же ось Edit→notes, что у addNote/setNotePinned/updateNoteBody; матрица НЕ расширяется, новое право не заводится (как D-53/D-75/D-82) — менять могут ровно четыре роли: crm_admin, crm_manager, retention_manager, support. Как у `updateNoteBody` (D-82), действуют ДВЕ entity-level границы, строже роли: заметка должна физически лежать в overlay `notes[]` (фикстурная `${userId}_note_1` неизменяема → видимая non-overlay → `invalid_input`, не `not_found`), и менять её может только **автор** (`authorEmployeeId === ctx.actorId`), иначе `unauthorized` даже у роли с правом. Невидимая/несуществующая заметка → `not_found` (mutation не oracle существования private-заметки). НЕ реализовано: удаление заметок, allowed-role selector, fixture visibility override, создание role_restricted, User 360 audit-preview.

## D-92 · Private — по identity актора, а не по роли; provider-owned `canChangeVisibility` — **Locked**

`private` привязан к **сотруднику**, а не к роли: заметку видит только actor с совпадающим `authorEmployeeId` (canonical `canViewNote`, D-55). Следствия, зафиксированные тестами: смена **роли** при неизменном `actorEmployeeId` НЕ скрывает собственную private-заметку — тот же сотрудник остаётся автором; роль без `edit_user_notes` (напр. read_only) может **читать** свою private-заметку и её тело, но контрол изменения не получает; другой `actorEmployeeId` не видит private-заметку независимо от роли, включая admin — админ НЕ обходит private-видимость чужой заметки. Возможность смены видимости отдаётся провайдером через `getUserNotesView.capabilities.canChangeVisibility` (те же четыре условия, что `canEditBody`: роль-право + overlay-членство + видимость + авторство). React НЕ анализирует id заметки, префиксы, overlay-членство и НЕ сравнивает `authorEmployeeId` — иначе вторая расходящаяся копия правила (провал D-39/D-40). Мок-сессия по-прежнему выдаёт всем ролям один `emp_mock_admin`, поэтому E2E не изображает смену роли как смену сотрудника: author-flow идут на собственных заметках `emp_mock_admin`, а foreign-видимость доказывается overlay-фикстурой с ДРУГИМ `authorEmployeeId`.

## D-93 · `setNoteVisibility`: desired end-state + `expectedUpdatedAt`; один timestamp; replay до предусловия; аддитивный overlay — **Locked**

`visibility` — DESIRED end-state (team|private), не toggle; предусловие конкуренции — `expectedUpdatedAt` (как `updateNoteBody`, D-83): смена видимости РЕАЛЬНО переписывает stored note (`visibility`+`updatedAt`), поэтому `updatedAt` — настоящий version-токен; это строка, читаемая из заметки, а не контент. Один mutation-timestamp: `note.updatedAt` === `audit.at` === `result.updatedAt`. Порядок проверок, совместимый с `updateNoteBody`: ключ → визибилити team|private → ISO-форма `expectedUpdatedAt` → user → видимость(projector)→not_found → `canEditUserNotes`→unauthorized → фикстурная/non-overlay→invalid_input → чужой автор→unauthorized → replay (по receipt, ДО предусловия — safe retry после применения обязан replay-нуться) → «без изменений» (visibility == stored)→invalid_input → `expectedUpdatedAt` mismatch→conflict → один атомарный write. Fingerprint `[userId, actorId, role, noteId, visibility]` через существующий `stableFingerprint` (FNV-1a, D-57); `expectedUpdatedAt` в fingerprint НЕ входит (D-72/D-78/D-83); хранится только хеш. Result — БЕЗ `CrmNote`/тела/previous body/visibility-read-model (D-84). Overlay в пределах v1: тот же ключ `ata-crm.mutation-overlay.v1`, `version: 1`, те же top-level поля; аддитивно добавлены пятый union-член `NoteVisibilityChangedAuditRecord` (`previousVisibility`/`nextVisibility` ∈ {team,private}), reasonCode `note_visibility_changed_by_employee` и receipt kind `note_visibility_change` (только kind/key/fingerprint/auditId). Guard'ы принимают только точный action/reasonCode/receipt kind и **fail-closed** на role_restricted/неизвестных значениях; legacy overlay 1B4-B…1B5-B читается без потерь. Никаких Math.random/Date.now/UUID/новых зависимостей; изменяются `visibility`+`updatedAt`, а `body`/`createdAt`/`authorEmployeeId`/`userId`/pin неизменны.

## D-94 · Global Audit: `note_visibility_changed` показывается фактом, без направления — **Locked**

Глобальный `/audit` рендерит новый action нейтральным текстом «{actorName} изменил доступ к заметке у {targetUserName}». `AuditRecordView` для него несёт ТОЛЬКО базовые поля — `previousVisibility`/`nextVisibility` НЕ проецируются, поэтому журнал никогда не раскрывает НАПРАВЛЕНИЕ (team/private) и не сообщает, что заметка стала скрытой (иначе journal раскрывал бы существование private-контента). Не показываются: тело/фрагмент, note id, visibility hidden-заметки, raw employee/user id, diagnostics. Permission и pagination `/audit` не меняются: gate по-прежнему единственный `canViewAudit` (D-86), Full-роли видят все заметки, поэтому note-visibility-aware фильтрация самого журнала не требуется, пока audit Full-only.

## D-95 · User 360 Limited Audit Preview остаётся отложенным до реального actorId + team/scope — **Locked**

Подтверждает D-90 после появления private-заметок: User 360 Limited Audit Preview НЕ реализуется в этой фазе — ни `getUserAuditPreview`, ни `canViewUserAudit`, ни новый permission/helper, ни audit-секция в профиле, ни own/team/all scope, ни actor/team fixtures. Причина неизменна: мок-сессия выдаёт всем ролям один `emp_mock_admin` (owns 0 users, кандидатом owner быть не может), нет actor→team mapping (D-44/D-69), поэтому «свои пользователи/свои действия» honestly не определить — любой такой фильтр либо всегда пуст, либо всегда всё, либо тихо переопределяет «свои» как «любые». Не строить fake filters на `emp_mock_admin`. Отдельно: note-visibility-aware audit projection для будущего note-scoped preview теперь можно проектировать на РЕАЛЬНОЙ модели видимости (private существует), но сам preview ждёт настоящего backend-actorId и team/owner scope.

## D-96 · Удаление заметки: hard delete, только authored overlay-note, только автор, право `edit_user_notes`, без undo — **Locked**

Новая мутация `deleteNote` (Phase 1B6) физически удаляет заметку из overlay `notes[]` — **hard delete**: НЕ добавляется tombstone/`deletedAt` в `CrmNote`, тело удалённой заметки НЕ остаётся в localStorage, undo/restore НЕ поддерживается, bulk delete отсутствует. Право — существующее `edit_user_notes` (`canEditUserNotes`), та же ось Edit→notes, что у addNote/setNotePinned/updateNoteBody/setNoteVisibility; матрица НЕ расширяется, новый permission/CrmErrorCode не заводится (как D-53/D-75/D-82/D-91) — удалять могут ровно четыре роли: crm_admin, crm_manager, retention_manager, support; запрещено mentor/moderator/analyst/content_manager/read_only. Как у edit-мутаций, действуют ДВЕ entity-level границы, строже роли: заметка должна физически лежать в overlay `notes[]` (фикстурная `${userId}_note_1` неизменяема → видимая non-overlay → `invalid_input`, не `not_found`), и удалять её может только **автор** (`authorEmployeeId === ctx.actorId`), иначе `unauthorized` даже у роли с правом. Private-заметку автор удаляет по тем же правилам, что team, без дополнительных исключений. Границы entity: своя видимая authored-заметка → success; видимая fixture → `invalid_input`; видимая чужая team-заметка → `unauthorized`; скрытая чужая private / неизвестная заметка → `not_found` (mutation не oracle существования). Старые audit-записи заметки (note_added/note_pin_changed/note_body_changed/note_visibility_changed) НЕ удаляются и не переписываются — журнал append-only.

## D-97 · Audit — защитный источник истины удаления; canonical projection скрывает note с валидным поздним `note_deleted` — **Locked**

Удаление — hard delete, но append-only `note_deleted` audit-запись остаётся защитным источником истины отсутствия заметки. Canonical note-projection (`hideDeletedNotes` в `domain/notes/note-projection`) выполняется ПЕРВОЙ в `orderedVisibleNotes` — ДО pin-resolve, projectNotes и сортировки — поэтому удалённая заметка отсутствует и в `items`, и в `page.total`, как невидимая. Правило: заметка скрывается, только если ПОСЛЕДНЯЯ валидная `note_deleted` запись для её id (выбор по `at` DESC, затем audit `id` DESC — тотально и воспроизводимо, никогда по позиции в массиве) имеет `at` ≥ `note.updatedAt`. Даже повреждённый/legacy overlay, одновременно содержащий note-row и более поздний `note_deleted`, обязан скрыть заметку. Corrupt/stale delete-запись (её `at` РАНЬШЕ `note.updatedAt`, т.е. заметка записана после claim'а удаления) НЕ скрывает заметку; запись с непарсящимся `at` игнорируется. Структурно повреждённая `note_deleted` (неверный entityType/reasonCode) валит парс overlay целиком (fail-closed, empty overlay), поэтому не может ничего скрыть. Фикстурные заметки нельзя удалить нормальным mutation-путём (invalid_input), поэтому `note_deleted` для fixture id никогда не пишется и фикстура через этот путь не скрывается.

## D-98 · `deleteNote`: replay ДО entity-lookup; fingerprint без entity/тела; один timestamp; add-replay после удаления не воскрешает — **Locked**

Порядок проверок `deleteNote` отличается от edit-мутаций ОДНИМ несущим местом: idempotency-replay разрешается **ДО** lookup'а заметки. После успешного удаления entity исчезает, поэтому retry, сначала ищущий заметку, ответил бы `not_found` вместо replay исходного результата. Порядок: ключ → ISO-форма `expectedUpdatedAt` → непустой noteId → fingerprint → **replay по receipt (ДО user/entity lookup)** → user→not_found → видимость(projector)→not_found → `canEditUserNotes`→unauthorized → фикстурная/non-overlay→invalid_input → чужой автор→unauthorized → `expectedUpdatedAt` mismatch→conflict → один атомарный write (удалить row + append `note_deleted` + append receipt). Fingerprint `[userId, actorId, role, noteId]` через `stableFingerprint` (FNV-1a, D-57); `expectedUpdatedAt` в fingerprint НЕ входит (D-72/D-78/D-83/D-93) — safe retry с изменённым preconditon всё равно replay-ится; тело/visibility/pin в fingerprint НЕ входят (их у delete нет). Один timestamp: `audit.at` === `result.deletedAt`. Result — БЕЗ `CrmNote`/тела/previous body/visibility/pin (только `noteId`/`deletedAt`/`audit`/`replayed`). Storage failure: заметка остаётся, audit и receipt не пишутся, overlay побайтово не меняется, тот же ключ можно повторить. Отдельно зафиксировано: повтор ИСХОДНОГО `addNote` ключа ПОСЛЕ удаления заметки возвращает original add-result с `replayed:true`, НО заметку не воскрешает — узкая lifecycle-ветка addNote реконструирует `CrmNote` из audit-записи + payload повторной команды (нормализованное тело гарантированно то же по fingerprint-совпадению), НЕ записывая row обратно в overlay; тело в receipt/audit не добавляется (D-84); остальной addNote-контракт не менялся; audit после add→delete→retry содержит ровно один `note_added` и один `note_deleted`.

## D-99 · Global Audit: `note_deleted` показывается нейтральным фактом — **Locked**

Глобальный `/audit` рендерит новый action нейтральным текстом «{actorName} удалил заметку у {targetUserName}», `detail = null`. `AuditRecordView` для него несёт ТОЛЬКО базовые поля (id/at/actorName/targetUserName/mock). Не показываются: тело/фрагмент удалённой заметки, visibility, pin state, note id, audit id, employee/user id, idempotency key, previous note state, diagnostics, JSON. Permission/pagination/sorting/page-size(20) `/audit` не меняются: gate по-прежнему единственный `canViewAudit` (D-86). Все шесть audit actions (note_added, primary_owner_changed, note_pin_changed, note_body_changed, note_visibility_changed, note_deleted) сосуществуют; note_added удалённой заметки остаётся в журнале рядом с note_deleted (append-only).

## D-100 · UI удаления: provider-owned `canDelete`; inline confirm; без Dialog/toast/undo; destructive тон только в confirm — **Locked**

Возможность удаления отдаётся провайдером через `getUserNotesView.capabilities.canDelete` (те же условия, что `canEditBody`/`canChangeVisibility`: роль-право + overlay-членство + видимость + авторство; поздней валидной `note_deleted` у видимой заметки быть не может, D-97). React НЕ анализирует id заметки/префиксы/overlay/`authorEmployeeId` и НЕ вычисляет право удаления сам (иначе провал D-39/D-40). Контрол — отдельная destructive-кнопка (иконка Trash, accessible name «Удалить заметку», target ≥44×44 px, визуально отличима от pencil/shield/pin), нейтральная в idle: destructive-тон (красная «Удалить» + danger-панель) появляется ТОЛЬКО в confirm-состоянии, без постоянной красной доминанты. По нажатию — inline confirmation ВНУТРИ строки заметки (заголовок «Удалить заметку?», текст «Действие нельзя отменить. История изменения останется в Audit.», кнопки «Отменить»/«Удалить»); НЕ используются Dialog/Sheet/toast/`confirm()`/новая страница/undo-snackbar/bulk delete. Один active mode на строку (body edit | visibility edit | delete confirm) — открытие delete confirm не уничтожает незавершённый draft: существующий редактор сначала должен быть явно закрыт (пока он открыт, контролы строки, включая Trash, не рендерятся). Состояния: idle; confirming; pending (aria-busy, «Удаляем…», single-call guard); success (строка исчезает после canonical refetch, `page.total` −1, спокойное «Заметка удалена»); conflict (refetch, confirm закрывается, актуальные данные); not_found (refetch, строка исчезает); unauthorized/invalid_input (контрол отсутствует); internal/storage (confirm остаётся открытым, retry тем же ключом, безопасная русская ошибка); role change (confirm закрывается при потере права, attempt/idempotency identity сбрасывается, refetch). Никогда не рендерится raw `CrmError.message`; для delete-ошибок — exhaustive `Record<CrmErrorCode, string>`. Focus: Escape закрывает confirm без удаления; после Cancel/conflict фокус на delete-control строки (если заметка ещё есть); после success/not_found — на composer добавления заметки, а если он недоступен — на безопасный section-target. Status/error имеют role=status/role=alert; touch targets ≥44px; mobile и 200% reflow без overflow; двух h1 нет.

## D-101 · Tasks/Cases/Signals/Recommendations остаются отложенными до честной identity/policy-модели — **Locked**

Подтверждает границы после появления полного notes-lifecycle (add/pin/body/visibility/delete): Phase 1B6 НЕ трогает owner, Today, Users, Tasks, Cases, Signals, Recommendations. Mutating-операции над Tasks/Cases (create/update/close/complete), Signal acknowledgement и Recommendation completion остаются отложенными по прежней причине (D-95/D-44/D-69): мок-сессия выдаёт всем ролям один `emp_mock_admin`, нет actor→team mapping и own/team/all scope, поэтому «свои задачи/кейсы/действия» honestly не определить. Не строить fake scope на `emp_mock_admin`; эти поверхности ждут настоящего backend-actorId и policy-модели.
