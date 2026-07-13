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

## D3 — Урок, тест, report и mentor feedback

- **Scope:** Урок (player, subtitles, 50%-gate), Тест (single question, scenario/chart, explanation, fail-flow), Report (autosave/draft/rubric/статусы/секц. комментарии/версии), Mentor feedback базово.
- **Non-scope:** полноценный mentor backend; support.
- **Dependencies:** D1, D2.
- **Acceptance:** тест открывается на 50%; просмотр 50% не завершает уровень; report статусы и resubmit; без mentor avatar/countdown.
- **Screenshots:** Урок/Тест/Report (+состояния) в 3 размерах + landscape видео.
- **Tests:** 50%-gate; autosave; статусные переходы report/test.
- **Risks:** утечка next lesson до completion; таймер в тесте.
- **Stop condition:** QA-review закрыт.

## D4 — Tools L10–L30

- **Scope:** Trading Journal (L10), Risk Calculator (L15), Chart Markup (L20), Indicator Checklist (L25), News Calendar (L30); ToolShell, locked preview, empty states.
- **Non-scope:** инструменты L35+.
- **Dependencies:** D1–D3.
- **Acceptance:** только manual data; Risk Calc — «сумма для расчёта»; Chart Markup по uploaded screenshot; timezone в News Calendar.
- **Screenshots:** каждый инструмент (+empty/saved) в 3 размерах, Chart Markup в landscape.
- **Tests:** autosave/versions; export chart; фильтры journal.
- **Risks:** автоподгрузка баланса; live-chart соблазн.
- **Stop condition:** QA-review закрыт.

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
