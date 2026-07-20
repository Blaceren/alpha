# CRM_API_USERS_READ.md — production-режим: подключённый список пользователей

Зафиксировано срезом «Frontend CRM Users API Slice 1». Первая реальная
production-выдача данных CRM после принятой границы сессии.

## 1. Backend-контракт

Источник: `alfa-trade-academy-v2`, `docs/CRM_USERS_V1.md`,
HEAD `7a62cbf4e01a01f88d0e605ad7ae15ff7dd2f7e2`.

```
GET /api/crm/v1/users?limit=&cursor=&search=
```

- `limit` — целое 1–100, по умолчанию 25;
- `cursor` — непрозрачная строка, максимум 512 символов;
- `search` — обрезанная строка, максимум 100 символов;
- неизвестные ключи → `400 invalid_input`.

Порядок стабильный (`createdAt DESC, id DESC`), пагинация только курсорная,
заголовки `Cache-Control: no-store` и `X-Request-Id` на каждом ответе.

Реализация backend во frontend **не копировалась**. Frontend валидирует ответ
независимо: расхождение контракта или подмена прокси должны падать закрыто, а не
доезжать до экрана.

## 2. Точный rewrite

API-режим проксирует ровно два пути:

```
/api/crm/v1/session  →  ${CRM_BACKEND_ORIGIN}/api/crm/v1/session
/api/crm/v1/users    →  ${CRM_BACKEND_ORIGIN}/api/crm/v1/users
```

В mock-режиме список rewrite пустой.

Wildcard нет: ни `/api/crm/v1/:path*`, ни `/api/:path*`. Оба источника —
точные пути, поэтому `/api/crm/v1/users/123`, `/api/crm/v1/users/extra` и
`/api/crm/v1/user` **не проксируются** и отвечают 404 (проверено и unit-тестом
против настоящего конфига, и E2E в браузере). `/api/auth/*` и `/api/health`
недоступны. Cookie остаётся host-only, CORS не настраивается, секретных
заголовков нет, origin backend в браузер не попадает.

## 3. Строгий frontend-DTO

`src/data/contracts/api/users.ts`, Zod, `.strict()` на каждом уровне:

```ts
{ items: Array<{
    userId: string;                                   // непрозрачный
    displayName: string;                              // непустой после trim
    email: { value: string; visibility: "full" | "masked" };
    status: "active" | "blocked";
    level: number;                                    // целое
    emailConfirmed: boolean;
    createdAt: string;                                // ISO datetime
  }>;
  nextCursor: string | null; }
```

Отклоняются: неизвестные поля (`employeeId`, `ownerId`, `noteCount`, `balance`,
`netDeposits`, `lastMeaningfulActionAt`, `lifecycleStage`, сырые колонки
`updatedAt`/`passwordHash`/`xp`), неизвестные `status`/`visibility`, невалидная
дата, пустой `userId`, числовой `userId`, **дубликаты `userId` в одном ответе**.

`userId` остаётся строкой: он не парсится как число, не участвует в арифметике и
используется только как React-key и идентичность строки.

Ошибки: `{ code: "invalid_input" | "unauthorized" | "internal", messageKey,
requestId }`. Авторитетным остаётся статус-код; `messageKey` — это копирайт
backend, а не CRM, и пользователю не показывается никогда. Показывается только
`requestId` как код обращения.

## 4. Клиент

`src/application/api/users-client.ts` — относительный путь,
`credentials: "same-origin"`, `cache: "no-store"`, таймаут 8 с, склейка с
`AbortSignal` вызывающего. Сериализуются **только** `limit`, `cursor`, `search`;
`offset`, `page`, `sort`, `owner`, `segment`, `status`, `employeeId`, `role`,
`permissions` не сериализуются никогда.

Отображение: `200 valid → success`, `200 malformed / не-JSON → malformed_response`,
`400 → invalid_input`, `401 → unauthenticated`, `403 → forbidden`,
`5xx / сеть / таймаут → upstream_unavailable`. Ни тело ответа, ни ошибка Zod, ни
текст исключения не логируются и не рендерятся.

## 5. ApiCrmDataProvider

`src/data/api/api-crm-data-provider.ts` реализует **одну** способность —
`listUsers`. Он сознательно **не** реализует широкий `CrmDataProvider`: тот
интерфейс сформирован mock-продуктом (Today, User 360, заметки, владелец, аудит,
очереди), и «реализовать» его можно было бы только методами, которые лгут или
бросают. Сужение по способности делает недоступные операции недостижимыми на
уровне типов, а не только защищёнными в рантайме.

Дополнительно `assertApiCapability` бросает `UnsupportedApiCapability` для любой
неподдерживаемой операции — пустой список никогда не возвращается, потому что
«у пользователя нет заметок» и «заметки ещё не подключены» не должны выглядеть
одинаково.

Модуль не импортирует `MockCrmDataProvider`, не обращается к фикстурам и не
строит mock-`UserSummary` (проверяется тестом по строкам импортов).
`getCrmMutations` в API-режиме по-прежнему недоступен.

Провайдер конструируется только под подтверждённой сессией: единственный его
потребитель рендерится внутри authenticated-ветки `SessionBoundary`.

## 6. Ограниченная оболочка и маршруты

API-режим монтирует ровно один маршрут — **`/users`**.

- `/users` → `ApiShell` + production-список. В шапке: бренд ATA CRM, имя
  сотрудника, безопасная подпись роли и **один** пункт навигации «Пользователи».
- любой другой маршрут, включая **`/users/[id]`** → состояние «Раздел ещё не
  подключён» с безопасной ссылкой на `/users`.

`children` (mock-страницы) в API-режиме не рендерятся вообще, поэтому
`User360Workspace` не монтируется и запрос к несуществующему User 360 не
выполняется. `/users` сопоставляется точно, а не по префиксу — именно это
оставляет `/users/123` отложенным.

Оболочка не показывает: RoleSwitch, mock-счётчики, Today/Аудит/Финансы/Задачи/
Кейсы/Заметки/Настройки, фиктивные уведомления, `employeeId`, список разрешений,
origin backend, детали окружения.

## 7. Колонки списка

Имя · Email · Статус · Уровень · Email подтверждён · Регистрация.

`active → Активен`, `blocked → Заблокирован`,
`emailConfirmed true → Подтверждён`, `false → Не подтверждён`.
Дата — детерминированный `DD.MM.YYYY` в UTC (не зависит от локали хоста).

Нет и не будет в этом срезе: владельца, счётчика заметок, финансов, последней
активности, рекомендации, приоритета, сегмента, сортировки, mock-фильтров,
клика по строке, ссылки на User 360, **общего количества** и «страница X из Y» —
backend не отдаёт total, поэтому показывается только позиция «Страница N».

`userId` не отображается: он служит только React-key.

## 8. Поиск и разрешения

Авторитет — `session.effectivePermissions`, не роль.

- есть `view_identity_full_email` → подпись «Имя или email», email-поиск
  отправляется;
- нет → подпись «Имя», значение с `@` **не отправляется**, показывается локальное
  сообщение «Поиск по email недоступен для вашей роли». Backend остаётся
  авторитетным: локальный отказ лишь экономит round-trip и объясняет причину.

Роль `crm_admin` с пустыми `effectivePermissions` аффорданса email-поиска **не
получает** — проверено unit-тестом и E2E. Значение из localStorage
(`ata-crm.mock-role.v1`) на API-режим не влияет.

Поиск обрезается, ограничен 100 символами, пустой сбрасывает на первую страницу,
отправка сбрасывает историю курсоров. Отправка явная (submit), устаревшие ответы
не заменяют более новые (счётчик запросов + `AbortController`).

## 9. Курсорная пагинация

Только курсоры backend, размер страницы 25.

«Следующая» использует `nextCursor`; «Предыдущая» — стек курсоров в памяти
клиента (у backend нет обратного курсора). На первой странице «Предыдущая»
отключена, на последней — «Следующая». Курсор не декодируется, не логируется, не
отображается и не сохраняется в localStorage. Offset не используется. Дублирующие
параллельные запросы отсекаются.

## 10. Поведение при ошибках

| Ответ | Поведение |
| --- | --- |
| 401 | `router.replace("/login?reason=session_required")`, ранее показанные строки не остаются |
| 403 | «Нет доступа к данным CRM», опционально `requestId` |
| 400 | «Некорректный запрос», форма поиска сохраняется |
| 5xx / сеть / таймаут | «Сервис недоступен» + «Повторить» |
| malformed 200 | «Некорректный ответ сервиса», частичный рендер не выполняется |

Повтор — строго один запрос за раз. Fallback на mock отсутствует во всех случаях.

## 11. Mock-режим не изменён

`MockCrmDataProvider` по-прежнему обслуживает mock-`/users`; богатые колонки,
фильтры, сортировки, пагинация, `/users/[id]` с User 360, переключатель ролей и
localStorage-роль работают как раньше. Production-контракт **не** упрощал
mock-продукт: production-список — отдельная фича (`src/features/users-api`), а не
переписанный `UsersWorkspace`.

## 12. Тестовая топология

Настоящий backend не запускался. Используется прежний детерминированный stub на
стандартной библиотеке Node (`tests-e2e-session/support/session-stub.mjs`,
loopback `127.0.0.1:3110`), расширенный ровно на маршрут `GET /api/crm/v1/users`
с синтетическими данными. Состояние ответа выбирается тестовой cookie
`ata_test_crm_users_state`; в production-коде нет ни тестовых заголовков, ни
тестовых query-параметров. Все прочие пути отвечают 404. Ответы содержат
`Cache-Control: no-store` и `X-Request-Id`.

CRM в API-режиме — `127.0.0.1:3010`, один worker.

## 13. Команды проверки

```bash
export PATH="/home/ubuntu/workspaces/.tooling/node/bin:$PATH"

CRM_MODE=mock npm run lint
npm run typecheck
npm run test:run                    # 62 файла, 1450 тестов

npm run test:e2e:mock               # 156
npm run test:e2e:session            # 49 (20 сессия + 29 users)
npm run test:e2e                    # оба, последовательно

npx playwright test --list
npx playwright test --config=playwright.session.config.ts --list

CRM_MODE=mock npm run build
CRM_MODE=api CRM_BACKEND_ORIGIN=http://127.0.0.1:3110 npm run build

npm audit --omit=dev
npm audit
```

## 14. Откат

- До коммита — точечный `git restore` файлов среза.
- После коммита — `git revert` одного ревью-коммита.
- Резервные копии: `/home/ubuntu/backups/ata-crm/2026-07-20-fe74f37/` (текущий
  принятый HEAD), ранее — `2026-07-20-7f6cb27/` и `2026-07-19-45cf282/`.

Зависимости не менялись, `package-lock.json` не изменён, поэтому `npm ci` при
откате не требуется. Разрушительные операции (`git reset --hard`, `git clean`)
не применяются.
