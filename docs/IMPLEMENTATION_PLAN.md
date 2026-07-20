# IMPLEMENTATION_PLAN

Пофазный план реализации Alfa Trade Academy Web V2. Реализация — маленькими этапами (Linear-принцип). Каждая фаза: scope · non-scope · dependencies · acceptance · screenshots · tests · risks · stop condition.

> D0 — текущая фаза (только документация). Последующие фазы **не начинать** без явного запроса. UI-фазы обязаны проходить `SCREENSHOT_QA_PROTOCOL.md`.

---

## D0 — Documentation & decision lock (текущая)

- **Scope:** канонизировать curriculum; заполнить CLAUDE.md и docs/*; создать design brief; зафиксировать решения; provisional токены; consistency validation; git init + первый commit.
- **Non-scope:** package.json, src/, приложение, зависимости, UI, backend, CRM, Prisma, Pocket, production API, deploy.
- **Dependencies:** `les-prog.txt`.
- **Acceptance:** все документы созданы/заполнены; curriculum consistent (100/20/thresholds/tools); нет legacy-названия в пользовательских текстах; brief полный.
- **Screenshots:** нет (приложения нет).
- **Tests:** consistency validation по чек-листу (см. `IMPLEMENTATION_STATUS.md`).
- **Risks:** выдуманные значения токенов/палитры (митигируется provisional-статусом).
- **Stop condition:** документация завершена, commit создан, отчёт выдан. Не начинать D1.

## D1 — Foundation

- **Scope:** Next.js foundation; semantic tokens (provisional); базовые компоненты (primitives, layout shell, overlays); маршруты-каркас (`ROUTE_MAP.md`); mock data provider; dark-only тема; шрифты provisional.
- **Non-scope:** реальный backend, CRM, Pocket, БД; финальная палитра; бизнес-логика прогресса.
- **Dependencies:** D0.
- **Acceptance:** app shell (sidebar/top bar/bottom nav/rail) рендерится во всех размерах; токены применяются; роуты открываются с mock-провайдером; нет horizontal overflow.
- **Screenshots:** app shell в 1440×900 / 1024×768 / 390×844.
- **Tests:** сборка; линт; базовый рендер роутов; проверка «нет хардкод-HEX».
- **Risks:** преждевременная фиксация палитры; раздувание компонентов.
- **Stop condition:** foundation + shell + mock provider готовы, QA-скрин пройден.

## D2 — Главная и Путь

- **Scope:** Главная (приоритет primary CTA, ≤6 блоков), Путь (горизонтальный, автоцентр, «К текущему уровню», node states, locked explainer, checkpoint card), emotional-режим базово.
- **Non-scope:** реальная checkpoint-верификация; уроки/тесты.
- **Dependencies:** D1.
- **Acceptance:** один primary CTA по приоритету; путь центрируется, scroll сохраняется; все node-состояния; explainer без перепрыгивания; screen-reader list-альтернатива.
- **Screenshots:** Главная + Путь + ключевые node/checkpoint состояния в 3 размерах.
- **Tests:** приоритет CTA; сохранение scroll; reduced-motion.
- **Risks:** casino-эффекты; нарушение финансовой приватности.
- **Stop condition:** QA-review закрыт (blocker/major = 0).

## D2C — Lessons Library & Module Overview (определена в D2C-A)

> Фаза получила определение позже остальных: до D2C-A «D2C» упоминался только в форме отрицания
> («D2C автоматически не начинается»). Полное определение — `docs/D2C_LESSONS_LIBRARY_SCOPE.md`.

- **Scope:** `/lessons` как самостоятельная страница (сейчас — redirect на текущий урок); доминирующее
  «Продолжить обучение»; overview текущего модуля; навигация по 20 модулям; список уровней выбранного
  модуля; статусы (завершён/текущий/доступен/закрыт последовательностью/checkpoint/practical); тип
  учебного шага; длительность **только когда реально известна**; ссылки на доступные уроки; возврат к
  завершённым; responsive desktop/tablet/mobile; 200% zoom; canonical navigation; переиспользование
  существующих curriculum fixtures и state models.
- **Non-scope:** отчёты; mentor feedback; проверка отчётов; редактор контента; CMS; отдельная test
  route; практическое задание уровня 19; backend progress; Pocket; XP-rewards; новые checkpoint rules;
  новый curriculum; поиск по продукту; AI-рекомендации; мутации; D3.
- **Dependencies:** D1B, D2A, D2B/D2B.1.
- **Acceptance:** «Уроки» отвечают на вопросы **материала**, а не **допуска** (различие с Путём —
  главный критерий); текущий урок читается за 3–5 c; структура выдерживает 20/100 без стены карточек;
  locked-уровни не доминируют; checkpoint виден как **граница модуля**, а не финансовая реклама;
  финансовая приватность (только target); прогресс/доступ читаются через существующий resolver, а не
  через новые правила.
- **Подфазы:** **D2C-A — art direction** (выполнена: scope зафиксирован, 3 направления);
  **D2C-B — implementation** (выполнена: выбран Concept B «Curriculum Index», из A перенесён только
  mobile-переключатель модуля, C отклонён — DD-261…DD-263).
- **Screenshots:** desktop 1440×900 / mobile 390×844 на каждое направление + comparison board
  1920×1080 (D2C-A); полный набор вьюпортов + 200% zoom + landscape (D2C-B).
- **Tests:** consistency с fixtures; статусы уровней; финансовая приватность; отсутствие
  horizontal overflow.
- **Risks:** дублирование Пути; «вторая Главная»; стена из 100 карточек; generic LMS.
- **Stop condition (D2C-A):** три направления предъявлены, выбор за пользователем — React не начинать.

## D3 — Report, Practical & Mentor Review Experience (переопределена в D3-A)

> **Фаза переопределена.** Прежнее определение («Урок, тест, report и mentor feedback») писалось в D0,
> когда фаз D2B и D2C не существовало. **Урок и тест реализованы в D2B** и в новый D3 **не входят**:
> два из четырёх прежних acceptance-критериев («тест открывается на 50%», «просмотр 50% не завершает
> уровень») уже закрыты и покрыты тестами (DD-249, DD-245). Полное определение —
> `docs/D3_REPORT_SCOPE.md` (DD-264…DD-270).

- **Scope (общий):** Report, Practical и Mentor review — три линии разной готовности, поэтому фаза
  разбита на этапы.
- **Non-scope (общий):** Урок и Тест (закрыты в D2B); mentor backend; support.
- **Dependencies:** D1, D2A, D2B/D2B.1, D2C.

### D3-A — Report Level Scope & Art Direction (выполнена)

- **Scope:** переопределение D3; продуктовые решения (route, pending-progression, browser-local
  storage, practical, rubric, test-route); art direction отчёта; три структурно разных направления;
  lifecycle-сравнение `pending-review`.
- **Non-scope:** production React; production route; изменение curriculum; practical; mentor backend; D3-B.
- **Acceptance:** D3 переопределён; шесть решений зафиксированы; три направления с desktop+mobile;
  pending сравнён; curriculum content не выдуман; production code не изменён; **победитель не выбран**.
- **Screenshots:** desktop 1440×900 + mobile 390×844 на каждое направление + comparison board и
  lifecycle board 1920×1080.
- **Tests:** production-тесты не запускаются (production-код не менялся).
- **Stop condition:** направления предъявлены, выбор — за пользователем. React не начинать.

### D3-B — First Report Level (выполнена)

- **Scope:** **только уровень 3** (единственный `kind: "report"`); `draft`; browser-local autosave
  (`ata.report-workspace.v1`); `submit`; `pending-review`. **Без реального mentor verdict.**
- **Non-scope:** approved/rejected/resubmitted; вложения; version history; секционные комментарии;
  practical; mentor-тред; XP за отчёт.
- **Acceptance:** черновик переживает закрытие вкладки; submit ведёт только в локальный
  `pending-review`; уровень 4 остаётся закрыт; ни одной фразы о сервере/наставнике; без countdown/avatar.
- **Risks:** фальшивый вердикт; autosave-обещание поверх ненадёжного хранилища; статус доминирует над работой.
  Два из трёх материализовались и были исправлены: блок «Перед отправкой» хардкодил «Черновик
  сохранён» и лгал при отказе записи; он же вырос до 641px и стал доминировать над ледгером
  (`design-memory/reviews/d3-b-report-review.md`).
- **Реализовано:** Concept B «Evidence Ledger» + компактный блок из C (DD-271); dev/test сценарий
  `report` при неизменном каноне (DD-272); детали — `docs/D3_REPORT_EXPERIENCE.md`.
- **Stop condition:** QA-review закрыт ✅.

### D3-C-A — Revision Requested & Resubmit Art Direction (выполнена)

- **Scope:** продуктовые решения цикла доработки (report-kind review-gated; `mentorReview` =
  practical-механика; термин «Нужна доработка»; storage v2 + контракт миграции v1→v2; dev/test
  adapter как единственный источник вердикта; минимальная форма feedback) + три структурно разных
  направления **внутри** Evidence Ledger (DD-271 не пересматривается): A «Margin Review»,
  B «Revision Pass», C «Review Contract».
- **Non-scope:** production React; изменение `src/`; approved; mentor thread; practical; version
  history; section comments; rubric/score/XP; backend; код миграции; **D3-C-B**.
- **Acceptance:** решения зафиксированы (`D3_REVISION_SCOPE.md`, DD-282…DD-288); по каждому
  направлению revision/editing/ready/mobile; один сценарий (L3, два места требуют внимания,
  provisional feedback); реальные кадры 1440×900/390×844 + доска; self-review с исправленными
  critical/major; historical evidence не тронут.
- **Stop condition:** направления предъявлены ✅ — выбор сделан пользователем: **B «Revision
  Pass»** + два элемента из A (DD-289).

### D3-C-B — Report Revision Pass (выполнена)

- **Scope:** production-реализация цикла `pending-review → revision-requested → editing →
  ready-to-resubmit → pending-review` по направлению B; storage **v2**
  (`ata.report-workspace.v2`) с односторонней миграцией v1 (DD-290); dev/test verdict adapter
  `?verdict=revision-requested` (DD-291); правило resubmit «готовность ∧ содержательное изменение»
  (DD-292); интеграция статусов в Library и Path.
- **Non-scope:** approved (D3-D); mentor thread/identity (D3-E); practical (D3-F); version
  history; section threads; rubric/score; backend; XP.
- **Acceptance:** 518 unit (441 сохранены + 77) · E2E gate 146 (120 сохранены + 26) · lint/
  typecheck/build чисто · geometry-проверки DD-281 на 390/320/720×450 · canonical L18 не понижен ·
  raw section ID не рендерятся · visual QA first-pass → final (14 кадров) без critical/major.
- **Реализовано:** `D3_REVISION_EXPERIENCE.md`, DD-289…DD-292.
- **Stop condition:** QA закрыт ✅.

### D3-D-B — Approved Report State (выполнена)

- **Scope:** production-реализация терминального перехода `pending-review → approved`; storage **v3**
  (`ata.report-workspace.v3`) с односторонней миграцией v1 → v2 → v3 (DD-296); dev/test verdict
  adapter `?verdict=approved` (DD-298); completion L3 выведена из workspace через
  `sessionWithApprovedReports` (DD-297, `ata.lesson-progress.v1` не пишется); base-completed vs
  approval-induced distinction (DD-300); интеграция в Library и Path (L3 «Завершён», DD-293).
- **Non-scope:** rejected; mentor thread/identity/avatar (D3-E); practical (D3-F); attachments;
  section comments; rubric/score; audit-history; checkpoint page; Pocket CTA; backend; XP.
- **Acceptance:** 644 unit (571 сохранены + 73) · E2E smoke gate 169 (151 сохранены + 18) · lint/
  typecheck/build чисто · geometry-проверки на 390/320/720×450 · canonical L18 не понижен · Home не
  тронут · storage failure остаётся pending · visual QA first-pass → final (10 кадров) без
  critical/major.
- **Реализовано:** `D3_APPROVED_EXPERIENCE.md`, DD-293…DD-300.
- **Stop condition:** QA закрыт ✅. **D3-E / D3-F / D4 не начаты.**

### Будущие отдельные этапы

| Этап | Содержание | Почему отдельно |
|------|-----------|-----------------|
| D3-E | Mentor feedback | требует mentor queue (OQ-4) |
| D3-F | Practical assignments | гипотеза «practical = ручной прототип инструмента» не проверена |
| D3-F ↔ D4 | связь practical с Tools | проектируется совместно, не раньше |

## D4 — Tools L10–L30

- **Scope:** Trading Journal (L10), Risk Calculator (L15), Chart Markup (L20), Indicator Checklist (L25), News Calendar (L30); ToolShell, locked preview, empty states.
- **Non-scope:** инструменты L35+.
- **Dependencies:** D1–D3.
- **Acceptance:** только manual data; Risk Calc — «сумма для расчёта»; Chart Markup по uploaded screenshot; timezone в News Calendar.
- **Screenshots:** каждый инструмент (+empty/saved) в 3 размерах, Chart Markup в landscape.
- **Tests:** autosave/versions; export chart; фильтры journal.
- **Risks:** автоподгрузка баланса; live-chart соблазн.
- **Stop condition:** QA-review закрыт.

**Разбивка D4:**
- **D4-A ✅** — Tools Scope & Trading Journal Art Direction: честный scope, states, privacy boundary, минимальный `JournalEntry`, три структурно разных направления (`D4_TOOLS_SCOPE.md`, `D4_TOOLS_ART_DIRECTION.md`, DD-301…DD-307). Production React не писался.
- **D4-B ✅** — **Tools Hub + Trading Journal (production vertical slice).** Выбранное направление «Structured Operational Spine» (hub A + journal C, DD-308). Маршруты `/tools`, `/tools/[toolCode]` в `BUILT_ROUTES`; resolver-owned unlock (DD-309); browser-local store `ata.tools.trading-journal.v1` с create/edit/list (без delete), fail-closed parser, honest save/error/corrupt states (DD-310); unlocked-but-unimplemented Risk Calculator (coming-soon, без CTA). Manual per-trade number только, без агрегатов/broker sync/XP-влияния. 14 visual-QA кадров (`design-memory/screenshots/d4-trading-journal/`), `docs/visual-reviews/D4_B_TRADING_JOURNAL.md`, `docs/TOOLS_STORAGE.md`. Vitest 649/33, mandatory e2e 177/10 (+`e2e/tools-smoke.spec.ts`).
- **D4-C ✅** — **Risk Calculator (L15), Price Rail.** Направление A+B (Price Rail доминирует, Direction B — только компактная mobile result-strip в valid, DD-314). Реализован `tool.risk_calculator` на существующем `/tools/[toolCode]` (`/tools/tool.risk_calculator`); unlock L15 через тот же resolver; для Артёма (L18) открыт, Hub CTA per-tool «Открыть калькулятор». Чистая модель `risk-calculation.ts` + `risk-format.ts` (без React/DOM/storage/fetch): формулы риска/дистанции/размера/номинала, контролируемый парсинг, дискриминированный incomplete/invalid/valid, fail-closed overflow, детерминированный RU-формат без научной нотации/`-0`/валюты. **Без persist/fetch/XP/progression write**; refresh сбрасывает всё. 15 visual-QA кадров (`design-memory/screenshots/d4-risk-calculator/`), `docs/visual-reviews/D4_C_RISK_CALCULATOR.md`. Vitest 728/35, mandatory e2e 193/11 (+`e2e/risk-calculator-smoke.spec.ts`), full discovery 311/24.
- **Остальные D4 инструменты** (Chart Markup L20, Indicator Checklist L25, News Calendar L30) — следующие slices, не начаты.

## D5 — Tools L35–L60

- **Scope:** Pause Mode (L35), Weekly Review (L40), Strategy Builder (L45), Capital Plan (L50), Market Regime Board (L55), Session Planner (L60).
- **Dependencies:** D4.
- **Acceptance:** mentor review в Strategy Builder; no-shame в Pause Mode; manual values в Capital Plan.
- **Screenshots:** каждый инструмент в 3 размерах.
- **Tests:** mentor-review pending; версии стратегий.
- **Risks:** recovery-pressure copy.
- **Stop condition:** QA-review закрыт.

## D6 — Tools L65–L100

- **Scope:** Strategy Statistics (L65), Watchlist (L70), Psychology Check-in (L75), Habit Calendar (L80), Mentor Case Room (L85), Performance Dashboard (L90), Personal Playbook (L95), Pro Workspace (L100).
- **Dependencies:** D5.
- **Acceptance:** small-sample warnings; private psychology; Performance Dashboard на journal data (не broker); Pro Workspace не терминал.
- **Screenshots:** каждый инструмент в 3 размерах.
- **Tests:** расчёты статистики; агрегация Pro Workspace.
- **Risks:** имитация терминала; broker wallet в dashboard.
- **Stop condition:** QA-review закрыт.

## D7 — Community, News и Referral

- **Scope:** Community (каналы по unlock, messages/replies/reactions/images/moderation, member cards, locked preview), News (in-product + публичный SEO-контур), Referral (flow до L4, secret teaser, приватность приглашённого).
- **Dependencies:** D1–D3.
- **Acceptance:** нет leaderboards; публичные статьи indexable с SEO-метаданными; referral не раскрывает email/Pocket/balance.
- **Screenshots:** Community/News/Public Article/Referral в 3 размерах.
- **Tests:** unlock-гейтинг каналов; SEO-метаданные; referral-статусы.
- **Risks:** смешение публичного и in-product контуров; casino-referral.
- **Stop condition:** QA-review закрыт.

## D8 — Mentor, Support, Notifications, Profile, Settings

- **Scope:** Mentor (треды/review/case), Support (Ticket Center), Notifications (категории, prefs), Profile, Settings.
- **Dependencies:** D3, D7.
- **Acceptance:** mentor ≠ support; неотключаемые уведомления (security/critical/обязательные) защищены; профиль без финансов.
- **Screenshots:** все пять разделов в 3 размерах.
- **Tests:** ticket-статусы; notification prefs; rank-privacy toggle.
- **Risks:** объединение mentor/support; отключение критичных уведомлений.
- **Stop condition:** QA-review закрыт.

## D9 — Responsive, motion, accessibility, performance, visual QA

- **Scope:** финальная адаптивность (включая tablet portrait/landscape), motion-полировка (functional 140–240 ms, milestone 2–4 c skippable, reduced-motion), a11y baseline, performance-бюджеты, полный визуальный QA.
- **Dependencies:** D1–D8.
- **Acceptance:** все требования `MOTION_AND_PERFORMANCE.md` и a11y baseline выполнены; нет horizontal overflow; 200% zoom; keyboard не перекрывает формы; touch ≥44px.
- **Screenshots:** сквозной прогон ключевых экранов в 3 размерах + edge (PL-длина, zoom 200%, landscape).
- **Tests:** a11y-проверки; reduced-motion; performance-метрики (LCP/INP-бюджеты фиксируются здесь).
- **Risks:** milestone ломает reduced-motion; heavy effects на слабых устройствах.
- **Stop condition:** финальный QA-review закрыт по всем фазам.

---

## Missing assets (не блокируют документацию, но держат visual tokens provisional)

- current prelanding screenshots;
- logo;
- exact palette (финальные HEX);
- brand graphics;
- Alex Curie photos/video;
- sample lesson video;
- sample chart images;
- legal/risk text;
- backend contracts (checkpoint verification, balance-gate, mentor queue, referral qualification);
- Polish localization review.

Пока assets нет — финальные visual tokens остаются provisional (DD-004, DD-005).
