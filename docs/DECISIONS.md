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

`registration_no_start` 24 ч · `pocket_not_connected` 24 ч · `email_not_confirmed` 12 ч · `lesson_abandoned` 24 ч · `progression_stalled` 72 ч (при доступном следующем уровне) · `repeated_test_failure` 3 провала за 24 ч · `report_rejected_no_return` 48 ч · `inactive_3d` 72 ч · `inactive_7d` 7 дней · `dormant_14d` 14 дней · `dormant_30d` 30 дней · `returned_after_absence` meaningful action после ≥7 дней · `communication_fatigue` >2 сообщений за 24 ч или 5 за 7 дней · `balance_data_stale` warning 15 мин / stale 60 мин (mock).

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

Обновление `14.2.33 → 14.2.35` (последний патч линии 14.2, дист-тег `next-14`) + postcss `8.5.17` + @playwright/test `1.61.1`. **Не** переходим на 15/16, т.к. это major + React 19 (риск дестабилизации доменного слоя). Остаточные 11 advisories — внутри next 14.2.35; устраняются только major-апгрейдом и **отложены** до отдельного migration-этапа. Обоснование: Phase 1B1 — локальный mock без production-деплоя, middleware, image-optimization, i18n и недоверенного трафика, поэтому практический риск этих advisories ≈ 0. Findings не скрыты (см. IMPLEMENTATION_STATUS).

## D-19 · Детерминированное время (FixedMockClock) — **Locked**

Единая опорная точка `MOCK_NOW = 2026-07-13T09:00:00Z`. Fixtures хранят относительные смещения; абсолютные времена и все производные состояния (SLA, grace, inactivity) вычисляются от `Clock`. Тесты и данные не зависят от реального времени.

## D-20 · Приоритет — правила, не score — **Locked**

Приоритет = полоса `critical/high/normal/low`, определяемая упорядоченными правилами с `reasonCode`+`evidence`. Никакого непрозрачного числового score. Tie-break детерминирован (SLA → severity → last action → user id).

## D-21 · Запрет финансово-давящих рекомендаций — **Locked**

Каталог рекомендаций не содержит `deposit_now/recover_losses/increase_trade_size/trade_more/restore_balance_by_deposit/urgent_redeposit` (проверяется тестом). После падения баланса — только образовательные/mentor/support/communication-suppression действия, с `humanApprovalRequired`.

## D-22 · Сортировка по точным финансам без права → invalid_input — **Locked**

Чтобы порядок по точной сумме не «утекал» неавторизованным ролям через UI-контракт, провайдер отклоняет sort по `balance`/`netDeposits` без `view_exact_financials` (ошибка `invalid_input`), а не молча переупорядочивает.
