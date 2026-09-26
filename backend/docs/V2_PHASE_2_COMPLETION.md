# ATA V2 — Phase 2 Completion

**Дата:** 2026-07-14
**Исходный HEAD:** `ce9e780fff744ecd8b8838da8a7108a4ff9a7604`
**Статус:** Phase 2 completion gate; rollout и включение flags запрещены.

## 1. Реализованный scope

Phase 2 добавляет поверх Phase 1 две durable-модели `UserCurriculumEnrollment` и `UserLevelProgress`, read-only resolver опубликованной/закреплённой версии, controlled admin enrollment command, effective Level State resolver, actor-only lazy start и один authenticated owner-read endpoint:

`GET /api/curriculum/v2/current`

Mutation API, self/automatic enrollment, completion transitions, XP ledger/calculation, checkpoint/report/mentor/entitlement/content/assessment runtime, UI, seed/backfill, re-enrollment и version migration не реализованы.

## 2. Модели и migration inventory

- `UserCurriculumEnrollment`: exact version pin, `active | completed | superseded`, summary cache (`highestCompletedLevel`, `currentLevel`), meaningful-action/completion timestamps и immutable origin field.
- `UserLevelProgress`: один row на enrollment+level, persisted `in_progress | pending_review | completed`, progress/completion timestamps, nullable method/evidence и attempt counter.
- История защищена `RESTRICT`; cross-version progress закрыт composite FK; один active enrollment на user+curriculum закрыт partial unique index.
- Phase 1 migration: `20260714000000_curriculum_versioning_foundation`.
- Phase 2 migration: `20260714010000_curriculum_enrollment_progress_foundation`.
- Phase 2B.5 не изменяет Prisma schema и не добавляет migration.

## 3. Feature flags

- `CURRICULUM_V2_ADMIN_ENABLED=false` — Phase 1 authoring API.
- `CURRICULUM_V2_READ_ENABLED=false` — Phase 2 resolver и user read endpoint.
- `CURRICULUM_V2_ENROLLMENT_ENABLED=false` — controlled enrollment/lazy-start writes.

Все defaults остаются false. Read endpoint зависит только от READ flag; ADMIN и ENROLLMENT не расширяют и не блокируют его. Rollout/live env в Phase 2 не меняются.

## 4. Resolver contracts

`resolvePublishedCurriculum` выбирает единственную effective published версию `ata-v2`, детерминированно сортирует definitions и fail-closed возвращает typed unavailable/corrupt вместо silent winner.

`resolveUserCurriculumContext` возвращает `candidate | enrolled | completed | unavailable | corrupt`: active enrollment всегда pinned к точной published/archived версии; completed terminal; superseded без replacement — contradiction; read не создаёт enrollment/progress и не касается timestamps.

`resolveUserCurriculumLevelStates` сохраняет persisted states без переинтерпретации и вычисляет только `available | locked`. Максимум один available — current level без progress при выполненной последовательности и поддержанных gates.

## 5. Enrollment и lazy start

Controlled enrollment требует active admin и одновременно READ+ENROLLMENT. Target — trusted `ata-v2` published resolver; caller не выбирает version/code/initial state. Создание enrollment и awaited `CURRICULUM_USER_ENROLLED` audit атомарны. Existing valid active возвращается `created=false`; completed блокирует re-enrollment; P2002 принимается только после валидирующего reread.

Lazy start принимает только actor identity. Только current `available` создаёт один `in_progress` row (`attemptCount=0`), обновляет только `lastMeaningfulActionAt` и пишет awaited `CURRICULUM_LEVEL_STARTED` audit в той же transaction. Existing current `in_progress | pending_review` — no-op без timestamp/audit.

## 6. HTTP contract

Успех всегда `200 { "data": <union> }`:

- `candidate`: `kind`, safe published curriculum summary с counts, `enrollment:null`; уровни не маркируются available и enrollment не создаётся.
- `enrolled`: `kind`, curriculum `code/name/versionNumber/status/effectiveFrom/publishedAt`, safe enrollment summary, детерминированные modules/levels, `durableStatus`, `presentationState`, stable `blockers`, allowlisted progress timestamps/status/method/attempt count.
- `completed`: terminal safe curriculum/enrollment history и allowlisted persisted level progress; candidate/re-enrollment не создаются.
- `unavailable`: `kind` и stable reason (`no_published_version | not_effective_yet`); это product state, поэтому HTTP 200.

Corrupt state: HTTP 409 `{ "error":"CURRICULUM_STATE_CORRUPT", "reason":<typed-code>, "issues":[{"code":<typed-code>}] }`. Infrastructure failure: sanitized HTTP 500 `INTERNAL_ERROR`.

## 7. Security matrix и allowlist

Порядок route: READ flag → session authentication → active-user check → empty-query validation → context resolver → level-state resolver для enrolled → allowlist mapper.

- flag off: 404 `{error:"NOT_FOUND"}` до auth;
- anonymous: 401;
- non-active/blocked session user: 403;
- любой query parameter, включая `userId`, `actorId`, `asOf`, `version`, `level`: 400;
- identity берётся только из session; GET не требует CSRF;
- все ответы имеют `Cache-Control: no-store`;
- endpoint не пишет audit/notifications/enrollment/progress и не обновляет timestamps.

Mapper не сериализует Prisma objects напрямую. Запрещены session/cookie data, email/role/password, internal IDs, `createdBy*`, audit metadata, `migrationSource`, `completionEvidence`, raw `visibilityRule`, raw errors/paths/env/secrets, V1 XP/progression и `currentXp`. `requiredXp` — только definition requirement, не вычисленный XP пользователя.

## 8. Fail-closed dependencies

До профильных фаз сохраняются stable blockers:

- `not_current_level`;
- `sequence_incomplete`;
- `definition_inactive`;
- `xp_engine_unavailable`;
- `checkpoint_engine_unavailable`;
- `visibility_rule_unsupported`.

`xp_eligible`, `hidden`, `temporarily_suspended`, checkpoint eligibility, entitlement, report и mentor state не вычисляются.

## 9. V1 compatibility

V1 `Task`, `UserTaskProgress`, `Level`, `User.level/xp/currentTask`, checkpoint/report, Pocket/postbacks и существующие API не заменены V2. Populated V1 upgrade сохраняет rows, PK, relations и CRUD; migrations idempotent; seed не требуется. Phase 2 read API regression отдельно подтверждает `/api/levels` с реальной session и `/api/health`.

## 10. Regression и completion gate

- Phase 2B.1 enrollment schema: 29.
- Phase 2B.2 resolver: 34.
- Phase 2B.3 enrollment command: 37.
- Phase 2B.4 level state/start: 40.
- Phase 2B.5 real HTTP read API: 40.
- populated V1 upgrade: 13.
- Phase 1 cumulative gate: 210 (22+34+38+13+39+43+21).

`test:regression:curriculum-phase2` выполняет эти семь стадий строго последовательно, останавливается на первом failure, сохраняет stderr/exit code и проверяет отсутствие test listeners и временных DB/runtime artifacts. Фактически выполняется 403 successful assertions; upgrade suite намеренно повторяется внутри Phase 1 cumulative compatibility gate, поэтому unique suite assertions — 390.

## 11. Phase 3+ и pre-existing backlog

Следующие фазы отдельно определят XP ledger/projection, completion/unlock transitions, checkpoint verification, report/mentor workflow, entitlements, content/assessment runtime, UI, seed/backfill, re-enrollment/version migration и retention/anonymization.

Сохраняются pre-existing backlog items, не созданные Phase 2: `User.referralCode` migration/schema drift; `ChatMessage.channelId` FK drift; отсутствие `migration_lock.toml`; `postback_received` для no-op withdrawal; fallback fingerprint без `transaction_id`; hardcoded admin password; simulated balance event semantics; distributed rate-limit/shared store; реальный balance provider. Исторический пункт promocode concurrency закрыт отдельно в Phase 3B.5 atomic request/counter implementation.

## 12. Completion decision

Phase 2 считается завершённой только при зелёных cumulative gate, Prisma format/validate/generate, lint, `tsc --noEmit`, build и `git diff --check`, при неизменных schema/migrations/package-lock и отсутствии runtime artifacts/listeners. Rollout остаётся запрещённым; все curriculum flags остаются false; live project, Docker, nginx и production DB не затрагиваются.

---

*Документ не содержит secrets, паролей, реальных пользовательских данных или live env values.*
