# MOCK_DATA_PLAN.md — Alfa Trade Academy CRM

> Phase 0 (обновлено в Phase 0.5) · План синтетических данных. Наполняет `MockCrmDataProvider`. Покрывает все состояния 5 измерений, сигналы и сегменты.
> **Все данные — синтетические.** Никаких реальных email, trader/player ID, production-сумм и postback-секретов. Финансовые суммы вымышлены и помечены как mock.
> Статус: Draft для утверждения.
>
> **Phase 0.5:** персоны описаны 5-мерной моделью (STATE_MODEL.md); добавлены persistence-правила (D-09: immutable fixtures + localStorage overlay + Reset).

---

## 0. Принципы генерации

1. **Покрытие состояний.** Минимум 24 персоны — как минимум по одной на каждое ключевое lifecycle-состояние, сигнал и сегмент из PROJECT_CONTEXT.
2. **Детерминированность.** Фиксированный seed → воспроизводимые данные между запусками (важно для тестов и скриншотов).
3. **Реалистичные хронологии.** У каждой персоны — согласованный Timeline: события Pocket/product/employee не противоречат lifecycle и балансу.
4. **Freshness-разброс.** Часть финансовых данных намеренно stale, чтобы протестировать бейджи устаревания.
5. **Безопасные идентификаторы.** `userId` вида `usr_mock_001`; email — `masked` (`a•••@e•••.com`); `pocketPlayerRef` — непрозрачный hash-подобный `pp_mock_xxx`.
6. **Относительное время.** Все даты — относительно `now` (референс 2026-07-12), чтобы «сегодня/overdue/grace» всегда были актуальны.
7. **Разнообразие owners/ролей.** 5–6 mock-сотрудников разных ролей для проверки scope/ownership.

Mock-сотрудники: `emp_admin` (crm_admin), `emp_mgr` (crm_manager), `emp_ret1/emp_ret2` (retention_manager), `emp_men1` (mentor), `emp_sup1` (support), `emp_mod1` (moderator), `emp_an1` (analyst).

Денежные значения — в USD, minor units. Ниже суммы указаны в долларах для читаемости.

---

## 1. Каталог персон (24 обязательных + расширения)

Формат (5 измерений STATE_MODEL): **ID · имя · Lifecycle | Funding | Engagement | Value[] | Blockers[] · L/XP · balance(freshness) · signals · primary owner · сегмент**. Пустой массив = `—`.

1. **usr_mock_001 · «Nadia N.»** · `registered` | `not_available` | `not_started` | — | `pocket_registration_incomplete` · L1/XP0 · — · `registration_no_start` · unassigned · «зарегистрировался, но не начал».
2. **usr_mock_002 · «Boris P.»** · `registered` | `not_available` | `not_started` | — | `pocket_registration_incomplete` · L1/XP20 · — · `pocket_registration_incomplete` · emp_ret1 · «не подключил Pocket».
3. **usr_mock_003 · «Vera K.»** · `pocket_registered` | `unfunded` | `active` | — | `email_unconfirmed` · L2/XP40 · — · `email_not_confirmed` · unassigned · «email не подтверждён».
4. **usr_mock_004 · «Grigori S.»** · `pre_ftd` | `unfunded` | `active` | — | — · L3/XP80 · $0 (fresh) · `checkpoint_approaching` (L4=$50) · emp_ret1 · «Pocket registered без FTD».
5. **usr_mock_005 · «Lena M.»** · `active` | `funded` | `active` | — | — · L5/XP260 · $60 (fresh) · — · emp_ret2 · базовый активный ученик.
6. **usr_mock_006 · «Timur A.»** · `active` | `funded` | `active` | — | — · L6/XP300 · $70 (fresh) · `lesson_abandoned` (урок L6 брошен 2 дня) · emp_ret2 · «остановился на уроке».
7. **usr_mock_007 · «Olga D.»** · `active` | `funded` | `active` | — | — · L7/XP330 · $80 (fresh) · `repeated_test_failure` (3 провала L7) · emp_men1 · «несколько провалов теста».
8. **usr_mock_008 · «Pavel R.»** · `active` | `funded` | `active` | — | `report_pending` · L8/XP360 · $90 (fresh) · `report_pending` (submitted 20ч) · emp_men1 · «report pending» + Mentor Queue.
9. **usr_mock_009 · «Irina V.»** · `at_risk` | `funded` | `progression_stalled` | — | `mentor_blocked` · L9/XP400 · $95 (fresh) · `report_rejected_no_return` (rejected 4 дня) · emp_men1 · «report rejected».
10. **usr_mock_010 · «Sergei L.»** · `active` | `funded` | `active` | — | `report_pending` · L8/XP370 · $85 (fresh) · `mentor_sla_risk` (ждёт 20ч, SLA 24ч) · emp_men1 · Mentor SLA risk.
11. **usr_mock_011 · «Maria T.»** · `active` | `funded` | `active` | — | — · L9/XP420 · $88 (fresh) · `checkpoint_approaching` (L10=$100, −$12) · emp_ret1 · «приближается к checkpoint».
12. **usr_mock_012 · «Denis F.»** · `at_risk` | `checkpoint_grace` | `active` | — | — · L10/XP450 · $82 (fresh, 2 подтверждения <$100) · `checkpoint_grace_active` (grace +24ч, сделок нет) · emp_ret1 · «checkpoint grace».
13. **usr_mock_013 · «Alina Zh.»** · `at_risk` | `financial_access_suspended` | `active` | — | — · L10/XP460 · $70 (fresh) · `financial_access_suspended` (grace истёк) · emp_ret1 · «financial access suspended».
14. **usr_mock_014 · «Roman B.»** · `active` | `funded` | `active` | `first_depositor`,`repeat_funder` | — · L11/XP500 · $130 (fresh) · история suspended→restored 1 день назад · emp_ret1 · «access restored».
15. **usr_mock_015 · «Kira E.»** · `first_depositor` | `funded` | `active` | `first_depositor` | — · L4/XP180 · $55 (fresh) · FTD $55 сегодня (new FTD в Today) · emp_ret2 · «первый депозит / new FTD».
16. **usr_mock_016 · «Anton G.»** · `active` | `funded` | `active` | `first_depositor`,`repeat_funder` | — · L14/XP640 · $220 (fresh) · redepositCount 2, net $210 · emp_ret2 · «repeat funder».
17. **usr_mock_017 · «Yulia S.»** · `active` | `funded` | `active` | `repeat_funder`,`frequent_repeat_funder`,`high_value_candidate` | — · L20/XP900 · $520 (fresh) · redepositCount 6, `frequent_redeposit_pattern` · emp_mgr · «frequent repeat funder».
18. **usr_mock_018 · «Egor K.»** · `at_risk` | `funded` | `inactive_3d` | — | — · L7/XP340 · $80 (2д stale) · `inactive_3_days`, `progression_stalled` · emp_ret2 · «inactive 3d».
19. **usr_mock_019 · «Sofia M.»** · `at_risk` | `funded` | `inactive_7d` | — | — · L6/XP300 · $75 (6д stale) · `inactive_7_days` · emp_ret2 · «inactive 7d».
20. **usr_mock_020 · «Viktor P.»** · `dormant` | `balance_unknown` | `dormant_14d` | — | — · L5/XP250 · $60 (14д stale) · `dormant_14_days`, `balance_data_stale` · unassigned · «inactive 14d».
21. **usr_mock_021 · «Dana R.»** · `dormant` | `balance_unknown` | `dormant_30d` | — | — · L4/XP190 · $50 (31д stale) · `dormant_30_days`, `balance_data_stale` · unassigned · «inactive 30d».
22. **usr_mock_022 · «Marat I.»** · `reactivated` | `funded` | `returned` | — | — · L8/XP360 · $95 (fresh) · `returned_after_absence` (после 20 дней) · emp_ret1 · «returned user».
23. **usr_mock_023 · «Nina Kh.»** · `at_risk` | `funded` | `active` | — | `support_blocked` · L9/XP410 · $90 (fresh) · `support_blocked` (support case: верификация) · emp_sup1 · «support blocked» + Support Queue.
24. **usr_mock_024 · «Ilya V.»** · `active` | `funded` | `active` | — | `communication_fatigue` · L12/XP540 · $160 (fresh) · `communication_fatigue` (4 сообщения за 3 дня) · emp_ret2 · «communication fatigue».

### Расширенные персоны (для полноты сценариев)

25. **usr_mock_025 · «Galina T.»** · `active` | `funded` | `active` | `repeat_funder`,`high_value_candidate`,`advanced_learner` | — · L40/XP2100 · $820 (fresh) · стабильна · emp_mgr · «advanced user».
26. **usr_mock_026 · «Oleg D.»** · `completed_current_curriculum` | `funded` | `active` | `high_value_candidate`,`advanced_learner` | — · L50/XP3200 · $1 600 (fresh) · checkpoint `future_checkpoint_not_defined` (D-10) · emp_mgr · «completed current curriculum».
27. **usr_mock_027 · «Rita S.»** · `active` | `funded` | `active` | `repeat_funder` | `financial_data_conflict` · L15/XP700 · $150 (fresh; продукт $150 / Pocket $135) · `pocket_data_conflict` · emp_ret1 · триггер `financial_data_conflict` case + Financial Ops.
28. **usr_mock_028 · «Kostya M.»** · `at_risk` | `checkpoint_grace` | `active` | `first_depositor`,`repeat_funder`,`high_value_candidate` | `financial_data_conflict` · L20/XP950 · $180 (fresh, было $320) · `rapid_balance_decline`; открытые сделки → grace отложен · emp_ret1 · edge-case grace с открытыми сделками.
29. **usr_mock_029 · «Anna B.»** · `active` | `funded` | `active` | — | — · L11/XP520 · $140 (fresh) · открыт moderation case · emp_mod1 · community/moderation.
30. **usr_mock_030 · «Pavel Z.»** · `registered` | `not_available` | `not_started` | — | `pocket_registration_incomplete` · L3/XP90 · — · открыт identity case (несоответствие данных) · emp_sup1 · identity edge-case.

> Каждая персона выражена пятью независимыми измерениями. Пример совмещения (028): `at_risk` + `checkpoint_grace` + `active` + 3 value-тега + `financial_data_conflict` — прежняя mega-enum-модель потеряла бы всё, кроме одного.

---

## 2. Сводка покрытия

| Требуемое состояние (из §19 контекста) | Персона |
|---|---|
| новый пользователь | 001 |
| Pocket pending | 002 |
| email unconfirmed | 003 |
| pre-FTD | 004 |
| active learner | 005, 006 |
| test failure | 007 |
| report pending | 008 |
| report rejected | 009 |
| mentor SLA risk | 010 |
| checkpoint approaching | 011 |
| checkpoint grace | 012, 028 |
| suspended access | 013 |
| access restored | 014 |
| first depositor | 015 |
| repeat funder | 016 |
| frequent repeat funder | 017 |
| inactive 3d | 018 |
| inactive 7d | 019 |
| dormant 14d | 020 |
| dormant 30d | 021 |
| returned | 022 |
| support blocked | 023 |
| communication fatigue | 024 |
| advanced user | 025 |
| completed current curriculum | 026 |
| Pocket data conflict (доп.) | 027 |
| rapid balance decline (доп.) | 028 |
| moderation (доп.) | 029 |
| identity (доп.) | 030 |

Все 24 обязательных состояния покрыты; 6 дополнительных персон закрывают edge-cases (conflict, decline, moderation, identity, advanced, completed).

---

## 3. Наполнение по сущностям

- **Tasks (~40):** у 001, 004, 008–013, 015, 022, 023, 027, 028 — открытые/overdue/waiting; часть с `followUpAt`; источники manual/automation/signal.
- **Cases (~10):** mentor (009), support (023), checkpoint (013), financial_data_conflict (027), moderation (029), identity (030), retention (018/019), safety (1 синтетический), pocket_connection (002), communication (024).
- **Notes (~25):** по 0–3 на активные персоны; часть pinned; примеры private/role_restricted.
- **Signals:** как в каталоге; с `evidence`, `createdAt`, `expiresAt`, severity, статусами (несколько expired/resolved для истории).
- **Timeline:** у каждой персоны 8–30 нормализованных событий из всех источников (product/pocket/employee/communication/automation/lifecycle/signal/task/case).
- **CommunicationRecords:** у 024 — 4+ за 3 дня (fatigue); у остальных — 0–2; часть suppressed.
- **AutomationRuns (~15):** примеры `executed`, `skipped_cooldown`, `skipped_exclusion`, `signal_only`.
- **AuditRecords:** на каждое mock-действие, все `mock: true`.
- **Segments:** системные сегменты из IA §8, каждый с непустым составом (гарантируется распределением персон выше).
- **Financial Ops:** approaching (011), grace (012, 028), suspended (013), restored (014), conflicts (027); агрегаты Net/Gross/Redeposit по всей базе.

---

## 4. Пограничные и негативные состояния (для тестов UI)

- **Stale финансы:** 018–021, 027 — проверка бейджей freshness/`balance_data_stale`.
- **Empty states:** новый сотрудник без назначенных пользователей → пустой Today (scope=own).
- **Conflict:** 027 → `conflict` из `getUserById`/Financial Ops.
- **Grace с открытыми сделками:** 028 → решение отложено, таймер + предупреждение.
- **Unassigned:** 001, 003, 020, 021 → фильтр owner=unassigned.
- **Masked финансы:** при роли mentor/support/read_only все суммы отображаются как диапазоны/скрыты.

---

## 5. Технические заметки по mock и persistence (DECISIONS D-09)

- **Immutable fixtures:** исходные 30 персон — статические TS/JSON, **неизменяемы**; детерминированный генератор относительного времени `resolveRelative(now)`.
- **localStorage mutation overlay:** пользовательские мутации демо (notes, mock tasks, mock cases, owner changes, saved views, preferences, mock audit records) хранятся отдельным overlay поверх фикстур; исходные данные не мутируются.
- **schemaVersion + Reset:** overlay имеет `schemaVersion` для безопасного сброса несовместимых данных; кнопка **Reset mock environment** очищает overlay. **Никакого SQLite/Prisma/database.**
- `MockCrmDataProvider` реализует полный `CrmDataProvider` (пагинация курсором, фильтры по 5 измерениям, сорт, искусственные `loading`/`stale`/`error`), применяя overlay поверх фикстур на чтение.
- **Финансовые бакеты/PII:** provider маскирует суммы в бакеты (D-07) и email (D-11) по роли до отдачи; несколько персон в каждом бакете для проверки UI.
- Ни одно значение не является production-данными; заголовок фикстур `// SYNTHETIC MOCK DATA — NOT PRODUCTION`.

---

_Связано: CRM_DOMAIN_MODEL.md (структуры), DATA_PROVIDER_CONTRACT.md (что возвращает mock), CRM_INFORMATION_ARCHITECTURE.md (где отображается)._
