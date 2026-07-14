# ATA V2 — Phase 2B.1: Enrollment and Progress Schema Foundation

**Статус:** утверждённая и реализованная additive schema foundation

**Дата:** 2026-07-14

**Базовый HEAD:** `297090956010b361cea698b77936a18cb7dd6606`
**Связанные документы:** `V2_GAP_ANALYSIS.md`, `V2_PRODUCT_DECISIONS.md`, `V2_PHASE_1_SCHEMA_DESIGN.md`, `V2_PHASE_1_COMPLETION.md`

Phase 2B.1 добавляет только enum/model declarations, inverse relations, compound/partial indexes, composite FK и schema/upgrade regressions. Resolver, enrollment commands, progression engine, XP, checkpoints, API, UI, seed/backfill, live runtime и production DB не изменяются.

---

## 1. Current Phase 1 findings

### 1.1 Takeover и доступные источники

- Анализ выполнен в `/home/ubuntu/workspaces/alfa-trade-academy-v2` на ожидаемом HEAD `2e0712f`; рабочее дерево до создания этого документа было чистым, Git remote отсутствовал.
- Phase 1 добавила только `CurriculumVersion`, `ModuleDefinition`, `LevelDefinition`, их admin authoring/lifecycle и одну аддитивную migration.
- `CurriculumVersion.status`: `draft | published | archived`. Для одного `code` DB partial unique index разрешает не более одной `published` версии.
- Published/archived definitions immutable. Публикация новой версии архивирует предыдущую атомарно, но не переводит будущие enrollments автоматически.
- `LevelDefinition` уже содержит `levelNumber`, `stableCode`, `requiredXp`, `requiredPreviousLevel`, `requiredCheckpointLevel`, `completionMethod`, `type`, `visibilityRule` и status.
- V1 `Task`, `UserTaskProgress`, `User.level`, `User.xp`, `XpEvent`, `Checkpoint`, `TaskReport` остаются активными и не должны изменяться или использоваться как V2-таблицы.
- Existing feature flag `CURRICULUM_V2_ADMIN_ENABLED` защищает только admin API Phase 1 и по умолчанию выключен.
- SQLite хранит Prisma enums как TEXT без CHECK; conditional uniqueness обеспечивается ручными partial indexes в migration SQL и дублирующими service guards.
- Кастомный runner `prisma/migrate.ts` делит SQL по `;`; будущая migration не должна содержать `;` внутри SQL literals/triggers.

### 1.2 Что найдено и чего нет в backend specification

`V2_GAP_ANALYSIS.md` ссылается на `TradeQuest_Product_OS_Curriculum_V2_Backend_Spec.md` v0.9, но сам файл и упомянутые в старом design-документе `back-ret.txt`, `otvet1.txt`, `les-prog.txt` в доступном workspace и `/home/ubuntu` не найдены.

В доступных источниках зафиксированы только восемь presentation/progression states:

`hidden`, `locked`, `xp_eligible`, `available`, `in_progress`, `pending_review`, `completed`, `temporarily_suspended`.

Для Phase 2B.1 утверждены: официальный curriculum code `ata-v2`; enrollment statuses `active | completed | superseded`; только один active enrollment на `(userId, curriculumCode)`; отсутствие обычного re-enrollment после completed; version migration только отдельной аудируемой командой. Persisted progress statuses — `in_progress | pending_review | completed`; presentation states вычисляются будущим resolver. XP authority и `XPTransaction` отложены до Phase 3.

### 1.3 Неизменяемые решения

- V1 остаётся активным; V2 строится параллельно.
- Enrollment всегда pin-ит пользователя к конкретной `CurriculumVersion`.
- Новая publication не изменяет существующие enrollments.
- Archived version остаётся допустимой historical target для уже созданного enrollment.
- Draft никогда не является enrollment target.
- Version migration — отдельная будущая audited command, а не side effect resolver-а или publication.
- Последовательность, XP и checkpoint обязательны одновременно; XP не обходит предыдущий уровень, checkpoint, report или mentor review.
- Phase 2 не начисляет XP, не реализует checkpoint runtime, не меняет Pocket и не добавляет public routes в первом кодовом этапе.

---

## 2. Enrollment model options

### 2.1 Primary key и история

**Вариант A — `(userId, curriculumVersionId)` как primary key.** Экономит одну колонку, но неудобен для audit/event references, self-contained migration metadata и будущих child records.

**Вариант B — отдельный `id Int @id @default(autoincrement())` (рекомендуется).** Даёт стабильный enrollment identity, допускает несколько historical enrollments и соответствует conventions проекта.

Утверждён вариант B. `@@unique([userId, curriculumVersionId])` не добавляется: historical completed/superseded rows сохраняются, а единственный active enrollment защищён отдельным partial unique index на `(userId, curriculumCode)`.

### 2.2 Область active uniqueness

Глобальный unique `(userId) WHERE status='active'` преждевременно запрещает пользователю одновременно участвовать в разных curriculum lines. Unique `(userId, curriculumVersionId)` не запрещает две active версии одного curriculum code.

Рекомендуется добавить техническое поле `curriculumCode String` и защищать:

```sql
CREATE UNIQUE INDEX "UserCurriculumEnrollment_userId_curriculumCode_active_key"
ON "UserCurriculumEnrollment"("userId", "curriculumCode")
WHERE "status" = 'active';
```

`curriculumCode` не является независимой копией: composite FK `(curriculumVersionId, curriculumCode) -> CurriculumVersion(id, code)` гарантирует совпадение с pinned version. Для этого `CurriculumVersion` получает только additive compound unique index `(id, code)`.

### 2.3 Несколько enrollments

- История нескольких enrollments сохраняется.
- Одновременно разрешён максимум один `active` enrollment на `(userId, curriculumCode)`.
- `completed` и `superseded` не считаются active для partial index.
- Обычный enrollment command не создаёт новый enrollment после completion. Переход на другую version выполняется только отдельной аудируемой migration-командой.
- При future version migration старая active запись становится `superseded`, новая создаётся `active`; обе операции и audit выполняются в одной transaction.

### 2.4 Delete и immutability

- Physical delete enrollment после создания запрещён.
- FK к `User` и `CurriculumVersion` — `onDelete: Restrict`, `ON UPDATE CASCADE`.
- `userId`, `curriculumVersionId`, `curriculumCode`, `enrolledAt`, `migrationSource` immutable.
- `status`, summary cache и timestamps изменяются только domain commands в transaction.
- Требование privacy erasure должно решаться отдельной retention/anonymization policy; Cascade не должен незаметно стирать progression history.

### 2.5 `currentXp`

`currentXp` в Phase 2B.1 не добавляется. Phase 3 введёт `XPTransaction` как источник истины; отдельный cached aggregate может быть добавлен только вместе с утверждённым ledger/projection contract.

### 2.6 `migrationSource`

Рекомендуемый storage: nullable `String`, не enum и не unstructured JSON.

- `null` — native V2 enrollment;
- `v1_backfill` — будущий контролируемый backfill;
- `version_migration` — enrollment создан audited version-migration command.

Значение проходит strict service whitelist и immutable. Source/target enrollment IDs, actor, reason и request id хранятся в `AuditLog`, а не кодируются в строке. Новые значения добавляются только после product/security review.

---

## 3. Progress model options

### 3.1 `userId` против `enrollmentId`

**Вариант A — `userId + curriculumVersionId`.** Дублирует owner и допускает mismatch между user, enrollment и historical version.

**Вариант B — `enrollmentId` как owner (рекомендуется).** User и pinned version выводятся через enrollment. Для DB cross-version protection дополнительно хранится `curriculumVersionId`, но отдельного `userId` нет.

### 3.2 Eager против lazy rows

**Eager:** при enrollment создать строку на каждый level. Плюс — простая матрица. Минус — `hidden/locked/xp_eligible/available` быстро устаревают, требуются массовые updates, а definition count может быть большим.

**Lazy (рекомендуется):** отсутствие `UserLevelProgress` означает, что durable activity ещё не началась. Row создаётся только при `start`, trusted direct completion или migration import. Presentation state вычисляется resolver-ом из immutable definitions, completed progress и внешних gate inputs.

Это позволяет не вводить отсутствующий в спецификации persisted status `not_started` и не хранить derived eligibility как source of truth.

### 3.3 Review/checkpoint foreign keys

`reviewId` и `checkpointVerificationId` не добавляются как orphaned `Int?` в Phase 2. Они появятся аддитивно вместе с реальными V2 report/checkpoint tables и FK в соответствующих фазах. `completionEvidence` не заменяет будущие relational FK.

### 3.4 Completion evidence

`completionEvidence Json?` остаётся nullable schema-полем, но до профильных фаз допустимо только `null`. Phase 2B.1 не реализует generic arbitrary evidence writer. Будущий evidence envelope должен быть versioned и строго validated, например:

```json
{
  "version": 1,
  "kind": "external_event",
  "referenceType": "postback_event",
  "referenceId": "123"
}
```

Правила:

- только allowlisted keys/kinds;
- bounded serialized size;
- никакого raw Pocket payload, secrets, tokens, file contents или arbitrary user JSON;
- IDs сериализуются как references, а не embedded entities;
- после `completed` evidence и completionMethod immutable; corrections — отдельная audited adjustment command.

### 3.5 `attemptCount`

- `Int @default(0)`, неотрицательный service invariant.
- Resolver/read API никогда его не изменяет.
- Phase 2 initial/start command не увеличивает attempts.
- Assessment/report phases определят, какое действие является attempt, и увеличивают counter атомарно со своей attempt record.

---

## 4. Recommended exact Prisma models

Ниже фактическая schema Phase 2B.1 с утверждёнными enum и defaults.

```prisma
enum CurriculumEnrollmentStatus {
  active
  completed
  superseded
}

enum UserLevelProgressStatus {
  in_progress
  pending_review
  completed
}

model UserCurriculumEnrollment {
  id                     Int                        @id @default(autoincrement())
  userId                 Int
  curriculumVersionId    Int
  curriculumCode         String
  enrolledAt             DateTime                   @default(now())
  status                 CurriculumEnrollmentStatus @default(active)
  highestCompletedLevel  Int                        @default(0)
  currentLevel           Int                        @default(1)
  lastMeaningfulActionAt DateTime?
  completedAt            DateTime?
  migrationSource        String?
  createdAt              DateTime                   @default(now())
  updatedAt              DateTime                   @updatedAt
  user                   User                       @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  curriculumVersion      CurriculumVersion          @relation(fields: [curriculumVersionId, curriculumCode], references: [id, code], onDelete: Restrict, onUpdate: Cascade)
  levelProgress          UserLevelProgress[]

  @@unique([id, curriculumVersionId])
  @@index([curriculumVersionId, status])
  @@index([userId, enrolledAt])
}

model UserLevelProgress {
  id                  Int                     @id @default(autoincrement())
  enrollmentId        Int
  curriculumVersionId Int
  levelDefinitionId   Int
  status              UserLevelProgressStatus @default(in_progress)
  startedAt           DateTime                @default(now())
  lastProgressAt      DateTime?
  completedAt         DateTime?
  completionMethod    String?
  completionEvidence  Json?
  attemptCount        Int                     @default(0)
  createdAt           DateTime                @default(now())
  updatedAt           DateTime                @updatedAt
  enrollment          UserCurriculumEnrollment @relation(fields: [enrollmentId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  levelDefinition     LevelDefinition          @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)

  @@unique([enrollmentId, levelDefinitionId])
  @@index([enrollmentId, status])
  @@index([curriculumVersionId, status])
  @@index([levelDefinitionId])
}
```

Required inverse/additive declarations:

```prisma
model User {
  // existing fields...
  curriculumEnrollments UserCurriculumEnrollment[]
}

model CurriculumVersion {
  // existing fields...
  enrollments UserCurriculumEnrollment[]

  @@unique([id, code])
}

model LevelDefinition {
  // existing fields...
  userProgress UserLevelProgress[]

  @@unique([id, curriculumVersionId])
}
```

`@@unique([id, code])`, `@@unique([id, curriculumVersionId])` выглядят избыточно рядом с primary key, но нужны SQLite как exact parent keys для composite FK. Они являются additive unique indexes и не изменяют существующие rows.

---

## 5. Field table

### 5.1 UserCurriculumEnrollment

| Поле | Prisma / SQLite | Null/default | Contract |
|---|---|---|---|
| id | Int / INTEGER PK AUTOINCREMENT | — | стабильный historical/audit identity |
| userId | Int FK | NOT NULL | owner; immutable; User delete RESTRICT |
| curriculumVersionId | Int FK component | NOT NULL | pinned version; immutable |
| curriculumCode | String / TEXT | NOT NULL | denormalизация для per-code active unique; защищена composite FK |
| enrolledAt | DateTime | now | immutable creation time |
| status | enum / TEXT | active | lifecycle; не доверять SQLite enum без service validation |
| highestCompletedLevel | Int | 0 | transactional summary cache, не самостоятельный source of truth |
| currentLevel | Int | 1 | первый обязательный level, который ещё не completed; summary cache |
| lastMeaningfulActionAt | DateTime? | null | не обновляется login/read; только progression/report/assessment meaningful command |
| completedAt | DateTime? | null | обязателен только при status=completed |
| migrationSource | String? | null | strict origin code; immutable |
| createdAt | DateTime | now | immutable creation timestamp |
| updatedAt | DateTime | @updatedAt | технический mutation timestamp, не audit substitute |

Service invariants: `highestCompletedLevel >= 0`, `currentLevel >= 1`; `completedAt != null` iff completed; `completedAt >= enrolledAt`; pinned version не draft.

### 5.2 UserLevelProgress

| Поле | Prisma / SQLite | Null/default | Contract |
|---|---|---|---|
| id | Int / INTEGER PK AUTOINCREMENT | — | audit/future FK identity |
| enrollmentId | Int FK component | NOT NULL | owner вместо userId |
| curriculumVersionId | Int FK discriminator | NOT NULL | связывает enrollment и level одной version |
| levelDefinitionId | Int FK component | NOT NULL | immutable level identity |
| status | enum / TEXT | in_progress | durable persisted lifecycle |
| startedAt | DateTime | now | время создания первой durable progress row |
| lastProgressAt | DateTime? | null | meaningful progress only; reads не меняют |
| completedAt | DateTime? | null | только completed |
| completionMethod | String? | null | actual allowlisted method; обязателен при completed |
| completionEvidence | Json? | null | sanitized/versioned evidence envelope |
| attemptCount | Int | 0 | owner — future assessment/report attempt service |
| createdAt | DateTime | now | immutable creation timestamp |
| updatedAt | DateTime | @updatedAt | технический mutation timestamp |

Service invariants: attemptCount non-negative; completed requires completedAt+completionMethod; non-completed has completedAt null; evidence валидируется по kind/method; identity fields immutable.

---

## 6. Status lifecycle

### 6.1 Найденные варианты

- V1 `UserTaskProgress`: free String `locked | active | completed`.
- V1 `TaskReport`: `pending | approved | rejected`.
- Доступная V2 ссылка: `hidden | locked | xp_eligible | available | in_progress | pending_review | completed | temporarily_suspended`.
- Enrollment statuses в доступных документах не определены.

### 6.2 Утверждённый minimal enrollment enum

```text
active ──complete──▶ completed
   └──audited version migration──▶ superseded
```

- `active`: единственный non-terminal state и единственный state partial unique index.
- `completed`: route завершён; terminal.
- `superseded`: enrollment закрыт explicit version migration; terminal.
- Reverse transitions, silent reactivation и delete запрещены.

Для Phase 2B.1 утверждены только `active`, `completed`, `superseded`. Обычный re-enrollment после completed запрещён; version migration выполняется отдельной аудируемой командой. Дополнительные business states не добавляются.

### 6.3 Durable progress lifecycle

```text
(no row) ──start──▶ in_progress ──submit──▶ pending_review ──approve──▶ completed
    │                    │                       └─reject──▶ in_progress
    └──trusted direct completion──────────────────────────▶ completed
```

- `completed` terminal.
- Direct completion разрешён только allowlisted external/system method в idempotent transaction.
- `pending_review` не применяется к level types, которые не требуют review.
- Rejection возвращает durable workflow в `in_progress`; reason/review record появятся в report phase.

### 6.4 Presentation states

`hidden`, `locked`, `xp_eligible`, `available`, `temporarily_suspended` не сохраняются в `UserLevelProgress.status`; это resolver output.

Минимальная рекомендованная семантика:

- `hidden`: level не должен раскрываться visibility policy;
- `locked`: previous/checkpoint/unsupported gate не выполнен;
- `xp_eligible`: последовательность/checkpoint выполнены, но required XP ещё не достигнут; пользователь может видеть XP gap;
- `available`: все поддерживаемые gates выполнены, durable row ещё нет;
- `temporarily_suspended`: computed overlay от future checkpoint/entitlement state, не уничтожающий underlying durable state.

**Product approval:** подтвердить смысл `xp_eligible`; сам термин в доступной спецификации есть, но его точная семантика отсутствует.

---

## 7. Persisted vs computed state

| State/data | Storage | Reason |
|---|---|---|
| enrollment active/completed/superseded | persisted | historical lifecycle, uniqueness, audit |
| in_progress/pending_review/completed | persisted | durable user actions/workflow |
| hidden/locked/xp_eligible/available | computed | зависит от prerequisites, XP, visibility, checkpoint |
| temporarily_suspended | computed overlay | future external checkpoint/entitlement state; не теряет prior lifecycle |
| highestCompletedLevel/currentLevel | persisted cache | быстрые summary reads; обновление только в transaction с progress |
| XP aggregate | отсутствует в Phase 2B.1 | Phase 3 `XPTransaction` будет source of truth |
| active published version for unenrolled user | computed | publication state/effective time |
| pinned version for enrolled user | persisted FK | historical stability |

Resolver возвращает и `durableStatus`, и `presentationState` отдельно; одно поле `status` для обоих слоёв запрещено, чтобы API не смешивал persisted и computed semantics.

---

## 8. Cross-version protection

### 8.1 Enrollment -> CurriculumVersion

```text
Enrollment(curriculumVersionId, curriculumCode)
  FK -> CurriculumVersion(id, code)
```

Это одновременно гарантирует существование version и корректность денормализованного code.

### 8.2 Progress -> Enrollment и LevelDefinition

```text
Progress(enrollmentId, curriculumVersionId)
  FK -> Enrollment(id, curriculumVersionId)

Progress(levelDefinitionId, curriculumVersionId)
  FK -> LevelDefinition(id, curriculumVersionId)
```

Одна и та же `curriculumVersionId` участвует в обоих FK. Поэтому невозможно вставить progress для enrollment version A и level version B даже прямым SQL/ошибочным service call.

### 8.3 Required compound unique indexes

- `CurriculumVersion(id, code)`;
- `UserCurriculumEnrollment(id, curriculumVersionId)`;
- `LevelDefinition(id, curriculumVersionId)`.

SQLite требует, чтобы referenced composite columns соответствовали PK/UNIQUE parent key. Service-only check недостаточен.

---

## 9. Resolver contract

### 9.1 Function signatures

```ts
resolvePublishedCurriculum(input: {
  curriculumCode?: string;
  asOf?: Date;
  db?: CurriculumResolverDb;
}): Promise<PublishedCurriculumResult>

resolveUserCurriculumContext(input: {
  userId: number;
  curriculumCode?: string;
  asOf?: Date;
  db?: CurriculumResolverDb;
}): Promise<UserCurriculumContextResult>
```

`curriculumCode` defaults to the constant `DEFAULT_CURRICULUM_CODE = "ata-v2"`. An explicit code is never replaced. `CURRICULUM_V2_READ_ENABLED` and `CURRICULUM_V2_ENROLLMENT_ENABLED` are independent, default-false flags read at call time; the admin flag remains independent.

### 9.2 Published resolver

1. Если read flag off — `{kind:"disabled"}` без DB query и без DB write.
2. Strict validate curriculumCode.
3. Читать `status=published` и `code=curriculumCode`, deterministic order: `versionNumber desc`, `publishedAt desc`, `id desc`, limit 2.
4. 0 rows — `{kind:"unavailable", reason:"no_published_version"}`.
5. >1 row — `{kind:"corrupt", reason:"duplicate_published_version"}`; не выбирать молча, несмотря на ordering.
6. `publishedAt == null` — `{kind:"corrupt", reason:"published_without_published_at"}`.
7. `publishedAt > asOf` — `{kind:"unavailable", reason:"not_effective_yet"}`.
8. `effectiveFrom != null && effectiveFrom > asOf` — `{kind:"unavailable", reason:"not_effective_yet"}`.
9. Modules and levels must belong to the selected version and return in deterministic `(number, id)` order. Cross-version links, disabled published definitions, and code mismatch return `invalid_curriculum_graph` or `code_mismatch` with safe scalar diagnostics.
10. Иначе `{kind:"available", curriculumVersion, modules, levels}`.

Ordering нужен для deterministic diagnostics, но не превращает повреждённые данные в валидный выбор.

### 9.3 User context resolver

1. Read flag off -> disabled.
2. Read the user, then enrollment history for `(userId, curriculumCode)` with pinned definitions and persisted progress. A missing user returns `user_not_found`.
3. More than one active enrollment is corrupt; DB partial unique должен исключать это.
4. Active enrollment has priority and returns exactly its pinned version:
   - `published` допустим;
   - `archived` допустим и ожидаем для historical enrollment;
   - `draft` -> corrupt (`draft_pinned_version`).
5. Не подменять pinned archived version новой published version.
6. If the latest enrollment is completed, return `completed`; no candidate and no re-enrollment are offered.
7. A latest superseded enrollment without an active replacement returns `superseded_without_replacement`, unless a newer completed enrollment exists.
8. Only when no history exists, call the published resolver and return `candidate`, `unavailable`, or `corrupt`; enrollment не создаётся.
9. Persisted progress returns exactly as stored in `(levelNumber, id)` order. Cross-version progress, invalid status/timestamps, or impossible summary values are corrupt.
10. Никаких writes, missing progress creation, lazy enrollment, timestamp touch, audit, XP calculation, checkpoint evaluation, or presentation-state derivation из resolver.

### 9.4 Typed results

```ts
type PublishedCurriculumResult =
  | { kind: "disabled" }
  | { kind: "unavailable"; reason: "no_published_version" | "not_effective_yet" }
  | { kind: "corrupt"; reason: "published_without_published_at" | "duplicate_published_version" | "invalid_curriculum_graph" | "code_mismatch"; diagnostics?: SafeDiagnostics }
  | { kind: "available"; curriculumVersion: CurriculumVersion; modules: ModuleDefinition[]; levels: LevelDefinition[] };

type UserCurriculumContextResult =
  | { kind: "disabled" }
  | { kind: "user_not_found" }
  | { kind: "enrolled"; enrollment: UserCurriculumEnrollment; curriculumVersion: CurriculumVersion; modules: ModuleDefinition[]; levels: LevelDefinition[]; progress: UserLevelProgress[] }
  | { kind: "completed"; enrollment: UserCurriculumEnrollment; curriculumVersion: CurriculumVersion; modules: ModuleDefinition[]; levels: LevelDefinition[]; progress: UserLevelProgress[] }
  | { kind: "candidate"; curriculumVersion: CurriculumVersion; modules: ModuleDefinition[]; levels: LevelDefinition[] }
  | { kind: "unavailable"; reason: "no_published_version" | "not_effective_yet" }
  | { kind: "corrupt"; reason: string; diagnostics?: SafeDiagnostics };
```

Storage/Prisma infrastructure exceptions remain exceptions; typed corruption is only for domain/data contradictions. Diagnostics contain no secrets, emails, or raw records. Phase 2B.2 adds no route or API response mapping.

---

## 10. Initial state strategy

### 10.1 Enrollment transaction

Реализованная controlled admin enrollment command выполняется в одной transaction:

1. До transaction требует одновременно READ и ENROLLMENT flags; оба default false, admin flag независим.
2. В transaction проверяет, что actor — active admin, а target user существует и active; role target user не ограничивается.
3. Читает всю `ata-v2` history одним include graph: valid active возвращает `created=false`; completed блокирует re-enrollment; superseded без active replacement и invalid pin/invariants дают typed history corruption.
4. Только при отсутствии history получает effective published target через `resolvePublishedCurriculum({ curriculumCode: "ata-v2", asOf, db: tx })`; caller не передаёт version ID/code.
5. Создаёт enrollment `active`, `highestCompletedLevel=0`, `currentLevel=1`, nullable action/completion/migration fields = null и pin на точную resolved version.
6. Не создаёт progress rows (lazy strategy).
7. Пишет awaited `CURRICULUM_USER_ENROLLED` audit в той же transaction с actor/target/enrollment/version IDs, code и versionNumber.

Race закрывается manual partial unique index. Только ожидаемый P2002 запускает повторное чтение: valid active возвращается как `created=false`, corrupt history остаётся typed failure, отсутствие active повторно выбрасывает исходную infrastructure error. Unknown DB errors не маскируются. Audit failure откатывает enrollment.

Typed success result: `{ kind: "enrolled", created: true | false, enrollment }`. Expected failures используют `EnrollmentDomainError`: disabled flags, forbidden actor, missing/inactive target, unavailable/corrupt published target, corrupt history и already completed. API mapper в Phase 2B.3 отсутствует.

### 10.2 Initial presentation

- Read-only `resolveUserCurriculumLevelStates` переиспользует pinned context resolver и принимает только `userId/asOf/db`.
- Persisted `completed | pending_review | in_progress` отображаются без переинтерпретации; только `available | locked` вычисляются и не записываются в БД.
- Без progress row доступным может быть максимум один уровень — только `enrollment.currentLevel`, если module/level active, prior sequence подтверждена completed rows, `requiredXp=0`, checkpoint отсутствует и `visibilityRule=null`.
- Future/non-current levels locked с `not_current_level`; отсутствующая последовательность — `sequence_incomplete`; inactive definitions — `definition_inactive`.
- `requiredXp>0` fail-closed как `xp_engine_unavailable`; legacy `User.xp` не читается и не является V2 authority.
- Checkpoint dependency fail-closed как `checkpoint_engine_unavailable`; non-null visibility — `visibility_rule_unsupported`, а не выдуманный `hidden`.
- `xp_eligible`, `hidden` и `temporarily_suspended` в Phase 2B.4 не выдаются.
- Cross-version pins/progress, invalid sequence, impossible summary/progress и status/timestamp contradictions дают typed `corrupt`, а не частичный маршрут.
- Resolver не пишет progress/audit/notifications, не касается timestamps и не читает V1 `Level/Task/UserTaskProgress`.

### 10.3 Почему lazy безопаснее

- immutable published definitions дают стабильный список levels без snapshot-copy;
- derived states не устаревают в rows;
- publication replacement не влияет на pinned definitions;
- no-op enrollment не создаёт сотни rows;
- unique progress row остаётся idempotency boundary для durable activity.

### 10.4 Lazy current-level start

- `startCurrentCurriculumLevel({ actorUserId, asOf?, db? })` действует только для actor и не принимает target user/version/code/level.
- Команда требует READ + ENROLLMENT flags, active user и active pinned enrollment; state вычисляется тем же resolver внутри interactive transaction.
- Только current state `available` создаёт один `UserLevelProgress(status=in_progress, startedAt=asOf, lastProgressAt=asOf, attemptCount=0)`.
- В той же transaction обновляется только `enrollment.lastMeaningfulActionAt` и awaited audit `CURRICULUM_LEVEL_STARTED` с безопасными actor/user/enrollment/version/level identifiers.
- Existing valid `in_progress` или `pending_review` current row возвращается как `created=false` без writes/audit/timestamp touch.
- P2002 recovery перечитывает тот же pinned context и принимает только valid current-level `in_progress/pending_review`; иначе исходная infrastructure error не маскируется.
- Audit failure откатывает progress и enrollment timestamp. XP/checkpoint/report/mentor/entitlement/content/assessment records не создаются.

---

## 11. Feature flags

Рекомендуется разделить capabilities:

- `CURRICULUM_V2_ADMIN_ENABLED` — существующий Phase 1 admin authoring; без изменений.
- `CURRICULUM_V2_READ_ENABLED=false` — resolver/progression reads.
- `CURRICULUM_V2_ENROLLMENT_ENABLED=false` — enrollment/progress writes; может быть true только при READ=true.

Один общий Phase 2 flag менее безопасен: нельзя отдельно прогреть read path и затем включить writes. Два flags позволяют staged rollout:

1. оба false;
2. READ=true, ENROLLMENT=false — read-only shadow/QA;
3. ENROLLMENT=true для controlled cohort после schema/resolver verification.

Оба Phase 2 flags объявлены в коде и `.env.example` со значением `false`; live env не меняется. Resolver имеет typed default `ata-v2`, а enrollment command всегда передаёт этот trusted constant явно и не принимает code от caller.

---

## 12. Migration plan

### 12.1 Предлагаемое имя

`20260714010000_curriculum_enrollment_progress_foundation`.

### 12.2 Содержимое одной additive migration

- CREATE TABLE `UserCurriculumEnrollment`;
- CREATE TABLE `UserLevelProgress`;
- additive unique indexes на existing parents:
  - `CurriculumVersion(id, code)`;
  - `LevelDefinition(id, curriculumVersionId)`;
- обычные/compound indexes из §4;
- manual partial unique active-enrollment index;
- composite FK из §8;
- ни одного ALTER/DROP/RENAME V1 table/column;
- никаких seed/backfill/data updates.

Prisma enums создают только client types; SQLite columns будут TEXT. Status whitelist и transitions остаются service responsibility.

### 12.3 Delete/update behavior

- User -> Enrollment: RESTRICT / CASCADE update;
- CurriculumVersion -> Enrollment: RESTRICT / CASCADE update;
- Enrollment -> Progress: RESTRICT / CASCADE update;
- LevelDefinition -> Progress: RESTRICT / CASCADE update.

Ни один historical row не удаляется cascade. Draft deletion не конфликтует: enrollment command никогда не может ссылаться на draft.

### 12.4 SQLite/Prisma limitations

- Partial unique index отсутствует в Prisma schema и живёт вручную в migration SQL; regression обязана проверять его SQL.
- Enum CHECK отсутствует; direct SQL может вставить неизвестный status, поэтому resolver возвращает corrupt, а не принимает значение.
- Composite FK требует exact compound unique parent indexes.
- Conditional timestamp/status invariants остаются service-level.
- Runner split по `;` запрещает triggers/сложные literals; migration должна состоять из простых CREATE TABLE/INDEX statements.

### 12.5 Populated V1 upgrade

Regression создаёт populated V1 DB, применяет Phase 1 chain, snapshot-ит V1 rows/PK/relations, применяет Phase 2 migration и проверяет:

- все V1 counts/values/relations byte-for-byte/semantic unchanged;
- обе новые tables существуют и пусты;
- parent compound indexes, composite FK и partial index существуют;
- V1 CRUD/read paths работают;
- repeated runner сообщает already applied и ничего не меняет;
- seed не требуется.

### 12.6 Rollback/compatibility

До rollout: `npm run db:backup` и verify backup на отдельной среде. Technical rollback при пустых новых tables:

1. DROP `UserLevelProgress`;
2. DROP `UserCurriculumEnrollment`;
3. DROP additive parent compound indexes, только если никакая следующая migration их не использует;
4. удалить запись migration из `_prisma_migrations` по существующей controlled procedure.

После появления enrollments destructive rollback запрещён; rollback = deploy previous code с flags off, сохранить tables/data и подготовить forward fix.

---

## 13. V1 compatibility

- `Task`, `UserTaskProgress`, `User.level/xp/currentTask`, `Checkpoint`, `TaskReport`, `XpEvent`, Pocket routes и V1 API не меняются.
- V2 enrollment/progress не читаются V1 code paths.
- Phase 2 не начисляет XP и не пишет V1 `XpEvent`/`User.xp`.
- Existing visible V1 level semantics не заменяются, пока V2 read flag off.
- Empty V2 tables не влияют на startup, seed, V1 auth или postbacks.
- Никакого automatic backfill existing users в schema migration.
- V1->V2 enrollment — отдельный future command/script с dry-run, idempotency и audit.

---

## 14. Security and audit requirements

### 14.1 Enrollment creation authority

- Только domain command; прямые route-level Prisma writes запрещены.
- Self-enrollment: только authenticated active user и только для собственного userId, если отдельный public route будет явно утверждён позже.
- Admin/system enrollment: explicit actor policy, reason и audit; body actorId не принимается.
- Phase 2B.1/2B.2 public routes не создают.

### 14.2 Transaction/audit

Awaited audit в той же transaction для:

- `CURRICULUM_ENROLLMENT_CREATED`;
- `CURRICULUM_ENROLLMENT_COMPLETED`;
- future `CURRICULUM_ENROLLMENT_MIGRATED`;
- `USER_LEVEL_STARTED`;
- `USER_LEVEL_REVIEW_PENDING`;
- `USER_LEVEL_COMPLETED`;
- attempt/evidence correction actions в будущих phases.

Audit metadata: actorId, userId, enrollmentId, curriculumVersionId, curriculumCode, levelDefinitionId, transition, migration source/reason, idempotency key/correlation id. Не хранить raw evidence/payload, secrets, tokens, full user content.

### 14.3 Idempotency/concurrency

- active partial unique — enrollment race boundary;
- `(userId,curriculumVersionId)` — repeated enrollment boundary;
- `(enrollmentId,levelDefinitionId)` — progress row boundary;
- completion commands требуют idempotency key или immutable external reference в соответствующей future table;
- repeated completed call — typed already-completed/no-op без второго XP/audit/notification side effect;
- summary cache и progress transition обновляются в одной transaction.

### 14.4 Error handling

- Не раскрывать existence чужого enrollment/progress: ownership mismatch -> 404-style typed not found.
- Raw Prisma/SQLite/stack/path/env/evidence наружу не возвращаются.
- Unknown DB enum, cross-version drift, multiple active/published rows -> corrupt/internal typed state + server warning, не silent fallback.

---

## 15. Regression test plan

### 15.1 Schema suite

1. Новые tables/indexes/FK существуют; V1 schema сохранена.
2. Enrollment draft target отклоняется service-ом; DB composite code/version mismatch отклоняется.
3. Same user+version duplicate отклоняется.
4. Two active enrollments same user+code отклоняются partial index.
5. Active enrollments разных curriculum codes разрешены.
6. Multiple completed/superseded historical rows разрешены.
7. Progress with enrollment version A + level version B отклоняется DB.
8. Duplicate progress `(enrollment, level)` отклоняется.
9. User/version/level physical delete RESTRICT при наличии history.

### 15.2 Resolver suite

1. read flag off -> disabled, zero writes/audits.
2. no published -> unavailable.
3. published candidate -> available.
4. future effectiveFrom -> not_effective.
5. corrupt multiple published/unknown status -> corrupt, no silent winner.
6. active enrollment returns pinned published version.
7. pinned archived version remains available to enrolled user.
8. newer published version does not replace pinned archived version.
9. user without enrollment gets candidate but no row is created.
10. resolver leaves `updatedAt`, audit counts and DB unchanged.

### 15.3 Enrollment/progress suite

1. enrollment transaction creates exact defaults and audit.
2. concurrent duplicate maps to typed conflict.
3. identity fields immutable; physical delete unavailable.
4. lazy enrollment creates zero progress rows.
5. level 1 computed available only with supported zero gates.
6. later levels locked until previous completed.
7. requiredXp/checkpoint unsupported inputs fail closed.
8. start/pending_review/completed transitions valid; invalid transitions rejected.
9. repeated completion idempotent; no duplicate audit/side effects.
10. evidence strict schema/size/redaction enforced.
11. summary cache equals completed rows after every transition.

### 15.4 Upgrade and cumulative gates

- Новый suite добавляется после existing Phase 1 suites, строго sequential, не параллельно build.
- Populated V1 upgrade + migration runner idempotency.
- `prisma validate`, `prisma generate`, lint, tsc, build.
- Existing `test:regression:curriculum-phase1` и withdrawal regression остаются зелёными.
- Temp DB/listeners всегда удаляются; live DB/env/runtime не используются.

---

## 16. Phase 2B.1 decisions and deferred inputs

Утверждены для schema foundation:

1. Официальный curriculum code первой линии — `ata-v2`.
2. Enrollment enum — `active | completed | superseded`; один active row на `(userId, curriculumCode)`.
3. Completed user не получает обычный re-enrollment; переход version выполняет только отдельная аудируемая migration-команда.
4. Persisted progress states — `in_progress | pending_review | completed`.
5. `hidden | locked | xp_eligible | available | temporarily_suspended` — computed resolver states и не входят в DB enum.
6. History enrollment/progress физически не удаляется; relations используют Restrict, retention бессрочный до отдельной policy.
7. XP authority отложена до Phase 3 `XPTransaction`; `currentXp` в Phase 2B.1 отсутствует.
8. `completionEvidence` до профильных фаз допускает только `null`; generic evidence writer отсутствует.

Для последующих command/runtime фаз остаются отдельными входами: точная semantics `xp_eligible`, `effectiveFrom`, default visibility, report rejection/resubmission, assessment attempts, checkpoint verification, entitlement suspension/restore, retention/anonymization policy и allowlist completion methods/evidence kinds.

---

## 17. Phase 2 decomposition

### 2B.1 Schema foundation

**Scope:** два enum, две модели, inverse relations, compound/partial indexes, composite FK, schema/upgrade regression.

**Запрещено:** resolver, writes, API, seed/backfill, XP/checkpoint runtime.

**Acceptance:** schema/DB constraints и populated V1 upgrade tests зелёные; новые tables пусты; flags/live untouched.
**Dependency:** выполнена утверждёнными решениями §16.

### 2B.2 Read-only resolver

**Scope:** реализованные `resolvePublishedCurriculum`, `resolveUserCurriculumContext`, typed results, independent default-false READ/ENROLLMENT flags, default code `ata-v2`, resolver regression.

**Запрещено:** auto-enrollment, timestamp touches, public routes, progress writes.

**Acceptance:** archived pinning, completed terminal result, superseded contradiction, no published, future timestamps, corrupt graph/progress, deterministic ordering, bounded reads, and no-write/no-listener tests.
**Dependency:** выполнена в рамках read-only контракта; visibility/progression policy намеренно не вычисляется.

### 2B.3 Enrollment command

**Scope:** реализованная controlled admin enrollment service, совместные READ/ENROLLMENT gates, fixed `ata-v2` resolver target, transaction, active unique race recovery и awaited audit.

**Запрещено:** public route unless separately approved, automatic enrollment on read/login, existing-user backfill, version migration.

**Acceptance:** published-only target, active-admin authorization, active pin idempotency, completed/superseded policy, deterministic P2002 recovery, no progress rows, audit rollback и no-listener regression.
**Dependency:** выполнена для ordinary first enrollment; re-enrollment/version migration остаются отдельной policy/command.

### 2B.4 Initial progress creation

**Scope:** реализованные effective Level States и actor-only lazy start текущего available уровня; stable fail-closed blockers, progress unique-race recovery и awaited audit.

**Запрещено:** XP grants, generic unlock engine, checkpoint/report/mentor shortcuts.

**Acceptance:** persisted-state fidelity, maximum one available, sequence/summary corruption, requiredXp/checkpoint/visibility fail closed, read-only proof, one-row start, full idempotency, controlled P2002, audit rollback и no-side-effect regression.
**Dependency:** выполнена только start/read часть; completion method allowlist, XP/checkpoint и state transitions остаются будущими commands.

### 2B.5 Progression read API

**Реализованный acceptance contract:** единственный authenticated owner endpoint — `GET /api/curriculum/v2/current`; cross-user/admin target IDs и mutation routes отсутствуют. Gate выполняется в порядке READ flag → session → active user → strict empty query → existing context/level-state resolvers → safe allowlist mapper. Success возвращает `{data:{kind:"candidate"|"enrolled"|"completed"|"unavailable", ...}}`; unavailable — HTTP 200, typed corrupt state — sanitized 409 `CURRICULUM_STATE_CORRUPT`. Все ответы `no-store`; GET не требует CSRF и не создаёт enrollment/progress/audit/notification, не обновляет timestamps. ADMIN/ENROLLMENT flags не влияют на доступность read route. Полный зафиксированный контракт и cumulative evidence находятся в `V2_PHASE_2_COMPLETION.md`.

**Scope:** authenticated owner/admin read over resolver output, durableStatus + presentationState + machine reasons, no-store, flag/auth/ownership/security tests.

**Запрещено:** mutation endpoints, XP/checkpoint implementation, Pocket changes, automatic migration.

**Acceptance:** archived enrollment renders historical definitions; no cross-user disclosure; disabled -> hidden/404 policy; zero writes/audits.
**Dependency:** API shape approval and default visibility semantics.

### Subsequent stages

- sequential transition/unlock command after explicit XP authority contract;
- Phase 3 XP ledger/projection and XP eligibility;
- report/mentor workflow FK in report phase;
- checkpointVerification FK and suspension overlay in checkpoint phase;
- audited version migration command only after mapping/product rules.

---

## 18. Next phase boundary

Phase 2B.4 завершает effective Level State read и lazy start текущего available уровня. Progression read API (Phase 2B.5), completion/transitions, XP transactions, checkpoint runtime, report/mentor/entitlement/content/assessment runtime, UI, seed/backfill, re-enrollment и version migration не начинаются автоматически и остаются вне scope до отдельного запроса и acceptance contract.

---

*Документ не содержит secrets, паролей, реальных пользовательских данных или live env values.*
