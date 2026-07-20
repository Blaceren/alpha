# CRM_RUNTIME_SECURITY_BASELINE.md — принятый runtime и его security-обоснование

Зафиксировано срезом «DEV CRM Security Upgrade Slice 1». Документ описывает, на чём
CRM работает после апгрейда и почему именно на этом.

## Принятый runtime

| Компонент | Версия |
| --- | --- |
| Node.js | 22.14.0 |
| npm | 10.9.2 |
| Next.js | 15.5.20 |
| React | 19.2.7 |
| React DOM | 19.2.7 |

Сопутствующие пины среза: `eslint-config-next` 15.5.20, `@types/react` 19.2.17,
`@types/react-dom` 19.2.3, `@testing-library/react` 16.3.2.

Развёртывание — self-hosted Node (`next start`), не Vercel.

## Почему ушли с Next 14.2.35

Планируемая CRM-интеграция требует внешнего rewrite на `/api/crm/v1/session`.
На 14.2.35 это было бы небезопасно, и вдобавок ветка 14.x перестала получать
патчи по ряду advisory.

- **GHSA-ggv3-7p47-pfv8** — HTTP request smuggling в rewrites (затронуто
  `>=9.5.0 <15.5.13`). Прямо блокировал будущий rewrite: пока он не закрыт,
  внешний rewrite добавлять нельзя.
- **GHSA-c4j6-fc7j-m34r** — SSRF через WebSocket upgrade (затронуто
  `>=13.4.13 <15.5.16`), высокая severity. Это дефект самого Next-сервера, а не
  rewrite-слоя: внешний прокси его **не** закрывает. Именно поэтому вариант
  «остаться на 14 и вынести rewrite на ingress» был отклонён.
- **GHSA-26hh-7cqf-hhc6** — затронуто `>=15.2.0 <15.5.18`, высокая severity.
  Опубликовано уже после того, как целью был намечен 15.5.16, и делает 15.5.16
  непригодным. Поэтому цель — **15.5.20** (голова поддерживаемой ветки
  `backport`), а не 15.5.16.

На 15.5.20 реестр advisory не возвращает ни одной записи для `next`,
`eslint-config-next`, `react` и `react-dom`.

Next 16 сознательно не выбран: он тянет Turbopack по умолчанию, удаление
`next lint`, обязательный flat config и полное удаление синхронных request API —
несоразмерный объём для security-патча при том же уровне закрытия advisory.

## Миграция async params (Next 15)

В Next 15 `params`/`searchParams` стали асинхронными. В репозитории оказался
ровно один затронутый файл:

- `src/app/(crm)/users/[id]/page.tsx` — синхронный server component переведён в
  `async`, `params` типизирован как `Promise<{ id: string }>` и разворачивается
  через `await`.

Временный синхронный путь совместимости не использовался: он логирует
предупреждения и полностью удалён в Next 16, то есть гарантировал бы повторную
переделку.

Остального переносить не потребовалось: в проекте нет route handlers, middleware,
server actions, `generateMetadata`/`generateStaticParams`, ни одного вызова
`fetch()` и ни одного обращения к `cookies()`/`headers()`/`draftMode()`. Данные
идут только через `CrmDataProvider` поверх mock-фикстур.

## Границы среза

- **Rewrite/прокси не добавлялся** в этом срезе. `next.config.mjs` побайтно не
  изменился и не содержал `rewrites`.

  > Обновление: точный rewrite `/api/crm/v1/session` добавлен позже, срезом
  > «DEV CRM Integration Slice 1», уже после того как GHSA-ggv3-7p47-pfv8 был
  > закрыт переходом на Next 15.5.20 — то есть порядок соблюдён: сначала патч,
  > затем rewrite. Подробности — в `docs/CRM_PRODUCTION_SESSION_BOUNDARY.md`.
- **Production Session Boundary отложен** — отдельная будущая фаза
  «Same-Origin Auth Proxy + Production Session Boundary».
- Интеграция `/api/crm/v1/session`, Users/Notes/Owner/Audit API и
  `ApiCrmDataProvider` в этот срез не входили.

## Остаточные находки npm audit

`npm audit --omit=dev`: 2 moderate, 0 high, 0 critical — обе записи описывают
один и тот же путь.

- **PostCSS `<8.5.10`** (GHSA-qx2v-qp2m-jg93, moderate, XSS через неэкранированный
  `</style>` при stringify) приходит транзитивно внутри
  `node_modules/next/node_modules/postcss`. Это **build-time** путь: PostCSS
  обрабатывает только первоисточники проекта — `src/styles/globals.css`,
  `src/styles/tokens.css` и Tailwind. **CRM не обрабатывает недоверенный CSS**: ни
  пользовательский ввод, ни внешние таблицы стилей в PostCSS не попадают, поэтому
  вектор в этой топологии недостижим. Запись остаётся видимой в `npm audit`, пока
  Next не поднимет вложенный PostCSS.
- Override для PostCSS **не добавлялся**: он потребовал бы отдельного
  утверждённого решения и здесь лишь маскировал бы вывод audit.

`npm audit` (полный, с dev): 8 записей — 1 critical, 1 high, 6 moderate. Всё,
кроме пути PostCSS выше, — это dev-кластер Vitest / Vite / esbuild / @vitest/mocker /
vite-node / @vitejs/plugin-react. Он **осознанно отложен** в отдельное будущее
решение: подъём Vitest до 3.2.6+ тянет за собой Vite 6 и, следовательно,
`@vitejs/plugin-react`, то есть это связанный кластер, который нельзя смешивать с
security-патчем Next. Ни одна из этих записей не достижима в production runtime:
critical-записи Vitest требуют слушающего Vitest API/UI-сервера (CI выполняет
`vitest run`, сервер не поднимается), а две из трёх записей Vite специфичны для
Windows.

`npm audit fix --force` **не применялся** и применяться не должен: он поднял бы
`next` до 16.x и `vitest` до 4.x — два непроверенных мажора одновременно.

## Команды проверки

```bash
export PATH="/home/ubuntu/workspaces/.tooling/node/bin:$PATH"

npm ci
npm run lint          # проходит; предупреждение об устаревании `next lint` ожидаемо
npm run typecheck
npm run test:run      # 50 файлов, 1155 тестов
npm run build         # 19 маршрутов
npm run test:e2e      # 156 обязательных E2E
npx playwright test --list   # 156 тестов в 13 файлах

npm ls next react react-dom eslint-config-next \
  @types/react @types/react-dom @testing-library/react --depth=0

npm audit --omit=dev
npm audit
```

`next lint` объявлен устаревшим в 15.5 и удалён в Next 16. В этом срезе он
сохранён вместе с `.eslintrc.json` и ESLint 8.57.1: `eslint-config-next` 15.5.20
по-прежнему поддерживает legacy-конфиг. Миграция на flat config отложена до
перехода на Next 16, где она неизбежна.

## Откат

- До коммита — точечный `git restore` файлов среза и `npm ci`.
- После коммита — `git revert` одного ревью-коммита и `npm ci`.
- Резервная копия: проверенный transfer bundle
  `/home/ubuntu/backups/ata-crm/2026-07-19-45cf282/`
  (`ata-crm-45cf282811273415daf498693aafb7a35cf8bb30.bundle`, checksums OK).

Разрушительные операции (`git reset --hard`, `git clean`, удаление
`package-lock.json`) для отката **не применяются**.
