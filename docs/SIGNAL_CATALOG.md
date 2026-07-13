# SIGNAL_CATALOG.md — Alfa Trade Academy CRM

> Phase 0.5 · Каталог сигналов с конфигурируемыми пороговыми значениями. Единый источник правды для сигналов.
> Пороги — стартовые mock-значения (DECISIONS D-04), **конфигурируемы, не hardcode в UI**.
> Статус: Утверждено (Decision Lock).

---

## 0. Что такое сигнал

Сигнал — **временный, объяснимый индикатор** состояния пользователя с evidence и сроком жизни. Не постоянный ярлык. Сигналы питают EngagementStatus/OperationalBlocker (STATE_MODEL), очереди Today и recommended actions.

Сигнал ≠ состояние: `checkpoint_approaching` — сигнал (предупреждение), а не FundingStatus. Состояния живут в STATE_MODEL; сигналы объясняют, **почему** состояние меняется, и создают работу.

---

## 1. Структура сигнала

Каждый сигнал в каталоге и в runtime обязан иметь:

```ts
interface SignalDefinition {
  code: SignalCode;                 // машинный код (стабильный)
  title: string;                    // человекочитаемо
  description: string;
  evidenceRequirements: string[];   // какие данные обязаны присутствовать
  severity: 'critical' | 'high' | 'medium' | 'low';
  thresholdConfig: ThresholdConfig; // конфигурируемые пороги
  recommendedActionCodes: string[]; // связанные RecommendedActionType
  suppressionRules: string[];       // когда сигнал подавляется
}

interface SignalInstance {
  id: string;
  code: SignalCode;
  userId: UserId;
  severity: SignalDefinition['severity'];
  status: 'active' | 'resolved' | 'expired' | 'suppressed';
  evidence: Evidence[];
  reasonCode: string;
  createdAt: ISODateString;
  calculatedAt: ISODateString;      // когда последний раз пересчитан
  expiresAt: ISODateString | null;
  recommendedActionRef: string | null;
}

interface ThresholdConfig {
  key: string;                      // ключ в signals.config
  params: Record<string, number | string>;  // напр. { hours: 24 } или { count: 3, windowHours: 24 }
  unit: 'hours' | 'days' | 'count' | 'minutes' | 'composite';
}
```

Обязательные поля инстанса: `code, title(из def), description(из def), evidence requirements(из def), severity, threshold config, createdAt, calculatedAt, expiresAt, status, recommended action codes, suppression rules`.

---

## 2. Каталог сигналов и стартовые пороги (mock, конфигурируемо)

| Code | Порог (стартовый) | thresholdConfig | Severity | Feeds |
|---|---|---|---|---|
| `registration_no_start` | 24 ч без meaningful action после регистрации | `{hours:24}` | medium | Engagement `not_started` |
| `pocket_registration_incomplete` | 24 ч, registrationStatus = not_registered/registration_pending (не registered) | `{hours:24}` | high | Blocker `pocket_registration_incomplete` |
| `email_not_confirmed` | 12 ч, identity.emailConfirmed=false (ATA email, отдельно от Pocket) | `{hours:12}` | medium | Blocker `email_unconfirmed` |
| `lesson_abandoned` | 24 ч после начала урока без продолжения | `{hours:24}` | medium | Engagement (риск) |
| `progression_stalled` | 72 ч без прогресса при доступном следующем уровне | `{hours:72, requires:'next_level_available'}` | medium | Engagement `progression_stalled` |
| `repeated_test_failure` | 3 неуспешные попытки за 24 ч | `{count:3, windowHours:24}` | high | Blocker (mentor риск) |
| `report_pending` | report ожидает mentor-проверки (в SLA) | `{sla:'mentor_review'}` | medium | Blocker `report_pending` |
| `report_rejected_no_return` | 48 ч без исправления после reject | `{hours:48}` | high | Blocker `mentor_blocked` |
| `mentor_sla_risk` | приближение к SLA mentor review (warning) | `{sla:'mentor_review', warnAtPct:80}` | high | queue Mentor |
| `checkpoint_approaching` | баланс близок к следующему checkpoint (warning) | `{deltaPctToCheckpoint:15}` | medium | Financial Ops |
| `checkpoint_grace_active` | активен grace period | `{policy:'grace'}` | high | Funding `checkpoint_grace` |
| `financial_access_suspended` | доступ приостановлен после grace | `{policy:'grace'}` | critical | Funding `financial_access_suspended` |
| `balance_data_stale` | warning 15 мин, stale 60 мин (mock) | `{warnMinutes:15, staleMinutes:60}` | medium | Funding `balance_unknown` |
| `pocket_data_conflict` | расхождение баланса продукт↔Pocket | `{tolerance:'any'}` | high | Blocker `financial_data_conflict` |
| `inactive_3_days` | 72 ч без meaningful action | `{hours:72}` | medium | Engagement `inactive_3d` |
| `inactive_7_days` | 7 дней без meaningful action | `{days:7}` | high | Engagement `inactive_7d` |
| `dormant_14_days` | 14 дней | `{days:14}` | high | Engagement `dormant_14d` |
| `dormant_30_days` | 30 дней | `{days:30}` | high | Engagement `dormant_30d` |
| `returned_after_absence` | meaningful action после ≥7 дней отсутствия | `{minAbsentDays:7}` | medium | Engagement `returned` |
| `communication_fatigue` | >2 сообщений за 24 ч или 5 за 7 дней | `{max24h:2, max7d:5}` | high | Blocker `communication_fatigue` |
| `frequent_redeposit_pattern` | redepositCount ≥ 4 | `{minRedeposits:4}` | low | ValueSegment `frequent_repeat_funder` |
| `rapid_balance_decline` | резкое падение баланса (%/срок) | `{dropPct:40, windowHours:24}` | high | Funding риск / grace |

> Все значения — стартовые для mock. Реальные пороги согласуются с продуктом на интеграции. `dropPct`/`high_value` пороги помечены как предварительные (см. остаточные вопросы IMPLEMENTATION_PLAN).

---

## 3. Severity → приоритет и очереди

- `critical` → Today top, немедленная работа (напр. `financial_access_suspended`).
- `high` → приоритет в Today/очередях.
- `medium` → плановая работа.
- `low` → информационный/сегментный (напр. `frequent_redeposit_pattern`).

Severity сигнала влияет на `currentPriority` пользователя (агрегация — в domain-слое).

---

## 4. Жизненный цикл и suppression

- **createdAt/calculatedAt/expiresAt:** сигнал появляется при выполнении порога, пересчитывается (calculatedAt), истекает по expiresAt или при устранении причины (`resolved`).
- **Suppression-правила (примеры):**
  - `communication_fatigue` подавляет отправку новых коммуникаций (не создаёт новые outbound).
  - При активном `financial_access_suspended` подавляются retention-подталкивания к обучению после checkpoint.
  - Дублирующие engagement-сигналы схлопываются: активен только самый «глубокий» (напр. при `dormant_14d` не держим `inactive_7d`).
  - Сигналы не создаются повторно в cooldown-окне (конфиг automation).
- **Evidence обязателен:** сигнал без evidence не отображается (принцип объяснимости).

---

## 5. Конфигурация (где живут пороги)

```ts
// src/config/signals.config.ts (создаётся в Phase 1, не сейчас)
export const SIGNAL_THRESHOLDS = {
  registration_no_start: { hours: 24 },
  pocket_registration_incomplete:  { hours: 24 },
  email_not_confirmed:   { hours: 12 },
  lesson_abandoned:      { hours: 24 },
  progression_stalled:   { hours: 72 },
  repeated_test_failure: { count: 3, windowHours: 24 },
  report_rejected_no_return: { hours: 48 },
  inactive_3d:  { hours: 72 },
  inactive_7d:  { days: 7 },
  dormant_14d:  { days: 14 },
  dormant_30d:  { days: 30 },
  returned_after_absence: { minAbsentDays: 7 },
  communication_fatigue:  { max24h: 2, max7d: 5 },
  balance_data_stale:     { warnMinutes: 15, staleMinutes: 60 },
  frequent_redeposit_pattern: { minRedeposits: 4 },
  rapid_balance_decline:  { dropPct: 40, windowHours: 24 },
} as const;
```

UI-компоненты читают пороги только отсюда (или из будущего API-конфига), **никогда не хардкодят**.

---

_Связано: STATE_MODEL.md (Engagement/Blocker), CRM_DOMAIN_MODEL.md (UserSignal), DECISIONS.md (D-04), DATA_PROVIDER_CONTRACT.md (getUserSignals)._
