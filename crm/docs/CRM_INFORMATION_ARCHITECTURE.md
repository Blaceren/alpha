# CRM_INFORMATION_ARCHITECTURE.md — Alfa Trade Academy CRM

> Phase 0 (обновлено в Phase 0.5) · Информационная архитектура: навигация, назначение разделов, сценарии сотрудников, структура каждого экрана.
> Статус: Draft для утверждения.
>
> **Phase 0.5:** Users-фильтры, saved views и бейджи User 360 переведены на 5-мерную модель состояний (STATE_MODEL.md). Финансы — по бакетам для ролей без точного доступа (D-07); email — masked с Reveal-flow (D-11).

---

## 0. Принципы IA

1. **Работа, а не дашборд.** Каждый экран отвечает: что требует внимания, почему, что делать, кто отвечает, когда дедлайн, какой результат ожидается.
2. **Пользователь — центр модели.** Всё сводится к User 360 и единой временной шкале.
3. **Объяснимость.** Сигналы, приоритеты, рекомендации всегда с evidence.
4. **Ролевой доступ.** Навигация и данные фильтруются правами (см. ROLE_PERMISSION_MATRIX.md).
5. **Provider-agnostic.** IA не зависит от того, mock это или API.

Легенда зрелости раздела в v1: **[FULL]** — полная реализация; **[PARTIAL]** — рабочий минимум; **[PLACEHOLDER]** — продуманная заглушка с фиксированным контрактом.

---

## 1. Глобальная навигация

Постоянный левый sidebar, сгруппированный по смыслу:

```
ATA CRM
├─ Today                     [FULL]     — стартовый экран смены
│
├─ WORK
│  ├─ Users                  [FULL]     — реестр пользователей
│  ├─ Segments               [PARTIAL]  — сохранённые/системные сегменты
│  ├─ Tasks                  [FULL]     — задачи сотрудников
│  └─ Cases                  [FULL]     — кейсы (сложные ситуации)
│
├─ QUEUES
│  ├─ Mentor Queue           [PARTIAL]  — очередь mentor-проверок
│  └─ Support Queue          [PARTIAL]  — очередь поддержки
│
├─ OPERATIONS
│  ├─ Financial Operations   [PARTIAL]  — финансовые контрольные точки/события
│  ├─ Communications         [PLACEHOLDER] — история/лимиты коммуникаций
│  └─ Automations            [PLACEHOLDER] — правила автоматизаций
│
├─ INSIGHT
│  ├─ Analytics              [PLACEHOLDER] — продуктовая аналитика
│  └─ Audit                  [PARTIAL]  — журнал действий
│
└─ Settings                  [PARTIAL]  — настройки, роли (mock RBAC), профиль
```

**User 360** — не пункт меню, а детальный маршрут (`/users/:id`), доступный из любого списка, поиска и таймлайна.

Верхняя панель: глобальный поиск / command palette (⌘K), индикатор роли (mock), density-переключатель, профиль сотрудника, признак окружения **MOCK DATA**.

---

## 2. Ключевые сценарии сотрудников (user journeys)

1. **Начало смены (retention_manager).** Открывает Today → видит приоритезированные очереди → берёт верхний элемент → переходит в User 360 → выполняет рекомендованное действие → фиксирует outcome → задача закрывается/переносится.
2. **Разбор пользователя (любая роль).** Поиск по User ID/имени → User 360 → читает Timeline и Signals → понимает blocker → создаёт task/case или note.
3. **Mentor-проверка (mentor).** Mentor Queue → берёт report → смотрит learning-контекст в User 360 → approve/reject с причиной → при reject создаётся follow-up.
4. **Поддержка (support).** Support Queue / Case → ограниченный контекст пользователя → диалог/решение → закрытие кейса с outcome.
5. **Финансовый разбор (retention/manager).** Financial Operations → checkpoint grace / suspended / data conflict → проверка freshness баланса → решение или эскалация в case.
6. **Сегментная работа (retention/analyst).** Segments → выбор сегмента → просмотр списка → массовое создание задач (в будущем) или анализ.
7. **Контроль качества (manager/admin).** Audit → фильтр по сотруднику/действию → проверка истории → Settings при необходимости.

---

## 3. Today

**Назначение:** единый приоритезированный экран «что делать сейчас», собранный из сигналов, задач, SLA и очередей для текущего сотрудника (с учётом роли и ownership).

**Структура:**
- **Шапка смены:** дата, роль, сводка (открытых задач, overdue, SLA-риски, новых FTD).
- **Приоритетные группы (очереди-карточки):** задачи на сегодня; overdue tasks; пользователи без прогресса; mentor SLA alerts; support blockers; rejected reports без повторной отправки; checkpoint approaching; checkpoint grace; suspended access; вернувшиеся пользователи; новые FTD; repeat funders; communication fatigue; data conflicts.
- **Recommended actions:** сгенерированные рекомендации с кнопкой перехода к действию.

**Контракт элемента очереди (обязательные поля отображения):** почему пользователь в очереди (reason), evidence, priority, recommended action, owner, due date, текущий статус. Клик по элементу → User 360 с открытым контекстом.

**Данные:** `getTodayWorkspace` (см. DATA_PROVIDER_CONTRACT.md).

---

## 4. Users

**Назначение:** рабочий реестр всех пользователей с быстрым поиском/фильтрацией и переходом в User 360.

**Колонки (по контексту):** пользователь; lifecycle stage; funding status; engagement status; value segments; blockers; current level; XP; last meaningful action; Pocket status; real balance/бакет (с freshness); next checkpoint; net deposits; FTD amount; redeposit count; last redeposit; active signals; owner (primary); next action; last contact.

**Функции:** search; фильтры по каждому из 5 измерений независимо (lifecycleStage, fundingStatus, engagementStatus, valueSegment[], blocker[]) + signal, owner, Pocket status, checkpoint state, диапазоны/бакеты балансов; сортировка; saved views; pagination; конфигурация колонок; **bulk selection — future**; export — только для разрешённых ролей.

**Чувствительность:** точный real balance / точные суммы депозитов показываются только ролям с правом на точные финансовые данные; остальным — маскированные/диапазонные значения (см. ROLE_PERMISSION_MATRIX.md). Email всегда masked в списке.

**Данные:** `searchUsers`.

---

## 5. User 360

**Назначение:** полная карточка пользователя — единая точка правды для сопровождения. Композиция из блоков; правая колонка — постоянные операции (tasks/notes/signals), центр — контент раздела, верх — header.

**5.1 Header:** имя; masked email (Reveal-flow для разрешённых ролей, D-11); user ID; Pocket connection; **пять бейджей состояния** — lifecycle stage, funding status, engagement status, value segments (чипы), blockers (чипы), каждый с reason/evidence; primary owner; current priority; last meaningful action; next recommended action.

**5.2 Progression:** curriculum version; current level; highest completed level; XP; current module; next lesson; next checkpoint; locked reason; completion history.

**5.3 Learning:** lessons; tests; attempts; reports; mentor reviews; rejected assignments; learning streak; last learning activity.

**5.4 Financial:** current real balance (+ freshness/timestamp); first deposit; redeposits; successful withdrawals; net deposits; next checkpoint; grace; suspended/restored history. **Каждое финансовое значение — с timestamp/freshness.**

**5.5 Activity:** sessions; meaningful actions; Pocket events; trade activity summaries; community activity; communication activity.

**5.6 Operations:** notes; tasks; cases; owner history; support history; mentor history; automation history; audit.

**5.7 Timeline (единая хронология):** product events, Pocket events, employee actions, communications, automation actions, lifecycle changes, signals, tasks, cases — на одной шкале, с фильтрами по типу источника. Это ядро объяснимости.

**Данные:** `getUserById`, `getUserTimeline`, `getUserTasks`, `getUserCases`, `getUserNotes`, `getUserSignals`, `getRecommendedActions`.

---

## 6. Tasks

**Назначение:** учёт единиц работы сотрудников по пользователям/кейсам.

**Представления:** мои задачи; задачи команды (для manager); по пользователю (внутри User 360); по кейсу.
**Колонки:** title; type; user; case; owner; source; reasonCode; priority; status; dueAt; followUpAt; outcome.
**Статусы:** open, in_progress, waiting_user, waiting_internal, completed, cancelled, overdue.
**Действия:** создать, назначить owner, сменить статус, зафиксировать outcome, задать follow-up. Все действия mock/local и попадают в Audit.

---

## 7. Cases

**Назначение:** контейнер для сложной ситуации, объединяющий задачи, заметки, timeline и SLA вокруг одной проблемы пользователя.

**Типы:** retention, mentor, support, checkpoint, financial_data_conflict, pocket_connection, moderation, identity, communication, safety.
**Структура кейса:** status; priority; owner; SLA; reason; evidence; tasks[]; notes[]; timeline; outcome; closing reason.
**Представления:** список кейсов с фильтрами по типу/статусу/SLA; карточка кейса; кейсы пользователя в User 360.

---

## 8. Segments

**Назначение:** именованные выборки пользователей (системные и сохранённые) для retention- и аналитической работы.

**Примеры сегментов:** зарегистрировался, но не начал; не подключил Pocket; Pocket-registered без FTD; остановился на уроке; несколько провалов теста; report pending; report rejected; приближается к checkpoint; checkpoint grace; financial access suspended; repeat funder; frequent repeat funder; inactive 3/7/14/30 дней; returned user; high-value candidate; communication fatigue; support blocked.

**Функции:** просмотр состава сегмента (переиспользует таблицу Users), сохранение view, счётчики; массовые действия — **future**.
**Данные:** `getSegments`, затем `searchUsers` с фильтром сегмента.

---

## 9. Mentor Queue

**Назначение:** очередь mentor-проверок reports/assignments с учётом SLA.
**Элемент очереди:** пользователь; тип проверки; отправлено (submittedAt); SLA/deadline; попытка №; приоритет; статус; owner (mentor).
**Действия:** взять в работу, approve, reject (с reason → follow-up task), эскалация в case.
**Данные:** `getMentorQueue`; контекст — `getUserById`.

---

## 10. Support Queue

**Назначение:** очередь обращений/блокеров поддержки.
**Элемент:** пользователь; тема/тип; канал; открыто; SLA; приоритет; статус; owner (support).
**Ограничение данных:** support видит технический контекст и ограниченные пользовательские данные; точные финансовые данные — недоступны без права.
**Данные:** `getSupportQueue`.

---

## 11. Financial Operations

**Назначение:** операционный обзор финансовых контрольных точек и производных Pocket-данных (не платёжный шлюз — CRM **не** инициирует операции).
**Разделы:** checkpoint approaching; checkpoint grace (с таймерами 24 ч); financial access suspended/restored; data conflicts (расхождения баланса/freshness); сводка Net/Gross/Redeposit volume и count.
**Обязательно:** каждое значение — с timestamp/freshness; никаких secret/postback-секретов; точные суммы — только для разрешённых ролей.
**Данные:** `getFinancialOperationsSummary`.

---

## 12. Communications [PLACEHOLDER]

**Назначение:** история отправленных пользователю коммуникаций и контроль перегрузки (communication fatigue).
**Контракт (для будущего):** запись коммуникации (channel, template, sentAt, trigger/automation, outcome window, suppression); лимиты частоты; связка с Automations.
**v1:** заглушка с описанным контрактом и mock-историей внутри User 360 (Communication activity).

---

## 13. Automations [PLACEHOLDER]

**Назначение:** просмотр правил автоматизаций и их срабатываний (runs). CRM v1 не исполняет реальные автоматизации.
**Модель правила:** trigger; conditions; exclusions; priority; cooldown; re-entry rule; action; outcome window; suppression; audit.
**Возможные действия правила:** создать task; создать case; назначить owner; educational notification; отправить на mentor review; follow-up; остановить другие коммуникации; ничего не делать (только сохранить signal).
**Принцип:** ни один UI-компонент не отправляет необъяснимое сообщение напрямую; всё — через объяснимое правило с audit.
**v1:** список правил (mock) + AutomationRun в Timeline.

---

## 14. Analytics [PLACEHOLDER]

**Назначение:** продуктовые метрики и воронки (см. показатели в PROJECT_CONTEXT §5).
**Контракт:** агрегаты (Net/Gross/Redeposit, Retained Funded, Checkpoint Completion, Progression, Reactivation, SLA) — только агрегированные, без сырых персональных финансов вне права.
**v1:** заглушка с макетами карточек метрик и пустыми состояниями; реальные графики — future. Никаких декоративных графиков без семантики.

---

## 15. Audit

**Назначение:** неизменяемый журнал действий сотрудников и системы.
**Запись:** actor; action; entity type/id; before/after (где применимо); reasonCode; timestamp; source (manual/automation).
**Представления:** глобальный журнал (для admin/manager) с фильтрами по actor/entity/action/датам; audit-preview внутри User 360 (Operations).
**v1 [PARTIAL]:** запись всех mock-действий CRM локально + просмотр.

---

## 16. Settings

**Назначение:** конфигурация CRM, роли и профиль.
**Разделы:** профиль сотрудника; текущая роль (**mock RBAC — явно помечено, не production**); переключатель роли для демо; density/тема; управление saved views; справочники (lifecycle-версии, signal-каталог) в режиме чтения.
**Ограничение:** реальный RBAC не заявляется; изменения — локальные/mock.

---

## 17. Матрица «раздел × основная роль» (обзор)

| Раздел | Осн. потребитель | Прочие |
|---|---|---|
| Today | Все операционные роли | — |
| Users / User 360 | retention, manager | mentor, support (огранич.), analyst |
| Segments | retention, analyst | manager |
| Tasks | Все | — |
| Cases | retention, support, mentor | manager, moderator |
| Mentor Queue | mentor | manager |
| Support Queue | support | manager |
| Financial Ops | retention, manager | analyst (агрег.) |
| Communications | retention | manager |
| Automations | crm_admin, retention | manager |
| Analytics | analyst | manager, admin |
| Audit | crm_admin, manager | — |
| Settings | crm_admin | все (профиль) |

Точные права — в ROLE_PERMISSION_MATRIX.md.

---

_Связано: PROJECT_CONTEXT.md, CRM_DOMAIN_MODEL.md, DATA_PROVIDER_CONTRACT.md, UX_BLUEPRINT.md._
