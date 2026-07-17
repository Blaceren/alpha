# MUTATION_OVERLAY.md — Alfa Trade Academy CRM

> Phase 1B4-A · Mutation core + `addNote` на уровне domain/provider/storage.
> Решения: D-53…D-57. Связано: DATA_PROVIDER_CONTRACT §15, DECISIONS D-09, ROLE_PERMISSION_MATRIX §1/§4.2.
>
> **Phase 1B4-B (выполнен): UI появился.** Секция «Заметки» на User 360 читает `getUserNotes` и пишет
> через `addNote`; форма доступна четырём ролям с `edit_user_notes`. Решения D-58…D-63,
> подробности — `docs/USER_360.md`, ревью — `docs/visual-reviews/PHASE_1B4_B_ADD_NOTE.md`.
> Остальные мутации (tasks/cases/owner/signals/recommendations, reveal PII) по-прежнему не реализованы.

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

interface IdempotencyReceipt {
  key: string;
  fingerprint: string;                    // не тело заметки
  noteId: string;
  auditId: string;
}
```

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

**Audit фиксирует факт действия, а не содержимое.** В нём нет и не может быть: тела заметки, email,
телефона, финансовых значений, произвольного пользовательского текста. `reasonCode` — закрытый enum,
а не свободная строка: свободный текст — ровно тот путь, которым тело заметки просочилось бы в журнал.

Audit UI и read endpoint **не созданы** — записи только пишутся. UI заметок (1B4-B) audit не показывает:
в success-подтверждении нет ни `auditId`, ни `noteId`, ни actor'а — сотруднику сообщается факт
«Заметка добавлена», а не наша бухгалтерия.

---

## 7. Мутации: что есть и чего нет

Реализована **ровно одна**:

```ts
interface CrmMutations {
  addNote(ctx: CrmContext, command: AddNoteCommand): Promise<Result<AddNoteResult>>;
}
```

Пустых методов на будущее **не добавлено**. §15 контракта резервировал полный список
(`createTask`, `updateTask`, `createCase`, `updateCase`, `assignPrimaryOwner`, `resolveSignal`,
`acceptRecommendedAction`, `revealUserPii`), но член интерфейса без реализации — это обещание,
которого провайдер не держит, а `as never` для удовлетворения placeholder-формы — ровно то,
что D-50 пришлось удалять из контракта Today.

**Не реализованы:** createTask, updateTask, createCase, updateCase, owner assignment,
signal resolution, recommendation acceptance, reveal PII.

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
