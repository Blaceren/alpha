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
| `/path` | Путь | Auth | открывается на текущем уровне |
| `/path/level/[levelCode]` | Уровень (деталь) | Auth · Gated | `[levelCode]` = `level.001`…`level.100`; locked → explainer |
| `/lessons` | Уроки | Auth | список открытых уроков |
| `/lessons/[levelCode]` | Урок | Auth · Gated | video + тест + связанный инструмент |
| `/lessons/[levelCode]/test` | Тест | Auth · Gated | доступен после 50% видео |
| `/reports/[reportCode]` | Отчёт | Auth · Gated | `[reportCode]` привязан к уровню (напр. `report.003`) |
| `/tools` | Инструменты | Auth | дефолт — последний редактируемый инструмент |
| `/tools/[toolCode]` | Инструмент | Auth · Gated | `[toolCode]` = `tool.trading_journal`…`tool.pro_workspace`, `tool.secret` |
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
- Отчёты: `report.NNN` (номер уровня-владельца).
- Инструменты: `tool.<snake>` (см. tool unlock map). 19 curriculum-инструментов (L10–L100) + `tool.secret` (referral-gated).
- Каналы: `channel.<snake>`.
- Контрольные точки собственного маршрута не имеют — открываются как состояние на `/path` и на `/path/level/[levelCode]` соответствующего уровня.
- Rank-up / unlock-сцены — не маршруты, а оверлеи над Главной / Путём.

---

## 4. Redirect / контекстные дефолты

| Заход | Поведение |
|-------|-----------|
| неавторизованный пользователь | auth state от backend → редирект в public/prelanding flow (вне прототипа); собственной login-страницы нет |
| `/tools` без истории | показать «Инструменты» (hub) |
| `/tools` с историей | последний редактируемый инструмент |
| `/support` | активный тикет, иначе список |
| `/path` | центрирование на текущем уровне |
| `/lessons` | подсвечен активный урок |
| открытие locked `/path/level/[levelCode]` | explainer (что / почему закрыто / что нужно / что откроется), без перепрыгивания |
