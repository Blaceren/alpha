# ATA V2 — Phase 1 Completion

**Статус:** completion gate Phase 1 (cumulative compatibility & completion review)
**Дата:** 2026-07-14
**Диапазон Phase 1:** `55de70fe` (baseline после withdrawal-hardening) → `5d05bf3` (definitions admin API)
**Связанные документы:** `V2_GAP_ANALYSIS.md`, `V2_PRODUCT_DECISIONS.md`, `V2_PHASE_1_SCHEMA_DESIGN.md`

Gap Analysis задним числом не изменялся.

---

## 1. Scope Phase 1

Curriculum V2 versioning foundation — параллельно V1, за feature flag, без пользовательских функций:
additive schema (3 модели), одна аддитивная migration, domain validation, publication lifecycle (publish/replace/archive), draft authoring (version/module/level CRUD), feature-gated admin API (versions + modules + levels), audit, V1 compatibility. НЕ входит: enrollment, progression, XP-начисление, checkpoint-runtime, content/assessments, entitlements, public API, admin UI, seed уровней 1–100.

## 2. Реализованные models/enums

Enums: `CurriculumVersionStatus` (draft|published|archived), `CurriculumDefinitionStatus` (active|disabled), `LevelDefinitionType` (external_event, lesson, scenario, practice, report, mentor_review, financial_checkpoint, final_exam).
Модели: `CurriculumVersion` (code, name, status, versionNumber, effectiveFrom, publishedAt, createdById→User SetNull, changeNotes), `ModuleDefinition` (moduleNumber, code, title, description, firstLevel, lastLevel, checkpointLevel?, learningObjective, status), `LevelDefinition` (levelNumber, stableCode, type, тексты, completionMethod, xpReward, requiredXp, requiredPreviousLevel?, requiredCheckpointLevel?, featureUnlockCode?, visibilityRule Json?, status). В `User` — только виртуальный relation-список (SQL-таблица User не менялась).

## 3. Migration и compatibility

Одна аддитивная migration `20260714000000_curriculum_versioning_foundation`: 3 CREATE TABLE + 11 индексов + 1 partial unique index (`CurriculumVersion_code_published_key WHERE status='published'`). Ни одного ALTER/DROP/RENAME существующих V1-таблиц. FK: version→module/level RESTRICT, level→module composite (moduleId, curriculumVersionId), createdById SET NULL; всё ON UPDATE CASCADE. Совместима с кастомным runner'ом `prisma/migrate.ts` (сплит по `;`, нет `;` внутри литералов). Rollback = DROP трёх таблиц в обратном порядке FK + удаление записи из `_prisma_migrations`.

## 4. Stable code contract

`v2.lNNN.<lowercase-kebab-slug>` — lowercase, три цифры номера, kebab-slug; NNN совпадает с levelNumber. Уникальность per-CurriculumVersion (`@@unique([curriculumVersionId, stableCode])`); тот же код разрешён повторно в новой версии. Regex — на service/Zod-слое. V1 task codes (`lvl_01_*`…`lvl_16_*`) не меняются.

## 5. Draft authoring

`src/lib/curriculum/authoring.ts` (9 команд): createCurriculumDraft / updateCurriculumDraft / deleteEmptyCurriculumDraft; createModuleDefinition / updateModuleDefinition / deleteEmptyModuleDefinition; createLevelDefinition / updateLevelDefinition / deleteLevelDefinition. Все: Zod strict DTO → active-admin actor → assertCurriculumEditable → mutation + success-audit в одной транзакции (audit не проглатывается). Write-time валидация — локальная корректность одного объекта; пересечения диапазонов/последовательность/checkpoint-ссылки — publish-time. Immutable identity-поля; безопасное удаление только пустых draft/module (RESTRICT). No-change PATCH → 409 (CURRICULUM/MODULE/LEVEL)_NO_CHANGES без ложного audit.

## 6. Validation

`validateCurriculumDraft` (pure, без DB, все issues за один проход): версия (draft, versionNumber>0, code/name, publishedAt=null, effectiveFrom не в будущем, visibilityRule=null); модули (≥1 active, disabled блокирует publish, номера с 1 без дыр, диапазоны без пересечений/дыр, первый с level 1, checkpointLevel в диапазоне); уровни (≥1 active, номера с 1 без дыр, уровень в диапазоне модуля, каждый номер диапазона покрыт ровно одним active-уровнем, формат stableCode + NNN==levelNumber, requiredPreviousLevel: null для 1 и levelNumber-1 далее, requiredCheckpointLevel назад на существующий financial_checkpoint, module.checkpointLevel → financial_checkpoint).

## 7. Publish/archive lifecycle

`publishCurriculumVersion({curriculumVersionId, actorId, expectedPublishedVersionId?})`: active-admin → snapshot → строго draft → effectiveFrom не в будущем → validateCurriculumDraft → replacement-протокол (существующая published требует её ID: отсутствие → REPLACEMENT_REQUIRED, несовпадение → REPLACEMENT_MISMATCH, совпадение → атомарно archived) → target published+publishedAt=now → audit в той же tx (сбой откатывает всё). Partial unique index — финальная DB-защита от race. `archiveCurriculumVersion`: только published→archived (draft/повторный → NOT_PUBLISHED), definitions не меняются. `assertCurriculumEditable`: published→PUBLISHED_IMMUTABLE, archived→ARCHIVED_IMMUTABLE.

## 8. Audit

Все успешные mutation-и пишут audit awaited ВНУТРИ транзакции (userId=session actor; metadata: actorId, curriculumVersionId, moduleDefinitionId/levelDefinitionId, code/number, changedFields; без before/after payload, контента, secrets). Actions: CURRICULUM_VERSION_PUBLISHED/REPLACED/ARCHIVED, CURRICULUM_DRAFT_CREATED/UPDATED/DELETED, MODULE_DEFINITION_*, LEVEL_DEFINITION_*. Rejected publication → CURRICULUM_PUBLICATION_REJECTED пишется best-effort ВНЕ откатанной транзакции (fire-and-forget helper) — не источник истины.

## 9. Admin API routes

Все под `/api/admin/curriculum/` за feature flag:
- GET/POST `/versions`; GET/PATCH/DELETE `/versions/[id]`; POST `/versions/[id]/publish`; POST `/versions/[id]/archive`;
- POST `/versions/[id]/modules`; PATCH/DELETE `/versions/[id]/modules/[moduleId]`;
- POST `/versions/[id]/levels`; PATCH/DELETE `/versions/[id]/levels/[levelId]`.
GET для module/level отдельно нет — их отдаёт GET detail версии. Ответы: `{data}` (201 для create) / `{error, issues?}`. Read-only query (`query.ts`): list (пагинация, createdAt desc/id desc, moduleCount/levelCount, safe createdBy) и detail — без audit.

## 10. Feature flag

`CURRICULUM_V2_ADMIN_ENABLED` (env, default/отсутствие = false; placeholder в `.env.example`). При выключенном — все routes 404 `{error:"NOT_FOUND"}` (проверяется ДО auth, маршрут не раскрывается). В live не включён.

## 11. Security matrix (все curriculum admin routes)

Порядок write-request (gateCurriculumAdmin): feature flag → session auth (401) → active admin (403; blocked→403) → shared rate limit (429) → CSRF (403) → strict body/path validation (400) → path ownership → domain service → safe response.

| Route | Flag→404 | Auth 401 | Admin 403 | Rate 429 | CSRF 403 | Strict body | Path ownership | Err sanit | GET no-store | Domain svc |
|---|---|---|---|---|---|---|---|---|---|---|
| GET /versions | ✔ | ✔ | ✔ | — (read) | — (GET) | query zod | — | ✔ | ✔ | listCurriculumVersions |
| POST /versions | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | createCurriculumDraft |
| GET /versions/[id] | ✔ | ✔ | ✔ | — | — | id | — | ✔ | ✔ | getCurriculumVersionDetail |
| PATCH /versions/[id] | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | updateCurriculumDraft |
| DELETE /versions/[id] | ✔ | ✔ | ✔ | ✔ | ✔ | id | — | ✔ | — | deleteEmptyCurriculumDraft |
| POST /publish | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | publishCurriculumVersion |
| POST /archive | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | archiveCurriculumVersion |
| POST /modules | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | version editable | ✔ | — | createModuleDefinition |
| PATCH /modules/[mid] | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | assertModuleInVersion→404 | ✔ | — | updateModuleDefinition |
| DELETE /modules/[mid] | ✔ | ✔ | ✔ | ✔ | ✔ | id | assertModuleInVersion→404 | ✔ | — | deleteEmptyModuleDefinition |
| POST /levels | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | assertModuleInVersion→404 | ✔ | — | createLevelDefinition |
| PATCH /levels/[lid] | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | assertLevelInVersion + target module→404 | ✔ | — | updateLevelDefinition |
| DELETE /levels/[lid] | ✔ | ✔ | ✔ | ✔ | ✔ | id | assertLevelInVersion→404 | ✔ | — | deleteLevelDefinition |

Подтверждено статически: прямых Prisma-мутаций V2-моделей из route handlers нет; actorId всегда из сессии (`gate.admin.id`); ресурс чужой версии → 404 (не раскрывается); raw Prisma/SQL/stack/env наружу не попадают (INTERNAL_ERROR + server-side console.error); flag-off проверяется до auth; success audit awaited в транзакции; rejected-audit best-effort. Rate-limit — единый per-admin bucket `curriculum:admin:write:${adminId}` (50/10 мин) на все mutation-и.

## 12. Regression suites

- `curriculum-schema` — 22 (schema foundation, constraints, composite FK, partial index, V1 сохранность);
- `curriculum-domain` — 34 (validation + publish/archive lifecycle + rollback via trigger + partial-index race);
- `curriculum-authoring` — 38 (9 команд, write-time validation, conflict mapping, audit-rollback);
- `curriculum-upgrade` — 12 (populated V1 upgrade + runtime flag off/on + runner-идемпотентность);
- `curriculum-admin-api` — 39 (HTTP: flag off/on, auth, CSRF, rate-limit, contracts);
- `curriculum-definitions-api` — 43 (HTTP: module/level, ownership 404, no-change, shared rate-limit);
- `withdrawal` — 21 (финансовый compatibility guard).
Оркестратор `test:regression:curriculum-phase1` (`curriculumPhase1Gate.ts`) запускает все семь строго последовательно, стоп на первом провале, проброс exit-кода, финальная проверка отсутствия test-listeners. Build одновременно с HTTP-регрессиями не запускается.

## 13. V1 compatibility evidence

- Cumulative `git diff -w prisma/schema.prisma` = +91/-0 (только V2-добавления; V1-модели семантически не тронуты; большой построчный diff — prisma format).
- Ни один V1-migration файл не изменён; добавлена ровно одна curriculum-migration.
- `curriculum-upgrade` на populated V1 DB: все V1-строки, PK, значения и relations неизменны; 3 V2-таблицы существуют и пусты; partial index на месте; V1 CRUD работает; новый draft создаётся; повторный запуск runner не дублирует schema/данные; migration не требует seed; runtime — /api/health OK, V1 authenticated read работает, curriculum routes 404 при flag=false, admin read работает при flag=true.

## 14. Known limitations

- SQLite: enum = TEXT без DB-ограничения; условные правила (immutability, пересечения, последовательность) — service/publish-time, не DB; partial unique index задан вручную в migration SQL.
- Реальный balance-provider отсутствует (наследие MVP) — не в scope Phase 1.
- Rate-limit — in-memory (по одному инстансу); для multi-instance нужен shared store.

## 15. Open backlog (зафиксировано, НЕ исправлялось — не вызвано Phase 1)

User.referralCode migration/schema drift; ChatMessage.channelId FK drift; отсутствие migration_lock.toml; postback_received для no-op withdrawal; fallback fingerprint без transaction_id; promocode concurrency; hardcoded admin password; simulate eventType=balance; admin UI; public curriculum API; seed; feature flag rollout. Ни один пункт не блокирует новые V2-таблицы/API при выключенном флаге.

## 16. Rollout prerequisites

Перед включением флага в любой среде: продуктовое подтверждение остающихся открытых решений (visibilityRule dictionary, completionMethod set, effectiveFrom-семантика, archived-переходы); замена in-memory rate-limit на shared store при multi-instance; отдельная миграционная стратегия для существующих пользователей (Phase 2+); контент/assessment-пайплайн (Phase 4). Применение curriculum-migration к реальной БД — только после `npm run db:backup` и на отдельной среде.

## 17. Что явно НЕ реализовано в Phase 1

Enrollment, progression-движок, XP-начисление за V2, checkpoint-runtime/verification, content/assessment-модели, feature entitlements, public curriculum API, admin UI, seed уровней 1–100, включение флага в live, миграция существующих пользователей.

## 18. Exact commit chain Phase 1

```
ac4476b chore: establish sanitized ATA V2 baseline
c3b70f8 docs: add V2 gap analysis and product decisions (Pre-Phase 0A)
1269f69 docs: add Pre-Phase 0A execution report
713e660 fix: correct Pocket withdrawal event semantics          (Pre-Phase 0B)
55de70f test: harden withdrawal semantics regression            (Pre-Phase 0B.1) — базовая точка Phase 1
5a90bc3 docs: define V2 curriculum schema contract               (Phase 1A)
a79af2f feat: add V2 curriculum versioning schema foundation     (Phase 1B.1)
24419ec feat: add V2 curriculum validation and publication lifecycle (Phase 1B.2)
5067b15 feat: add V2 curriculum draft authoring services         (Phase 1B.3)
95a2efc feat: add feature-gated V2 curriculum admin API          (Phase 1B.4)
5d05bf3 feat: add V2 curriculum definitions admin API            (Phase 1B.5)
<этот>  test: add V2 curriculum Phase 1 completion gate           (Phase 1C)
```

## 19. Phase 1 acceptance checklist

- [x] additive schema, ни одного изменения V1-таблиц;
- [x] ровно одна curriculum-migration, аддитивная;
- [x] domain validation (все issues за проход);
- [x] publication lifecycle (publish/replace/archive) атомарен, с audit-rollback;
- [x] draft authoring (9 команд) через domain services;
- [x] feature-gated admin API (versions + modules + levels), flag default false;
- [x] security matrix полная; actorId только из сессии; ownership→404; ошибки санитизированы;
- [x] shared rate-limit не обходится перебором route/ID;
- [x] populated V1 upgrade зелёный; runner идемпотентен; seed не требуется;
- [x] cumulative gate зелёный (7 suites); withdrawal guard зелёный;
- [x] prisma validate/generate, lint, tsc, build зелёные; git diff --check чист;
- [x] live/production DB/Docker/nginx/deploy не затронуты; флаг в live off;
- [x] нет незакрытой Phase 1 correctness/security ошибки.

## 20. Рекомендованный первый этап Phase 2

**Phase 2A — Curriculum Version Read Resolver & Enrollment Schema (additive, flag-gated).** Scope: аддитивные модели `UserCurriculumEnrollment` + `UserLevelProgress` (по контракту Gap Analysis), read-only resolver «активная published-версия для enrollment policy», без начисления XP/checkpoint-runtime и без записи прогресса. Только schema + read resolver + regression, поверх той же feature-flag/безопасностной инфраструктуры Phase 1.

---

*Документ не содержит secrets, паролей, реальных пользовательских данных.*
