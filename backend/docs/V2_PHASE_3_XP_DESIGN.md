# ATA V2 — Phase 3 XP Engine Design

**Статус:** Phase 3A, design-only; implementation и rollout запрещены
**Дата:** 2026-07-14
**Базовый HEAD:** `d0a7abe2adecd47490e6ffe1cf74a825d237b244`
**Связанные документы:** `V2_PRODUCT_DECISIONS.md`, `V2_GAP_ANALYSIS.md`, `V2_PHASE_2_SCHEMA_DESIGN.md`, `V2_PHASE_2_COMPLETION.md`

Этот документ фиксирует фактическую V1 XP-архитектуру и контракт будущей Phase 3. Он не меняет schema, migrations, source, routes, flags, DB или runtime. Упомянутый ранее master/backend specification в доступном workspace отсутствует; источниками истины для этого этапа являются перечисленные V2-документы, текущие schema/migrations/source и regression gates.

## 1. Scope и неизменяемые решения

- V1 `User.xp`, `XpEvent`, `Task`, `UserTaskProgress` и существующие routes остаются активными и не переписываются.
- V2 XP не списывается. V2 current XP вычисляется только как сумма immutable V2 ledger конкретного enrollment; cache `currentXp` в `UserCurriculumEnrollment` не добавляется.
- V2 никогда не использует `User.xp` или V1 `XpEvent` как authority.
- XP не начисляется за real/demo trade, deposit, withdrawal или потерю balance. V2 daily login XP выключен. V2 referral XP выключен до anti-abuse design; V1 daily/referral поведение этим этапом не меняется.
- Promocode XP может удовлетворить XP gate, но не sequence/checkpoint/report/mentor gate. XP сам по себе не завершает уровень.
- Published `requiredXp` и `xpReward` immutable. Historical enrollment остаётся pinned к published/archived version.
- XP между versions переносится только отдельной audited migration command; автоматического V1 backfill нет.
- Generic public COMPLETE LEVEL endpoint запрещён. Completion принадлежит assessment/report/mentor/checkpoint/external-event owner.

## 2. Изученная база

Проверены все 22 migrations от `20260628000000_init` до `20260714010000_curriculum_enrollment_progress_foundation`. XP-релевантные изменения находятся в:

- `20260628000000_init`: `User.xp`, legacy `Level.requiredXp`;
- `20260628010000_game_logic`: `Task.xpReward`, `Referral.xpEarned`;
- `20260629130000_after_rc_functional_structure`: referral bonus fields/config, `DailyLoginReward`, `Promocode`, `PromocodeRedemption` и первоначальный unique `(promocodeId,userId)`;
- `20260630140000_functional_completion_pass_6`: `XpEvent`; прежний promo unique удалён и заменён обычным index, что сохраняет `perUserLimit > 1`;
- `20260714000000_curriculum_versioning_foundation`: V2 `LevelDefinition.xpReward/requiredXp`;
- `20260714010000_curriculum_enrollment_progress_foundation`: version-pinned enrollment/progress без XP cache.

Остальная chain не создаёт альтернативного XP ledger. Кастомный `prisma/migrate.ts` делит SQL по `;`, поэтому trigger body с внутренними semicolon несовместим без изменения runner. Phase 1 gate включает семь suites, в том числе populated V1 upgrade; Phase 2 gate последовательно включает Phase 2B.1–2B.5, populated V1 upgrade и cumulative Phase 1 gate. Phase 3 regressions должны расширять, а не заменять их.

## 5.1 Current V1 XP map

### Stored authority и definition inputs

| Сущность | Фактическая роль | Ограничения |
|---|---|---|
| `User.xp` | Материализованный V1 total, основной all-time read | Mutable, admin может overwrite; DB не связывает его с суммой `XpEvent` |
| `XpEvent` | Append-style V1 history: `userId, amount, source, sourceId, createdAt` | Нет unique/idempotency key, enum/check amount, metadata, version/enrollment scope или DB immutability |
| `Task.xpReward` | V1 reward definition | Admin-editable; completion writers читают текущее значение |
| `Level.requiredXp` | V1 UI threshold data | Не является progression gate |
| `LevelDefinition.xpReward/requiredXp` | Published V2 definition inputs | Runtime XP ещё отсутствует; published/archived definitions domain-immutable |
| `Referral.xpEarned/invitedXpEarned` | Referral summary | Дублирует начисленные суммы, не является общим XP authority |
| `DailyLoginReward.xpGranted` | Daily reward record | Unique `(userId,rewardDate)` защищает один row в день |
| `Promocode.value` | JSON reward definition | XP shape cast-ится в route; отдельной строгой XP schema нет |

### Writers и owner flows

| Файл / функция или route | Событие / XP source | DB mutation | Transaction boundary | Idempotency | Audit / notification | Progression side effects | Race / consistency risk |
|---|---|---|---|---|---|---|---|
| `src/app/api/tasks/[id]/complete/route.ts::POST` | Manual или report-approved task; `source=task`, `sourceId=task.id` | `UserTaskProgress→completed`, unlock next, optional `UserReward`, `XpEvent`, overwrite `User.xp`, update level/currentTask | Progress/reward/ledger/User в одной tx; eligibility/user/task reads до tx; audit/notifications после | Только pre-read completed; ledger unique отсутствует | `TASK_COMPLETED`, optional reward/level notifications после commit | Да | Два parallel request могут оба пройти stale pre-read и начислить дважды; `nextXp` основан на stale `user.xp`; post-commit side effects могут потеряться |
| `src/lib/taskProgression.ts::completeProgressionTask` | Shared V1 completion; `source=task`, `sourceId=task.code ?? task.id` | Progress, next unlock, `XpEvent`, optional reward, `User.xp/level/currentTask` | Все перечисленное в одной tx | Внутри tx reread progress; completed возвращает no-op, но ledger unique нет | Не пишет audit/notification сам | Да | SQLite serialization снижает duplicate risk, но explicit idempotency identity отсутствует; разные sourceId formats у двух completion paths |
| `src/app/api/tasks/[id]/verify/route.ts::POST` | Pocket registration, deposit postback state или balance verification | После внешней проверки вызывает `completeProgressionTask` | Verification/provider вне completion tx; award/progression в shared tx | Наследует progress-status no-op | Сам route не пишет completion audit/notification | Да | Provider result и completion не один snapshot; retry безопасен лишь пока progress корректен |
| `src/app/api/admin/task-reports/[id]/route.ts::PATCH` | Approved report; ordinary report task использует `task` XP | Сначала `TaskReport→approved`, затем отдельный `completeProgressionTask` | Report update вне XP tx; audit ещё до XP call; notifications после | Terminal-status pre-read, но update не conditional; completion no-op по completed progress | Review audit до completion; approval/reward notification после | Да | Report can be approved/audited даже если completion fails; parallel reviewers могут повторить review audit/notification; XP owner identity не хранится в ledger |
| тот же `PATCH`, task kind `mentor_approval` | Mentor session approval | Тот же общий report flow и `task` XP | Те же раздельные boundaries | То же | То же | Да | Отдельного mentor-completion owner/identity нет; admin и mentor используют один route (`requireTaskReportReviewer`) |
| `src/lib/exchange/postbackProcessor.ts::processExchangePostbackPayload` | Registration → step 1; First Deposit/positive deposit → step 4; через `task` XP | Сначала PostbackEvent+ExchangeAccount tx; после commit вызывает `completeProgressionTaskByCode` | Postback и progression/XP — две разные tx; audit/notification после обеих | `PostbackEvent.externalEventId` unique/early duplicate read; task progress gives secondary no-op | Postback audit/notification после completion | Да | Postback может commit, а XP fail; retry duplicate returns before completion, поэтому missing XP/progression не self-heal. Deposit currently awards V1 task XP, но V2 не должен |
| `src/app/api/exchange/postbacks/simulate/route.ts::POST` | Admin simulation, First Deposit | Direct progress complete/unlock, но не `User.xp`/`XpEvent` | Event/account/progress одной tx; audit после | Нет request identity | `POSTBACK_SIMULATED` после commit | Да | First Deposit создаёт progress/XP divergence; это V1 fact, не V2 pattern |
| `src/app/api/auth/register/route.ts::POST` | Referral inviter/invited; `referral_inviter`, `referral_invited` | New User with invited XP, Referral, inviter increment, two `XpEvent` rows | User/tasks/checkpoint/referral/XP в одной tx; email token/audit/notifications после | User email unique + Referral invitedUserId unique; повтор не возвращает original result | Auth/referral audit и notifications после commit | Initial V1 task rows | XP атомарен с registration, но post-commit side effects могут потеряться; retry после lost response становится email conflict |
| `src/app/api/rewards/daily/route.ts::POST` | Daily login; `source=daily_reward`, `sourceId=YYYY-MM-DD` | DailyLoginReward, User increment, XpEvent | Одна tx; audit/notification после | DB unique `(userId,rewardDate)` предотвращает double row; P2002 не восстанавливает original result | После commit | Нет | Parallel loser вероятно получает error вместо duplicate success; side effects не idempotent. V2 source запрещён |
| `src/app/api/promocodes/redeem/route.ts::POST` | `xp_bonus`; `source=promocode`, `sourceId=promocode.id` | Redemption, usedCount increment, optional User XP + XpEvent/reward/achievement | Mutations в одной tx; active/expiry/maxUses/per-user count reads до tx; audit/notification после | Request identity отсутствует; одинаковый promo sourceId повторяется намеренно | После commit | XP влияет на V1 total/UI, не sequence | Count-before-write races превышают `perUserLimit`/`maxUses`; expiry/active может измениться после check; retry после commit может redeem снова; unique `(promo,user)` правильно отсутствует |
| `src/app/api/admin/users/[id]/route.ts::PATCH` | Manual admin overwrite | Direct `User.xp = supplied nonnegative value`; `XpEvent` не создаётся | User update отдельно; audit после | Нет | `ADMIN_USER_UPDATED` после mutation; notification нет | V1 UI/leaderboard total меняется | Ledger/total divergence by design; audit failure не откатывает update; parallel overwrites last-write-wins |
| `prisma/seed.ts::createUser` и seed setup | Fixture/bootstrap XP | Upsert `User.xp`, seed `XpEvent` | Seed-specific | Upsert/known fixture behavior | Нет runtime audit/notification | Fixture state | Не runtime owner; V2 no seed/backfill rule сохраняется |

`Task.xpReward` и V2 draft `LevelDefinition.xpReward/requiredXp` также имеют admin definition writers. Они меняют definitions, а не user XP. V1 task editor остаётся V1. V2 draft authoring разрешён только до publish; published/archived values нельзя менять задним числом.

### Readers и consumers

| Файл / route | Что читает | Поведение |
|---|---|---|
| `src/app/api/auth/me/route.ts` через `toPublicUser` | `User.xp` | Session user response |
| `src/app/api/me/route.ts` | `User.xp`, referral summaries | Profile/dashboard payload; separate progression-derived level |
| `src/app/api/leaderboard/route.ts` | All-time `User.xp`; period `sum(XpEvent.amount)` | Two authorities can disagree; all-time sort occurs by stored total |
| `src/app/api/admin/users/route.ts` и `[id]` | `User.xp` | Admin list/detail and progress-status heuristic |
| `src/app/api/crm/users/route.ts` | `User.xp` | CRM presentation only; no XP-triggered CRM write found |
| `src/lib/auth.ts`, `src/lib/api.ts` | `User.xp` | Public-user mapping and frontend API normalization |
| dashboard/profile/levels/leaderboard/admin components | API XP fields, task rewards, legacy level thresholds | UI consumers; not authorities |
| `src/lib/curriculum/read-api.ts` | Definition `xpReward/requiredXp` only | Deliberately omits user `currentXp` and all V1 XP |
| `src/lib/curriculum/level-state.ts` | `requiredXp` only | `requiredXp>0` currently fails closed with `xp_engine_unavailable` |

No assessment runtime exists: V2 types include `scenario` and `final_exam`, but there are no assessment attempt/pass models or award writers. No separate mentor approval engine exists: V1 mentor completion is the shared report-review path. No XP-driven CRM mutation was found. Notifications and audit consume awarded amounts as metadata but are not XP authority.

### Call chains

```text
manual task UI → POST /api/tasks/:step/complete
  → route-local completion tx → UserTaskProgress + XpEvent + User.xp + next task
  → audit → optional reward/level notifications

automatic verify → POST /api/tasks/:step/verify
  → Pocket/account/balance check → completeProgressionTask
  → shared completion tx

report approval → PATCH /api/admin/task-reports/:id
  → TaskReport update → review audit → completeProgressionTask
  → approval/reward notifications

mentor approval → same PATCH route (reviewer role admin|mentor)
  → same report flow; no distinct mentor owner

promocode → POST /api/promocodes/redeem
  → pre-tx availability/count checks → redemption tx
  → PromocodeRedemption + usedCount + optional User.xp/XpEvent
  → audit → notification

referral → POST /api/auth/register
  → registration tx → User + V1 task state + Referral + two XP writes
  → verification token → audits/notifications

login → POST /api/rewards/daily (explicit claim, not auth login itself)
  → daily reward tx → DailyLoginReward + User.xp + XpEvent
  → audit → notification

Pocket GET/receive route → processExchangePostbackPayload
  → postback/account tx → separate completeProgressionTaskByCode call
  → postback audit/notification

admin adjustment → PATCH /api/admin/users/:id
  → direct User.xp overwrite → audit
```

## 5.2 V1 compatibility boundary

V2 adds a parallel authority and must not alter `User`, `XpEvent`, `Task`, `Level`, `UserTaskProgress`, `Referral`, `DailyLoginReward`, `Promocode`, existing V1 routes or response shapes in Phase 3B.1–3B.4. Existing V1 writers continue updating only V1 unless an owner is explicitly adapted in a later phase.

V2 cannot read `User.xp`: it includes task, daily, referral, promo, seed and admin-overwrite effects, has no enrollment/version discriminator, and may disagree with V1 `XpEvent`. V2 cannot infer a safe subset from legacy source strings. No V1 row is copied automatically.

Double-award prevention rule: a business event has exactly one V2 owner and one canonical V2 completion/redemption identity. Owner adapters call the internal ledger once; routes must not call both a generic award path and an owner-specific path. V1 and V2 rows may represent the same promo during a deliberate coexistence policy, but they are separate product authorities, not two V2 awards.

With all curriculum flags false, no V2 XP read/write occurs and V1 behavior remains byte-for-byte/API compatible. With READ/ENROLLMENT on but XP off, current Phase 2 behavior remains: no current XP and `xp_engine_unavailable`. With XP on, only valid V2 enrollment-scoped commands can access the new ledger.

Populated upgrade proof must snapshot counts/rows/relations for V1 XP, task progress, report, referral, daily reward, promo/redemption and postback; apply additive XP migrations; prove snapshots unchanged; prove V1 CRUD/routes still work with all V2 flags off; then exercise V2 against throwaway rows only.

## 5.3 XP ownership

### Options

**A. User + CurriculumVersion ownership.** Simpler key, but cannot distinguish repeated/superseded historical enrollments of the same version and makes version migration/retention ambiguous. It also weakens the tie between XP and durable progression history.

**B. Enrollment ownership with duplicated version discriminator.** Each row belongs to one `UserCurriculumEnrollment`; `userId` and `curriculumVersionId` are query/audit discriminators validated by composite FK. This prevents XP from a prior/superseded enrollment leaking into the active one and allows archived pins.

**Recommendation: B.** Audit found no blocker. Enrollment is the durable progression aggregate and already has stable identity/history. The deliberate redundancy provides DB-level cross-user and cross-version protection.

### Required parent constraints

Future schema must add, without removing existing constraints:

```prisma
// UserCurriculumEnrollment
@@unique([id, userId, curriculumVersionId])

// Existing LevelDefinition constraint is sufficient:
@@unique([id, curriculumVersionId])
```

`XPTransaction(enrollmentId,userId,curriculumVersionId)` references the first tuple. Optional `(levelDefinitionId,curriculumVersionId)` references the second. Thus a transaction cannot name another user, another pinned version, or a level from another version.

## 5.4 Proposed `XPTransaction` model

### Exact Prisma contract

```prisma
enum CurriculumXpSourceType {
  level_completion
  assessment_pass
  report_approval
  mentor_completion
  promocode
  migration_adjustment
  admin_correction
}

model XPTransaction {
  id                    Int                    @id @default(autoincrement())
  userId                Int
  enrollmentId          Int
  curriculumVersionId   Int
  levelDefinitionId     Int?
  sourceType            CurriculumXpSourceType
  sourceId              String?
  idempotencyKey        String                 @unique
  payloadFingerprint    String
  amount                Int
  metadata              Json?
  createdAt             DateTime               @default(now())
  createdById           Int?

  user            User                     @relation("CurriculumXpTarget", fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  enrollment      UserCurriculumEnrollment @relation(fields: [enrollmentId, userId, curriculumVersionId], references: [id, userId, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  levelDefinition LevelDefinition?          @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  createdBy       User?                     @relation("CurriculumXpCreator", fields: [createdById], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@index([enrollmentId, createdAt, id])
  @@index([userId, createdAt, id])
  @@index([curriculumVersionId, sourceType])
  @@index([levelDefinitionId])
  @@index([sourceType, sourceId])
}
```

Inverse relation fields are required on `User`, `UserCurriculumEnrollment` and `LevelDefinition`; they do not add columns. Exact relation names should be fixed in Phase 3B.1 and regression-tested.

`levelNumber` is intentionally rejected. It is derivable from the immutable pinned `LevelDefinition`; duplicating it creates drift. `levelDefinitionId` is null only for promo/migration/admin rows not owned by one level. `userId` is retained despite being derivable from enrollment because it is a useful indexed query/audit discriminator and, with the triple FK, strengthens ownership. `createdById` is retained for human admin/migration actors; automated awards use the authenticated/system owner policy and may leave it null. `payloadFingerprint` is required to distinguish a safe retry from reuse of the same key with a different payload.

### Future SQLite SQL shape

The future migration must generate equivalent SQL, including manual CHECKs Prisma cannot express:

```sql
CREATE TABLE "XPTransaction" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "enrollmentId" INTEGER NOT NULL,
  "curriculumVersionId" INTEGER NOT NULL,
  "levelDefinitionId" INTEGER,
  "sourceType" TEXT NOT NULL CHECK ("sourceType" IN (
    'level_completion','assessment_pass','report_approval','mentor_completion',
    'promocode','migration_adjustment','admin_correction'
  )),
  "sourceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "amount" INTEGER NOT NULL CHECK ("amount" > 0),
  "metadata" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" INTEGER,
  CONSTRAINT "XPTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "XPTransaction_enrollment_pin_fkey"
    FOREIGN KEY ("enrollmentId","userId","curriculumVersionId")
    REFERENCES "UserCurriculumEnrollment"("id","userId","curriculumVersionId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "XPTransaction_level_pin_fkey"
    FOREIGN KEY ("levelDefinitionId","curriculumVersionId")
    REFERENCES "LevelDefinition"("id","curriculumVersionId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "XPTransaction_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "XPTransaction_idempotencyKey_key" ON "XPTransaction"("idempotencyKey");
CREATE UNIQUE INDEX "XPTransaction_enrollment_source_key"
  ON "XPTransaction"("enrollmentId","sourceType","sourceId") WHERE "sourceId" IS NOT NULL;
CREATE INDEX "XPTransaction_enrollmentId_createdAt_id_idx" ON "XPTransaction"("enrollmentId","createdAt","id");
CREATE INDEX "XPTransaction_userId_createdAt_id_idx" ON "XPTransaction"("userId","createdAt","id");
CREATE INDEX "XPTransaction_curriculumVersionId_sourceType_idx" ON "XPTransaction"("curriculumVersionId","sourceType");
CREATE INDEX "XPTransaction_levelDefinitionId_idx" ON "XPTransaction"("levelDefinitionId");
CREATE INDEX "XPTransaction_sourceType_sourceId_idx" ON "XPTransaction"("sourceType","sourceId");
```

The parent composite unique index must be created before this table. The partial source index is defense-in-depth: owner source IDs must identify one durable event (progress/attempt/report/mentor completion/redemption/migration row/admin request). Null source is permitted only where the owner contract explicitly cannot yet have a durable source; preferred implementation always supplies it.

## 5.5 Immutability

- No domain update/delete command, route or repository method exists for `XPTransaction`.
- Normal service code exposes `award...` and read functions only. Static regression scans forbid `xPTransaction.update`, `updateMany`, `delete`, `deleteMany` outside test cleanup/migration tooling.
- `createdAt`, source, amount, target, fingerprint and metadata never change on retry.
- FK deletes are `RESTRICT`; no cascade may erase XP history with user/enrollment/version/level deletion.
- Metadata is descriptive, never authority. A correction is a new row referencing a correction request in `sourceId`; it never edits an old row.
- SQLite/Prisma do not provide a schema annotation for append-only or CHECK. The Phase 3B.1 migration adds positive amount/source CHECKs; triggers are not recommended because the current semicolon-splitting runner cannot safely apply ordinary trigger bodies. Domain API isolation, no mutation methods, RESTRICT FKs and regression scans are the baseline protection.

**Negative correction open decision:** a negative `admin_correction` conflicts with the fixed “V2 XP не списывается” rule. The recommended baseline and proposed SQL permit only `amount > 0`; `admin_correction` means a documented positive make-good. Supporting negative rows would require an explicit product reversal, a changed CHECK, resolver/range semantics, permissions and UI/audit policy. Phase 3B.1 must not silently allow negatives.

## 5.6 Idempotency contract

`idempotencyKey` is globally unique because every key contains a fixed server-owned namespace. Callers never provide the stored key, source, target or amount. Owner adapters derive it from already-persisted owner identities:

```text
xp:v2:level-completion:<enrollmentId>:<userLevelProgressId>
xp:v2:assessment-pass:<enrollmentId>:<assessmentAttemptId>
xp:v2:report-approval:<enrollmentId>:<taskReportOrV2ReviewId>
xp:v2:mentor-completion:<enrollmentId>:<mentorCompletionId>
xp:v2:promocode:<enrollmentId>:<promocodeRedemptionId>
xp:v2:migration-adjustment:<migrationRunId>:<enrollmentId>:<sequence>
xp:v2:admin-correction:<correctionRequestId>
```

The command canonicalizes all authoritative inputs (owner type/id, enrollment/user/version/level, source, amount, safe metadata schema version) and stores SHA-256 as `payloadFingerprint`. An HTTP idempotency header, if a future owner route uses one, is untrusted entropy only: validate length/charset, bind it to authenticated actor+route+payload, and derive a namespaced hash; never store/use it directly as ledger authority.

Algorithm:

1. Load and validate owner, active/completed policy, enrollment pin and definition in one transaction.
2. Derive key, amount and fingerprint server-side.
3. If key exists, compare every invariant plus fingerprint. Exact match returns the original row/result with `duplicate=true`; mismatch returns typed `XP_IDEMPOTENCY_COLLISION` and writes nothing.
4. Otherwise insert once. P2002 is recoverable only for the expected idempotency/source unique index; reread and repeat invariant comparison.
5. Unknown constraint, timeout, busy/lock or infrastructure errors are not converted to success. Roll back and return sanitized failure; caller may retry the same owner operation.
6. A duplicate does not touch progress/enrollment timestamps and does not repeat audit, notification, unlock or completion.

The returned original result must be reconstructed from durable rows inside a fresh read/transaction, never from client payload. Metadata is included in the fingerprint through a stable allowlisted canonical projection; unordered/raw JSON is not hashed directly.

## 5.7 XP feature flag

Future flag: `CURRICULUM_V2_XP_ENABLED=false`. Phase 3A does not add it.

| Operation | Required flags | Flag-off behavior |
|---|---|---|
| Internal `resolveEnrollmentXp` | XP | `{kind:'disabled'}`; no DB read/write |
| Current curriculum API XP fields/history route | READ + XP | Existing Phase 2 response remains without `currentXp`; dedicated route indistinguishable 404 before auth |
| XP-aware LevelState | READ + XP | Preserve `xp_engine_unavailable`; fail closed |
| Enrollment-level award/completion | READ + ENROLLMENT + XP plus owner authorization | No completion/XP mutation; typed internal disabled or route 404 according to owner API policy |
| Admin correction | XP + active admin, independent of curriculum ADMIN authoring flag | Route 404 before auth when XP off |
| Promo V2 adapter | XP plus valid enrollment policy | No V2 ledger write; V1 route behavior unchanged |

`CURRICULUM_V2_ADMIN_ENABLED` controls authoring only and never substitutes for XP. Live default stays false; no env/live rollout belongs to Phase 3.

## 5.8 `resolveEnrollmentXp`

Proposed read-only signature:

```ts
resolveEnrollmentXp({ actorUserId, enrollmentId, asOf?, db? }): Promise<
  | { kind: "disabled" }
  | { kind: "unavailable"; reason: "enrollment_not_found" | "enrollment_not_readable" }
  | { kind: "corrupt"; reason: XpCorruptReason; diagnostics: SafeDiagnostics }
  | { kind: "resolved"; enrollmentId: number; currentXp: number; transactionCount: number; calculatedAt: Date }
>
```

Internal trusted callers may provide target user explicitly, but owner-facing calls derive it from session/owner. Resolver loads enrollment plus pinned published/archived version and validates user/version tuple. Draft pin, mismatched version/level rows, unknown source, nonpositive amount, invalid fingerprint/key shape or forbidden level-null/source combination fail closed as typed corruption. Archived pin is valid. Superseded/completed historical enrollment is readable only through authorized history context and sums only its own rows.

The result is deterministic: `SUM(amount)` and count for one enrollment, with history ordering `(createdAt,id)` when rows are returned. It never reads `User.xp`, V1 `XpEvent`, current published version as a replacement, or writes/touches timestamps/audit.

Range policy: each amount must be `1..1_000_000`; aggregate must be an integer in `0..2_147_483_647`. SQLite can sum wider than Prisma `Int`, so implementation must aggregate in a representation that detects unsafe/overflow values before converting to JS number. Out-of-range returns `xp_amount_out_of_range` or `xp_total_out_of_range`, never clamping/wrapping.

## 5.9 XP-aware LevelState (реализовано, Phase 3B.3)

`resolveUserCurriculumLevelStates` вызывает `resolveEnrollmentXp` ровно один раз на enrolled resolution и использует его как единственный XP-authority. V1 `User.xp`/`XpEvent` игнорируются.

**Snapshot boundary.** Если transaction client не передан, весь curriculum/progress/XP-read выполняется в одной `prisma.$transaction` (read snapshot). Если client передан (lazy start), он используется напрямую, без вложенной транзакции. XP запрашивается один раз (2 bounded raw-запроса: header + ledger), не per-level, без N+1. Резолвер ничего не пишет.

**Effective states.** Persisted durable: `completed`, `pending_review`, `in_progress` (имеют приоритет над computed). Computed presentation: `available`, `xp_eligible`, `locked`.

**Blockers** (детерминированный порядок): `not_current_level`, `definition_inactive`, `sequence_incomplete`, XP-slot (`xp_engine_unavailable` при выключенном движке и requiredXp>0, либо `xp_insufficient` при включённом движке и currentXp<requiredXp), `checkpoint_engine_unavailable`, `visibility_rule_unsupported`.

- `available` — только currentLevel, без progress, при: active definition/module, полная последовательность, `currentXp >= requiredXp`, нет checkpoint-gate, поддерживаемая visibility. Максимум один `available` — инвариант (иначе corrupt).
- `xp_eligible` — только при включённом XP-движке и выполненном XP-пороге (`requiredXp === 0` или `currentXp >= requiredXp`), когда единственные оставшиеся blockers ⊆ {`not_current_level`, `sequence_incomplete`}. Не сохраняется в `UserLevelProgress`, не позволяет start, не заменяет blockers. Level с `definition_inactive`/`visibility_rule_unsupported`/`checkpoint_engine_unavailable` НИКОГДА не `xp_eligible` — остаётся `locked` (XP не снимает эти blockers).
- XP-порог `requiredXp > 0` при выключенном/disabled движке → fail-closed `xp_engine_unavailable` (не «ноль XP», не fallback на V1).
- Любой corrupt/not_found от `resolveEnrollmentXp` для существующего enrollment, XP snapshot чужого enrollment/version, или XP total вне безопасного диапазона → whole-result `corrupt` (не частичная карта уровней); диагностика не раскрывает raw XP-значения.

**Feature flag.** `CURRICULUM_V2_XP_ENABLED` читается динамически; READ/ENROLLMENT/ADMIN-флаги его не заменяют.

**Lazy start.** `startCurrentCurriculumLevel` использует XP-aware LevelState внутри своей write-транзакции: requiredXp=0 как раньше; выключенный движок + requiredXp>0 → start blocked; недостаточный XP → blocked (`xp_insufficient`); точный/избыточный XP → start только при выполнении остальных gates; checkpoint не обходится; `xp_eligible` future нельзя стартовать (start работает только с currentLevel). Start не начисляет XP, не меняет XPTransaction, не меняет currentLevel/highestCompletedLevel; идемпотентный повтор возвращает created=false даже после выключения XP-флага; audit — только `CURRICULUM_LEVEL_STARTED` при фактическом создании progress.

**Internal result contract.** LevelState result содержит безопасный XP-summary (`kind`, `totalXp`, `transactionCount`, `lastTransactionAt`) один раз на result, не дублируется per-level; каждый level несёт только `requiredXp`/`presentationState`/`blockers`. HTTP `/api/curriculum/v2/current` структурно не расширен: `presentationState` может принять значение `xp_eligible` при включённом флаге; `currentXp`/история/internal ID в HTTP не добавлены (Phase 3B.6).

Замечание по тестам: ownership/version/level XP-consistency обеспечена composite FK и source-allowlist/CHECK в БД (не инжектируется валидными данными; покрыта XP ledger regression). Level-state whole-result-corrupt поведение проверяется инжектируемыми ledger-corruption'ами (fingerprint, idempotency key, metadata, amount).

**Temporal cutoff hardening (Phase 3B.3.1).** `asOf` is an internal/test-only dependency and is never accepted from an HTTP payload or query. A top-level LevelState resolution or lazy-start command captures exactly one `evaluationTime` (`asOf ?? new Date()`) and reuses it for curriculum context, progress, `resolveEnrollmentXp({ asOf: evaluationTime })`, start timestamps, and concurrent-start recovery. V2 XP rows count iff `createdAt <= evaluationTime`; equality is inclusive and future rows cannot create `available`, `xp_eligible`, or start authorization. The same transaction client carries curriculum/progress/XP reads, so there is no nested transaction or mixed snapshot. Temporal tests anchor cutoffs to the durable `XPTransaction.createdAt` returned by the production command; the command still owns `createdAt` and its public input remains unchanged.

## 5.10 Trusted award command

There is no generic client-callable `awardXp(amount,source,target,...)`. The internal primitive accepts a discriminated, owner-created object unavailable to route payload mappers. It derives target/pin/definition/amount/source/key/metadata from durable owner records.

Owner adapters:

- assessment owner: passed, final assessment attempt → `assessment_pass`;
- report owner: one terminal approved review → `report_approval`;
- mentor owner: one terminal mentor completion → `mentor_completion`;
- ordinary eligible level-completion owner → `level_completion`;
- promo owner: committed `PromocodeRedemption` → `promocode`;
- version migration owner: approved migration run/line → `migration_adjustment`;
- admin correction owner: separate authorized correction request with mandatory reason → `admin_correction`.

Checkpoint/external-event owners verify evidence and invoke completion, not arbitrary XP. For deposit, withdrawal, balance-loss/check and real/demo-trade based definitions, publication/command validation requires `xpReward=0`; completion creates no XP row. Pocket registration or another non-financial external event may award only a definition-owned `level_completion` if product definition permits it. Client input never supplies amount, source, curriculumVersionId, level/user target, metadata or idempotency namespace.

## 5.11 Atomic level completion transaction

Future owner-specific command runs one DB transaction:

1. Validate required flags and authenticated owner authorization before sensitive lookup; inside tx revalidate actor/target state.
2. Load valid active enrollment and exact published/archived pin.
3. Load `enrollment.currentLevel`, immutable definition and matching progress; reject cross-version/non-current/terminal contradiction.
4. Validate owner-specific durable evidence (passed attempt, approved report, mentor completion, checkpoint/external event) and its ownership.
5. Derive canonical completion identity/key/fingerprint.
6. Resolve XP in the same snapshot; validate sequence/XP/checkpoint without bypass.
7. Insert XP row only when allowed `xpReward > 0`, with server-derived amount/source. Prohibited financial/trade completion inserts none.
8. Transition progress once to `completed`, set completion method/evidence reference/timestamps.
9. Advance `highestCompletedLevel/currentLevel`, `lastMeaningfulActionAt`, and terminal `completedAt` exactly once; create next progress only under its owner/start policy.
10. Insert success audit in the same transaction.
11. Insert notification outbox in the same transaction if outbox policy is chosen; otherwise post-commit notification is best-effort and explicitly not part of success atomicity.

Duplicate handling first validates the stored completed progress, enrollment summary and XP row (or expected zero-award). Exact duplicate returns original completion without writes. It never increments current level twice, creates another transaction/audit/notification, or touches timestamps. Collision/partial state is corruption, not duplicate success.

Owner boundaries:

- assessment/report/mentor owner owns evidence transition and calls completion inside the same transaction;
- checkpoint owner owns verified checkpoint state; XP remains zero for financial events;
- external-event owner owns durable deduplicated event; event+completion must share one transaction or durable repair/outbox state so a duplicate cannot skip completion;
- lesson/manual owner may have a narrow authenticated lesson command, but no universal route accepting arbitrary level completion.

## 5.12 Promocode compatibility and concurrency

### Current facts

V1 route checks active window, expiry, `maxUses` and `usedCount` before the transaction; then counts per-user redemptions before the transaction. The tx creates one redemption, increments `usedCount`, and optionally writes V1 XP/reward/achievement. Audit/notification occur after commit. There is intentionally no unique `(promocodeId,userId)` because `perUserLimit` may exceed one. There is no request idempotency. Parallel requests can both pass counts and exceed global/per-user limits; retry after a lost success can redeem again. Mutation failure inside tx rolls back redemption/counter/XP together, but post-commit audit/notification failure does not.

### Implemented Phase 3B.5 algorithm

Migration `20260714030000_promocode_redemption_idempotency` adds a separate `PromocodeRedemptionRequest` history table. It stores `(userId,requestId)`, canonical SHA-256 request fingerprint, the exact redemption/promo ownership, nullable positive `xpAwarded` snapshot and optional V2 transaction relation. Composite parent keys exist only for FK ownership and begin with already-unique IDs. There is no unique `(promocodeId,userId)`, so `perUserLimit > 1` remains valid. All new history FKs use `RESTRICT`; existing rows are not backfilled and the table is empty after upgrade.

The existing `POST /api/promocodes/redeem` boundary uses authentication/active user → rate limit → CSRF → strict key/body validation → service. First-party callers send a UUID `Idempotency-Key` and retain it after a network/5xx outcome. A legacy caller without the header receives a generated key in both response body and header. That request is concurrency-safe, but a client that loses the response cannot identify a retry unless it resends the returned key.

One interactive transaction performs exact request lookup first, promo/window/counter validation, in-transaction per-user count, conditional `usedCount < maxUses` claim (or one unlimited increment), redemption, V1 reward, optional V2 award/audit and durable request result. Existing `usedCount != redemption count` is typed corruption and is never repaired silently. A failure at any later stage rolls back the counter, redemption, V1 XP/event, V2 XP/audit and request result together.

SQLite busy/locked/transaction-contention errors retry the whole transaction, including all counts and the exact request lookup. Retry is exponential but capped and bounded at eight attempts. Validation, limit, collision and unknown database errors are never retried or converted to success. Parallel regression proves one winner for a shared request, one winner at `perUserLimit=1`, exactly two winners at `perUserLimit=2`, and global `maxUses` across users.

### Enrollment states and dual-write

- V2 dual-write is evaluated only on the first new XP promocode redemption and requires READ+ENROLLMENT+XP flags together.
- A valid active enrollment pinned to published or archived definitions receives V1 `User.xp`/`XpEvent` plus one `XPTransaction(sourceType=promocode, sourceId=redemptionId, levelDefinitionId=null)` in the same transaction. A newer published version never repins it.
- Candidate/no enrollment, completed history, or any incomplete/off flag matrix stays V1-only. No enrollment, backfill or terminal-history mutation is created.
- Enabled corrupt V2 state fails closed and rolls back the entire redemption.
- Durable request history freezes the original mode. V1-only retry remains V1-only after flags turn on. Dual-write retry verifies the stored XP relation even after flags turn off and never adds another award.

Legacy `PROMOCODE_REDEEMED` audit and notification remain awaited post-commit only for `created=true`; exact retry emits neither. There is still no transactional outbox, so a post-commit delivery failure can lose those best-effort side effects and is an explicit Phase 3+ limitation. The transactional `CURRICULUM_XP_AWARDED` audit remains part of the V2 award and rolls back both ledgers on failure.

## 5.13 Audit and safe metadata

Proposed success actions:

- `CURRICULUM_XP_AWARDED` for automated owner awards;
- `CURRICULUM_XP_MIGRATION_ADJUSTED`;
- `CURRICULUM_XP_ADMIN_CORRECTED`;
- owner completion actions such as `CURRICULUM_LEVEL_COMPLETED` remain separate but share correlation identity.

Audit includes actor ID (nullable system actor only under explicit policy), target user ID, enrollment/version/level IDs, source type/source ID, XP transaction ID, amount, reason code, idempotency-key hash suffix/correlation ID, and schema version. Admin/migration actions require nonempty bounded human reason and request/ticket identifier. Metadata allowlist excludes secrets, session/cookies, email/password, raw provider/postback payload, assessment/report/mentor content, arbitrary evidence JSON, promo code plaintext where sensitive, env/path/error stacks and PII.

Success audit is inserted inside the same transaction and audit failure rolls back award/completion. Rejected business attempts may write a sanitized audit in a separate transaction only after the failed business transaction is fully rolled back; expected duplicate success creates no new audit. Infrastructure errors are logged through sanitized operational telemetry, not converted into misleading rejected domain audit.

Notification policy is open. Recommended durable option is transactional outbox with unique event identity, then idempotent delivery. If existing post-commit notifications are retained temporarily, they must be documented as best-effort and must never determine/repeat XP success.

## 5.14 Future API boundary

No routes are created in Phase 3A.

- Extend `GET /api/curriculum/v2/current` with safe enrollment `currentXp` and XP requirements only when READ+XP are on; preserve current payload when XP off.
- Optional `GET /api/curriculum/v2/xp` returns owner-only paginated safe history, ordered `(createdAt desc,id desc)`, without raw metadata/internal idempotency key.
- Admin correction gets a dedicated route/command, never reuse admin user PATCH. Require XP flag → session → active admin with explicit permission → rate limit → CSRF → strict body → target/enrollment validation → command.
- Assessment/report/mentor/checkpoint/external-event completion remains owner-specific and cannot accept arbitrary target/version/level/amount/source. External provider routes authenticate provider before lookup and use durable event identity.
- User reads: flag before auth for hidden route, then active session, strict empty/allowlisted query, owner scope, no-store. Admin writes: flag → auth/permission → rate limit → CSRF → validation. All errors sanitized; corrupt state is 409, product unavailable is typed, infrastructure failure is 500.

## 5.15 Migration plan

Recommended additive sequence:

1. **Phase 3B.1 migration:** add `CurriculumXpSourceType` Prisma enum, inverse relations, parent `@@unique([id,userId,curriculumVersionId])`, `XPTransaction`, indexes/FKs/CHECKs. No V1 table ALTER/DROP/RENAME. SQLite enum remains TEXT plus manual CHECK.
2. **Phase 3B.5 promo migration:** additive `PromocodeRedemptionRequest` table with durable request/result identity, ownership FKs and exact-replay indexes. Do not add promo/user unique and do not backfill legacy redemption.
3. **Optional outbox migration:** separate prompt/decision if transactional notification policy is accepted.

Each migration SQL must be semicolon-splitter compatible: no trigger bodies or semicolon literals. Apply only to temporary SQLite in future regression. No seed, V1 backfill or production DB. Verify FK lists, CHECK behavior, partial/compound indexes and migration order.

Rollback for an unused Phase 3 schema is reverse dependency order: outbox/promo indexes or fields per migration strategy, then XP indexes/table, then parent composite index; remove `_prisma_migrations` row only in controlled throwaway/manual rollback. Once real XP rows exist, destructive rollback is forbidden; disable flag and roll forward.

## 5.16 Regression plan

Minimum future groups:

1. Schema creates exact table/source/positive CHECKs and indexes; V1 schema unchanged.
2. Triple enrollment FK rejects wrong user/version; level composite FK rejects cross-version level; archived pin accepted, draft pin corrupt.
3. RESTRICT history and absence of update/delete domain surface; mutation static scan.
4. Award creates one positive row with canonical key/fingerprint and safe metadata.
5. Exact retry/P2002 race returns original without timestamp/audit/notification/progression changes.
6. Same key with different amount/source/target/fingerprint fails collision.
7. Resolver sums only one enrollment, never `User.xp`/`XpEvent`; deterministic ordering/count.
8. Invalid amount/source/fingerprint and aggregate overflow fail closed.
9. LevelState insufficient/sufficient XP, `xp_eligible`, maximum-one-available.
10. XP cannot bypass sequence/checkpoint/definition/visibility; flag off retains `xp_engine_unavailable`.
11. Atomic completion failure injected at ledger/progress/enrollment/audit rolls back everything.
12. Duplicate completion and owner-evidence collision do not advance twice.
13. Prohibited trade/deposit/withdrawal/balance completion creates zero XP rows.
14. Parallel promo redemption respects `maxUses` and `perUserLimit`, including `perUserLimit > 1`; request retry is idempotent.
15. Promo dual-write policy, no-enrollment and completed/archived behavior match approved decision.
16. V1 task/report/mentor/Pocket/daily/referral/promo/admin flows remain compatible with XP flag off.
17. Full flag matrix and HTTP auth/role/rate-limit/CSRF/order/no-store/sanitization.
18. Populated V1 upgrade snapshots all XP-related rows and proves no automatic backfill.
19. Cumulative Phase 1 and Phase 2 gates remain green and are invoked from the Phase 3 completion gate.

## 5.17 Open decisions

| Decision | Facts | Options | Recommendation / trade-off | Blocks / deadline |
|---|---|---|---|---|
| Enrollment ownership | Phase 2 has stable version-pinned enrollment; V1 user XP mixes sources | User+version vs enrollment+version discriminator | Enrollment ownership; extra columns/indexes buy historical isolation and DB FK protection | Must freeze in 3B.1 |
| Negative correction | Product says no deductions; source allowlist includes admin correction | Positive-only; signed ledger; separate reversal model | Positive-only CHECK now. Signed rows require explicit product reversal and broader policy | 3B.1 schema/admin correction |
| XP transfer on version migration | No automatic migration/backfill; historical pins retained | No transfer; curated amounts; rule-based transfer | Separate migration run with explicit per-row adjustments and preview/audit; default no transfer | Before version migration feature, not 3B.1 |
| Promo dual-write | V1 active; V2 promo must be able to gate; authorities separate | V1-only; V2-only for enrolled; atomic dual-write | Atomic dual-write for active V2 enrollment during coexistence; more complexity but preserves V1 UX | Must decide before 3B.5 |
| Promo after completion/archived pin | Terminal history must not mutate | V1-only; mutate terminal V2; reject promo | V1-only and no historical V2 write; simplest immutable terminal semantics | Before 3B.5/API wording |
| Admin correction permission | Current admin PATCH can overwrite XP | Any admin; dedicated permission; dual approval | Dedicated permission and mandatory reason/request ID; dual approval for high threshold is preferred | Before admin route, no later than 3B.6 |
| Completion evidence identity | V1 report/mentor share route; assessment models absent | Progress ID only; owner record ID; composite attempt | Owner durable terminal record ID, with progress/enrollment in key/fingerprint | Before 3B.4 and each owner adapter |
| Notification transaction policy | Current notifications are post-commit and may be lost/repeated | Best-effort; transactional outbox | Outbox for completion/XP; adds schema/worker scope, so approve separately | Before 3B.4 implementation |
| Promo request serialization | Current count-before-write races | DB conditional write lock/retry; counter table; slot rows | Conditional `Promocode.usedCount` update first + in-tx recount + bounded SQLite retry; add counter table only if provider portability requires | 3B.5 |

## 5.18 Phase 3 decomposition

### Phase 3B.1 — XP schema foundation

**Implementation status:** schema foundation реализован одной additive migration `20260714020000_xp_transaction_foundation`. Ledger остаётся пустым после upgrade; award/resolver/runtime отсутствуют.

- **Scope:** exact enum/model/inverse relations, parent composite unique, additive migration, schema/cross-version/upgrade regressions, design doc sync.
- **Forbidden:** resolver, award/completion, promo route, API/UI, seed/backfill, flags/live.
- **Acceptance:** CHECK/FK/index tests; wrong user/version/level rejected; V1 populated rows byte-equivalent; Prisma format/validate/generate and cumulative gates only as explicitly requested by that prompt.
- **Expected files:** `prisma/schema.prisma`, one migration, new schema regression, package gate wiring, docs update.
- **Dependencies/stop:** negative-policy and ownership frozen; stop if populated upgrade or parent uniqueness cannot be added without data risk.

### Phase 3B.2 — Immutable ledger and XP resolver

- **Implementation status:** internal runtime foundation реализован. `CURRICULUM_V2_XP_ENABLED` читается динамически и по умолчанию выключен; `resolveEnrollmentXp` и transaction-aware `recordCurriculumXp` не подключены к HTTP, LevelState или owner flows.
- **Runtime identity:** service принимает только trusted enrollment/source identity, optional same-version level, positive amount, nullable active actor и safe metadata. User/version/key/fingerprint/timestamp выводятся или строятся на сервере. Stored key format: `xp:v2:<source-kebab>:<enrollmentId>:<encoded-sourceId>`; migration identity `<runId>:<sequence>` и admin correction используют утверждённые Phase 3A layouts. Fingerprint format — `sha256:<64 lowercase hex>` над canonical JSON contract `xp-v2-fingerprint-v1`.
- **Metadata boundary:** только plain JSON object, максимум 4096 UTF-8 bytes, depth 4, 128 nodes, 64 keys, 64 array elements и 512 chars на string. Prototype, secret/auth/session, raw payload/provider/content/evidence keys и non-JSON values запрещены.
- **Atomicity/idempotency:** insert и `CURRICULUM_XP_AWARDED` audit выполняются одним transaction client; exact retry возвращает durable row с `created=false`, expected P2002 перечитывается и проверяется, collision и неизвестный Prisma error не маскируются как success.

- **Scope:** future flag/config, internal award primitive, fingerprint/idempotency/P2002 handling, read-only resolver, focused regressions.
- **Forbidden:** completion transition, promo adaptation, public API, admin correction route, V1 changes.
- **Acceptance:** exact retry/no-op, collision, sum/range/corruption/archived pin, static no-mutation scan, flag off no writes.
- **Expected files:** env flag helper/example placeholder, `src/lib/curriculum/xp*.ts`, regression scripts/package wiring.
- **Dependencies/stop:** 3B.1 green; stop on ambiguous source identity/negative policy.

### Phase 3B.3 — XP-aware LevelState

- **Scope:** integrate resolver snapshot, typed XP blocker and `xp_eligible`, read mapper changes only if prompt permits, regression.
- **Forbidden:** completion, checkpoint implementation, owner adapters, promo/API rollout.
- **Acceptance:** sufficient/insufficient XP, sequence/checkpoint non-bypass, one available, disabled/corrupt fail closed, no V1 reads.
- **Expected files:** `level-state.ts`, types/read mapper as needed, LevelState regressions/docs.
- **Dependencies/stop:** 3B.2; stop if checkpoint state semantics needed beyond existing blocker.

### Phase 3B.4 — Atomic completion transition foundation

- **Implementation status:** complete. `completeCurriculumLevel` owns one interactive transaction and returns a safe discriminated result; `completeCurriculumLevelInTransaction` uses an owner-supplied transaction client without nesting. No HTTP route or owner storage was added.
- **Trusted input:** enrollment ID, level definition ID, one approved completion source, stable source identity, nullable actor and one captured evaluation time. User/version/level number, reward, key, fingerprint, evidence, desired status and next-level fields are server-derived or forbidden.
- **Unambiguous owner map:** `lesson + (lesson|manual) -> level_completion/in_progress`; `final_exam + assessment_pass -> assessment_pass/in_progress`; `report + report_approval -> report_approval/pending_review`; `mentor_review + mentor_review -> mentor_completion/pending_review`. Scenario, practice, external-event and checkpoint definitions fail closed as `COMPLETION_OWNER_UNAVAILABLE` until their owner contracts exist.
- **Transition:** READ, ENROLLMENT and XP flags are all required. The coordinator validates the published/archived pin, owner, active definitions, contiguous progress and summary state; conditionally claims progress, records definition-owned positive XP through the ledger helper, conditionally advances enrollment, and awaits both XP and completion audits. Final completion persists `highestCompletedLevel=maxLevel`, `currentLevel=maxLevel+1`, `status=completed` and one completion timestamp.
- **Retry/concurrency:** exact retry validates the full ledger plus canonical key/fingerprint and returns `created=false` without writes. Completed-without-XP and XP-without-completion are corruption. Progress and enrollment use CAS predicates; a CAS loser is re-read once and may recover only as an exact retry. Unknown database errors are not converted into success or retry recovery.
- **Notification policy:** no notification/outbox exists in this phase. Completion does not emit best-effort notification, CRM or other fire-and-forget effects.
- **Scope:** internal transaction coordinator, ordinary zero/level completion adapter foundation, durable owner interface, audit and chosen notification policy, fault-injection regression.
- **Forbidden:** generic public completion route; fake assessment/checkpoint/report/mentor evidence; promo changes.
- **Acceptance:** all ten state transitions atomic, duplicate no-op, rollback injection, financial/trade zero XP, cross-version rejection.
- **Expected files:** curriculum completion service/constants/types, audit/outbox files only if approved, regression scripts.
- **Dependencies/stop:** 3B.3 plus evidence identity and notification decisions; stop rather than invent missing owner models.

### Phase 3B.5 — Promocode compatibility/concurrency

- **Implementation status:** complete. The existing redeem route delegates to the typed atomic coordinator, first-party callers send stable per-operation keys, and legacy missing-key requests receive a generated key. The additive request-history table preserves `perUserLimit > 1`; no legacy row is rebuilt or backfilled.
- **Transaction:** request replay, counter consistency, per-user limit, atomic global claim, redemption, V1 reward, optional V2 XP/audit and request result share one transaction. SQLite lock retry is whole-transaction, capped and bounded. Legacy success audit/notification remain post-commit only for a new result.
- **V2 matrix:** READ+ENROLLMENT+XP plus valid active published/archived pin dual-writes. Candidate, completed history, absent enrollment and incomplete/off flags remain V1-only. Corruption rolls back. Retry preserves the originally stored mode across later flag changes.
- **Scope:** approved promo migration, request identity, atomic limits/expiry/rollback, active-enrollment V2 adapter and dual-write policy.
- **Forbidden:** unique `(promocodeId,userId)`, implicit enrollment, referral/daily changes, unrelated promo UI.
- **Acceptance:** parallel/global/per-user tests, `perUserLimit > 1`, exact retry/collision, no enrollment, active, completed/archived, dual-ledger rollback.
- **Expected files:** promo schema migration if required, redeem service/route adapter, XP owner adapter, regressions/docs.
- **Dependencies/stop:** 3B.2 and decisions on dual-write/terminal behavior/serialization.

### Phase 3B.6 — XP read API and Phase 3 completion gate

- **Scope:** safe current-curriculum XP summary/history contract, dedicated admin correction only if permission policy approved, security tests, cumulative Phase 3 gate/completion doc.
- **Forbidden:** rollout/flag enable, UI, V1 response break, version migration, referral/daily V2.
- **Acceptance:** auth/role/rate-limit/CSRF/flag order, pagination/no-store/allowlist, admin reason/idempotency, populated upgrade, cumulative Phase 1/2/3 gates.
- **Expected files:** narrow routes/mappers, correction service if approved, regression/gate scripts, completion docs.
- **Dependencies/stop:** 3B.1–3B.5 green; stop if permissions or public history fields remain undecided.

## 6. Phase 3 status

Phase 3B.5 adds atomic promocode compatibility on the existing endpoint. Request identity, `maxUses`, `perUserLimit`, V1 reward and optional active-enrollment V2 XP now commit or roll back together; exact retry is a durable no-op and the initial V1-only/dual-write choice is preserved. Archived pins are eligible, completed/candidate contexts remain V1-only, and no enrollment/backfill is created. Phase 3B.6 XP read/API completion gate remains unstarted.

Phase 3A была design-only. Phase 3B.1 реализовала schema foundation. Phase 3B.2 добавила выключенный по умолчанию internal ledger service и read-only resolver: XP суммируется только из `XPTransaction` одного enrollment, archived pin поддерживается, draft/cross-owner/cross-version/range corruption fail closed. `currentXp` cache и `levelNumber` не добавлены; V1 XP никогда не читается как V2 authority. Phase 3B.5 делает только явно утверждённый atomic promo dual-write, сохраняя V1 и V2 отдельными authorities. Phase 3 завершена на 5 из 6 частей (83,3%).

DB гарантирует positive amount/source allowlist, required fingerprint, uniqueness, ownership и delete policy. Service boundary дополнительно не экспортирует update/delete, принимает только validated trusted award identity, строит key/fingerprint server-side и пишет awaited audit атомарно. Privileged raw SQL по-прежнему технически может выполнить `UPDATE` или `DELETE`, потому что triggers намеренно отсутствуют ради совместимости custom migration runner.

---

*Документ не содержит secrets, credentials, реальных user/provider payloads или live env values.*
