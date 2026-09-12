# CRM_DOMAIN_MODEL.md — Alfa Trade Academy CRM

> Phase 0 (обновлено в Phase 0.5) · Доменная модель на уровне TypeScript. Это **контракт типов** для UI и provider'ов, не Prisma-схема и не БД.
> Все сущности read-model для CRM; источник истины — см. DECISIONS D-02 (продукт vs CRM).
> Статус: Draft для утверждения.
>
> **Phase 0.5 изменения:** прежняя `UserLifecycle` (mega-enum) заменена на `UserStateProfile` из 5 ортогональных измерений (см. STATE_MODEL.md, DECISIONS D-01). Обновлены `CrmUser`, источники истины (D-02), ownership (D-08), checkpoints >L100 (D-10), финансовые бакеты (D-07).

---

## 0. Соглашения

- **Источник истины (Source of Truth):**
  - `PRODUCT` — данные основного продукта/backend (через будущий API). CRM только читает.
  - `POCKET` — производные Pocket-данные, поступающие в продукт и далее в CRM (CRM **не** ходит в Pocket напрямую).
  - `CRM` — данные, создаваемые внутри CRM (tasks, cases, notes, owner-назначения, audit). CRM владеет ими.
  - `DERIVED` — вычисляется в domain-слое CRM из PRODUCT/POCKET (signals, recommended actions, некоторые агрегаты).
- **Уровень чувствительности (Sensitivity):** `LOW` (операционные метки) · `MEDIUM` (учебные детали, masked email) · `HIGH` (точные финансовые суммы, реальный баланс) · `RESTRICTED` (никогда в CRM — postback secret, полный email/PII вне маскирования).
- Базовые типы: `type ISODateString = string; type UserId = string; type EmployeeId = string; type Money = { amountMinor: number; currency: 'USD'; }` (минорные единицы, чтобы избежать float-ошибок).
- Все временные поля — `ISODateString` (UTC).

---

## 1. CrmUser (агрегат)

**Назначение:** корневой агрегат пользователя в CRM — «шапка» User 360, собирающая ссылки на все под-модели. Не хранит бизнес-детали сам, а компонует их.

```ts
interface CrmUser {
  id: UserId;                       // внутренний id продукта
  identity: UserIdentity;
  state: UserStateProfile;          // 5 измерений (см. §3, STATE_MODEL.md) — заменяет прежний lifecycle
  progression: UserProgression;
  learning: UserLearningSummary;
  financial: UserFinancialSummary;
  pocket: PocketStatus;
  owner: UserOwner | null;
  entitlements: UserEntitlement[];
  activeSignals: UserSignal[];      // только status=active
  recommendedActions: RecommendedAction[];
  currentPriority: PriorityLevel;   // агрегированный приоритет для Today/списков
  lastMeaningfulActionAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;         // freshness самого агрегата
}

type PriorityLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';
```

- **Связи:** 1:1 identity/lifecycle/progression/learning/financial/pocket; 1:0..1 owner; 1:N signals, recommendedActions, entitlements; косвенно 1:N tasks/cases/notes/timeline (грузятся отдельными операциями).
- **Источник:** `DERIVED` (композиция), под-поля — свои источники.
- **Чувствительность:** `MEDIUM` (содержит вложенный `HIGH` financial — рендерится по правам).

---

## 2. UserIdentity

**Назначение:** идентификация и контактные данные в безопасном виде.

```ts
interface UserIdentity {
  userId: UserId;
  displayName: string;
  maskedEmail: string;              // напр. "a•••@g•••.com" — только masked
  emailConfirmed: boolean;
  country: string | null;           // ISO-3166, если доступно
  locale: string | null;
  registeredAt: ISODateString;
  externalRefs: {
    pocketLinked: boolean;
    // playerId/clickid НЕ хранятся в открытом виде; при необходимости — hashed ref
    pocketPlayerRef: string | null; // непрозрачная ссылка/hash, не сырой playerId
  };
}
```

- **Enum/status:** `emailConfirmed: boolean`.
- **Связи:** 1:1 с CrmUser.
- **Источник:** `PRODUCT`.
- **Чувствительность:** `MEDIUM` (masked email); полный email — `RESTRICTED`, в CRM не попадает.

---

## 3. UserStateProfile (заменяет прежнюю UserLifecycle)

**Назначение:** каноническая модель состояния пользователя из **5 ортогональных измерений**. Полное определение измерений, enum-значений и правил — в **STATE_MODEL.md** (источник правды). Здесь — контракт типов.

> **Phase 0.5:** прежний единый `UserLifecycle` mega-enum удалён (DECISIONS D-01). Пять измерений меняются независимо, поэтому пользователь может быть одновременно `active` + `funded` + `repeat_funder` + `inactive_7d` + `support_blocked` без потери информации.

```ts
interface UserStateProfile {
  userId: UserId;
  lifecycle: LifecycleState;                     // ровно 1, versioned (история обязательна)
  funding: DimensionState<FundingStatus>;        // ровно 1
  engagement: DimensionState<EngagementStatus>;  // ровно 1
  valueSegments: StateTag<ValueSegment>[];       // 0..N тегов
  blockers: StateTag<OperationalBlocker>[];      // 0..N тегов
}

// --- LifecycleStage: единственное versioned измерение с полной историей ---
interface LifecycleState {
  version: string;                  // версия правил, напр. "2026-07"
  current: LifecycleStage;
  enteredAt: ISODateString;
  previous: LifecycleStage | null;
  reasonCode: string;
  evidence: Evidence[];
  history: LifecycleTransition[];
  manualOverride: ManualOverride | null;
}
interface LifecycleTransition {
  from: LifecycleStage | null; to: LifecycleStage; at: ISODateString;
  reasonCode: string; evidence: Evidence[];
  source: 'system' | 'automation' | 'manual'; actorId: EmployeeId | null;
}
interface ManualOverride { by: EmployeeId; at: ISODateString; reason: string; expiresAt: ISODateString | null; }

// --- Обёртки для остальных измерений (обязаны нести evidence/reason/calculatedAt/expiresAt) ---
interface DimensionState<T extends string> {
  value: T; reasonCode: string; evidence: Evidence[];
  calculatedAt: ISODateString; expiresAt: ISODateString | null;
}
interface StateTag<T extends string> {
  tag: T; reasonCode: string; evidence: Evidence[];
  calculatedAt: ISODateString; expiresAt: ISODateString | null;
  status: 'active' | 'expired' | 'suppressed';
}

// --- Enum-значения (канон — STATE_MODEL.md) ---
type LifecycleStage =
  | 'registered' | 'pocket_registered' | 'pre_ftd' | 'first_depositor'
  | 'active' | 'at_risk' | 'dormant' | 'reactivated' | 'completed_current_curriculum';

type FundingStatus =
  | 'not_available' | 'unfunded' | 'funded'
  | 'checkpoint_grace' | 'financial_access_suspended' | 'balance_unknown';

type EngagementStatus =
  | 'not_started' | 'active' | 'progression_stalled'
  | 'inactive_3d' | 'inactive_7d' | 'dormant_14d' | 'dormant_30d' | 'returned';

type ValueSegment =
  | 'first_depositor' | 'repeat_funder' | 'frequent_repeat_funder'
  | 'high_value_candidate' | 'advanced_learner';

type OperationalBlocker =
  | 'email_unconfirmed' | 'pocket_registration_incomplete' | 'report_pending'
  | 'mentor_blocked' | 'support_blocked' | 'financial_data_conflict' | 'communication_fatigue';
```

- **Связи:** 1:1 CrmUser; изменения каждого измерения отражаются в UserTimelineEvent (source=lifecycle/signal).
- **Источник (DECISIONS D-02):** `LifecycleStage`, `ValueSegment`, `OperationalBlocker` — **CRM-owned** (операционный слой). `FundingStatus`/`EngagementStatus` — `DERIVED` из PRODUCT/POCKET-данных по правилам SIGNAL_CATALOG; CRM **не пересчитывает** balance/XP/checkpoint. Manual override lifecycle — `CRM`.
- **Чувствительность:** `LOW` (сами метки); evidence может ссылаться на HIGH — маскируется.

---

## 4. UserProgression

**Назначение:** положение в фиксированном curriculum: уровни, XP, блокировки.

```ts
interface UserProgression {
  userId: UserId;
  curriculumVersion: string;
  currentLevel: number;
  highestCompletedLevel: number;
  xp: number;                       // не списывается
  currentModule: string | null;
  nextLessonRef: string | null;
  nextCheckpoint: CheckpointRef | null;
  lockedReason: LockedReason | null;
  completionHistory: LevelCompletion[];
}

interface CheckpointRef {
  level: number;
  requiredBalance: Money | null;    // null для future_checkpoint_not_defined (DECISIONS D-10)
  status: CheckpointStatus;
}

interface LevelCompletion {
  level: number;
  completedAt: ISODateString;
  xpAtCompletion: number;
}

type CheckpointStatus =
  | 'not_reached' | 'approaching' | 'met' | 'grace' | 'suspended' | 'restored'
  | 'future_checkpoint_not_defined';   // после L100, суммы не заданы (DECISIONS D-10)

type LockedReason =
  | 'previous_level_incomplete' | 'insufficient_xp'
  | 'checkpoint_not_met' | 'financial_access_suspended' | 'none';
```

- **Связи:** 1:1 CrmUser; nextCheckpoint пересекается с UserFinancialSummary.
- **Источник:** `PRODUCT`.
- **Чувствительность:** `LOW` (XP/levels) — но requiredBalance/статус связан с `HIGH` контекстом.

---

## 5. UserLearningSummary

**Назначение:** свод учебной активности (уроки, тесты, reports, mentor review).

```ts
interface UserLearningSummary {
  userId: UserId;
  lessonsCompleted: number;
  testsPassed: number;
  testsFailed: number;
  lastAttempt: LearningAttempt | null;
  reports: ReportSummary;
  mentorReviews: MentorReviewSummary;
  rejectedAssignmentsCount: number;
  learningStreakDays: number;
  lastLearningActivityAt: ISODateString | null;
}

interface LearningAttempt {
  ref: string;
  type: 'test' | 'scenario' | 'practice';
  result: 'passed' | 'failed';
  at: ISODateString;
  attemptNo: number;
}

interface ReportSummary {
  pending: number;
  approved: number;
  rejected: number;
  lastSubmittedAt: ISODateString | null;
}

interface MentorReviewSummary {
  pending: number;
  slaAtRisk: number;
  lastReviewedAt: ISODateString | null;
}
```

- **Связи:** 1:1 CrmUser; питает mentor queue и сигналы (report_pending, repeated_test_failure).
- **Источник:** `PRODUCT`.
- **Чувствительность:** `MEDIUM`.

---

## 6. UserFinancialSummary

**Назначение:** финансовый профиль на основе Pocket-данных: баланс, депозиты, checkpoints. Самая чувствительная модель.

```ts
interface UserFinancialSummary {
  userId: UserId;
  realBalance: Money | null;        // подтверждённый real balance
  balanceFreshness: Freshness;      // ОБЯЗАТЕЛЬНО: когда обновлён
  firstDeposit: DepositRecord | null;
  redeposits: DepositRecord[];
  successfulWithdrawals: WithdrawalRecord[];
  netDeposits: Money;               // FTD + redeposits − successful withdrawals
  grossDeposits: Money;
  redepositCount: number;
  lastRedepositAt: ISODateString | null;
  nextCheckpoint: CheckpointRef | null;
  grace: GraceState | null;
  accessHistory: FinancialAccessEvent[];  // suspended/restored
}

interface Freshness {
  asOf: ISODateString;
  isStale: boolean;                 // старше порога → true
  confirmations: number;            // число подтверждений (для grace-логики)
}

interface DepositRecord { amount: Money; at: ISODateString; kind: 'ftd' | 'redeposit'; }
interface WithdrawalRecord { amount: Money; at: ISODateString; status: 'requested' | 'cancelled' | 'completed'; }

interface GraceState {
  startedAt: ISODateString;
  expiresAt: ISODateString;         // startedAt + 24h (v1)
  belowThresholdConfirmations: number;
  hasOpenTrades: boolean;           // при true решение откладывается
  checkpointLevel: number;
}

interface FinancialAccessEvent {
  type: 'suspended' | 'restored';
  at: ISODateString;
  reasonCode: string;
  checkpointLevel: number;
}
```

- **Enum/status:** withdrawal.status, access.type, checkpoint (в CheckpointRef).
- **Связи:** 1:1 CrmUser; grace/checkpoint связаны с UserProgression; события отражаются в Timeline.
- **Источник:** `POCKET` → `PRODUCT` → CRM (read-only). Никогда postback secret.
- **Чувствительность:** `HIGH` (точные суммы, real balance). Для ролей без права — маскируется в диапазоны/скрывается.

---

## 7. PocketStatus

**Назначение:** состояние связи с Pocket и техническая свежесть интеграции для конкретного пользователя.

```ts
interface PocketStatus {
  userId: UserId;
  connection: PocketConnectionState;
  lastEventAt: ISODateString | null;
  lastEventType: PocketEventType | null;
  tokenState: 'valid' | 'expired' | 'unknown';
  dataConflict: boolean;            // расхождение продукта и Pocket
}

type PocketConnectionState =
  | 'not_registered' | 'registration_pending' | 'registered';   // Pocket affiliate registration (registered = backend-confirmed)

type PocketEventType =
  | 'pocket_registration_confirmed' | 'pocket_email_confirmed'
  | 'first_deposit_confirmed' | 'redeposit_confirmed'
  | 'withdrawal_requested' | 'withdrawal_cancelled' | 'withdrawal_completed'
  | 'balance_update' | 'trade_opened' | 'trade_closed' | 'token_expired';
```

- **Связи:** 1:1 CrmUser; события маппятся в UserTimelineEvent (source=pocket).
- **Источник:** `POCKET` (через PRODUCT).
- **Чувствительность:** `MEDIUM` (сам факт), суммы событий — `HIGH`.

---

## 8. UserSignal

**Назначение:** временный, объяснимый индикатор состояния — не постоянный ярлык. Двигатель очередей и рекомендаций.

```ts
interface UserSignal {
  id: string;
  userId: UserId;
  type: SignalCode;                 // канон кодов — SIGNAL_CATALOG.md
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'resolved' | 'expired' | 'suppressed';
  reasonCode: string;
  evidence: Evidence[];
  recommendedActionRef: string | null;
  createdAt: ISODateString;
  expiresAt: ISODateString | null;
  resolvedAt: ISODateString | null;
}

type SignalCode =
  | 'registration_no_start' | 'pocket_registration_incomplete' | 'email_not_confirmed'
  | 'lesson_abandoned' | 'repeated_test_failure' | 'report_pending'
  | 'report_rejected_no_return' | 'mentor_sla_risk' | 'checkpoint_approaching'
  | 'checkpoint_grace_active' | 'financial_access_suspended' | 'balance_data_stale'
  | 'pocket_data_conflict' | 'inactive_3_days' | 'inactive_7_days'
  | 'dormant_14_days' | 'returned_after_absence' | 'communication_fatigue'
  | 'support_blocked' | 'frequent_redeposit_pattern' | 'rapid_balance_decline';
```

- **Связи:** N:1 CrmUser; 0..1 RecommendedAction; отражается в Timeline.
- **Источник:** `DERIVED` (правила CRM/продукта).
- **Чувствительность:** `LOW`–`MEDIUM` (evidence может ссылаться на HIGH-данные — рендерить осторожно).

---

## 9. RecommendedAction

**Назначение:** объяснимая следующая рекомендация по пользователю (для Today и User 360).

```ts
interface RecommendedAction {
  id: string;
  userId: UserId;
  actionType: RecommendedActionType;
  title: string;
  rationale: string;                // человекочитаемое «почему»
  basedOnSignals: string[];         // ids UserSignal
  evidence: Evidence[];
  priority: PriorityLevel;
  suggestedOwnerRole: string | null;
  suggestedDueAt: ISODateString | null;
  createdAt: ISODateString;
  expiresAt: ISODateString | null;
}

type RecommendedActionType =
  | 'create_task' | 'open_case' | 'assign_owner' | 'send_educational_note'
  | 'route_to_mentor' | 'route_to_support' | 'schedule_follow_up'
  | 'suppress_communication' | 'no_action_log_only';
```

- **Связи:** N:1 CrmUser; ссылается на UserSignal[]; при принятии порождает CrmTask/CrmCase.
- **Источник:** `DERIVED`.
- **Чувствительность:** `LOW`.

---

## 10. UserTimelineEvent

**Назначение:** единый элемент хронологии — нормализованное событие из любого источника для User 360 Timeline.

```ts
interface UserTimelineEvent {
  id: string;
  userId: UserId;
  at: ISODateString;
  source: TimelineSource;
  kind: string;                     // напр. 'lesson_completed', 'withdrawal_completed'
  title: string;
  summary: string | null;
  actorId: EmployeeId | null;       // если employee/automation
  relatedEntity: { type: EntityType; id: string } | null;
  evidence: Evidence[];
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
}

type TimelineSource =
  | 'product' | 'pocket' | 'employee' | 'communication'
  | 'automation' | 'lifecycle' | 'signal' | 'task' | 'case';

type EntityType =
  | 'user' | 'task' | 'case' | 'note' | 'signal'
  | 'communication' | 'automation_run' | 'lifecycle' | 'checkpoint';
```

- **Связи:** N:1 CrmUser; relatedEntity — к конкретной сущности.
- **Источник:** `DERIVED` (нормализация из всех источников).
- **Чувствительность:** per-event `sensitivity` (HIGH-события маскируются по правам).

---

## 11. CrmTask

**Назначение:** единица работы сотрудника.

```ts
interface CrmTask {
  id: string;
  title: string;
  type: string;                     // напр. 'retention_call', 'mentor_review'
  userId: UserId | null;
  caseId: string | null;
  owner: EmployeeId | null;
  createdBy: EmployeeId | 'automation';
  source: 'manual' | 'automation' | 'signal' | 'recommended_action';
  reasonCode: string;
  priority: PriorityLevel;
  status: TaskStatus;
  dueAt: ISODateString | null;
  completedAt: ISODateString | null;
  outcome: string | null;
  followUpAt: ISODateString | null;
  evidence: Evidence[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

type TaskStatus =
  | 'open' | 'in_progress' | 'waiting_user' | 'waiting_internal'
  | 'completed' | 'cancelled' | 'overdue';
```

- **Связи:** N:0..1 CrmUser; N:0..1 CrmCase; owner → сотрудник; отражается в Timeline и Audit.
- **Источник:** `CRM` (владеет).
- **Чувствительность:** `LOW`.

---

## 12. CrmCase

**Назначение:** контейнер сложной ситуации, объединяющий tasks/notes/timeline/SLA.

```ts
interface CrmCase {
  id: string;
  userId: UserId;
  type: CaseType;
  status: CaseStatus;
  priority: PriorityLevel;
  owner: EmployeeId | null;
  sla: { dueAt: ISODateString | null; breached: boolean } | null;
  reason: string;
  evidence: Evidence[];
  taskIds: string[];
  noteIds: string[];
  outcome: string | null;
  closingReason: string | null;
  openedAt: ISODateString;
  closedAt: ISODateString | null;
}

type CaseType =
  | 'retention' | 'mentor' | 'support' | 'checkpoint'
  | 'financial_data_conflict' | 'pocket_connection' | 'moderation'
  | 'identity' | 'communication' | 'safety';

type CaseStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed' | 'cancelled';
```

- **Связи:** N:1 CrmUser; 1:N tasks/notes; отражается в Timeline/Audit.
- **Источник:** `CRM`.
- **Чувствительность:** `LOW`–`MEDIUM` (financial/identity кейсы могут содержать HIGH-контекст).

---

## 13. CrmNote

**Назначение:** свободная заметка сотрудника по пользователю/кейсу.

```ts
interface CrmNote {
  id: string;
  userId: UserId | null;
  caseId: string | null;
  authorId: EmployeeId;
  body: string;
  visibility: 'team' | 'role_restricted' | 'private';
  pinned: boolean;
  createdAt: ISODateString;
  editedAt: ISODateString | null;
}
```

- **Связи:** N:0..1 CrmUser; N:0..1 CrmCase; автор → сотрудник.
- **Источник:** `CRM`.
- **Чувствительность:** `MEDIUM` (может содержать деликатный контекст; уважать visibility).
- **`pinned` (реализация 1B4-D):** `pinned` в самой записи — **базовое** значение (у fixture и authored заметок всегда `false`). Фактическое (effective) состояние закрепления НЕ хранится на заметке и не переписывается на ней: оно выводится единым резолвером `resolveEffectivePins` как `note.pinned` ⊕ последняя `note_pin_changed` audit-запись для `note.id` (по `at`, затем по audit id). Отдельного `notePins[]`/поля overlay нет — append-only audit-лог и есть состояние (D-77). Это единственный способ узнать pinned во всех note-reads; применяется до `sortNotes` (pinned-first). Мутация — `setNotePinned` (право `edit_user_notes`, D-75); закрепить можно любую **видимую** заметку, скрытая → `not_found` (D-76).
- **`visibility` (реализация 1B5-C):** ось `team | role_restricted | private`. Создаётся заметка только как `team` (D-54). Мутация `setNoteVisibility` меняет видимость **authored overlay-заметки** между `team` и `private` (право `edit_user_notes`, только автор — D-91); переписывает `visibility`+`updatedAt` на месте. `role_restricted` **не writable** — нет модели allowed-roles (D-91), остаётся readable-fail-closed. `private` — по **identity автора** (`canViewNote`: видит только `authorEmployeeId === actorId`), не по роли (D-92); канонический projector `projectNotes` убирает невидимую заметку до пагинации (в `page.total` она не входит). Смена видимости пишет `note_visibility_changed` в append-only audit; `AuditRecordView` направление team/private не раскрывает (D-94).
- **Удаление (реализация 1B6):** мутация `deleteNote` **физически удаляет** authored overlay-заметку из `notes[]` — **hard delete** (право `edit_user_notes`, только автор — D-96): tombstone/`deletedAt` в `CrmNote` не добавляется, тело в localStorage не остаётся, undo нет. Границы entity как у edit: фикстурная → `invalid_input`, чужая видимая → `unauthorized`, скрытая/неизвестная → `not_found`; private удаляется автором по тем же правилам. Пишет append-only `note_deleted` (старые записи заметки не трогает) — он **защитный источник истины** отсутствия: canonical `hideDeletedNotes` в `note-projection` скрывает заметку с валидным поздним delete-record (даже если corrupt/legacy overlay сохранил row), до пагинации (в `page.total` не входит); stale/corrupt delete-record не скрывает; фикстуру через нормальный путь скрыть нельзя (D-97). `AuditRecordView` для `note_deleted` несёт только факт, без тела/id (D-99).

---

## 14. UserOwner

**Назначение:** назначение **одного primary owner** на пользователя и история владения (DECISIONS D-08). Assignees задач и кейсов — отдельные поля (`CrmTask.owner`, `CrmCase.owner`) и **не** совпадают с primary owner по смыслу. Два одновременных primary owner запрещены.

```ts
interface UserOwner {
  userId: UserId;
  ownerId: EmployeeId;
  ownerRole: string;
  assignedAt: ISODateString;
  assignedBy: EmployeeId | 'automation';
  reasonCode: string;
  history: OwnerAssignment[];
}

interface OwnerAssignment {
  ownerId: EmployeeId;
  from: ISODateString;
  to: ISODateString | null;
  assignedBy: EmployeeId | 'automation';
  reasonCode: string;
}
```

- **Связи:** 1:1 текущий owner на CrmUser; 1:N история.
- **Источник:** `CRM`.
- **Реализация (Phase 1B4-C).** Полный `UserOwner` (с `ownerRole`/`assignedBy`/`reasonCode`/`history`) —
  будущая форма; mock хранит owner как скаляр `operations.primaryOwnerId` (baseline fixture), а изменения
  — как записи `primary_owner_changed` в mutation-overlay audit. **История и есть этот append-only лог**
  (D-65): отдельного `ownerAssignments[]` нет. Текущий effective owner = baseline, перекрытый последней
  такой записью (единственный resolver в провайдере, D-70). Мутация — `assignPrimaryOwner` (+ снятие через
  `ownerId: null`); `expectedOwnerId` защищает от потери обновления (D-72). Кандидаты — из canonical
  employee directory (`src/domain/identity/employees.ts`, D-67), ограничены владельцами baseline. Задача/
  кейс assignees (`CrmTask.owner`/`CrmCase.owner`) — отдельные поля, в 1B4-C синтетически производны от
  primary owner, самостоятельных мутаций не имеют.
- **Чувствительность:** `LOW`.

---

## 15. CommunicationRecord

**Назначение:** запись факта коммуникации пользователю (для истории и контроля fatigue).

```ts
interface CommunicationRecord {
  id: string;
  userId: UserId;
  channel: 'in_app' | 'email' | 'push' | 'other';
  templateRef: string;
  triggeredBy: 'automation' | 'manual';
  automationRunId: string | null;
  sentAt: ISODateString;
  outcomeWindow: { endsAt: ISODateString; outcome: string | null } | null;
  suppressed: boolean;
  suppressionReason: string | null;
}
```

- **Связи:** N:1 CrmUser; 0..1 AutomationRun; в Timeline (source=communication).
- **Источник:** `PRODUCT` (реальная отправка) / `CRM` (mock-история v1). CRM v1 **не отправляет** реально.
- **Чувствительность:** `MEDIUM`.

---

## 16. AutomationRun

**Назначение:** факт срабатывания правила автоматизации и его результат.

```ts
interface AutomationRun {
  id: string;
  ruleId: string;
  ruleName: string;
  userId: UserId | null;
  triggeredAt: ISODateString;
  conditionsSnapshot: Evidence[];
  action: RecommendedActionType;    // что сделало правило
  result: 'executed' | 'skipped_cooldown' | 'skipped_exclusion' | 'signal_only' | 'error';
  producedEntity: { type: EntityType; id: string } | null;
  outcomeWindow: { endsAt: ISODateString; outcome: string | null } | null;
}
```

- **Связи:** N:1 rule; N:0..1 CrmUser; producedEntity → task/case/communication; в Timeline (source=automation).
- **Источник:** `PRODUCT`/`CRM` (mock v1).
- **Чувствительность:** `LOW`.

---

## 17. UserEntitlement

**Назначение:** что пользователю сейчас доступно/заблокировано (учебный и финансовый доступ) — производное состояние доступа.

```ts
interface UserEntitlement {
  userId: UserId;
  key: EntitlementKey;
  state: 'granted' | 'locked' | 'suspended';
  reasonCode: string;
  sinceAt: ISODateString;
  expiresAt: ISODateString | null;
  evidence: Evidence[];
}

type EntitlementKey =
  | 'learning_access' | 'level_access' | 'post_checkpoint_access'
  | 'tool_unlock' | 'community_access';
```

- **Связи:** N:1 CrmUser; связан с UserProgression/Financial (grace/suspend).
- **Источник:** `PRODUCT` (истина по доступу) / `DERIVED`.
- **Чувствительность:** `LOW`.

---

## 18. AuditRecord

**Назначение:** неизменяемая запись действия (сотрудника или системы) для журнала Audit.

```ts
interface AuditRecord {
  id: string;
  at: ISODateString;
  actorId: EmployeeId | 'system' | 'automation';
  actorRole: string | null;
  action: string;                   // напр. 'task.create', 'owner.reassign'
  entity: { type: EntityType; id: string };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reasonCode: string | null;
  source: 'manual' | 'automation' | 'system';
  mock: boolean;                    // true на первой стадии
}
```

- **Связи:** ссылается на любую сущность; в User 360 — audit-preview.
- **Источник:** `CRM` (владеет; append-only).
- **Чувствительность:** `MEDIUM` (before/after могут содержать HIGH — хранить с осторожностью, маскировать в UI).
- **Реализация (1B4-A/C/D/E):** записанный `AuditRecord` — это **не** этот общий before/after-shape, а узкий **discriminated union** по `action`: `note_added` (entityType `note`), `primary_owner_changed` (entityType `user`, поля `previousOwnerId`/`nextOwnerId`), `note_pin_changed` (entityType `note`, поля `previousPinned`/`nextPinned`) и `note_body_changed` (entityType `note`, **только базовые поля** — без previous/next, без тела/фрагмента/длины/диффа: тело — авторский PII, запись фиксирует лишь ЧТО правка была, D-84). Каждая запись фиксирует **только факт** изменения; в неё не попадают тело заметки, PII, финансы, произвольный текст, idempotency-ключ, storage-ключ или диагностика (`reasonCode` — закрытый enum). Owner-история и effective pinned выводятся из этого лога — вторых структур нет (D-65/D-66/D-77). У `note_body_changed` `at` совпадает с новым `note.updatedAt`, что позволяет replay восстановить метаданные из записи (D-83). Audit UI и read endpoint не созданы.

---

## 19. Общий тип Evidence

**Назначение:** переиспользуемое основание для сигналов/переходов/рекомендаций — ядро объяснимости.

```ts
interface Evidence {
  kind: 'metric' | 'event' | 'threshold' | 'timestamp' | 'reference';
  label: string;                    // человекочитаемо
  value: string | number | null;
  observedAt: ISODateString;
  sourceRef: { type: EntityType | 'external'; id: string } | null;
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
}
```

Evidence никогда не содержит postback secret и не хранит сырой полный email/playerId.

---

## 20. Карта источников и чувствительности

| Сущность | Источник истины | Владелец записи | Чувствительность |
|---|---|---|---|
| CrmUser | DERIVED | — | MEDIUM |
| UserIdentity | PRODUCT | продукт | MEDIUM (full email = RESTRICTED) |
| UserStateProfile.lifecycle | **CRM** (D-02) | CRM | LOW |
| UserStateProfile.funding | DERIVED из POCKET→PRODUCT | продукт (данные) | LOW (метка) |
| UserStateProfile.engagement | DERIVED | CRM | LOW |
| UserStateProfile.valueSegments | **CRM** (D-02) | CRM | LOW |
| UserStateProfile.blockers | **CRM** (D-02) | CRM | LOW |
| UserProgression | PRODUCT | продукт | LOW |
| UserLearningSummary | PRODUCT | продукт | MEDIUM |
| UserFinancialSummary | POCKET→PRODUCT | продукт | HIGH |
| PocketStatus | POCKET→PRODUCT | продукт | MEDIUM/HIGH |
| UserSignal | DERIVED | CRM/продукт | LOW–MEDIUM |
| RecommendedAction | DERIVED | CRM | LOW |
| UserTimelineEvent | DERIVED | — | per-event |
| CrmTask | CRM | CRM | LOW |
| CrmCase | CRM | CRM | LOW–MEDIUM |
| CrmNote | CRM | CRM | MEDIUM |
| UserOwner | CRM | CRM | LOW |
| CommunicationRecord | PRODUCT/CRM | продукт/CRM | MEDIUM |
| AutomationRun | PRODUCT/CRM | продукт/CRM | LOW |
| UserEntitlement | PRODUCT/DERIVED | продукт | LOW |
| AuditRecord | CRM | CRM (append-only) | MEDIUM |

---

_Связано: DATA_PROVIDER_CONTRACT.md (операции над этими типами), ROLE_PERMISSION_MATRIX.md (кто видит HIGH), FUTURE_INTEGRATION.md (какие API их наполнят)._
