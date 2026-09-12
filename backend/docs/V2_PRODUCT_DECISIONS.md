# Alfa Trade Academy (ATA) — V2 Product Decisions

**Статус:** зафиксированные продуктовые решения перед Curriculum V2
**Дата:** 2026-07-12
**Связанный документ:** `V2_GAP_ANALYSIS.md`


---

## 1. Product name

- Официальное название продукта: **Alfa Trade Academy**.
- Сокращение: **ATA**.
- `trading-mvp` и `TradeQuest` — legacy-технические названия.
- Массовое переименование существующего кода, таблиц, task codes и routes запрещено.

## 2. Compatibility

- Curriculum V1 остаётся активным.
- Curriculum V2 создаётся параллельно как отдельная версионируемая модель.
- Existing task codes (`lvl_01_*` … `lvl_16_*`) не переименовываются.
- `Task` и `UserTaskProgress` не ломаются и не мигрируются деструктивно.
- Новые уровни получают codes формата `v2.l001.*`.
- Published Curriculum Version не редактируется задним числом; правки — через новую версию.

## 3. XP

- Базовый XP начисляется за completion обязательных уровней — это основа маршрута.
- XP не списывается.
- XP не начисляется за real/demo trades.
- XP не начисляется за deposit или потерю balance.
- Promocode XP может участвовать в достижении XP-порога (XP-gate).
- Promocode XP не обходит последовательность уровней и не обходит checkpoint.
- Daily login XP в V2 отключён: простой вход не является meaningful action.
- Referral XP в V1 пока сохраняется без изменений.
- Referral bonus в V2 — отдельный конфигурируемый источник, **выключенный по умолчанию** до anti-abuse правил.
- Legacy V1 XP history не удаляется и не переписывается; корректировки — только отдельными `migration_adjustment`-транзакциями, видимыми в audit.
- XP-gate использует только V2 `XPTransaction` (не V1 `User.xp`/`XpEvent`). При выключенном `CURRICULUM_V2_XP_ENABLED` gate fail-closed: `requiredXp = 0` проходит, `requiredXp > 0` блокируется (`xp_engine_unavailable`), `xp_eligible` не выдаётся (Phase 3B.3).
- XP не открывает уровень в обход последовательности/checkpoint: доступным (`available`) может быть только текущий уровень; будущие уровни с достаточным XP показываются как `xp_eligible`, но не стартуются; checkpoint/inactive/unsupported-visibility остаются blocked независимо от XP (Phase 3B.3).

- Temporal XP decisions are evaluated at one server-owned `evaluationTime` per LevelState resolution or lazy-start command. V2 rows with `createdAt <= evaluationTime` count (including equality); later rows do not affect level state or start eligibility. `asOf` remains internal/test-only, is not an HTTP input, and cannot be used to set ledger `createdAt` (Phase 3B.3.1).

## 4. Pocket Commission

- Endpoint может принимать событие `Commission` для совместимости.
- Событие не изменяет balance, XP, progression или CRM state.
- Событие не используется для персональных product actions.
- Secret не сохраняется, не логируется, не попадает в CRM.
- Партнёрская выручка может сверяться отдельно по агрегированным отчётам Pocket, вне Product OS.

## 5. Withdrawal semantics

- `New Withdrawal` = заявка на вывод. Не меняет финансовое состояние.
- `Canceled Withdrawal` = отмена заявки. Не меняет финансовое состояние и не считается депозитом.
- `Successful Withdrawal` = подтверждённый вывод. Только он участвует в финансовом учёте (уменьшает Net Deposits).
- Plain `Withdrawal` (статусное событие) не участвует в финансовых формулах до отдельного решения.
- Request/cancel не должны перезаписывать balance (текущее поведение — баг, исправляется в Pre-Phase 0B).
- Balance в идеале приходит от отдельного provider, а не вычисляется из заявок.

## 6. Balance

- Financial checkpoint проверяет **real account balance**, а не cumulative deposits.
- Demo balance игнорируется.
- Валюты приводятся к USD equivalent (правило конверсии — запросить).
- Реальный balance provider пока отсутствует (`real_placeholder` не реализован).
- Имитировать production-проверку баланса запрещено.
- `provider unavailable` должен быть отдельным явным состоянием (verification_unavailable), а не «замером ниже порога».

## 7. Promocode concurrency

- Unique `(promocodeId, userId)` запрещён: `perUserLimit > 1` является поддерживаемым контрактом.
- Phase 3B.5 использует отдельную additive `PromocodeRedemptionRequest` с unique `(userId,requestId)`, unique redemption result, optional unique V2 transaction и `RESTRICT` ownership FKs. Legacy redemption не перестраивается и не backfill'ится.
- `usedCount` обязан совпадать с количеством redemptions до нового claim; drift — typed fail-closed corruption. Ограниченный promo использует conditional increment только при `usedCount < maxUses`; unlimited promo делает один транзакционный increment.
- Per-user count, global claim, redemption, V1 reward/event, optional V2 XP/audit и durable request result находятся в одной transaction. SQLite lock retry повторяет всю transaction, ограничен восемью попытками и не применяется к validation/limit/conflict/unknown errors.
- Exact retry возвращает stored result с `created=false` и не меняет counter, XP, redemptions, timestamps, audit или notifications. Первый режим V1-only/dual-write сохраняется независимо от последующих flag changes.

## 8. Level stableCode format (утверждено, Phase 1B.1)

- Формат stableCode уровня: `v2.l001.<slug>`.
- Всё в lowercase; номер уровня — всегда три цифры; slug — lowercase kebab-case.
- Примеры: `v2.l001.pocket-registration`, `v2.l002.tradequest-mechanics`, `v2.l010.balance-checkpoint`.
- stableCode уникален внутри CurriculumVersion (compound unique в БД).
- Тот же stableCode разрешено повторно использовать в новой CurriculumVersion (преемственность уровня между версиями).
- V1 task codes (`lvl_01_*` … `lvl_16_*`) не изменяются.
- Строгая regex-валидация формата выполняется service/Zod-слоем (Phase 1B.2+); сложный SQLite CHECK для slug не используется.
- Для одного curriculum code одновременно существует не более одной published-версии: обеспечено partial unique index в миграции + будущей service-проверкой publish.

## 9. Publication lifecycle (утверждено, Phase 1B.2)

- Публикация новой версии того же curriculum code требует явного `expectedPublishedVersionId` текущей published-версии: без него — `CURRICULUM_REPLACEMENT_REQUIRED`, при несовпадении — `CURRICULUM_REPLACEMENT_MISMATCH`.
- Старая published-версия архивируется атомарно в одной транзакции с публикацией новой; её definitions не изменяются.
- Existing users в будущей Phase 2 останутся привязаны к своей historical version (enrollment будет ссылаться на конкретную CurriculumVersion, включая archived).
- Scheduled publication пока не поддерживается.
- `effectiveFrom` в будущем блокирует непосредственный publish (`CURRICULUM_EFFECTIVE_FROM_FUTURE`).
- Archive выполняется только для published-версии; повторный archive и archive черновика — ошибка, а не тихий success.
- Published/archived версии защищены от редактирования domain-guard'ом `assertCurriculumEditable` (draft — единственное редактируемое состояние).

## 10. Enrollment and durable progress (утверждено, Phase 2B.1)

- Официальный code первой Curriculum V2 line: `ata-v2`.
- Enrollment statuses: `active | completed | superseded`.
- Одновременно допустим только один `active` enrollment на `(userId, curriculumCode)`; historical completed/superseded rows сохраняются бессрочно до отдельной retention policy.
- Обычный enrollment command в будущей фазе идемпотентно возвращает существующий active enrollment и не выполняет re-enrollment после completed.
- Переход пользователя на другую CurriculumVersion выполняется только отдельной аудируемой version-migration командой; автоматической миграции нет.
- Persisted `UserLevelProgress` statuses: `in_progress | pending_review | completed`.
- `hidden | locked | xp_eligible | available | temporarily_suspended` — вычисляемые состояния будущего resolver и не хранятся в DB enum.
- Phase 2B.1 не добавляет `currentXp`. В Phase 3 `XPTransaction` станет источником истины; cached aggregate допускается только отдельным решением Phase 3.
- `completionEvidence` остаётся nullable schema-полем, но до профильных фаз допустимо только `null`; generic arbitrary evidence writer не реализуется.
- Enrollment/progress relations используют `ON DELETE RESTRICT` и `ON UPDATE CASCADE`; физическое удаление history после начала запрещено.

## 11. Feature-gated read-only curriculum resolution (Phase 2B.2)

- `CURRICULUM_V2_READ_ENABLED` and `CURRICULUM_V2_ENROLLMENT_ENABLED` are separate flags, both default to `false`, and neither changes `CURRICULUM_V2_ADMIN_ENABLED`.
- The first official curriculum line defaults to `ata-v2`; an explicit resolver argument takes precedence over this default.
- An active enrollment is pinned to its exact published or archived version. A draft pin is corrupt data and is never replaced silently with the current published version.
- A completed latest enrollment resolves as `completed`: read resolution does not offer a candidate, re-enrol the user, or create any rows.
- A latest superseded enrollment without an active replacement is corrupt unless a newer completed enrollment exists.
- Both resolvers are strictly read-only: no lazy enrollment, progress creation, audit write, timestamp touch, XP calculation, or checkpoint evaluation.
- `publishedAt` or `effectiveFrom` in the future makes the published curriculum `not_effective_yet`.
- Persisted progress is returned as stored and deterministically ordered. Presentation states such as `hidden`, `locked`, and `available` remain outside this phase.
- Phase 2B.2 adds no API route and does not expose resolver diagnostics containing secrets or personal data.

## 12. Controlled user enrollment command (Phase 2B.3)

- Первая enrollment command доступна только controlled internal/admin flow: actor должен существовать, быть active и иметь role `admin`.
- Target всегда выбирается published resolver для trusted constant `ata-v2`; `curriculumVersionId`, curriculum code и initial state не принимаются извне.
- Для mutation одновременно обязательны `CURRICULUM_V2_READ_ENABLED=true` и `CURRICULUM_V2_ENROLLMENT_ENABLED=true`; admin flag их не заменяет.
- Команда идемпотентна: существующий valid active enrollment возвращается с `created=false`, без timestamp touch, нового audit или смены pinned version.
- Completed history блокирует ordinary re-enrollment; superseded history без active replacement считается corruption.
- Новый enrollment, его success audit и проверки выполняются в одной transaction. Partial unique active index завершает защиту от race; loser перечитывает valid active enrollment.
- Enrollment не создаёт `UserLevelProgress`: lazy progress materialization остаётся отдельной Phase 2B.4.
- Version migration и re-enrollment являются отдельными будущими операциями и не выполняются автоматически.

## 13. Effective Level State and lazy start (Phase 2B.4)

- Effective states `completed`, `pending_review` and `in_progress` come only from persisted `UserLevelProgress`; `available` and `locked` are computed and never stored.
- Only `enrollment.currentLevel` without a progress row may be `available`, and only for active module/level definitions, completed prior sequence, `requiredXp=0`, no checkpoint dependency and `visibilityRule=null`.
- Unsupported dependencies fail closed with stable blockers: `xp_engine_unavailable`, `checkpoint_engine_unavailable`, `visibility_rule_unsupported`, `sequence_incomplete`, `definition_inactive` and `not_current_level`.
- Phase 2B.4 never emits `xp_eligible`, `hidden` or `temporarily_suspended`, and never reads legacy `User.xp`, `Level`, `Task` or `UserTaskProgress` as V2 authority.
- Lazy start is an actor-only internal command: caller cannot choose user, curriculum, version or level. Both READ and ENROLLMENT flags are required.
- A successful start creates one `in_progress` row with zero attempts, updates only `lastMeaningfulActionAt`, and writes awaited `CURRICULUM_LEVEL_STARTED` audit in the same transaction.
- Existing valid `in_progress` or `pending_review` current progress returns `created=false` without timestamp or audit changes. Expected progress unique races recover only after validating the persisted current-level row.
- Completion, XP, checkpoint, report, mentor, entitlement, content and assessment runtime remain separate future phases.

## 14. Authenticated current-user curriculum read API (Phase 2B.5)

- Единственный user endpoint Phase 2: `GET /api/curriculum/v2/current`; mutation aliases и cross-user parameters отсутствуют.
- Порядок security gate: READ flag → session → active user → strict empty query → existing context/level-state resolvers → explicit allowlist mapper.
- Flag off возвращает indistinguishable 404 до auth. Anonymous получает 401, non-active/blocked user — 403, любой query parameter — 400. GET не требует CSRF и всегда `no-store`.
- Success — discriminated union `candidate | enrolled | completed | unavailable` внутри `{data}`. Product unavailable — HTTP 200; typed corrupt state — sanitized HTTP 409 `CURRICULUM_STATE_CORRUPT`.
- Candidate не создаёт enrollment и не изображает levels как available. Enrolled показывает pinned published/archived definitions, durable/presentation state и stable blockers. Completed остаётся terminal history.
- Prisma objects напрямую не сериализуются. Email/role/password, internal IDs, createdBy, audit, migrationSource, completionEvidence, raw visibilityRule, currentXp, V1 XP/progression и raw infrastructure errors запрещены в response.
- Endpoint зависит только от READ flag; ADMIN/ENROLLMENT flags не влияют на read availability. Reads не создают audit/notification/progress/enrollment и не касаются timestamps.
- Rollout запрещён; все три curriculum flags сохраняют default false.

## 15. Immutable V2 XP ledger schema foundation (Phase 3B.1)

- V2 XP ledger принадлежит конкретному `UserCurriculumEnrollment`; `userId` и `curriculumVersionId` сохраняются как discriminators и защищены composite FK.
- Optional `levelDefinitionId` может ссылаться только на level той же pinned curriculum version. `levelNumber` не хранится и выводится из immutable `LevelDefinition`.
- `amount` строго положительный на DB level. Нулевые и отрицательные rows, включая отрицательный `admin_correction`, запрещены.
- Source allowlist ограничен: `level_completion | assessment_pass | report_approval | mentor_completion | promocode | migration_adjustment | admin_correction`.
- `idempotencyKey` globally unique; `payloadFingerprint` обязателен; nullable metadata не является authority.
- Enrollment/user/version/level ownership использует `ON DELETE RESTRICT`; удаление nullable actor использует `SET NULL`.
- `currentXp` cache не добавляется. Phase 3B.1 не импортирует V1 XP, не выполняет backfill/dual-write и не реализует award/resolver/API.

## 16. Immutable V2 XP runtime foundation (Phase 3B.2)

- `CURRICULUM_V2_XP_ENABLED` — независимый dynamic runtime flag с default false. READ/ENROLLMENT/ADMIN flags его не заменяют; live env не включается.
- Current XP — только deterministic sum `XPTransaction.amount` конкретного enrollment. V1 `User.xp`/`XpEvent` не читаются; archived pin валиден, draft или ownership/version/range corruption fail closed.
- Internal award service сам выводит user/version из enrollment, строит global key и canonical SHA-256 fingerprint, требует stable source identity, positive amount и source/level contract.
- Metadata — bounded plain JSON object без prototype, secret/auth/session, raw provider/payload/content/evidence keys и non-JSON values. Она остаётся descriptive, а не authority.
- Exact retry возвращает durable row с `created=false` без timestamp/audit side effects. Key/source collision — typed error; expected P2002 восстанавливается только после полной проверки stored row.
- Ledger insert и `CURRICULUM_XP_AWARDED` audit выполняются одним transaction client. Audit failure и outer transaction failure полностью откатывают award.
- Runtime module не экспортирует ledger update/delete и не меняет enrollment/progress, notifications, CRM или V1 XP. HTTP, LevelState, completion и owner adapters остаются будущими фазами.

## 17. Atomic V2 level completion foundation (Phase 3B.4)

- Completion is an internal server-only coordinator; there is no generic HTTP complete-level route. A future owner adapter must already possess durable owner authorization and may call the transaction-aware function inside its own transaction.
- READ, ENROLLMENT and XP flags are jointly required. ADMIN is irrelevant to this gate, and a disabled result performs no reads or writes.
- Accepted mappings are intentionally narrow: lesson/lesson or lesson/manual with `level_completion`; final_exam/assessment_pass with `assessment_pass`; report/report_approval with `report_approval`; mentor_review/mentor_review with `mentor_completion`. Ordinary/assessment require `in_progress`; report/mentor require `pending_review`. All ambiguous owner types fail closed.
- Reward is the positive immutable pinned `LevelDefinition.xpReward`; the caller cannot provide amount, user, version, level number, key, fingerprint, evidence or a desired transition.
- Progress, XP, both awaited audits and the enrollment summary commit atomically. CAS predicates protect both progress and enrollment. No next progress, V1 mutation, notification, CRM write, re-enrollment or version migration is created.
- Exact duplicate verifies the durable ledger key/fingerprint and returns `created=false` without timestamp or audit changes. Partial states are corruption, different identities are conflicts, and unknown database errors are never treated as retry success.
- Final completion uses the approved summary representation `highestCompletedLevel=maxLevel`, `currentLevel=maxLevel+1`, `status=completed`, with one shared evaluation timestamp. Archived pins remain valid and are never rebound.

## 18. Atomic promocode V1/V2 compatibility (Phase 3B.5)

- Existing redeem endpoint сохраняется. Security order: authenticated active user → per-user rate limit → CSRF → strict `Idempotency-Key`/body → atomic service. Body не принимает user, actor, amount, enrollment или version.
- First-party callers создают UUID на одну операцию и сохраняют его для network/5xx retry. Legacy missing-key caller получает server UUID в body/header; потерянный response без повторно переданного key нельзя распознать как exact retry.
- V1 `User.xp`, `XpEvent(source=promocode,sourceId=promocode.id)`, `PromocodeRedemption` и `usedCount` остаются совместимыми authorities/effects.
- V2 award создаётся только для XP promo при одновременных READ+ENROLLMENT+XP flags и valid active enrollment с published/archived pin. Source — `promocode`, sourceId — durable redemption ID, level отсутствует, amount выводится из promo, metadata содержит только technical IDs.
- Candidate/no enrollment, completed history и неполная/off flag matrix остаются V1-only. New published version не repin'ит existing enrollment. Corrupt enabled history откатывает всю transaction. Automatic enrollment и later backfill запрещены.
- Legacy success audit/notification остаются post-commit best-effort и выполняются только при `created=true`. Exact retry не повторяет их. Transactional outbox отсутствует и остаётся известным Phase 3+ ограничением; V2 XP audit при этом атомарен с обоими ledger effects.

## 19. Content authoring and publication lifecycle (Phase 4B.2)

- `CURRICULUM_V2_CONTENT_ENABLED` — самостоятельный dynamic runtime flag с default `false`; ADMIN/READ/ENROLLMENT/XP flags его не заменяют, live env не включается.
- ContentVersion создаётся только как draft внутри draft CurriculumVersion. `versionNumber` монотонно выделяется сервисом per level в транзакции; caller не управляет status, version, actor identity, timestamps или lifecycle fields.
- ContentLocalization требует явный нормализованный locale. Default locale отсутствует и `ru`/`en` не hardcode'ятся. Published/archived ContentVersion, localizations и assets полностью immutable.
- Structured body имеет фиксированный strict contract, bounded size/depth/text, unique stable section codes и не допускает HTML/unsafe URI/prototype/assessment-answer authority. Asset — только metadata/reference: абсолютный HTTPS без userinfo; upload/storage/network/provider и hostname allowlist не входят в этап.
- Publish требует хотя бы одну валидную localization. Замена существующей published version требует exact expected ID, атомарно архивирует старую, публикует новую и переносит binding только если он указывал на заменяемую version. Не связанный первый publish binding автоматически не создаёт.
- Exact content binding допустим только для published ContentVersion того же level/curriculum внутри draft CurriculumVersion. Assessment pin сохраняется; clear удаляет binding row только если assessment pin отсутствует. Bound published content нельзя архивировать напрямую.
- Каждая успешная mutation и audit commit'ятся одной interactive transaction. Audit metadata содержит только IDs/code/version/locale/order; body/transcript/asset URL не журналируются. P2002 recovery возвращает success только после durable state verification; неизвестные DB errors sanitise'ятся как `CONTENT_INTERNAL_ERROR`.
- Phase 4B.2 не добавляет HTTP, assessment/question runtime, attempts/scoring, lesson progress, XP, uploads, seed, UI или V1 side effects. Schema и migration Phase 4B.1 не меняются.

## 20. Assessment draft authoring and publication lifecycle (Phase 4B.3)

- Независимый dynamic flag `CURRICULUM_V2_ASSESSMENT_ENABLED` по умолчанию выключен. Server-only command service не добавляет HTTP/UI, attempts, scoring runtime, XP, lesson progress или V1 side effects.
- AssessmentVersion можно менять только в состоянии `draft` и только под draft CurriculumVersion. Published/archived version, вопросы и локализации immutable. Удаляется только пустой, unbound draft без attempts; bound published version нельзя архивировать напрямую.
- Поддержаны семь authoring contracts: `single_choice`, `multiple_choice`, `true_false`, `ordered_steps`, `scenario_choice`, `numeric`, `chart_choice`. Options — упорядоченные `{code}` с уникальными stable codes. Correct answer — strict `{code}`, `{codes}` или decimal-string `{value}`; multiple choice канонизируется как sorted set, ordered steps требует полную permutation, numeric не использует float и канонизирует `-0` в `0`.
- Numeric и chart-choice можно хранить в draft, но publish fail-closed: точная numeric grading policy и проверяемая связь chart asset с question ещё не утверждены. Partial/manual/fuzzy grading не изобретены.
- QuestionLocalization содержит только prompt, exact optionLabels и optional explanation. Locale задаётся явно и нормализуется; default locale отсутствует. Publish требует хотя бы одну общую полную locale у всех active questions.
- Publish требует `passPercent=80`, только active questions, 5–7 вопросов для lesson; final_exam — ровно 30, включая минимум 3 scenario-choice. Для остальных level types assessment publication fail-closed.
- Replacement требует exact expected published ID: старая версия атомарно архивируется, новая публикуется, assessment binding переносится только если указывал на старую. Первый publish не создаёт binding. Exact binding допускает только published assessment того же level/curriculum и сохраняет content side; clear удаляет row только при пустом content side.
- Все успешные mutations и безопасные audit metadata commit'ятся одной interactive transaction. Prompt, labels, explanation и correctAnswer не журналируются. Rejected publication audit содержит только IDs и issue codes; неизвестные ошибки sanitise'ятся как `ASSESSMENT_INTERNAL_ERROR`.

## 21. Lesson progress autosave idempotency schema hardening (Phase 4B.4.1)

- `UserLessonProgress.revision` начинается с `0`; populated upgrade сохраняет существующие строки без backfill receipts. `lastRequestId` остаётся compatibility marker, но больше не считается достаточной историей идемпотентности.
- `UserLessonProgressSaveReceipt` хранит полный pinned ownership discriminator, `(userId, requestId)`, положительную revision, canonical `sha256:<64 lowercase hex>` fingerprint и DB-generated `appliedAt`. Composite FK использует `RESTRICT/CASCADE`; unique `(lessonProgressId, revision)` гарантирует одного победителя ревизии.
- Будущий Phase 4B.4 runtime обязан в одной transaction: проверить existing receipt и fingerprint, выполнить revision-CAS progress update, вставить receipt и обработать race повторным чтением durable receipt. Повтор того же request/payload — no-op success; reuse requestId с другим payload — conflict.
- Receipts append-only только на application/service boundary. Triggers не добавляются, поэтому privileged raw SQL технически может мутировать строки; абсолютная DB-level immutability не заявляется.
- Retention policy отсутствует: receipts автоматически не очищаются и не каскадируются. Этот этап не реализует resolver, autosave service, HTTP, XP/completion или V1 side effects.

## 22. Pinned content read and lesson autosave runtime (Phase 4B.4)

- `CURRICULUM_V2_READ_ENABLED`, `CURRICULUM_V2_ENROLLMENT_ENABLED` и `CURRICULUM_V2_CONTENT_ENABLED` обязательны одновременно и динамически; default false. ADMIN/ASSESSMENT/XP их не заменяют, live env не включается.
- Server-only resolver следует только enrollment-pinned curriculum/version/level binding и exact published ContentVersion. Locale обязателен, нормализован и exact: fallback/default отсутствует; assets — neutral плюс та же locale в `sortOrder`. Archived curriculum pin поддерживается, draft/cross-version/corrupt graph fail closed. Latest version lookup, automatic repin, lazy level start, HTTP и writes отсутствуют.
- Доступны current `available`, durable `in_progress`, historical `completed`; `pending_review` разрешён только report/mentor review. Locked/xp-eligible/future/inactive/candidate/unsupported и ordinary lesson pending-review не раскрывают content. Safe mapper не выдаёт IDs, assessment authority, XP, fingerprints или raw Prisma.
- Actor-only autosave принимает selector, requestId, expectedRevision и строгий presentation payload. Playback clamped к pinned duration (или 86400 при null), может уменьшаться; completed sections — monotonic set; `progressData` разрешает только nullable `activeSectionCode`. Autosave никогда не меняет status/completedAt и не является completion/XP authority.
- Receipt проверяется первым по полному ownership scope, fingerprint и правилу `receipt.revision = expectedRevision + 1`. Exact retry возвращает receipt `acceptedRevision`/`appliedAt` и текущий progress snapshot без mutation; старый retry после новых revisions не откатывает состояние. Reuse requestId с другим scope/payload — idempotency conflict.
- Новый save выполняет revision CAS и вставляет receipt в одной transaction. First create требует expected revision 0; populated legacy revision 0 без receipts совместима. Stale/gap/negative/no-change отклоняются без timestamp effects. P2002/CAS recovery признаёт success только после полного durable сравнения; competing same-revision saves имеют одного победителя.
- После durable level/enrollment completion новые autosave immutable, но старые exact receipt retries разрешены. Единственные mutations — `UserLessonProgress` и `UserLessonProgressSaveReceipt`; enrollment/level progress, XP, attempts, audit, notification, CRM и V1 не затрагиваются. Schema/migration Phase 4B.4.1 не меняются.

## 23. Assessment attempts, scoring and atomic completion (Phase 4B.5)

- Runtime is server-only and actor-bound. `startOwnAssessmentAttempt(actor, payload)` accepts only levelNumber XOR stableCode plus exact locale; `submitOwnAssessmentAttempt(actor, payload)` accepts only attemptId, approved request identity and answers. Target ownership IDs, score/status/pass, XP and timestamps are never caller authority.
- Start/resume requires dynamic READ + ENROLLMENT + ASSESSMENT flags. Only a passing submission additionally requires XP. ADMIN/CONTENT are independent and cannot substitute; absent flags remain disabled.
- Resolution is pinned: active actor/enrollment → pinned curriculum → current active assessed level with persisted `in_progress` progress → exact binding → exact published assessment. No enrollment/progress creation, repin, locale fallback, V1 fallback or latest-version lookup is permitted.
- One active attempt is enforced by the existing partial unique index. New numbering is deterministic `terminalCount + 1`; terminal attempts consume nullable `maxAttempts`. Resume is a no-touch/no-repeat-audit read.
- Supported graders are exact stable-code comparison for single/true-false/scenario, canonical set equality without partial credit for multiple-choice, and exact permutation order for ordered steps. Numeric tolerance and chart semantics remain unapproved and fail closed. Pass is the integer predicate `correctCount * 100 >= passPercent * totalQuestions`; basis points are derived from the same counts.
- Durable exact-retry authority is the combination of normalized submitted answers, canonical SHA-256 fingerprint and `submitRequestId` already present in `AssessmentAttempt`. A different key or normalized payload for a terminal attempt is a submission conflict. Exact retry validates stored aggregates and, for pass, durable XP/completion consistency without touching rows or repeating audits.
- Failed attempts store only normalized user answers/fingerprint and server aggregates, leave progress/enrollment open and create no XP. Passed attempts call the transaction-aware Phase 3 completion core in the same transaction as attempt CAS and grading audit; attempt, XP, progress, enrollment and all audits commit or roll back together.
- Phase 3 assessment ownership now includes `lesson:assessment_pass` in addition to `final_exam:assessment_pass`. Lesson completion is accepted only with a durable passed `AssessmentAttempt` of the same user, enrollment, curriculum version, level and AssessmentVersion, identified as `assessment-attempt:<id>` and checked in the completion transaction. Other owner mappings are unchanged.
- Safe presentation never exposes correct answers, correctness flags, explanation, raw Prisma, internal ownership IDs or raw answers in audit. New transactional audit actions are `CURRICULUM_ASSESSMENT_ATTEMPT_STARTED` and `CURRICULUM_ASSESSMENT_ATTEMPT_GRADED`.
- HTTP/UI/history, question randomization, active-attempt expiry, numeric/chart grading, notifications/outbox and rollout remain outside Phase 4B.5. Historical exact retry uses the immutable AssessmentVersion referenced by the attempt even after later binding replacement/archive.

## 24. Self report drafts, immutable revisions and submit/resubmit (Phase 5B.3)

- Self report runtime requires the dynamic READ + ENROLLMENT + REPORT flag matrix; every flag defaults to false and ADMIN/CONTENT/ASSESSMENT/XP cannot substitute. XP is intentionally not required because draft, submit and resubmit neither award XP nor complete a level.
- The server resolves actor ownership through the pinned enrollment/curriculum/report level. Before aggregate creation it uses the exact published binding; afterwards the aggregate's assignment/rubric IDs are permanent historical pins and archived pinned definitions remain valid. Locale is exact with no fallback, and read never creates state.
- Report content is a strict canonical stable-key object validated only against the pinned published field definitions. Incomplete drafts are permitted, while submit/resubmit require all required values and full validation. Every successful new save request creates a new immutable draft revision even when its normalized content equals the prior revision.
- Receipt-first idempotency preserves old exact retries after newer revisions: the original accepted revision, workflow version and applied time are returned with the current safe snapshot. Key reuse across command/scope/payload conflicts. New writes use exact workflow/pointer CAS; stale and ahead revisions are distinct failures and competing payloads have one winner.
- Initial submit creates an immutable `initial_submission` revision and atomically moves aggregate plus progress `in_progress -> pending_review`. Rejection policy adopts the Phase 5A recommendation: B.4 must move progress back to `in_progress`; correction drafts keep the aggregate rejected; resubmit requires a newer corrected draft and moves aggregate plus progress back to `pending_review` with an immutable `resubmission` revision.
- Resubmissions are unlimited at schema/runtime level until a later explicit policy is approved. All historical revisions and rejected reviews remain retained. No SLA clock is invented: `submittedAt` is stored and `reviewDueAt` remains null.
- Submit/resubmit audits are awaited and atomic but contain IDs and version/operation facts only. High-frequency draft audit is deferred. The runtime does not touch XP, completion, enrollment summaries, notifications/outbox, attachments, V1 reports, reviewer decisions, HTTP/UI, seed/backfill or rollout.

## 25. Reviewer claim, rubric evidence and rejection (Phase 5B.4)

- Reviewer runtime requires dynamic READ + ENROLLMENT + REPORT flags. Only active ADMIN and MENTOR actors are reviewers; actor identity is server/session-owned and self-review is forbidden for both roles. The shared deterministic queue follows exact immutable assignment, rubric and submitted-revision pins, supports archived history, is read-only and returns only the localized allowlist needed to review.
- The approved claim lease is exactly 60 minutes. One server-owned `evaluationTime` is fixed inside the transaction: a new claim stores `claimedAt=evaluationTime` and expires at `evaluationTime + 60 minutes`. Active means expiry is strictly greater than evaluation time; equality is expired. Clients cannot provide claim timestamps.
- An active reviewer may claim unclaimed or expired work, never their own submission. A fresh claim cannot be overwritten by ordinary mentor/admin claim. Only the current active owner may renew or release; renew expires at current evaluation time plus 60 minutes, expired claims require a new claim, and release atomically clears all claim fields without changing revision, report status or progress.
- Only an active ADMIN may reassign an active or expired claim. The target must be an active ADMIN or MENTOR and not the author. Required reasons are limited to `reviewer_unavailable`, `claim_stale`, `workload_rebalance`, and `operational_override`; no arbitrary comment is accepted or stored. Reassignment installs a new 60-minute lease and an awaited transactional audit whose failure rolls back the operation.
- Claim, renew, release and reassignment use workflow/claim CAS, canonical fingerprints and durable receipts. Exact retry returns the original result without extending the lease or repeating an audit; key/payload reuse conflicts; competing claims have one winner. P2002 recovery succeeds only after full durable-result verification, and unrelated DB errors are never converted into idempotent success.
- Rubric review accepts every exact pinned criterion once, exact pinned neutral scale codes and any required criterion comments. Unknown, missing, duplicate or foreign evidence fails closed. Reject requires a reason from the exact pinned active reason catalog, reviewer comment and corrective action.
- Reject atomically creates immutable review/scores, transitions submission to rejected, clears claim, moves progress `pending_review -> in_progress`, stores receipt and writes awaited safe audit. It creates no revision and touches no XP, completion, enrollment summary, V1, notification/outbox or binding state. Exact reject retry is inert and remains durable after a later permissible correction draft.
- Approval-readiness is read-only validation. Durable approved review/status is forbidden in B.4; approval stays fail-closed until B.5 performs approved review, `report_approval` XP, progress/enrollment completion and required audits in one transaction.

## 26. Atomic report approval/completion split (Phase 5B.5a)

- Phase 5B.5 is explicitly split into B.5a atomic approval/completion and B.5b private attachment runtime. B.5a is implemented; B.5b requires separate approval of storage, malware-scan, authorization and retention decisions. Existing attachment schema does not authorize runtime, and Phase 5B.5 is not complete until B.5b is done.
- Approval requires dynamic READ + ENROLLMENT + REPORT + XP flags, all true. Only an active ADMIN or MENTOR may approve, self-review is forbidden, and the actor must own the exact active unexpired claim. Server-owned `evaluationTime`, exact workflow/claim/current-submitted-revision CAS, immutable pins, report pending-review progress and complete pinned rubric evidence are mandatory.
- One outer transaction creates the immutable approved review and scores, uses `report-review:<reviewId>` as durable `report_approval` evidence, derives XP only from immutable `LevelDefinition.xpReward`, writes XP and completion audits, completes progress/enrollment, marks the submission approved, clears the claim, stores the receipt and writes awaited `REPORT_APPROVED`. No nested transaction is allowed and any failure rolls back every row and audit.
- Completion accepts report ownership only from a durable approved review for the same submission, user, enrollment, curriculum, level, exact current submitted revision and assignment/rubric pins, with one valid score per pinned criterion and a non-author reviewer. Missing, rejected, wrong-revision or corrupt review evidence fails closed. A generic report completion endpoint is not introduced.
- Exact retry verifies the full durable receipt, review, scores, approved pointers, XP/completion and report audit; it creates no row, audit or timestamp. Same key with another normalized payload conflicts. Competing approvals and approve/reject races have one winner; archived pins remain valid without repinning.
- B.5a adds no schema/migration, attachments/storage, HTTP/UI, seed/backfill, V1 report/XP, notification/CRM/outbox or rollout behavior. All flags remain default false. Official Phase 5 remains 4/6 (66.7%) until B.5b is complete; Core backend is about 58% and roadmap Phase 1-13 about 36%.

---

*Документ не содержит secrets, паролей, реальных пользовательских данных и значений postback secret.*
