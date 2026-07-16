# DATA_PROVIDER_CONTRACT.md — Alfa Trade Academy CRM

> Phase 0 (обновлено в Phase 0.5) · Контракт `CrmDataProvider`. Единая граница между UI/domain-слоем и данными.
> `MockCrmDataProvider` (сейчас) и `ApiCrmDataProvider` (позже) реализуют **один и тот же** интерфейс — UI не переписывается.
> Статус: Draft для утверждения.
>
> **Phase 0.5:** фильтры переведены на 5-мерную модель состояний (STATE_MODEL.md); добавлены финансовые бакеты (D-07); `revealUserPii` добавлен в зарезервированные мутации (D-11); маскирование финансов/PII выполняется в domain-слое до отдачи в UI.

---

## 0. Общие соглашения

```ts
// Результат любой операции: единообразная оболочка с состоянием загрузки/устаревания.
interface Result<T> {
  data: T | null;
  status: 'ok' | 'loading' | 'stale' | 'empty' | 'error';
  freshness: { asOf: ISODateString; isStale: boolean } | null;
  error: CrmError | null;
}

interface Paginated<T> {
  items: T[];
  page: { cursor: string | null; nextCursor: string | null; total: number | null; pageSize: number };
}

interface CrmError {
  code: CrmErrorCode;
  message: string;
  retriable: boolean;
  details?: Record<string, unknown>;
}

type CrmErrorCode =
  | 'unauthorized'        // нет права (permission requirement не выполнен)
  | 'not_found'
  | 'invalid_input'
  | 'rate_limited'
  | 'upstream_unavailable'// будущий API/продукт недоступен
  | 'stale_data'          // данные есть, но устарели сверх порога
  | 'conflict'            // конфликт данных (напр. Pocket data conflict)
  | 'internal';

// Каждый вызов принимает контекст вызывающего сотрудника (для permission-проверки в domain-слое).
interface CrmContext {
  actorId: EmployeeId;
  role: string;           // одна из ролей ROLE_PERMISSION_MATRIX
  now: ISODateString;
}

// Общие параметры пагинации/сортировки.
interface PageParams { cursor?: string | null; pageSize?: number; }   // курсорная пагинация
interface SortParam<F extends string> { field: F; dir: 'asc' | 'desc'; }
```

**Общие принципы:**
- Пагинация — **курсорная** (стабильна при изменяющихся данных), с опциональным `total`.
- Все операции — read-only относительно продукта; мутации CRM (tasks/cases/notes) выносятся в отдельные `*Mutations` (вне обязательного минимума Phase 0, но контракт зарезервирован в §15).
- `status: 'stale'` + `data` вместе → UI показывает данные с бейджем «устарело».
- `unauthorized` возвращается, если `CrmContext.role` не проходит **permission requirement** операции (см. ROLE_PERMISSION_MATRIX.md). HIGH-поля маскируются в маппинге до отдачи, если у роли нет Exact financials.

```ts
interface CrmDataProvider {
  getTodayWorkspace(ctx: CrmContext, input: GetTodayInput): Promise<Result<TodayWorkspace>>;
  searchUsers(ctx: CrmContext, input: SearchUsersInput): Promise<Result<Paginated<UserListRow>>>;
  getUserById(ctx: CrmContext, input: { userId: UserId }): Promise<Result<CrmUser>>;
  getUser360(ctx: CrmContext, input: { userId: UserId }): Promise<Result<User360>>;  // Phase 1C, read-only (§3a)
  getUserTimeline(ctx: CrmContext, input: GetTimelineInput): Promise<Result<Paginated<UserTimelineEvent>>>;
  getUserTasks(ctx: CrmContext, input: GetUserTasksInput): Promise<Result<Paginated<CrmTask>>>;
  getUserCases(ctx: CrmContext, input: GetUserCasesInput): Promise<Result<Paginated<CrmCase>>>;
  getUserNotes(ctx: CrmContext, input: GetUserNotesInput): Promise<Result<Paginated<CrmNote>>>;
  getSegments(ctx: CrmContext, input: GetSegmentsInput): Promise<Result<Segment[]>>;
  getMentorQueue(ctx: CrmContext, input: GetQueueInput): Promise<Result<Paginated<MentorQueueItem>>>;
  getSupportQueue(ctx: CrmContext, input: GetQueueInput): Promise<Result<Paginated<SupportQueueItem>>>;
  getFinancialOperationsSummary(ctx: CrmContext, input: GetFinOpsInput): Promise<Result<FinancialOperationsSummary>>;
  getUserSignals(ctx: CrmContext, input: { userId: UserId; includeExpired?: boolean }): Promise<Result<UserSignal[]>>;
  getRecommendedActions(ctx: CrmContext, input: GetRecommendedInput): Promise<Result<RecommendedAction[]>>;
}
```

Ниже — по каждой операции: input, output, pagination, filters, sort, errors, loading/stale, permission.

---

## 1. getTodayWorkspace

- **Назначение:** собрать приоритезированный рабочий экран текущего сотрудника.
- **Input:**
  ```ts
  interface GetTodayInput { scope?: 'own' | 'team'; groups?: TodayGroupKey[]; }
  type TodayGroupKey =
    | 'today_tasks' | 'overdue' | 'no_progress' | 'mentor_sla' | 'support_blockers'
    | 'rejected_reports' | 'checkpoint_approaching' | 'checkpoint_grace'
    | 'suspended_access' | 'returned' | 'new_ftd' | 'repeat_funders'
    | 'communication_fatigue' | 'data_conflicts' | 'recommended_actions';
  ```
- **Output:** `TodayWorkspace { generatedAt; groups: TodayGroup[] }`, где `TodayGroup { key; title; priority; items: TodayItem[] }`, `TodayItem` содержит `userId, reason, evidence[], priority, recommendedAction, owner, dueAt, status`.
- **Pagination:** нет (ограничение сверху N на группу, напр. 50; «показать все» → соответствующий список).
- **Filters:** `scope`, `groups`.
- **Sort:** фикс. приоритет (critical→low), затем dueAt asc; внутри — по severity.
- **Errors:** `unauthorized, upstream_unavailable, stale_data, internal`.
- **Loading/stale:** тяжёлый агрегат → кэш с `freshness`; при stale отдаём данные + бейдж.
- **Permission:** View Today (все операционные роли; scope=team только manager/retention/admin).

---

## 2. searchUsers

- **Назначение:** поиск/фильтрация реестра пользователей для Users и состава Segments.
- **Input:**
  ```ts
  interface SearchUsersInput {
    query?: string;                 // по displayName / userId / masked email
    filters?: UserFilters;
    sort?: SortParam<UserSortField>;
    page?: PageParams;
    segmentId?: string;             // если из сегмента
  }
  interface UserFilters {
    // 5-мерная модель состояний (STATE_MODEL.md) — фильтр по каждому измерению независимо
    lifecycleStage?: LifecycleStage[];
    fundingStatus?: FundingStatus[];
    engagementStatus?: EngagementStatus[];
    valueSegment?: ValueSegment[];        // матчит пользователей, у кого ЛЮБОЙ из тегов
    blocker?: OperationalBlocker[];       // матчит пользователей, у кого ЛЮБОЙ из блокеров
    signals?: SignalCode[];               // см. SIGNAL_CATALOG.md
    ownerId?: EmployeeId[] | 'unassigned';
    pocket?: PocketConnectionState[];
    checkpointStatus?: CheckpointStatus[];
    balanceRange?: { minMinor?: number; maxMinor?: number };  // только при точных финансах
    balanceBucket?: FinancialBucket[];    // для ролей с бакетами (D-07)
    netDepositsRange?: { minMinor?: number; maxMinor?: number };
    lastActionBefore?: ISODateString;
    hasActiveCase?: boolean;
  }
  // Бакеты диапазонов (DECISIONS D-07)
  type FinancialBucket =
    | 'below_50' | '50_99' | '100_199' | '200_499' | '500_999'
    | '1000_2499' | '2500_4999' | '5000_9999' | '10000_plus';
  type UserSortField =
    | 'priority' | 'currentLevel' | 'xp' | 'lastMeaningfulActionAt'
    | 'realBalance' | 'netDeposits' | 'redepositCount' | 'lastContactAt';
  ```
- **Output:** `Paginated<UserListRow>`; `UserListRow` — плоская проекция колонок Users (см. IA §4), с уже **замаскированными** финансами, если у роли нет Exact financials.
- **Pagination:** курсорная (`page.cursor`), `pageSize` по умолч. 50, макс. 200.
- **Filters:** см. `UserFilters`. Финансовые фильтры/сорт по `realBalance/netDeposits` доступны только при Exact financials, иначе → `invalid_input` или игнор с предупреждением.
- **Sort:** `UserSortField` × dir.
- **Errors:** `unauthorized, invalid_input, upstream_unavailable, stale_data, internal`.
- **Loading/stale:** список кэшируется по (filters+sort+cursor); stale допустим.
- **Permission:** View Users. Финансовые сорт/фильтр — Exact financials.

---

## 3a. getUser360 (Phase 1C, read-only)

- **Назначение:** единственный read экрана User 360 (`/users/[id]`). Композирует derivation-слой и
  отдаёт **уже спроецированный под роль** агрегат одним результатом.
- **Input:** `{ userId: UserId }`.
- **Output:** `Result<User360>` (`src/domain/users/user-360.ts`): identity · attention
  (priority/reasonCode/evidence/sourceSignalCodes) · states (5 осей + registrationStatus) · learning ·
  financial (`FinancialProjection` + grace + freshness) · owner (+ SLA state) · signals ·
  recommendations (+ `allowedForRole`) · activity · `generatedAt`.
- **Pagination/Filters/Sort:** нет.
- **Errors:** `not_found` (неизвестный id, `retriable: false`), `unauthorized`,
  `upstream_unavailable`, `internal`.
- **Loading/stale:** `stale` + данные при устаревшем балансе; `freshness` от `Clock` провайдера.
- **Permission:** View User 360. Проекция выполняется **внутри провайдера** до отдачи в UI:
  identity — `projectIdentity(context: "detail")`; суммы — только `FinancialProjection`;
  балансо-производные пояснения и `nextCheckpointRequiredUsd` скрываются вместе с суммами
  (арифметическая утечка, D-36); HIGH-события не отдаются без Exact financials.
- **Почему отдельно от `getUserById`:** `getUserById` отдаёт `UserSummary` — плоскую **list**-проекцию
  (`context: "list"`, identity всегда masked), без learning/grace/SLA/сигналов/рекомендаций/событий.
  Композиция четырёх операций в UI означала бы сборку прав в React. См. DECISIONS D-35.
- **Мутаций нет:** операция read-only, мутирующего аналога в Phase 1C не существует.

---

## 3. getUserById

- **Назначение:** плоская проекция пользователя (используется списками). Для User 360 см. §3a.
- **Input:** `{ userId: UserId }`.
- **Output:** `Result<CrmUser>` (см. DOMAIN_MODEL §1). HIGH-поля внутри маскируются по роли.
- **Pagination:** нет.
- **Filters/Sort:** нет.
- **Errors:** `unauthorized, not_found, upstream_unavailable, stale_data, conflict, internal`. `conflict` — при Pocket data conflict (данные отдаются с флагом).
- **Loading/stale:** per-section freshness внутри `CrmUser` (financial.balanceFreshness и т.п.).
- **Permission:** View User 360; уровень детализации зависит от роли (mentor→learning, support→support-контекст).

---

## 4. getUserTimeline

- **Назначение:** единая хронология пользователя.
- **Input:**
  ```ts
  interface GetTimelineInput {
    userId: UserId;
    sources?: TimelineSource[];     // фильтр по типу источника
    kinds?: string[];
    from?: ISODateString; to?: ISODateString;
    page?: PageParams;              // pageSize по умолч. 50
  }
  ```
- **Output:** `Paginated<UserTimelineEvent>`, отсортировано по `at desc`.
- **Pagination:** курсорная по времени (`at` + id).
- **Filters:** `sources, kinds, from/to`.
- **Sort:** всегда `at desc` (v1 без опций).
- **Errors:** `unauthorized, not_found, upstream_unavailable, stale_data, internal`.
- **Loading/stale:** инкрементальная подгрузка; HIGH-события маскируются по роли.
- **Permission:** View User 360; отдельные HIGH-события скрываются без Exact financials.

---

## 5. getUserTasks

- **Input:**
  ```ts
  interface GetUserTasksInput {
    userId: UserId;
    status?: TaskStatus[]; type?: string[]; ownerId?: EmployeeId[];
    sort?: SortParam<'dueAt' | 'priority' | 'createdAt'>;
    page?: PageParams;
  }
  ```
- **Output:** `Paginated<CrmTask>`.
- **Pagination:** курсорная, pageSize 50.
- **Filters:** status/type/owner.
- **Sort:** dueAt|priority|createdAt.
- **Errors:** `unauthorized, not_found, invalid_input, internal`.
- **Loading/stale:** CRM-owned → обычно свежие; stale маловероятен.
- **Permission:** View Tasks (роль-скоуп: mentor/support видят свои типы).

---

## 6. getUserCases

- **Input:**
  ```ts
  interface GetUserCasesInput {
    userId: UserId;
    type?: CaseType[]; status?: CaseStatus[]; slaBreached?: boolean;
    sort?: SortParam<'openedAt' | 'priority' | 'slaDueAt'>;
    page?: PageParams;
  }
  ```
- **Output:** `Paginated<CrmCase>`.
- **Pagination:** курсорная, pageSize 50.
- **Filters:** type/status/slaBreached.
- **Sort:** openedAt|priority|slaDueAt.
- **Errors:** `unauthorized, not_found, invalid_input, internal`.
- **Loading/stale:** CRM-owned.
- **Permission:** View Cases; тип кейса фильтруется по роли (support→support, mentor→mentor, moderator→moderation).

---

## 7. getUserNotes

- **Input:**
  ```ts
  interface GetUserNotesInput {
    userId: UserId;
    includePrivate?: boolean;       // только автору/manager+
    page?: PageParams;
  }
  ```
- **Output:** `Paginated<CrmNote>`, `pinned` сверху, затем `createdAt desc`.
- **Pagination:** курсорная, pageSize 50.
- **Filters:** visibility по роли (`private` — только автор; `role_restricted` — по роли).
- **Sort:** pinned desc, createdAt desc.
- **Errors:** `unauthorized, not_found, internal`.
- **Loading/stale:** CRM-owned.
- **Permission:** View User 360; visibility соблюдается.

---

## 8. getSegments

- **Input:**
  ```ts
  interface GetSegmentsInput { kind?: 'system' | 'saved'; ownerId?: EmployeeId; }
  interface Segment { id; name; kind: 'system' | 'saved'; description; filter: UserFilters; count: number | null; countFreshness: Freshness | null; }
  ```
- **Output:** `Result<Segment[]>` (список описаний; состав — через `searchUsers({segmentId})`).
- **Pagination:** нет (список сегментов невелик).
- **Filters:** kind/owner.
- **Sort:** по имени (v1).
- **Errors:** `unauthorized, upstream_unavailable, stale_data, internal`.
- **Loading/stale:** `count` может быть stale (дорого считать) → `countFreshness`.
- **Permission:** View Segments (retention/analyst/manager/admin; read_only — просмотр).

---

## 9. getMentorQueue

- **Input:**
  ```ts
  interface GetQueueInput {
    scope?: 'own' | 'team';
    status?: string[]; priority?: PriorityLevel[]; slaAtRisk?: boolean;
    sort?: SortParam<'slaDueAt' | 'submittedAt' | 'priority'>;
    page?: PageParams;
  }
  interface MentorQueueItem { userId; reviewType; submittedAt; slaDueAt; attemptNo; priority; status; owner; evidence[]; }
  ```
- **Output:** `Paginated<MentorQueueItem>`.
- **Pagination:** курсорная, pageSize 50.
- **Filters:** status/priority/slaAtRisk/scope.
- **Sort:** slaDueAt asc (по умолч.), submittedAt, priority.
- **Errors:** `unauthorized, upstream_unavailable, stale_data, internal`.
- **Loading/stale:** очередь кэшируется коротко.
- **Permission:** Mentor Queue: mentor (own/team), manager/admin (team), retention (Limited view).

---

## 10. getSupportQueue

- **Input:** `GetQueueInput` (как §9).
  ```ts
  interface SupportQueueItem { userId; topic; channel; openedAt; slaDueAt; priority; status; owner; evidence[]; }
  ```
- **Output:** `Paginated<SupportQueueItem>`.
- **Pagination/Filters/Sort:** аналогично §9.
- **Errors:** `unauthorized, upstream_unavailable, stale_data, internal`.
- **Loading/stale:** короткий кэш.
- **Permission:** Support Queue: support (own/team), manager/admin (team), retention (Limited view). Финансы — только контекст, без Exact.

---

## 11. getFinancialOperationsSummary

- **Input:**
  ```ts
  interface GetFinOpsInput {
    section?: FinOpsSection[];       // какие блоки нужны
    from?: ISODateString; to?: ISODateString;
    aggregatedOnly?: boolean;        // для analyst — принудительно агрегаты
  }
  type FinOpsSection =
    | 'checkpoint_approaching' | 'checkpoint_grace' | 'access_suspended'
    | 'access_restored' | 'data_conflicts' | 'deposit_volumes';
  ```
- **Output:** `FinancialOperationsSummary { generatedAt; sections: {...} }` — списки пользователей по каждой секции (с freshness) + агрегаты (Net/Gross/Redeposit volume & count). Точные суммы только при Exact financials, иначе агрегаты/диапазоны.
- **Pagination:** секции с потенциально длинными списками поддерживают вложенный `Paginated`; сам summary — нет.
- **Filters:** section, from/to, aggregatedOnly.
- **Sort:** по приоритету/таймерам grace (asc).
- **Errors:** `unauthorized, upstream_unavailable, stale_data, conflict, internal`.
- **Loading/stale:** финансовые агрегаты кэшируются с явной freshness; stale помечается.
- **Permission:** Financial Ops View + Exact financials для точных сумм; analyst → aggregatedOnly enforced; support → нет (кроме контекста в User 360).

---

## 12. getUserSignals

- **Input:** `{ userId: UserId; includeExpired?: boolean }`.
- **Output:** `Result<UserSignal[]>` (по умолч. только `active`), сорт по severity desc, createdAt desc.
- **Pagination:** нет (сигналов на пользователя немного).
- **Filters:** `includeExpired`.
- **Sort:** severity, затем createdAt.
- **Errors:** `unauthorized, not_found, internal`.
- **Loading/stale:** DERIVED → freshness от последнего пересчёта.
- **Permission:** View User 360; evidence, ссылающийся на HIGH, маскируется без Exact financials.

---

## 13. getRecommendedActions

- **Input:**
  ```ts
  interface GetRecommendedInput { userId?: UserId; scope?: 'user' | 'today'; limit?: number; }
  ```
- **Output:** `Result<RecommendedAction[]>` — для одного пользователя или для Today-скоупа, сорт по priority desc.
- **Pagination:** `limit` (по умолч. 20).
- **Filters:** scope/userId.
- **Sort:** priority desc, затем suggestedDueAt asc.
- **Errors:** `unauthorized, not_found, upstream_unavailable, internal`.
- **Loading/stale:** DERIVED; freshness от пересчёта сигналов.
- **Permission:** View соответствующего раздела; suggestedOwnerRole учитывает роль вызывающего.

---

## 14. Сводная таблица permission requirement

| Операция | Мин. право | Особое |
|---|---|---|
| getTodayWorkspace | View Today | scope=team → manager/retention/admin |
| searchUsers | View Users | fin-сорт/фильтр → Exact financials |
| getUserById | View User 360 | плоская list-проекция |
| getUser360 | View User 360 | вся проекция внутри провайдера; балансо-производные пояснения скрыты без Exact financials (D-36) |
| getUserTimeline | View User 360 | HIGH-события маскируются |
| getUserTasks | View Tasks | скоуп по типу задачи |
| getUserCases | View Cases | тип кейса по роли |
| getUserNotes | View User 360 | private/role visibility |
| getSegments | View Segments | — |
| getMentorQueue | Mentor Queue | mentor/manager/admin/retention(L) |
| getSupportQueue | Support Queue | support/manager/admin/retention(L) |
| getFinancialOperationsSummary | Financial Ops View | точные суммы → Exact financials; analyst → aggregated |
| getUserSignals | View User 360 | evidence маскируется |
| getRecommendedActions | View раздела | — |

---

## 15. Зарезервировано (вне обязательного минимума Phase 0)

Мутации CRM понадобятся для интерактива, но не входят в 13 обязательных операций. Контракт фиксируется заранее, чтобы UI не переписывался:

```ts
interface CrmMutations {
  createTask; updateTask; createCase; updateCase; addNote;
  assignPrimaryOwner;          // один primary owner на пользователя (D-08); история сохраняется
  assignTaskAssignee; assignCaseAssignee;  // отдельные assignees (D-08)
  resolveSignal; acceptRecommendedAction;
  revealUserPii;               // PII reveal-flow (D-11): reason code → AuditRecord → autoHideAt
  // все → пишут AuditRecord{mock:true} на Phase 0; реально исполняются позже через API
}
```

Каждая мутация: idempotency-ключ, permission requirement, evidence/reasonCode, возвращает обновлённую сущность + AuditRecord. `revealUserPii` дополнительно возвращает `autoHideAt` (см. PII_ACCESS_POLICY.md). На Phase 0.5/mock мутации пишутся в localStorage overlay (D-09), исходные фикстуры неизменяемы.

---

_Связано: CRM_DOMAIN_MODEL.md (типы), ROLE_PERMISSION_MATRIX.md (права), MOCK_DATA_PLAN.md (чем наполняет MockCrmDataProvider), FUTURE_INTEGRATION.md (ApiCrmDataProvider)._
