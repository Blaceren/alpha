# MUTATION_OVERLAY.md — Alfa Trade Academy CRM

> Phase 1B4-A · Mutation core + `addNote` на уровне domain/provider/storage.
> Решения: D-53…D-57. Связано: DATA_PROVIDER_CONTRACT §15, DECISIONS D-09, ROLE_PERMISSION_MATRIX §1/§4.2.
>
> **Phase 1B4-B (выполнен): UI появился.** Секция «Заметки» на User 360 читает `getUserNotes` и пишет
> через `addNote`; форма доступна четырём ролям с `edit_user_notes`. Решения D-58…D-63,
> подробности — `docs/USER_360.md`, ревью — `docs/visual-reviews/PHASE_1B4_B_ADD_NOTE.md`.
>
> **Phase 1B4-C (выполнен): назначение primary owner.** Вторая мутация — `assignPrimaryOwner` — и её
> UI в секции «Ответственный и работа» на User 360. Overlay расширен **аддитивно в пределах v1**: тот же
> ключ, та же `version: 1`, история владельца — записи `primary_owner_changed` в существующем
> `auditRecords` (отдельного `ownerAssignments[]` нет). Решения D-64…D-74; §§ ниже помечены
> «(1B4-C)».
>
> **Phase 1B4-D (выполнен): закрепление заметки.** Третья мутация — `setNotePinned` — и её UI в секции
> «Заметки» на User 360. Overlay снова расширен **аддитивно в пределах v1**: тот же ключ, та же
> `version: 1`, effective pinned выводится из записей `note_pin_changed` в существующем `auditRecords`
> (отдельного `notePins[]` нет), receipt-kind `note_pin_change`. Право переиспользовано
> `edit_user_notes` (D-75), матрица не расширена. Решения D-75…D-81; §§ ниже помечены «(1B4-D)».
>
> **Phase 1B4-E (выполнен): редактирование тела заметки.** Четвёртая мутация — `updateNoteBody` — и её
> inline-UI в секции «Заметки» на User 360. Overlay расширен **аддитивно в пределах v1**: тот же ключ,
> та же `version: 1`. В отличие от pin/owner тело РЕАЛЬНО переписывается на месте в существующем
> `notes[]` (тот же id/createdAt/author/visibility/baseline pinned; меняются только `body` и `updatedAt`) —
> тело нельзя честно вывести из append-only лога, и оно не должно попасть в audit. Добавлены запись
> `note_body_changed` (только базовые поля, без тела — D-84) и receipt-kind `note_body_change`.
> Конкуренция — `expectedUpdatedAt`; один timestamp у `note.updatedAt` и `audit.at` (D-83). Право
> переиспользовано `edit_user_notes`, но строже: только автор своей overlay-заметки (D-82). Возможность
> отдаётся провайдером через `getUserNotesView` → `CrmNoteListItem.capabilities.canEditBody`. Фикстурная
> заметка неизменна. Решения D-82…D-85; §§ ниже помечены «(1B4-E)».
>
> **Phase 1B5-C (выполнен): смена видимости заметки.** Пятая мутация — `setNoteVisibility` (team ↔ private)
> — и её inline-UI. Overlay расширен **аддитивно в пределах v1**: тот же ключ, та же `version: 1`. Как у
> `updateNoteBody`, note переписывается на месте (меняются только `visibility` и `updatedAt`). Добавлены
> пятый union-член `note_visibility_changed` (`previousVisibility`/`nextVisibility` ∈ {team,private}) и
> receipt-kind `note_visibility_change`. `role_restricted` НЕ writable (нет allowed-roles модели, D-91):
> команда его отвергает `invalid_input`, guard fail-closed. Право — `edit_user_notes`, только автор своей
> overlay-заметки (D-91); private по identity актора, не по роли (D-92). `AuditRecordView` направление
> team/private НЕ раскрывает (D-94). Решения D-91…D-95; §§ ниже помечены «(1B5-C)».
>
> **Phase 1B6 (выполнен): удаление заметки.** Шестая мутация — `deleteNote` — и её inline-confirm. Это
> **hard delete**: authored-заметка физически убирается из overlay `notes[]` (единственная мутация,
> УДАЛЯЮЩАЯ row; тело не остаётся, undo нет). Overlay расширен **аддитивно в пределах v1**: тот же ключ,
> та же `version: 1`. Добавлены шестой union-член `note_deleted` (базовые поля) и receipt-kind `note_delete`
> (kind/key/fingerprint/auditId). Append-only `note_deleted` — **защитный источник истины** отсутствия:
> canonical `hideDeletedNotes` скрывает заметку с валидным поздним delete-record даже в corrupt/legacy
> overlay с уцелевшим row (D-97); guard fail-closed на битой записи. Право — `edit_user_notes`, только автор
> своей overlay-заметки (D-96). **Отличие порядка:** idempotency-replay разрешается ДО entity-lookup (иначе
> retry после удаления вернул бы `not_found`); `expectedUpdatedAt` в fingerprint не входит; повтор исходного
> `addNote` ключа после удаления НЕ воскрешает заметку (D-98). `AuditRecordView` для `note_deleted` несёт
> только факт (D-99). Решения D-96…D-101; §§ ниже помечены «(1B6)».
> Остальные мутации (tasks/cases/signals/recommendations, reveal PII) по-прежнему не реализованы.

---

## 0. Что это и зачем

Синтетические фикстуры (30 персон) **неизменяемы** — они источник детерминизма для всего derivation-слоя.
Всё, что создаёт мутация, живёт отдельно: в **versioned localStorage overlay** (D-09).

Backend, API, база данных, Prisma и Pocket **отсутствуют**. Мутация не уходит никуда за пределы вкладки.

---

## 1. Storage key и схема

Ключ: **`ata-crm.mutation-overlay.v1`**

Отдельный от всех существующих ключей и не смешивается с ними:

| Ключ | Что хранит | Кто владеет |
|---|---|---|
| `ata-crm.mutation-overlay.v1` | **авторские данные** (заметки, audit, sequence, receipts) | Phase 1B4-A |
| `ata-crm.mock-state.v1` | dev-переключатель состояния данных (`stale`/`empty`/`error`) | D-51 |
| `ata-crm.mock-role.v1` | dev role switch | Phase 1A |

Причина разделения: первые два выбирают, **какой синтетический источник читать**, а overlay содержит
**созданное человеком**. Сброс демо-состояния не должен стирать заметки, и наоборот.

```ts
interface MutationOverlay {
  version: number;                        // принимается только 1
  sequence: number;                       // монотонный счётчик за всеми id
  notes: CrmNote[];
  auditRecords: AuditRecord[];
  idempotencyReceipts: IdempotencyReceipt[];
}

// (1B4-C) Receipt — discriminated union. Legacy note-receipt без `kind`
// (отсутствие дискриминанта = note); owner-receipt с явным `kind` и без `noteId`.
type IdempotencyReceipt = NoteIdempotencyReceipt | PrimaryOwnerIdempotencyReceipt;

interface NoteIdempotencyReceipt {
  kind?: undefined;
  key: string;
  fingerprint: string;                    // не тело заметки
  noteId: string;
  auditId: string;
}

interface PrimaryOwnerIdempotencyReceipt {
  kind: "primary_owner_change";
  key: string;
  fingerprint: string;
  auditId: string;                        // owner-change восстановим из audit
}
```

**(1B4-C) Схема `MutationOverlay` не менялась.** Owner-мутация не добавила ни одного нового поля
верхнего уровня: история владельца — записи `primary_owner_changed` в `auditRecords`. Поэтому overlay,
записанному Phase 1B4-B, **нечего терять** — у него нет отсутствующих полей, которые пришлось бы
«толерантно» дочитывать (D-64, D-65).

Что в overlay **не хранится**: секреты, финансовые значения, PII — кроме текста заметки,
который сотрудник явно ввёл сам.

---

## 2. Fail-closed parse

`parseOverlay(raw)` возвращает **пустой overlay** при любом из:

| Вход | Результат |
|---|---|
| ключа нет / пустая строка | пустой overlay |
| повреждённый JSON | пустой overlay |
| не объект (строка, массив, `null`) | пустой overlay |
| `version !== 1` (в т.ч. `2`, `0`, `"1"`) | пустой overlay |
| `sequence` не целое ≥ 0 | пустой overlay |
| неверная shape любого поля | пустой overlay |
| **одна** запись из массива сломана | пустой overlay **целиком** |
| запись потеряла `mock: true` | пустой overlay |
| `visibility` вне enum | пустой overlay |
| **(1B4-C)** неизвестный `action`/`entityType`/`reasonCode` | пустой overlay |
| **(1B4-C)** неизвестный `receipt.kind` | пустой overlay |
| **(1B4-C)** owner-запись без `previousOwnerId`/`nextOwnerId` (строка\|null) | пустой overlay |
| **(1B4-D)** pin-запись без `previousPinned`/`nextPinned` (boolean) | пустой overlay |
| **(1B4-D)** pin-запись с неверным `entityType`/`reasonCode` | пустой overlay |

**(1B4-C/1B4-D) Обратная совместимость — что расширено, а что осталось fail-closed.** Guard'ы приняли
**по одному новому допустимому значению** в каждом измерении на фазу — 1B4-C: action
`primary_owner_changed`, entityType `user`, reasonCode `primary_owner_changed_by_employee`, receipt
`kind: "primary_owner_change"`; 1B4-D: action `note_pin_changed`, reasonCode
`note_pin_changed_by_employee`, receipt `kind: "note_pin_change"` — и **ничего больше**. `action`/`entityType`/`reasonCode` сверяются с литералами, а не `isString`, поэтому неизвестный
action или выдуманный reason по-прежнему роняют overlay целиком. Note-receipt распознаётся по
**отсутствию** `kind` — ровно та форма, что уже лежит в браузерах; неизвестный `kind` — не толерируемый
unknown, а признак «overlay записан не нами» → fail-closed. Отсутствие поля, которого в v1 никогда не
было, — не повреждение (D-64).

Overlay отвергается **целиком**, а не фильтруется до читаемых строк: молча выкинув одну сломанную
заметку, мы оставили бы `sequence`, который больше не соответствует записям, и id начали бы
переиспользоваться поверх данных, всё ещё лежащих в storage.

Направление деградации выбрано осознанно: потерять локальные демо-заметки — неприятность;
загрузиться на полуразобранных данных и выдать их за настоящие записи — ложь.

Чтение, которое само бросает исключение (storage отключён в privacy-режиме), тоже даёт пустой overlay.

---

## 3. Storage ownership

```
KeyValueStorage (интерфейс)
├── defaultOverlayStorage()   → localStorage в браузере, memory на сервере
└── MemoryKeyValueStorage     → тесты + SSR-fallback
```

- **SSR не обращается к localStorage.** `typeof window === "undefined"` → memory.
  Провайдер, собранный на сервере, — другой экземпляр, чем клиентский, поэтому fallback никто не наблюдает.
- Доступ обёрнут в `try/catch`: `window.localStorage` бросает при отключённом хранилище.
- **Один adapter на провайдер**, создаётся в конструкторе, а не на каждый вызов метода.
  `getCrmDataProvider` кэширует провайдер по demo-state → одна browser session = один adapter.
- Тесты передают `storage` через `MockProviderOptions` — **ни один unit-тест не трогает настоящий localStorage**.
  Тот же путь даёт «controlled initial overlay»: seed-строка в `MemoryKeyValueStorage`.

`MutationOverlayStore.write()` **атомарно заменяет весь сериализованный overlay** одной записью и
**бросает** при отказе storage — вызывающий решает, что это значит для его Result. Проглотить отказ
здесь означало бы отрапортовать о созданной заметке, которой не увидит ни одна перезагрузка.

`clear()` есть для будущей кнопки «Reset mock environment» (D-09). **UI сброса не делается и в 1B4-B.**

---

## 4. Детерминизм: clock, sequence, id

Ни `Math.random()`, ни случайных UUID, ни настоящего `Date.now()` в доменной логике (D-57).

| Что | Как |
|---|---|
| note id | `note_mock_0001` — из `sequence`, zero-padded |
| audit id | `audit_mock_0001` — из того же `sequence` |
| timestamp | `clock.nowMs() + sequence` мс → ISO |
| sequence | `overlay.sequence + 1`, персистится вместе с записями |

`idempotencyKey` **не используется как entity id** — он приходит снаружи и не обязан быть ни
уникальным в пространстве id, ни безопасным для показа.

Смещение на `sequence` миллисекунд нужно, потому что `FixedMockClock` возвращает один и тот же
инстант: без смещения две заметки получили бы одинаковый `createdAt` и порядок стал бы неустойчивым.
Сортировка дополнительно имеет tie-breaker по `id`.

Sequence переживает пересоздание адаптера: новый `MutationOverlayStore` над тем же storage читает
`sequence` и продолжает с него.

---

## 5. Idempotency

**Fingerprint** = детерминированный хеш нормализованной команды + личности актора:
`[userId, actorId, role, body]`, каждая часть с префиксом длины, два прохода FNV-1a → 16 hex.

Префикс длины обязателен: без него `("ab","c")` и `("a","bc")` сериализуются одинаково, и две разные
команды выглядели бы взаимным replay. Crypto-зависимость **не добавлена** (D-57): это защита от
случайного переиспользования ключа, а не от подбора коллизии.

| Вызов | Результат |
|---|---|
| новый key | создаёт 1 note + 1 AuditRecord + receipt; `replayed: false` |
| тот же key, тот же нормализованный payload | **ничего не создаёт**, возвращает исходный результат; `replayed: true` |
| тот же key, другой `body` | `conflict` |
| тот же key, другой `userId` | `conflict` |
| тот же key, другой actor (`actorId` или `role`) | `conflict` |

`  k1  ` и `k1` — один и тот же ключ (trim). `"  Текст  "` и `"Текст"` — одна и та же команда (нормализация до fingerprint).

Receipt хранит **fingerprint, а не команду**: тело уже лежит на самой заметке, и повторять его
открытым текстом второй раз — вторая копия пользовательского текста без читателя.

**(1B4-C) Fingerprint owner-мутации** = `stableFingerprint([userId, actorId, role, ownerId ?? UNASSIGNED_OWNER_TOKEN])`.
`expectedOwnerId` в него **не входит** (D-72, D-73): fingerprint отвечает «что попросили», а предусловие,
под которым команду отправили, — не часть просьбы; иначе replay уже применённой команды (у которой
`expectedOwnerId` устарел) стал бы `conflict`. Команды различаются **видом receipt**, а не префиксом
имени во fingerprint: у note-мутации fingerprint не префиксован именем, и добавить префикс сейчас —
ломающее изменение (каждый receipt в браузере считался без него). Ключ, потраченный на note, для
owner-команды даёт `conflict`, и наоборот.

---

## 6. AuditRecord

```ts
interface AuditRecord {
  readonly id: string;                    // audit_mock_0001
  readonly action: "note_added";
  readonly actorEmployeeId: EmployeeId;   // из ctx, не из команды
  readonly actorRole: CrmRole;            // из ctx
  readonly targetUserId: UserId;
  readonly entityType: "note";
  readonly entityId: string;              // id заметки
  readonly at: ISODateString;
  readonly reasonCode: "note_added_by_employee";
  readonly mock: true;                    // ROLE_PERMISSION_MATRIX §4.2.6
}
```

**(1B4-C) `AuditRecord` — discriminated union по `action`:**

```ts
type AuditRecord = NoteAddedAuditRecord | PrimaryOwnerChangedAuditRecord;

interface PrimaryOwnerChangedAuditRecord {
  readonly id: string;                    // audit_mock_0001
  readonly action: "primary_owner_changed";
  readonly actorEmployeeId: EmployeeId;   // из ctx
  readonly actorRole: CrmRole;            // из ctx
  readonly targetUserId: UserId;
  readonly entityType: "user";
  readonly entityId: UserId;              // == targetUserId
  readonly at: ISODateString;
  readonly reasonCode: "primary_owner_changed_by_employee";
  readonly previousOwnerId: EmployeeId | null;
  readonly nextOwnerId: EmployeeId | null;
  readonly mock: true;
}
```

**(1B4-D) третий член union — `NotePinChangedAuditRecord`:**

```ts
type AuditRecord =
  | NoteAddedAuditRecord
  | PrimaryOwnerChangedAuditRecord
  | NotePinChangedAuditRecord;

interface NotePinChangedAuditRecord {
  readonly id: string;                    // audit_mock_0001
  readonly action: "note_pin_changed";
  readonly actorEmployeeId: EmployeeId;   // из ctx
  readonly actorRole: CrmRole;            // из ctx
  readonly targetUserId: UserId;
  readonly entityType: "note";
  readonly entityId: string;              // id заметки (fixture или note_mock_*)
  readonly at: ISODateString;
  readonly reasonCode: "note_pin_changed_by_employee";
  readonly previousPinned: boolean;
  readonly nextPinned: boolean;
  readonly mock: true;
}
```

Union, а не плоская запись с `previousOwnerId?`/`nextOwnerId?`/`previousPinned?`: плоская позволила бы
note-add-записи нести owner- или pin-поля, а owner/pin-записи — их опустить, и ничто бы это не поймало
(D-66). Owner id и pin-boolean здесь — **сам факт** изменения (LOW/CRM-owned), а не содержимое; `null`
владельца с любой стороны — реальное «снят». Эта запись — **единственный источник** effective pinned:
отдельной `pinned`-колонки, переписываемой на заметке, нет — append-only лог и есть состояние (D-77).

**Audit фиксирует факт действия, а не содержимое.** В нём нет и не может быть: тела заметки, email,
телефона, имени пользователя, финансовых значений, произвольного текста, idempotency-ключа, UI-лейбла,
диагностики storage. `reasonCode` — закрытый enum, а не свободная строка: свободный текст — ровно тот
путь, которым тело заметки просочилось бы в журнал.

**(1B5-B) четвёртый член union — `NoteBodyChangedAuditRecord`** (базовые поля + `action: "note_body_changed"`,
`reasonCode: "note_body_changed_by_employee"`; никакого previous/next, фрагмента, длины или тела — D-84).

**(1B5-C) пятый член union — `NoteVisibilityChangedAuditRecord`** (базовые поля + `action:
"note_visibility_changed"`, `entityType: "note"`, `reasonCode: "note_visibility_changed_by_employee"`,
`previousVisibility`/`nextVisibility` ∈ {team,private}). Оба значения — сам факт (LOW/закрытый enum), не
контент; `role_restricted` на любой стороне не принимается (D-91), guard fail-closed. Новый receipt kind
`note_visibility_change` (только kind/key/fingerprint/auditId). `AuditRecordView` направление НЕ несёт (D-94).

**(1B6) шестой член union — `NoteDeletedAuditRecord`** (базовые поля + `action: "note_deleted"`,
`entityType: "note"`, `entityId` = id удалённой заметки, `reasonCode: "note_deleted_by_employee"`; никакого
тела/фрагмента/visibility/pin — как body-запись, D-96/D-99). Guard принимает точный action/entityType/
reasonCode, fail-closed на неизвестных значениях. Новый receipt kind `note_delete` (только kind/key/
fingerprint/auditId). Он **защитный источник истины** отсутствия: canonical `hideDeletedNotes`
(`domain/notes/note-projection`) выполняется ПЕРВОЙ в `orderedVisibleNotes` и убирает заметку с валидным
поздним delete-record (latest by `at` DESC → `id` DESC; скрывает только если delete `at` ≥ note `updatedAt`)
даже в corrupt/legacy overlay с уцелевшим row (D-97). `deleteNote` физически удаляет row из `notes[]`, но
прежние записи заметки (note_added/edit/pin/visibility) сохраняются — лог append-only. Порядок отличается
одним местом: replay(receipt) — ДО user/entity lookup (D-98), иначе retry после удаления вернул бы
`not_found`; fingerprint `[userId, actorId, role, noteId]`, без `expectedUpdatedAt`. Отдельная lifecycle-ветка:
повтор исходного `addNote` ключа после удаления реконструирует original result из audit + payload (тело — то
же по fingerprint-совпадению), НЕ записывая row обратно и не добавляя тело в receipt/audit (D-98).

**(1B5-B) read endpoint появился, write-семантика неизменна.** Global Audit Workspace (`/audit`) читает
существующий `auditRecords` через новую read-операцию `getAuditRecords` (DATA_PROVIDER_CONTRACT §3c) — это
**только reader**: storage key, `version`, структура overlay, guards audit-actions, receipts, sequence и
owner/pin effective resolvers не тронуты, лог остаётся append-only. UI получает не сырой `AuditRecord`, а
provider-owned safe `AuditRecordView` (`domain/audit/audit-view`, D-87): canonical `sortAuditRecords`
(`at` DESC → `id` DESC, на копии) + projector, резолвящий actor/owner через `ownerLabel` и target через
dataset. Данные — только crm_admin/crm_manager (`canViewAudit`, D-86). Corrupt overlay → тот же fail-closed
empty (§2), storage failure → локализованный error с retry; raw diagnostics в DOM не попадают (D-88). UI
заметок (1B4-B) по-прежнему audit не показывает: в success-подтверждении нет ни `auditId`, ни `noteId`, ни
actor'а — сотруднику сообщается факт «Заметка добавлена», а не наша бухгалтерия.

---

## 7. Мутации: что есть и чего нет

Реализованы **ровно три**:

```ts
interface CrmMutations {
  addNote(ctx: CrmContext, command: AddNoteCommand): Promise<Result<AddNoteResult>>;
  // (1B4-C)
  assignPrimaryOwner(ctx: CrmContext, command: AssignPrimaryOwnerCommand): Promise<Result<AssignPrimaryOwnerResult>>;
  // (1B4-D)
  setNotePinned(ctx: CrmContext, command: SetNotePinnedCommand): Promise<Result<SetNotePinnedResult>>;
}
```

**(1B4-D) `setNotePinned`.** Закрепить/открепить заметку по `noteId` под `userId`. Команда задаёт
конечное состояние `pinned` + `expectedPinned` (оптимистичная конкуренция, как `expectedOwnerId`):

```ts
interface SetNotePinnedCommand {
  userId: UserId;
  noteId: string;
  pinned: boolean;          // желаемое конечное состояние, не blind toggle
  expectedPinned: boolean;  // текущее effective pinned, как его видел вызывающий
  idempotencyKey: string;
}
interface SetNotePinnedResult { note: CrmNote; audit: AuditRecord; replayed: boolean; }
```

Право — `canEditUserNotes(ctx.role)` (D-75), матрица не расширена. Порядок:
`invalid_input` (пустой/длинный key, пустой `noteId`, `pinned === expectedPinned`) → `not_found`
(нет user, нет заметки, заметка не видна роли через canonical projector — D-76) → `unauthorized` →
idempotency (replay/`conflict`) → `expectedPinned` (`conflict` при рассинхроне) → append audit + receipt
→ atomic write (`internal` при сбое storage). Fingerprint: `userId`/`noteId`/`actorId`/`role`/желаемое
состояние (без `expectedPinned`). Receipt-kind `note_pin_change` (отдельный дискриминант, без `noteId`;
receipt `addNote`/owner под pin переиспользовать нельзя). **Effective pinned** = базовый `note.pinned`
(всегда `false`), перекрытый последней записью `note_pin_changed` для `note.id` (по `at`, затем по
audit id) — единый резолвер `resolveEffectivePins`, применяется ДО `sortNotes`. Ни fixture, ни
overlay-заметка при закреплении не мутируются.

Пустых методов на будущее **не добавлено**. §15 контракта резервировал полный список
(`createTask`, `updateTask`, `createCase`, `updateCase`, `resolveSignal`,
`acceptRecommendedAction`, `revealUserPii`), но член интерфейса без реализации — это обещание,
которого провайдер не держит, а `as never` для удовлетворения placeholder-формы — ровно то,
что D-50 пришлось удалять из контракта Today.

**Не реализованы:** createTask, updateTask, createCase, updateCase, task/case assignees,
signal resolution, recommendation acceptance, reveal PII.

### (1B4-C) `assignPrimaryOwner`

```ts
interface AssignPrimaryOwnerCommand {
  userId: UserId;
  ownerId: EmployeeId | null;             // null = снять; first-class значение
  expectedOwnerId: EmployeeId | null;     // оптимистичная конкуренция (D-72)
  idempotencyKey: string;
}
interface AssignPrimaryOwnerResult {
  userId: UserId;
  ownerId: EmployeeId | null;
  audit: AuditRecord;
  replayed: boolean;
}
```

Actor — только из `CrmContext`. Порядок (совместим с `addNote`, D-69):

1. Валидация ключа (`invalid_input`).
2. `ownerId`: `null` разрешён; иначе обязан быть среди `primaryOwnerCandidate` (`invalid_input`).
3. Существование пользователя (`not_found`).
4. Permission `canAssignOwner(ctx.role)` (`unauthorized`) — `crm_admin`/`crm_manager`/`retention_manager`.
5. Idempotency: тот же key + тот же fingerprint → replay; иначе `conflict`.
6. **`expectedOwnerId`** сверяется с текущим **effective** owner; расхождение → `conflict`, ничего не пишется.
7. Запись overlay (`internal` при отказе). Инвалидация derived-cache target-пользователя.

**Порядок 5→6 load-bearing:** replay проверяется **до** предусловия, иначе безопасный retry уже
успешной команды (у которой `expectedOwnerId` теперь устарел) вернул бы `conflict` (D-72).

**Effective owner** = baseline fixture owner, перекрытый последней записью `primary_owner_changed`
(D-65, D-70). Единственный resolver в провайдере (`effectiveUsers`/`effectiveUser`); fixtures
неизменяемы (мелкий клон). Все reads — User 360 / Users / Today / task-case / queue — берут owner
отсюда, поэтому расходиться неоткуда.

### Команда и результат

```ts
interface AddNoteCommand {
  userId: UserId;
  body: string;
  idempotencyKey: string;
}

interface AddNoteResult {
  note: CrmNote;
  audit: AuditRecord;
  replayed: boolean;
}
```

Actor **не входит в команду**: роль и employee id берутся только из доверенного `CrmContext`,
чтобы вызывающий не мог назначить себя тем, кем хотел бы быть. `visibility` тоже не входит (D-54).

Raw storage state не возвращается — только эти три поля.

### Порядок в `addNote`

1. Валидация команды (`invalid_input`)
2. Существование пользователя (`not_found`)
3. Permission по `ctx` (`unauthorized`)
4. Idempotency (`conflict` / replay)
5. Создание note
6. Создание AuditRecord
7. Запись overlay (`internal` при отказе storage)
8. Возврат `Result`

Ничего не персистится, пока не собран весь overlay: отклонённый вызов — по любой причине, включая
отказ storage — оставляет overlay ровно таким, каким он был, и не пишет audit.

### Валидация

| Поле | Правило | Ошибка |
|---|---|---|
| `body` | trim перед сохранением | — |
| `body` | пустое / только пробелы | `invalid_input` |
| `body` | > **2000** символов (после trim) | `invalid_input` |
| `body` | хранится как **plain text**, не парсится и не рендерится как HTML | — |
| `idempotencyKey` | обязателен, trim, непустой | `invalid_input` |
| `idempotencyKey` | > **200** символов | `invalid_input` |

### Коды ошибок

Используется существующая система `Result<T>` / `CrmError` — параллельной нет.
Отказ по правам — **`unauthorized`**, а не `forbidden`: в `CrmErrorCode` кода `forbidden` не
существует, и заводить второй код с тем же смыслом — та самая рассинхронизация «одно понятие, две
формы», которую уже пришлось закрывать в D-40 и D-52 (см. **D-56**).

---

## 8. Permissions

Мутационное право централизовано в общем permission-слое, а не в провайдере и не в React:

- `Permission` += **`edit_user_notes`**
- `access.ts` → **`canEditUserNotes(role)`**

Право **не выводится** из видимости финансов и **не переиспользует** `assign_owner` — это другие
измерения матрицы. Подробности и разбор §1 — **D-53** и ROLE_PERMISSION_MATRIX §5.1.

| Роль | Edit (§1 матрицы) | addNote |
|---|---|---|
| crm_admin | Full | ✅ |
| crm_manager | Full (team) | ✅ |
| retention_manager | Full (own+team retention) | ✅ |
| support | Limited (support cases/tasks/**notes**) | ✅ |
| mentor | Limited (mentor tasks/cases, reports) | ❌ |
| moderator | Limited (moderation cases) | ❌ |
| content_manager | Limited (content-related) | ❌ |
| analyst | None | ❌ |
| read_only | None | ❌ |

Отказ ничего не меняет: ни заметки, ни audit, ни receipt, ни `sequence`. Тело заметки не попадает
в текст ошибки.

### (1B4-E) `updateNoteBody` — редактирование тела

**Команда/результат.** `UpdateNoteBodyCommand { userId, noteId, body, expectedUpdatedAt, idempotencyKey }`
→ `UpdateNoteBodyResult { noteId, updatedAt, audit, replayed }`. Result **без** `CrmNote` и **без** тела:
после повторной правки старое тело не реконструируемо, а хранить его в receipt/audit запрещено — поэтому
возвращаем только всегда-честное (id + timestamp правки = `note.updatedAt` = `audit.at`). См. **D-83/D-84**.

**Порядок проверок** (тестируется): ключ → нормализация тела (`normalizeNoteBody`) → ISO-форма
`expectedUpdatedAt` → user или `not_found` → видимость через канонический projector → невидимая/несуществующая
→ `not_found` → `canEditUserNotes` или `unauthorized` → видимая non-overlay (фикстурная) → `invalid_input`
(не `not_found`: визуально присутствует) → чужой автор (`authorEmployeeId !== actorId`) → `unauthorized` →
replay по receipt → «нормализованное тело == хранимого» → `invalid_input` (без audit) → `expectedUpdatedAt !=
stored.updatedAt` → `conflict` → один атомарный write. **Replay проверяется ДО** `expectedUpdatedAt`, иначе
безопасный retry после сдвига `updatedAt` конфликтовал бы (**D-83**).

**Запись в overlay.** Единственная мутация, которая переписывает `notes[]` на месте: тот же id/createdAt/
authorEmployeeId/visibility/baseline `pinned`, меняются только `body` и `updatedAt` (= mutation-timestamp).
Плюс запись `note_body_changed` в `auditRecords` и receipt в `idempotencyReceipts` — одним write.

**Fingerprint/receipt.** `fingerprintUpdateNoteBody([userId, actorId, role, noteId, normalizedBody])` через
`stableFingerprint` (FNV-1a, crypto нет — D-57). Receipt `{ kind: "note_body_change", key, fingerprint,
auditId }` — без тела/фрагмента/длины/noteId. Один ключ + одинаковая команда → `replayed:true` (метаданные из
audit A даже после более поздней правки под ключом B); один ключ + другое тело/user/note/actor/role или чужой
receipt-kind → `conflict`. Storage-fail НЕ расходует ключ (ничего не записано → retry тем же ключом — новая
запись, не replay). См. **D-84**.

**Возможность — provider-owned.** `getUserNotesView(ctx, input) → Paginated<CrmNoteListItem>`, где
`CrmNoteListItem { note, capabilities: { canEditBody } }`. `canEditBody = canEditUserNotes(role) &&
(note ∈ overlay.notes[]) && visible && authorEmployeeId === actorId`. React читает флаг, не разбирает id
(**D-82**). Плоский `getUserNotes` не изменён.

---

## 9. Notes domain и приватность чтения

Канонический модуль — `src/domain/notes/`. `CrmNote` живёт в домене и **ре-экспортируется**
контрактом (как `TodayWorkspace` и `User360`), поэтому второго несовместимого типа не появилось.

```ts
interface CrmNote {
  id: string;
  userId: UserId | null;
  caseId: string | null;
  authorEmployeeId: EmployeeId;   // employee-автор; берётся из ctx
  body: string;
  visibility: "team" | "role_restricted" | "private";
  pinned: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  mock: true;
}
```

**Новая заметка всегда `team`** (D-54). Передать `private` или `role_restricted` нельзя — их нет в
команде. Причина: для этих режимов нет полного metadata-контракта (кто владелец приватной записи,
каким ролям адресована ограниченная). Значения enum **не удалены** — существующие заметки читаются.

### Единый канонический projector

`domain/notes/note-projection.ts` — **единственное** место, где решается «кому видна заметка»:

| visibility | Правило |
|---|---|
| `team` | видна всем 9 ролям — User 360 доступен всем (матрица §2) |
| `private` | **только автору** (`authorEmployeeId === ctx.actorId`); при пустом авторе — никому |
| `role_restricted` | **скрыта всегда**, включая автора — в модели нет metadata о разрешённых ролях |
| неизвестное значение | скрыта (fail-closed по построению) |

Обоснование `private` и `role_restricted` — **D-55**.

- Скрытая заметка **удаляется, а не заменяется плейсхолдером**: строка «скрыто» раскрыла бы факт
  существования записи.
- Проекция идёт **до пагинации** → скрытые не входят и в `page.total`.
- Тело скрытой заметки не протекает через сериализованный `Result`.

`getUserNotes` больше **не игнорирует `ctx`**: объединяет fixture-generated и overlay-заметки,
проецирует через тот же projector, затем сортирует (`pinned` → `createdAt desc` → `id`) и пагинирует.

**Единственный путь чтения — `getUserNotes`.** С Phase 1B4-B у него появился потребитель: секция
«Заметки» на User 360 (D-58). Она читает **через него**, а не через `getUser360`, и не выводит
видимость заново — правило осталось в одном месте, поэтому расхождению по-прежнему неоткуда взяться
(ровно та ошибка, которую D-39 и D-40 уже исправляли). React не фильтрует и не сортирует заметки.

---

## 10. Что доказано тестами

130 новых тестов (569 всего; все 439 прежних сохранены), E2E — 41 без изменений.

- **Regression доказан.** Подмена projector на «всё видно» роняет **15** тестов, включая явный
  «getUserNotes — context actually matters». Подмена permission-правила на «всем можно» роняет **20**.
- Все **9 ролей** покрыты явно; список ролей сверяется с `CRM_ROLES`, чтобы роль нельзя было забыть.
- Fixtures не мутируются: датасет побайтово равен себе до и после `addNote`.
- Overlay переживает пересоздание адаптера; sequence продолжается.
- Отказ записи → `internal`, прежний overlay цел.


---

## 11. UI (Phase 1B4-B)

Единственный потребитель — секция «Заметки» на User 360 (`src/features/user-360/`):
`components/user-notes.tsx` (секция + список), `components/note-composer.tsx` (inline-композер),
`hooks/use-user-notes.ts` (read), `hooks/use-add-note.ts` (мутация + ключ), `lib/note-error.ts`
(безопасные тексты ошибок).

- **Один инстанс провайдера.** `application/provider.ts` получил общий `resolveProvider(state)` и два
  аксессора: `getCrmDataProvider()` (read) и `getCrmMutations()` (мутации). Оба возвращают **тот же**
  закэшированный объект — иначе появился бы второй overlay-адаптер над тем же storage, и заметка,
  записанная через один, могла бы не читаться через другой. Покрыто regression-тестом на идентичность.
- **Ключ идемпотентности** строится в UI как `` `${useId()}:${userId}:${attempt}` `` — без
  `Math.random()`, `Date.now()`, `crypto` и новых зависимостей (D-61). Пользователю не показывается.
- **Двойной submit** безопасен на обоих уровнях: `disabled` + ref-guard в UI, replay по тому же ключу
  в провайдере.
- **Optimistic update отсутствует** (D-60): после успеха выполняется refetch `getUserNotes`, чтобы
  projector и canonical sorting остались владельцами видимости и порядка.
- **`CrmError.message` в UI не попадает** (D-62): локальная тотальная карта `Record<CrmErrorCode, string>`.
  Английская диагностика `"Mock overlay could not be persisted."` остаётся для разработчика.
