# ATA V2 — Phase 4 Content, Assessments and Lesson Progress Design (Phase 4A)

**Статус:** final Phase 4 contract; Phase 4B.1–4B.6 реализованы и completion-gated. HTTP-контракт Phase 4B.6 ниже заменяет предварительную route table Phase 4A.
**Дата:** 2026-07-15
**База:** commit `6e0c32df66089ab42855d2759c2361e2d6bdfafc` (Phase 3 завершена)
**Связанные документы:** `V2_PRODUCT_DECISIONS.md`, `V2_GAP_ANALYSIS.md`, `V2_PHASE_1_SCHEMA_DESIGN.md`, `V2_PHASE_2_SCHEMA_DESIGN.md`, `V2_PHASE_3_XP_DESIGN.md`, `V2_PHASE_1_COMPLETION.md`, `V2_PHASE_2_COMPLETION.md`, `V2_PHASE_3_COMPLETION.md`

## 0. Источник требований и отсутствие master-спецификации

Master/backend-спецификация `TradeQuest_Product_OS_Curriculum_V2_Backend_Spec.md` (v0.9), на которую ссылается `V2_GAP_ANALYSIS.md`, **в workspace отсутствует** (проверено `find`/`git ls-files` по паттернам `*backend_spec*`, `*product_os*`, `*les-prog*`). Требования этого документа взяты из: (a) зафиксированных продуктовых решений Phase 4A-задания; (b) mapping-раздела `V2_GAP_ANALYSIS.md` §2 (ContentVersion / AssessmentVersion / QuestionDefinition / AssessmentAttempt, API-раздел 19: SAVE lesson progress, START/SUBMIT assessment); (c) фактического аудита кода. Пункты, которые спецификация могла бы уточнить (word-for-word question contract, полный список product events), не изобретаются и вынесены в open decisions (§22).

Phase 4A ничего не реализует: единственный артефакт — этот документ.

---

## 1. Scope и зафиксированные решения

Не пересматриваются (входные ограничения Phase 4):

- V1 hardcoded content продолжает работать; V1 routes/models не удаляются; `lessonContent.ts` не удаляется.
- V2 content существует параллельно и feature-gated (default off).
- Published content/assessment immutable; изменение — только новой версией; curriculum/level pin'ит точную версию.
- Completed attempt не пересчитывается после изменения вопросов; все attempts сохраняются.
- XP — только за первое успешное прохождение; не начисляется за fail/retry/start.
- Correct answers не выдаются до submit; scoring выполняет backend.
- Generic COMPLETE LEVEL route запрещён; assessment owner вызывает atomic completion Phase 3B.4.
- Lesson progress сам по себе не начисляет XP.
- Обычный урок: 5–7 вопросов, pass threshold 80%, unlimited attempts. Final exam: 30 вопросов, 80% и 3 scenario cases.
- Question types: `single_choice | multiple_choice | true_false | ordered_steps | scenario_choice | numeric | chart_choice`.
- Seed/content/question bank в Phase 4A не создаются.

---

## 2. Аудит: current V1 content map

### 2.1 Writers/readers

| # | Файл / функция / route | Content source | Question source | Response contract | Correct-answer exposure | Completion mutation | XP mutation | Report/mentor dependency | Client dependency | Transaction boundary | Idempotency | Security/race risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `src/lib/lessonContent.ts` (`lessons` map, 7 уроков) | hardcoded TS-объект: title/summary/3 sections | hardcoded: 1 вопрос, 3 ответа, `correctAnswer: number` | TS module, импортируется client-компонентом | **ПОЛНАЯ**: `correctAnswer` попадает в client bundle всех страниц `/tasks/[taskCode]` | нет | нет | нет | `src/app/tasks/[taskCode]/page.tsx` | n/a | n/a | Все правильные ответы всех уроков доступны любому, кто скачал JS bundle (даже без прохождения предыдущих уровней) |
| 2 | `src/app/tasks/[taskCode]/page.tsx` (client) | `lessons[taskCode]` из bundle | там же | рендер урока + radio-вопрос | grading **на клиенте**: `answer !== lesson.correctAnswer` | вызывает `completeTask(task.id)` | косвенно (через #3) | нет | сам является клиентом | нет | нет | Ответ сервером **не проверяется**: прямой POST `/api/tasks/{step}/complete` завершает урок без ответа на вопрос |
| 3 | `POST /api/tasks/[id]/complete` | нет | нет | `{tasks, user, xpAwarded}` (полный Task+progress+reports) | нет | `UserTaskProgress → completed`, unlock next, `UserReward` upsert, `User.level/currentTask` | `XpEvent.create` + `User.xp = user.xp + reward` (`user` прочитан **вне** tx) | требует `report.status=approved` для `requiresReport` | `TaskChain.tsx`, `tasks/[taskCode]/page.tsx` через `api.ts:completeTask` | одна `$transaction`, но **без CAS**: pre-check `status==="active"` вне tx; UPDATE внутри tx без WHERE status | **нет** idempotency key | CSRF есть; **rate limit отсутствует**; параллельные submit проходят оба pre-check → двойной `XpEvent`, `User.xp` от stale-значения (lost update / double XP) |
| 4 | `POST /api/tasks/[id]/verify` | нет | нет | `{ok, alreadyCompleted, xpAwarded, tasks}` | нет | `completeProgressionTask` (см. #5) | см. #5 | нет | `TaskChain.tsx` (`verifyTask`) для `deposit_postback`/`balance_check` | verify-проверка вне tx, completion в tx | повтор после completed → `alreadyCompleted` | CSRF есть; rate limit отсутствует; balance-провайдер вне tx |
| 5 | `src/lib/taskProgression.ts` `completeProgressionTask` | нет | нет | typed result | нет | progress→completed, unlock next, reward upsert, `User.level/currentTask` | `XpEvent.create` + `User.xp` (user прочитан **внутри** tx; повтор отсечён `status!=="active"` внутри той же tx) | вызывается из mentor-approve (#7) и verify (#4) | — | одна `$transaction` | статус-проверка внутри tx (лучше #3), но unique-ключа идемпотентности нет | двойной вызов сериализуется SQLite-транзакцией; межпроцессной защиты нет |
| 6 | `POST/GET /api/tasks/[id]/report` | нет | нет | `{report}` / `{task, report}` (полный Task) | нет | нет (только TaskReport pending) | нет | создаёт запись для review | `TaskReportForm.tsx` | без tx: read-then-write (`existing` вне записи) | resubmit разрешён после rejected; pending/approved блокируются pre-check'ом | CSRF+rate limit (10/10мин); race двух submit → второй перезапишет pending (нет CAS) |
| 7 | `PATCH /api/admin/task-reports/[id]` (reviewer: admin/mentor) | нет | нет | `{report}` | нет | approve → `completeProgressionTask` | через #5 | ЭТО mentor/report-путь V1 | `admin/task-reports` UI | **две отдельные tx**: report update, затем completion; сбой completion оставляет approved report без completion/XP | `REPORT_ALREADY_REVIEWED` pre-check без CAS | CSRF+rate limit (30/10мин); двойной PATCH race — оба прочитают pending |
| 8 | `GET /api/tasks` | нет (контент не отдаёт) | нет | `{tasks[], currentLevel, trainingLevel}`; полные Task rows + progress + reports.status; pocket-нормализация статусов | нет (ответы не в DB) | нет | нет | reports.status в ответе | `tasks/page.tsx`, `TaskChain`, `DashboardTaskProgress`, `ProgressCard` | без tx (две parallel reads) | n/a | `no-store`; полные Task-поля (balanceThreshold и пр.) отдаются как есть |
| 9 | `GET /api/levels` | нет | нет | Level rows + статус от `User.level` | нет | нет | нет | нет | `levels/page.tsx` | нет | n/a | низкий |
| 10 | `POST /api/checkpoints/[id]/check` | нет | нет | `{checkpoint, progressStatus, provider, message}` | нет | Checkpoint status/balance | нет | нет | `DashboardCheckpoints` | tx на update; provider-вызов вне tx | нет | ownership проверяется; rate limit 5/10мин |
| 11 | `POST /api/files/upload` + `GET /api/files/[id]` | file assets (10MB, mime allowlist) | нет | `{file}` allowlist | нет | нет | нет | `task_report` purpose | `TaskReportForm` | createStoredFile | нет | ownership на attach проверяется (#6) |
| 12 | `src/lib/trainingLevel.ts` | нет | нет | derived level из tasks | нет | нет | нет | нет | через #3/#8 | n/a | n/a | вычисление, не authority V2 |
| 13 | `src/lib/taskStorage.ts` | клиентский localStorage-кэш tasks | нет | localStorage | нет | нет (client-only) | нет | нет | legacy-компоненты | n/a | n/a | client-trusted кэш, не authority |

Итого V1: контент и вопросы hardcoded в module-scope TS; правильные ответы целиком в client bundle; grading клиентский; попытки не сохраняются; порога 80 % нет; generic complete route существует и не проверяет ответ; race в complete route реален (нет CAS, XP от stale read); отчёт/ментор-approve неатомарен с completion. Video/lesson progress (playback, subtitles, transcript) — **нигде не сохраняется и не существует** (rg по `playback|videoUrl|subtitle|transcript` — пусто). Единственные trusted-от-клиента поля: выбор `stepNumber` (ограничен статусом active) и содержимое отчёта; но фактически «прохождение quiz» — целиком клиентское утверждение.

### 2.2 Call chains

- **GET task/lesson:** UI `tasks/page.tsx` → `api.ts:getTasks` → `GET /api/tasks` (Task+progress+reports, pocket-нормализация, trainingLevel) → рендер `TaskChain`. Контент урока **не запрашивается** — берётся из bundle.
- **Start/open lesson:** переход на `/tasks/[taskCode]` → client `getTasks()` (только для статуса) + `lessons[taskCode]` из bundle. Серверного «start» не существует; факт открытия урока нигде не сохраняется.
- **Quiz submit:** radio-выбор → client-сравнение с `lesson.correctAnswer` → при совпадении `completeTask(task.id)` → `POST /api/tasks/[id]/complete`. Сервер не получает и не проверяет ответ.
- **Task complete (generic):** `TaskChain` → `completeTask` → `POST /api/tasks/[id]/complete` → pre-checks (report approved, checkpoint frozen, status active) → tx (progress→completed, next unlock, reward, XpEvent, User.xp/level) → audit → notifications.
- **Report submit/review:** `TaskReportForm` → upload (`/api/files/upload`) → `POST /api/tasks/[id]/report` (pending) → reviewer UI → `PATCH /api/admin/task-reports/[id]` → отдельная tx `completeProgressionTask` → notifications.
- **Mentor approval:** тот же PATCH — reviewer roles `admin|mentor` (`requireTaskReportReviewer`); отдельного mentor-workflow нет.
- **Frontend lesson rendering:** `/tasks/[taskCode]` — sections из bundle; вопрос+ответы из bundle; кнопка блокируется по статусу задачи; после complete — `router.refresh()`.

### 2.3 V2-инфраструктура, на которую опирается Phase 4 (аудит)

- `LevelDefinition` уже несёт `type` (в т.ч. `lesson`, `scenario`, `final_exam`), `completionMethod` (свободная строка), `xpReward`, `requiredXp`; composite parent keys `(id, curriculumVersionId)`; строгие admin-схемы **сознательно отклоняют** `contentVersionId`/`assessmentVersionId` (комментарий в `http.ts`), а `V2_PHASE_1_SCHEMA_DESIGN.md` §4.3 (утверждено Phase 1B.1) фиксирует: колонки добавляются **в Phase 4 одной аддитивной миграцией** вместе с таблицами.
- Phase 3B.4 `completion.ts`: `OWNER_RULES` допускает `assessment_pass` **только** для пары `final_exam:assessment_pass`; `lesson:lesson|lesson:manual` принадлежит `level_completion`; `scenario`/`practice` fail closed (`COMPLETION_OWNER_UNAVAILABLE`). Есть транзакционная форма `completeCurriculumLevelInTransaction(tx, …)` — целевой интерфейс для assessment owner.
- XP ledger: `sourceType='assessment_pass'` уже в DB CHECK-allowlist; `sourceId` — durable owner identity (`^[A-Za-z0-9][A-Za-z0-9._:/-]*$`, ≤200); partial unique `(enrollmentId, sourceType, sourceId)`.
- HTTP-паттерны: `gateCurriculumAdmin` (flag→auth→shared rate bucket→CSRF), 404-неотличимость при flag off, `NO_STORE_HEADERS`, allowlist-мапперы, sanitized 409 corruption, authenticated-encrypted cursor (xp/history), strict Zod `strictObject`.
- Инструменты DB-инвариантов, доказанные Phase 1–3 на SQLite+custom runner (split по `;`): TEXT CHECK-allowlist, `CHECK (x > 0)`, partial unique indexes, composite FK через parent unique keys, `ON DELETE RESTRICT`. **Триггеры недоступны** (runner режет по `;` внутри BEGIN…END) — иммутабельность published-строк остаётся service-level, как у XP ledger.
- Рейт-лимитер in-memory per-process (известное MVP-ограничение).
- `UserLevelProgress.attemptCount` существует с Phase 2 (default 0, нигде не инкрементируется), `completionEvidence` — только `null` до профильной фазы.

---

## 3. Content versioning model

### 3.1 Модели

Контент принадлежит конкретному `LevelDefinition` (см. §5 — это единственный способ получить требуемые DB-гарантии владения) и версионируется **логическими** версиями с локализациями-детьми.

```prisma
enum ContentResourceStatus {
  draft
  published
  archived
}

model ContentVersion {
  id                   Int                   @id @default(autoincrement())
  levelDefinitionId    Int
  curriculumVersionId  Int
  versionNumber        Int
  status               ContentResourceStatus @default(draft)
  // Метаданные уровня контента, не зависящие от locale:
  videoDurationSeconds Int?                  // CHECK > 0 при NOT NULL (SQL)
  createdById          Int?
  createdAt            DateTime              @default(now())
  updatedAt            DateTime              @updatedAt
  publishedAt          DateTime?
  archivedAt           DateTime?
  changeNotes          String?
  levelDefinition      LevelDefinition       @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  createdBy            User?                 @relation("ContentVersionCreator", fields: [createdById], references: [id], onDelete: SetNull, onUpdate: Cascade)
  localizations        ContentLocalization[]
  assets               ContentAsset[]

  @@unique([id, levelDefinitionId])            // parent key для ownership-FK (binding, lesson progress)
  @@unique([levelDefinitionId, versionNumber])
  @@index([curriculumVersionId, status])
}

model ContentLocalization {
  id               Int            @id @default(autoincrement())
  contentVersionId Int
  locale           String         // BCP-47 primary subtag allowlist (Zod), напр. "ru", "en"
  title            String
  subtitle         String         @default("")
  learningObjectiveExtension String @default("")
  summary          String         @default("")
  transcript       String?        // plain text / safe markdown
  body             Json           // структурированные sections/examples/... (§4)
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  contentVersion   ContentVersion @relation(fields: [contentVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([contentVersionId, locale])
}

model ContentAsset {
  id               Int            @id @default(autoincrement())
  contentVersionId Int
  kind             ContentAssetKind // migration CHECK mirrors the approved enum
  assetCode        String         // stable code, unique внутри content version
  locale           String?        // NULL = locale-независимый (video, chart)
  url              String         // https-only, allowlisted host policy (§22.4)
  mimeType         String
  sizeBytes        Int?           // CHECK > 0 при NOT NULL
  durationSeconds  Int?           // CHECK > 0 при NOT NULL
  checksum         String?        // sha256:… — иммутабельная ссылочная целостность
  sortOrder        Int            @default(0)
  createdAt        DateTime       @default(now())
  contentVersion   ContentVersion @relation(fields: [contentVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([id, contentVersionId])
  @@unique([contentVersionId, assetCode])
  @@unique([contentVersionId, sortOrder])
  @@index([contentVersionId, kind, locale])
}
```

Замечания:

- `versionNumber` — монотонный счётчик per level (service-allocated в tx, unique защищает race).
- `videoDurationSeconds` живёт на ContentVersion (не per-locale): субтитры per-locale, видео-дорожка общая; при будущей per-locale озвучке — asset-level `durationSeconds` уже есть.
- Binary data в SQLite не хранится: `ContentAsset.url` — внешняя ссылка; загрузка байтов остаётся `FileAsset`/storage-инфраструктуре или внешнему хостингу (§22.4).
- SQLite-иммутабельность published-строк (запрет UPDATE) невозможна без триггеров — обеспечивается domain-guard'ом (аналог `assertCurriculumEditable`) + отсутствием экспортированных update-операций для published. Это же известное ограничение XP ledger (Phase 3 Completion, Known limitations).

### 3.2 Localization: вариант A vs B

**A. Отдельная ContentVersion на каждый locale.**
Плюсы: одна таблица; полная независимость переводов. Минусы: pin в binding становится locale-зависимым — либо N pin'ов на level (усложнение binding и publish-валидации), либо «pin только default locale» (перевод меняет pinned identity → нарушает «добавление перевода не меняет правильность assessment»); версии рассинхронизируются по смыслу (ru v3 ≠ en v2); lesson progress пришлось бы вести per-locale (пользователь, сменивший язык, теряет прогресс); assessment привязывается к смысловой версии, а не к языку — связь один-ко-многим всё равно понадобится.

**B. Logical ContentVersion + ContentLocalization children (РЕКОМЕНДОВАНО).**
Один смысловой version-узел; locale-строки — дети. Pin (binding/enrollment/lesson progress/assessment) ссылается на logical version и не меняется при добавлении перевода. Publish-валидация проверяет completeness (§3.3). Точное соответствие требованию «добавление перевода не меняет правильность assessment». Аудит блокеров для B не выявил: в V1 локализации нет вовсе (весь контент русский, hardcoded), ни одна существующая таблица не закрепляет per-locale identity.

Минус B, фиксируемый честно: «published immutable» требует определить, разрешено ли **добавлять** новые locale-children к published ContentVersion (аддитивная локализация) или перевод требует новой версии. Рекомендация: разрешить только добавление новых locale и только через отдельную admin-команду с audit (существующие locale-строки published-версии неизменяемы). Финальная политика — open decision §22.2.

Официальный default locale продуктом **не утверждён** — не утверждается и здесь (§22.1). Технический фолбэк до решения: `ru` как «первый обязательный locale» publish-валидации, потому что весь существующий контент русский; это операционный фолбэк, не продуктовый default.

### 3.3 Lifecycle

- `draft` — редактируемый: localization/asset CRUD, только draft.
- `published` — иммутабельный (poля, localizations, assets); `publishedAt` обязателен; audit awaited в той же tx.
- `archived` — historical; читается существующими pin'ами; не редактируется.
- Publish-валидация ContentVersion: ≥1 localization; обязательный locale-набор (минимум операционный фолбэк-locale до §22.1); для каждого `video`-asset при наличии `subtitles`-требования — субтитры для каждого обязательного locale (§22.2); все URL проходят asset-policy; `videoDurationSeconds` согласован с video-asset.
- Partial unique в SQL: `ON ContentVersion(levelDefinitionId) WHERE status='published'` — не более одной published content-версии на level (упрощает авторинг; pin всё равно точный).
- Deletion: только draft; published/archived — `Restrict` всюду, физическое удаление запрещено.

---

## 4. Content contract (хранение полей)

| Поле спецификации | Где хранится | Форма |
|---|---|---|
| subtitle | `ContentLocalization.subtitle` | колонка |
| learning objective extension | `ContentLocalization.learningObjectiveExtension` | колонка (базовый objective остаётся в `LevelDefinition.learningObjective`) |
| video metadata | `ContentVersion.videoDurationSeconds` + `ContentAsset(kind='video')` | колонки |
| transcript | `ContentLocalization.transcript` | колонка (может быть большой — отдельно от body) |
| sections | `ContentLocalization.body.sections[]` | Json |
| examples | `ContentLocalization.body.examples[]` | Json |
| common mistake | `ContentLocalization.body.commonMistakes[]` | Json |
| summary | `ContentLocalization.summary` | колонка |
| glossary | `ContentLocalization.body.glossary[]` | Json |
| next action | `ContentLocalization.body.nextAction` | Json |
| risk disclaimer | `ContentLocalization.body.riskDisclaimer` | Json (текст) |
| assets/subtitles | `ContentAsset` rows | таблица |

Правило разграничения: **колонки** — то, что нужно фильтрам/валидации/join'ам или крупные независимые blob'ы (transcript); **Json `body`** — упорядоченный презентационный контент с фиксированной Zod-схемой. Отдельные typed-таблицы для sections/examples не создаются: они не участвуют в FK/запросах, а иммутабельность published снимает главный аргумент за нормализацию (согласовано с прецедентом `visibilityRule Json` из Phase 1B.1). Это решение фиксируется как рекомендация; альтернатива — open decision §22.3.

Zod-контракт `body` (валидируется на КАЖДОЙ записи draft и повторно на publish):

- `strictObject`; discriminated `sections[]`: `{code, title, body}`, `code` — stable `^[a-z0-9]+(?:-[a-z0-9]+)*$` (нужен для `completedSections` lesson progress), unique в массиве, порядок массива = порядок отображения (отдельного `order`-поля не нужно);
- `examples[]`: `{title, body}`; `commonMistakes[]`: `{mistake, correction}`; `glossary[]`: `{term, definition}`; `nextAction`: `{label, body}`; `riskDisclaimer`: `string`;
- size/depth limits: суммарный сериализованный `body` ≤ 64 KB; ≤ 30 sections; каждый текст ≤ 8 000 символов; title/label ≤ 300; глубина ≤ 3; массивы ≤ 50 элементов; `transcript` ≤ 200 KB; никаких «prototype»-ключей (`__proto__`, `constructor` и пр. — паттерн metadata-валидации Phase 3B.2);
- текстовая политика: **plain text / safe markdown subset** (заголовки, списки, bold/italic, ссылки только https). Raw HTML запрещён на входе (Zod отклоняет `<script`, `<iframe`, `on*=`, `javascript:` паттерны как defence-in-depth, но базовое правило — контент рендерится клиентом как text/markdown, никогда как HTML). Санитизация не «чинит» ввод, а отклоняет его — авторы это admin'ы, honest error лучше тихой порчи;
- URL-валидация (`ContentAsset.url`, ссылки в markdown): абсолютный `https://`, длина ≤ 2048, запрет userinfo (`user@host`), запрет `javascript:`/`data:`; host-политика — §22.4 (allowlist доменов — open decision; до решения publish принимает только домены из env-конфигурируемого allowlist, пустой allowlist = publish блокируется по asset'ам);
- бинарные данные в SQLite запрещены (нет BLOB-колонок в Phase 4-моделях);
- asset references иммутабельны после publication: `checksum` фиксируется на publish; изменение файла на хостинге — новая content-версия (обнаружение drift'а — вне scope Phase 4).

Запрещено (и проверяется 4B-регрессиями): hardcode transcript/sections/questions в backend source; V2-контент существует только в DB.

---

## 5. Content attachment

### 5.1 Требуемые DB-гарантии

1) content принадлежит тому же LevelDefinition; 2) assessment принадлежит тому же LevelDefinition; 3) нельзя прикрепить resource другой curriculum version; 4) published CurriculumVersion pin'ит точные versions; 5) archived content доступен historical enrollment; 6) новая content-версия не меняет существующий pin; 7) Restrict-deletion, никакого uncontrolled Cascade.

Ключевой SQLite-факт: гарантии (1)–(3) выразимы **только** composite-FK на parent key `(resourceId, levelDefinitionId)` — а такой FK возможен только если resource-таблица несёт `levelDefinitionId`, т.е. ресурс **владельчески** принадлежит уровню (§3.1, §6.1). Одноколоночный FK `LevelDefinition.contentVersionId → ContentVersion(id)` пункты (1)–(3) на DB-уровне не обеспечивает.

### 5.2 Вариант A: nullable `contentVersionId`/`assessmentVersionId` в LevelDefinition

Именно его предвидел Phase 1B.1 (§4.3 варианта B того документа: «добавляются в Phase 4 одной аддитивной миграцией… ALTER TABLE ADD COLUMN … REFERENCES»). Аудит Phase 4A выявил два жёстких ограничения, которых Phase 1 не детализировал:

- SQLite `ALTER TABLE ADD COLUMN` допускает **только column-level (одноколоночный) REFERENCES**. Composite FK `(contentVersionId, id) → ContentVersion(id, levelDefinitionId)` — это table-level constraint, добавить его можно только пересозданием (rebuild) `LevelDefinition`. Rebuild якорной таблицы, на которую смотрят composite-FK из `UserLevelProgress`, `XPTransaction`, `ModuleDefinition`, в custom-runner'е — недопустимый риск (тот же аргумент, которым Phase 1B.1 отверг вариант A у себя).
- Даже с одноколоночным FK возникает **циклическая пара FK** (`LevelDefinition → ContentVersion → LevelDefinition`), усложняющая insert-порядок, Prisma-диффы и будущие миграции.

Следствие: вариант A либо не даёт требуемых DB-гарантий (одноколоночный FK), либо требует запрещённого rebuild'а.

### 5.3 Вариант B: отдельная immutable binding-таблица (РЕКОМЕНДОВАНО)

```prisma
model LevelResourceBinding {
  id                  Int              @id @default(autoincrement())
  levelDefinitionId   Int              @unique   // не более одного binding на level
  curriculumVersionId Int
  contentVersionId    Int?
  assessmentVersionId Int?
  createdById         Int?
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt
  levelDefinition     LevelDefinition   @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  contentVersion      ContentVersion?   @relation(fields: [contentVersionId, levelDefinitionId], references: [id, levelDefinitionId], onDelete: Restrict, onUpdate: Cascade)
  assessmentVersion   AssessmentVersion? @relation(fields: [assessmentVersionId, levelDefinitionId], references: [id, levelDefinitionId], onDelete: Restrict, onUpdate: Cascade)
  createdBy           User?            @relation("LevelResourceBindingCreator", fields: [createdById], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@unique([levelDefinitionId, curriculumVersionId]) // Prisma one-to-one relation key
}
```

- SQL CHECK: `("contentVersionId" IS NOT NULL OR "assessmentVersionId" IS NOT NULL)` — пустой binding запрещён.
- Composite FK `(contentVersionId, levelDefinitionId) → ContentVersion(id, levelDefinitionId)` даёт DB-гарантию (1); аналогично для assessment — (2); а так как ресурс несёт и `curriculumVersionId` c FK на `LevelDefinition(id, curriculumVersionId)`, кросс-версионное прикрепление невозможно по построению — (3).
- (4): binding мутабелен только пока curriculum version — draft (service-guard `assertCurriculumEditable`-семейства + publish-валидация); после publish пара (level, binding) заморожена → published CurriculumVersion pin'ит точные versions. Правка контента = новая ContentVersion + новый binding **в новой draft curriculum version** — существующий pin не меняется (6).
- (5): все FK — Restrict; archived content читается historical enrollment'ами через их pinned версию.
- (7): Restrict всюду; SetNull только для nullable-автора (паттерн `createdBy` Phase 1B.1).
- Циклических FK нет; `LevelDefinition` не изменяется вовсе (даже ADD COLUMN не нужен) — это строго аддитивнее плана Phase 1B.1 и обновляет его: **колонки `contentVersionId`/`assessmentVersionId` в `LevelDefinition` не добавляются; их роль выполняет binding-таблица.** Отклонение от Phase 1B.1-плана мотивировано composite-FK-требованием и фиксируется этим документом.

Publish-валидация CurriculumVersion расширяется (4B.2/4B.3): каждый **active** level типа `lesson` обязан иметь binding c published ContentVersion; `lesson` c `completionMethod='assessment_pass'` и `final_exam` — published AssessmentVersion (final_exam — и content, если урок-обёртка предусмотрена; см. §22.13); levels типов `external_event`/`financial_checkpoint` binding не требуют. Сам `LevelDefinition` и его строгие admin-схемы не меняются.

Future additive migration plan — §17.

---

## 6. Assessment models

### 6.1 Модели

```prisma
model AssessmentVersion {
  id                  Int                   @id @default(autoincrement())
  levelDefinitionId   Int
  curriculumVersionId Int
  versionNumber       Int
  status              ContentResourceStatus @default(draft)
  passPercent         Int                   // CHECK BETWEEN 1 AND 100; продуктовый стандарт 80
  maxAttempts         Int?                  // NULL = unlimited (зафиксировано); поле для будущих policies, CHECK > 0
  showExplanation     Boolean               @default(false)
  createdById         Int?
  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt
  publishedAt         DateTime?
  archivedAt          DateTime?
  changeNotes         String?
  levelDefinition     LevelDefinition       @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  createdBy           User?                 @relation("AssessmentVersionCreator", fields: [createdById], references: [id], onDelete: SetNull, onUpdate: Cascade)
  questions           QuestionDefinition[]
  attempts            AssessmentAttempt[]

  @@unique([id, levelDefinitionId])          // parent key: binding и attempts
  @@unique([levelDefinitionId, versionNumber])
  @@index([curriculumVersionId, status])
}

model QuestionDefinition {
  id                  Int               @id @default(autoincrement())
  assessmentVersionId Int
  questionNumber      Int               // порядок; unique per version
  stableKey           String            // stable code вопроса внутри версии (для answers/аналитики)
  type                QuestionType      // migration CHECK mirrors the 7 approved types
  skillTag            String?
  status              CurriculumDefinitionStatus @default(active)
  options             Json?             // упорядоченные stable option codes: [{code}...] (labels — в localization)
  correctAnswer       Json              // SERVER-ONLY. Канонический ответ (§8); НИКОГДА не сериализуется наружу
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  assessmentVersion   AssessmentVersion @relation(fields: [assessmentVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  localizations       QuestionLocalization[]

  @@unique([assessmentVersionId, questionNumber])
  @@unique([assessmentVersionId, stableKey])
}

model QuestionLocalization {
  id           Int                @id @default(autoincrement())
  questionId   Int
  locale       String
  prompt       String
  optionLabels Json?              // {code -> label}; ключи обязаны совпадать с options
  explanation  String?            // выдаётся только после submit (§22.8)
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt
  question     QuestionDefinition @relation(fields: [questionId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([questionId, locale])
}

model AssessmentAttempt {
  id                  Int               @id @default(autoincrement())
  userId              Int
  enrollmentId        Int
  curriculumVersionId Int
  levelDefinitionId   Int
  assessmentVersionId Int
  attemptNumber       Int               // CHECK > 0
  status              AssessmentAttemptStatus @default(in_progress)
  startedAt           DateTime          @default(now())
  submittedAt         DateTime?
  durationSeconds     Int?              // server-derived: submittedAt - startedAt; CHECK >= 0
  totalQuestions      Int?              // snapshot на submit; CHECK > 0 при NOT NULL
  correctCount        Int?              // CHECK >= 0
  scoreBasisPoints    Int?              // floor(correct*10000/total); display-only; CHECK 0..10000
  submittedAnswers    Json?             // канонизированные ответы {stableKey -> normalized answer}; БЕЗ correct-флагов
  answersFingerprint  String?           // sha256 канонического payload — идемпотентность submit
  startRequestId      String            // durable client idempotency identity (UUID)
  submitRequestId     String?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  user                User                     @relation("AssessmentAttemptUser", fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  enrollment          UserCurriculumEnrollment @relation(fields: [enrollmentId, userId, curriculumVersionId], references: [id, userId, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  levelDefinition     LevelDefinition          @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  assessmentVersion   AssessmentVersion        @relation(fields: [assessmentVersionId, levelDefinitionId], references: [id, levelDefinitionId], onDelete: Restrict, onUpdate: Cascade)

  @@unique([enrollmentId, assessmentVersionId, attemptNumber])
  @@unique([enrollmentId, startRequestId])   // идемпотентный start per enrollment
  @@index([enrollmentId, assessmentVersionId, status])
  @@index([userId, createdAt])
  @@index([assessmentVersionId, status])
}
```

Плюс partial unique в SQL: `ON AssessmentAttempt(enrollmentId, assessmentVersionId) WHERE status='in_progress'` — не более одного active attempt на enrollment+assessment (DB-защита от start-race).

### 6.2 DB-запреты (discriminator-обоснование)

- attempt пользователя A для enrollment пользователя B — невозможен: composite FK `(enrollmentId, userId, curriculumVersionId) → UserCurriculumEnrollment(id, userId, curriculumVersionId)` (паттерн XPTransaction).
- assessment другой curriculum version — невозможен: `(levelDefinitionId, curriculumVersionId) → LevelDefinition(id, curriculumVersionId)` + `(assessmentVersionId, levelDefinitionId) → AssessmentVersion(id, levelDefinitionId)`: цепочка enrollment→version→level→assessment замкнута на одних значениях полей строки.
- assessment другого level — невозможен: тот же `(assessmentVersionId, levelDefinitionId)`-FK.
- перепривязка attempt после submit: FK-колонки защищены `ON UPDATE CASCADE` только со стороны parents; произвольный UPDATE discriminator-полей приложением не экспортируется; DB-триггеров нет (SQLite/runner-ограничение §2.3) — это service-level инвариант, проверяемый резолвером fail-closed (аналог `resolveEnrollmentXp`-валидации), плюс CAS-предикаты всех submit-мутаций (`WHERE status='in_progress'`). Ограничение фиксируется в Known limitations Phase 4.
- Optional relation к `UserLevelProgress` **не добавляется**: связь выводится по `(enrollmentId, levelDefinitionId)` (unique в UserLevelProgress); дублирующий FK создал бы вторую истину и потребовал синхронизации. Это и есть рекомендованная форма «optional relation» — вычислимая, не хранимая.

---

## 7. Assessment lifecycle

- `draft` — mutable: вопросы/локализации CRUD, `passPercent`/`maxAttempts` изменяемы.
- `published` — иммутабельны: сама версия, все `QuestionDefinition` (включая `status`, `options`, `correctAnswer`) и `QuestionLocalization` существующих locale. Добавление locale — та же политика, что у контента (§22.2).
- `archived` — historical: не назначается новым binding'ам; существующие attempts продолжают ссылаться.
- Correction = новая AssessmentVersion (новый `versionNumber` per level) + новый binding в новой draft curriculum version. Старые attempts не пересчитываются и продолжают ссылаться на свою версию (иммутабельность обеих сторон).
- «Одна current published» — как у контента: partial unique `ON AssessmentVersion(levelDefinitionId) WHERE status='published'`. Точная привязка всё равно даётся binding'ом (exact pin); partial unique — авторинговая гигиена, а не резолюция.
- Deletion published/used версий запрещено: Restrict-FK от attempts/binding + service-запрет (draft без attempts — единственное удаляемое состояние; у draft attempts быть не может, т.к. start работает только по published binding published curriculum — инвариант 4B.5).
- Publish-валидация AssessmentVersion: ≥1 active вопрос; для `lesson`-assessment — 5–7 вопросов; для `final_exam` — ровно 30 вопросов и ≥3 вопроса типа `scenario_choice` (продуктовые константы; серверные, не клиентские); `passPercent` соответствует продукту (80); каждый вопрос валиден по type-контракту (§8); обязательные locale покрыты; audit awaited в tx.
- В published-версии не бывает `disabled` вопросов: publish отклоняет их (автор обязан удалить или включить), а появление `disabled` в published после publish — corruption, fail-closed (§9). Это service+publish-level инвариант; DB CHECK условной формы SQLite не выразит.

DB-уровень: CHECK-allowlists статусов; unique-ключи; Restrict. Service-уровень: draft-only мутации, publish-валидация, иммутабельность published, count/type-правила.

---

## 8. Question contract (per type)

Общее для всех типов: `stableKey` (`^[a-z0-9][a-z0-9-]{0,63}$`, unique per version) — идентичность вопроса в answers/результатах; `options` — упорядоченный массив `{code}` со stable codes (`^[a-z0-9][a-z0-9_-]{0,31}$`, unique в вопросе); локализованные `prompt`/`optionLabels`/`explanation` — только в `QuestionLocalization` (ключи `optionLabels` обязаны биективно совпадать с `options` — publish-валидация); `correctAnswer` — server-only Json, никогда не покидает сервер до submit (и после — по reveal-политике §22.8); `skillTag` — свободный ограниченный тег (`≤64`); порядок — `questionNumber`; `active/disabled` — только в draft (§7); scoring детерминирован канонизацией (§9).

| type | prompt/структура | `options` | `correctAnswer` (server-only) | Ответ клиента (input schema) | Scoring rule | Канонизация |
|---|---|---|---|---|---|---|
| `single_choice` | текст | 2–8 codes | `{code}` | `{code}` — один из options | равенство code | trim; код должен ∈ options |
| `multiple_choice` | текст | 3–10 codes | `{codes: [..]}` (set, ≥1) | `{codes: [..]}` непустой, без дублей | **set-равенство**; partial credit НЕ вводится без решения (§22.6) — по умолчанию всё-или-ничего | сортировка codes; дубль = INVALID (reject, не «неверно») |
| `true_false` | текст | фиксированные `true`/`false` | `{code}` | `{code}` | равенство | как single |
| `ordered_steps` | текст + шаги | 3–8 codes (шаги) | `{codes: [полный порядок]}` | `{codes: [..]}` — перестановка ВСЕХ options | exact order (полное совпадение последовательности) | дубль/пропуск = INVALID |
| `scenario_choice` | сценарный кейс (rich prompt: ситуация, параметры) | 2–6 codes (решения) | `{code}` | `{code}` | правильность определяется **правилами процесса** (заложенными автором в correctAnswer), не финансовым результатом сценария; движок не «прогоняет рынок» | как single |
| `numeric` | текст | нет | `{value: string-decimal}` (+ tolerance-поля только после §22.5) | `{value: string}` — decimal `^-?\d{1,12}(\.\d{1,6})?$` | по умолчанию exact-совпадение канонизированных decimal; tolerance/rounding НЕ изобретаются — open decision §22.5 | decimal-строка: trim, нормализация `-0`→`0`, отсечение хвостовых нулей; **никакого float** (string/scaled-integer сравнение) |
| `chart_choice` | текст + chart-asset | 2–8 codes | `{code}` | `{code}` | равенство | как single; **asset ownership**: chart — `ContentAsset(kind='chart')` того же level'а ЛИБО asset-ссылка внутри вопроса, валидируемая той же URL/host-политикой; версия графика зафиксирована published-версией вопроса (asset immutable §4) |

INVALID-ответ (нарушение input-схемы, чужой code, дубли, не-перестановка) отклоняет **весь submit** с 400 до какого-либо scoring — совместимо с «duplicate/missing/foreign answers отклоняются» (§9). Disabled вопрос в published — corruption (§7), а не «пропуск».

---

## 9. Scoring

- Score считает **только** backend по server-side `correctAnswer`; клиент не передаёт `score/passed/correct*` ни в каком поле (strict Zod отклонит).
- Exact question set validation: submit обязан содержать ровно по одному ответу на **каждый** active вопрос pinned AssessmentVersion — ни пропусков, ни дублей `stableKey`, ни чужих ключей. Нарушение → 400 `ASSESSMENT_ANSWERS_INVALID`, attempt остаётся `in_progress`.
- Pass-сравнение без floating point: `passed = correctCount * 100 >= passPercent * totalQuestions` (целочисленно; принятая рекомендация). `scoreBasisPoints = floor(correctCount * 10000 / totalQuestions)` — производное display-поле, не участвует в pass-решении.
- `totalQuestions` snapshot'ится на submit и обязан равняться числу active вопросов версии (расхождение → corruption 409, версия published-иммутабельна, значит счётчик стабилен).
- Pass threshold иммутабелен вместе с published-версией (`passPercent` — поле версии).
- Explanation выдаётся только в submit-response (и, по политике §22.8, в attempt-result после submit). `correctAnswer` не попадает ни в content GET, ни в start, ни в history-list.
- В attempt сохраняются: `correctCount`, `totalQuestions`, `scoreBasisPoints`, `status(passed|failed)`, `startedAt/submittedAt`, server-derived `durationSeconds`, канонизированные `submittedAnswers` (без correct-флагов), `assessmentVersionId` (pin), `answersFingerprint`, `submitRequestId`.
- Per-question результат (какие верны/неверны) в submit-response вычисляется на лету; отдельно не хранится (восстановим детерминированно из `submittedAnswers` + иммутабельной версии) — экономия хранения без потери воспроизводимости.

---

## 10. Attempt lifecycle

Минимальный enum (РЕКОМЕНДОВАНО): `in_progress | passed | failed`. Рассмотрены и отклонены: `submitted` как отдельный статус (submit атомарен со scoring — промежуточное состояние не наблюдаемо); `abandoned/expired` (resume-семантика делает их ненужными — §22.10); `invalidated` (admin-коррекция аттемптов вне scope Phase 4).

- **START:** flags (§12) → session/active user → enrollment resolve (published/archived pin) → level state: требуется существующий durable `in_progress` progress текущего уровня (lazy start уровня — отдельная команда Phase 2B.4; assessment start её НЕ вызывает — навязывание side-effect'а нарушило бы её actor-only контракт) → binding published AssessmentVersion → идемпотентность: `(enrollmentId, startRequestId)` unique — тот же requestId возвращает существующий attempt `created=false`; активный attempt при другом requestId → 409 `ASSESSMENT_ATTEMPT_ACTIVE` со ссылкой на attempt (resume) → allocation `attemptNumber = max+1` в tx (unique `(enrollmentId, assessmentVersionId, attemptNumber)` ловит race; loser один retry — паттерн Phase 3B.4 CAS-retry) → partial unique active attempt закрывает двойной start окончательно.
- **Unlimited attempts** — default (`maxAttempts NULL`); `maxAttempts` версии применяется как service-check на start (`attemptNumber > maxAttempts` → 409) — значение для final exam/scenario не изобретается (§22.9).
- **SUBMIT:** CAS `UPDATE … SET status=passed|failed, … WHERE id=? AND status='in_progress'` — проигравший parallel-submit получает 0 строк → перечитывает и, если это exact-duplicate (тот же `submitRequestId` + `answersFingerprint`), возвращает stored result `created=false`; тот же key + другие answers → 409 `ASSESSMENT_SUBMIT_CONFLICT`; чужой/новый key на уже submitted attempt → 409.
- **fail** → immutable `failed` attempt; XP/completion не выполняются; retry → новый attempt (новый `startRequestId`).
- **pass** → immutable `passed` attempt + §11.
- **Stale assessment version:** невозможен по построению — attempt pin'ит `assessmentVersionId` через binding pinned curriculum version enrollment'а, а binding после publish неизменяем; смена возможна только с version-migration enrollment'а (отдельная будущая команда), при которой active attempt старой версии досдаётся против своей иммутабельной версии — фиксируется как инвариант, не как обработчик.
- **Completed level retry:** разрешён (unlimited attempts) — практика без эффектов: submit проставляет passed/failed, но completion/XP не вызывается, если durable progress уже `completed` (проверка внутри той же tx). XP «только за первое успешное прохождение» дополнительно защищён durable XP-идемпотентностью (§11).
- **No mutation after submitted:** service-invariant + CAS-предикаты; DB-триггеров нет (§6.2).
- Request identities (`startRequestId`, `submitRequestId`) — UUID клиента, server-валидируются (формат), хранятся durable в attempt (паттерн `PromocodeRedemptionRequest` Phase 3B.5).

---

## 11. Atomic assessment pass (одна транзакция)

Порядок (все шаги в **одной** `prisma.$transaction`, кроме шага 1):

1. Feature flags (§12) + session/active user + CSRF/rate limit — HTTP-граница до tx.
2. В tx: enrollment/level/assessment валидация — attempt принадлежит session-user (discriminators §6.2), enrollment active, pinned version согласована, binding указывает на этот `assessmentVersionId`.
3. Attempt CAS (`in_progress` → submitted) — §10.
4. Server scoring (§9) по иммутабельной версии.
5. Attempt сохраняется как `passed|failed` (счётчики, answers, fingerprint, `submittedAt`, `durationSeconds`); `UserLevelProgress.attemptCount` инкрементируется и `lastProgressAt` обновляется той же tx (поле существует с Phase 2, до сих пор не использовалось; это его профильная фаза).
6. **fail:** commit без XP/completion/enrollment-мутаций. Audit `CURRICULUM_ASSESSMENT_SUBMITTED` (без ответов в metadata) — awaited в tx.
7. **first pass** (durable progress ещё не `completed`): вызов `completeCurriculumLevelInTransaction(tx, {enrollmentId, levelDefinitionId, sourceType: "assessment_pass", sourceId: String(attempt.id), actorId: userId, evaluationTime})` — транзакционная форма Phase 3B.4 внутри **той же** tx (вложенной tx нет — контракт 3B.4).
8. XP `sourceType='assessment_pass'`; `sourceId` = durable `AssessmentAttempt.id` — глобальная идемпотентность XP на уровне ledger (partial unique `(enrollmentId, sourceType, sourceId)`), «XP только за первый pass» усилен тем, что completion вызывается только при не-completed progress.
9. Progress/enrollment/XP/оба audit'а — атомарны внутри 3B.4-вызова (доказано Phase 3B.4-регрессией).
10. Repeat pass (уже completed) — completion не вызывается (шаг 7-guard), XP не начисляется.
11. Rollback-инвариант: любой сбой шагов 4–9 откатывает и CAS шага 3 → не существует submitted-passed attempt без completion/XP (для first pass) и не существует completion без attempt.
12. `completionEvidence` остаётся `null` (контракт Phase 2/3B.4: CAS требует `completionEvidence=null` и не пишет его); durable связь attempt↔completion — `XPTransaction.sourceId` + audit `sourceIdHash`. Отдельный evidence-writer не вводится.

### 11.1 Конфликт с Phase 3B.4 owner mapping и минимальное расширение

Фактические `OWNER_RULES` (аудит `completion.ts`): `assessment_pass` принимает **только** пару `final_exam:assessment_pass`. Утверждённый Phase 4-контракт «обычный урок = 5–7 вопросов, 80 %» означает, что owner обычного assessed-урока — тоже assessment-движок. Сейчас такой вызов упал бы в `COMPLETION_OWNER_MISMATCH` (пара `lesson:assessment_pass` не замаплена ни на один source → точнее `COMPLETION_OWNER_UNAVAILABLE`).

**Минимальное будущее расширение (Phase 4B.5, НЕ Phase 4A):** добавить пару `"lesson:assessment_pass"` в `OWNER_RULES.assessment_pass.pairs` (initialStatus `in_progress` уже совпадает). Одна строка allowlist'а; `final_exam:assessment_pass` сохраняется; `lesson:lesson|lesson:manual → level_completion` не меняется (не-assessed уроки legacy-типа остаются валидными); scenario/practice/external/checkpoint остаются fail-closed. Совместность подтверждена аудитом: сам механизм 3B.4 полностью параметричен паре `type:completionMethod`, спец-логики final_exam в нём нет. Симметрично publish-валидация (4B.3) требует у `lesson`+`completionMethod='assessment_pass'` published assessment binding.

- ordinary lesson assessments → `lesson:assessment_pass` (после расширения);
- final_exam → `final_exam:assessment_pass` (уже поддержан); «3 scenario cases» финального экзамена — это вопросы типа `scenario_choice` **внутри** exam-версии, отдельный level-тип `scenario` для них не нужен;
- отдельные `scenario`-levels (если продукт их введёт как самостоятельные уровни) остаются fail-closed до собственной фазы (§22.14).

Код Phase 3 в Phase 4A не меняется.

---

## 12. Feature flags

Новые default-false env-флаги (паттерн `env.ts`: `=== "true"`, читаются на call time):

- `CURRICULUM_V2_CONTENT_ENABLED` — user-facing content read + lesson progress;
- `CURRICULUM_V2_ASSESSMENT_ENABLED` — user-facing assessment runtime.

Matrix (`R`=READ, `E`=ENROLLMENT, `X`=XP, `C`=CONTENT, `A`=ASSESSMENT, `Adm`=ADMIN):

| Операция | R | E | X | C | A | Adm | Поведение при недостатке |
|---|---|---|---|---|---|---|---|
| GET level content | ✔ | ✔ | — | ✔ | — | — | любой отсутствующий флаг → disabled; будущий HTTP-mapper обязан скрывать route до auth |
| SAVE lesson progress | ✔ | ✔ | — | ✔ | — | — | 404 до auth |
| START assessment | ✔ | ✔ | ✔ | — | ✔ | — | 404 до auth |
| SUBMIT assessment (fail) | ✔ | ✔ | ✔ | — | ✔ | — | 404 до auth |
| SUBMIT assessment (pass + XP + completion) | ✔ | ✔ | ✔ | — | ✔ | — | как выше; внутри tx повторная 3B.4-проверка флагов — вторая линия |
| GET attempt result/history | ✔ | — | — | — | ✔ | — | 404 до auth |
| Admin content/assessment authoring, binding, publish/archive | — | — | — | — | — | ✔ | `gateCurriculumAdmin` (существующий), 404 до auth |

Обоснования: START/SUBMIT требуют XP-флаг **симметрично** (не только pass-ветка), иначе выключение XP между start и submit порождало бы passed-attempt-без-completion — запрещённое состояние (§11.11). Pinned content read и lesson autosave требуют одновременно READ+ENROLLMENT+CONTENT: флаги читаются на каждом вызове, default false, ADMIN/ASSESSMENT/XP не могут заменить ни один из них. Admin authoring гейтится только ADMIN — это отдельная плоскость. Выключение любого user-флага скрывает только соответствующую подсистему; live env этим этапом не меняется.

---

## 13. API contracts (будущие routes; в Phase 4A не создаются)

### 13.0 Phase 4B.6 final HTTP contract (normative override)

Этот подраздел заменяет все несовместимые URL, методы, flags, request identity и response reveal из предварительной таблицы Phase 4A ниже. Старая таблица сохранена только как design history и не является нормативной.

Все успешные ответы Phase 4 имеют форму `{ "data": ... }`. Ошибки имеют форму `{ "error": "STABLE_CODE" }`; `issues` присутствует только для безопасных structured validation/publication issues. Каждый ответ имеет `Cache-Control: no-store`. Route-модули не выполняют Prisma mutations. Admin GET используют read-only query services; attempt history использует `resolveOwnAssessmentAttemptHistory`.

#### Admin content

Все routes требуют `ADMIN+CONTENT` до authentication, затем session, active admin, общий curriculum-admin actor bucket, CSRF для mutations, strict path/query/body, ownership и domain command.

- `GET/POST /api/admin/curriculum/versions/{id}/levels/{levelId}/content-versions`
- `GET/PATCH/DELETE /api/admin/curriculum/versions/{id}/levels/{levelId}/content-versions/{contentVersionId}`
- `POST .../content-versions/{contentVersionId}/publish` со strict `{expectedPublishedContentVersionId:number|null}`
- `POST .../content-versions/{contentVersionId}/archive` с отсутствующим body или strict `{}`
- `POST .../content-versions/{contentVersionId}/localizations`
- `PATCH/DELETE .../content-versions/{contentVersionId}/localizations/{localizationId}`
- `POST .../content-versions/{contentVersionId}/assets`
- `PATCH/DELETE .../content-versions/{contentVersionId}/assets/{assetId}`
- `PUT/DELETE /api/admin/curriculum/versions/{id}/levels/{levelId}/content-binding`; PUT — strict `{contentVersionId:number}`, DELETE — strict empty и сохраняет assessment side.

Content version POST создаёт только draft version; nested localizations/assets отклоняются.

#### Admin assessment

Все routes требуют `ADMIN+ASSESSMENT` с тем же security order.

- `GET/POST /api/admin/curriculum/versions/{id}/levels/{levelId}/assessment-versions`
- `GET/PATCH/DELETE .../assessment-versions/{assessmentVersionId}`
- `POST .../assessment-versions/{assessmentVersionId}/publish` со strict `{expectedPublishedAssessmentVersionId:number|null}`
- `POST .../assessment-versions/{assessmentVersionId}/archive` с отсутствующим body или strict `{}`
- `POST .../assessment-versions/{assessmentVersionId}/questions`
- `PATCH/DELETE .../assessment-versions/{assessmentVersionId}/questions/{questionId}`
- `POST .../questions/{questionId}/localizations`
- `PATCH/DELETE .../questions/{questionId}/localizations/{localizationId}`
- `PUT/DELETE /api/admin/curriculum/versions/{id}/levels/{levelId}/assessment-binding`; DELETE сохраняет content side.

Assessment version POST создаёт только draft version; nested questions/localizations отклоняются. Admin reads никогда не возвращают raw `correctAnswer`; возвращается `correctAnswerConfigured`. Mutation responses, errors, audits и logs не повторяют grading secrets.

#### Self content and assessment

Security order mutations: profile flags, session, active user, один общий per-user mutation bucket, CSRF, strict header/path/body, self-only domain service. GET не требуют CSRF.

- `GET /api/curriculum/v2/levels/{stableCode}/content?locale=...` требует `READ+ENROLLMENT+CONTENT`; `locale` — единственный query, route делегирует только `resolveUserLevelContent`.
- `PATCH /api/curriculum/v2/levels/{stableCode}/lesson-progress` требует `READ+ENROLLMENT+CONTENT`; request identity — только `Idempotency-Key` (8–128 safe chars); body требует `expectedRevision` и утверждённые autosave fields. `requestId` в body запрещён. Response различает applied/exact retry и возвращает только accepted revision, applied time и safe progress.
- `POST /api/curriculum/v2/levels/{stableCode}/assessment/attempts` требует `READ+ENROLLMENT+ASSESSMENT`; strict body — `{locale}`. XP не является route gate. Response содержит safe questions и attempt identity, но не answer keys, explanations, fingerprints или ownership.
- `POST /api/curriculum/v2/assessment/attempts/{attemptId}/submit` требует `READ+ENROLLMENT+ASSESSMENT`; request identity — только `Idempotency-Key`; strict body — `{answers:[{questionKey,answer}]}`. Client score/status/XP/ownership отклоняются. Failed grading разрешён при XP off; только passing completion branch требует XP. Response aggregate-only и не раскрывает per-question correctness, answers или explanations.
- `GET /api/curriculum/v2/assessment/attempts` требует `READ+ENROLLMENT+ASSESSMENT`; разрешены только `limit` (default 20, 1–50) и authenticated-encrypted `cursor`. Результаты self-only, pinned к active/completed enrollment, отсортированы `startedAt DESC,id DESC`, bounded и не содержат answers, grading secrets, fingerprints, internal ownership, XP или audit data.

Final cancellations: batch content create, ambiguous assessment aliases, body `requestId` для autosave/start/submit, optional `expectedRevision`, XP start gate, per-question reveal, ADMIN-only authoring flags и combined resource-binding mutation не входят в Phase 4.

### 13.1 Preliminary Phase 4A table (historical, superseded by §13.0)

Общее: user-facing — порядок гейтов `flags → session → active user → strict query/body → resolver → allowlist mapper`; 404-неотличимость при любом отсутствующем флаге; `Cache-Control: no-store` на всех ответах; GET без CSRF, mutations — CSRF + rate limit; Prisma-объекты не сериализуются напрямую; internal IDs за пределами описанных полей, correctAnswer, email/role, audit, fingerprints, idempotency keys — запрещены в ответах. `attemptId` в path — единственный внешний internal-ID (self-ownership проверяется в tx; альтернатива opaque-токену отклонена как избыточная при строгом ownership-чеке).

| Route | Метод | Auth | Flags | Rate limit (per user) | CSRF | Body/Query | Response allowlist | Ошибки |
|---|---|---|---|---|---|---|---|---|
| `/api/curriculum/v2/levels/{stableCode}/content` | GET | session, active, self-enrollment | R+E+C | 120/10мин | нет | query: обязательный exact normalized `locale` | `{data:{level:{stableCode,levelNumber,title,type}, content:{versionNumber, locale, title, subtitle, summary, transcript, body, assets:[{kind,assetCode,locale,url,mimeType,sizeBytes,durationSeconds,checksum,sortOrder}], videoDurationSeconds}, lessonProgress?:{status,revision,playbackPositionSeconds,completedSections,progressData,startedAt,lastProgressAt,completedAt}}}` — internal IDs, assessment authority и XP НЕТ | 400 bad query/locale; 403 level не открыт; 404 no binding/locale; 409 corrupt |
| `/api/curriculum/v2/levels/{stableCode}/lesson-progress` | PUT | тот же | R+E+C | 120/10мин (autosave) | да | strict: `{requestId, playbackPositionSeconds?, completedSections?, progressData?}` | `{data:{status, playbackPositionSeconds, completedSections, lastProgressAt, completedAt}}` | 400; 403; 409 stale/corrupt; 429 |
| `/api/curriculum/v2/levels/{stableCode}/assessment/attempts` | POST (start) | тот же | R+E+X+A | 30/10мин | да | strict: `{requestId}` | `{data:{attemptId, attemptNumber, startedAt, passPercent, totalQuestions, questions:[{stableKey, questionNumber, type, prompt, options:[{code,label}], skillTag}]}}` — БЕЗ correctAnswer/explanation | 400; 403 level state; 404 no assessment; 409 `ASSESSMENT_ATTEMPT_ACTIVE`/maxAttempts; 429 |
| `/api/curriculum/v2/assessment/attempts/{attemptId}/submit` | POST | тот же + ownership attempt'а | R+E+X+A | 30/10мин | да | strict: `{requestId, answers:[{stableKey, answer}]}` | `{data:{status:'passed'\|'failed', correctCount, totalQuestions, scoreBasisPoints, passPercent, questions:[{stableKey, correct:bool, explanation?}], completion?:{levelNumber, xpAwarded, nextLevelNumber, terminal}}}` (`explanation`/reveal-глубина — §22.8) | 400 answers invalid; 403; 404 чужой/нет; 409 submit conflict/duplicate-key-diff-payload; 429 |
| `/api/curriculum/v2/assessment/attempts` | GET (history) | тот же | R+A | 60/10мин | нет | query: `level` (stableCode), `limit` 1–50, `cursor?` (authenticated-encrypted, паттерн xp/history) | `{data:{items:[{attemptNumber, status, correctCount, totalQuestions, scoreBasisPoints, startedAt, submittedAt}], nextCursor}}` — без ответов | 400 cursor/query; 409 corrupt |
| `/api/admin/curriculum/versions/{id}/levels/{levelId}/content` | GET/POST | admin | Adm | shared 50/10мин write-bucket | POST: да | POST strict: `{localizations:[...], assets:[...], videoDurationSeconds?, changeNotes?}` | admin-репрезентация draft-версии | `curriculumErrorResponse`-паттерн |
| `/api/admin/curriculum/content/{contentId}` | PATCH/DELETE (draft-only) | admin | Adm | shared | да | strict-подсхемы | то же | 409 published immutable |
| `/api/admin/curriculum/content/{contentId}/publish` \| `/archive` | POST | admin | Adm | shared | да | strict `{}` | published/archived summary | 422 validation issues |
| `/api/admin/curriculum/versions/{id}/levels/{levelId}/assessments` (+ `/api/admin/curriculum/assessments/{id}`, `/questions`, `/publish`, `/archive`) | аналогично content | admin | Adm | shared | да | strict; вопросы с `correctAnswer` принимаются ТОЛЬКО здесь | admin-репрезентация; `correctAnswer` отдаётся только admin'у draft-версии | аналогично |
| `/api/admin/curriculum/versions/{id}/levels/{levelId}/resource-binding` | PUT (draft curriculum only) | admin | Adm | shared | да | strict: `{contentVersionId?, assessmentVersionId?}` | binding summary | 409 not draft/ownership mismatch |

Idempotency: user-мутации несут body `requestId` (UUID; durable в своих моделях). Admin-авторинг идемпотентности по ключу не требует (паттерн Phase 1B.4/1B.5 сохранён).

---

## 14. Security

- Self-only: content/progress/attempts — только для session-user'а через его enrollment; никаких `userId`-параметров; IDOR закрыт discriminator-FK + ownership-проверками в tx (attemptId чужого пользователя → 404, не 403 — не подтверждаем существование).
- Admin authoring отделён (роль `admin`, `gateCurriculumAdmin`, shared write bucket); mentor/support/news_editor доступа к авторингу не имеют.
- Actor — только из session; `createdById`/`actorId` не принимаются извне (паттерн Phase 1–3).
- `stableCode` в path валидируется существующим `STABLE_CODE_PATTERN` до любого запроса; path ownership — через pinned-версию enrollment'а (level ищется только внутри неё).
- Body size limits: JSON-body ≤ 256 KB (content authoring), ≤ 32 KB (user-мутации); Zod-строгие схемы; лимиты §4.
- Correct-answer secrecy: `correctAnswer` не входит ни в один user-facing маппер (regression-инвариант: сериализованный ответ каждого user-route не содержит подстрок correctAnswer-значений); explanation — только после submit.
- Safe assets/URLs: §4 (https-only, host-политика §22.4, без `data:`/`javascript:`); stored XSS: контент — text/markdown-subset, raw HTML отклоняется на входе, клиент рендерит без `dangerouslySetInnerHTML` (обязательство UI-фазы, фиксируется контрактом).
- Metadata allowlist: XP-metadata — существующий Phase 3B.2-фильтр; новые audit-metadata — только technical IDs/counters; **контент и ответы в audit не пишутся** (ни prompt, ни answers, ни correct-флаги; допустимы attemptId/counts/status).
- No raw Prisma/SQL в ответах; ошибка — типизированные코 codes + `curriculumReadErrorResponse`/`curriculumErrorResponse`-паттерны.
- Rate limits: таблица §13 (autosave 120/10мин; start/submit 30/10мин; history 60/10мин; admin — общий bucket 50/10мин). In-memory limiter — известное MVP-ограничение (см. §2.3).
- CSRF: все мутации; GET — нет (совместимо с house style).
- Клиент не контролирует: score, passed, XP, completion, attemptNumber, версии, locale-fallback-порядок, `videoDuration` (авторская величина), «просмотрено N %» (телеметрия, не authority — §22.12).

---

## 15. Lesson progress

Отдельная durable-модель, НЕ смешанная с `UserLevelProgress` (у того — statuses уровня и CAS-контракт 3B.4; консьюмерский прогресс контента — другая ось изменений и другой писатель):

```prisma
model UserLessonProgress {
  id                      Int      @id @default(autoincrement())
  userId                  Int
  enrollmentId            Int
  curriculumVersionId     Int
  levelDefinitionId       Int
  contentVersionId        Int
  status                  LessonProgressStatus @default(in_progress)
  startedAt               DateTime @default(now())
  lastProgressAt          DateTime @default(now())
  completedAt             DateTime?
  playbackPositionSeconds Int      @default(0)  // CHECK >= 0
  completedSections       Json     @default("[]") // массив section-codes; монотонное множество
  progressData            Json?    // bounded (≤ 8 KB), allowlist-ключи; НЕ authority
  lastRequestId           String?  // compatibility marker последнего применённого autosave
  revision                Int      @default(0)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  user            User                     @relation("UserLessonProgressUser", fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  enrollment      UserCurriculumEnrollment @relation(fields: [enrollmentId, userId, curriculumVersionId], references: [id, userId, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  levelDefinition LevelDefinition          @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  contentVersion  ContentVersion           @relation(fields: [contentVersionId, levelDefinitionId], references: [id, levelDefinitionId], onDelete: Restrict, onUpdate: Cascade)
  saveReceipts    UserLessonProgressSaveReceipt[]

  @@unique([enrollmentId, contentVersionId])
  @@unique([id, userId, enrollmentId, curriculumVersionId, levelDefinitionId, contentVersionId])
  @@index([enrollmentId, levelDefinitionId])
  @@index([userId, lastProgressAt])
}
```

### 15.1. Phase 4B.4.1 — schema hardening для autosave

`UserLessonProgressSaveReceipt` — durable append-only application ledger успешных autosave. Каждая квитанция хранит полный parent discriminator (`lessonProgressId`, user, enrollment, curriculum version, level, exact content version), `requestId`, положительную `revision`, канонический `payloadFingerprint` формата `sha256:<64 lowercase hex>` и DB-generated `appliedAt`. Единственный composite FK с `ON DELETE RESTRICT` не позволяет смешивать ownership/pin-компоненты разных progress rows. Unique `(userId, requestId)` задаёт глобальную для пользователя идемпотентность запроса, unique `(lessonProgressId, revision)` — одного победителя каждой ревизии. Существующие progress rows получают `revision=0`; миграция не создаёт для них искусственных receipts и не выполняет backfill/DML.

Runtime 4B.4 выполняет один алгоритм в одной транзакции: (1) нормализует и валидирует payload, вычисляет fingerprint из actor + полного pinned scope + точной content version + payload; (2) ищет receipt по `(userId, requestId)` — совпадение полного ownership/scope, fingerprint и `receipt.revision === expectedRevision + 1` означает exact retry, любое отличие даёт idempotency conflict; (3) без matching receipt проверяет `expectedRevision` против текущей `UserLessonProgress.revision`, stale/gap/negative отклоняет; (4) принятая revision равна `currentRevision + 1`; (5) применяет состояние CAS-обновлением `WHERE id=? AND revision=?`, одновременно сохраняя `lastRequestId` и `lastProgressAt`; (6) вставляет receipt; (7) при P2002/CAS-гонке выполняет durable reread и полное сравнение до выбора idempotent success или conflict/stale. Update progress и insert receipt commit/rollback вместе.

Exact retry старого save после более новых revisions не откатывает progress: response возвращает исходные `acceptedRevision`/`appliedAt` из receipt и текущий authoritative progress snapshot. Receipt не хранит старый snapshot, поэтому byte-identical старый response не обещается. Timestamp'ы при retry, stale, conflict и no-change не обновляются.

Append-only — граница command service/application: штатный код не обновляет и не удаляет receipts. SQLite-схема намеренно не добавляет triggers и не заявляет абсолютную неизменяемость против privileged raw SQL. Политика retention/очистки receipts отсутствует и этим этапом не изобретается; автоматическое удаление или каскад запрещены.

Pin'ы: enrollment (c user/version-дискриминаторами), curriculum version, level, **точная ContentVersion**, user — все требуемые, все composite-FK.

`videoDuration`: **reference, не snapshot** — `ContentVersion.videoDurationSeconds` иммутабелен после publish, снапшотить нечего; сервис клэмпит `playbackPositionSeconds ∈ [0, videoDurationSeconds]` (NaN/отрицательное/не-целое → 400; больше длительности → clamp к длительности; duration NULL → позиция принимает любое неотрицательное ≤ 86400 — safety-потолок).

Правила:

- Autosave runtime использует receipt + fingerprint + revision/CAS из §15.1; одного `lastRequestId` недостаточно. Позиция может уходить назад (пересмотр), значение clamped к pinned duration; `completedSections` — только монотонное объединение, unknown section code отклоняется. Разрешённый `progressData` сейчас строго ограничен `{activeSectionCode: string|null}` и остаётся presentation-only.
- Client video percent НЕ является authority XP/completion: Phase 4B.4 не меняет `status`/`completedAt`, не начисляет XP, не трогает `UserLevelProgress` и не завершает уровень. После durable completion новый autosave запрещён, но ранее принятый exact receipt retry остаётся доступен и не мутирует состояние. Условие перевода lesson progress в `completed` остаётся open decision §22.11.
- Stale ContentVersion не перезаписывает прогресс новой: unique `(enrollmentId, contentVersionId)` держит прогресс per-версионно; исторические строки сохраняются (Restrict); при будущей version-migration новая версия получает **новую** строку.
- Write throttling: rate limit 120/10мин + рекомендация клиенту слать autosave не чаще раза в 15 с (сервер дополнительно может no-op'ить неизменившийся payload — дешёвый фингерпринт-чек).
- No V1 writes: `UserTaskProgress`/`XpEvent`/`User.xp` не затрагиваются.
- Fake anti-cheat не вводится (никаких «доказательств просмотра» без телеметрии); `progressData` — описательная, лимитированная, не участвует ни в каких решениях.

### 15.2. Phase 4B.4 — pinned read resolver и actor-only autosave

- `resolveUserLevelContent` — server-only read, без HTTP. Он принимает только trusted `actorUserId`, ровно один selector (`levelNumber` XOR `stableCode`), обязательный exact normalized locale и optional transaction client. Без client'а весь read выполняется в одной snapshot transaction с одним `evaluationTime`; с client'ом nested transaction не открывается.
- Путь разрешения фиксирован: actor → его enrollment → pinned published/archived curriculum version → level → `LevelResourceBinding` → exact published `ContentVersion` → exact locale → neutral+same-locale assets в стабильном порядке → exact lesson progress. Latest/fallback/V1 lookup, automatic repin, lazy start и любые writes запрещены.
- Чтение допускается для current `available`, durable `in_progress`, исторического `completed`, а `pending_review` — только для `report`/`mentor_review`. `locked`, `xp_eligible`, future, inactive, candidate и неподдерживаемые level types fail closed; ordinary lesson в `pending_review` не читается. Archived curriculum pin валиден при целостном graph.
- Public union: `disabled | user_not_found | not_enrolled | unavailable | locked | available | completed | corrupt`. Safe mapper возвращает только allowlisted level/content/localization/asset/progress fields; internal IDs, raw Prisma, assessment questions/answers, fingerprints и XP отсутствуют.
- `saveOwnLessonProgress` — actor-only command без target user/version/content IDs, timestamps или желаемого status. Новый save требует active user/enrollment, exact published binding, `lesson`, durable `UserLevelProgress.in_progress` и валидную expected revision. First row принимается только с revision 0 и атомарно создаёт progress revision 1 + receipt; legacy row revision 0 без receipts поддерживается после полной проверки.
- Единственные runtime mutations: `UserLessonProgress` и `UserLessonProgressSaveReceipt`. Enrollment summary/`lastMeaningfulActionAt`, level status, completion, XP, assessment attempts, audit, notification, CRM и V1 не меняются. HTTP, CSRF/rate limit и route mapping остаются следующей фазой.

---

## 16. V1 compatibility

- `src/lib/lessonContent.ts` не удаляется; страница `/tasks/[taskCode]` продолжает работать как есть.
- V1 task/quiz routes (`/api/tasks*`) в foundation не меняются (их race/exposure-долги — известные V1-ограничения; починка = переход на V2, не патчинг V1).
- `UserTaskProgress`/`TaskReport` не мигрируются; backfill контента/attempts не выполняется.
- Existing UI при flags off — только V1; все V2 Phase 4-routes скрыты (404 до auth).
- No production assignment: binding'и создаются только авторингом в draft; никакого автоматического назначения контента существующим enrollment'ам.
- Populated upgrade (обязательная регрессия 4B.1+): применение полной additive-цепочки к реалистичной V1-базе сохраняет все V1-данные; новые таблицы пусты; runner идемпотентен.

---

## 17. Migration plan (только план; в Phase 4A не выполняется)

Одна additive-миграция Phase 4B.1 — `20260715000000_content_assessment_foundation` (имя ориентировочное):

```sql
-- 1. ContentVersion (+ CHECK status IN ('draft','published','archived'),
--    CHECK videoDurationSeconds IS NULL OR videoDurationSeconds > 0)
CREATE TABLE "ContentVersion" (...);
CREATE UNIQUE INDEX "ContentVersion_id_levelDefinitionId_key" ON "ContentVersion"("id","levelDefinitionId");
CREATE UNIQUE INDEX "ContentVersion_levelDefinitionId_versionNumber_key" ON "ContentVersion"("levelDefinitionId","versionNumber");
CREATE UNIQUE INDEX "ContentVersion_published_per_level_key" ON "ContentVersion"("levelDefinitionId") WHERE "status"='published';
CREATE INDEX "ContentVersion_curriculumVersionId_status_idx" ON "ContentVersion"("curriculumVersionId","status");

-- 2. ContentLocalization (unique(contentVersionId, locale))
-- 3. ContentAsset (CHECK kind IN (...), CHECK sizeBytes/durationSeconds > 0 при NOT NULL,
--    stable assetCode, unique(id, contentVersionId), unique(contentVersionId, assetCode),
--    unique(contentVersionId, sortOrder), index(contentVersionId, kind, locale))
-- 4. AssessmentVersion (CHECK passPercent BETWEEN 1 AND 100, CHECK maxAttempts IS NULL OR maxAttempts > 0,
--    unique(id, levelDefinitionId), unique(levelDefinitionId, versionNumber),
--    partial unique published per level, как у ContentVersion)
-- 5. QuestionDefinition (CHECK type IN (7 типов), CHECK status IN ('active','disabled'),
--    unique(assessmentVersionId, questionNumber), unique(assessmentVersionId, stableKey))
-- 6. QuestionLocalization (unique(questionId, locale))
-- 7. LevelResourceBinding (unique(levelDefinitionId),
--    CHECK ("contentVersionId" IS NOT NULL OR "assessmentVersionId" IS NOT NULL),
--    composite FK (contentVersionId, levelDefinitionId) -> ContentVersion(id, levelDefinitionId),
--    composite FK (assessmentVersionId, levelDefinitionId) -> AssessmentVersion(id, levelDefinitionId),
--    composite FK (levelDefinitionId, curriculumVersionId) -> LevelDefinition(id, curriculumVersionId))
-- 8. AssessmentAttempt (CHECK status IN ('in_progress','passed','failed'), CHECK attemptNumber > 0,
--    CHECK-и счётчиков; unique(enrollmentId, assessmentVersionId, attemptNumber);
--    unique(enrollmentId, startRequestId);
--    composite FK (enrollmentId, userId, curriculumVersionId) -> UserCurriculumEnrollment(id, userId, curriculumVersionId);
--    composite FK (levelDefinitionId, curriculumVersionId) -> LevelDefinition(id, curriculumVersionId);
--    composite FK (assessmentVersionId, levelDefinitionId) -> AssessmentVersion(id, levelDefinitionId));
CREATE UNIQUE INDEX "AssessmentAttempt_active_per_assessment_key"
ON "AssessmentAttempt"("enrollmentId","assessmentVersionId") WHERE "status"='in_progress';

-- 9. UserLessonProgress (CHECK status IN ('in_progress','completed'), CHECK playbackPositionSeconds >= 0,
--    unique(enrollmentId, contentVersionId); composite FK как в §15)
```

Свойства: только `CREATE TABLE`/`CREATE INDEX` — **никаких** `ALTER/DROP/RENAME` V1- и Phase 1–3-таблиц (включая `LevelDefinition` — §5.3); все нужные parent unique keys уже существуют (`LevelDefinition(id, curriculumVersionId)`, `UserCurriculumEnrollment(id, userId, curriculumVersionId)`); Prisma-enums фиксируют утверждённые словари lifecycle, asset kind, question type, attempt status и lesson-progress status, а migration дублирует их SQLite `CHECK`-allowlist'ами; no seed/backfill; custom runner-совместимость — без триггеров, statement'ы разделены `;`; FK-порядок создания: ContentVersion → ContentLocalization/ContentAsset → AssessmentVersion → QuestionDefinition → QuestionLocalization → LevelResourceBinding → AssessmentAttempt → UserLessonProgress. Rollback (документируемый, вручную): DROP в обратном порядке — child-таблицы прежде parents; данных V1 rollback не касается.

---

## 18. Regression plan (Phase 4B, минимальные группы)

| Группа | Что доказывается | Этап |
|---|---|---|
| schema/FK/cross-version | все composite FK отклоняют чужого user/version/level; CHECK'и; partial uniques; parent keys | 4B.1 |
| lifecycle immutability | draft-only мутации; publish → immutable; archive; deletion policy; повторный publish/archive — ошибка | 4B.2/4B.3 |
| content localization | completeness на publish; locale-fallback чтения; аддитивная локализация по политике §22.2 | 4B.2/4B.4 |
| content attachment | binding draft-only; ownership-нарушения (DB+service); pin неизменен после publish; archived доступен historical | 4B.2 |
| question validation | 7 типов: контракты, INVALID-входы, biективность optionLabels, stableKey-уникальность, 5–7/30/scenario-правила publish | 4B.3 |
| correct-answer secrecy | ни один user-response (content GET/start/history/submit-fail) не содержит correctAnswer; bundle-инвариант V2 (контент не в коде) | 4B.4/4B.5 |
| deterministic scoring | integer-pass-граница (ровно 80 %, 79.9→fail), канонизация, повторный расчёт идентичен | 4B.5 |
| assessment start idempotency | same requestId → same attempt; active attempt → 409; partial unique под гонкой | 4B.5 |
| attempt numbering race | параллельные start → уникальные номера, один active | 4B.5 |
| submit pass/fail | fail без XP/completion; pass → атомарный 3B.4-вызов; счётчики/duration server-derived | 4B.5 |
| duplicate/parallel submit | CAS; exact-retry stored result; same-key-diff-answers → 409; parallel → один победитель | 4B.5 |
| first-pass-only XP | retry после pass — без XP/completion; ledger идемпотентность по sourceId | 4B.5 |
| completion atomic rollback | инъекция сбоя после CAS → нет passed-attempt без completion; нет completion без attempt | 4B.5 |
| old assessment version | correction создаёт новую версию; старые attempts читаются против своей версии; пересчёта нет | 4B.3/4B.5 |
| lesson progress autosave/idempotency | клэмпы, монотонность sections, same-request no-op, stale-версия не перезаписывает | 4B.4 |
| V1 compatibility | V1 routes/lessonContent работают при flags off; V1-таблицы нетронуты | каждый этап |
| feature flags | полная матрица §12, 404-неотличимость, независимость флагов | 4B.4/4B.5/4B.6 |
| HTTP security | auth/CSRF/rate/strict body/allowlist/no-store/IDOR по каждому route | 4B.4–4B.6 |
| populated upgrade | additive-цепочка на населённой V1-базе; новые таблицы пусты; идемпотентный runner | 4B.1, повторно в 4B.6 |
| cumulative Phase 1–3 gates | `test:regression:curriculum-phase3` (внутри — phase2/phase1) остаются зелёными на каждом этапе | каждый этап |

Phase 4 completion gate (4B.6): `curriculumPhase4Gate.ts` — последовательный запуск всех Phase 4-suites + вложенный Phase 3 gate, контроль отсутствия listeners/артефактов (паттерн Phase 3).

---

## 19. Open decisions

Формат: Evidence → Варианты → Рекомендация → Trade-offs → Blocker → Крайний этап решения.

1. **Default locale — решено в Phase 4B.2.** Default locale отсутствует: каждая localization принимает обязательный явный нормализованный locale; publish требует минимум одну валидную localization, но не hardcode'ит `ru` или `en`. Read-fallback остаётся отдельным решением Phase 4B.4.
2. **Localization model — решено в Phase 4B.2.** Выбран logical ContentVersion + ContentLocalization children. Published/archived version и все children полностью immutable; новый перевод требует новой ContentVersion.
3. **Content JSON vs structured tables.** Evidence: §4; прецедент `visibilityRule Json`. Варианты: Json `body` (рекомендовано); typed-таблицы sections/examples. Trade-offs: таблицы дают SQL-валидацию, но контент не участвует в FK/фильтрах, а publish-Zod даёт эквивалентную строгость. Blocker: schema 4B.1. Крайний этап: **до 4B.1**.
4. **Asset hosting/domain policy — решено для Phase 4B.2.** Asset хранит только metadata/reference. Принимается абсолютный HTTPS URL длиной до 2048 без userinfo и unsafe scheme; upload/storage/network/provider/CDN и hostname allowlist не реализуются и не изобретаются этим этапом.
5. **Numeric tolerance.** Evidence: типов вопросов в V1 нет; продуктовое правило не задано. Варианты: exact decimal (рекомендовано как default); ± absolute tolerance; ± relative %. Рекомендация: exact в 4B; tolerance-поля не добавлять до решения. Trade-offs: exact прост и детерминирован, но жесток к «введите ≈0.33». Blocker: контракт `correctAnswer` numeric-вопросов. Крайний этап: **до 4B.3** (схема Json расширяема — можно и позже, новой версией assessment'а).
6. **Multiple-choice partial credit.** Evidence: продуктом не задан. Варианты: всё-или-ничего (рекомендовано); частичный балл. Trade-offs: partial усложняет «correctCount» (дробные баллы ломают integer-scoring §9). Blocker: scoring 4B.5. Крайний этап: **до 4B.5**.
7. **Question randomization (порядок вопросов/опций per attempt).** Evidence: не задан; хранение порядка per attempt потребовало бы snapshot. Варианты: фиксированный порядок (рекомендовано для 4B); shuffle с сохранением seed в attempt. Trade-offs: shuffle против списывания, но требует seed-поля и усложняет воспроизводимость. Blocker: start-response 4B.5. Крайний этап: **до 4B.5**.
8. **Explanation/correct-answer reveal.** Evidence: продукт зафиксировал только «не до submit». Варианты: (i) после submit — per-question correct/incorrect + explanation, без правильных кодов (рекомендовано: не «сливает» банк при retry); (ii) полные правильные ответы после pass; (iii) ничего кроме счёта. Blocker: submit-response mapper 4B.5. Крайний этап: **до 4B.5**.
9. **maxAttempts для final exam/scenario.** Evidence: «unlimited attempts» зафиксирован для обычных уроков; для exam не оговорено. Варианты: NULL (unlimited, рекомендовано до решения); конечный лимит. Blocker: нет (поле уже nullable). Крайний этап: **до продуктового rollout** (не блокирует 4B).
10. **Abandon/expire active attempt.** Evidence: resume-семантика (§10) делает истечение необязательным. Варианты: без expiry (рекомендовано); TTL+автозакрытие. Trade-offs: TTL требует фонового процесса/lazy-expire и нового статуса. Blocker: нет. Крайний этап: Phase 4 не блокирует; пересмотр при телеметрии зависших attempts.
11. **Lesson completion condition (`UserLessonProgress.status='completed'`).** Evidence: клиентский video percent не может быть authority (зафиксировано). Варианты: явный клиентский сигнал «дошёл до конца» (презентационный, рекомендовано); серверная эвристика (позиция ≥ N % длительности); только assessment pass. Blocker: 4B.4 write-контракт. Крайний этап: **до 4B.4**.
12. **Video progress trust.** Evidence: телеметрии нет. Варианты: позиция — описательная (рекомендовано, зафиксированной строкой «не authority»); анти-чит. Рекомендация: не вводить анти-чит без телеметрии (зафиксировано заданием). Крайний этап: n/a (решение фактически принято, фиксируется продуктом).
13. **Assessed lesson mapping Phase 3B.4.** Evidence: §11.1 — `lesson:assessment_pass` отсутствует в OWNER_RULES. Варианты: расширение пары (рекомендовано); отдельный `assessed_lesson`-тип level'а. Trade-offs: новый тип — миграция словаря типов и авторинга ради дублирования семантики. Blocker: 4B.5. Крайний этап: **до 4B.5** (подтверждение продукта, что не-assessed lessons остаются разрешёнными в V2 — иначе publish-валидация обязана требовать assessment у каждого lesson).
14. **Practice draft — Phase 4 или отдельный этап.** Evidence: `practice`-тип уровня существует; хранилища драфтов нет; Gap Analysis относит «SAVE practice draft» к API-разделу 19. Рекомендация: **вне Phase 4** (отдельная фаза вместе с report workflow V2/Phase 5 — семантика ближе к отчётам). Blocker: нет для 4B. Крайний этап: планирование Phase 5.
15. **Question snapshot vs immutable reference в attempt.** Evidence: published AssessmentVersion иммутабельна (DB+service, §7). Варианты: reference (рекомендовано) + канонизированные `submittedAnswers`; полный снапшот вопросов в attempt. Trade-offs: снапшот защищает от нарушения иммутабельности privileged-SQL'ем, но дублирует данные и создаёт вторую истину; reference опирается на уже принятые Phase 3-грани («privileged raw SQL может мутировать» — общее известное ограничение). Blocker: 4B.1 (форма attempt-таблицы). Крайний этап: **до 4B.1**.
16. **Content/assessment attachment strategy (финализация).** Evidence: §5; решение Phase 1B.1 предполагало колонки, аудит выявил composite-FK/rebuild-ограничение. Варианты: binding-таблица (рекомендовано); одноколоночные FK-колонки (без same-level DB-гарантии); rebuild LevelDefinition (отвергнут). Дополнительная грань: политика переиспользования контента между curriculum-версиями (copy-on-new-version vs shared) — при binding+ownership контент копируется в новую версию авторингом; расход принят. Blocker: 4B.1. Крайний этап: **до 4B.1**.

---

## 20. Декомпозиция Phase 4 (реализационные этапы)

### Phase 4B.1 — Schema foundation
- **Scope:** миграция §17 (9 таблиц, CHECK'и, partial uniques, composite FK), Prisma-модели, schema-регрессия (FK/CHECK/unique/cross-version инъекции), populated upgrade.
- **Forbidden:** runtime-код, routes, seed, изменение Phase 1–3 таблиц/кода, триггеры.
- **Acceptance:** schema-suite (≈35–45 кейсов) + upgrade + Phase 3 gate зелёные; prisma validate/generate; lint/tsc/build.
- **Dependencies:** решения §22.3, §22.15, §22.16.
- **Stop:** любые непройденные DB-инъекции ownership; необходимость ALTER существующих таблиц.
- **Files:** `prisma/schema.prisma`, `prisma/migrations/20260715000000_content_assessment_foundation/migration.sql`, `scripts/regression/curriculumContentSchemaRegression.ts`, upgrade-расширение, `package.json` script.

### Phase 4B.2 — Content authoring/publication lifecycle
- **Implemented scope:** server-only domain-сервисы ContentVersion/Localization/Asset (draft CRUD, publish/replace/archive c валидацией §3.3/§4), exact content-part LevelResourceBinding (draft curriculum only), independent default-off feature flag и awaited transactional audit. Phase-задача явно сузила исходный план: HTTP и расширение общего CurriculumVersion publish validator не входят в 4B.2.
- **Forbidden:** любые HTTP routes, user-facing runtime, assessment/question authoring, attempt/scoring, lesson progress, XP, uploads/storage и V1-изменения.
- **Acceptance:** 48-case lifecycle regression, schema/upgrade/Phase 3 cumulative gates, Prisma/lint/tsc/build.
- **Resolved decisions for this stage:** locale всегда явный, default locale отсутствует; published/archived content и все children полностью immutable; asset reference принимает безопасный абсолютный HTTPS без userinfo, hostname allowlist не изобретается.
- **Stop:** невозможность выразить publish-валидацию без изменения Phase 1-кода сверх оговорённого расширения publish-проверки.
- **Files:** `src/lib/curriculum/content.ts`, `content-schemas.ts`, `content-validation.ts`, `content-errors.ts`, env/constants, lifecycle regression, docs и `package.json`; schema/migration не меняются.

### Phase 4B.3 — Assessment/question authoring lifecycle
- **Scope:** domain-сервисы AssessmentVersion/Question/Localization (draft CRUD, publish c §7/§8-валидацией: 5–7/30/scenario-правила, type-контракты, biективность labels), admin HTTP, audit.
- **Forbidden:** attempts runtime, scoring, user routes.
- **Acceptance:** question-validation suite (7 типов × валид/инвалид), lifecycle-immutability, old-version-correction, Phase 3 gate.
- **Dependencies:** 4B.1 (+4B.2 для binding-проверок publish); §22.5 (или его явная отсрочка), §22.13-подтверждение.
- **Stop:** необходимость менять словарь `LevelDefinitionType`.
- **Files:** `src/lib/curriculum/assessment-authoring.ts`, admin routes, регрессия, `package.json`.

### Phase 4B.4 — Content read and lesson progress
- **Scope:** флаг `CURRICULUM_V2_CONTENT_ENABLED`; `GET .../content` (locale-fallback, allowlist §13); `PUT .../lesson-progress` (§15); UserLessonProgress-сервис; HTTP-регрессии real-server (паттерн xp-api).
- **Forbidden:** assessment runtime, XP/completion-мутации, V1-изменения.
- **Acceptance:** content-read/progress-suites (≈45–60: flags-матрица, secrecy, клэмпы, идемпотентность, stale-версия, IDOR), Phase 3 gate.
- **Dependencies:** 4B.2; §22.1, §22.11.
- **Stop:** обнаружение необходимости отдавать correctAnswer/questions в content GET.
- **Files:** `src/lib/env.ts` (+flag), `src/lib/curriculum/content-read.ts`, `lesson-progress.ts`, routes `src/app/api/curriculum/v2/levels/[stableCode]/{content,lesson-progress}/route.ts`, регрессии.

### Phase 4B.5 — Assessment attempt/scoring/completion integration
- **Scope:** флаг `CURRICULUM_V2_ASSESSMENT_ENABLED`; start/submit/history сервис+routes; deterministic scoring §9; атомарный pass §11 c `completeCurriculumLevelInTransaction`; **минимальное расширение OWNER_RULES парой `lesson:assessment_pass`** (§11.1); attemptCount-инкремент.
- **Forbidden:** generic complete route; изменение других OWNER_RULES-пар; scenario/practice-owners; V1 XP.
- **Acceptance:** самые тяжёлые suites (§18 группы start/submit/race/rollback/first-pass-XP, ≈80–100); совместимость: level-completion 76 и promocode 67 остаются зелёными; Phase 3 gate.
- **Dependencies:** 4B.3, 4B.4; §22.6, §22.7, §22.8.
- **Stop:** любое требование ослабить атомарность (например «сохранить passed при сбое completion»).
- **Files:** `src/lib/curriculum/assessment.ts`, правка `completion.ts` (одна OWNER_RULES-строка), routes `.../assessment/attempts*`, `submit`, регрессии.

### Phase 4B.6 — HTTP/admin boundaries and Phase 4 completion gate
- **Scope:** сквозная security-матрица всех Phase 4-routes (флаги/401/403/400/409/429/no-store/CSRF), доудержание admin-границ, `curriculumPhase4Gate.ts` (вложенный Phase 3 gate), populated upgrade re-run, `V2_PHASE_4_COMPLETION.md`, обновление `V2_PRODUCT_DECISIONS.md` принятыми решениями §22.
- **Forbidden:** новые функциональные поверхности; UI; seed; rollout.
- **Acceptance:** полный Phase 4 gate зелёный; no leftover listeners/artifacts; prisma/lint/tsc/build.
- **Dependencies:** 4B.1–4B.5.
- **Stop:** расхождение фактических контрактов с этим документом без зафиксированного решения.
- **Files:** `scripts/regression/curriculumPhase4Gate.ts`, security-suite, docs, `package.json`.

UI, content seed (реальные уроки/вопросы) и production rollout в Phase 4 **не входят**.

---

## 21. Known limitations (фиксируются заранее)

- SQLite/runner: без триггеров иммутабельность published-строк и запрет UPDATE submitted attempts — service-level (privileged raw SQL может мутировать; общее ограничение с XP ledger).
- In-memory rate limiter per-process.
- Локализация V1-контента и перенос его в V2 (seed) — вне Phase 4.
- Version-migration enrollment'ов (и поведение lesson progress/attempts при ней) — отдельная будущая фаза; Phase 4 лишь не создаёт этому препятствий (per-version строки).
- `scenario`/`practice`/`external_event`/`financial_checkpoint` completion-owners остаются fail-closed.

---

## 22. Phase 4B.5 — утверждённый assessment runtime

- Реализованы только server-only actor-bound команды `startOwnAssessmentAttempt` и `submitOwnAssessmentAttempt`; HTTP, UI, history route и generic COMPLETE LEVEL endpoint отложены. Пользовательский payload не содержит target user, enrollment/version/level/assessment IDs, attempt number, score/status, XP или timestamps.
- Start/resume динамически требует READ + ENROLLMENT + ASSESSMENT. Passing submit дополнительно требует XP; ADMIN и CONTENT эти gates не заменяют. Все flags default false.
- Trusted resolution идёт только через active actor, active pinned enrollment, pinned CurriculumVersion, текущий started `UserLevelProgress`, exact `LevelResourceBinding` и exact published `AssessmentVersion`. Новейшая published curriculum version не repin'ит enrollment; archived curriculum pin остаётся допустимым.
- Частичный unique index остаётся authority одного `in_progress` attempt. Номер нового attempt равен `terminalCount + 1` внутри transaction; валидный active attempt возвращается без изменения timestamp/audit. Terminal attempts учитываются в nullable `maxAttempts`; исчерпание возвращает `ASSESSMENT_ATTEMPT_LIMIT_REACHED` и не завершает level.
- Start mapper возвращает только безопасную identity уровня, attempt id/number/status, pass/max-attempt presentation, exact locale и детерминированно упорядоченные prompt/option labels. `correctAnswer`, explanation, raw Prisma и внутренние ownership IDs не возвращаются. Locale exact, fallback отсутствует.
- Submit требует полный набор уникальных известных `questionKey`. `single_choice`, `true_false`, `scenario_choice` сравниваются по exact stable code; `multiple_choice` — как canonical set без partial credit; `ordered_steps` — как exact order. `numeric` и `chart_choice` grader не утверждены и fail closed для всей операции.
- Server score хранит `correctCount`, `totalQuestions` и `scoreBasisPoints = floor(correctCount * 10000 / totalQuestions)`. Pass authority использует только целочисленную формулу `correctCount * 100 >= passPercent * totalQuestions`.
- `AssessmentAttempt` хранит normalized submitted answers, `sha256:` fingerprint и `submitRequestId`; этого достаточно для exact retry, same-attempt different-payload conflict и durable reread после CAS/P2002 loser. Exact terminal retry не меняет timestamps, audits, XP, progress или enrollment. Historical terminal retry привязан к immutable AssessmentVersion самого attempt, включая archived replacement history, а не к будущему current binding.
- Failed submit атомарно переводит attempt в `failed`, сохраняет server score/answers/fingerprint и grading audit, но не меняет level/enrollment и не создаёт XP/completion audit. Следующий attempt разрешён только в пределах `maxAttempts`.
- Passed submit одной transaction выполняет CAS attempt, server grading, `completeCurriculumLevelInTransaction`, immutable `LevelDefinition.xpReward`, XP audit, progress/enrollment transition, completion audit и grading audit. Любая ошибка откатывает весь набор.
- Phase 3 OWNER_RULES минимально расширен парой `lesson:assessment_pass`. Для lesson completion core внутри той же transaction требует durable passed attempt того же user/enrollment/curriculum/level/AssessmentVersion с source identity `assessment-attempt:<id>`. Остальные owner mappings не изменены; final_exam mapping сохранён.
- Audit allowlist дополнен `CURRICULUM_ASSESSMENT_ATTEMPT_STARTED` и `CURRICULUM_ASSESSMENT_ATTEMPT_GRADED`. Audit awaited и transactional; metadata не содержит answers, correctAnswer, prompt, labels, explanation или raw JSON.
- Открытыми остаются product-policy для numeric tolerance/chart assets, abandon/expiry active attempt, default `maxAttempts` по типам и будущая политика explanation reveal. В 4B.5 утверждены deterministic order без shuffle и отсутствие answer/explanation reveal в runtime response.

*Документ не содержит secrets, паролей, реальных пользовательских данных и значений postback secret.*
