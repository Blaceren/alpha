# ROUTE_MAP

Карта маршрутов Alfa Trade Academy Web V2. Provisional — финализируется в D1. Коды сущностей — из `CURRICULUM_AND_UNLOCKS.md` (стабильные, не локализуются).

Легенда доступа: **Auth** — требуется вход; **Public** — доступно без входа (SEO); **Gated** — зависит от progression/unlock.

---

## 1. App (authorized)

| Route | Страница | Доступ | Параметры / заметки |
|-------|----------|--------|---------------------|
| `/` | Главная | Auth | Редирект по контексту не требуется — это дефолт |
| `/path` | Путь | Auth | Открывается на текущем уровне |
| `/path/level/:levelCode` | Level detail | Auth · Gated | `:levelCode` = `level.001`…`level.100`; locked показывает explainer |
| `/lessons` | Уроки (библиотека) | Auth | Список открытых уроков |
| `/lessons/:levelCode` | Урок | Auth · Gated | video+test+related tool |
| `/lessons/:levelCode/test` | Тест | Auth · Gated | доступен после 50% видео |
| `/reports/:reportCode` | Report | Auth · Gated | `:reportCode` привязан к level (напр. `report.003`) |
| `/tools` | Tools Hub | Auth | Дефолт — последний редактируемый инструмент |
| `/tools/:toolCode` | Tool | Auth · Gated | `:toolCode` = `tool.trading_journal`… `tool.pro_workspace`, `tool.secret` |
| `/tools/:toolCode/:entryId` | Tool entry | Auth · Gated | конкретная запись (journal entry, strategy card, case…) |
| `/community` | Community | Auth | Список каналов + locked previews |
| `/community/:channelCode` | Channel | Auth · Gated | `:channelCode` = `channel.start_questions`… |
| `/community/:channelCode/:threadId` | Thread | Auth · Gated | сообщение + replies |
| `/news` | Новости (in-product) | Auth | feed + «Подходит к текущему модулю» |
| `/news/:slug` | Статья (in-product view) | Auth | related lessons, bookmark |
| `/referral` | Реферальная программа | Auth | ссылка, статусы приглашённых, secret reward |
| `/mentor` | Mentor | Auth | активный тред/review по умолчанию |
| `/mentor/:threadId` | Mentor thread | Auth | review/feedback/case defense |
| `/support` | Support (Ticket Center) | Auth | список тикетов; дефолт — активный |
| `/support/new` | Create ticket | Auth | category, thread, attachments |
| `/support/:ticketId` | Ticket | Auth | thread, статус, reopen |
| `/notifications` | Notifications | Auth | центр уведомлений по категориям |
| `/profile` | Профиль | Auth | rank, XP, серия обучения, открытые материалы |
| `/settings` | Настройки | Auth | notifications prefs, язык, приватность rank |
| `/settings/notifications` | Настройки уведомлений | Auth | in-app/email/push, категории |

---

## 2. Public (SEO)

| Route | Страница | Доступ | Заметки |
|-------|----------|--------|---------|
| `/blog` (provisional) | Публичный News index | Public | indexable, категории |
| `/blog/:category` | Категория | Public | фильтр |
| `/blog/:slug` | Публичная статья | Public | автор, дата, reading time, related, SEO-метаданные, social preview, без комментариев |

> Публичный и in-product контуры разделены (см. `INFORMATION_ARCHITECTURE.md` §4). Точный публичный префикс (`/blog` vs `/news`) финализируется в D1/D7 с учётом SEO-стратегии прелендинга.

---

## 3. Auth / onboarding (provisional)

| Route | Страница | Доступ | Заметки |
|-------|----------|--------|---------|
| `/welcome` | Первое знакомство (Alex Curie intro) | Auth (first login) | одноразовый onboarding |
| `/onboarding/pocket` | Задача подключения Pocket (L1) | Auth · Gated | это учебный уровень, не отдельный auth-флоу |

> Регистрация/логин самого ATA-аккаунта и OAuth относятся к backend/auth-фазе; в D0 не проектируются как экраны. Ввод паролей/креденшелов — вне продуктового UI (запрет действий из safety-правил).

---

## 4. Соглашения по кодам в маршрутах

- Уровни: `level.NNN` (001–100).
- Reports: `report.NNN` (номер уровня-владельца).
- Tools: `tool.<snake>` (см. tool unlock map).
- Channels: `channel.<snake>`.
- Checkpoints не имеют собственного публичного маршрута — открываются как состояние на `/path` и в Level detail checkpoint-уровня.
- Rank-up/unlock-сцены — не маршруты, а оверлеи над Главной/Путём.

---

## 5. Redirect / контекстные дефолты

| Заход | Поведение |
|-------|-----------|
| `/tools` без истории | показать Tools Hub |
| `/tools` с историей | последний редактируемый инструмент |
| `/support` | активный ticket, иначе список |
| `/path` | центрируется на текущем уровне |
| `/lessons` | подсвечен активный урок |
| открытие locked `/path/level/:code` | explainer (что/почему закрыто/что нужно/что откроется), без перепрыгивания |
