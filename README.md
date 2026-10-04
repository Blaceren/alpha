# Alpha Trade Academy — монорепозиторий

Исходники всех частей продукта в том состоянии, в котором они работают на PREPROD
(`preprod.alfatrade.media`) на 2026-10-04. Собран из рабочих репозиториев VPS через
`git subtree` — история каждой части сохранена целиком, включая исходные SHA коммитов,
на которые ссылаются манифесты релизов на сервере.

| Папка | Что это | Стек | Живой коммит на PREPROD |
|---|---|---|---|
| `academy/` | Приложение ученика и публичная главная | Next.js 16 (App Router), React, Vitest, Playwright | `7d1453a` |
| `backend/` | API: сессии, учебная программа (по плану 100 уровней; опубликованы первые 30, открыты 1–14), отчёты и проверка, инструменты, новости, CRM API, партнёрский трекинг | Node 22, Express-style API, Prisma + SQLite, Zod | `f9f7602` на PREPROD = `817fd52` здесь (см. ниже) |
| `crm/` | CRM для сотрудников (ученики, наставники, поддержка, копирайтер новостей) | Next.js, Vitest, Playwright | `eabef7b` |
| `partner/` | Кабинет партнёра (аффилиат) | Next.js | `c1f0849` |
| `tooling/` | Инструменты релиза: сборка с провенансом, публикация, переключение, гейт очистки, записи очисток | bash + tests | — (источник `0c4a0f2`) |
| `deploy/` | Шаблоны для сервера PROD: systemd-юниты и таймер бэкапа, конфиг nginx, проверенный скрипт бэкапа SQLite, образцы env-файлов (имена переменных, без значений) | — | — |
| `docs/DEPLOY_AWS.md` | **Руководство по развёртыванию на AWS** для инженера: аккаунт, хост, DNS/TLS, конфигурация, база, первый релиз, бэкапы, Pocket, почта (Amazon SES), видео, откат | — | — |

## Требования

- Node **22.14.x**, npm 10.9 (`engines` в каждом `package.json`).
- SQLite (бэкенд хранит данные в одном файле, миграции — Prisma).
- Ни один `.env` в репозитории не лежит и лежать не должен. Образцы: `backend/.env.example`,
  `crm/.env.example`. Переменные академии: `ACADEMY_MODE` (`api` | `fixture`), `BACKEND_ORIGIN`,
  `ATA_MEDIA_ROOT` (каталог видео уроков и фильма главной, см. `docs/DEPLOY_AWS.md`, раздел 14),
  `ACADEMY_SEARCH_INDEXING` + `ACADEMY_PUBLIC_ORIGIN` (индексация публичной главной — только на PROD).

## Быстрый старт (локально)

```bash
# бэкенд
cd backend && npm ci && cp .env.example .env   # заполнить SESSION_SECRET, POSTBACK_SECRET, DATABASE_URL
npm run prisma:generate && npm run prisma:migrate && npm run dev     # порт см. в backend/README.md

# академия — против локального бэкенда
cd academy && npm ci
ACADEMY_MODE=api BACKEND_ORIGIN=http://127.0.0.1:3100 npm run dev

# CRM и партнёрский кабинет
cd crm && npm ci && cp .env.example .env && npm run dev
cd partner && npm ci && npm run dev
```

Порты на PREPROD (loopback за nginx): академия 3050, бэкенд 3100, CRM 3010, партнёр 3110.

## Проверки перед любым релизом

- `academy`: `npm run lint`, `npm run typecheck`, `npm run test:run` (≈ 3 250 тестов, в том числе
  «стражи» публичной главной, индексации, навигации и прав).
- `backend`: `npm run lint`, `tsc`, регрессии `npm run test:regression:<имя>` (список — в `package.json`;
  для инструментов и новостей: `tool-*`, `news-calendar`, `crm-*`).
- `crm`: `npm run lint`, `npm run typecheck`, `npm run test:run`.
- UI не считается готовым без реальных снимков браузера на 1440 / 1024 / 768 / 390 —
  протокол в `academy/docs/SCREENSHOT_QA_PROTOCOL.md`, результаты в `academy/design-memory/`.

## Где что читать

- `academy/CLAUDE.md` — правила проекта: терминология, финансовая приватность (никаких балансов
  и сумм ученика), два визуальных режима, обязательный порядок работы над UI.
- `academy/docs/DESIGN_DECISIONS.md` — журнал решений (DD-001 … DD-345): единственный источник
  правды о том, почему продукт устроен так; новое решение — новая запись, старые не переписываются.
- `academy/docs/` — архитектура, карта маршрутов, состояния, дизайн-система, план внедрения.
- `backend/docs/` — `PREPROD_OPERATIONS_RUNBOOK.md`, `RELEASE_ARTIFACT_CONTENTS.md`,
  `RELEASE_RETENTION.md`, документация CRM (`CRM_*.md`), учебная программа и авторинг;
  `PROGRAM_30_LEVELS.md` — действующая программа из 30 уровней: источник, активация, видео уроков.
- `tooling/README.md` — почему инструменты релиза живут отдельно и как они устроены.

## Релиз на сервере (как это делается сейчас)

Релиз всегда идёт из рабочего репозитория на VPS, от конкретного коммита:

```bash
tools/build-release.sh <academy|backend|crm|partner>          # сборка, BUILD_ID привязан к коммиту и дереву
sudo tools/publish-release.sh <component> <commit> <tree>       # публикация в /srv/ata/releases/<component>/<commit>
sudo tools/cutover.sh <component> <commit> <BUILD_ID>           # переключение симлинка /srv/ata/current + проверка юнита
```

Каждое переключение печатает точку отката — предыдущий релиз; откат — тот же `cutover.sh` на неё.
Старые релизы удаляются только по вердикту `tools/prune-release.sh` (он ничего не удаляет сам)
и с записью в `tooling/prune-records/`. Бэкенд с миграцией — только после бэкапа базы
(`npm run db:backup`), CRM переключается раньше бэкенда, если меняется контракт прав.

## Как работать с монорепозиторием

- **История бэкенда переписана без кэша сборки.** 14.08.2026 в бэкенд попали четыре файла
  `.next-cache-seed/webpack/*` по 55–150 МБ; GitHub такие файлы не принимает. Из истории они
  убраны (`git filter-branch --index-filter 'git rm -r --cached .next-cache-seed'`), поэтому SHA
  коммитов бэкенда отличаются от манифестов на PREPROD. Каждая синхронизация переносит новые
  коммиты бэкенда на очищенную историю, и **дерево каждого перенесённого коммита совпадает с
  оригиналом** (проверяется tree-hash): живой `f9f7602` = `817fd52` здесь (до 04.10.2026:
  `d82935a` = `e37d269`). Сверх дерева сервера в `backend/` лежат только правки, сделанные прямо
  в монорепозитории 27.09.2026: два локальных помощника `scripts/local/` и порядок `@import` в
  `src/app/globals.css`. У академии, CRM, партнёра и tooling SHA совпадают с серверными.
- Ветки-источники на VPS: `academy`, `backend` и `crm` — `launch/v1`, `partner` — `rename/alpha-v1`,
  `tooling` — `fix/fe8-partner-rewrite-gate`. Ветки других фаз в монорепозиторий не переносились:
  их коммиты входят в историю живых веток там, где были слиты.
- Изменения в подпапке можно вернуть в репозиторий VPS через `git subtree split --prefix=<папка>`
  или, проще, вести работу прямо на VPS и синхронизировать сюда `git subtree pull/push`.
- Чего здесь нет намеренно: базы данных и бэкапы, загрузки пользователей, `.env`, `node_modules`,
  сборки `.next`, операционные журналы аудитов (`~/audits` на VPS).
- Секреты: в коде их нет; константы в `backend/scripts/regression/*` и `crm/tests-e2e-atlas/*` —
  синтетические значения изолированных e2e-стендов, они не совпадают ни с одним значением PREPROD.
