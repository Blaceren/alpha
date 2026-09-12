# STATE_MODEL.md — Alfa Trade Academy CRM

> Phase 0.5 · Каноническая модель состояний пользователя. **Заменяет прежний единый lifecycle mega-enum.**
> Это источник истины для enum-имён во всех остальных документах и будущих TypeScript-типах.
> Статус: Утверждено (Decision Lock, см. DECISIONS.md D-01).

---

## 0. Проблема, которую решает документ

Прежняя `UserLifecycle` смешивала независимые измерения в одном enum:
`active_funded`, `checkpoint_grace`, `repeat_funder`, `inactive_7d`, `support_blocked` — это состояния **разной природы**, которые сосуществуют одновременно. Один пользователь может быть `active` **и** `funded` **и** `repeat_funder` **и** `inactive_7d` **и** `support_blocked` сразу. Один enum это выразить не может → постоянная перезапись состояния и потеря информации.

**Решение:** пять ортогональных измерений. Каждое отвечает на один вопрос и меняется независимо.

| Измерение | Кардинальность | Вопрос |
|---|---|---|
| **LifecycleStage** | ровно 1 (versioned) | На каком основном этапе взаимоотношений пользователь? |
| **FundingStatus** | ровно 1 | Каков финансовый статус доступа? |
| **EngagementStatus** | ровно 1 | Насколько пользователь активен сейчас? |
| **ValueSegment** | 0..N (теги) | К каким ценностным группам относится? |
| **OperationalBlocker** | 0..N (теги) | Что конкретно блокирует прямо сейчас? |

---

## 1. LifecycleStage (один текущий, versioned)

Основной этап взаимоотношений. Ровно одно значение в каждый момент; история версионируется.

```ts
type LifecycleStage =
  | 'registered'
  | 'pocket_registered'
  | 'pre_ftd'
  | 'first_depositor'
  | 'active'
  | 'at_risk'
  | 'dormant'
  | 'reactivated'
  | 'completed_current_curriculum';
```

| Значение | Смысл |
|---|---|
| `registered` | Зарегистрирован в академии, регистрация Pocket ещё не завершена. |
| `pocket_registered` | Регистрация Pocket подтверждена, депозита ещё нет. |
| `pre_ftd` | Готов к первому депозиту (Pocket зарегистрирован, обучается), FTD не сделан. |
| `first_depositor` | Сделал первый подтверждённый депозит (FTD). |
| `active` | Устойчиво прогрессирует и/или funded, активен. |
| `at_risk` | Есть признаки риска оттока/финансового риска (детализируется EngagementStatus/FundingStatus/Blockers). |
| `dormant` | Длительная неактивность (детализируется EngagementStatus). |
| `reactivated` | Вернулся после длительного отсутствия. |
| `completed_current_curriculum` | Прошёл весь доступный на данный момент curriculum. |

**Переходы:** `registered → pocket_registered → pre_ftd → first_depositor → active → (at_risk ↔ active) → dormant → reactivated → active`. `completed_current_curriculum` достижимо из `active`. `at_risk`/`dormant`/`reactivated` — обратимы.

`LifecycleStage` — **производное** от других измерений и продуктовых данных, но фиксируется как одно текущее значение с историей (см. §6).

---

## 2. FundingStatus (один текущий)

Финансовый статус доступа. Ровно одно значение.

```ts
type FundingStatus =
  | 'not_available'
  | 'unfunded'
  | 'funded'
  | 'checkpoint_grace'
  | 'financial_access_suspended'
  | 'balance_unknown';
```

| Значение | Смысл |
|---|---|
| `not_available` | Финансовый статус неприменим — регистрация Pocket не подтверждена. |
| `unfunded` | Pocket зарегистрирован, но нет достаточного real balance / нет депозита. |
| `funded` | Подтверждённый real balance удовлетворяет последнему checkpoint. |
| `checkpoint_grace` | Баланс упал ниже threshold, идёт grace period (24 ч, см. DECISIONS D-06). |
| `financial_access_suspended` | Grace истёк, доступ после checkpoint приостановлен (решение — за backend). |
| `balance_unknown` | Баланс устарел/недоступен (`balance_data_stale`) — статус не подтверждён. |

**Важно:** CRM только **отображает** FundingStatus. Решение о suspension принимает backend продукта (DECISIONS D-06). `balance_unknown` — отдельное честное состояние вместо ложного `funded`/`unfunded`.

---

## 3. EngagementStatus (один текущий)

Уровень текущей активности. Ровно одно значение.

```ts
type EngagementStatus =
  | 'not_started'
  | 'active'
  | 'progression_stalled'
  | 'inactive_3d'
  | 'inactive_7d'
  | 'dormant_14d'
  | 'dormant_30d'
  | 'returned';
```

| Значение | Правило (mock, конфигурируемо — см. SIGNAL_CATALOG) |
|---|---|
| `not_started` | Зарегистрирован, но нет ни одного meaningful action. |
| `active` | Есть недавняя meaningful activity. |
| `progression_stalled` | 72 ч без прогресса при доступном следующем уровне. |
| `inactive_3d` | 72 ч без meaningful action. |
| `inactive_7d` | 7 дней без meaningful action. |
| `dormant_14d` | 14 дней. |
| `dormant_30d` | 30 дней. |
| `returned` | Meaningful action после ≥7 дней отсутствия. |

Пороги берутся из SIGNAL_CATALOG.md, не hardcode.

---

## 4. ValueSegment (массив тегов, 0..N)

Не взаимоисключающие ценностные теги. Пользователь может иметь несколько.

```ts
type ValueSegment =
  | 'first_depositor'
  | 'repeat_funder'
  | 'frequent_repeat_funder'
  | 'high_value_candidate'
  | 'advanced_learner';
```

| Тег | Смысл (mock-порог) |
|---|---|
| `first_depositor` | Есть подтверждённый FTD. |
| `repeat_funder` | redepositCount ≥ 1. |
| `frequent_repeat_funder` | redepositCount ≥ 4 (frequent_redeposit_pattern). |
| `high_value_candidate` | Высокий net deposits / траектория (порог в конфиге). |
| `advanced_learner` | Достиг продвинутого уровня curriculum. |

Теги сосуществуют (напр. `first_depositor` + `repeat_funder` + `high_value_candidate`).

---

## 5. OperationalBlocker (массив тегов, 0..N)

Активные операционные блокеры. Массив; каждый — с evidence и сроком.

```ts
type OperationalBlocker =
  | 'email_unconfirmed'
  | 'pocket_registration_incomplete'
  | 'report_pending'
  | 'mentor_blocked'
  | 'support_blocked'
  | 'financial_data_conflict'
  | 'communication_fatigue';
```

| Блокер | Что означает |
|---|---|
| `email_unconfirmed` | Email не подтверждён. |
| `pocket_registration_incomplete` | Регистрация Pocket не завершена/не подтверждена (мешает FTD/финансам). |
| `report_pending` | Есть report, ожидающий mentor-проверки. |
| `mentor_blocked` | Прогресс упёрся в mentor-решение (напр. rejected report без возврата). |
| `support_blocked` | Открыт support-блокер (верификация и т.п.). |
| `financial_data_conflict` | Расхождение баланса продукт↔Pocket. |
| `communication_fatigue` | Превышен лимит коммуникаций (DECISIONS D-03). |

Блокеры не перезаписывают друг друга; несколько активны одновременно.

---

## 6. Обёртка состояния и evidence

Каждое измерение — не просто enum, а состояние с обоснованием.

```ts
// LifecycleStage — единственное versioned с полной историей.
interface LifecycleState {
  version: string;                 // версия правил, напр. "2026-07"
  current: LifecycleStage;
  enteredAt: ISODateString;
  previous: LifecycleStage | null;
  reasonCode: string;
  evidence: Evidence[];
  history: LifecycleTransition[];  // versioned
  manualOverride: ManualOverride | null;
}

// Универсальная обёртка для single-value измерений (Funding/Engagement).
interface DimensionState<T extends string> {
  value: T;
  reasonCode: string;
  evidence: Evidence[];
  calculatedAt: ISODateString;     // когда пересчитано
  expiresAt: ISODateString | null; // если применимо (напр. grace, inactivity re-eval)
}

// Тег-элемент для массивных измерений (ValueSegment/OperationalBlocker).
interface StateTag<T extends string> {
  tag: T;
  reasonCode: string;
  evidence: Evidence[];
  calculatedAt: ISODateString;
  expiresAt: ISODateString | null;
  status: 'active' | 'expired' | 'suppressed';
}

// Композиция состояния пользователя.
interface UserStateProfile {
  userId: UserId;
  lifecycle: LifecycleState;
  funding: DimensionState<FundingStatus>;
  engagement: DimensionState<EngagementStatus>;
  valueSegments: StateTag<ValueSegment>[];
  blockers: StateTag<OperationalBlocker>[];
}
```

Правила:
- `LifecycleStage` — versioned history обязательна.
- `FundingStatus`, `EngagementStatus`, `ValueSegment`, `OperationalBlocker` — обязаны нести `evidence`, `reasonCode`, `calculatedAt` и `expiresAt` (где применимо).
- `Evidence` — как в CRM_DOMAIN_MODEL §19 (никогда не содержит секретов/сырого PII).

---

## 7. Отображение прежних значений → новая модель (миграция понятий)

| Старое lifecycle-значение | Новое размещение |
|---|---|
| anonymous | (вне scope CRM) |
| academy_registered | LifecycleStage `registered` |
| pocket_pending | LifecycleStage `registered` + Funding `not_available` |
| pocket_registered | LifecycleStage `pocket_registered` |
| email_unconfirmed | Blocker `email_unconfirmed` |
| learning_started | Engagement `active` (Lifecycle `pre_ftd`/`pocket_registered`) |
| pre_ftd | LifecycleStage `pre_ftd` + Funding `unfunded` |
| first_depositor | LifecycleStage `first_depositor` + ValueSegment `first_depositor` |
| active_learner | LifecycleStage `active` + Engagement `active` |
| active_funded | LifecycleStage `active` + Funding `funded` |
| checkpoint_approaching | (сигнал `checkpoint_approaching`, не состояние) |
| checkpoint_grace | Funding `checkpoint_grace` |
| financial_access_suspended | Funding `financial_access_suspended` |
| repeat_funder | ValueSegment `repeat_funder` |
| frequent_repeat_funder | ValueSegment `frequent_repeat_funder` |
| progression_stalled | Engagement `progression_stalled` |
| inactive_3d / 7d | Engagement `inactive_3d` / `inactive_7d` |
| dormant_14d / 30d | Engagement `dormant_14d` / `dormant_30d`; Lifecycle `dormant` |
| returned | Engagement `returned`; Lifecycle `reactivated` |
| support_blocked | Blocker `support_blocked` |
| mentor_blocked | Blocker `mentor_blocked` |
| completed_current_curriculum | LifecycleStage `completed_current_curriculum` |

`checkpoint_approaching` — это **сигнал** (SIGNAL_CATALOG), а не состояние: он временный и предупреждающий.

---

## 8. Пример: один пользователь, пять измерений

Пользователь «Kostya M.» (см. MOCK_DATA_PLAN):

```ts
{
  lifecycle:    { current: 'at_risk', ... },
  funding:      { value: 'checkpoint_grace', ... },
  engagement:   { value: 'active', ... },
  valueSegments:[ {tag:'first_depositor'}, {tag:'repeat_funder'}, {tag:'high_value_candidate'} ],
  blockers:     [ {tag:'financial_data_conflict'} ]
}
```

Одновременно: этап `at_risk`, финансово в `checkpoint_grace`, активно занимается, ценностно — повторно фондирующий кандидат высокой ценности, и есть конфликт финансовых данных. Прежняя модель потеряла бы всё, кроме одного значения.

---

## 9. Влияние на остальные документы

- **CRM_DOMAIN_MODEL:** `UserLifecycle` → заменён на `UserStateProfile` (5 измерений). `CrmUser` ссылается на профиль.
- **Users list / filters / saved views (IA, DATA_PROVIDER):** фильтрация по каждому измерению независимо (lifecycle, funding, engagement, valueSegment[], blocker[]).
- **MOCK_DATA_PLAN:** каждая персона описывается пятью измерениями.
- **UX_BLUEPRINT:** отдельные бейджи для Lifecycle/Funding/Engagement + чипы для ValueSegment/Blockers.

---

_Связано: DECISIONS.md (D-01), CRM_DOMAIN_MODEL.md, SIGNAL_CATALOG.md (пороги), MOCK_DATA_PLAN.md._
