# ATA V2 — Phase 1A: Curriculum Versioning Schema Contract

**Статус:** технический schema-контракт (только анализ и документирование; schema, migrations, код не изменялись)
**Дата:** 2026-07-13
**Базовый HEAD:** 55de70fe1e4037c777e7e0066dbaf397e4edd3fa
**Связанные документы:** `V2_GAP_ANALYSIS.md`, `V2_PRODUCT_DECISIONS.md`

Scope Phase 1: только CurriculumVersion, ModuleDefinition, LevelDefinition. Enrollment, XP engine, checkpoints, content, assessments — в последующих фазах.

---

## 1. Current-schema findings

Read-only анализ `prisma/schema.prisma` и всех 20 миграций.

### 1.1 ID и default conventions

- Все модели: `Int @id @default(autoincrement())` → SQLite `INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT`.
- `createdAt DateTime @default(now())` → `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`; `updatedAt DateTime @updatedAt` (заполняется клиентом Prisma, в SQL — `DATETIME NOT NULL` без default).
- Денежные значения — `Float` (`REAL`), количества — `Int`.

### 1.2 Status-поля: два сосуществующих стиля

- **Prisma enum** (новые модели): `UserRole`, `UserStatus`, `NewsStatus (draft|published)`, `TaskReportStatus`, `SupportDialogStatus`, `PromocodeType`, `TesterFeedback*`. В SQLite хранится как `TEXT NOT NULL DEFAULT '...'` — БД значения не ограничивает, валидация на уровне Prisma-клиента.
- **String** (ранние game-logic модели): `Task.completionMethod`/`kind`, `Level.status`, `Checkpoint.status`, `UserTaskProgress.status`, `Reward.status` — свободный TEXT, значения контролируются кодом.

Вывод: для новых V2-моделей консистентно использовать **Prisma enum** для закрытых наборов (status, type) и String+Zod для потенциально расширяемых значений.

### 1.3 Relations и delete conventions

- Владелец → зависимые: `onDelete: Cascade` (User→UserTaskProgress, Task→UserTaskProgress, ChatChannel→Assignments и т.д.).
- Необязательные ссылки на людей/файлы: `onDelete: SetNull` (TaskReport.reviewer, SupportDialog.assignedTo, TesterFeedback.resolvedBy).
- В SQL всегда `ON UPDATE CASCADE`.
- Compound unique через `@@unique([a, b])` (UserTaskProgress, TaskReport, UserReward, DailyLoginReward, UserAchievement); индексы через `@@index` под частые выборки.

### 1.4 Json

`Json`/`Json?` используется (Notification.metadata, ExchangeAccount.attribution, Promocode.value, AuditLog.metadata) и в SQLite создаётся как колонка `JSONB`. Прецедент для `visibilityRule Json?` есть.

### 1.5 Migration-конвенции

- Папки `prisma/migrations/<timestamp>_<snake_name>/migration.sql`; аддитивные изменения через `ALTER TABLE ... ADD COLUMN` + `CREATE UNIQUE INDEX` (пример: `20260705180000_level_progression_tasks`).
- **Кастомный runner `prisma/migrate.ts`** (`npm run prisma:migrate`): применяет неприменённые миграции в транзакции, ведёт `_prisma_migrations`, **сплитит SQL по `;`** → в migration.sql нельзя использовать `;` внутри строковых литералов/триггеров. Наши будущие CREATE TABLE это ограничение не задевают.
- FK в SQLite активны (Prisma включает `PRAGMA foreign_keys`).

### 1.6 Zod/validation conventions

`src/lib/validation.ts`: схемы + `validateJsonBody(request, schema)` → `{success, data}|{response}`; ошибки — `validationErrorResponse(details[])` с кодом `VALIDATION_ERROR`; числовые параметры — `validateNumericParam`. Domain-ошибки возвращаются JSON `{error: CODE, message}`.

### 1.7 Service/repository и audit

- Бизнес-логика — функции в `src/lib/*` (пример: `taskProgression.completeProgressionTask` с `prisma.$transaction`); routes — тонкие (CSRF → validate → requireRole → service → audit → response).
- Audit: `createAuditLog({userId, action, entityType, entityId, metadata, request})`, action — UPPER_SNAKE (`TASK_COMPLETED`, `POSTBACK_RECEIVED`), ошибки audit проглатываются (не валят операцию).
- Роли: `requireAdmin`/`requireUser` + `permissions.ts` (admin-функции — только `role === "admin"`).

### 1.8 Feature/config flags и seed

- Флаги — env (`POCKET_POSTBACK_REQUIRE_SECRET`, `EMAIL_VERIFICATION_REQUIRED`); конфиг-в-БД прецедент — `ReferralBonusConfig` (slug + isActive).
- Seed: `prisma/seed.ts` (guard `ALLOW_PRODUCTION_SEED`, deleteMany + mock-данные) и отдельный `prisma/seedProgression.ts` для V1-маршрута из `prisma/progressionData.ts`.

### 1.9 Защита immutable/published данных

**Прецедента нет.** `NewsStatus draft|published` не даёт immutability; published-записи редактируются свободно. Вывод: неизменяемость published curriculum обеспечивается **только service-уровнем** (см. §5, §7) — БД-механизма в SQLite/Prisma для этого нет.

### 1.10 V1-модели, к которым V2 не прикасается

`Task` (16 строк, stable codes `lvl_01_*`…`lvl_16_*`), `Level` (16 порогов XP), `User.level/xp/currentTask`, `UserTaskProgress`, `Checkpoint`, `Reward/UserReward`. V2-модели создаются рядом, ничего не заменяя.

---

## 2. Proposed Prisma models (точный контракт)

```prisma
enum CurriculumVersionStatus {
  draft
  published
  archived
}

enum CurriculumDefinitionStatus {
  active
  disabled
}

enum LevelDefinitionType {
  external_event
  lesson
  scenario
  practice
  report
  mentor_review
  financial_checkpoint
  final_exam
}

model CurriculumVersion {
  id            Int                     @id @default(autoincrement())
  code          String
  name          String
  status        CurriculumVersionStatus @default(draft)
  versionNumber Int
  effectiveFrom DateTime?
  createdAt     DateTime                @default(now())
  publishedAt   DateTime?
  createdById   Int?
  changeNotes   String?
  createdBy     User?                   @relation("CurriculumVersionCreator", fields: [createdById], references: [id], onDelete: SetNull)
  modules       ModuleDefinition[]
  levels        LevelDefinition[]

  @@unique([code, versionNumber])
  @@index([status])
  @@index([createdById])
}

model ModuleDefinition {
  id                  Int                        @id @default(autoincrement())
  curriculumVersionId Int
  moduleNumber        Int
  code                String
  title               String
  description         String                     @default("")
  firstLevel          Int
  lastLevel           Int
  checkpointLevel     Int?
  learningObjective   String                     @default("")
  status              CurriculumDefinitionStatus @default(active)
  curriculumVersion   CurriculumVersion          @relation(fields: [curriculumVersionId], references: [id], onDelete: Restrict)
  levels              LevelDefinition[]

  @@unique([id, curriculumVersionId])
  @@unique([curriculumVersionId, moduleNumber])
  @@unique([curriculumVersionId, code])
  @@index([curriculumVersionId, firstLevel])
}

model LevelDefinition {
  id                      Int                        @id @default(autoincrement())
  curriculumVersionId     Int
  moduleId                Int
  levelNumber             Int
  stableCode              String
  type                    LevelDefinitionType
  title                   String
  shortDescription        String                     @default("")
  learningObjective       String                     @default("")
  completionMethod        String
  xpReward                Int                        @default(0)
  requiredXp              Int                        @default(0)
  requiredPreviousLevel   Int?
  requiredCheckpointLevel Int?
  featureUnlockCode       String?
  visibilityRule          Json?
  status                  CurriculumDefinitionStatus @default(active)
  curriculumVersion       CurriculumVersion          @relation(fields: [curriculumVersionId], references: [id], onDelete: Restrict)
  module                  ModuleDefinition           @relation(fields: [moduleId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict)

  @@unique([curriculumVersionId, levelNumber])
  @@unique([curriculumVersionId, stableCode])
  @@index([moduleId])
  @@index([curriculumVersionId, type])
}
```

Сопутствующее (виртуальное) изменение: в блок `model User` добавляется список
`curriculumVersionsCreated CurriculumVersion[] @relation("CurriculumVersionCreator")`.
Это **не меняет таблицу User в SQL** — FK-колонка живёт в CurriculumVersion; V1-данные не затрагиваются.

`contentVersionId` / `assessmentVersionId` — сознательно **отсутствуют** в Phase 1 (см. §4.3, УТВЕРЖДЕНО в Phase 1B.1): они будут добавлены аддитивной миграцией в Phase 4 вместе с таблицами ContentVersion/AssessmentVersion и настоящими FK.

Реализация Phase 1B.1: составная связь Level→Module по (moduleId, curriculumVersionId) → ModuleDefinition(id, curriculumVersionId) принята Prisma вместе с прямой relation Level→CurriculumVersion (общее поле curriculumVersionId в двух relations допускается), поэтому защита от cross-version mismatch обеспечена на уровне БД без ослабления прямой связи.

## 3. Таблица полей

### CurriculumVersion

| Поле | Тип (Prisma → SQLite) | Null/default | Обоснование |
|---|---|---|---|
| id | Int → INTEGER PK AUTOINCREMENT | — | конвенция проекта |
| code | String → TEXT | NOT NULL | идентификатор линии curriculum (напр. `ata-main`); уникален в паре с versionNumber |
| name | String → TEXT | NOT NULL | отображаемое имя |
| status | enum → TEXT | default `draft` | закрытый lifecycle-набор |
| versionNumber | Int → INTEGER | NOT NULL | монотонный номер внутри code |
| effectiveFrom | DateTime? | NULL | дата вступления; семантика планировщика — открытый вопрос (§11) |
| createdAt | DateTime | CURRENT_TIMESTAMP | конвенция |
| publishedAt | DateTime? | NULL | ставится только publish-операцией |
| createdById | Int? → INTEGER | NULL | nullable ради system-created версий и миграций |
| changeNotes | String? | NULL | заметки к версии |

### ModuleDefinition

| Поле | Тип | Null/default | Обоснование |
|---|---|---|---|
| curriculumVersionId | Int FK | NOT NULL, Restrict | модуль не существует вне версии; удаление версии блокируется при наличии модулей |
| moduleNumber | Int | NOT NULL | порядок; unique в версии |
| code | String | NOT NULL | человекочитаемый код; unique в версии |
| title / description / learningObjective | String | NOT NULL (`""` default для необязательных текстов) | конвенция «строки не nullable, а пустые» в текстовых описаниях |
| firstLevel / lastLevel | Int | NOT NULL | диапазон уровней модуля |
| checkpointLevel | Int? | NULL | номер checkpoint-уровня модуля; null = модуль без checkpoint |
| status | enum | default `active` | минимальный набор (§6) |

### LevelDefinition

| Поле | Тип | Null/default | Обоснование |
|---|---|---|---|
| curriculumVersionId | Int FK | NOT NULL, Restrict | денормализована сознательно: уникальности, выборки без join и составная связь с module |
| moduleId | Int FK (composite c curriculumVersionId) | NOT NULL, Restrict | принадлежность модулю строго той же версии (защита от cross-version mismatch на уровне БД) |
| levelNumber | Int | NOT NULL | глобальный номер в версии; unique в версии |
| stableCode | String | NOT NULL | стабильный код уровня; unique в версии (§4.1 — область уникальности) |
| type | enum(8) | NOT NULL | закрытый набор из спецификации |
| title / shortDescription / learningObjective | String | NOT NULL (`""` default для необязательных) | как в Module |
| completionMethod | String | NOT NULL | String+Zod-whitelist, а не enum: V1-прецедент (`Task.completionMethod`), набор значений V2 ещё не утверждён (§11) |
| xpReward / requiredXp | Int | default 0 | неотрицательность — Zod (§5) |
| requiredPreviousLevel | Int? | NULL | номер обязательного предыдущего уровня (обычно levelNumber−1); null допустим только для первого уровня |
| requiredCheckpointLevel | Int? | NULL | номер последнего checkpoint-уровня, который должен быть active |
| featureUnlockCode | String? | NULL | код будущей FeatureDefinition; до Phase 6 — просто строка, валидируется Zod-форматом |
| visibilityRule | Json? → JSONB | NULL | §4.5; null = default-видимость |
| status | enum | default `active` | §6 |

## 4. Неоднозначности (не решаются молча)

### 4.1 Stable code format

Факты по доступным документам:

- **`v2.l001.*`** — единственный формат, встречающийся в материалах: спецификация `back-ret.txt` (раздел 12, все 100 уровней: `v2.l001.pocket_registration` … `v2.l100.balance_10000`) и ответ продуктовой команды `otvet1.txt` («новые уровни получают codes `v2.l001.*`»).
- **`v2.level.001`** — в доступных документах (back-ret.txt, otvet1.txt, les-prog.txt, документы workspace) **не найден**; упомянут только в постановке задачи Phase 1A. Источник этого варианта вне доступных материалов.

Последствия форматов:

| | `v2.l001.pocket_registration` | `v2.level.001` |
|---|---|---|
| Читаемость | несёт смысл уровня (slug) | только номер |
| Стабильность при перестановке | код не содержит только номер, но `l001` фиксирует номер; при сдвиге уровня код станет обманчивым | то же, в чистом виде |
| Соответствие уже написанной спецификации | 100 кодов уже перечислены | потребует переписать раздел 12 |
| Парсинг | префикс+номер+slug | префикс+номер |

**РЕШЕНИЕ (утверждено, Phase 1B.1):** формат `v2.l001.<slug>` — lowercase, номер уровня всегда из трёх цифр, slug в lowercase kebab-case (примеры: `v2.l001.pocket-registration`, `v2.l002.tradequest-mechanics`, `v2.l010.balance-checkpoint`). V1 task codes не изменяются. Строгий regex — service/Zod-слоем в следующих этапах; SQLite CHECK для slug не используется.

**Уникальность (утверждено):** compound `@@unique([curriculumVersionId, stableCode])`. Тот же stableCode разрешено повторно использовать в новой CurriculumVersion (клонирование/преемственность уровней); глобальная преемственность смысла кода — publish-валидация, не DB-констрейнт.

### 4.2 Status у Module/Level

Спецификация фиксирует lifecycle только для CurriculumVersion. **РЕШЕНИЕ (утверждено, Phase 1B.1)** — минимальный вариант:

- **Definitions наследуют lifecycle версии.** Собственного draft/published у Module/Level нет; редактируемость определяется статусом родительской версии (draft → можно, published/archived → нельзя).
- Собственный status definitions — только `active | disabled`: флаг исключения из маршрута при подготовке черновика (аналог is-enabled), не lifecycle.
- Запрещённые комбинации (service/publish-валидация):
  - публикация версии, где `disabled`-уровень находится внутри диапазона модуля и на него ссылаются prerequisites;
  - `disabled` module при `active` уровнях внутри него;
  - изменение status definitions у published версии (immutability).

### 4.3 Future relations (ContentVersion, AssessmentVersion, FeatureDefinition)

Варианты:

- **A. Nullable Int-идентификатор без FK уже сейчас.** Плюс: контракт полей полный. Минус: до Phase 4 колонки могут накопить orphaned-значения; FK потом добавить в SQLite **нельзя** без пересоздания таблицы (ALTER TABLE ADD CONSTRAINT не поддерживается) — Prisma сделает это через table-rebuild-миграцию, что для якорной таблицы curriculum нежелательно.
- **B. Отложить колонки до соответствующих фаз (УТВЕРЖДЕНО, Phase 1B.1).** `contentVersionId`, `assessmentVersionId` добавляются в Phase 4 одной аддитивной миграцией вместе с таблицами и настоящими FK (`ALTER TABLE "LevelDefinition" ADD COLUMN ... REFERENCES ...` — SQLite позволяет добавить колонку с REFERENCES при ADD COLUMN). Orphaned-идентификаторы исключены по построению; publish-валидация Phase 4 добавит проверку «каждый lesson имеет published content».
- `featureUnlockCode` — оставить строкой уже в Phase 1 (это код, не FK; FeatureDefinition в Phase 6 сошьётся по коду; publish-валидация Phase 6 проверит существование кода).

### 4.4 createdBy

Текущая User model: `Int @id`, множество обратных relations. **РЕШЕНИЕ (утверждено, Phase 1B.1):**

- relation `createdBy User?` c `createdById Int?`, `onDelete: SetNull`, `ON UPDATE CASCADE`;
- **nullable** — обязательно: system-created версии (migration-скрипты, автоклонирование) не имеют автора-пользователя; удаление администратора не должно рушить историю curriculum;
- фактическое авторство дополнительно фиксируется в AuditLog (обязательный audit на create/publish/archive), поэтому SetNull не теряет след.

### 4.5 visibilityRule

**РЕШЕНИЕ (утверждено, Phase 1B.1):** storage contract — **`Json?` (SQLite JSONB — прецеденты в схеме есть) + строгая Zod-валидация на границе сервиса**; в Phase 1 допустимое значение только `null`.

- Не String: без структуры нельзя строго валидировать и эволюционировать.
- Не отдельная typed-таблица: rule engine в Phase 1 запрещён, таблица — преждевременная сложность.
- Контракт: discriminated union c обязательным полем `kind`; в Phase 1 допускается **только `null`** (= default-видимость по спецификации: виден ближайший checkpoint, дальние суммы скрыты — сама логика видимости реализуется в Phase 2+, не в определениях).
- Словарь `kind`-значений — открытое продуктовое решение (§11); Zod-схема будет расширяться перечислением, произвольные выражения запрещены.

## 5. Инварианты и уровни обеспечения

Prisma на SQLite не генерирует CHECK-констрейнты, enum'ы хранятся как TEXT, условные («только published») правила БД невыразимы — поэтому честное распределение такое:

| Инвариант | DB constraint | Zod (вход) | Service/tx | Publish-time |
|---|---|---|---|---|
| versionNumber > 0 | — | ✔ `int().positive()` | — | ✔ повторно |
| Уникальность curriculum code (+version) | ✔ `@@unique([code, versionNumber])` | формат кода | ловля P2002 → domain error | — |
| Уникальность versionNumber внутри code | ✔ (тот же compound) | — | ✔ выбор следующего номера в tx | — |
| «Один published на code» | — (условный unique в SQLite недоступен через Prisma) | — | ✔ в publish-tx | ✔ |
| moduleNumber > 0 | — | ✔ | — | ✔ |
| firstLevel <= lastLevel | — | ✔ `refine` | — | ✔ |
| checkpointLevel ∈ [firstLevel, lastLevel] или null | — | ✔ `refine` | — | ✔ |
| Module ranges не пересекаются | — | — (нужны все модули) | ✔ при create/update модуля в tx | ✔ |
| levelNumber ∈ диапазону своего module | — | — (кросс-сущность) | ✔ при create/update уровня в tx | ✔ |
| levelNumber уникален в версии | ✔ `@@unique([curriculumVersionId, levelNumber])` | — | P2002 → domain error | — |
| stableCode уникален в утверждённой области | ✔ compound (per-version) | формат (после решения §4.1) | P2002 | глобальная преемственность — publish |
| xpReward >= 0, requiredXp >= 0 | — | ✔ `int().min(0)` | — | ✔ |
| requiredPreviousLevel < levelNumber | — | ✔ `refine` | — | ✔ + «ровно один required previous» |
| requiredCheckpointLevel не указывает вперёд (<= levelNumber) и является checkpoint-уровнем | — | ✔ частично (<=) | — | ✔ полная проверка ссылки |
| Непрерывность level numbers (1..N без дыр) | — | — | — | ✔ |
| published immutable | — | — | ✔ guard в каждой mutate-операции (re-read статуса в tx) | n/a |
| publish только внутренне валидного curriculum | — | — | ✔ tx | ✔ validateCurriculumDraft внутри publish |
| Удаление published запрещено | частично ✔ (Restrict блокирует удаление версии при существующих definitions) | — | ✔ guard: delete разрешён только draft, снизу вверх | n/a |
| V1 tables/данные не изменяются | ✔ (миграция не содержит ALTER V1) | n/a | n/a | n/a |

Явно фиксируем: **immutability, пересечения диапазонов, непрерывность, кросс-ссылки — это service-level и publish-time валидация**; SQLite/Prisma сами это не обеспечат.

## 6. Status lifecycle

CurriculumVersion:

```text
draft ──publish──▶ published ──archive──▶ archived
  │ (создание/редактирование/удаление разрешены)
  └─ delete (только draft)
```

- Разрешённые переходы: `draft→published` (только через publishCurriculumVersion с валидацией), `published→archived`.
- Запрещены: `published→draft`, `archived→*` (un-archive — открытый вопрос §11), любые правки content-полей и definitions вне `draft`.
- Правка published = создание новой версии (`versionNumber + 1`, копия definitions) — операция клонирования проектируется в Phase 1B как create-draft-from-version.
- Module/Level definitions: `active|disabled`, редактируемы только при родительском `draft` (см. §4.2).

## 7. Draft/publish/archive invariants (реализовано в Phase 1B.2)

Фактический контракт `src/lib/curriculum/service.ts`:

- `publishCurriculumVersion({curriculumVersionId, actorId, expectedPublishedVersionId?})` — одна interactive-транзакция: проверка actor (active admin) → загрузка snapshot → статус строго `draft` (`CURRICULUM_NOT_DRAFT`) → `effectiveFrom` не в будущем (`CURRICULUM_EFFECTIVE_FROM_FUTURE`) → `validateCurriculumDraft` без issues (`CURRICULUM_INVALID` со всеми issues) → replacement-протокол: при существующей published-версии того же code обязателен её ID (`CURRICULUM_REPLACEMENT_REQUIRED` / `CURRICULUM_REPLACEMENT_MISMATCH`), старая версия атомарно становится `archived` → target: `status=published, publishedAt=now` → audit в той же транзакции (не проглатывается: сбой audit откатывает всё). Partial unique index — финальная DB-защита от race.
- `archiveCurriculumVersion({curriculumVersionId, actorId})` — одна транзакция: active admin → строго `published→archived` (`CURRICULUM_NOT_PUBLISHED` для draft/повторного archive) → audit. Definitions не изменяются.
- `assertCurriculumEditable(version)` — обязательный guard будущих CRUD: draft → ok; published → `CURRICULUM_PUBLISHED_IMMUTABLE`; archived → `CURRICULUM_ARCHIVED_IMMUTABLE`.
- Rejected-публикации аудируются вне откатанной транзакции (`CURRICULUM_PUBLICATION_REJECTED`, метаданные — только issue codes) по существующей fire-and-forget audit-политике.
- Никакая операция не изменяет и не удаляет published/archived definitions; клонирование в новый draft — единственный путь эволюции. createdAt и historical definitions не меняются.
- Delete: только `draft`; будущий draft-management service удаляет definitions явно снизу вверх (levels → modules → version) в одной транзакции — FK Restrict исключает неявный каскад; audit обязателен. Published и archived версии физически не удаляются.
- Scheduled publication не реализован; после ручного archive временно может не быть published-версии (public resolver появится позже).

## 8. Validation matrix / service boundaries (Phase 1B, проектирование)

Все операции: роль **admin** (`requireAdmin` + CSRF по конвенции), audit через `createAuditLog`, domain errors в формате `{error: CODE, message}`.

Статус реализации: `validateCurriculumDraft`, `publishCurriculumVersion`, `archiveCurriculumVersion` и guard `assertCurriculumEditable` реализованы в Phase 1B.2; draft-authoring команды — в Phase 1B.3 (`src/lib/curriculum/authoring.ts` + Zod DTO в `schemas.ts`).

### Draft-authoring contract (реализовано, Phase 1B.3)

Команды (все: typed DTO → Zod strict-схема → active-admin actor → `assertCurriculumEditable` → mutation + success-audit в одной транзакции; audit не проглатывается — его сбой откатывает mutation):

- `createCurriculumDraft` — status всегда `draft`, `publishedAt=null`, `createdBy=actorId`; передать status/publishedAt извне нельзя (strict DTO); дубль `(code, versionNumber)` → `CURRICULUM_CONFLICT`.
- `updateCurriculumDraft` — mutable: name, effectiveFrom (у draft может быть будущим), changeNotes. Immutable: code, versionNumber, status, publishedAt, createdBy, createdAt (strict patch → `CURRICULUM_INPUT_INVALID`).
- `deleteEmptyCurriculumDraft` — только draft и только без definitions (`CURRICULUM_NOT_EMPTY`); без cascade/deleteMany.
- `createModuleDefinition` / `updateModuleDefinition` — mutable: moduleNumber, code, title, description, learningObjective, firstLevel, lastLevel, checkpointLevel, status; immutable: id, curriculumVersionId. Дубли number/code в версии → `MODULE_CONFLICT`.
- `deleteEmptyModuleDefinition` — только без levels (`MODULE_NOT_EMPTY`).
- `createLevelDefinition` / `updateLevelDefinition` — mutable: moduleId (только module той же версии, иначе `MODULE_VERSION_MISMATCH`), levelNumber, stableCode, type, title, shortDescription, learningObjective, completionMethod, xpReward, requiredXp, requiredPreviousLevel, requiredCheckpointLevel, featureUnlockCode, status; immutable: id, curriculumVersionId, visibilityRule≠null. При смене levelNumber итоговый stableCode обязан соответствовать новому номеру (проверка merged-состояния). Дубли number/stableCode → `LEVEL_CONFLICT`.
- `deleteLevelDefinition` — удаление уровня draft-версии.

Write-time vs publish-time: на write-time проверяется локальная корректность одного объекта (формат stableCode и совпадение NNN, непустые code/title/learningObjective, firstLevel<=lastLevel, checkpointLevel в собственном диапазоне, requiredPrevious/Checkpoint < levelNumber, xp>=0, visibilityRule=null). Пересечения/разрывы диапазонов модулей, глобальная последовательность уровней и существование financial_checkpoint-ссылок на write-time РАЗРЕШЕНЫ (draft может собираться не по порядку) и блокируются только `validateCurriculumDraft` при publish.

Typed-ошибки authoring: `CURRICULUM_CONFLICT`, `CURRICULUM_NOT_EMPTY`, `CURRICULUM_INPUT_INVALID` (field-ошибки — структурированными issues, без отдельного кода на поле), `MODULE_NOT_FOUND/CONFLICT/NOT_EMPTY/VERSION_MISMATCH`, `LEVEL_NOT_FOUND/CONFLICT`; ожидаемые P2002/P2003/P2025 маппятся в них, raw Prisma-ошибки наружу не выходят.

Audit actions authoring: CURRICULUM_DRAFT_CREATED/UPDATED/DELETED, MODULE_DEFINITION_CREATED/UPDATED/DELETED, LEVEL_DEFINITION_CREATED/UPDATED/DELETED (metadata: actorId, curriculumVersionId, moduleDefinitionId/levelDefinitionId, code/number, changedFields для update; без before/after payload и контента).

### Feature-gated Admin API (реализовано, Phase 1B.4)

**Feature flag:** `CURRICULUM_V2_ADMIN_ENABLED` (env, default/отсутствие = false; placeholder в `.env.example`). При выключенном флаге все routes отвечают 404 `{error:"NOT_FOUND"}` — неотличимо от отсутствующего маршрута. Public/user routes не создавались; флаг в live не включён.

**Routes (только CurriculumVersion):**
- `GET  /api/admin/curriculum/versions` — list (query: status?, code?, page>=1, limit 1..100 default 20; сортировка createdAt desc, id desc; items с moduleCount/levelCount без full definitions + pagination {page, limit, total, totalPages});
- `POST /api/admin/curriculum/versions` — create draft (strict body: code, name, versionNumber, effectiveFrom? ISO, changeNotes?) → 201;
- `GET  /api/admin/curriculum/versions/[id]` — detail (modules по moduleNumber, levels по levelNumber, createdBy только {id, name, email});
- `PATCH /api/admin/curriculum/versions/[id]` — strict body только name/effectiveFrom/changeNotes, минимум одно поле; body без фактических изменений → 409 `CURRICULUM_NO_CHANGES` (утверждённый технический контракт: no-op PATCH не создаёт ложный audit);
- `DELETE /api/admin/curriculum/versions/[id]` — только пустой draft;
- `POST /api/admin/curriculum/versions/[id]/publish` — strict body `{expectedPublishedVersionId?: number|null}`;
- `POST /api/admin/curriculum/versions/[id]/archive` — пустой body/`{}`.
Module/Level write-endpoints не реализованы (следующая фаза).

**Security (порядок write-request):** feature flag → session authentication (401) → active admin (403; blocked admin → 403) → rate limit per endpoint+admin (30/10 мин → 429) → CSRF cookie+header (403) → strict-валидация ID/body (400) → domain service → safe response. actorId берётся ТОЛЬКО из сессии; actorId/role/createdBy в body/query отклоняются strict-схемами. GET: no CSRF, но flag+auth+admin; `Cache-Control: no-store`.

**Response contract:** успех `{data: ...}` (201 для create); ошибка `{error: "STABLE_CODE", issues?: [...]}`. Централизованный mapper domain→HTTP: CURRICULUM_INPUT_INVALID/битые ID/body → 400; auth → 401; ACTOR_FORBIDDEN/CSRF → 403; NOT_FOUND (+MODULE/LEVEL) → 404; CONFLICT/NOT_EMPTY/NOT_DRAFT/NOT_PUBLISHED/immutable/replacement/NO_CHANGES → 409; CURRICULUM_INVALID (с безопасным issues[])/EFFECTIVE_FROM_FUTURE → 422; rate limit → 429; неизвестное → 500 `INTERNAL_ERROR`. Raw Prisma/SQL/stack/пути/env наружу не попадают.

**Read-only query service** (`src/lib/curriculum/query.ts`): `listCurriculumVersions`, `getCurriculumVersionDetail` — без audit-записей; несуществующий ID → typed CURRICULUM_NOT_FOUND.

### Module/Level Admin API (реализовано, Phase 1B.5)

Наследует весь security-контур Phase 1B.4 (feature flag `CURRICULUM_V2_ADMIN_ENABLED`, session auth, active admin, CSRF, safe-error mapping). GET отдельно не добавлялся — modules/levels отдаёт существующий GET detail версии.

**Routes** (`[id]` = CurriculumVersion):
- `POST   /api/admin/curriculum/versions/[id]/modules` — create module → 201;
- `PATCH  /api/admin/curriculum/versions/[id]/modules/[moduleId]`;
- `DELETE /api/admin/curriculum/versions/[id]/modules/[moduleId]` — только пустой модуль;
- `POST   /api/admin/curriculum/versions/[id]/levels` — create level → 201;
- `PATCH  /api/admin/curriculum/versions/[id]/levels/[levelId]`;
- `DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]`.
Каждая команда вызывает соответствующий authoring-сервис Phase 1B.3 (`createModuleDefinition` … `deleteLevelDefinition`).

**Strict request contracts** (unknown keys → 400):
- POST module: `{moduleNumber, code, title, description?, firstLevel, lastLevel, checkpointLevel?, learningObjective, status?}` (status default active);
- PATCH module: partial из тех же полей (identity `id`/`curriculumVersionId` не принимаются), ≥1 поле;
- POST level: `{moduleId, levelNumber, stableCode, type, title, shortDescription?, learningObjective, completionMethod, xpReward, requiredXp, requiredPreviousLevel?, requiredCheckpointLevel?, featureUnlockCode?, status?}`; `visibilityRule`/`contentVersionId`/`assessmentVersionId` не принимаются (strict → 400);
- PATCH level: partial (включая `moduleId`), ≥1 поле, без visibilityRule/identity.
`actorId` всегда из сессии; `curriculumVersionId` — из path; тело их не принимает.

**Path ownership:** каждый module/level-запрос проверяет, что ресурс принадлежит именно версии из path (`assertModuleInVersion`/`assertLevelInVersion` в query.ts). Ресурс, существующий в другой версии → **404 MODULE_NOT_FOUND/LEVEL_NOT_FOUND** (факт существования чужого ресурса не раскрывается, mutation и audit не выполняются). Для create/patch level, если `moduleId` в теле принадлежит другой версии → тоже 404.

**No-change semantics:** сравнение на domain-уровне по merged state; `stripUndefined` отличает «поле не передано» / «явный null» / «очищенная строка». Если все переданные значения совпадают с текущими — mutation и audit не выполняются, возвращается **409 MODULE_NO_CHANGES / LEVEL_NO_CHANGES**. Published/archived-версия при этом даёт 409 IMMUTABLE раньше no-change проверки.

**Error mapping (расширение):** MODULE_NO_CHANGES / LEVEL_NO_CHANGES / MODULE_NOT_EMPTY / MODULE_CONFLICT / LEVEL_CONFLICT / MODULE_VERSION_MISMATCH → 409; MODULE_NOT_FOUND / LEVEL_NOT_FOUND (в т.ч. path-version mismatch) → 404; CURRICULUM_INPUT_INVALID → 400; immutable/not-draft → 409. Контракты CurriculumVersion-ошибок не менялись.

**Rate limit:** единый per-admin bucket `curriculum:admin:write:${adminId}` (лимит 50 / 10 мин) покрывает ВСЕ curriculum-admin mutations — обойти перебором разных route/ID нельзя.

| Операция | Zod input (ядро) | Tx boundary | Audit action | Immutable guard | Domain errors |
|---|---|---|---|---|---|
| createCurriculumVersionDraft | code, name, changeNotes?, effectiveFrom?; versionNumber вычисляется | одна tx (выбор max(versionNumber)+1 и insert) | CURRICULUM_VERSION_CREATED | — | CURRICULUM_CODE_INVALID |
| updateCurriculumVersionDraft | name?, changeNotes?, effectiveFrom? | tx: re-read status=draft → update | CURRICULUM_VERSION_UPDATED | ✔ draft-only | CURRICULUM_NOT_FOUND, CURRICULUM_PUBLISHED_IMMUTABLE |
| deleteCurriculumVersionDraft | id | tx: re-read draft → delete (cascade) | CURRICULUM_VERSION_DELETED | ✔ draft-only | те же |
| createModuleDefinition / updateModuleDefinition | номера/диапазоны/тексты (+refine §5) | tx: parent draft → range-overlap check → upsert | MODULE_DEFINITION_CREATED/UPDATED | ✔ parent draft | MODULE_RANGE_OVERLAP, DUPLICATE_MODULE_NUMBER, DUPLICATE_MODULE_CODE |
| createLevelDefinition / updateLevelDefinition | все поля уровня (+refine §5) | tx: parent draft → module range check → upsert | LEVEL_DEFINITION_CREATED/UPDATED | ✔ parent draft | LEVEL_OUT_OF_MODULE_RANGE, DUPLICATE_LEVEL_NUMBER, DUPLICATE_STABLE_CODE, INVALID_PREREQUISITE |
| validateCurriculumDraft | id | read-only | — (или CURRICULUM_VALIDATED c итогом) | — | возвращает структурированный список ошибок, не бросает |
| publishCurriculumVersion | id | одна tx (см. §7) | CURRICULUM_VERSION_PUBLISHED | ✔ draft-only + full validation | CURRICULUM_VALIDATION_FAILED{details}, CURRICULUM_ALREADY_PUBLISHED, CURRICULUM_CODE_ALREADY_PUBLISHED |
| archiveCurriculumVersion | id | tx: published→archived | CURRICULUM_VERSION_ARCHIVED | ✔ transition guard | INVALID_STATUS_TRANSITION |

Admin UI/routes в Phase 1 не реализуются; функции — `src/lib/curriculum/` (по конвенции lib-сервисов).

## 9. Migration plan (миграция НЕ создаётся в Phase 1A)

- **Имя:** `20260714000000_curriculum_versioning_foundation` (конвенция `<timestamp>_<snake>`).
- **Содержимое:** только `CREATE TABLE` ×3 + `CREATE INDEX`/`CREATE UNIQUE INDEX`; ни одного `ALTER` существующих таблиц.

```sql
-- CreateTable
CREATE TABLE "CurriculumVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "versionNumber" INTEGER NOT NULL,
    "effectiveFrom" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "createdById" INTEGER,
    "changeNotes" TEXT,
    CONSTRAINT "CurriculumVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "curriculumVersionId" INTEGER NOT NULL,
    "moduleNumber" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "firstLevel" INTEGER NOT NULL,
    "lastLevel" INTEGER NOT NULL,
    "checkpointLevel" INTEGER,
    "learningObjective" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "ModuleDefinition_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LevelDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "curriculumVersionId" INTEGER NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "stableCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL DEFAULT '',
    "learningObjective" TEXT NOT NULL DEFAULT '',
    "completionMethod" TEXT NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "requiredXp" INTEGER NOT NULL DEFAULT 0,
    "requiredPreviousLevel" INTEGER,
    "requiredCheckpointLevel" INTEGER,
    "featureUnlockCode" TEXT,
    "visibilityRule" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "LevelDefinition_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelDefinition_moduleId_curriculumVersionId_fkey" FOREIGN KEY ("moduleId", "curriculumVersionId") REFERENCES "ModuleDefinition" ("id", "curriculumVersionId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Indexes
CREATE UNIQUE INDEX "CurriculumVersion_code_versionNumber_key" ON "CurriculumVersion"("code", "versionNumber");
CREATE INDEX "CurriculumVersion_status_idx" ON "CurriculumVersion"("status");
CREATE INDEX "CurriculumVersion_createdById_idx" ON "CurriculumVersion"("createdById");
CREATE UNIQUE INDEX "ModuleDefinition_id_curriculumVersionId_key" ON "ModuleDefinition"("id", "curriculumVersionId");
CREATE UNIQUE INDEX "ModuleDefinition_curriculumVersionId_moduleNumber_key" ON "ModuleDefinition"("curriculumVersionId", "moduleNumber");
CREATE UNIQUE INDEX "ModuleDefinition_curriculumVersionId_code_key" ON "ModuleDefinition"("curriculumVersionId", "code");
CREATE INDEX "ModuleDefinition_curriculumVersionId_firstLevel_idx" ON "ModuleDefinition"("curriculumVersionId", "firstLevel");
CREATE UNIQUE INDEX "LevelDefinition_curriculumVersionId_levelNumber_key" ON "LevelDefinition"("curriculumVersionId", "levelNumber");
CREATE UNIQUE INDEX "LevelDefinition_curriculumVersionId_stableCode_key" ON "LevelDefinition"("curriculumVersionId", "stableCode");
CREATE INDEX "LevelDefinition_moduleId_idx" ON "LevelDefinition"("moduleId");
CREATE INDEX "LevelDefinition_curriculumVersionId_type_idx" ON "LevelDefinition"("curriculumVersionId", "type");

-- Manual partial unique index: at most one published CurriculumVersion per curriculum code.
-- Prisma schema language cannot express partial indexes, so this constraint lives only in
-- migration SQL and complements the future service-level publish guard. Draft and archived
-- versions of the same code are intentionally not restricted.
CREATE UNIQUE INDEX "CurriculumVersion_code_published_key" ON "CurriculumVersion"("code") WHERE "status" = 'published';
```

- **onDelete/onUpdate (утверждено, Phase 1B.1):** version→module/level и module→level — RESTRICT (удаление definitions выполняет только будущий draft-service явной bottom-up транзакцией; неявный каскад исключён); createdById SET NULL; всё ON UPDATE CASCADE.
- **V1 tables:** ни одна не изменяется (в migration.sql нет ALTER; FK на User живёт в новой таблице).
- **Forward plan:** одна аддитивная миграция; применяется существующим runner'ом `prisma/migrate.ts` (SQL не содержит `;` внутри литералов — совместим со сплиттером); затем `prisma generate`.
- **Rollback/compatibility plan:** откат = `DROP TABLE "LevelDefinition"; DROP TABLE "ModuleDefinition"; DROP TABLE "CurriculumVersion";` (обратный порядок FK) + удаление записи из `_prisma_migrations`; поскольку V1 не менялась, приложение после отката идентично текущему. До отката достаточно `npm run db:backup` (существующий скрипт).
- **SQLite limitations:** нет CHECK от Prisma; enum = TEXT без ограничения БД; ALTER TABLE не умеет ADD CONSTRAINT (поэтому FK закладываются сразу, а future-колонки Phase 4 добавятся через `ADD COLUMN ... REFERENCES`); partial unique index не выражается в Prisma schema, но поддерживается SQLite — «один published на code» реализован вручную в migration SQL (+ дублирующая service-проверка в publish); одна запись на файл БД (write-lock) — не проблема для admin-операций.
- **Пустые V2-таблицы:** ни один V1-код не читает новые таблицы; пустые таблицы не влияют на приложение; Prisma-клиент получает новые типы, не используемые V1-кодом.
- **Почему V1 runtime продолжит работать:** запросы V1 идут к прежним таблицам с прежними колонками; сериализация ответов не меняется; migrations аддитивны; регрессия — существующие lint/build/withdrawal-regression остаются зелёными.
- **Порядок будущего применения:** только на отдельной test DB (например, `DATABASE_URL=file:./prisma/phase1-test.db` в изолированной среде Phase 1B), после явного разрешения; live/production DB не затрагиваются. Запрещённые команды: `prisma migrate dev/deploy`, `prisma db push/seed`, `prisma migrate reset` — на live в любом виде.

## 10. V1 compatibility proof

1. Миграция не содержит ALTER/DROP по V1-таблицам — единственный канал влияния на V1-данные отсутствует.
2. FK к User направлен из новой таблицы; таблица User в SQL не меняется; в Prisma-модели User добавляется только виртуальный список relations (не колонка).
3. V1-код (`tasks`, `levels`, `taskProgression`, checkpoint, Pocket) не импортирует новые модели и не изменяется в Phase 1B, кроме появления новых файлов `src/lib/curriculum/*`.
4. Seed V1 (`prisma/seed.ts`, `seedProgression.ts`) не трогается; V2-таблицы остаются пустыми до Phase 9 (pilot seed).
5. Существующие проверки (lint, tsc, build, `npm run test:regression:withdrawal`) обязаны оставаться зелёными в Phase 1B — это критерий приёмки.

## 11. Продуктовые решения: закрытые и открытые

Закрыто в Phase 1B.1:

1. ~~Формат stableCode~~ — **утверждено**: `v2.l001.<slug>`, lowercase, три цифры номера, kebab-case slug; уникальность per-version; повторное использование кода в новой версии разрешено (§4.1, V2_PRODUCT_DECISIONS.md §8).
2. ~~Правило «не более одного published на code»~~ — **утверждено и реализовано**: partial unique index в миграции + будущая service-проверка publish. Семантика code как линии curriculum этим зафиксирована.
3. ~~Статусы Module/Level~~ — **утверждено**: active|disabled, lifecycle наследуется от версии (§4.2).
4. ~~contentVersionId/assessmentVersionId~~ — **утверждено**: отложены до Phase 4 (§4.3, вариант B); featureUnlockCode — nullable String без FK до Phase 6.
5. ~~createdBy~~ — **утверждено**: nullable, SetNull, system-created = null (§4.4).
6. ~~visibilityRule~~ — **утверждено**: Json?, в Phase 1 только null, без rule engine (§4.5).
7. ~~Delete behavior~~ — **утверждено**: Restrict вместо Cascade; удаление только явным draft-service снизу вверх (§9).

Остаются открытыми:

8. **Словарь visibilityRule** (`kind`-значения) — до соответствующего этапа.
9. **Набор completionMethod для V2** (String + Zod-whitelist; кандидаты от V1: manual, report_approval, pocket_postback, balance_check + новые для scenario/final_exam).
10. **effectiveFrom**: информационное поле или триггер автопубликации/auto-enrollment (рекомендация: информационное, nullable).
11. **archived**: допустим ли archive из draft и возможен ли un-archive (рекомендация: нет и нет).

## 12. Phase 1B — один небольшой кодовый этап

Единый этап «Curriculum versioning foundation» (без API/UI):

1. Добавить 3 модели + 3 enum в `schema.prisma` (+ виртуальный relation-список в User) — строго по §2 (с учётом закрытых к тому моменту решений §11.1–11.2).
2. Создать миграцию `curriculum_versioning_foundation` (§9) — применить **только** к изолированной test DB.
3. `src/lib/curriculum/schemas.ts` — Zod-схемы (§5, §8).
4. `src/lib/curriculum/service.ts` — операции §8 (create/update/delete draft, module/level ops, validateCurriculumDraft, publish, archive) с audit и immutable-guards.
5. `scripts/regression/curriculumContractRegression.ts` + npm script `test:regression:curriculum` — по образцу withdrawal-регрессии.
6. Прогон: lint, tsc, build, оба regression-скрипта; один commit.

## 13. Тест-план Phase 1B

Регрессия использует эфемерную SQLite test DB внутри workspace (создаётся скриптом, удаляется после; live не затрагивается — потребует явного разрешения на создание временного файла БД в постановке Phase 1B):

1. create draft → versionNumber автоинкремент внутри code; дубль (code, versionNumber) отклоняется (P2002 → domain error).
2. update/delete published → CURRICULUM_PUBLISHED_IMMUTABLE; delete draft → каскад удаляет definitions.
3. Module: пересечение диапазонов → MODULE_RANGE_OVERLAP; checkpointLevel вне диапазона → ошибка Zod/refine.
4. Level: levelNumber вне диапазона модуля → LEVEL_OUT_OF_MODULE_RANGE; дубли levelNumber/stableCode в версии → domain errors; requiredPreviousLevel >= levelNumber → ошибка.
5. validateCurriculumDraft: дыра в нумерации, forward-ссылка requiredCheckpointLevel, disabled-уровень в цепочке — структурированные ошибки.
6. publish валидного draft → published, publishedAt установлен, повторный publish → CURRICULUM_ALREADY_PUBLISHED; publish второй версии того же code при живой published → CURRICULUM_CODE_ALREADY_PUBLISHED.
7. archive published → archived; archive draft → INVALID_STATUS_TRANSITION.
8. Audit: каждая мутация оставила запись с ожидаемым action.
9. V1-совместимость: `npm run test:regression:withdrawal`, lint, tsc, build — зелёные; V1-таблицы в test DB не изменены (сравнение схемы до/после — `PRAGMA table_info`).

---

*Документ не содержит secrets, паролей, реальных пользовательских данных. Schema, migrations и код в Phase 1A не изменялись.*
