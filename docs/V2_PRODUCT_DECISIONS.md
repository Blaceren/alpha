# Alfa Trade Academy (ATA) — V2 Product Decisions

**Статус:** зафиксированные продуктовые решения перед Curriculum V2
**Дата:** 2026-07-12
**Связанный документ:** `V2_GAP_ANALYSIS.md`

---

## 1. Product name

- Официальное название продукта: **Alfa Trade Academy**.
- Сокращение: **ATA**.
- `trading-mvp` и `TradeQuest` — legacy-технические названия.
- Массовое переименование существующего кода, таблиц, task codes и routes запрещено.

## 2. Compatibility

- Curriculum V1 остаётся активным.
- Curriculum V2 создаётся параллельно как отдельная версионируемая модель.
- Existing task codes (`lvl_01_*` … `lvl_16_*`) не переименовываются.
- `Task` и `UserTaskProgress` не ломаются и не мигрируются деструктивно.
- Новые уровни получают codes формата `v2.l001.*`.
- Published Curriculum Version не редактируется задним числом; правки — через новую версию.

## 3. XP

- Базовый XP начисляется за completion обязательных уровней — это основа маршрута.
- XP не списывается.
- XP не начисляется за real/demo trades.
- XP не начисляется за deposit или потерю balance.
- Promocode XP может участвовать в достижении XP-порога (XP-gate).
- Promocode XP не обходит последовательность уровней и не обходит checkpoint.
- Daily login XP в V2 отключён: простой вход не является meaningful action.
- Referral XP в V1 пока сохраняется без изменений.
- Referral bonus в V2 — отдельный конфигурируемый источник, **выключенный по умолчанию** до anti-abuse правил.
- Legacy V1 XP history не удаляется и не переписывается; корректировки — только отдельными `migration_adjustment`-транзакциями, видимыми в audit.

## 4. Pocket Commission

- Endpoint может принимать событие `Commission` для совместимости.
- Событие не изменяет balance, XP, progression или CRM state.
- Событие не используется для персональных product actions.
- Secret не сохраняется, не логируется, не попадает в CRM.
- Партнёрская выручка может сверяться отдельно по агрегированным отчётам Pocket, вне Product OS.

## 5. Withdrawal semantics

- `New Withdrawal` = заявка на вывод. Не меняет финансовое состояние.
- `Canceled Withdrawal` = отмена заявки. Не меняет финансовое состояние и не считается депозитом.
- `Successful Withdrawal` = подтверждённый вывод. Только он участвует в финансовом учёте (уменьшает Net Deposits).
- Plain `Withdrawal` (статусное событие) не участвует в финансовых формулах до отдельного решения.
- Request/cancel не должны перезаписывать balance (текущее поведение — баг, исправляется в Pre-Phase 0B).
- Balance в идеале приходит от отдельного provider, а не вычисляется из заявок.

## 6. Balance

- Financial checkpoint проверяет **real account balance**, а не cumulative deposits.
- Demo balance игнорируется.
- Валюты приводятся к USD equivalent (правило конверсии — запросить).
- Реальный balance provider пока отсутствует (`real_placeholder` не реализован).
- Имитировать production-проверку баланса запрещено.
- `provider unavailable` должен быть отдельным явным состоянием (verification_unavailable), а не «замером ниже порога».

## 7. Promocode concurrency

- Нельзя добавлять unique `(promocodeId, userId)`, не проверив `perUserLimit`: такой констрейнт навсегда ограничит промокоды одним использованием и сломает лимиты > 1.
- Требуется отдельное атомарное решение: idempotency каждого запроса, атомарное соблюдение `perUserLimit`, защита от параллельных redemption, поддержка лимитов больше одного.
- Promocode race не исправляется «первой попавшейся уникальностью»; дизайн — отдельной задачей.

## 8. Level stableCode format (утверждено, Phase 1B.1)

- Формат stableCode уровня: `v2.l001.<slug>`.
- Всё в lowercase; номер уровня — всегда три цифры; slug — lowercase kebab-case.
- Примеры: `v2.l001.pocket-registration`, `v2.l002.tradequest-mechanics`, `v2.l010.balance-checkpoint`.
- stableCode уникален внутри CurriculumVersion (compound unique в БД).
- Тот же stableCode разрешено повторно использовать в новой CurriculumVersion (преемственность уровня между версиями).
- V1 task codes (`lvl_01_*` … `lvl_16_*`) не изменяются.
- Строгая regex-валидация формата выполняется service/Zod-слоем (Phase 1B.2+); сложный SQLite CHECK для slug не используется.
- Для одного curriculum code одновременно существует не более одной published-версии: обеспечено partial unique index в миграции + будущей service-проверкой publish.

## 9. Publication lifecycle (утверждено, Phase 1B.2)

- Публикация новой версии того же curriculum code требует явного `expectedPublishedVersionId` текущей published-версии: без него — `CURRICULUM_REPLACEMENT_REQUIRED`, при несовпадении — `CURRICULUM_REPLACEMENT_MISMATCH`.
- Старая published-версия архивируется атомарно в одной транзакции с публикацией новой; её definitions не изменяются.
- Existing users в будущей Phase 2 останутся привязаны к своей historical version (enrollment будет ссылаться на конкретную CurriculumVersion, включая archived).
- Scheduled publication пока не поддерживается.
- `effectiveFrom` в будущем блокирует непосредственный publish (`CURRICULUM_EFFECTIVE_FROM_FUTURE`).
- Archive выполняется только для published-версии; повторный archive и archive черновика — ошибка, а не тихий success.
- Published/archived версии защищены от редактирования domain-guard'ом `assertCurriculumEditable` (draft — единственное редактируемое состояние).

## 10. Enrollment and durable progress (утверждено, Phase 2B.1)

- Официальный code первой Curriculum V2 line: `ata-v2`.
- Enrollment statuses: `active | completed | superseded`.
- Одновременно допустим только один `active` enrollment на `(userId, curriculumCode)`; historical completed/superseded rows сохраняются бессрочно до отдельной retention policy.
- Обычный enrollment command в будущей фазе идемпотентно возвращает существующий active enrollment и не выполняет re-enrollment после completed.
- Переход пользователя на другую CurriculumVersion выполняется только отдельной аудируемой version-migration командой; автоматической миграции нет.
- Persisted `UserLevelProgress` statuses: `in_progress | pending_review | completed`.
- `hidden | locked | xp_eligible | available | temporarily_suspended` — вычисляемые состояния будущего resolver и не хранятся в DB enum.
- Phase 2B.1 не добавляет `currentXp`. В Phase 3 `XPTransaction` станет источником истины; cached aggregate допускается только отдельным решением Phase 3.
- `completionEvidence` остаётся nullable schema-полем, но до профильных фаз допустимо только `null`; generic arbitrary evidence writer не реализуется.
- Enrollment/progress relations используют `ON DELETE RESTRICT` и `ON UPDATE CASCADE`; физическое удаление history после начала запрещено.

---

*Документ не содержит secrets, паролей, реальных пользовательских данных и значений postback secret.*
