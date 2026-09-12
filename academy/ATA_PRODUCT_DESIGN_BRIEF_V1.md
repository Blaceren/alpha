# Alfa Trade Academy — Product Design Brief V1

Полный design brief продукта **Alfa Trade Academy (ATA) Web V2** для Claude Code, дизайн-департамента, frontend-команды и product review.

Статус: **Phase D0 — Source of Truth**. Это канонический документ уровня продукта. Точечные детали вынесены в `docs/*` и являются его частью. Названия и коды curriculum — из `docs/CURRICULUM_AND_UNLOCKS.md` (канонический источник — `les-prog.txt`).

Оглавление:
1. Продукт
2. Аудитория
3. Принципы
4. Исследования
5. Брендинг и визуальный язык
6. Навигация
7. Страницы
8. Инструменты
9. Curriculum
10. Состояния
11. Responsive
12. Motion
13. Accessibility
14. QA
15. Фазы реализации
16. Acceptance criteria
17. Missing assets
18. Consistency

---

## 1. Продукт

**Alfa Trade Academy** — последовательная образовательная платформа по трейдингу. Пользователь проходит фиксированный путь из **100 уровней (20 модулей)**: смотрит уроки Alex Curie, проходит тесты, выполняет сценарные и практические задания, заполняет reports, получает mentor review и XP, проходит финансовые контрольные точки (checkpoints), открывает инструменты и community-каналы и вручную строит собственную торговую систему, возвращаясь к ранее открытым материалам.

**Разделение с Pocket.** Pocket — торговая платформа (брокер): здесь пользователь торгует и видит свои деньги. ATA — система обучения, progression, planning, analysis, discipline и сопровождения. **ATA не является торговым терминалом и не имитирует его.**

**Что продукт НЕ есть:** generic LMS, admin dashboard, копия Pocket, casino-интерфейс, набор декоративных карточек, перегруженный терминал.

Подробно: `docs/PRODUCT_CONTEXT.md`.

---

## 2. Аудитория

- Возраст **24–45**; ~**30%** полные новички, остальные пробовали Pocket без системных знаний.
- Первое гео — **Польша**. Интерфейс сначала на **русском**, затем польская локализация; RTL не нужен.
- Desktop / mobile одинаково важны; один человек использует desktop, mobile, tablet; Pocket чаще с телефона.
- Понятен без отдельного обучения интерфейсу.
- Компоненты сразу выдерживают более длинные польские строки.

---

## 3. Принципы

**Главное UX-правило:** в каждый момент существует **один очевидный следующий шаг**.

Пользователь за секунды понимает: где он, свой уровень и rank, что завершено, что делать сейчас, почему следующий этап закрыт, что откроется, как вернуться к текущему шагу, где ранее открытые материалы, как получить помощь.

**Два визуальных режима:**
- *Emotional / premium* — Главная, Путь, rank-up, checkpoint/module/tool/community completion, referral reward, level 100. Controlled glow, depth, animated path, subtle particles, объёмные rank emblems, короткие cinematic transitions.
- *Functional* — уроки, тесты, reports, tools, community, news, support, mentor, profile, settings. Читаемость, скорость, стабильность, спокойные поверхности, минимум движения.

Scroll-driven сцены прелендинга не переносятся во все страницы.

**Финансовая приватность (критично).** ATA не показывает balance, deposits, withdrawals, net deposits, broker transactions, «сколько осталось», financial dashboard, постоянную кнопку в Pocket. Показывается только цель checkpoint: «Для открытия следующего модуля требуется баланс Pocket от $N». Рядом — без баланса пользователя; без «осталось $X»; checkpoint CTA не открывает Pocket. Деньги видны только в Pocket.

Полный лог решений — `docs/DESIGN_DECISIONS.md`.

---

## 4. Исследования

Источники принципов (не копирования). Полный разбор — `docs/RESEARCH_SYNTHESIS.md`.

- **Duolingo:** guided path, один шаг, малые блоки, сохранение прогресса, повторение, возврат к текущему. Не берём детскость и наказание за streak.
- **Brilliant:** learn-by-doing, немедленное применение, пошаговые задачи, проверка понимания.
- **TradingView:** качественные drawing tools, плотность, progressive disclosure. Не выдаём новичку терминал.
- **Linear:** системность, тихая премиальность, типографическая дисциплина, скорость, quality-first, малые этапы.
- **Pocket Option:** dark surfaces, знакомый характер палитры, публичная taxonomy статей, PL-готовность. Не берём leaderboards, payout tables, turnover comparisons, casino-механики.

---

## 5. Брендинг и визуальный язык

Продолжение бренда прелендинга: **dark-only**, глубокие тёмные поверхности, холодные акценты, premium lighting, controlled glow, мотивы пути/графика/данных, визуальная глубина, **Alex Curie** как лицо.

Точная палитра неизвестна — используются **provisional semantic tokens** (`docs/DESIGN_SYSTEM.md`), заменяемые значениями прелендинга. Палитра не выдумывается как окончательная.

**Типографика (provisional):** Manrope Variable (заголовки/ranks/milestones), Inter Variable (UI/тексты), JetBrains Mono Variable (формулы/значения). Open-source, Cyrillic+Latin, PL-ready; body ≥16px на mobile; без ultra-light; usable при zoom 200%.

**Alex Curie.** Появляется в lesson previews, первом знакомстве, contextual tips, checkpoint explanation, возврате после паузы, открытии модуля, weekly recap, risk-состояниях, editorial. НЕ floating assistant на каждой странице, не лицо на каждой карточке, не маскот, не навязчивые popups. Tone: на «ты», взрослый, спокойный, конкретный, мотивирующий, без обещаний прибыли, с признанием риска, с личными историями/ошибками. Тексты — `docs/CONTENT_AND_TONE.md`.

---

## 6. Навигация

Подробно — `docs/INFORMATION_ARCHITECTURE.md`, маршруты — `docs/ROUTE_MAP.md`.

**Desktop:** сворачиваемый sidebar (Главная, Путь, Уроки, Инструменты, Сообщество, Новости, Реферальная программа, Ментор, Поддержка, Профиль) + top bar (ранг, XP, уведомления, профиль/avatar, contextual actions).

**Mobile:** bottom nav из 5 — Главная, Путь, Уроки, Инструменты, **Ещё**. Профиль доступен одним нажатием через avatar в mobile top bar. Раздел «Ещё»: Сообщество, Новости, Рефералы, Ментор, Поддержка, Профиль, Настройки.

**Tablet:** полноценное responsive-состояние (compact sidebar/icon rail, portrait+landscape, touch, горизонтальный path, адаптивные two-pane tools), не растянутый mobile.

Глобальный поиск в v1 не нужен. При открытии раздела — контекстный дефолт (текущий уровень / активный урок / последний инструмент / активный тикет / релевантная вкладка).

**Маршруты и оболочки.** Канонические маршруты — Next.js App Router (`[param]`, `docs/ROUTE_MAP.md`). Route groups: `(app)` — авторизованный продукт, `(public)` — публичный `/blog` (отдельная оболочка без app sidebar; не входит в URL). Публичные SEO-статьи — `/blog`, in-product новости — `/news`. Прелендинг, login и registration не создаются в этом прототипе: для неавторизованного пользователя auth state приходит от backend с редиректом в отдельный public/prelanding flow; собственной login-страницы нет.

**Терминология.** Интерфейс v1 полностью русский; английские термины — только code/domain language. Словарь — `docs/CONTENT_AND_TONE.md`, решение — DD-172.

---

## 7. Страницы

Полный инвентарь (route, goal, primary/secondary actions, hierarchy, components, states, desktop/tablet/mobile, mock data, future backend data, analytics, edge cases, acceptance) — `docs/PAGE_INVENTORY.md`. Ключевые:

- **Главная** — «что делать сейчас»: один primary CTA по приоритету (checkpoint → активный урок → обязательное задание → rejected report → mentor feedback → возврат после паузы → Weekly Review). Первый viewport: greeting, rank, level, primary CTA, XP, module progress, участок пути, серия обучения; ниже — недавний инструмент, сообщение Alex, статья, community activity, mentor/support status. ≤5–6 блоков в первом экране.
- **Путь** — горизонтальный L1–100: автоцентр текущего, ~5–7 nodes, дальний путь скрывается, scroll сохраняется, «К текущему уровню», сворачивание модулей, награда важнее номера, линия ~ мотив рынка (не ценовой график). Locked-клик → explainer без перепрыгивания.
- **Урок** — цель, video (subtitles обязательны, позиция сохраняется, focus mode; без chapters/transcript/speed/PiP в v1), связанный tool, тест открывается на 50% (просмотр 50% не завершает уровень), следующий урок скрыт до completion.
- **Тест** — по одному вопросу, progress bar, ответ меняется до завершения, no timer, chart/scenario-вопросы, «отказаться от сделки» может быть верным, explanation после, при fail показан правильный ответ, повтор, после серии неудач — mentor.
- **Report** — structured форма: autosave, draft, images/video, rubric, пример, статусы pending/approved/rejected/resubmitted, комментарии к секциям, версии, исправление в том же report. Без mentor avatar и countdown; «Обычно проверка занимает до одного дня».
- **Сообщество / Новости / Публичная статья / Рефералы / Ментор / Поддержка / Уведомления / Профиль / Настройки** — см. `docs/PAGE_INVENTORY.md`.

---

## 8. Инструменты

Всего **20 инструментов** в интерфейсе: **19 curriculum-инструментов** (открываются на L10–L100) + **1 referral-gated «Секретный инструмент»** (не curriculum unlock, не имеет level unlock). Все trading tools заполняются **вручную**; ни один не показывает реальный Pocket balance/broker wallet. Curriculum-инструменты по уровню (карта — `docs/CURRICULUM_AND_UNLOCKS.md`):

Trading Journal (L10), Risk Calculator (L15), Chart Markup (L20, uploaded screenshot, не live), Indicator Checklist (L25), News Calendar (L30, provider-agnostic), Pause Mode (L35), Weekly Review (L40), Strategy Builder (L45, mentor review), Capital Plan (L50), Market Regime Board (L55), Session Planner (L60), Strategy Statistics (L65, small-sample warnings), Watchlist (L70), Psychology Check-in (L75, private by default), Habit Calendar (L80), Mentor Case Room (L85), Performance Dashboard (L90, на journal data, не broker), Personal Playbook (L95, mentor review), Pro Workspace (L100, не терминал). **Секретный инструмент** — referral-gated (silhouette, прозрачные условия, no countdown/scarcity, содержимое позже).

Поля и специфика каждого — `docs/PAGE_INVENTORY.md` §9.

---

## 9. Curriculum

**20 модулей, 100 уровней, 20 контрольных точек, 20 рангов (5 families × I–IV), 19 tool unlocks (L10–L100) + 1 referral-gated инструмент = 20 инструментов, 5 community unlocks.** Полный mapping — `docs/CURRICULUM_AND_UNLOCKS.md` (не менять смысл, thresholds, названия).

**Checkpoints (min real balance):** L4 $50, L10 $100, L15 $150, L20 $200, L25 $300, L30 $400, L35 $500, L40 $750, L45 $1,000, L50 $1,500, L55 $2,000, L60 $2,500, L65 $3,000, L70 $4,000, L75 $5,000, L80 $6,000, L85 $7,000, L90 $8,000, L95 $9,000, L100 $10,000. Demo не учитывается.

**Ranks:** Наблюдатель I–IV (L4–L20), Аналитик I–IV (L25–L40), Тактик I–IV (L45–L60), Стратег I–IV (L65–L80), Архитектор рынка I–IV (L85–L100).

**Community unlocks:** L4 Старт и вопросы, L20 Разбор графиков, L35 Дисциплина и дневник, L45 Стратегии, L85 Продвинутый круг.

**Progression/XP:** порядок фиксирован, перепрыгнуть нельзя, checkpoint не обходится. XP не списывается, не обходит порядок/checkpoint, не начисляется за real/demo trade, deposit, loss; начисляется за учебные действия и утверждённые rewards. **Серия обучения** продлевается meaningful action (lesson/test/report/journal/weekly review/practical), не за login/страницу/trading/deposit; после пропуска — заново, лучший результат сохранён, без красного наказания. Login фиксируется для CRM-аналитики отдельно.

---

## 10. Состояния

Полная матрица — `docs/STATE_MATRIX.md`.

- **Level (10):** hidden, locked, XP eligible, active, in progress, pending review, completed, checkpoint, grace, temporarily suspended.
- **Checkpoint (7):** Upcoming, Current, Checking, Completed, Data unavailable, Grace, Suspended. Grace/Checking — без countdown. Suspended сохраняет завершённые уровни, XP, прошлые уроки, инструменты предыдущего checkpoint, доступные community channels, news, support; закрывает только новый progression. Никакого deposit-pressure.
- **Test / Report / Tool / Community / Mentor / Support / Referral / Notification / Streak** — см. матрицу.

---

## 11. Responsive

Reference viewports: **desktop 1440×900, tablet 1024×768, mobile 390×844** (+ tablet portrait). Требования: no page horizontal overflow; touch ≈44px; safe area; клавиатура не перекрывает форму; no hover-only actions; длинные PL-строки; browser zoom 200%; landscape video; landscape chart markup. Tablet — полноценное состояние. Breakpoints — `docs/DESIGN_SYSTEM.md`.

---

## 12. Motion

Правила — `docs/MOTION_AND_PERFORMANCE.md`. Functional-анимация (навигация, tabs, path, node state, progress, dialog, sheet, autosave) — 140–240 ms. Emotional-анимация только для milestone (rank-up, checkpoint, module/tool/community completion, referral reward, level 100) — 2–4 c, skippable. No scroll lock; no long animation before content; быстрый scroll не ломает состояние; heavy effects off на слабых устройствах; hidden tab ставит ambient на паузу; reduced-motion не ломает UI.

---

## 13. Accessibility

Baseline без формального WCAG-сертификата, но обязательно: semantic headings; visible focus; keyboard для основных desktop flows; no color-only meaning; captions для video; labels; helpful errors; 200% text zoom; dark contrast; touch targets; **screen-reader list-альтернатива для path**; **text-альтернатива для essential chart/canvas**.

---

## 14. QA

`docs/SCREENSHOT_QA_PROTOCOL.md`. UI не считается готовым без реальных browser screenshots работающего приложения. Для каждой UI-фазы: запуск → настоящие screenshots (1440×900, 1024×768, 390×844) → визуальная проверка → review markdown → фиксы → финальные screenshots → завершение. Synthetic reconstruction / HTML inspection / нарисованная картинка не считаются. Хранение: `design-memory/screenshots/<phase>/`, `design-memory/reviews/<phase>-review.md`.

---

## 15. Фазы реализации

Полный план (scope/non-scope/dependencies/acceptance/screenshots/tests/risks/stop condition) — `docs/IMPLEMENTATION_PLAN.md`.

- **D0** Documentation & decision lock — текущая.
- **D1** Next.js foundation, tokens, base components, app shell, routes, mock provider.
- **D2** Главная и Путь.
- **D3** Урок, тест, report, mentor feedback.
- **D4** Tools L10–L30.
- **D5** Tools L35–L60.
- **D6** Tools L65–L100.
- **D7** Community, News, Referral.
- **D8** Mentor, Support, Notifications, Profile, Settings.
- **D9** Responsive, motion, accessibility, performance, visual QA.

**Запреты D0:** нет package.json, src/, приложения, зависимостей, UI, backend, CRM, Prisma, Pocket, production API, deploy.

---

## 16. Acceptance criteria (продукт-уровень)

Продукт/фаза считаются приемлемыми, когда:

1. На каждом экране есть **один очевидный следующий шаг** и один primary CTA.
2. Пользователь за секунды видит где он, уровень, rank, что дальше и почему следующее закрыто.
3. **Финансовая приватность** соблюдена: нет баланса пользователя, нет «осталось $X», checkpoint показывает только целевую сумму, CTA не открывает Pocket.
4. Curriculum consistent: 100 уровней, 20 модулей, точные thresholds, корректные tool/community/rank unlocks; нет legacy «TradeQuest» в пользовательских текстах.
5. Состояния из `STATE_MATRIX.md` реализованы (включая grace/suspended без countdown и deposit-pressure).
6. Responsive: нет horizontal overflow в 1440×900 / 1024×768 / 390×844; touch ≥44px; PL-длина и zoom 200% не ломают.
7. Motion: functional 140–240 ms, milestone 2–4 c skippable, reduced-motion не ломает.
8. A11y baseline выполнен (в т.ч. path list-альтернатива и chart text-альтернатива).
9. Mentor ≠ Support; public news ≠ in-product news; все tools — manual, без broker wallet.
10. Пройден `SCREENSHOT_QA_PROTOCOL.md` с реальными screenshots; blocker/major findings = 0.

---

## 17. Missing assets

current prelanding screenshots; logo; exact palette; brand graphics; Alex Curie photos/video; sample lesson video; sample chart images; legal/risk text; backend contracts; Polish localization review. Отсутствие не блокирует документацию; финальные visual tokens остаются provisional (`docs/IMPLEMENTATION_PLAN.md`).

---

## 18. Consistency

Проверено отсутствие противоречий по осям: Alfa Trade Academy vs legacy name; checkpoint target vs hidden balance; learning streak vs login analytics; mentor vs support; public vs in-app news; manual tools vs Pocket integration; ranks vs checkpoints; tools vs curriculum; mobile vs desktop navigation; design system vs prelanding continuity. Результат и чек-лист — `docs/IMPLEMENTATION_STATUS.md` §3.

### D0.1 — Consistency patch (зафиксированные решения)

- **19 curriculum-инструментов (L10–L100) + 1 referral-gated «Секретный инструмент» = 20 инструментов** в интерфейсе (DD-170).
- **Mobile bottom nav:** Главная, Путь, Уроки, Инструменты, **Ещё**; профиль — через avatar в top bar; «Ещё» = Сообщество/Новости/Рефералы/Ментор/Поддержка/Профиль/Настройки (DD-171).
- **Пользовательская терминология — русская**; английский — только code/domain language; «Alfa Trade Academy» не переводится (DD-172, словарь в `docs/CONTENT_AND_TONE.md`).
- **Канонические маршруты — Next.js App Router `[param]`**; `/blog` (public) vs `/news` (in-product); `/referrals`; `/mentor/[conversationId]` (DD-173).
- **Route groups `(app)` / `(public)`** с разными оболочками; `/blog` без app sidebar (DD-174, DD-177).
- **Pocket — регистрация, не подключение/привязка**; отдельный instruction flow для «У меня уже есть аккаунт»; нет прямой Pocket-кнопки после registration flow; backend verification не выдумывается (DD-175, DD-176).

Полные записи — `docs/DESIGN_DECISIONS.md` (DD-170…DD-177).
