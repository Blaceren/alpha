# SLA_POLICY.md — Alfa Trade Academy CRM

> Phase 0.5 · Политика SLA для очередей и задач. Единый источник значений и модели SLA.
> Стартовые значения (DECISIONS D-05), конфигурируемы. Для mock считаются календарные часы.
> Статус: Утверждено (Decision Lock).

---

## 1. Стартовые значения SLA (mock)

| Тип работы | SLA | Warning (по умолч. 80%) |
|---|---|---|
| Mentor review | 24 ч | 19.2 ч |
| Retention follow-up | 24 ч | 19.2 ч |
| Support — critical | 1 ч | 48 мин |
| Support — high | 4 ч | 3.2 ч |
| Support — normal | 24 ч | 19.2 ч |
| Financial data conflict | 4 ч | 3.2 ч |

Значения конфигурируемы; warning-порог настраивается (по умолчанию 80% от SLA).

---

## 2. Модель SLA

```ts
interface SlaPolicy {
  key: SlaKey;                      // 'mentor_review' | 'retention_follow_up' | 'support_critical' | ...
  durationMinutes: number;         // из таблицы выше
  warnAtPct: number;               // 0..100, по умолч. 80
  calendar: 'calendar_hours' | 'business_calendar';  // mock → calendar_hours
}

interface SlaState {
  policyKey: SlaKey;
  startedAt: ISODateString;
  timezone: string;                // IANA, напр. 'Europe/Amsterdam'
  dueAt: ISODateString;            // с учётом calendar/paused
  status: 'on_track' | 'warning' | 'breached' | 'paused' | 'resolved';
  pausedIntervals: { from: ISODateString; to: ISODateString | null }[];
  breachedAt: ISODateString | null;
  resolvedAt: ISODateString | null;
}

type SlaKey =
  | 'mentor_review' | 'retention_follow_up'
  | 'support_critical' | 'support_high' | 'support_normal'
  | 'financial_data_conflict';
```

Модель обязана поддерживать: **timezone, business calendar, paused state, warning threshold, breached state, resolvedAt**.

---

## 3. Поведение

- **on_track:** now < warning-порог.
- **warning:** достигнут `warnAtPct` от SLA — визуальный акцент, но не breach.
- **paused:** SLA приостановлен (напр. `waiting_user` / `waiting_internal` у задачи, или ожидание ответа пользователя). Время в паузе не засчитывается; `dueAt` сдвигается.
- **breached:** now ≥ dueAt и не resolved. `breachedAt` фиксируется, в Today/очередь — критический акцент.
- **resolved:** работа завершена; `resolvedAt` фиксируется; SLA закрывается.

**Timezone:** SLA считается в timezone, связанном с политикой/командой; отображается в локальном времени сотрудника с явной меткой tz.

**Business calendar:** для будущего production — расчёт по рабочему календарю (рабочие часы/выходные). Для **mock** используются календарные часы (`calendar: 'calendar_hours'`).

---

## 4. Привязка к сущностям

- **Mentor Queue** элементы → `mentor_review`.
- **Support Queue** элементы → `support_critical|high|normal` по приоритету обращения.
- **Cases**: `financial_data_conflict` → `financial_data_conflict` SLA; retention-кейсы → `retention_follow_up`.
- **Tasks**: retention-задачи → `retention_follow_up`; SLA на задаче опционален (dueAt).

Поля SLA приходят через `getMentorQueue` / `getSupportQueue` / `getUserCases` (DATA_PROVIDER: `slaDueAt`, `slaBreached`, а также `SlaState` в деталях).

---

## 5. Отображение (UX)

- Бейдж SLA: on_track (нейтр.) / warning (акцент внимания) / breached (критический) / paused (приглушённый с иконкой паузы).
- Всегда показывается `dueAt` в локальном tz + остаток/просрочка.
- Сортировка очередей по `slaDueAt asc` по умолчанию; breached — вверх.
- Никакого SLA-цвета без семантики; статус дублируется текстом/иконкой (a11y).

---

## 6. Mock-упрощения

- `calendar_hours` вместо business calendar.
- Паузы моделируются при статусах задач `waiting_user`/`waiting_internal`.
- Несколько персон с warning/breached состояниями для проверки UI (см. MOCK_DATA_PLAN).

---

_Связано: DECISIONS.md (D-05), DATA_PROVIDER_CONTRACT.md (queue SLA-поля), CRM_DOMAIN_MODEL.md (CrmCase.sla), UX_BLUEPRINT.md (SLA-бейджи)._
