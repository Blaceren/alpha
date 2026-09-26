# ROUTE_MAP

Карта маршрутов Alfa Trade Academy Web V2 в канонической записи **Next.js App Router** (динамические сегменты — `[param]`). Финализируется в D1. Коды сущностей — из `CURRICULUM_AND_UNLOCKS.md` (стабильные, не локализуются).

Легенда доступа: **Auth** — только для авторизованного пользователя; **Public** — доступно без входа (SEO); **Gated** — зависит от progression/unlock.

> Route syntax: используется только `[param]` (App Router). Записи `:code` / `:id` в документации запрещены.

---

## 0. Route groups и оболочки (shells)

При реализации применяются Next.js **route groups** (не входят в URL):

- `(app)` — авторизованный продукт: единая app-оболочка (sidebar / top bar / bottom nav / rail).
- `(public)` — публичный SEO-контур `/blog`: отдельная оболочка **без** authenticated app sidebar.

Разделение оболочек — см. `INFORMATION_ARCHITECTURE.md` §7 (app/public boundary).

Прелендинг, login и registration **не создаются** внутри этого design-прототипа. Для неавторизованного пользователя продукт получает auth state от backend и перенаправляет в отдельный public/prelanding flow; собственная временная login-страница не показывается.

---

## 1. Продукт `(app)` — авторизованный контур

| Route | Страница (RU) | Доступ | Параметры / заметки |
|-------|---------------|--------|---------------------|
| `/` | Главная | Auth | контекстный дефолт входа в продукт |
| `/path` | Путь | Auth | **реализован (D2A)**: открывается на текущем уровне; dev-сценарии `?scenario=` |
| `/path/level/[levelCode]` | Уровень (деталь) | Auth · Gated | `[levelCode]` = `level.001`…`level.100`; locked → explainer |
| `/lessons` | Уроки | Auth | **реализован (D2C-B)**: библиотека уроков; выбор модуля — `?module=module.NN` (DD-263); `?scenario=` — dev/test адаптер маркера (DD-273) |
| `/lessons/[levelCode]` | Урок / **Отчёт** | Auth · Gated | **реализован (D2B)** для `video-test`-уровней: video + проверка понимания на одной странице; dev-сценарии `?scenario=`. **Report-уровень реализован здесь же (D3-B)**: `/lessons/level.003` — отчёт является самим уровнем (DD-264). Dev/test сценарий `?scenario=report` ставит пользователя на уровень 3 (DD-272); `?verdict=revision-requested` — dev/test verdict adapter D3-C (DD-291): работает только вместе с `?scenario=report`, fail closed, в пользовательских ссылках не появляется |
| `/lessons/[levelCode]/test` | Тест | Auth · Gated | **не реализуется**: проверка живёт под видео на маршруте урока (правило «видео перед тестом»). Остаётся **зарезервированным**; в D3-A намеренно не реализован и не удалён, судьба решается отдельным DD (DD-242, DD-269) |
| ~~`/reports/[reportCode]`~~ | ~~Отчёт~~ | — | **НЕ ИСПОЛЬЗУЕТСЯ (DD-264).** Отчёт — это сам curriculum-level, а не приложение к нему: уровень 3 имеет `kind: "report"`. Отдельный маршрут завёл бы **второй идентификатор** (`report.003`) для одной сущности (`level.003`) и вторую URL-схему — тот же дефект, которым DD-242 отклонил `/lessons/18`. Канонический адрес отчёта — **`/lessons/level.003`** |
| `/tools` | Инструменты | Auth | **реализован (D4-B)**: Tools Hub — operational ledger всей последовательности инструментов; unlock через канонический резолвер; `?scenario=` — dev/test адаптер маркера (DD-309). В `BUILT_ROUTES` и production navigation |
| `/tools/[toolCode]` | Инструмент | Auth · Gated | **реализован (D4-B)** для `tool.trading_journal` (browser-local workspace, DD-310) и **(D4-C)** для `tool.risk_calculator` (`/tools/tool.risk_calculator` — ручной калькулятор риска на Price Rail, без persist/fetch, DD-314). `[toolCode]` = `tool.trading_journal`…`tool.pro_workspace`, `tool.secret`. Диспетчеризация по резолву: unknown → not-found convention; locked (ниже unlock, напр. Risk ниже L15) → locked state без формы; unlocked-но-не-реализован → спокойный coming-soon без fake CTA |
| `/community` | Сообщество | Auth | список каналов + locked previews |
| `/community/[channelCode]` | Канал сообщества | Auth · Gated | `[channelCode]` = `channel.start_questions`… |
| `/community/[channelCode]/[threadId]` | Тред | Auth · Gated | сообщение + replies |
| `/news` | Новости (в продукте) | Auth | feed + «Подходит к текущему модулю» |
| `/news/[slug]` | Статья (в продукте) | Auth | related lessons, bookmark |
| `/referrals` | Рефералы | Auth | ссылка, статусы приглашённых, reward |
| `/mentor` | Ментор | Auth | активный тред / review по умолчанию |
| `/mentor/[conversationId]` | Диалог с ментором | Auth | review / feedback / защита кейса |
| `/support` | Поддержка | Auth | список тикетов; дефолт — активный |
| `/support/new` | Новый тикет | Auth | category, thread, attachments |
| `/support/[ticketId]` | Тикет | Auth | thread, статус, reopen |
| `/notifications` | Уведомления | Auth | центр уведомлений по категориям |
| `/profile` | Профиль | Auth | ранг, XP, серия обучения, открытые материалы |
| `/settings` | Настройки | Auth | уведомления, язык, приватность ранга |
| `/settings/notifications` | Настройки уведомлений | Auth | in-app / email / push, категории |

> Deep-link к конкретной записи инструмента (journal entry, strategy card, кейс) при необходимости следует той же bracket-конвенции: `/tools/[toolCode]/[entryId]`. В каноническом наборе верхнего уровня не фигурирует; вводится в D4+ по мере надобности.

---

## 2. Публичный SEO-контур `(public)` — `/blog`

| Route | Страница | Доступ | Заметки |
|-------|----------|--------|---------|
| `/blog` | Публичный блог (index) | Public | indexable |
| `/blog/[slug]` | Публичная статья | Public | автор, дата, reading time, related, SEO-метаданные, social preview, без комментариев |
| `/blog/category/[categorySlug]` | Категория | Public | фильтр по категории |
| `/blog/author/[authorSlug]` | Автор | Public | статьи автора |

- Публичные SEO-статьи — **`/blog`**. In-product Новости — **`/news`**. Контуры разделены (см. `INFORMATION_ARCHITECTURE.md` §4, §7).
- `/blog` имеет собственную оболочку без authenticated app sidebar.

---

## 3. Соглашения по кодам в маршрутах

- Уровни: `level.NNN` (001–100).
- Отчёты: **собственного кода не имеют** — отчёт является уровнем и адресуется его кодом
  (`level.003`). Код `report.NNN` **не вводится** (DD-264).
- Инструменты: `tool.<snake>` (см. tool unlock map). 19 curriculum-инструментов (L10–L100) + `tool.secret` (referral-gated).
- Каналы: `channel.<snake>`.
- Контрольные точки собственного маршрута не имеют — открываются как состояние на `/path` и на `/path/level/[levelCode]` соответствующего уровня.
- Rank-up / unlock-сцены — не маршруты, а оверлеи над Главной / Путём.

---

## 4. Redirect / контекстные дефолты

| Заход | Поведение |
|-------|-----------|
| неавторизованный пользователь | auth state от backend → редирект в public/prelanding flow (вне прототипа); собственной login-страницы нет |
| `/tools` без истории | показать «Инструменты» (hub) — **реализовано (D4-B)**: hub всегда рендерит ledger инструментов |
| `/tools` с историей | последний редактируемый инструмент — *(будущее; D4-B выбирает hub)* |
| `/support` | активный тикет, иначе список |
| `/path` | центрирование на текущем уровне |
| `/lessons` | библиотека уроков; доминирующее «Продолжить обучение» ведёт на текущий уровень (D2C-B) |
| `/lessons/level.003` после отправки отчёта | **реализовано (D3-B)**: уровень остаётся на месте в статусе `pending-review`, поля read-only; уровень 4 **не** открывается — не потому, что отчёт его запер, а потому, что уровень 3 не завершён (DD-272) |
| `/lessons/level.003` после вердикта «Нужна доработка» | **реализовано (D3-C)**: тот же маршрут, тот же отчёт — revision pass по отмеченным местам, resubmit возвращает в `pending-review`; уровень 4 закрыт тем же резолвером (DD-292) |
| `/lessons/level.003` после `?verdict=approved` (dev/test) | **реализовано (D3-D)**: терминальный `approved`; спокойный чип «Одобрено», ledger read-only, следующий шаг — контрольная точка · Уровень 4, primary CTA «Посмотреть Путь» → чистый `/path` (DD-297, DD-298) |
| `/lessons/level.003` без query при каноническом L18 c локальным approved | нейтральный archive: «Одобрено» **не** показывается, уровень не переименовывается (base-completed vs approval-induced, DD-300) |
| открытие locked `/path/level/[levelCode]` | explainer (что / почему закрыто / что нужно / что откроется), без перепрыгивания |
