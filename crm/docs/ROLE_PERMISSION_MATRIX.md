# ROLE_PERMISSION_MATRIX.md — Alfa Trade Academy CRM

> Phase 0 (обновлено в Phase 0.5) · Матрица ролей и прав. На первой стадии это **mock RBAC** для UI-фильтрации — **не** production-авторизация.
> Реальный RBAC реализуется в отдельном защищённом API (см. FUTURE_INTEGRATION.md). Frontend fixture не является источником безопасности.
> Статус: Утверждено (Decision Lock, D-07 финансы, D-11 PII).
>
> **Phase 0.5:** зафиксированы финансовые бакеты (D-07) и PII-политика с Reveal-flow (D-11, см. PII_ACCESS_POLICY.md). Финансовая видимость и доступ к PII — **две независимые оси**.

---

## 0. Модель прав

Права выражаются как `(action, scope, dimension)`:

- **Роли:** `crm_admin, crm_manager, retention_manager, mentor, support, moderator, analyst, content_manager, read_only`.
- **Измерения доступа (dimensions):**
  1. **View** — базовый просмотр раздела/сущности.
  2. **Exact financials** — точные суммы (real balance, депозиты, withdrawals). Отдельно от View, т.к. точные финансы видят не все.
  3. **Edit** — изменение сущностей CRM (tasks/cases/notes/lifecycle override).
  4. **Assign** — назначение owner/задач/эскалаций.
  5. **Export** — выгрузка данных.
  6. **Audit** — доступ к глобальному журналу Audit.
  7. **Settings** — конфигурация CRM/ролей.
- **Уровни:** `Full` · `Limited` (только своё/агрегаты/масштабированное) · `None`.
- **Scope:** `own` (только назначенные пользователю/себе), `team`, `all`.

Финансовая чувствительность: без **Exact financials** пользователь видит суммы как **маскированные диапазоны** (напр. `$100–250`, `funded`, `stale`) либо скрытые, но всегда с freshness-меткой.

---

## 1. Сводная матрица (роль × измерение)

| Роль | View | Exact financials | Edit | Assign | Export | Audit | Settings |
|---|---|---|---|---|---|---|---|
| **crm_admin** | Full (all) | Full | Full | Full | Full | Full | Full |
| **crm_manager** | Full (all) | Full | Full (team) | Full (team) | Limited¹ | Full | Limited² |
| **retention_manager** | Full (all, кроме moderation-деталей) | Full | Full (own+team retention) | Full (retention) | Limited¹ | Limited³ | None |
| **mentor** | Limited (learning-контекст) | None | Limited (mentor tasks/cases, reports) | Limited (mentor queue) | None | Limited³ | None |
| **support** | Limited (support-контекст) | None⁴ | Limited (support cases/tasks/notes) | Limited (support queue) | None | Limited³ | None |
| **moderator** | Limited (community/moderation) | None | Limited (moderation cases) | Limited (moderation) | None | Limited³ | None |
| **analyst** | Limited (агрегаты, без операц. действий) | Limited⁵ | None | None | Limited (агрегаты)¹ | Limited³ | None |
| **content_manager** | Limited (curriculum/content read) | None | Limited (content-related) | None | None | None | None |
| **read_only** | Limited (разрешённый просмотр) | None | None | None | None | None | None |

Примечания:
¹ Export — только разрешённые наборы, с audit-логом каждой выгрузки; personal financial exports требуют Exact financials.
² Settings у manager — управление saved views/справочниками команды, **без** ролевого администрирования.
³ Audit «Limited» = задуманный audit-preview по своим пользователям/действиям в User 360, но не глобальный журнал. **(Phase 1B5-B, D-86/D-90)** глобальный Audit Workspace на `/audit` гейтится ТОЛЬКО `canViewAudit` (право `view_audit`) → данные у crm_admin/crm_manager. Навигационная видимость раздела шире (7 ролей по `SECTION_VISIBILITY.audit`), но пять section-visible Limited-ролей (retention_manager/mentor/support/moderator/analyst) на `/audit` получают спокойный restricted-state, а не данные и не empty-state; content_manager/read_only не видят пункт и при прямом заходе тоже получают restricted-state. Матрица/`SECTION_VISIBILITY`/`canViewAudit` не менялись. Limited audit-preview в User 360 остаётся будущей фазой (D-90).
⁴ Support видит финансовый **факт-контекст** (funded/suspended, freshness), но не точные суммы, если нет отдельного гранта.
⁵ Analyst видит финансы только **агрегированно**; сырые персональные суммы — None.

---

## 2. Права по разделам (роль × раздел)

Легенда: **F** Full · **L** Limited · **–** None.

| Раздел | admin | manager | retention | mentor | support | moderator | analyst | content | read_only |
|---|---|---|---|---|---|---|---|---|---|
| Today | F | F | F | L | L | L | L | L | L |
| Users (list) | F | F | F | L | L | L | L | L | L |
| User 360 | F | F | F | L(learning) | L(support) | L(mod) | L(agg) | L(content) | L |
| Segments | F | F | F | – | – | – | L | – | L |
| Tasks | F | F | F | L | L | L | – | L | – |
| Cases | F | F | F | L(mentor) | L(support) | L(mod) | – | – | – |
| Mentor Queue | F | F | L | F | – | – | – | – | – |
| Support Queue | F | F | L | – | F | – | – | – | – |
| Financial Ops | F | F | F | – | L(ctx) | – | L(agg) | – | – |
| Communications | F | F | F | – | L | – | L(agg) | – | – |
| Automations | F | F | L | – | – | – | L(view) | – | – |
| Analytics | F | F | L | – | – | – | F | – | L |
| Audit | F | F | L | L | L | L | L | – | – |
| Settings | F | L | – | – | – | – | – | – | – |

---

## 3. Детализация по ролям

**crm_admin.** Полный доступ ко всей конфигурации CRM, ролям (mock), audit и всем данным. Единственная роль с Settings=Full. Может видеть точные финансы и всё экспортировать (под audit).

**crm_manager.** Оперативное управление командой: users, tasks, cases, assignments, отчёты и team performance. Полные точные финансы и полный audit для контроля качества. Settings ограничены (views/справочники, не роли).

**retention_manager.** Ядро retention: lifecycle, segments, communications, retention-задачи и кейсы. Точные финансы — да (нужны для checkpoint/grace-решений). Assign в пределах retention. Глобальный audit — нет (только контекстный).

**mentor.** Learning-центрично: reports, mentor queue, история обучения пользователя. Финансовых сумм не видит. Может брать/решать mentor-проверки и создавать mentor-задачи/кейсы. Пользовательские данные — только учебный контекст.

**support.** Support-кейсы, технический контекст, ограниченные пользовательские данные. Финансовый факт-контекст (funded/suspended/freshness) — да; точные суммы — нет. Assign в пределах support-очереди.

**moderator.** Community moderation и moderation-кейсы. Не видит финансы и глубокий учебный/финансовый контекст. Действия — в границах модерации.

**analyst.** Агрегированные данные: funnels, retention, метрики, ограниченные exports. Нет операционных действий (Edit/Assign=None). Персональные точные финансы — нет, только агрегаты.

**content_manager.** Read-контекст curriculum/контента и content-related операции. Не видит финансы и персональные операционные данные пользователей сверх нужного.

**read_only.** Только разрешённый просмотр без изменений, назначений, экспорта, финансовых точных данных и настроек.

---

## 4. Правила для чувствительных данных

### 4.1 Финансовая видимость (DECISIONS D-07)

**Точные суммы** (real balance, депозиты/выводы, net/gross): `crm_admin`, `crm_manager`, `retention_manager`.
`analyst` — только **агрегированные и псевдонимизированные** данные.
`mentor`, `support`, `moderator`, `content_manager` — по умолчанию **бакеты**.
`support` может получить точные значения **только** через отдельный permission + audit.

Бакеты диапазонов:

`below_50 · 50_99 · 100_199 · 200_499 · 500_999 · 1000_2499 · 2500_4999 · 5000_9999 · 10000_plus`

Маскирование выполняется в domain-слое **до** отдачи в UI (тип `MoneyCell` bucket-aware).

### 4.2 Прочие правила

1. **Freshness обязателен.** Любое финансовое значение — с timestamp/freshness; stale помечается независимо от роли.
2. **Postback secret / сырой playerId** — `RESTRICTED`, недоступны никому в CRM.
3. **PII / полный email (DECISIONS D-11, PII_ACCESS_POLICY.md):** в списках всегда masked. Полный email в User 360 — `crm_admin`/`crm_manager`/`retention_manager`; `support` — только с отдельным permission; остальные — masked/без identity. Reveal требует явного действия + reason code + audit + авто-скрытия. Финансовая ось и PII-ось проверяются **независимо**.
4. **Export** персональных финансов — только роли с точными суммами; логируется в Audit.
5. **Lifecycle/owner override** (Edit/Assign) — только admin/manager/retention в scope; каждое действие → AuditRecord с reasonCode. **Один primary owner на пользователя** (D-08).
6. **Все изменяющие действия v1 — mock/local**, помечены в UI и в AuditRecord (`mock: true`).

---

## 5. Матрица чувствительных действий (кто может)

| Действие | admin | manager | retention | mentor | support | moderator | analyst | content | read_only |
|---|---|---|---|---|---|---|---|---|---|
| Смотреть точный real balance | ✓ | ✓ | ✓ | bucket | bucket | bucket | agg | bucket | – |
| Reveal полного email (User 360) | ✓ | ✓ | ✓ | – | perm | – | – | – | – |
| Экспорт персональных финансов | ✓ | ✓ | ✓ | – | – | – | – | – | – |
| Создать/изменить task | ✓ | ✓ | ✓ | ✓(mentor) | ✓(support) | ✓(mod) | – | ✓(content) | – |
| Открыть/закрыть case | ✓ | ✓ | ✓ | ✓(mentor) | ✓(support) | ✓(mod) | – | – | – |
| Назначить owner | ✓ | ✓ | ✓ | – | – | – | – | – | – |
| Lifecycle manual override | ✓ | ✓ | ✓ | – | – | – | – | – | – |
| Approve/Reject report | ✓ | ✓ | – | ✓ | – | – | – | – | – |
| Настроить роли/конфиг (mock) | ✓ | – | – | – | – | – | – | – | – |
| Смотреть глобальный Audit | ✓ | ✓ | – | – | – | – | – | – | – |
| **Добавить заметку о пользователе** | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – |

---

## 5.1 Заметки: Edit → notes (Phase 1B4-A, DECISIONS D-53)

Строка «Добавить заметку» выше — не новое право, а **прочтение измерения Edit из §1**. §0 определяет Edit как «изменение сущностей CRM (tasks/cases/**notes**/lifecycle override)», поэтому заметки уже входят в Edit; §1 определяет, у кого это Edit есть и в каком объёме:

| Роль | Edit (§1) | Заметки входят? |
|---|---|---|
| crm_admin | Full | да — Full покрывает все сущности |
| crm_manager | Full (team) | да |
| retention_manager | Full (own+team retention) | да |
| support | Limited (support cases/tasks/**notes**) | **да — названы явно** |
| mentor | Limited (mentor tasks/cases, reports) | нет |
| moderator | Limited (moderation cases) | нет |
| content_manager | Limited (content-related) | нет |
| analyst | None | нет |
| read_only | None | нет |

**Почему так.** Среди ролей с Edit=Limited `support` — единственная, в чьей скобке перечислены `notes`. Скобка задаёт, какие сущности допускает ограничение; будь она иллюстративной, слово `notes` было бы избыточным. Значит перечисление **исчерпывающее**, и там, где заметки не названы, права на них нет. При отсутствии положительного разрешения решение fail-closed.

**Чем это право не является.** Не следует из видимости финансов (support пишет заметки, но точных сумм не видит — §4.1) и не переиспользует `assign_owner` (support заметки пишет, owner не назначает — §5). Это разные измерения §1, и добавление `edit_user_notes` **не расширило** ни одно существующее право просмотра.

**Реализация:** `Permission` += `edit_user_notes`, хелпер `canEditUserNotes(role)` в `domain/identity/access.ts`. Проверяется по доверенному `CrmContext`, не по данным команды. Каждое успешное добавление → `AuditRecord{mock:true}` **без тела заметки** (§4.2.6, docs/MUTATION_OVERLAY.md).

**Границы фазы.** Под `edit_user_notes` реализованы `addNote` (1B4-A), `setNotePinned` (1B4-D), `updateNoteBody` (1B4-E), `setNoteVisibility` (1B5-C) и `deleteNote` (1B6): закрепление, редактирование тела, смена видимости и удаление — это **редактирование** заметки, то же измерение Edit, а не новое право (D-75/D-82/D-91/D-96), поэтому матрица ими не расширена — правят ровно те же четыре роли. Закреплять можно любую **видимую** заметку (включая `private` — её автору); скрытая → `not_found` (D-76). **Редактирование тела, смена видимости и удаление строже** (D-82/D-91/D-96): только **автор** своей **overlay**-заметки (`authorEmployeeId === actorId`), иначе `unauthorized` даже у роли с правом; фикстурная заметка неизменна (видимая non-overlay → `invalid_input`, не `not_found`). Возможность отдаётся провайдером через `getUserNotesView.capabilities.canEditBody`/`canChangeVisibility`/`canDelete`, React роли не перечисляет. **Смена видимости — только `team ↔ private`** (D-91): `role_restricted` не writable (нет модели allowed-roles) → `invalid_input`; создаётся заметка по-прежнему только как `team` (D-54). **Private — по identity актора, не по роли** (D-92): private-заметку видит только её автор, смена роли при том же `actorEmployeeId` её не скрывает; другой сотрудник (включая admin) не видит. **Удаление — hard delete** (D-96): заметка физически уходит из overlay `notes[]` (tombstone/тело не остаётся, undo нет), append-only `note_deleted` audit — защитный источник истины отсутствия (D-97); private удаляется автором по тем же правилам, что team. Создание `role_restricted`, а также мутации tasks/cases/owner/signals/recommendations и reveal PII — **не реализованы**.

**Как это выглядит на экране (Phase 1B4-B, D-59).** Форму добавления заметки в секции «Заметки» на
User 360 получают только четыре роли выше, и решает это единственный хелпер `canEditUserNotes(role)` —
React списка ролей не держит. Остальным пяти форма **не рендерится вообще**: ни textarea, ни submit,
ни disabled-контрола, только строка «Ваша роль не может добавлять заметки». Мёртвая кнопка рекламировала
бы право, которого у роли не будет, и не смогла бы объясниться screen reader'у.

**Право на чтение заметок — другое измерение.** Список заметок остаётся виден **всем девяти ролям**:
чтение — это «View User 360» (§2), а видимость решается на каждой заметке projector'ом (D-55).
Возможность писать заметки **не расширила** ничью видимость: support пишет заметку и по-прежнему не
видит точных сумм и полного email (проверяется E2E по сериализованному документу).

---

## 5.2 Назначение owner: Assign → primary owner (Phase 1B4-C, DECISIONS D-69)

Строка «Назначить owner» из §5 наконец получила потребителя — мутацию `assignPrimaryOwner`. Это **не новое
право**: измерение Assign существует с Phase 0, а `canAssignOwner(role)` — с Phase 1A (до 1B4-C без
вызывающего). Матрица **не расширена**.

| Роль | Assign (§1) | Может менять owner? |
|---|---|---|
| crm_admin | Full | да |
| crm_manager | Full (team) | да |
| retention_manager | Full (retention) | да |
| support | Limited (support queue) | **нет** — Assign ≠ Edit (D-53) |
| mentor / moderator / analyst / content_manager / read_only | Limited/None | нет |

**Assign и Edit — разные измерения.** `support` пишет заметки (`edit_user_notes`) и owner **не** назначает;
`canEditUserNotes` и `canAssignOwner` проверяют разные права и не выводятся друг из друга (тест
«support edits notes but assigns no owner» это фиксирует). Добавление owner-мутации **не расширило** ни
одно право просмотра: чтение owner — часть «View User 360» и видно всем девяти ролям.

**На экране (D-74):** форму назначения в секции «Ответственный и работа» получают только три роли выше —
решает единственный `canAssignOwner(role)`, списка ролей в React нет. Остальным шести форма **не
рендерится вовсе** (ни select, ни disabled-контрол): строка «Ваша роль не может менять ответственного».
Текущий owner виден всем. `getPrimaryOwnerCandidates` для запрещённых ролей возвращает `unauthorized`, а
не пустой список, и их UI её не вызывает.

**Границы фазы.** Реализованы `assignPrimaryOwner` (+ снятие через `ownerId: null`). Scope `own/team/all`
не моделируется (D-69). Task/case assignees (D-08) — отдельные поля, не тронуты. Audit owner-change
пишется всегда при успехе, **без** PII/финансов/свободного текста (§4.2.6, D-66).

---

## 6. Замечания к реализации (Phase 0)

- Роли и права хранятся как **fixture/enum** во frontend только для демонстрации UI и фильтрации отображения. Это **не** гарантирует безопасность.
- Domain-слой должен вызывать `assertPermission(role, action, scope)` перед каждой операцией provider'а — сигнатура сохранится при переходе на API, где реальную проверку выполнит backend.
- Каждая операция `CrmDataProvider` в DATA_PROVIDER_CONTRACT.md имеет поле **permission requirement**, согласованное с этой матрицей.

---

_Связано: DATA_PROVIDER_CONTRACT.md (permission requirement на операциях), CRM_DOMAIN_MODEL.md (sensitivity), FUTURE_INTEGRATION.md (реальный RBAC/authz API)._
