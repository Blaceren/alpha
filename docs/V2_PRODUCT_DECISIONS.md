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

---

*Документ не содержит secrets, паролей, реальных пользовательских данных и значений postback secret.*
