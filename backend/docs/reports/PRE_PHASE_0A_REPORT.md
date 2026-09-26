Отчёт Pre-Phase 0A: Safe V2 Workspace and Git Baseline — выполнено
Alfa Trade Academy (ATA) · Сервер 57.128.213.204 · Дата: 2026-07-12

1. Какой workspace создан
/home/ubuntu/workspaces/alfa-trade-academy-v2 — путь был свободен, создан заново.

2. Исключённые категории файлов
.env и любые env-файлы с секретами (кроме .env.example), SQLite-базы (prisma/dev.db, ci-smoke.db) и журналы БД, .secure/, корневой storage/ (пользовательские uploads и вложения отчётов), node_modules/, .next/, backups/, .codex-backups/, tgz/tar.gz-архивы, логи, *.bak* (включая package.json.bak-security-*), design-memory/, а также два корневых файла legacy-заметок с не-ASCII именами (ПАМЯТЬ.md и его дубликат с битым именем).

3. Перенесённые source files
336 файлов: src/ (247), docs/ (26), prisma/ (schema, все 20 миграций, seed-скрипты — без .db), scripts/ (22), ops/, и корневые конфиги (package.json, package-lock.json, tsconfig, next/tailwind/postcss/eslint конфиги, Dockerfile, docker-compose.yml, .dockerignore, .env.example, README, CHANGELOG).
Diff структуры «источник (фильтрованный) - копия» — полное совпадение.
Нюанс по ходу: паттерн storage/ сначала зацепил исходники src/lib/storage/* — исправлено якорением исключения к корню (/storage/), файлы возвращены в копию.

4. Обнаружены ли потенциальные secrets
Приватных ключей нет. Найдены credential-подобные литералы — все классифицированы как тестовые фикстуры, а не production-секреты:
- пароли тестовых аккаунтов в scripts/smoke/mvpAcceptanceSmoke.ts (строки 461, 478, 506, 512, 535, 541);
- scripts/smoke/integrationSmoke.ts:432 (заголовок с тестовым секретом);
- scripts/smoke/pocketProgressionRegression.ts:5;
- захардкоженный дефолтный пароль сервисных пользователей в src/app/admin/users/page.tsx:109 — рекомендован отдельный security-пункт на будущее;
- демо-учётки в docs/test-accounts.md (намеренная документация закрытой беты).
.env.example содержит только placeholder-значения и boolean-флаги.

5. Подтверждение по значениям
Значения ни одного из найденных кандидатов не выводились: скан печатал только пути, идентификаторы и классификации; литералы маскировались.

6. Структура .gitignore
Заменён на полный:
- зависимости/сборка: node_modules/, .next/, coverage/, *.tsbuildinfo;
- секреты: .env, .env.* с исключением !.env.example, .secure/;
- базы: *.db, *.db-journal, *.sqlite, *.sqlite3, *-wal, *-shm;
- uploads: /storage/, uploads/;
- бэкапы и архивы: /backups/, /.codex-backups/, *.tgz, *.tar.gz, *.bak, *.bak-*;
- логи/temp: logs/, *.log, tmp/, .DS_Store, design-memory/.
Все ignore-пробы (git check-ignore) сработали корректно.

7. Git commit hash
- baseline: ac4476ba02ae30a0d4edba619a75001ee9325a16 — chore: establish sanitized ATA V2 baseline
- документы: c3b70f8655e4d0298ad87d312de115f3a0a23e49 — docs: add V2 gap analysis and product decisions (Pre-Phase 0A)
Remote не добавлялся, push не выполнялся, публичный репозиторий не создавался.

8. Git status после commit
Чистый (git status --porcelain пуст). В tracked-файлах ни .env, ни .db, ни storage, ни архивов (проверено git ls-files).

9. Созданные документы
- docs/V2_GAP_ANALYSIS.md — утверждённый gap analysis: V1-архитектура, mapping V2, отсутствующие сущности, несовместимости (включая withdrawal-баг), риски, фазы. Скорректирован по продуктовым решениям: промокод-race требует отдельного атомарного дизайна (unique нельзя), Commission — принимать без влияния на balance/XP/progression/CRM, SQLite — не блокер для закрытого тестирования.
- docs/V2_PRODUCT_DECISIONS.md — все 7 разделов: название ATA, compatibility, XP-решения (daily login XP в V2 отключён, referral XP в V2 disabled до anti-abuse, V1 не трогаем), Commission, withdrawal-семантика, balance/provider-unavailable, promocode concurrency.
Кириллица в файлах на сервере проверена — не побита.

10. Live-проект не изменён
Подтверждаю: все операции с ~/trading-mvp были только чтением; проверка find -newer по src/prisma/scripts/docs не показала изменений после копирования; git в live-папке как не было, так и нет.

11. Production DB не читалась и не копировалась
Подтверждаю: *.db исключены на уровне rsync, в workspace 0 файлов БД, содержимое баз не открывалось ни разу за задачу.

12. Docker/nginx/deploy не затрагивались
Подтверждаю: docker-сокет пользователю ubuntu недоступен (permission denied — sudo не использовался), конфигурации прокси не открывались на запись, ничего не перезапускалось.

13. Live health
/api/health возвращал 200 на портах 80, 8080 и 3100 до начала работ и те же 200 после завершения. На порту 3009 ничего не слушается (соответствует freeze-требованию). Порт 3000 не слушается — приложение живёт за прокси на 80/8080/3100; это исходное состояние, не результат работ.

14. Ничего функционально не изменено: yes
Ни одного изменения кода, БД, миграций, seed, конфигурации или runtime. Withdrawal-баг не исправлялся, Phase 1 не начиналась. Временные файлы в /tmp сервера удалены.

Следующий этап по готовности: Pre-Phase 0B — исправление withdrawal-семантики с тестами, только в новой git-копии.
