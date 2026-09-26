# USER_360.md — Alfa Trade Academy CRM (Phase 1C)

Read-only карточка пользователя `/users/[id]`. Реализация: `src/features/user-360/`,
read-модель: `src/domain/users/user-360.ts` + `user-360-projection.ts`.

> **Почти read-only.** На экране **шесть** мутаций: добавление заметки (секция «Заметки», Phase 1B4-B,
> D-58…D-63), назначение primary owner (секция «Ответственный и работа», Phase 1B4-C, D-64…D-74),
> закрепление/открепление заметки (Phase 1B4-D, D-75…D-81), редактирование тела собственной authored-заметки
> (Phase 1B4-E, D-82…D-85), смена её видимости team↔private (Phase 1B5-C, D-91…D-95) и **удаление**
> собственной authored-заметки (Phase 1B6, D-96…D-101) — всё в секции «Заметки». Всё остальное по-прежнему
> только читается: смена статуса, tasks/cases, task/case assignees, закрытие сигналов, выполнение
> рекомендаций, редактирование/удаление чужих/фикстурных заметок, создание `role_restricted`,
> финансовые операции и коммуникации **не реализованы** — см. §Non-scope. Backend/database/Prisma/Pocket
> не подключены. Следующий этап **не начинается автоматически**.
>
> **Назначение owner (Phase 1B4-C).** Форма в секции «Ответственный и работа» доступна трём ролям с Assign
> (`crm_admin`/`crm_manager`/`retention_manager`), остальным — строка-объяснение без контрола (D-74).
> Нативный `<select>` (пять кандидатов + «Без ответственного»), явная кнопка «Сохранить» (не auto-submit),
> `expectedOwnerId` против потери обновления, никакого optimistic update — после успеха refetch **всего**
> `getUser360` (owner в агрегате, D-35); кандидаты — отдельный read `getPrimaryOwnerCandidates`. Users и
> Today видят нового owner при следующем read; live cross-tab sync нет. Ревью:
> `docs/visual-reviews/PHASE_1B4_C_ASSIGN_OWNER.md`.

## Purpose

За несколько секунд ответить: кто это, почему он требует (или не требует) внимания, на каком этапе
onboarding/lifecycle находится, каков его финансовый статус **в пределах прав роли**, насколько он
активен, как идёт обучение, какие есть блокеры и сигналы, кто ответственный, какое следующее
рекомендуемое действие и какие недавние события важны.

Это операционный рабочий экран, а не маркетинговый профиль и не набор KPI-карточек.

## Data contract (§Provider audit)

Аудит существующего `CrmDataProvider` перед реализацией показал:

| Операция | Пригодность для User 360 |
|---|---|
| `getUserById` | Возвращает `UserSummary` — **плоскую list-проекцию** с `context: "list"` (identity всегда masked, даже для admin). Нет learning, grace, SLA-состояния, сигналов, рекомендаций, событий. Недостаточно. |
| `getUserTimeline` | Существовала, но **игнорировала `ctx`** — отдавала HIGH-события (депозиты) любой роли вопреки DATA_PROVIDER_CONTRACT §4. Исправлено в Phase 1C.1 (D-39): обе операции используют единый canonical projector. |
| `getUserSignals` | Существует, `ctx` не используется. |
| `getRecommendedActions` | Существует, `ctx` не используется. |
| `projectIdentity` | Уже поддерживает `context: "detail"` (полный email для ролей с `view_identity_full_email`) — путь был спроектирован, но никогда не использовался. |

Сборка экрана из четырёх вызовов означала бы четыре loading/error-состояния и **композицию прав в UI**.
Поэтому добавлена **одна read-only операция** (14-я в контракте):

```ts
getUser360(ctx: CrmContext, input: { userId: UserId }): Promise<Result<User360>>
```

Существующие 13 операций **не менялись** (регрессий нет). Мутирующего аналога у неё нет.

## Permission projection

Единственное место решений о видимости — `src/domain/users/user-360-projection.ts`, **внутри провайдера**,
до React. Запрещённое значение не «скрывается CSS» — его физически нет в payload, props, DOM,
`title`/`aria`, data-атрибутах и в сериализованных данных страницы.

| Роль | Identity | Balance / Net deposits | Checkpoint $ | Финансово-производные пояснения | HIGH-события (депозиты) |
|---|---|---|---|---|---|
| `crm_admin` | full email | exact (`$90`) | `$100` | видны | видны |
| `crm_manager` | full email | exact | виден | видны | видны |
| `retention_manager` | full email | exact | виден | видны | видны |
| `mentor` | masked | bucket (`$50–99`) | скрыт | скрыты | скрыты |
| `support` | masked | bucket (`$50–99`) | скрыт | скрыты | скрыты |
| `moderator` | display name + platform id | bucket | скрыт | скрыты | скрыты |
| `analyst` | pseudonymous (`anon_026`) | aggregated | скрыт | скрыты | скрыты |
| `content_manager` | без identity | bucket | скрыт | скрыты | скрыты |
| `read_only` | masked | hidden («Недоступно для роли») | скрыт | скрыты | скрыты |

Соответствует ROLE_PERMISSION_MATRIX §4 и PII_ACCESS_POLICY §3/§5. Финансовая ось и PII-ось проверяются
независимо. Реальный PII reveal-flow **не реализован** (вне scope).

### Почему скрыт checkpoint amount (важно)

Сетка контрольных точек — **опубликованная константа** (L10 = $100, PROJECT_CONTEXT §4.3), а сигнал
`checkpoint_approaching` объясняет себя как «До checkpoint L10 осталось 10%». Роль с бакетом `$50–99`
могла бы вычислить точный баланс арифметикой: `100 − 10% = $90`. Поэтому для ролей без
`view_exact_financials`:

- `learning.nextCheckpointRequiredUsd` → `null`;
- у финансово-производных сигналов (`checkpoint_approaching`, `rapid_balance_decline`)
  `reason → null` и `evidence → []`.

Сам сигнал роль по-прежнему видит — скрыта только балансо-производная деталь. Покрыто тестами
(unit + E2E проверяют отсутствие `$100` и `осталось 10%` в сериализованном документе).

### Анонимизация — это ось целиком

Если роль не получает identity (`hidden`/`pseudonymous`), она не получает и `country`/`locale`/
`timezone`/`acquisitionSource`/`campaign`: эти поля сужают обезличенного субъекта и относятся к той же оси.

### Честное «нет данных» vs «нет прав»

`FinancialProjection.mode: "hidden"` раньше смешивал два разных факта. Добавлен `hiddenReason:
"no_data" | "not_permitted"`: пользователю без баланса admin видит **«Нет данных»**, а не ложное
«Недоступно для роли». С Phase 1C.1 (D-40) этот же `hiddenReason` и единый источник текста
`HIDDEN_LABEL` использует и `FinancialCell` в Users workspace — семантика скрытого финансового
значения одинакова на обоих экранах.

### Активность = canonical timeline (Phase 1C.1)

`activity` строится **не** собственной реализацией User 360, а общим projector
`domain/users/user-timeline.ts`, который используется и в `getUserTimeline` (D-39). User 360 лишь
сужает форму события (`id/at/source/kind/title`) и **не принимает решений о видимости**. HIGH-события
(подтверждённые депозиты) не отдаются ролям без exact-финансов; скрытие тихое. Ни одно поле события
не содержит суммы — событие несёт только факт и время.

## Information architecture

DOM-порядок = порядок чтения = mobile-порядок. На `lg+` последние два блока становятся более узкой
**sticky** operational-context колонкой рядом с широкой основной.

DOM-порядок с Phase 1B4-B: header → внимание → состояния → блокеры → сигналы → обучение →
события → **заметки** → (sticky-контекст: финансы, ответственный).

1. **Header** — back link «Пользователи», имя (или pseudonym/ID), identity-проекция, приоритет,
   user ID (спокойный secondary), ответственный, последняя активность, статус данных. Не hero.
2. **Почему требует внимания** — полоса приоритета + человекочитаемая причина + рекомендуемое
   действие (основание, срочность, кому адресовано, read-only). Для спокойного пользователя —
   «Активных причин для внимания нет». Красным не заливается весь экран.
3. **Состояния** — пять независимых осей отдельными плитками: Этап · Регистрация Pocket ·
   Финансовый статус · Активность · Прогресс. Никогда не сливаются в один enum, raw-кодов нет.
4. **Активные блокеры** — многозначная **ось состояния** (+ ценностные сегменты).
5. **Системные сигналы** — производные, временные, истекающие индикаторы: severity, объяснение,
   срок действия.
6. **Обучение** — уровень/XP/модуль/урок/тесты/отчёт/проверка ментора/учебная активность; статус
   контрольной точки и следующая контрольная точка — **отдельными полями**.
7. **Недавние события** — короткий operational timeline (до 6 событий), semantic `<ol>`.
8. **Заметки** — что команда написала о пользователе, и единственная форма на экране. Стоит после
   событий осознанно: события — это то, что произошло с профилем, заметки — то, что о нём написали.
9. **Финансы** и **Ответственный и работа** — sticky-контекст на desktop.

### Как не дублировать одно и то же трижды

Один факт (support-блокер) представлен ровно **дважды и по-разному**: как **состояние** (chip в
«Активные блокеры») и как **производный сигнал** (в «Системные сигналы»). Приоритетная интерпретация
**ссылается** на сигнал бейджем «Основание приоритета», а не бейджит факт в третий раз. Связь
единосточная: `computePriority` возвращает `sourceSignalCodes` (лестница правил остаётся источником истины).

## Explainability

`StateEvidence` (labels/values движка) остаётся в read-модели для будущего audit/API-слоя, но **не
рендерится**: его подписи — английские внутренности движка (`support state: blocked`), которые не
должны попадать в user-facing UI. Объяснимость на экране обеспечивают человекочитаемая причина
приоритета, человекочитаемые сигналы с severity/сроком и «Основание приоритета».
Русская карта evidence-подписей — отдельная задача.

## Read-only и отсутствие fake success

Рекомендации показываются с названием, основанием, срочностью, адресатом и явной пометкой
**«Только просмотр»**. Кнопки, изображающей выполнение, **нет** — Phase 1C не имеет mutations, и
контрол, притворяющийся исполняющим, был бы fake success. Если действие адресовано другой роли —
явная пометка «не для вашей роли» (`allowedForRole`). Никаких deposit-encouragement и loss-chasing
формулировок (D-21).

**Название берётся из единого источника (D-52).** Экран печатает не `title` из read-модели, а
резолвит подпись из `code` через `config/labels`.`RECOMMENDATION_LABEL`, которая выведена из
`RECOMMENDATION_CATALOG[code].title` — того же канона, что читают Users и Today. Раньше User 360
печатал `title` напрямую и расходился с ними на трёх кодах. `User360Recommendation.title` в
read-модели сохранён (провайдерский контракт не менялся) и тождественен канону по построению.
Будущие audit-записи Phase 1B4, называющие действие, обязаны брать подпись оттуда же.

## States

- **loading** — skeleton, повторяющий реальный layout (header + две колонки), без layout shift.
- **not-found** — настоящий not-found с ID, объяснением и ссылкой назад; без stack trace и без
  выдуманного профиля. Состояние занимает всю страницу, поэтому несёт её единственный `h1`.
- **unauthorized** — «Доступ ограничен» + безопасный путь назад; не раскрывает, какие именно
  чувствительные данные существуют. Provider-driven (`CrmError.code === "unauthorized"`).
  **Замечание:** при текущей утверждённой матрице (ROLE_PERMISSION_MATRIX §2 + PII_ACCESS_POLICY §5)
  User 360 доступен **всем девяти ролям** хотя бы в ограниченном/обезличенном виде, поэтому ни одна
  роль не приводит к `unauthorized` в mock-режиме. Состояние реализовано и покрыто component-тестом
  со stub-провайдером (как и `UsersUnauthorized` в Users workspace). E2E-сценарий для него потребовал
  бы debug-контрола (запрещён) или расширения прав вопреки матрице — не делалось.
- **error** — сообщение по коду; «Повторить» **только** если `error.retriable`.
- **stale** — данные видны + спокойный баннер; staleness берётся из provider metadata
  (`Freshness`) и `FixedMockClock`, а не из часов браузера (D-19).

## Responsive

- **1440×900** — первый экран без скролла показывает identity/header, причину приоритета,
  рекомендацию, состояния и начало «Обучения». Page overflow 0.
- **1024×768** — намеренная компактная иерархия: header уплотняется, meta переносится отдельным
  рядом, состояния 3+2, критическое внимание остаётся сверху. Page overflow 0.
- **390×844** — не уменьшенная desktop-сетка, а порядок: back+пользователь → приоритет и причина →
  рекомендация → состояния → blockers/signals → обучение → события → ответственный/контекст.
  Порядок проверяется E2E-замером координат. Page overflow 0.
- **200% zoom** — браузерный zoom = меньший CSS-viewport (720×450 при 1440×900): контент
  переливается в одну колонку, 2D-скролла нет (проверяется E2E).

## Accessibility

Один `h1` (в т.ч. в not-found/unauthorized); каждый блок — `<section aria-labelledby>` со своим `h2`
(`useId`, стабилен при гидратации); back link; приоритет и статусы **не только цветом** (всегда есть
текст); timeline — semantic `<ol>` с `<time datetime>`; рекомендация имеет доступное имя; masked
identity читается screen reader'ом; запрещённых значений в DOM нет; keyboard-навигация и
`focus-visible`; 200% zoom; reduced-motion (глобально).

## Canonical demo users

Существующие фикстуры, уже представленные в Users workspace — новых персон ради скриншотов не создавалось:

| Сценарий | Пользователь | Чем ценен |
|---|---|---|
| Высокий приоритет | `usr_mock_026` Nina Chmiel | critical, support-блокер, SLA нарушен, баланс $90 → admin exact vs support bucket, checkpoint-инференс |
| Спокойный | `usr_mock_005` Lena Mazur | low, сигналов нет, «Действие не требуется» — экран не выдумывает срочность |
| Ограниченные финансы | `usr_mock_026` под ролью support | bucket `$50–99`, exact отсутствует |
| Onboarding attention | `usr_mock_001` Nadia Novak | Pocket не зарегистрирован, баланса нет → «нет данных» |
| Неизвестный ID | `usr_mock_does_not_exist` | настоящий not-found |

## Tests

- **Provider/projection** (`src/domain/users/user-360-projection.test.ts`, 25): контракт результата
  (not_found / freshness / детерминизм / stale / clock), admin, support (включая невозможность
  реконструкции баланса), retention/mentor/analyst/content_manager/read_only, «нет данных» vs «нет прав».
- **Permissions в DOM** (`src/features/user-360/user-360-permissions.test.tsx`, 12): для каждой роли
  проверяется, что разрешённое присутствует, а запрещённое отсутствует в `innerHTML`.
- **Workspace** (`src/features/user-360/user-360-workspace.test.tsx`, 19): один h1, секции,
  back link, отсутствие raw-кодов, причина приоритета, рекомендация + read-only + отсутствие
  mutation-контролов, независимость осей, отсутствие тройного дублирования, timeline как список,
  спокойный пользователь, loading/not-found/unauthorized/error(+retry)/stale, keyboard.
- **E2E** (`tests-e2e/user-360.spec.ts`, 13): admin/support/high-priority/calm/onboarding desktop,
  tablet 1024, mobile 390 (+порядок блоков), 200% zoom (reflow), unknown id, навигация
  `/users → профиль → назад`, keyboard focus, analyst, read_only. Везде — чистая консоль;
  в admin-сценарии дополнительно проверяется отсутствие hydration-warnings.

Существующие suites сохранены: `smoke.spec.ts` (5) + `users-screenshots.spec.ts` (5) +
`users-sticky-action.spec.ts` (3) = 13. Итого E2E **26**.

## Screenshots

`screenshots/phase-1c-user-360/first-pass/` и `.../final/` (реальный рендер, headless Chromium,
`npm run test:e2e`; в first-pass — `PHASE_1C_PASS=first npx playwright test tests-e2e/user-360.spec.ts`).
Ревью, найденные проблемы и исправления — `docs/visual-reviews/PHASE_1C_USER_360.md`.

## Заметки (Phase 1B4-B)

Секция «Заметки» — список плюс inline-композер. Реализация: `features/user-360/components/user-notes.tsx`
и `note-composer.tsx`, хуки `use-user-notes.ts` / `use-add-note.ts`, тексты ошибок `lib/note-error.ts`.

### Отдельный read, а не часть агрегата (D-58)

Заметки **не входят** в `getUser360` и читаются своим вызовом `getUserNotes(ctx, {userId, page})`.
Причина — приватность заметки решается **на каждой заметке** (D-55) единственным projector'ом
`domain/notes/note-projection.ts`, чей единственный потребитель — `getUserNotes`. Положить заметки в
агрегат значило бы продублировать projector либо перефильтровывать агрегат — расхождение класса
D-39/D-40. React полученный список **не фильтрует и не сортирует**.

D-35 при этом не нарушен: он запрещал не второй вызов, а сборку **прав** в React. Здесь прав в UI нет.

Второе чтение изолировано: его loading не задерживает профиль, его ошибка не подменяет экран
`ErrorState`, retry действует только на секцию. Профиль обязан открываться, даже когда заметки
недоступны.

**Пагинация не реализована:** запрашивается первая страница (`pageSize: 50`, контракт §7), контрола
«ещё» нет — у персоны одна засеянная заметка плюс написанные в этой вкладке.

### Кто видит форму

Право — только `canEditUserNotes(role)` (D-53); списка ролей в React нет. Форму получают
`crm_admin`, `crm_manager`, `retention_manager`, `support`. Остальные пять (`mentor`, `moderator`,
`content_manager`, `analyst`, `read_only`) не получают **ни textarea, ни submit, ни disabled-контрола** —
вместо формы спокойная строка «Ваша роль не может добавлять заметки» (D-59). **Список заметок виден
всем девяти ролям:** чтение — это «View User 360», другое право. Матрица не расширялась.

### Композер

Inline, не dialog и не sheet (D-59): новая заметка сортируется наверх, поэтому композер над списком
держит результат рядом с местом ввода. На мобильном свёрнут в кнопку 44 px с `aria-expanded`
(раскрытие inline, не Sheet). `maxLength` и клиентская валидация берут `NOTE_BODY_MAX_LENGTH` и
`normalizeNoteBody` из домена — литерала `2000` в UI нет. Тело хранится и рендерится как plain text.

- **Idempotency-ключ:** `` `${useId()}:${userId}:${attempt}` `` — без `Math.random`/`Date.now`/`crypto`
  и без новых зависимостей; повторяется на retry, обновляется после success и conflict; не показывается (D-61).
- **Двойной submit** не создаёт дубль: `disabled` + ref-guard в UI, replay по тому же ключу в провайдере.
- **`replayed: true`** — обычный успех: заметка существует, а рассказывать про нашу бухгалтерию незачем.
- **После успеха** — refetch, а не optimistic insert (D-60): projector владеет видимостью, провайдер — порядком.
- **Ошибки** — из локальной тотальной карты `Record<CrmErrorCode, string>`; `CrmError.message` в DOM,
  `aria-label`, `title` и консоль не попадает (D-62). В тексте ошибки нет тела заметки, PII, сумм,
  ключа, employee id и storage-ключа.
- **Success** — спокойная строка `role="status"` внутри секции, без toast и без таймера исчезновения.
  Фокус возвращается в textarea.

### Закрепление заметки (Phase 1B4-D)

У каждой видимой заметки — компактный контрол закрепления/открепления (`use-set-note-pinned.ts`,
`lib/note-pin-error.ts`). Только для четырёх ролей с `edit_user_notes` (D-75, то же право, что и добавление);
пяти остальным контрол **не рендерится** — ни активный, ни disabled, ни скрытый (D-59). Заметки они
по-прежнему видят.

- **Настоящая кнопка**, accessible name — полная инструкция («Закрепить заметку»/«Открепить заметку»), не
  pin-глиф; `aria-pressed` отражает состояние; ≥44×44; клавиатура (Enter/Space); focus-visible. Закреплённая
  заметка — спокойный бейдж «Закреплено» (info-тон), без toast, красного и glow.
- **Команда — конечное состояние** `pinned` + `expectedPinned` (D-78): `pinned === expectedPinned` →
  `invalid_input`; рассинхрон → `conflict` (перечитать, показать актуальное, «Состояние заметки уже
  изменилось. Показаны актуальные данные.»). Любая **видимая** заметка pinnable; скрытая → `not_found`
  через тот же projector (D-76).
- **Никакого optimistic update** (D-79): success/conflict → refetch `getUserNotes`; порядок реально меняется
  (закреплённая всплывает наверх — `sortNotes` владеет порядком). Storage failure список не трогает, retry —
  тем же ключом. Idempotency-ключ `` `${useId()}:${userId}:${noteId}:${attempt}` `` — те же правила, что у
  композера, не рендерится.
- **Фокус** после settled refetch возвращается на контрол **той же** заметки по `note.id`, даже если она
  всплыла наверх (D-81). Смена роли очищает pending/success/error и сбрасывает attempt.
- **Ошибки** — из локальной тотальной `Record<CrmErrorCode, string>` (`note-pin-error.ts`); `CrmError.message`,
  note id, audit id, employee id и storage-ключ в DOM не попадают (D-62). Pin не влияет на
  Today/Users/priority/SLA/owner/tasks/cases (D-80).

### Редактирование тела заметки (Phase 1B4-E)

У **собственной authored-заметки** (не фикстурной, не чужой) появляется контрол «Изменить» — inline-редактор
внутри строки (`use-update-note-body.ts`, `lib/note-edit-error.ts`). Возможность решает **провайдер**: секция
читает `getUserNotesView`, каждый `CrmNoteListItem` несёт `capabilities.canEditBody`; React не разбирает id
заметки (D-82). `canEditBody = canEditUserNotes(role) && (заметка в overlay notes[]) && видима && автор ==
текущий actor`. У фикстурной и чужой заметки контрола нет; пяти ролям без права — тоже (D-59).

- **Inline-редактор** (не Dialog/Sheet/toast, D-59, как композер): тело заменяется labelled textarea
  «Новый текст заметки» (отличается от композерного «Текст заметки»), счётчик символов, «Сохранить»/«Отменить».
  Pin-контрол строки на время правки скрыт; одновременно правится только одна заметка.
- **Save задизейблен** при пустом/слишком длинном/**неизменном** нормализованном черновике (провайдер всё равно
  отвергает защитно). Escape отменяет.
- **Конкуренция `expectedUpdatedAt`** (D-83): правка реально переписывает тело в overlay `notes[]` (только
  `body`+`updatedAt`), поэтому `updatedAt` — настоящий version-токен; чужая правка в промежутке → `conflict`,
  редактор закрывается, список перечитывается, показывается актуальный текст и спокойное «Заметка уже изменена.
  Показан актуальный текст.».
- **Никакого optimistic update** (D-85, как D-79): success/conflict → refetch `getUserNotesView`. Storage
  failure сохраняет черновик для retry тем же ключом; `internal`/`invalid_input`/`upstream` держат редактор
  открытым. Idempotency-ключ `` `${useId()}:${userId}:${noteId}:${attempt}` `` не рендерится.
- **Фокус** возвращается на «Изменить» **той же** заметки после save/cancel/conflict (по `note.id`). Смена роли
  сбрасывает черновик, чистит сообщения и attempt, рефетчит под новой проекцией.
- **Результат/audit/receipt без тела** (D-84): `UpdateNoteBodyResult` не содержит `CrmNote`/тела; audit
  `note_body_changed` — только факт; ошибки из тотальной `Record<CrmErrorCode,string>` (`note-edit-error.ts`),
  `CrmError.message`, id, ключи и тело в DOM не попадают. Правка не влияет на pin/порядок/видимость/Today/owner.

### «Только просмотр» остаётся честным

Рекомендации по-прежнему не имеют контрола выполнения, и пометка «Только просмотр» на них не изменилась:
на экране появились ровно **четыре** мутации — добавление заметки, owner, закрепление и редактирование тела
заметки, — и все они действительно работают. Fake success не создан.

## Non-scope (Phase 1C-A)

Редактирование пользователя, tasks/cases mutations, смена owner/статуса, ручное закрытие
сигналов, финансовые операции, коммуникации, отправка email, mentor chat, полный PII reveal-flow,
полный финансовый history, backend/API/database/Prisma/Pocket, production auth, deploy. См. D-34.

**Обновлено:** Today workspace (Phase 1B3) и mutation core (Phase 1B4-A) с тех пор выполнены — оба
не изменили этот экран. **Phase 1B4-B** добавил секцию «Заметки» (D-58…D-63); **Phase 1B4-C** добавил
назначение primary owner в секции «Ответственный и работа» (D-64…D-74); **1B4-D/1B4-E** — pin/unpin и
редактирование тела заметки; **Phase 1B5-C** — смену видимости заметки team ↔ private (D-91…D-95);
**Phase 1B6** — удаление заметки (D-96…D-101). Не начаты: создание `role_restricted`, tasks/cases, task/case
assignees, смена статуса, закрытие сигналов, выполнение рекомендаций, кнопка сброса overlay, backend.

**Смена видимости (Phase 1B5-C).** В секции «Заметки» автор своей overlay-заметки (право `edit_user_notes`)
меняет её видимость `team ↔ private` через inline visibility-editor (контрол-«щит», отдельный от pencil/pin;
один редактор на строку). `private` — по **identity автора**, не по роли (D-92): смена роли при том же
`actorEmployeeId` не скрывает свою private-заметку, а другой сотрудник (включая admin) её не видит.
`role_restricted` не создаётся (D-91). Возможность отдаётся провайдером через
`getUserNotesView.capabilities.canChangeVisibility`.

**Удаление (Phase 1B6).** В секции «Заметки» автор своей overlay-заметки (право `edit_user_notes`) удаляет её
через отдельный destructive Trash-контрол (нейтральный в idle, отличим от pencil/shield/pin) → inline confirm
в строке («Удалить заметку?», «Действие нельзя отменить. История изменения останется в Audit.»,
«Отменить»/«Удалить»; destructive-тон только в confirm; один active mode на строку). Это **hard delete**
(D-96): заметка физически уходит из overlay `notes[]`, тело не сохраняется, undo нет; append-only `note_deleted`
audit — защитный источник истины отсутствия (D-97). Границы как у edit: фикстурная → `invalid_input`, чужая
видимая → `unauthorized`, скрытая/неизвестная → `not_found`; private удаляется автором по тем же правилам.
После успеха строка исчезает (canonical refetch, `page.total`−1), спокойное «Заметка удалена», фокус → composer.
Возможность отдаётся провайдером через `getUserNotesView.capabilities.canDelete`; `/audit` показывает
`note_deleted` фактом «удалил заметку у …», без тела/id (D-99).

**Audit (Phase 1B5-B).** Глобальный Audit Workspace реализован отдельным экраном `/audit` (read-only,
`getAuditRecords`, gated `canViewAudit`), НЕ как preview внутри User 360. Limited audit-preview по своим
пользователям/действиям в User 360 остаётся будущей фазой (D-90/D-95) — в профиль ничего не добавлено;
`/audit` показывает `note_visibility_changed` фактом, без направления team/private (D-94).

_Связано: DATA_PROVIDER_CONTRACT.md, ROLE_PERMISSION_MATRIX.md, PII_ACCESS_POLICY.md,
CRM_INFORMATION_ARCHITECTURE.md §5, MUTATION_OVERLAY.md, DECISIONS.md (D-34…D-38, D-53…D-57),
ARCHITECTURE.md._
