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
- Все read-операции `CrmDataProvider` — read-only относительно продукта; мутации CRM живут в отдельном контракте `CrmMutations` (§15). Реализованы `addNote` (1B4-A), `assignPrimaryOwner` (1B4-C), `setNotePinned` (1B4-D), `updateNoteBody` (1B4-E), `setNoteVisibility` (1B5-C) и `deleteNote` (1B6); остальные зарезервированы, но методов-заглушек не имеют. Phase 1B4-C добавил read `getPrimaryOwnerCandidates` (§3b); Phase 1B4-E — read `getUserNotesView` (`CrmNoteListItem` с provider-owned `canEditBody`, +`canChangeVisibility` в 1B5-C, +`canDelete` в 1B6); Phase 1B5-B — read `getAuditRecords` (§3c, provider-owned safe `AuditRecordView`).
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
  getPrimaryOwnerCandidates(ctx: CrmContext): Promise<Result<PrimaryOwnerCandidate[]>>;  // Phase 1B4-C (§3b)
  getAuditRecords(ctx: CrmContext, input: GetAuditRecordsInput): Promise<Result<Paginated<AuditRecordView>>>;  // Phase 1B5-B (§3c)
}
```

Ниже — по каждой операции: input, output, pagination, filters, sort, errors, loading/stale, permission.

---

## 1. getTodayWorkspace

**Реализовано (Phase 1B3, read-only).** Модель живёт в домене (`domain/today/today.ts`) и
ре-экспортируется контрактом — так же, как `User360`. Подробности: `docs/TODAY_WORKSPACE.md`.

> **Форма Phase 1A удалена (D-50).** Прежний `TodayGroupKey` (`today_tasks`, `no_progress`,
> `new_ftd`, …) никогда не соответствовал тому, что производил builder: провайдер приводил
> `key: q.code as never`, т.е. контракт документировал форму, которую никто не возвращал.

- **Назначение:** собрать приоритезированную очередь внимания на текущую смену.
- **Input:**
  ```ts
  type GetTodayInput = TodayQuery;
  interface TodayQuery { filters?: TodayFilters; sort?: TodaySortField; }
  interface TodayFilters {
    priority?: PriorityBand[];
    basis?: TodayBasisCode[];      // тип основания (13 кодов config/queues.ts)
    section?: TodaySectionKey[];
    ownerId?: EmployeeId[] | 'unassigned';
    sla?: SlaState[];
    query?: string;                // только по РАЗРЕШЁННОЙ identity-проекции
  }
  type TodaySortField = 'urgency' | 'last_activity' | 'owner';
  ```
  `scope: 'own' | 'team'` **намеренно отсутствует** — mock-сессия даёт всем ролям один
  `emp_mock_admin`, поэтому «моя очередь» всегда была бы пуста (D-44).
- **Output:** `TodayWorkspace { generatedAt; role; sections: TodayQueueSection[]; summary;
  filterOptions; freshness; window; hasCalmUsers }`.
  `TodayQueueSection { key; title; hint; items: TodayQueueItem[] }` — только непустые секции.
  `TodayQueueItem { userId, identity, section, priority, priorityReasonCode, basis,
  additionalBasisCodes, recommendation, ownerId, due, lastActivityAt, todayEvent, evidence,
  financial }`.
- **Проекция:** результат **уже спроецирован** для `ctx.role` — точная сумма, балансо-производный
  процент и полный email для роли без прав **не строятся вовсе** (D-46, D-49). React не вычисляет
  права, не пересчитывает приоритет и не решает состав очереди.
- **Членство:** только при наличии attention-основания; ценностные сегменты его не дают (D-43).
- **Grouping:** один canonical placement rule → пользователь ровно в одной секции.
- **Pagination:** нет — очередь целиком; объём ограничен самим основанием.
- **Filters:** см. выше; опции (`filterOptions`) строит провайдер из реальной очереди роли,
  поэтому контрол не предлагает значения, которое вернёт пусто.
- **Sort:** внутри секций; `urgency` по умолчанию (доменный `comparePriority`), детерминированно.
- **Errors:** `unauthorized, upstream_unavailable, stale_data, internal`.
- **Loading/stale:** `freshness.ageMinutes` считает **провайдер против своего Clock**; при stale
  отдаются данные + баннер, очередь остаётся доступной (D-47).
- **Permission:** View Today — секция видна всем 9 ролям; различается **проекция полей**, не состав.

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

## 3b. getPrimaryOwnerCandidates (Phase 1B4-C, read-only)

- **Назначение:** сотрудники, которых можно назначить primary owner — источник опций для owner-picker на User 360.
- **Input:** только `ctx`.
- **Output:** `Result<PrimaryOwnerCandidate[]>`, `PrimaryOwnerCandidate { employeeId; displayName }`.
- **Permission:** Assign — `canAssignOwner(ctx.role)`. Роли без Assign получают **`unauthorized`**, а не пустой список: пустой список утверждает «некого назначить» — другое и неверное. UI запрещённых ролей операцию не вызывает вовсе (D-68).
- **Почему отдельно от `getUser360`:** список не про конкретного пользователя (один для всех), складывать его в агрегат — перечитывать профиль ради выпадающего списка. **Текущий** owner остаётся в `getUser360` (D-35). Mock берёт список из canonical employee directory (D-67); role/email/team/нагрузка/финансы **не** возвращаются.

---

## 3c. getAuditRecords (Phase 1B5-B, read-only)

- **Назначение:** глобальный Audit Workspace (`/audit`) — read существующих browser-local mutation-overlay audit-записей.
- **Input:** `GetAuditRecordsInput { page?: PageParams }`. Только pagination — фильтров/поиска/date range/actor/user-filter нет (D-89).
- **Output:** `Result<Paginated<AuditRecordView>>`. `AuditRecordView` — provider-owned safe discriminated union (`domain/audit/audit-view`): `note_added` / `primary_owner_changed` (+`previousOwnerName`/`nextOwnerName`) / `note_pin_changed` (+`pinned` из `nextPinned`) / `note_body_changed`; каждая несёт `id, action, at, actorName, targetUserName, mock`. Сырой `AuditRecord` в UI **не** попадает: нет raw employee/note/user id, тела/фрагмента, email/телефона/финансов, idempotency key, reasonCode, storage diagnostics. `id` — только React key и tie-break.
- **Порядок операций (§1 плана фазы):** `canViewAudit(ctx.role)` → `unauthorized` при false (**до** чтения overlay) → read overlay → project → sort → paginate.
- **Sort:** canonical `sortAuditRecords` — `at` DESC, затем `id` DESC как стабильный tie-break; на копии, без мутации append-only массива, без опоры на позицию в `overlay.auditRecords`.
- **Имена:** actor/owner через `ownerLabel` (unknown → «Неизвестный сотрудник», null owner → «Не назначен»), target через dataset display name (unknown → «Неизвестный пользователь»). Raw id никогда не fallback.
- **Pagination:** page size 20, newest first, `total` в `page`.
- **Permission:** **`canViewAudit(ctx.role)`** — единственный data-gate; данные только у crm_admin/crm_manager, остальные → `unauthorized` без чтения/выдачи (D-86).
- **Errors/loading:** corrupt overlay → fail-closed `empty` (parser отдаёт пустой overlay); storage failure (`gate`/errorMode) → `upstream_unavailable` (retriable) → локализованный error-state с retry; raw `CrmError.message` в DOM не рендерится (D-88).

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
- **Filters:** `sources`, `from/to`. (`kinds` — зарезервировано, не реализовано.)
- **`from` / `to` — реализовано (Phase 1B3, D-41).** Обе границы **включительные**: событие ровно
  на `from` или ровно на `to` возвращается. Сравнение по epoch ms, не по строке, — `…T09:00:00Z` и
  `…T09:00:00.000Z` обозначают один момент. Порядок конвейера: **projection → sources → range →
  paginate**, поэтому окно сужает уже спроецированный список и `page.total` считает только то, что
  роли разрешено видеть; limit применяется **после** фильтра. Пустое окно → `empty`.
  `from > to` → `invalid_input` (`retriable: false`) через `Result`, без throw в UI: пустая
  страница скрыла бы ошибку вызывающего за правдоподобными данными. Проверка идёт **до** поиска
  пользователя, поэтому ответ одинаков для существующего и несуществующего id.
  Ранее фильтры были объявлены в контракте, но игнорировались реализацией.
- **Sort:** всегда `at desc` (v1 без опций).
- **Errors:** `unauthorized, not_found, upstream_unavailable, stale_data, internal`.
  Неизвестный пользователь возвращает **пустую страницу** (`empty`), а не ошибку.
- **Loading/stale:** инкрементальная подгрузка.
- **Permission:** View User 360. **Реализовано (Phase 1C.1, D-39):** проекция выполняется внутри
  провайдера через canonical projector `domain/users/user-timeline.ts` — тот же, что использует
  `getUser360`, поэтому обе операции не могут разойтись в правилах видимости. События с
  `sensitivity: "HIGH"` (подтверждённые депозиты) **не отдаются** ролям без Exact financials;
  скрытие тихое (плейсхолдер не выводится). Инвариант: ни одно поле события не содержит суммы —
  событие несёт только факт и время, поэтому скрытое событие нельзя восстановить.
  Ранее операция принимала контекст как `_ctx` и игнорировала его.

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
    page?: PageParams;
  }
  ```
- **Output:** `Paginated<CrmNote>`, `pinned` сверху, затем `createdAt desc`, затем `id` (устойчивый tie-break).
- **Pagination:** курсорная, pageSize 50.
- **Filters:** visibility по актору — единый canonical projector (см. ниже).
- **Sort:** pinned desc, createdAt desc, id asc.
- **Errors:** `unauthorized, not_found, internal`.
- **Loading/stale:** CRM-owned.
- **Permission:** View User 360 (все 9 ролей по матрице §2) — отказа на уровне роли нет, видимость решается **на каждой заметке**.

**Модель.** `CrmNote` живёт в домене (`@/domain/notes/note`) и ре-экспортируется контрактом — как `TodayWorkspace` и `User360`. Поля: `id, userId, caseId, authorEmployeeId, body, visibility, pinned, createdAt, updatedAt, mock: true`.

**Приватность (Phase 1B4-A, D-55).** `ctx` больше **не игнорируется**. Единственный источник правила — `domain/notes/note-projection.ts`; проекция идёт **до пагинации**:

| visibility | Правило |
|---|---|
| `team` | видна всем 9 ролям |
| `private` | **только автору** (`authorEmployeeId === ctx.actorId`) |
| `role_restricted` | **скрыта всегда** — в модели нет metadata о разрешённых ролях |

- `includePrivate` **убран из описания входа**: в коде его никогда не было, а его комментарий («автору/manager+») противоречил строке Filters («только автор») — документ описывал флаг, которого нет, да ещё и с двумя несовместимыми правилами. Флаг не нужен: приватное отдаётся автору и так, а расширить это до manager+ на основании противоречия нельзя (D-55).
- Скрытая заметка **удаляется, а не заменяется плейсхолдером**, и **не входит в `page.total`**: строка «скрыто» раскрыла бы факт существования записи.
- Выдача объединяет fixture-generated и overlay-заметки (docs/MUTATION_OVERLAY.md) и детерминирована.
- **Единственный путь чтения заметок.** С Phase 1B4-B его потребляет секция «Заметки» на User 360 —
  отдельным вызовом, **не** через `getUser360` (D-58): правило видимости здесь на каждой заметке, и
  второй читатель обязан был бы либо продублировать projector, либо перефильтровать агрегат. React
  полученный список не фильтрует и не сортирует.
- **Первая страница без пагинации:** UI запрашивает `pageSize: 50` и контрола «ещё» не имеет (D-58).

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
| getTodayWorkspace | View Today (все 9 ролей) | различается проекция полей, не состав очереди; `scope` не реализован (D-44) |
| searchUsers | View Users | fin-сорт/фильтр → Exact financials |
| getUserById | View User 360 | плоская list-проекция |
| getUser360 | View User 360 | вся проекция внутри провайдера; балансо-производные пояснения скрыты без Exact financials (D-36) |
| getUserTimeline | View User 360 | HIGH-события маскируются |
| getUserTasks | View Tasks | скоуп по типу задачи |
| getUserCases | View Cases | тип кейса по роли |
| getUserNotes | View User 360 | ctx-aware: `team` всем; `private` — только автору; `role_restricted` — скрыта всегда (D-55); скрытые не входят в `total` |
| getSegments | View Segments | — |
| getMentorQueue | Mentor Queue | mentor/manager/admin/retention(L) |
| getSupportQueue | Support Queue | support/manager/admin/retention(L) |
| getFinancialOperationsSummary | Financial Ops View | точные суммы → Exact financials; analyst → aggregated |
| getUserSignals | View User 360 | evidence маскируется |
| getRecommendedActions | View раздела | — |
| getPrimaryOwnerCandidates | Assign (`canAssignOwner`) | иначе `unauthorized`, не пустой список (D-68) |
| getAuditRecords | **`canViewAudit`** (crm_admin/crm_manager) | единственный data-gate; иначе `unauthorized` без чтения overlay; safe `AuditRecordView` (D-86/D-87) |

---

## 15. `CrmMutations` — мутации

Мутации живут в **отдельном контракте** `src/data/contracts/CrmMutations.ts`, не в `CrmDataProvider`.
`MockCrmDataProvider` реализует оба (`implements CrmDataProvider, CrmMutations`), без приведений типов.

### 15.1 Реализовано (Phase 1B4-A)

```ts
interface CrmMutations {
  addNote(ctx: CrmContext, command: AddNoteCommand): Promise<Result<AddNoteResult>>;
}

interface AddNoteCommand { userId: UserId; body: string; idempotencyKey: string; }
interface AddNoteResult  { note: CrmNote; audit: AuditRecord; replayed: boolean; }
```

- **Permission:** Edit → notes — `crm_admin`, `crm_manager`, `retention_manager`, `support` (D-53). Проверяется по `ctx`, не по команде.
- **Actor и visibility в команду не входят:** actor — только из доверенного `CrmContext`; новая заметка всегда `team` (D-54).
- **Errors:** `invalid_input` (пустое/длинное тело >2000, отсутствующий/длинный >200 ключ), `not_found` (нет пользователя), `unauthorized` (нет права — код `forbidden` не заводился, D-56), `conflict` (ключ переиспользован для другой команды), `internal` (overlay не записался).
- **Idempotency:** тот же ключ + тот же нормализованный payload → исходный результат, `replayed: true`, без дублей. Тот же ключ + другой `userId`/`body`/actor → `conflict`.
- **Детерминизм:** id и timestamp выводятся из персистентного `sequence`; ни `Math.random()`, ни `Date.now()` (D-57).
- **AuditRecord** пишется всегда при успехе и **не содержит тела заметки** (ROLE_PERMISSION_MATRIX §4.2.6).

**Потребитель (Phase 1B4-B).** `addNote` вызывается из inline-композера секции «Заметки» на User 360.
Мутирующий контракт достаётся через `getCrmMutations()` — **тот же** закэшированный объект, что отдаёт
`getCrmDataProvider()`, без приведений типов: провайдер владеет одним overlay-адаптером, и второй
инстанс означал бы второй адаптер над тем же storage. `CrmError.message` — диагностика для
разработчика и в UI не рендерится (D-62). Подробности: D-58…D-63.

Подробности: **docs/MUTATION_OVERLAY.md**.

### 15.1a Реализовано (Phase 1B4-C) — `assignPrimaryOwner`

```ts
interface CrmMutations {
  assignPrimaryOwner(ctx: CrmContext, command: AssignPrimaryOwnerCommand): Promise<Result<AssignPrimaryOwnerResult>>;
}
interface AssignPrimaryOwnerCommand { userId: UserId; ownerId: EmployeeId | null; expectedOwnerId: EmployeeId | null; idempotencyKey: string; }
interface AssignPrimaryOwnerResult  { userId: UserId; ownerId: EmployeeId | null; audit: AuditRecord; replayed: boolean; }
```

- **Permission:** Assign (§1, §5) — `crm_admin`, `crm_manager`, `retention_manager`. Проверяется по `ctx` через `canAssignOwner`; матрица **не расширена** (право `assign_owner` есть с Phase 1A). `support` пишет заметки, owner не назначает (Edit ≠ Assign, D-53).
- **`ownerId: null`** — снятие owner, first-class. **`expectedOwnerId`** — оптимистичная конкуренция без поля версии: расхождение с текущим effective owner → `conflict` (D-72). Scope `own/team/all` не моделируется (D-69, тот же довод, что D-44).
- **Errors:** `invalid_input` (ключ; owner не из кандидатов), `not_found`, `unauthorized`, `conflict` (переиспользование ключа / `expectedOwnerId` не совпал), `internal`. Порядок: `invalid_input → not_found → unauthorized → conflict → write`.
- **История** — записи `primary_owner_changed` в audit (D-65); отдельного `ownerAssignments[]` нет. Подробности — **docs/MUTATION_OVERLAY.md** §§ (1B4-C).

Плюс узкая **read-операция** контракта (§3b ниже): `getPrimaryOwnerCandidates`.

### 15.1b Реализовано (Phase 1B4-D) — `setNotePinned`

```ts
interface CrmMutations {
  setNotePinned(ctx: CrmContext, command: SetNotePinnedCommand): Promise<Result<SetNotePinnedResult>>;
}
interface SetNotePinnedCommand { userId: UserId; noteId: string; pinned: boolean; expectedPinned: boolean; idempotencyKey: string; }
interface SetNotePinnedResult  { note: CrmNote; audit: AuditRecord; replayed: boolean; }
```

- **Permission:** Edit → notes — `canEditUserNotes` (D-75). Pin — это редактирование заметки, а не новое право; матрица **не расширена**. Те же четыре роли, что и `addNote`.
- **Любая видимая заметка** pinnable (fixture/authored/`private` автору); поиск идёт через тот же canonical projector, что и чтение, поэтому скрытая заметка и несуществующая дают один `not_found` (D-76) — API не зонд.
- **Конечное состояние `pinned` + `expectedPinned`** (D-78): `pinned === expectedPinned` → `invalid_input` (нет изменения); рассинхрон `expectedPinned` с текущим effective → `conflict`.
- **Errors:** `invalid_input` (ключ, пустой `noteId`, no-change), `not_found` (user/note/видимость), `unauthorized`, `conflict`, `internal`. Порядок: `invalid_input → not_found → unauthorized → idempotency → expectedPinned → write`.
- **Effective pinned** = `note.pinned` (всегда `false`), перекрытый последней записью `note_pin_changed` для `note.id` — единый резолвер `resolveEffectivePins`, ДО `sortNotes` (D-77). Ни fixture, ни overlay-заметка не мутируются; отдельного `notePins[]` нет. Receipt-kind `note_pin_change`. Подробности — **docs/MUTATION_OVERLAY.md** §§ (1B4-D).

### 15.1c Реализовано (Phase 1B4-E) — `updateNoteBody`

```ts
interface CrmMutations {
  updateNoteBody(ctx: CrmContext, command: UpdateNoteBodyCommand): Promise<Result<UpdateNoteBodyResult>>;
}
interface UpdateNoteBodyCommand { userId: UserId; noteId: string; body: string; expectedUpdatedAt: string; idempotencyKey: string; }
interface UpdateNoteBodyResult  { noteId: string; updatedAt: string; audit: AuditRecord; replayed: boolean; }
```

- **Permission:** Edit → notes — `canEditUserNotes`. Редактирование заметки — не новое право; матрица **не расширена**. Те же четыре роли. **Строже pin**: только автор своей overlay-заметки (`authorEmployeeId === actorId`), иначе `unauthorized` даже у роли с правом (D-82).
- **Только authored overlay-заметки** редактируемы. Фикстурная (видимая, но не в `notes[]`) → `invalid_input`, НЕ `not_found` (визуально присутствует). Скрытая/несуществующая → `not_found` (не зонд).
- **Result без `CrmNote` и без тела** — только id + timestamp правки (= `note.updatedAt` = `audit.at`); replay реконструирует метаданные из audit-записи (D-83/D-84).
- **Конкуренция `expectedUpdatedAt`** (D-83): правка переписывает `notes[]` на месте (только `body`+`updatedAt`), поэтому `updatedAt` — настоящий version-токен; mismatch → `conflict`. Replay проверяется ДО предусловия.
- **Errors:** `invalid_input` (ключ, тело empty/whitespace/too_long, `expectedUpdatedAt` не-ISO, no-change, фикстурная), `not_found` (user/note/видимость), `unauthorized` (роль или чужой автор), `conflict`, `internal`. Полный порядок и fingerprint/receipt — **docs/MUTATION_OVERLAY.md** §§ (1B4-E).
- **Возможность provider-owned:** read `getUserNotesView` возвращает `CrmNoteListItem { note, capabilities: { canEditBody, canChangeVisibility } }`; React не разбирает id (D-82/D-92). Плоский `getUserNotes` не изменён.

### 15.1d Реализовано (Phase 1B5-C) — `setNoteVisibility`

```ts
interface CrmMutations {
  setNoteVisibility(ctx: CrmContext, command: SetNoteVisibilityCommand): Promise<Result<SetNoteVisibilityResult>>;
}
interface SetNoteVisibilityCommand { userId: UserId; noteId: string; visibility: "team" | "private"; expectedUpdatedAt: string; idempotencyKey: string; }
interface SetNoteVisibilityResult  { noteId: string; updatedAt: string; audit: AuditRecord; replayed: boolean; }
```

- **Permission:** Edit → notes — `canEditUserNotes`; смена видимости своей заметки — не новое право, матрица **не расширена** (D-91). Те же четыре роли. **Как `updateNoteBody`**: только автор своей overlay-заметки (`authorEmployeeId === actorId`), иначе `unauthorized`.
- **Только team ↔ private.** `role_restricted` и любое неизвестное значение → `invalid_input` — нет модели allowed-roles, не writable (D-91).
- **Private — по identity актора, не по роли (D-92):** private-заметку видит только автор; смена роли при том же `actorEmployeeId` её не скрывает; другой сотрудник (включая admin) не видит. Возможность — `getUserNotesView.capabilities.canChangeVisibility`.
- **Result без `CrmNote`/тела/visibility-read-model** — только id + timestamp (= `note.updatedAt` = `audit.at`, D-83/D-84).
- **Конкуренция `expectedUpdatedAt`** (D-93): переписывает `notes[]` на месте (только `visibility`+`updatedAt`); mismatch → `conflict`; replay ДО предусловия. Аудит `note_visibility_changed` несёт `previousVisibility`/`nextVisibility` ∈ {team,private}, но `AuditRecordView` их **не** раскрывает (D-94).
- **Errors:** `invalid_input` (ключ, visibility не team/private, `expectedUpdatedAt` не-ISO, no-change, фикстурная), `not_found` (user/note/видимость), `unauthorized` (роль или чужой автор), `conflict`, `internal`. Полный порядок/fingerprint/receipt — **docs/MUTATION_OVERLAY.md** §§ (1B5-C).

### 15.1e Реализовано (Phase 1B6) — `deleteNote`

```ts
interface CrmMutations {
  deleteNote(ctx: CrmContext, command: DeleteNoteCommand): Promise<Result<DeleteNoteResult>>;
}
interface DeleteNoteCommand { userId: UserId; noteId: string; expectedUpdatedAt: string; idempotencyKey: string; }
interface DeleteNoteResult  { noteId: string; deletedAt: string; audit: AuditRecord; replayed: boolean; }
```

- **Permission:** Edit → notes — `canEditUserNotes`; удаление — не новое право, матрица **не расширена** (D-96). Те же четыре роли. Только автор своей overlay-заметки (`authorEmployeeId === actorId`), иначе `unauthorized`; фикстурная → `invalid_input`; скрытая/неизвестная → `not_found`. Private удаляется автором по тем же правилам.
- **Hard delete (D-96):** row физически убирается из `notes[]`; tombstone/тело не остаётся; undo нет. Append-only `note_deleted` audit — защитный источник истины: canonical `hideDeletedNotes` скрывает заметку с валидным поздним delete-record до пагинации (D-97).
- **Replay ДО entity-lookup (D-98):** порядок — ключ → ISO `expectedUpdatedAt` → noteId → fingerprint `[userId,actorId,role,noteId]` → **replay(receipt)** → user → видимость → роль → фикстурная → автор → `expectedUpdatedAt` → атомарный write. Retry после успешного удаления replay-ится, а не `not_found`. Повтор исходного `addNote` ключа после удаления не воскрешает заметку (D-98).
- **Result без `CrmNote`/тела** — только `noteId` + `deletedAt` (= `audit.at`, D-98) + audit + replayed.
- **Errors:** `invalid_input` (ключ, `expectedUpdatedAt` не-ISO, пустой noteId, фикстурная/non-overlay), `not_found` (user/note/видимость), `unauthorized` (роль или чужой автор), `conflict` (ключ на другую команду или stale `expectedUpdatedAt`), `internal`. Полный порядок/fingerprint/receipt — **docs/MUTATION_OVERLAY.md** §§ (1B6).

### 15.2 Зарезервировано (ещё не реализовано)

Пустых методов на будущее в интерфейсе **нет** — член интерфейса без реализации обещает то, чего провайдер не делает, а `as never` ради placeholder-формы уже пришлось удалять из контракта Today (D-50). Каждая появится вместе со своей реализацией:

```
createTask; updateTask; createCase; updateCase;
assignTaskAssignee; assignCaseAssignee;  // отдельные assignees (D-08)
resolveSignal; acceptRecommendedAction;
revealUserPii;                           // PII reveal-flow (D-11): reason code → AuditRecord → autoHideAt
```

Общие правила для них те же: idempotency-ключ, permission requirement, evidence/reasonCode, возврат обновлённой сущности + AuditRecord. `revealUserPii` дополнительно возвращает `autoHideAt` (см. PII_ACCESS_POLICY.md).

**Все мутирующие действия — mock/local:** пишутся в versioned localStorage overlay (D-09), исходные фикстуры неизменяемы. Backend/API/база данных отсутствуют.

---

_Связано: CRM_DOMAIN_MODEL.md (типы), ROLE_PERMISSION_MATRIX.md (права), MOCK_DATA_PLAN.md (чем наполняет MockCrmDataProvider), FUTURE_INTEGRATION.md (ApiCrmDataProvider)._
