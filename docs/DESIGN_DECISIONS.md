# DESIGN_DECISIONS

Единый лог зафиксированных продуктовых и дизайн-решений (ADR-стиль). Каждое решение — источник истины. Изменять только осознанно и с обновлением зависимых документов.

Легенда статусов: **Locked** (D0-решение, не менять без явного пересмотра) · **Provisional** (будет уточнено после получения assets).

---

## Бренд и визуальный язык

- **DD-001 (Locked).** Название продукта — только **Alfa Trade Academy**. «TradeQuest» — legacy, допустимо только внутри `les-prog.txt`, запрещено в пользовательских текстах.
- **DD-002 (Locked).** Тема — **dark-only**. Светлой темы нет.
- **DD-003 (Locked).** Визуальная преемственность с прелендингом: глубокие тёмные поверхности, холодные акценты, premium lighting, controlled glow, мотивы пути/графика/данных, визуальная глубина, Alex Curie как лицо.
- **DD-004 (Provisional).** Точная палитра неизвестна. Используются provisional semantic tokens; финальные значения приходят из прелендинга. Палитру не выдумывать как окончательную.
- **DD-005 (Provisional).** Шрифты: Manrope Variable (заголовки/ranks/milestones), Inter Variable (UI/тексты), JetBrains Mono Variable (формулы/интервалы/технические значения). Все open-source, Cyrillic+Latin, PL-ready. Пересматриваются после assets прелендинга.
- **DD-006 (Locked).** Два визуальных режима: Emotional/premium (Главная, Путь, milestone-события) и Functional (рабочие страницы). Scroll-driven сцены прелендинга не переносятся во все страницы.

## UX-принципы

- **DD-010 (Locked).** В каждый момент существует один очевидный следующий шаг (single primary action).
- **DD-011 (Locked).** Продукт не должен превращаться в generic LMS, admin dashboard, копию Pocket, casino, набор декоративных карточек или торговый терминал.
- **DD-012 (Locked).** При открытии раздела пользователь попадает в релевантный контекст: текущий уровень / активный урок / последний редактируемый инструмент / активный ticket / релевантная вкладка.
- **DD-013 (Locked).** Глобальный поиск в первой версии не нужен.

## Финансовая приватность

- **DD-020 (Locked).** ATA не показывает пользователю balance, deposits, withdrawals, net deposits, broker transactions, «сколько осталось», общий financial dashboard, постоянную кнопку в Pocket.
- **DD-021 (Locked).** Показывается только цель checkpoint: «Для открытия следующего модуля требуется баланс Pocket от $N». Рядом с целью не показывается баланс пользователя.
- **DD-022 (Locked).** Не рассчитывать визуально «осталось $X».
- **DD-023 (Locked).** Checkpoint CTA («Проверить выполнение») не открывает Pocket.
- **DD-024 (Locked).** Пользователь видит свои деньги только внутри Pocket.

## Progression, XP, streak, ranks

- **DD-030 (Locked).** Порядок уровней фиксирован; перепрыгнуть нельзя. Checkpoint нельзя обойти XP или иным способом.
- **DD-031 (Locked).** XP: не списывается; не позволяет перепрыгивать уровни; не обходит checkpoint; не начисляется за real trade, demo trade, deposit, loss. Начисляется за учебные действия и утверждённые rewards.
- **DD-032 (Locked).** Публичная серия — «Серия обучения». Продлевается за meaningful action (lesson, test, report, journal, weekly review, practical task). Не продлевается за login, открытие страницы, trading activity, deposit.
- **DD-033 (Locked).** Login-активность фиксируется для будущей CRM/retention-аналитики, но не влияет на серию обучения.
- **DD-034 (Locked).** После пропуска серия начинается заново, лучший результат сохраняется, нет красного наказания, текст «Продолжим с текущего этапа».
- **DD-035 (Locked).** 20 ranks (по одному на checkpoint), 5 families: Наблюдатель / Аналитик / Тактик / Стратег / Архитектор рынка, по I–IV. Mapping — `CURRICULUM_AND_UNLOCKS.md`. Rank icon не содержит сумму; может быть скрыт пользователем в community.
- **DD-036 (Locked).** Rank-up: 2–4 c, skippable, без casino, без обязательного звука; после анимации показать practical unlock.

## Навигация

- **DD-040 (Locked).** Desktop: сворачиваемый sidebar (Главная, Путь, Уроки, Инструменты, Сообщество, Новости, Реферальная программа, Ментор, Поддержка, Профиль) + top bar (ранг, XP, уведомления, профиль/avatar, contextual actions).
- **DD-041 (Locked, обновлено D0.1).** Mobile: bottom navigation из 5 — Главная, Путь, Уроки, Инструменты, **Ещё**. Профиль доступен одним нажатием через **avatar в mobile top bar** (не входит в bottom nav). Раздел «Ещё» содержит: Сообщество, Новости, Рефералы, Ментор, Поддержка, Профиль, Настройки. Формулировка «доп. меню из Ещё/Профиля» не используется.
- **DD-042 (Locked).** Tablet — полноценное responsive-состояние (compact sidebar/icon rail, portrait+landscape, touch, горизонтальный path, адаптивные two-pane tools), не растянутый mobile.

## Путь (L1–100)

- **DD-050 (Locked).** Путь горизонтальный. Текущий level автоцентрируется; видно ~5–7 nodes (2–3 предыдущих, текущий, 3–4 следующих); дальний путь скрывается; scroll сохраняется; после ручной прокрутки — кнопка «К текущему уровню».
- **DD-051 (Locked).** Завершённые модули можно сворачивать; пройденные уроки можно открывать; награда визуально важнее номера; тип активности — небольшой иконкой; линия может напоминать движение рынка, но не буквальный ценовой график.
- **DD-052 (Locked).** Состояния level: hidden, locked, XP eligible, active, in progress, pending review, completed, checkpoint, grace, temporarily suspended (см. `STATE_MATRIX.md`).
- **DD-053 (Locked).** При нажатии на locked level: объяснить что это, почему закрыто, что нужно, что откроется — без возможности перепрыгнуть порядок.

## Урок и тест

- **DD-060 (Locked).** Урок: возврат, module+level, название, короткая цель, video, video progress, связанный tool, test launcher, completion state.
- **DD-061 (Locked).** Subtitles обязательны; video position сохраняется; full-screen/focus mode есть; chapters/transcript/speed control — не в первой версии; PiP с Pocket не нужен.
- **DD-062 (Locked).** Тест открывается после просмотра 50% видео; сам по себе просмотр 50% не завершает уровень; следующий урок не показывается до completion.
- **DD-063 (Locked).** Тест: по одному вопросу, progress bar, ответ можно менять до завершения, no timer, допускаются chart images и scenario-вопросы, правильный ответ может быть «отказаться от сделки», explanation после завершения, после fail показывается правильный ответ, повтор возможен, после нескольких неудач — обращение к mentor. History attempts и best score пользователю не обязательны.

## Reports

- **DD-070 (Locked).** Report — structured форма: autosave, draft, images, video attachments, rubric, пример хорошего ответа, статусы pending/approved/rejected/resubmitted, комментарии к секциям, version history, исправление внутри того же report.
- **DD-071 (Locked).** Не показывать конкретный mentor avatar. Не показывать countdown до ответа. Спокойный текст: «Обычно проверка занимает до одного дня».

## Mentor и Support

- **DD-080 (Locked).** Mentor и Support — полностью разные системы, не объединять в один чат.
- **DD-081 (Locked).** Mentor: образовательные вопросы, reports, feedback, strategy/risk review, case room, revisions.
- **DD-082 (Locked).** Support: отдельный Ticket Center (list, create, category, thread, attachments, статусы waiting support/waiting user/resolved, reopen).

## Notifications

- **DD-090 (Locked).** Единый notification center, категории: Обучение, Mentor, Community, Система, Новости, Награды.
- **DD-091 (Locked).** Можно отключить: news, marketing, часть community. Нельзя отключить: security, critical system, статус обязательного задания.
- **DD-092 (Locked).** Каналы: in-app, email, push с базовыми правилами. Не проектировать десятки marketing campaigns.

## Alex Curie

- **DD-100 (Locked).** Alex Curie — лицо продукта. Появляется в lesson previews, первом знакомстве, contextual tips, checkpoint explanation, возврате после паузы, открытии модуля, weekly recap, risk-состояниях, editorial.
- **DD-101 (Locked).** Нет floating assistant на каждой странице, нет лица на каждой карточке, нет маскота, нет навязчивых popups.
- **DD-102 (Locked).** Tone: на «ты», взрослый, спокойный, конкретный, мотивирующий, без обещаний прибыли, с признанием риска; допускаются личные истории и ошибки.

## Checkpoints

- **DD-110 (Locked).** Состояния checkpoint: Upcoming, Current, Checking, Completed, Data unavailable, Grace, Suspended (тексты — `CONTENT_AND_TONE.md`, поведение — `STATE_MATRIX.md`).
- **DD-111 (Locked).** Grace/Suspended показывают состояние без countdown. Suspended сохраняет завершённые уровни, XP, прошлые уроки, инструменты предыдущего checkpoint, доступные community channels, news, support; закрывается только новый progression после checkpoint.
- **DD-112 (Locked).** Никакого deposit pressure copy.

## Tools

- **DD-120 (Locked).** Все trading tools заполняются вручную. Ни один tool не показывает реальный Pocket balance или broker wallet history.
- **DD-121 (Locked).** Risk Calculator: введённое значение — «сумма для расчёта», не «текущий баланс Pocket».
- **DD-122 (Locked).** Chart Markup Tool (первая версия) — по uploaded screenshot, не live chart.
- **DD-123 (Locked).** Performance Dashboard работает на manually entered journal data, не показывает broker wallet.
- **DD-124 (Locked).** Pro Workspace (L100) — не trading terminal.
- **DD-125 (Locked).** Psychology Check-in — private by default.

## Community

- **DD-130 (Locked).** Channels открываются по уровню: L4, L20, L35, L45, L85. Возможности: messages, replies, reactions, images, moderation/report, member profiles, rank badges, locked channel preview.
- **DD-131 (Locked).** Не создавать financial/profit/trade-volume leaderboards и награды за число сделок.

## News

- **DD-140 (Locked).** Два контура: публичный SEO-раздел (indexable, категории, автор, дата, reading time, related, SEO-метаданные, social preview, PL позже, без комментариев) и in-product feed (general + «Подходит к текущему модулю», bookmark, read later, related lessons, topic filters).

## Referral

- **DD-150 (Locked).** Flow: поделиться ссылкой → друг регистрируется в ATA → проходит Pocket registration → достигает L4 → оба получают reward.
- **DD-151 (Locked).** Первый qualified referral открывает обоим «Секретный инструмент» (до открытия — silhouette, прозрачные условия, содержимое заранее не раскрывается). Последующие referrals могут давать XP, лимиты определит backend позже.
- **DD-152 (Locked).** Пригласивший видит сокращённое имя, avatar, progress state, reward state. Не видит email, Pocket ID, balance, deposit, trading info.

## Responsive / Motion / A11y / QA

- **DD-160 (Locked).** Reference viewports: desktop 1440×900, tablet 1024×768, mobile 390×844 (+ tablet portrait). Требования — `MOTION_AND_PERFORMANCE.md`, `SCREENSHOT_QA_PROTOCOL.md`.
- **DD-161 (Locked).** Motion: functional 140–240 ms, milestone 2–4 c, skippable; no scroll lock; reduced-motion не ломает UI; hidden tab ставит ambient на паузу; heavy effects off на слабых устройствах.
- **DD-162 (Locked).** A11y baseline без формального WCAG-сертификата: semantic headings, visible focus, keyboard для desktop flows, no color-only meaning, captions, labels, helpful errors, 200% zoom, dark contrast, touch targets, screen-reader list-альтернатива для path, text-альтернатива для chart/canvas.
- **DD-163 (Locked).** UI не считается готовым без реальных browser screenshots приложения (см. `SCREENSHOT_QA_PROTOCOL.md`).

## D0.1 — Consistency patch (новые/уточнённые решения)

- **DD-170 (Locked).** Количество инструментов: **19 curriculum-инструментов** (открываются на уровнях L10–L100) + **1 referral-gated «Секретный инструмент»** = **20 инструментов** в пользовательском интерфейсе. Секретный инструмент не является curriculum tool unlock и не имеет level unlock; открывается только через qualification реферальной программы. Формулировки «20 curriculum tools», «20 tool unlocks», «20 инструментов + secret» не используются.
- **DD-171 (Locked).** Mobile bottom navigation: Главная, Путь, Уроки, Инструменты, **Ещё**. Профиль — через avatar в mobile top bar. «Ещё» содержит: Сообщество, Новости, Рефералы, Ментор, Поддержка, Профиль, Настройки. (См. DD-041.)
- **DD-172 (Locked).** Пользовательская терминология первой версии — русская. Канон: Community→Сообщество, Mentor→Ментор, Report→Отчёт, Checkpoint→Контрольная точка, Rank→Ранг, Support→Поддержка, Referral→Реферальная программа/Рефералы, Tools Hub→Инструменты, Weekly Review→Недельный обзор (кроме внутреннего tool code). Английские термины допустимы только как code/domain language (identifiers, routes, analytics codes, технические объяснения). Официальное название «Alfa Trade Academy» не переводится. Названия конкретных инструментов пока могут оставаться английскими с русским описанием рядом. Полный словарь — `CONTENT_AND_TONE.md`.
- **DD-173 (Locked).** Канонические маршруты — Next.js App Router с `[param]` (`ROUTE_MAP.md`). Запрещено смешивать `:code` / `:id` / `[code]`. Публичные SEO-статьи — `/blog`; in-product новости — `/news`. Рефералы — `/referrals`. Диалог с ментором — `/mentor/[conversationId]`.
- **DD-174 (Locked).** Route groups: `(app)` — авторизованный продукт, `(public)` — `/blog`. Не входят в URL. Авторизованный продукт и публичный блог имеют разные оболочки: `/blog` — без authenticated app sidebar.
- **DD-175 (Locked).** Pocket: пользователь **не подключает и не связывает** существующий аккаунт. Это **регистрация**. Из пользовательских текстов исключены «Подключить Pocket», «Связать Pocket», «Connect Pocket», «Pocket connection» (как пользовательское действие). Канон состояний: «Регистрация Pocket», «Перейти к заданию регистрации», «Подтвердить регистрацию», «Регистрация проверяется», «Регистрация подтверждена», «Не удалось подтвердить регистрацию», «У меня уже есть аккаунт».
- **DD-176 (Locked).** Ветка «У меня уже есть аккаунт» — отдельный instruction flow (не подключение аккаунта): ordered steps, warning, confirmation, возврат к проверке. Точный текст инструкции утверждается позднее. После завершения registration flow нет прямой кнопки перехода из основного продукта в Pocket. Backend verification mechanism не выдумывается.
- **DD-177 (Locked).** Прелендинг, login и registration не создаются внутри этого design-прототипа. Для неавторизованного пользователя продукт получает auth state от backend и перенаправляет в отдельный public/prelanding flow; собственная временная login-страница не показывается.

## D1A — Foundation & art-direction (новые решения)

- **DD-180 (Locked).** Стек: Next.js 16 App Router (без experimental), TypeScript strict, Tailwind 3 + CSS-variable токены, Radix только по необходимости (Tooltip), lucide-react, self-hosted variable fonts (`@fontsource-variable/*`, без внешнего fetch), Vitest + Testing Library, Playwright, npm. Next 16 удалил `next lint` → ESLint flat config напрямую.
- **DD-181 (Locked).** Semantic токены реализованы значениями в `src/styles/tokens.css` и маппятся в Tailwind; код не хардкодит HEX. Значения provisional до палитры прелендинга (см. DD-004).
- **DD-182 (Locked).** Синтетический state Главной для сравнения: уровень 18 «Поддержка и сопротивление» (Модуль 4 «Чтение графика»), ранг Наблюдатель III (L15), next checkpoint L20 от $200 → Наблюдатель IV, доступны Trading Journal + Risk Calculator, ближайшая награда Chart Markup Tool. Только synthetic-данные; контракт без поля баланса.
- **DD-183 (Locked, D1A).** Три арт-направления (Product Portal / Market Atlas / Editorial Academy) на одной базовой палитре и одном наборе компонентов; различаются композицией/глубиной/типографикой/материалами/характером пути/плотностью/ролью Alex. Маршруты `/concepts/*` — development-only, вне production sitemap. **Победитель не выбирается автоматически** — решение продуктовой команды.
- **DD-184 (Locked).** Реальная Главная (`/`) и остальные production-маршруты в D1A не строятся; `/` временно редиректит на `/concepts`. Прелендинг/login/registration — вне прототипа (DD-177).
- **DD-185 (Locked).** UI считается проверенным только по реальным browser screenshots (DD-163): D1A снял 6 концепт-PNG (1440×900 и 390×844) + board; после review-фиксов сделаны финальные screenshots.

## D1A-R2 — Consolidated master direction

- **DD-190 (Locked, D1A-R2).** Роли трёх систем: **Route Field = Home/Path** (основа), **Learning Spine =
  curriculum context** (модули/уроки/отчёты/история; на Главной — только мини-индикатор модуля внутри
  current-node), **Constructed Artifact = milestone/rank/unlock** (компактно на Главной, крупнее в
  checkpoint-transition). Не все три появляются одновременно. Детали — `docs/D1A_R2_MASTER_DIRECTION.md`.
- **DD-191 (Locked).** Главная = участок живого маршрута: route — главный объект; lesson-plane
  разворачивается из current-node (route входит в плоскость); checkpoint — **структурные ворота**, а не
  pill/badge; rank — constructed ascending-route artifact (не гексагон/медаль/буква A/пирамида).
- **DD-192 (Locked).** Два состояния Главной на одной системе: State A (active lesson, «Продолжить урок»)
  и State B (current checkpoint, «Проверить выполнение»). В B: условие «баланс Pocket от $200» + «demo не
  засчитывается», без баланса пользователя/«осталось $X»/Pocket-CTA; награда+ранг = один объект ворот.
- **DD-193 (Locked).** D1A-R2 anti-generic threshold = **85**; консолидированное направление получило
  **89/100**, без automatic fail (`design-memory/reviews/d1a-r2-high-fi-review.md`).
- **DD-194 (Provisional).** Материалы/цвета high-fi прототипа — provisional (deep navy, cold blue,
  restrained cyan/green, один glow focus); финальные HEX не фиксируются без palette.
- **DD-195 (Locked).** React implementation Главной **ещё не утверждён**; требуется явное решение
  пользователя (правило art-gate сохраняется).

## D1A-R2.1 — Route Field visual correction

- **DD-200 (Locked).** R2 принят концептуально, но **не** визуально. Card-centric implementation
  **отклонён**: lesson context — открытая асимметричная поверхность, сформированная route geometry
  (bounded top+left, open bottom-right), не generic central card. Route формирует интерфейс.
- **DD-201 (Locked).** Checkpoint gate обязан иметь структуру **near / boundary / far**: near
  (путь+позиция+условие) → boundary (две смещённые вертикальные плоскости + световой aperture +
  остановка route + депт-сдвиг) → far (новый ранг + инструмент + следующий module field). Reward и
  новый ранг — за воротами, не floating pills. Не координатная ось.
- **DD-202 (Locked).** Sparkline rank artifact **отклонён**. **Route Sigil** — новое provisional
  направление ранга: завершённый маршрут, свёрнутый в знак (anchor + один continuous trace + 1–4 слоя +
  family contour + точка ступени). Читается в 22px, силуэт держится в monochrome. Не chart/sparkline/
  hexagon/медаль/щит/буква A/пирамида/стрелка/монета.
- **DD-203 (Locked).** Финансовая иерархия checkpoint: сумма «Баланс Pocket от $200» показывается
  спокойно (обычный ink, без glow/зелёного гиганта/deposit-styling/срочности/«осталось»/Pocket-CTA);
  главный — не $200, а условие/действие. CTA — route action marker, не ярче route-системы.
- **DD-204 (Locked).** Alex Curie — заметное provisional media presence (reserved media frame +
  editorial voice strip, привязан к node); не серый avatar/не generic-карточка/не floating chatbot.
- **DD-205 (Locked).** Оценка коррекции — evidence matrix (14 критериев, все Pass), не self-балл.
  Любой Fail блокирует React. React всё равно **не разрешён** без явного решения пользователя.
  Детали — `docs/D1A_R2_1_VISUAL_CORRECTION.md`, `design-memory/reviews/d1a-r2-1-review.md`.

## D1A-R2.2 — Final production-readiness correction

- **DD-210 (Locked).** Route Field **окончательно утверждён** как основа Главной, глобального Пути,
  отображения текущего уровня и приближения к контрольной точке. R2.2 — последняя design-only correction
  перед React. Новое art direction не создаётся; к трём вариантам не возвращаться; card-grid/sidebar не возвращать.
- **DD-211 (Locked).** Nested-square Route Sigil **отклонён**. **Route Knot** — новая provisional rank
  система: пройденный маршрут, свёрнутый в компактный **асимметричный узел** (один continuous trace +
  central anchor + open/closed endpoints + 1–4 captured nodes + асимметричный силуэт; без рамки-контейнера,
  без полного круга, без направления графика). Ступень I–IV = число captured nodes (меняется структура
  узла; IV замыкает внутренний маршрут). Читается в 22px, monochrome-силуэт держится; не похож на
  wallet/camera/scanner/QR/chart/target/shield/medal/букву A/пирамиду/стрелку/монету.
- **DD-212 (Locked).** Checkpoint: результаты за воротами **разделены** (Следующий ранг / инструмент)
  как far-side preview со структурной линией + минимальным разделителем, не две pills/cards. Future
  checkpoint preview — структурный (дальняя граница), не текстовая строка. Финансовая иерархия спокойная:
  «$200» не крупнее heading, без glow/deposit/urgency/«осталось»/Pocket-CTA.
- **DD-213 (Locked).** Alex media-frame — cinematic crop без лица + directional light + явная asset-layer
  boundary для замены; имя нормально, «наставник курса» вторично; без stock-person.
- **DD-214 (Locked).** Debug/phase copy запрещён в пользовательских кадрах (design documentation — можно).
- **DD-215 (Locked).** Оценка — evidence matrix (все Pass). **Отсутствие Fail не заменяет пользовательское
  approval: React разрешается только после ручного просмотра R2.2 и явного решения.** Детали —
  `docs/D1A_R2_2_PRODUCTION_READINESS.md`, `design-memory/reviews/d1a-r2-2-review.md`.

### D1B — React App Shell & Route Field Home

- **DD-216 (Locked).** Финальная система рангов **не** фиксируется в D1B. Ранее исследованный «Route Knot»
  (DD-211) **не** принимается как финальный ранг. В D1B используется только `ProvisionalRankMark`
  (один trace + node). Выбор финальной rank-identity — отдельная фаза с явным approval и (по возможности)
  на финальных assets. Детали — `docs/RANK_IDENTITY_FUTURE_PHASE.md`.
- **DD-217 (Locked).** Два детерминированных состояния Главной переключаются **только** через query
  (`?scenario=active|checkpoint`), резолвинг `resolveScenario` (неизвестное → active). Без debug-панели,
  тумблера и phase-copy в пользовательском UI. Оба состояния читаются исключительно через `getHomeState()`.
- **DD-218 (Locked).** Responsive-стратегия Главной: два независимых breakpoint. Навигация (app bar ↔
  mobile top/bottom bars) переключается на 900px; композиция/маршрут (stacked `r-narrow` ↔ Route-Field grid
  `r-wide`) — на 1200px. Планшет (900–1199) — настоящий stacked-state, а не сжатый desktop-grid.
- **DD-219 (Locked).** Незавершённые адресаты в D1B: CTA — no-op кнопка (без навигации), непостроенные
  пункты навигации — focusable-disabled (`aria-disabled`, «Скоро»). Нет 404, нет фейкового «успех», нет
  Pocket-CTA. Профиль доступен через avatar (кнопка-заглушка, без /profile).
- **DD-220 (Locked).** Оценка D1B — evidence matrix (20 критериев, все Pass; любой Fail блокирует) +
  visual-QA лог по реальным screenshots. Детали — `design-memory/reviews/d1b-react-home-review.md`,
  `docs/D1B_REACT_HOME_IMPLEMENTATION.md`.

### D1B.1 — Responsive / Zoom / Safe-Area Correction

- **DD-221 (Locked).** Responsive определяется фактической CSS-шириной. **200% browser zoom** reflow'ит в
  compact-композицию (медиазапросы, без `transform: scale()`/CSS `zoom`), без horizontal overflow. Три
  breakpoint: <900 mobile stacked, 900–1199 tablet, ≥1200 desktop Route Field grid.
- **DD-222 (Locked).** Tablet (900–1199) — **отдельная композиция**, не сжатый desktop и не растянутый mobile.
  Active: 2-региональный grid (plane широкий + checkpoint preview рядом), маршрут — одна диагональ
  node→preview; instrumentation под plane, Alex во всю ширину. Checkpoint: stacked с воротами сверху.
- **DD-223 (Locked).** Fixed bottom nav не перекрывает контент: `padding-bottom`/`scroll-padding-bottom`
  учитывают `env(safe-area-inset-bottom)`; последний содержательный элемент полностью прокручивается выше nav
  (проверяется e2e bounding-box). Проблема не решается увеличением высоты скриншота.
- **DD-224 (Locked).** Геометрия маршрута — scenario-scoped группы (`a-*` active, `c-*` checkpoint), по одной
  на breakpoint; SVG двух сценариев не конфликтуют. Контраст вторичного/muted текста поднят (три уровня
  иерархии сохранены; opacity не единственный механизм иерархии). Desktop-композиция D1B не пересматривается.

### D1B.2 — Short Viewport & Bottom Navigation Final Fix

- **DD-225 (Locked).** Причина перекрытия CTA — фиксированный мобильный вертикальный ритм без
  **short-height breakpoint**: при высоте viewport ≤~450px Y CTA попадал в полосу fixed bottom nav
  (не вертикальное центрирование). Введён `@media (max-height: 560px)` short-height mode: компактный ритм,
  grid → `align-content: start`, естественный scroll, title floor 21px, без CSS scale.
- **DD-226 (Locked).** Canonical token `--mobile-bottom-nav-height: 60px` — единственный источник
  компенсации bottom nav (`padding-bottom`, `scroll-padding-bottom` на root, `scroll-margin-bottom` на CTA),
  не дублируется по компонентам. Последний содержательный элемент прокручивается ≥24px выше nav.
- **DD-227 (Locked).** Единый scroller: `.home-main { overflow-x: clip }` — окно единственный скроллер,
  поэтому scroll-padding/scroll-margin работают для клавиатурного фокуса и `scrollIntoView` (CTA/focusable
  не уходят под nav). Проверяется e2e helper `assertElementAboveBottomNavigation`.
- **DD-228 (Locked).** Home считается **завершённой** после D1B.2 (desktop/tablet/mobile/landscape/zoom/320
  без Fail). Следующий этап — полноценный `/path`. Route Field не пересматривается.

### D2A — Learning Path

- **DD-229 (Locked).** Curriculum живёт в **typed fixture** (`src/data/curriculum/fixture.ts`):
  20 модулей, 100 уровней, 20 checkpoints с каноническими порогами, 19 tool unlocks, 5 community
  unlocks, 7 mentor reviews. Raw `les-prog.txt` в React не импортируется; consistency-тесты пиновали
  fixture к канону. Прогресс на curriculum **не хранится** — состояние выводит scenario adapter
  (позже заменяется backend-прогрессом без изменения UI).
- **DD-230 (Locked).** Масштаб 100 уровней решается **окном одного модуля** (4–6 уровней + ворота +
  стабы соседей): ≤8 визуальных узлов одновременно. Остальные модули — сегментная лента (вариант A
  из допустимого списка; minimap и edge-only отклонены, рёбра сохранены как дополнение). Никаких
  100 карточек/таблиц/длинных timeline/скроллбара из 100 кружков.
- **DD-231 (Locked).** Layout Пути — детерминированный движок (`PATH_LAYOUT_ENGINE.md`): проценты
  одного контейнера для DOM-узлов и SVG-слоя (никогда не расходятся), «походка» WALK вместо шума,
  без random/rAF. Изгибы объяснимы: уровень/граница модуля/ворота/ветка инструмента.
- **DD-232 (Locked).** Состояния уровней выводятся: core `completed/current/available/locked` +
  checkpoint-уточнения + trait-маркеры. Состояние передаётся геометрией маркера **и** текстом,
  не только цветом. Completed — приглушённый (не ярко-зелёный), locked открывается и объясняет причину.
- **DD-233 (Locked).** Level detail — anchored side plane (desktop, карта видима; не центральная
  modal) / sheet выше bottom nav (mobile). Locked-explainer без контента сверх brief. Primary-действия —
  dev-safe no-op (расширение DD-219) до появления lesson/checkpoint flow.
- **DD-234 (Locked).** Сценарии Пути: active/checkpoint/early/advanced/completed через query;
  неизвестное → active; невидимы пользователю; adapter-only. Канон пользователя: Артём, L18,
  модуль 4, Наблюдатель III, 2 480 XP, серия 6, точка L20 $200 → Наблюдатель IV + Chart Markup Tool.
- **DD-235 (Locked).** Навигация приложения: `Путь` — реальный маршрут (Link) в обеих навигациях;
  AppShell рендерится страницей (per-page activeId), layout группы `(app)` несёт только CSS.

### D2A-R1 — Path Visual Hierarchy & Responsive Correction

- **DD-236 (Locked).** Читаемая сводка контрольной точки живёт **вне** панорамируемой канвы
  (`.cp-summary`): порог и награда не могут быть обрезаны краем. Edge clipping никогда не считается
  способом progressive disclosure — обрезка внутри канвы допустима только тогда, когда та же
  информация гарантирована сводкой, а край снабжён fade.
- **DD-237 (Locked).** Short-height — два уровня приоритета. 421–560px: сводка КТ над полем (оба в
  первом экране). ≤420px: первый экран отдан маршруту и текущему узлу, сводка — ниже фолда. Маршрут
  держит ≥16px до фиксированного bottom nav; текущий узел никогда не приносится в жертву шапке.
- **DD-238 (Locked).** Contextual detail: mobile — **непрозрачная** поверхность (computed alpha = 1)
  над scrim'ом без blur/glassmorphism; scrim не накрывает bottom nav и не входит в a11y-дерево.
  Desktop — панель примыкает к полю без зазора и связана с выбранным узлом leader-линией (правая
  стена workspace, не карточка/modal/sidebar).
- **DD-239 (Locked).** Панорамирование должно быть заявлено: edge-fade + сдержанная одноразовая
  метка, гаснущая после первого **реального** жеста (программное авто-центрирование жестом не
  считается). Без tutorial-modal и без постоянного текста «свайпните».
- **DD-240 (Locked).** В навигаторе роли передаются геометрией: current = залитая точка,
  viewed = рамка-скобка; масштаб — marker `N / 20` + четыре главы по 5; distant-модули компактнее.
  Не progress bar, не 20 больших кнопок; touch-полоса ≥44px.
- **DD-241 (Locked).** D2A закрывается только после R1. R1 менял **исключительно** presentation layer:
  curriculum entities/ranges/thresholds, tool/report/mentor/community mapping, scenario semantics и
  layout engine остались без изменений.

## D2B — Core Lesson Experience

- **DD-242 (Locked, D2B).** Канонический маршрут урока — **`/lessons/[levelCode]`** (`level.018`),
  как зафиксировано в `ROUTE_MAP.md`. Форма `/lessons/18` **не** вводится: две конкурирующие схемы URL
  запрещены. `/lessons` резолвится в текущий урок (документированный контекстный дефолт), а не в 404,
  как было до D2B. Отдельный маршрут `/lessons/[levelCode]/test` в D2B **не** реализуется: проверка
  живёт на странице урока под видео (продуктовое правило «видео перед тестом»); маршрут остаётся
  зарезервированным и пересматривается в D3.
- **DD-243 (Locked, D2B).** Тело урока **не** хранится в curriculum fixture: он остаётся каноном
  структуры (номер, модуль, название, kind, artifact, sequence), а `src/features/lesson/data/` владеет
  media/sections/outcomes/assessment. Авторски заполнен **только уровень 18**; текст — **provisional
  development fixture** (утверждённого редакционного сценария нет). Каноничны продуктовые правила и UX,
  а не формулировки. Уровень 19 — **practical**-уровень, поэтому получает только stub без выдуманного тела.
- **DD-244 (Locked, D2B).** Утверждённой записи урока нет, поэтому media — **simulated**: детерминированная
  локальная шкала времени поверх абстрактной учебной схемы. Никаких внешних URL/CDN, никакой имитации
  загруженного production-плеера; demo-состояние обозначено честно и сдержанно.
- **DD-245 (Provisional, D2B).** Completion rule урока — **frontend development rule, не backend-контракт**:
  `verified watch >= 50%` **и** каждый обязательный вопрос отвечен верно хотя бы раз. Проходной процент
  не вводится (все вопросы обязательны). Полный просмотр не требуется (подтверждает DD-062).
- **DD-246 (Locked, D2B).** В D2B поддерживается **только single choice**. Multiple choice не вводится,
  пока он не нужен по существу — иначе UX усложняется искусственно.
- **DD-247 (Locked, D2B).** Правильный вариант **не** раскрывается до submit, и **не** раскрывается при
  неправильном ответе: вопрос остаётся открытым для спокойного повтора, иначе retry перестаёт быть retry.
  Это осознанно расходится с прежней формулировкой `STATE_MATRIX`/`PAGE_INVENTORY` («при fail показан
  правильный ответ»); документы приведены к D2B. Ошибка не отнимает XP, не ломает серию, не даёт штраф,
  таймер, жизни и сравнение с другими.
- **DD-248 (Locked, D2B).** Порядок вопросов — детерминированный порядок fixture; shuffle запрещён
  (стабильные screenshots, воспроизводимые тесты, отсутствие hydration drift).
- **DD-249 (Locked, D2B).** Разблокировка теста считается от **maxVerifiedWatchedPosition**, а не от
  playhead. Прогресс монотонный: перемотка назад его не снижает, а seek вперёд и воспроизведение внутри
  пропущенного участка его не увеличивают. Порог **ровно 50%** и включительный (49.99% — закрыто).
  Время подаётся как явная дельта: без `Date.now()` и `Math.random()`.
- **DD-250 (Locked, D2B).** Состояние урока живёт **только в текущем runtime страницы**: без backend,
  без localStorage, без claim «сохранено на сервере». Completion честно сообщает, что отметка держится в
  текущей сессии. XP **не** начисляется: канонического правила награды за урок нет, поэтому 2 480 XP
  не меняются. Следующий уровень доступен только после completion. **Скорректировано в D2B.1 (DD-255):**
  переход больше не несёт dev-scenario — completion пишется в сессию браузера, а ссылка чистая.
- **DD-251 (Locked, D2B).** Урок использует систему **Learning Spine** (DD-190): одна вертикальная ось
  прошивает этапы одного учебного шага (видео → проверка → завершение → переходы). Урок — не ещё одна
  Route Field страница: Главная — текущий момент, Путь — пространственная карта, Урок — один шаг.
  Главный объект — media stage; rail — тонкая metadata, не dashboard и не sidebar.
- **DD-252 (Locked, D2B).** Внутри урока **не** показывается финансовое условие контрольной точки:
  сумма живёт на Главной и Пути (DD-046). Урок — учебный шаг; Pocket CTA, баланс и просьба пополнить
  счёт отсутствуют во всех состояниях, включая locked и completion.
- **DD-253 (Locked, D2B).** Порядок DOM = порядок обучения: видео всегда перед тестом, и этот же порядок
  является мобильным. Desktop-rail ставится **grid-областью**, а не второй копией разметки, поэтому
  дублирования контента для screen reader нет.
- **DD-254 (Locked, D2B).** Расширение DD-219: адресаты, построенные в D2B, становятся настоящими
  ссылками (Главная и Путь → урок), непостроенные (checkpoint verification) остаются dev-safe no-op.
  Непостроенный или недостигнутый уровень резолвится в честный explainer, а не в 404 и не в fake unlock.


## D2B.1 — Acceptance gate fix

- **DD-255 (Locked, D2B.1).** Development scenario **не может быть механизмом пользовательского
  progression**. Completion уровня записывается в **session-scoped store** (`sessionStorage`, ключ
  `ata.lesson-progress.v1`, схема `{version, completed[], unlocked[]}`), а CTA следующего уровня — чистый
  канонический URL `/lessons/level.019` без query. `?scenario=…` остаётся **исключительно** development/
  test adapter: ни одна пользовательская ссылка его не содержит (проверяется тестом по всем `<a>`).
  `sessionStorage`, а не `localStorage`: прогресс не должен переживать сессию — сверять его не с чем, а
  долговечная запись подразумевала бы persistence, которой нет. Хранятся только коды уровней и версия;
  XP, финансовые значения, ответы и curriculum copy — никогда. Любой сбой (битый JSON, чужая версия,
  подделка, недоступное хранилище) деградирует в **locked**: подделанное значение может только закрыть.
  Это **не** backend persistence, и UI этого не утверждает — «Отметка хранится только в текущей сессии
  браузера». Закрытие сессии может потерять прогресс: честная граница frontend-only прототипа.
- **DD-256 (Locked, D2B.1).** Ownership состояния разделён: **lesson state machine** решает, завершён ли
  текущий урок; **session progress adapter** хранит результат между navigation/reload; **route
  availability resolver** (`lesson-availability.ts`) объединяет curriculum sequence + dev scenario
  override + session completion. Сессия может только **открыть** недостигнутый уровень — закрыть уже
  открытое или дать перепрыгнуть она не может. Business rules в React-компоненты не переносятся.
  SSR: сервер `sessionStorage` не читает и всегда рендерит locked/safe default; клиент резолвит через
  `useSyncExternalStore` (server snapshot = `resolving`), поэтому нет ни hydration mismatch, ни кадра
  неверного ответа. Оба исхода — server-rendered поддеревья, переданные пропсами.
- **DD-257 (Locked, D2B.1).** E2E-специи делятся на два слоя по **naming convention**:
  `*smoke.spec.ts` — behavioral regression (ничего не пишет на диск, входит в стандартный
  `npm run test:e2e`); `*screenshots.spec.ts` — artifact capture (пишет PNG в `design-memory/`, в
  стандартный gate **не** входит). Причина не косметическая: запуск screenshot-спеки прошлой фазы против
  текущего кода **переписывает historical evidence** (спека D2A перегенерировала кадры уже с дизайном
  D2A-R1), а шум антиалиасинга грязнит дерево. Полный discovery — `npm run test:e2e:all`. Стандартный
  gate до D2B.1 покрывал 21 из 116 тестов; это было принято ошибочно и исправлено.


- **DD-258 (Locked, D2C-A).** **D2C = Lessons Library & Module Overview**, production-маршрут
  **`/lessons`**. До этой фазы D2C фигурировал в документации только как отрицание («D2C автоматически
  не начинается») — без scope и acceptance; это исправлено (`docs/D2C_LESSONS_LIBRARY_SCOPE.md`).
  Существующий redirect `/lessons` → текущий урок (D2B) не отменяется, а **повышается** до
  доминирующего действия страницы «Продолжить обучение». Длительность урока показывается **только там,
  где она реально известна**: сегодня это ровно один уровень (18, `L18_DURATION_SECONDS` = 8:00,
  DD-244) — у остальных 99 её не существует и она не выдумывается.
- **DD-259 (Locked, D2C-A).** **Путь и Уроки отвечают на разные вопросы, и это критерий приёмки D2C.**
  Путь = **допуск**: где я в последовательности, что открыто, где checkpoint, какой следующий
  обязательный шаг. Уроки = **содержание**: чему посвящён модуль, какие уроки в него входят, что уже
  изучено, что продолжить, какие форматы существуют, что можно пересмотреть. «Уроки» **не** повторяют
  Route Field (диагональная траектория, viewport-рамка, pan, узлы в пространстве) — иначе страница не
  нужна. Финансовое условие checkpoint на «Уроках» присутствует только как **граница модуля**
  («условие: баланс Pocket от $200» + что открывает), никогда как призыв; финансовая приватность
  (только target, без баланса/«осталось»/Pocket-CTA) сохраняется без изменений.
- **DD-260 (Locked, D2C-A).** Low-fi предложения ATA линкуют **настоящие** ассеты продукта —
  `src/styles/tokens.css`, `src/features/home/home.css` (shell), `@fontsource-variable/*` — вместо
  перерисовки shell'а и дублирования HEX'ов: перерисованный shell врёт в доказательствах, а копия
  токенов расходится с продуктом. Прототипы живут вне `src/`
  (`design-memory/proposals/<phase>/` — существующая convention репозитория; названная в задаче папка
  `prototypes/` не заводится, чтобы не плодить вторую). Скрипт съёмки предложений намеренно **вне**
  `e2e/`: по DD-257 там ровно два слоя спек (`*smoke` / `*screenshots`), и съёмка статических
  предложений не относится ни к одному. Единственное, что прототипу разрешено воспроизвести, —
  `@layer base` из `globals.css` (Tailwind-директивы не резолвятся по `file://`).

- **DD-261 (Locked, D2C-B).** Направление библиотеки — **Concept B «Curriculum Index»** (выбор
  пользователя). Из **Concept A** перенесён **ровно один** элемент и только для mobile: компактный
  переключатель модуля (предыдущий · «Модуль NN из 20» · следующий) + доступ к полному списку через
  sheet; **постоянная левая рейка A не переносится**. **Concept C отклонён**: цепочка ролей
  дублировала бы Главную (текущий урок + CTA + будущая контрольная точка) и размывала границу с Путём —
  «Уроки» стали бы второй Главной. Desktop остаётся индексом B: строка = `ординал · название ·
  отточие · состояние`, ноль карточек, ноль lock-иконок, все 20 модулей выше сгиба на 1440×900.
  Отточие оставлено **только** в индексе модулей: в строках уровней оно ложилось на неверный baseline и
  толкало экран к виду спецификации (D2C-A review, minor #11).
- **DD-262 (Locked, D2C-B).** У библиотеки один **presentation projector**
  (`features/lessons-library/model/lessons-library-model.ts`): он объединяет curriculum fixture + общий
  marker (`path-state`) + session (`lesson-availability`) и отдаёт готовую модель. React-компоненты
  **не вычисляют progression business rules** — расширение DD-256 на библиотеку. Второй набор названий,
  thresholds, rewards, типов уроков и статусов не заводится; счётчик пройденного — общий
  `moduleCompletedCount`, которому передаётся session-продвинутый маркер. Единственный новый словарь —
  **`kindLabel`**, введённый как единственный владелец подписей типов (до D2C они были вписаны ad hoc в
  `path-detail-layer.tsx` и `lesson-locked-screen.tsx`). Авторитет доступности урока — только
  `resolveRouteAvailability`: «available» на Пути означает «следующий в очереди», а **не** открытый
  урок. Длительность показывается лишь там, где её реально знает `lesson-fixtures` — сегодня это ровно
  уровень 18 (8:00); у остальных 99 её не существует и она не выдумывается.
- **DD-263 (Locked, D2C-B).** Выбор модуля — **обычное пользовательское состояние URL**:
  `/lessons?module=module.NN`, где значение — **канонический код модуля** curriculum fixture (второй
  идентификатор не заводится). Оно shareable, переживает reload, даёт нативные Back/Forward, **не
  меняет progression** и не может открыть закрытый последовательностью урок; неизвестный код безопасно
  откатывается к текущему модулю пользователя. Это **не** development scenario: `/lessons` **не читает
  `?scenario`** вовсе. Ключ маркера (`scenario="active"`) остаётся внутренним prop'ом по прецеденту
  `PathWorkspace` — через границу server→client уходит ключ, а не объект `PathProgress`, поэтому
  инструментовка, которую библиотека не рендерит (`rankLabel`, `xpLabel`, `streak`), не сериализуется
  в payload. Фальшивые состояния (network error, server sync, backend loading, AI-рекомендации) не
  создаются; curriculum «resolving» тоже не выдумывается — fixture синхронный, а единственная
  асинхронность (сессия) решена через `useSyncExternalStore` без экрана загрузки.

## D3-A — Report Level Scope & Art Direction

- **DD-264 (Locked, D3-A).** **Отчёт — это сам curriculum-level, а не приложение к нему.** Канонический
  маршрут report-уровня — **`/lessons/level.003`**; маршрут **`/reports/[reportCode]` не создаётся**, а
  код `report.NNN` **не вводится**. Уровень 3 имеет `kind: "report"` — отчёт не «прикреплён» к уровню,
  он **и есть** уровень, поэтому отдельный адрес завёл бы второй идентификатор (`report.003`) для одной
  сущности (`level.003`) и вторую URL-схему. Это тот же дефект, которым DD-242 отклонил `/lessons/18`,
  и то же правило, которым DD-263 запретил второй идентификатор модуля. `ROUTE_MAP.md` обновлён:
  строка `/reports/[reportCode]` помечена как не используемая.
- **DD-265 (Locked, D3-A).** **`pending-review` останавливает progression.** После отправки отчёта
  уровень получает статус `pending-review`, следующий уровень **остаётся закрытым**, и progression не
  движется до вердикта `approved`. Интерфейс честно объясняет ожидание; **countdown не показывается**;
  обещать реальную очередь, server processing или что наставник получил отчёт — **запрещено**. Это
  осознанный выбор честности против проходимости прототипа: путь после L3 в D3-B действительно
  останавливается, и это правда, а не дефект. Для development screenshots будущих состояний допустим
  **explicit dev/test adapter** (прецедент `?scenario`, DD-234): он не является пользовательским
  механизмом progression, не появляется в пользовательских ссылках и **не выдаёт `approved`
  автоматически**.
- **DD-266 (Locked, D3-A).** **Хранилище отчёта — versioned `localStorage`, ключ
  `ata.report-workspace.v1`**, а не `sessionStorage`. Это сознательное расхождение с D2B.1 (DD-255),
  обоснованное природой данных: потеря отметки «досмотрел 50%» — неудобство (видео пересматривается),
  потеря черновика отчёта — **потеря работы пользователя**. Autosave поверх `sessionStorage` был бы
  обещанием, которого хранилище не выполняет. Канонический копирайт: **«Черновик сохранён в этом
  браузере. Синхронизация с сервером пока не подключена.»** Запрещённые формулировки: «Сохранено на
  сервере», «Синхронизировано», «Отправлено наставнику», «Наставник уже получил отчёт». Submit создаёт
  **только локальное** состояние `pending-review`.
- **DD-267 (Locked, D3-A).** **Practical ≠ report-форма.** Зафиксирована **гипотеза** (не методология):
  `practical = ручной прототип будущего инструмента`. Основание — систематическое наблюдение:
  practical на уровне N готовит инструмент, открывающийся на N+1 (L14→L15 Risk Calculator, L39→L40
  Weekly Review, L44→L45 Strategy Builder, L49→L50, L59→L60, L64→L65, L69→L70, L74→L75, L79→L80,
  L29→L30). Гипотеза **не утверждается** окончательной: L9, L19, L24, L34, L54, L83, L84, L89, L94,
  L99 в неё не попадают. **В D3-A и D3-B practical не реализуется**; уровень 19 остаётся честным
  placeholder до отдельной совместной проработки **D3 Practical + D4 Tools**. Риск, который это
  предотвращает: две несвязанные реализации одного артефакта (форма в D3, инструмент в D4).
- **DD-268 (Locked, D3-A).** **Rubric — только структурная и prototype-only:** completeness · evidence
  attached · reflection present. Это критерии **формы работы**, а не торговые критерии. Русские
  подписи в прототипах явно помечены prototype-only и **не становятся canonical curriculum content**.
  Запрещено придумывать: правила прибыльной торговли, критерии хорошей сделки, оценку доходности,
  торговые советы, обязательные финансовые результаты. Это **строже** DD-243 (provisional lesson copy),
  и разница в классе риска: выдуманная формулировка урока — provisional-текст, выдуманная rubric по
  трейдингу — **псевдо-методология**, которую пользователь примет за требование академии. Текста
  задания в fixture нет, поэтому canonical instructions не выдумываются — используется честная пометка
  **«Структура задания уточняется редакцией»**.
- **DD-269 (Locked, D3-A).** **`/lessons/[levelCode]/test` остаётся зарезервированным.** В D3-A он не
  реализуется и **не удаляется**. Inline-тест из D2B (проверка под видео, правило «видео перед тестом»)
  остаётся каноническим поведением. Судьба отдельного маршрута решается **отдельным DD** и не
  смешивается с отчётом: связывать два независимых решения означало бы принимать их под видом одного.
- **DD-270 (Locked, D3-A).** **D3 переопределена как «Report, Practical & Mentor Review Experience»**
  и разбита на этапы (`D3_REPORT_SCOPE.md`). **Урок и тест в новый D3 не входят — они закрыты в D2B**;
  прежнее определение писалось в D0 до появления D2B/D2C, и два из четырёх его acceptance-критериев
  уже выполнены (DD-245, DD-249). Реализация «по прежнему плану» означала бы переделку принятого.
  Прототипы D3-A линкуют настоящие токены, shell и шрифты продукта и лежат **вне `src/`** (прецедент
  DD-260); capture-скрипт намеренно не помещён в `e2e/` (DD-257). **Победитель D3-A не выбран** —
  React заблокирован до явного выбора направления пользователем.

## D3-B — First Report Level

- **DD-271 (Locked, D3-B).** Направление отчёта — **Concept B «Evidence Ledger»**. Из Concept C
  перенесён **только компактный блок «Перед отправкой»** (требуется · готовность · browser-local
  правда · что произойдёт после отправки). **Полная правая dashboard-плита Concept C отклонена**,
  **Concept A «Report Desk» отклонён**. Главный объект — ледгер из пяти записей; их количество
  диктует curriculum («Отчёт по 5 demo-сделкам»), а не макет. Блок соглашения ограничен ≈¼ рабочей
  ширины и живёт **рядом** с концом формы: в первом проходе он вырос до 641px против 429px у ледгера
  и начал доминировать — тот самый риск, ради избежания которого из C брали только блок.
- **DD-272 (Locked, D3-B).** Введён **explicit dev/test сценарий `report`** (`currentLevel: 3`) рядом
  с early/advanced/checkpoint (DD-234). Причина: канон — Артём на уровне 18, а единственный
  report-уровень — 3, поэтому история «submit → pending → уровень 4 закрыт» связна только для того,
  кто стоит на уровне 3. Канон **не меняется**; полный flow живёт только под `?scenario=report`;
  сценарий не включается автоматически и **не появляется ни в одной пользовательской ссылке**.
  Инструментовка скопирована из `early` — новых XP-правил не выдумано (DD-250).
  **Резолвер доступности не изменялся:** уровень 4 остаётся закрытым не потому, что отчёт его запер, а
  потому, что уровень 3 **никогда не завершается** — `pending-review` не пишет
  `ata.lesson-progress.v1`. Отчёт не закрывает ничего; он просто не открывает.
  Фраза о закрытом уровне 4 **выводится** из резолвера и **отсутствует**, когда уровень действительно
  открыт (канонический профиль), а не становится ложной.
  **Последовательность побеждает локальную запись:** при `availability === "completed"` режим —
  `archive`, поэтому pending, записанный под сценарием, не делает уровень 3 незавершённым для
  канонического пользователя и не может задним числом закрыть уровни 4–18. Одно правило применяется на
  трёх поверхностях: маршрут отчёта, библиотека, Путь.
- **DD-273 (Locked, D3-B).** **`/lessons` читает `?scenario=` как development/test адаптер** — явная
  поправка к DD-263, который утверждал, что библиотека не читает сценарий «вовсе». Это было верно,
  пока у неё не было причины: статус отчёта можно показать только для уровня, на котором пользователь
  стоит, а канонический маркер ставит Артёма на 18. Природа параметров сохраняется и не смешивается:
  `?module` — пользовательское состояние, попадающее в пользовательские ссылки; `?scenario` — адаптер,
  который туда не попадает никогда. Неизвестное значение → канонический маркер.
- **DD-274 (Locked, D3-B).** **Правило готовности — prototype-only и структурное:** каждая из пяти
  записей имеет непустое «Что заметил после сделки» **и** заполнено «Итоговое наблюдение». «Когда» и
  «Что решил» необязательны — требовать их значило бы выдумать rubric, которой у curriculum нет.
  Правило **не** mentor rubric, **не** торговая оценка, **не** измерение качества и **не** обещание
  одобрения. Показывается **словами** («Заполнено 3 из 5 записей», «Осталось заполнить 2 записи и
  итоговое наблюдение», «Можно отправить на проверку») — без процентов, score, grade, quality meter и
  без красных ошибок до попытки submit.
- **DD-275 (Locked, D3-B).** **Хранилище — `localStorage`, ключ `ata.report-workspace.v1`** (DD-266).
  Парсинг **fail closed**: битый JSON, чужая версия, неизвестная форма, поддельный статус
  (`approved` и любой другой вне `draft | pending-review`) → запись отбрасывается; 4/6/9 записей
  нормализуются ровно в `entryCount`; id записей **регенерируются**, а не берутся из payload;
  неизвестные поля не переживают round-trip. Единственное исключение — `pending-review` на неполном
  отчёте **понижается до `draft`**: такой записи не мог создать `withSubmitted`, и честное прочтение —
  «он не был отправлен»; запирать пользователя в его же незаконченной работе неправильно. Инвариант:
  подделка может стоить только черновика — **никогда** не откроет уровень и не сфабрикует вердикт.
  Store проверяет **форму** storage (`getItem`/`setItem`/`removeItem` — функции), а не его наличие:
  `window.localStorage` не гарантированно настоящий `Storage`.
- **DD-276 (Locked, D3-B).** **Autosave честен.** Четыре состояния: `Черновик сохранён в этом
  браузере.` · `Есть несохранённые изменения.` · `Сохраняется в этом браузере.` · `Локальное
  сохранение недоступно.` Debounce 600 мс, ключ эффекта — счётчик `revision`, не объект. `saving`
  мгновенно по природе (localStorage синхронен) — **задержка не подделывается** ради видимости
  спиннера. **Отказ записи даёт `unavailable`, а не `dirty`.** Блок «Перед отправкой» печатает
  **реальное** состояние: в первом проходе он хардкодил «Черновик сохранён в этом браузере» и лгал при
  отказе записи ровно там, где пользователь решает отправлять. Запрещены: «Сохранено на сервере»,
  «Синхронизировано», «Отправлено наставнику», «Наставник получил отчёт».
- **DD-277 (Locked, D3-B).** **Submit требует подтверждения**, потому что необратим в этом прототипе:
  нет `rejected`, нет `resubmit`, нет наставника, который вернёт работу. Диалог называет четыре вещи:
  редактирование заблокируется · отметка только в этом браузере, синхронизации нет · уровень 4
  останется закрыт (когда это правда) · автоматического одобрения нет. Действия — «Продолжить
  редактирование» и **«Отметить как отправленный»**; формулировка «Отправить наставнику» **запрещена**.
  `withSubmitted` отказывает, если правило готовности не выполнено, а после отправки мутаторы
  возвращают тот же объект: pending read-only **по конструкции**, а не только по атрибуту.

## D3-B.1 — Report Mobile Safe Area Acceptance Fix

- **DD-278 (Locked, D3-B.1).** **Компенсация bottom navigation имеет одного владельца.** `home.css`
  определяет её ОДИН раз на `.home-main` — из канонического токена
  `--mobile-bottom-nav-height`, включая `env(safe-area-inset-bottom)`, — и `.home-main` оборачивает
  каждую `(app)`-страницу. `.rl-page` добавляла вторую копию: 84px поверх 84px, и при этом **сама
  формула была неверной** (пропущен safe-area inset). Второй hardcoded размер навигации не вводится;
  `.rl-page` больше не переопределяет компенсацию. Итог замерен: последний контрол стоит **24px** над
  панелью — «спокойный зазор» в границах 16–24px.
- **DD-279 (Locked, D3-B.1).** **`flex-basis` — не подсказка ширины.** `.rl-end-txt` нёс
  `flex: 1 1 280px`, написанный для desktop-**строки**. На mobile контейнер переключается в
  `flex-direction: column`, и flex-basis начинает разрешаться по главной оси — **высоте**: 280px
  резервировались под 79px текста, создавая **201px** дыру между объяснением и его же кнопкой.
  Приёмка увидела это как «CTA брошен внизу страницы». Урок общий: размерная подсказка, заданная для
  одного направления flex, обязана пересматриваться там, где направление меняется.
- **DD-280 (Locked, D3-B.1).** **Read-only пустое поле — не input.** В `pending`/`archive` пустое
  **необязательное** поле («Когда», «Что решил») не рендерится как пустая интерактивная рамка: она
  приглашает печатать, а контрол, отказывающий во вводе, хуже отсутствующего. Показывается спокойное
  **«Не заполнено»** — приглушённо, без рамки, **без красного**: пропустить необязательный контекст
  никогда не было ошибкой. Роль `textbox` для такого значения не создаётся. Заполненные значения
  остаются читаемыми (read-only контрол), обязательное поле не сворачивается никогда, а `draft`/`ready`
  визуально не меняются. Lifecycle, storage, readiness и progression не затронуты.
- **DD-281 (Locked, D3-B.1).** **Safe area проверяется геометрией, а не наличием правила.** Приёмка
  D3-B прошла с `padding-bottom` на месте — и всё равно хоронила CTA. Поэтому behavioral-проверки
  измеряют **реальные bounding boxes**: каждый доступный контрол обязан прокручиваться целиком выше
  панели с зазором **≥12px** на 390×844, 320×720 и 720×450 (200% zoom), в состояниях draft, ready и
  pending. Отдельная проверка сторожит и обратную крайность: зазор под CTA **< 64px**, а расстояние
  между объяснением и кнопкой **< 48px** — чтобы починка ямы не превратилась в новую яму.

## D3-C-A — Revision Requested & Resubmit Art Direction

- **DD-282 (Locked, D3-C-A).** **Report-kind сам по себе review-gated.** Уровень `kind: "report"` —
  единственный вид уровня, где пользователь производит работу для внешней проверки: урок завершается
  фактом просмотра, тест — правильными ответами, а отчёт локально проверяем только структурно
  («есть ли что проверять», DD-274) — проверить содержание, не выдумав торговую rubric, нельзя
  (DD-268). Поэтому требование проверки встроено в kind и не нуждается во флаге; report-уровень
  завершается только внешним `approved` (DD-265). Level 3 остаётся единственным report-уровнем
  первого среза; вопрос «L3 против L14» закрыт и повторно не открывается.
- **DD-283 (Locked, D3-C-A).** **`mentorReview` — флаг дополнительной practical-review механики, а не
  универсальный признак «нужна проверка».** `mentorReview: false` у уровня 3 — не противоречие:
  у report-уровня проверка встроена в природу kind (DD-282), у practical-уровня флаг добавляет
  отдельный будущий контур сопровождения (D3-E/D3-F, OQ-4) **поверх** его собственной природы.
  **Curriculum fixture не изменяется.**
- **DD-284 (Locked, D3-C-A).** **Канонический пользовательский термин — «Нужна доработка»**;
  machine-readable статус — `revision-requested`. Запрещены в UI: «Отклонён», «Rejected»,
  «Провален», «Ошибка отчёта». Это не наказание и не финальный отказ: работа вернулась к
  пользователю, все записи целы, следующий шаг очевиден. Красный error-state как основной образ
  запрещён; **новый «тревожный» оттенок не изобретается** — палитра не содержит warm-акцента, и
  состояние передаётся словами и геометрией (полый маркер в холодной синей гамме; прецедент
  DD-232). Финальные цвета — за prelanding (OQ-1).
- **DD-285 (Locked, D3-C-A).** **Хранилище D3-C — `ata.report-workspace.v2`** (изменение схемы
  получает новый ключ, не тихую миграцию — REPORT_STORAGE §2) **с сохранением валидных
  v1-данных**: draft → draft, pending-review → pending-review, содержимое пяти записей и итогового
  наблюдения — дословно; `review` у мигрированных записей `null`; **v1 не удаляется
  автоматически**; битое или неизвестное — fail closed без порчи v1; существующая v2-запись
  побеждает (миграция не перезаписывает более новую работу); молчаливое уничтожение валидного
  черновика запрещено. Инварианты v1 сохраняются: подделка может стоить только черновика — никогда
  не откроет уровень и не сфабрикует вердикт. **Код миграции в D3-C-A не пишется** — контракт
  зафиксирован в `D3_REVISION_SCOPE.md` §6.
- **DD-286 (Locked, D3-C-A).** **Единственный frontend-only источник `revision-requested` —
  explicit dev/test adapter** (прецедент DD-234/DD-272): нужен для deterministic screenshots и
  будущих E2E; не является пользовательским действием; не появляется в пользовательских ссылках;
  не включается автоматически; пишет только report-workspace и никогда `ata.lesson-progress.v1`;
  неизвестный вердикт — fail closed. Подставляемый им feedback — provisional development/test
  content и явно так помечен. Точная форма адаптера — отдельный DD в D3-C-B.
- **DD-287 (Locked, D3-C-A).** **`approved` остаётся в D3-D.** D3-C покрывает только цикл
  `pending-review → revision-requested → editing → ready-to-resubmit → pending-review`;
  повторная отправка возвращает статус ровно в `pending-review` — без ускоренной проверки,
  приоритетов и счётчика попыток. Автоматического одобрения нет; уровень 4 остаётся закрыт,
  фраза о нём — выведенная (DD-272); правило resubmit структурное: готовность (DD-274) ∧ черновик
  изменён после вердикта (`review.atRevision`); отмеченные разделы — подсветка внимания, **не
  валидатор**.
- **DD-288 (Locked, D3-C-A).** **D3-C не вводит mentor system.** Минимальная форма feedback — один
  общий комментарий + список section IDs, требующих внимания; raw ID пользователю не показываются
  (интерфейс говорит «Запись 03 · Что заметил после сделки»). Не вводятся: имя проверяющего,
  avatar, countdown, чат, секционные треды, rubric score, торговая оценка, финансовые значения,
  version-history UI (локальная запись одна — доработка правит ту же работу, копия «как было при
  отправке» не хранится и не обещается). Mentor thread / `/mentor` / queue — D3-E.

## D3-C-B — Report Revision Pass (реализация)

- **DD-289 (Locked, D3-C-B).** **Выбрано направление B «Revision Pass»** — feedback как порядок
  работы. Из направления A взяты ровно **два элемента**: спокойная полоса «Комментарий проверки»
  над ледгером и человекочитаемые ссылки-переходы к отмеченным разделам. **Отклонены:** margin rail
  направления A (постоянная вертикаль с узлами как основной способ связи) и Review Contract
  направления C (второй доминирующий объект / правая плита / дублированная closing zone).
  Коррекции относительно прототипа B: обычные записи не получают повторяющегося «без пометок» и не
  приглушаются в недоступность; отмеченные места несут словесное состояние; **blue — семья
  review/revision, green/cyan — только сохранение, готовность и успешное действие; красного нет**
  (уточнение DD-284). Исторические документы направлений не переписаны.
- **DD-290 (Locked, D3-C-B).** **Storage v2 реализован** (`ata.report-workspace.v2`, контракт
  DD-285) с миграцией при чтении: валидный v2 авторитетен, битый v2 fail closed **без** отката к
  v1; v1 читается только при отсутствии v2 — нетронутым v1-парсером; v1-ключ никогда не удаляется
  и не перезаписывается (`clear()` стирает только v2). Введён **второй счётчик
  `meaningfulRevision`**: `revision` остаётся техническим ключом autosave (каждая принятая правка),
  `meaningfulRevision` растёт только когда нормализованное значение поля (trim + схлопывание
  пробелов) действительно изменилось; `review.atRevision` пинит именно его. Так whitespace-правка
  честно сохраняется, но «изменением после вердикта» не считается. Битый review стоит **вердикта,
  не работы**: запись выживает как `pending-review`.
- **DD-291 (Locked, D3-C-B).** **Verdict adapter — `?verdict=revision-requested`** (прецедент
  `?scenario`, DD-234/DD-286): типизированный резолвер fail closed (любое иное значение, включая
  `approved`/`rejected`, → null — у типа адаптера нет таких членов); применяется только под явным
  `?scenario=report`, только к `pending-review` без вердикта — **один вердикт на итерацию**, ничего
  автоматического сверх явно набранного запроса; пишет только report-workspace; подставляет
  фиксированный provisional feedback, помеченный `dev/test · provisional`. Ни один пользовательский
  href не содержит `scenario`/`verdict` (закреплено тестами). Кнопка «Запросить доработку» и
  интерфейс наставника не создавались.
- **DD-292 (Locked, D3-C-B).** **Resubmit — то же правило, тот же отчёт, тот же честный диалог.**
  `ready-to-resubmit` ⇔ готовность (DD-274) ∧ `meaningfulRevision > review.atRevision`; отмеченные
  секции — направление внимания, не валидатор (изменение любого поля считается). Копия отчёта не
  создаётся. Подтверждение — конструкция DD-277 с заголовком «Отправить отчёт на проверку
  повторно?» и действиями «Продолжить доработку» / «Отправить повторно». После подтверждения —
  ровно `pending-review`: `submittedAt` обновлён, read-only по конструкции, `review` сохранён и
  показан как **тихий контекст** («Комментарий последней проверки», без ссылок и кромок — не
  активный список задач), «Исправления отмечены как отправленные только в этом браузере.»;
  `ata.lesson-progress.v1` не пишется, уровень 4 закрыт только настоящим резолвером.

## D3-D-B — Approved Report State (реализация)

- **DD-293 (Locked, D3-D-B).** **Library и Path показывают L3 «Завершён»; «Одобрено» — только на
  самом report-экране.** После approval-induced completion строка библиотеки читает «Завершён ·
  Пересмотреть», деталь Пути — «пройден»; локальный report-label скрыт правилом `completed`
  (`displayedReportLifecycle` возвращает null при `availability === "completed"`; деталь Пути
  гейтит на `state !== "completed"`). «Одобрено» не протекает ни в библиотеку, ни в Путь.
- **DD-294 (Locked, D3-D-B).** **Primary CTA approved-экрана — чистый `/path`** («Посмотреть
  Путь»); допустима вторичная ссылка «К списку уроков» → `/lessons`. Ни один пользовательский href
  не несёт `scenario`/`verdict` (закреплено тестами). Pocket CTA/link отсутствует.
- **DD-295 (Locked, D3-D-B).** **Home вне scope.** `src/features/home/**`, Home-проекции, Home-
  сценарий и канонический Artem не изменяются и не получают report-workspace/session augmentation.
- **DD-296 (Locked, D3-D-B).** **Storage v3** (`ata.report-workspace.v3`, version 3) добавляет
  терминальный статус `approved` и `approvedAt`. Односторонняя read-time миграция v1 → v2 → v3:
  валидный v3 авторитетен, битый v3 fail closed **без** отката к v2/v1; при отсутствии v3 валидный
  v2 (сам поднимающий v1) поднимается дословно с `approvedAt = null`. v1/v2-парсеры **не тронуты** —
  подделанный `approved` в v2-ключе по-прежнему отвергается v2-парсером. Ключи v1/v2 не удаляются и
  не перезаписываются; `clear()` v3-store стирает только v3. **Нормализация approved fail closed:**
  approved без submittedAt или с неполным отчётом → draft (работа сохранена, progression не
  открывается); approved с невалидным/отсутствующим ISO `approvedAt` → pending-review (сохранены и
  работа, и review); unknown review section ids отбрасываются поодиночке; unknown/forged статус →
  запись не становится approved. Валидный пользовательский текст не уничтожается из-за битой
  verdict-метаданной.
- **DD-297 (Locked, D3-D-B).** **`approved` — терминальный внешний вердикт; completion выводится из
  report workspace, `ata.lesson-progress.v1` не пишется.** Хранимая машина `pending-review →
  approved`; approved read-only по конструкции (`withEntryField`/`withSummary` возвращают тот же
  объект), не resubmit-абелен, повторно не аппрувится, revision-adapter на него не действует; review
  сохраняется как история; XP не меняется. Completion L3 проецируется на сессию чистым слоем
  (`approvedReportLevelNumbers`, `sessionWithApprovedReports` через канонический `withCompletedLevel`)
  — второго store/route-resolver/ключа completion нет, следующий уровень открывает существующий
  резолвер, augmentation только добавляет completion и идемпотентна. `blockedNote` исчезает только
  после валидного approval. Подключено в report route/experience, Lessons Library и Path; Home — нет.
- **DD-298 (Locked, D3-D-B).** **Approved verdict adapter — `?verdict=approved`** (расширение
  DD-291). `ReportVerdictAdapter = "revision-requested" | "approved"`; резолвер exact-match, всё
  неизвестное (включая `rejected`, `auto-approved`, `mentor-approved`) → null. Adapter работает
  только при `scenario === "report"` ∧ статус `pending-review` ∧ отчёт ready ∧ вердикт ещё не
  применён; допускает approved на resubmitted pending-review с сохранённым review. Пишет только
  workspace v3, не создаёт mentor identity/feedback, ставит `approvedAt` детерминированным clock-
  адаптером, при storage failure **остаётся pending-review** (никакого fake success), повторный
  запрос — no-op. Ни одного пользовательского href/кнопки «Одобрить»; автоматического approved нет.
- **DD-299 (Locked, D3-D-B).** **Browser-local verdict — provisional frontend prototype state, не
  аутентифицированная backend-истина.** Frontend не может криптографически подтвердить происхождение
  structurally valid localStorage-вердикта и не притворяется: подписи/токены/хеши не добавляются
  (тот же клиент их бы и проверял — это не security boundary). Malformed/unsupported/inconsistent
  approved fail closed; `dev/test · provisional` остаётся видимым в approval-контексте; реальный
  authoritative mentor verdict потребует backend.
- **DD-300 (Locked, D3-D-B).** **Base-completed vs approval-induced distinction.** Вычисляются
  **base availability** (канонический marker + обычная сессия, до report-augmentation) и **effective
  availability** (после). Approved-презентация определяется **не** только итоговым `completed`:
  approval-induced ⇔ base ≠ completed ∧ status approved. При canonical completed L3 (Artem L18) —
  обычный нейтральный archive: локальный approved не переименовывает уровень, «Одобрено» и approved-
  CTA не показываются, currentLevel=18 неизменен. Закреплено unit- и E2E-регрессиями.

- **DD-301 (Locked, D4-A).** **Tools scope зафиксирован до реализации.** Первый Tools vertical slice —
  hub `/tools` + первый инструмент **Trading Journal** (unlock target L10). Scope, states, privacy
  boundary и non-scope — `docs/D4_TOOLS_SCOPE.md`. D4-A — только scope + art direction; production
  React (`D4-B`) не начинается без явного выбора направления.
- **DD-302 (Locked, D4-A).** **Unlock — через существующий progression resolver, без новой логики.**
  Доступность инструментов выводится из тех же checkpoint-строк curriculum
  (`fixture.ts` `CHECKPOINT_ROWS`), что и уровни. Никаких новых thresholds/условий. Для Артёма (L18)
  открыты Trading Journal (L10) и Risk Calculator (L15); дальше — locked previews. Locked-инструмент
  показывает только имя + «Откроется на уровне N», без CTA/countdown/«осталось X».
- **DD-303 (Locked, D4-A).** **Manual per-trade value boundary.** Trading Journal может хранить
  введённый вручную результат **отдельной** сделки как простое число. Это значение **не** баланс,
  **не** баланс Pocket, **не** агрегируется в P/L, **не** используется для доходности/процентов/
  прогресса, **не** влияет на XP, **не** открывает уровни, **не** подтверждает checkpoint, **не**
  синхронизируется/импортируется. Представление — всегда вторичное к решению и выводу; итоговой
  строки/суммы/среднего/win-rate/%/графика нет. Отсутствие результата — полноценное нормальное
  состояние записи. Продолжение финансовой приватности ATA. **Поправка владельца (2026-09-21, в
  чате: «разрешаю»):** для инструмента Personal Stats (L25) запрет на win rate и проценты снят —
  там показываются доли и количества по записям журнала; денежных сумм нет по-прежнему (DD-304,
  DD-319).
- **DD-304 (Locked, D4-A).** **No-financial-aggregate rule для Tools.** Ни одна поверхность Tools не
  вычисляет и не показывает денежный агрегат. Допустимы только **нефинансовые** сводки (кол-во
  записей, «открыт на L10») — количество/статус, но не деньги.
- **DD-305 (Locked, D4-A).** **Минимальный `JournalEntry` (prototype-only структура).** Поля: дата/
  время, инструмент, направление, сетап/идея, что планировал, что сделал, вывод/урок, необязательный
  ручной результат, `createdAt`/`updatedAt`. **Запрещены** `accountId`, `brokerId`, депозит, баланс,
  процент доходности, импорт сделки. Конкретные RU-подписи — provisional, не канон (уточняются
  редакцией), как report-поля D3-B (DD-274).
- **DD-306 (Locked, D4-A).** **Browser-local, ручная природа + честная подпись.** Trading Journal —
  browser-local (модель report-workspace, `localStorage`; ключ фиксируется в D4-B), не серверная
  синхронизация. Обязательная канонная подпись на поверхности: «Записи вводятся вручную и не
  синхронизируются с брокером.» Backend/Pocket/import в D4 не реализуются; будущая API boundary
  описана в `D4_TOOLS_SCOPE.md` §11 без реализации.
- **DD-307 (Locked, D4-A).** **Три структурно разных направления, победитель не выбран.**
  A «Operational Ledger» (лента-нить времени), B «Trade Debrief Workspace» (доминирующий объект +
  подчинённая рейка), C «Structured Field Notebook» (Learning Spine с триптихом план→исполнение→урок).
  Пространственные системы, signature-объекты и геометрия навигации/прогресса различны
  (`docs/D4_TOOLS_ART_DIRECTION.md`). Прототипы изолированы в
  `design-memory/proposals/d4-tools/` (DD-260), не в `src`/`BUILT_ROUTES`/navigation, не пишут
  `localStorage`. 6 реальных Chromium-кадров 1440×900, horizontal overflow 0px. Направление выбирает
  пользователь; React (D4-B) заблокирован до выбора.

- **DD-308 (Locked, D4-B).** **Выбранное направление — «Structured Operational Spine» (гибрид A+C).**
  Из трёх D4-A направлений (DD-307) пользователь выбрал осознанный гибрид: **Tools Hub** на основе
  Direction A «Operational Ledger» (одна широкая вертикальная лента-нить инструментов, узлы подписаны
  уровнем открытия; Trading Journal — текущий рабочий инструмент с одним CTA; locked/coming-soon —
  спокойные строки той же ленты; **не** card grid, **не** marketplace, **не** узкий Path-клон), а
  **Trading Journal** на основе Direction C «Structured Field Notebook» (нумерованный spine, форма
  новой записи в голове потока, триптих **ПЛАН → ИСПОЛНЕНИЕ → УРОК**, урок доминирует, денежный
  результат вторичен, запись раскрывается/сворачивается на месте). Из A заимствованы спокойная
  временная структура, состояние «Денежный результат не указан» и лёгкая форма добавления. Direction B
  (доминирующая dashboard-карта + боковой archive rail + симметричный two-column) **не** используется.
- **DD-309 (Locked, D4-B).** **Resolver-owned unlock + unlocked-but-unimplemented state.** Доступность
  инструмента вычисляется исключительно каноническим progression-резолвером `levelProgressState`
  (`path-state.ts`) — тем же, что читают Главная/Путь/Уроки. Инструмент открыт, когда его checkpoint-
  уровень **пройден** (`completed`), а не когда пользователь стоит на нём. React ничего не
  переопределяет: нет ручного сравнения `currentLevel`, нет хардкода L10/L15, нет URL-query как
  production unlock-bypass. `available` = `unlocked && implementationStatus === "available"`; только
  такой инструмент получает рабочий route/CTA. Для Артёма (L18): Trading Journal — unlocked+available
  (current), Risk Calculator — unlocked, но `coming-soon` («Открыт по прогрессу · инструмент
  готовится», без CTA), дальше — locked («Откроется на уровне N»). Risk Calculator в D4-B не строится.
- **DD-310 (Locked, D4-B).** **Browser-local store `ata.tools.trading-journal.v1`, create/edit/list
  only.** Trading Journal хранится в `localStorage` (модель report-store, DD-266): версия 1, форма
  `{ version: 1, sequence, entries: JournalEntry[] }`. Parser fail-closed: неизвестная version →
  пустое каноническое состояние (не corrupt); повреждённый ROOT (битый JSON / чужая структура) →
  пусто + `corrupt: true` (спокойное объяснение, без raw payload); отдельная malformed/duplicate-id/
  invalid-ISO/unknown-direction/non-finite-result запись отбрасывается целиком (не воскрешается
  частично). Write формируется полностью до `setItem`; failed write не меняет in-memory canonical
  state и честно показывает `storage-error` (draft сохраняется, retry возможен) — никакого optimistic
  success. Реализованы только create / read-list / edit; **нет** delete/restore/duplicate/bulk/
  attachments/import-export/tags/filter/search/pagination/statistics/charts. Никаких write в
  `ata.lesson-progress.v1` или report-ключи; никакого cross-tab listener; никакого backend/broker
  sync. `manualResult` — необязательное конечное число отдельной записи (DD-303), вторичное к уроку,
  без агрегатов (DD-304); журнал **не** влияет на XP/уровни/checkpoint. Маршруты `/tools`,
  `/tools/[toolCode]` добавлены в `BUILT_ROUTES` и production navigation. Полная модель — `docs/TOOLS_STORAGE.md`.

- **DD-311 (Locked, D4-B1).** **Явные locale-independent RU date/time контролы вместо native
  `datetime-local`.** В русскоязычном UI Chromium рисует `datetime-local` в US-локали
  (`MM/DD/YYYY, hh:mm AM/PM`), на что нельзя полагаться. Форма Trading Journal использует **два
  явных текстовых поля**: «Дата» (`ДД.ММ.ГГГГ`) и «Время» (24-часовой `ЧЧ:ММ`) — без AM/PM, без
  date-picker-зависимости. Чистый adapter (`parseDateTimeInput` / `isoToDateInput` / `isoToTimeInput`,
  `journal-entry.ts`): visible date+time → canonical ISO `occurredAt` и обратно при edit. Fail-closed:
  невозможные календарные даты (31.02, месяц 13, день 0, 29.02 в невисокосный год) и out-of-range время
  (24:00, 09:60) отклоняются. **Persisted `JournalEntry` schema и storage version (v1) не меняются**;
  существующие записи (любой валидный ISO) остаются читаемыми. Timezone-семантика зафиксирована явно:
  wall-clock компоненты трактуются **литерально** (UTC `Z`) — что ввёл, то и отображается,
  детерминированно и TZ-независимо; это согласуется с уже литеральным дисплеем `journal-format.ts` и
  устраняет прежний local→UTC-дрейф. inputMode="numeric", настоящие label'ы, per-field ошибки.
  **В TOOLS-V2 (DD-331, 02.10.2026):** дата и время сделки — собственные поля продукта с панелью
  выбора; браузерных полей даты и времени в инструментах нет.
- **DD-312 (Locked, D4-B1).** **Mobile current-tool — вертикальная композиция.** В компактном режиме
  (ниже 900px desktop-брейкпоинта, включая 200%-reflow 720px) строка текущего инструмента на Tools Hub
  перестраивается в `[node | body]`, а CTA «Открыть журнал» уходит **на отдельную строку под текстом**
  (content-width, touch target ≥44px), чтобы не делить строку с описанием и не сжимать его. Spine и
  связь node↔инструмент сохранены; строка остаётся строкой ленты, **не** generic full-width marketing
  card. Прежний узкий 3-колоночный layout (node | body | CTA) оставлен только для desktop (≥900px).
- **DD-313 (Locked, D4-B1).** **Bottom-nav scroll clearance — ответственность страницы Tools.** Нижний
  отступ владеется на уровне `.th-page/.ts-page/.je-page`:
  `calc(var(--mobile-bottom-nav-height) + env(safe-area-inset-bottom) + 44px)`. Любой последний
  интерактивный контрол — «Редактировать» записи, submit/cancel формы, retry при storage-error —
  полностью прокручивается выше fixed bottom navigation с видимым зазором (E2E проверяет геометрически
  `control.bottom ≤ nav.top − 8` на 390/320/720). Проблема не компенсируется скрытием контрола или
  уменьшением target.

- **DD-314 (Locked, D4-C).** **Risk Calculator — ручной калькулятор позиционного риска на
  сигнатурном Price Rail.** Инструмент `tool.risk_calculator` реализован и доступен на **L15** через
  тот же канонический resolver (`levelProgressState`), что и все остальные unlock'и: для Артёма (L18)
  открыт и получает рабочий CTA, ниже L15 остаётся locked (форма не монтируется). Канонический
  маршрут — `/tools/tool.risk_calculator` через существующий `/tools/[toolCode]`; новой route-
  архитектуры нет. **Утверждённое направление A+B:** доминирует Direction A «Price Rail» (входы слева
  · измеренный entry/stop Price Rail в центре как signature object · output-ledger справа); Direction B
  добавляет **только** компактную sticky result-strip на mobile в valid-состоянии. Не ticket, не
  чек, не broker order confirmation; на mobile нет submit/order-кнопки.
  **Формулы (чистая модель `risk-calculation.ts`, без React/DOM/storage/fetch):**
  `riskAmount = capital × risk% / 100`; `stopDistance = |entry − stop|`;
  `stopDistancePercent = stopDistance / entry × 100`; `positionUnits = riskAmount / stopDistance`;
  `positionNotional = positionUnits × entry`; направление `long` при `stop < entry`, `short` при
  `stop > entry`, `stop == entry` — invalid. Ввод — контролируемые строки (`inputMode="decimal"`, не
  `type=number`): цифры + один разделитель `.`/`,`; отвергаются знак, экспонента, внутренние пробелы,
  разрядные и множественные/смешанные разделители, non-finite. Результат — дискриминированный
  `incomplete | invalid | valid`; никогда `NaN`/`Infinity`; сверхбольшие значения fail-closed как
  invalid. Формат — детерминированный RU-locale, без научной нотации, без `-0`, без валютного символа
  (валюта не выбрана, DD-303). **«Расчётный капитал» — временный вход расчёта**, не баланс, не
  подключённый счёт, не fetch, не persist. **Никакого storage/fetch/XP/progression/journal/report
  write** — refresh сбрасывает все четыре поля и результат; ключа `ata.tools.risk-calculator` не
  существует (доказано unit/component/E2E-тестами). Обязательный дисклеймер виден всегда: «Ручной
  учебный расчёт. Данные не синхронизируются со счётом или брокером и не являются инвестиционной
  рекомендацией.» CTA на Tools Hub теперь per-tool (`ctaLabel`): «Открыть журнал» / «Открыть
  калькулятор» — один общий label больше не хардкодится. Featured «рабочий инструмент» = самый
  высокий доступный (Risk Calculator L15 > Trading Journal L10); поведение самого журнала не менялось.
  **Вне scope D4-C:** история/persist калькулятора, другие инструменты, mentor, practical, backend.

- **DD-315 (Locked, TOOLS-V2, 2026-09-21).** **Шесть инструментов вместо девятнадцати; инструмент — своя
  страница в той же вкладке.** Решение владельца по презентации «Окна инструментов ATA». Каталог:
  Trade Card (L5, открывается **уроком** «Жизненный цикл сделки»), Trading Journal (L10), Risk
  Calculator (L15), Entry Checklist (L20), Personal Stats (L25), News Calendar (L30); прежние
  инструменты — заглушки и выведены (DD-301/DD-305/D4-C для журнала и калькулятора больше не
  действуют: оба пересобираются). Инструмент — страница `/tools/<slug>` **в той же вкладке**, внутри
  оболочки Академии, с кнопкой «Все инструменты» (см. поправку ниже). Данные — **на сервере, по ученику**, без экспорта
  и удаления (**пересмотрено DD-328, 01.10.2026:** запись Trading Journal ученик удаляет сам);
  **менторы и поддержка их не видят**. Доступ — только вердикт Backend (`toolAccess`).
  Закрытый инструмент показывает «Закрыто · сейчас LN», «Откроется на уровне N», причину словами
  презентации и следующий шаг «Продолжить путь»; превью и примера нет. Порядок работы: по
  одному инструменту — сборка, ревью владельца, правки, следующий. **Слайс 1 — Trade Card:**
  5 шагов (Подготовка · Открытие · Экспирация · Результат · Разбор; шаги 2–4 идут по часам ученика
  от времени входа и экспирации и ничего не блокируют), «Зафиксировать план», одна открытая карточка
  на ученика (гарантирует база), «Изменить план», результат «Прибыль / Убыток», наблюдение,
  «Сохранить карточку», «Сделку не открывал» (с подтверждением). Деньги — только два исхода
  **одной** сделки (ставка × payout / −ставка); агрегатов нет — DD-303/DD-304 соблюдены.
  Направление не выбирается за ученика.
  **Поправка после ревью владельца (2026-09-21):** (1) тона — как на остальных страницах продукта:
  ДНК «Уроков» (ровный Ink-фон frozen-оболочки, одна оливковая территория с коротким сегментом
  Signal, Manrope + узкий Mono-слой, линии с ролями, радиус 8, Signal только для главного действия,
  текущего шага и фокуса; результаты — route-completed / приглушённая роза, как в Support); засечный
  шрифт и вид «окна» убраны; (2) кнопок и превью «Как будет выглядеть» нет; (3) инструмент адаптирован
  под все экраны: на телефоне одна колонка (шаги — полоски и строка «Шаг N из 5 · …», поля и
  переключатели 48 px), на планшете поля в три колонки, с 900 px план и исходы рядом (колонка исходов
  и действия закреплены при прокрутке); (4) **та же вкладка** вместо новой, в начале каждого
  инструмента — «Все инструменты», после сохранения — «Новая карточка» · «Все инструменты». Первое
  чтение карточки делает сервер, поэтому инструмент приходит уже отрисованным; всё, что зависит от
  часов ученика (время входа по умолчанию, шаги, «Зафиксировано HH:MM»), дорисовывается в браузере.
  Арт-дирекция задана владельцем: «как на других страницах продукта».
  **Поправка DD-330 / DD-331 (02.10.2026):** payout — целое от 20 до 99; «Время входа» — поле
  продукта с маской «ЧЧ:ММ» и панелью выбора.
- **DD-316 (Locked, TOOLS-V2, 2026-09-21).** **Trading Journal (L10) — слайс 2.** Журнал —
  разбор уже открытых сделок; с учётом всех правок ревью Trade Card (тона «Уроков», та же вкладка и
  «Все инструменты», без превью, все ширины, первое чтение на сервере). **Два источника записи:**
  (1) карточка Trade Card, сохранённая **после** открытия журнала, — Backend пишет запись в той же
  транзакции, что и карточку (причина входа → ПЛАН, наблюдение → ВЫВОД); сделку такой записи журнал
  не редактирует; карточки, сохранённые до L10, не переносятся (ответ владельца 5); (2) «Новая
  запись» — сделка, открытая без карточки: дата, время входа, актив, направление, сумма, payout,
  экспирация, результат, «План до входа» (если был) и разбор; такую запись можно «Изменить запись»
  целиком. **Разбор** — всегда самого ученика (ответ 7): «План соблюдён?» (По плану / Нарушен /
  не отмечено), при нарушенном плане — отметки из восьми фиксированных правил (вход без записанной
  причины, рядом важная новость, сделка после дневного лимита, сумма больше плана, хотел
  отыграться после убытка, вход не по своему setup, усталость или невнимательность, другое),
  «Исполнение», «Вывод». **Список:** счётчики «Записей · По плану X из N · Без вывода» — только
  числа записей, денежных итогов нет (DD-303/DD-304; у строки — своя ставка и свой результат);
  фильтры «Все / План нарушен / Нет вывода» из презентации; сделки сгруппированы по дням, как
  модули в «Уроках» (индексная риска, дата, день недели словами); с 900 px сделка — одна строка
  реестра с колонками, ниже — две строки; запись раскрывается на месте: ПЛАН · ИСПОЛНЕНИЕ ·
  ВЫВОД · НАРУШЕНИЯ; «Показать ещё» — по 20. **Ничего не удаляется** и не экспортируется (ответ 4).
  **Пересмотрено DD-328 (01.10.2026):** любая запись — и из карточки — изменяется целиком и
  удаляется; экспорта по-прежнему нет.
  Дата сделки — календарный день **ученика**, её считает браузер (для карточки — день ближайшего к
  моменту фиксации плана времени входа); Backend принимает даты с 2020-01-01 до «завтра по UTC».
  «Разобрать в журнале» в сохранённой карточке открывает разбор именно этой сделки. Менторы и
  поддержка журнал не видят: staff-маршрута нет. Хранение — `ToolJournalEntry` и
  `ToolJournalViolation` (миграция 56) с проверками в самой базе.
  **Поправка DD-330 / DD-331 (02.10.2026):** payout — целое от 20 до 99; дата и время входа —
  собственные поля продукта вместо браузерных.
- **DD-317 (Locked, TOOLS-V2, 2026-09-21).** **Risk Calculator (L15) — слайс 3, модель бинарных
  опционов.** Пересобран по презентации (ответ владельца 10): у бинарного опциона нет стопа, риск
  сделки — вся её сумма, поэтому цена входа и стоп прежнего калькулятора (D4-C) убраны. **Ввод:**
  торговый капитал ($1 – $1 000 000), payout (1–100%), доля риска на сделку — только 1, 2, 3 или 5%
  (как учат L11–L14), дневной лимит потерь (1–100% капитала). **Расчёт** (одинаковый в Backend и
  Академии, до цента): сумма сделки = капитал × доля («$8.00 · 2% от $400»); исходы «+$7.20 /
  −$8.00»; дневной лимит в долларах и в убыточных сделках до стопа («$24.00 · 3 убыточные сделки →
  стоп»; если одна сделка больше лимита — предупреждение); безубыточный win rate = 1 / (1 + payout)
  («52.6%»); серия из 5 убытков подряд: фиксированная сумма («−$40.00 · 10%») и удвоение после
  убытка («−$248.00 · 62%», 8 + 16 + 32 + 64 + 128; если капитал кончается раньше — «больше
  капитала», «хватит на N из 5»). Полосы серии — доля капитала, не украшение. **Капитал — число
  ученика для плана**: не читается из Pocket и не является балансом; все цифры — арифметика плана
  по введённым числам, а не сумма сделанных сделок, поэтому DD-303/DD-304 не нарушаются. **Правила
  плана** — «Сценарий» и «Условие отмены», задаются заранее (3–1000 символов). **Risk Plan хранится
  версиями** (вопрос о версиях владелец не решал; выбрано так, потому что данные инструментов не
  удаляются): «Сохранить Risk Plan» добавляет версию, новейшая — план в силе, ранние — в «Предыдущие
  версии» (до 10), ничего не правится и не удаляется; сохранение без изменений версию не добавляет.
  Статус плана — в заголовке «Параметры», как «Зафиксировано» в Trade Card: Signal только пока форма
  показывает план в силе, после правки — «Версия N · изменения не сохранены» и «Вернуть план в силе».
  Других инструментов калькулятор не заполняет (ответ 8). Хранение — `ToolRiskPlan` (миграция 57).
  **Пересмотрено DD-330 (02.10.2026):** payout — целое от 20 до 99 (было 1–100).
- **DD-318 (Locked, TOOLS-V2, 2026-09-21).** **Entry Checklist (L20) — слайс 4.** Девять
  **фиксированных** пунктов (ответ владельца 9) в трёх группах, как в презентации: **Среда** — рядом
  нет важной новости (±15 мин) [стоп-фактор], связь стабильна [стоп-фактор], payout не ниже моего
  минимума; **Setup** — состояние рынка определено (тренд или боковик), цена у зоны, отмеченной до
  сессии, все условия моего setup выполнены; **Моё состояние** — дневной лимит не достигнут
  [стоп-фактор], нет желания отыграться [стоп-фактор], внимание на графике, не устал. Все отметки
  ставит ученик, ничего не отмечается автоматически и не берётся из Pocket, новостей или других
  инструментов (ответ 8). **Вердикт** (одинаковое правило в Backend и Академии; сохранённый
  вердикт всегда считает сервер): любой неотмеченный стоп-фактор → «Не входить: стоп-фактор»
  (главнее всего); иначе любой неотмеченный пункт → «Не входить: условие не выполнено»; все девять →
  «Вход по плану допустим. Все условия выполнены. Решение и сумму вы подтверждаете сами.» Вердикт
  называет первый неотмеченный пункт по порядку списка; до первой отметки панель нейтральна
  («Отметьте, что выполнено»), а не «не входить». **Проверка записывается** («Записать проверку»):
  актив (обязателен), «мой минимум payout» (по желанию; подставляется из последней проверки),
  девять ответов и вердикт; «не входить» записывается так же — отказ от сделки полноценное решение
  (L08). Проверки не правятся и не удаляются; ниже списка — «Последние проверки» (до 20).
  Хранение — `ToolEntryCheck` (миграция 58): девять символов «0/1» по порядку списка (версия списка
  1) и проверки в самой базе, что вердикт и названный пункт не противоречат ответам.
  **Поправка DD-330 (02.10.2026):** «мой минимум payout» — целое от 20 до 99 или пусто.
- **DD-319 (Locked, TOOLS-V2, 2026-09-21).** **Personal Stats (L25) — слайс 5.** Считается
  **только по записям Trading Journal** и отметкам самого ученика; ничего из Pocket. Периоды «7 дней /
  30 дней / Всё время» — календарные дни ученика (браузер присылает свою дату, сервер проверяет, что
  она в пределах суток от UTC); «Всё время» даты не требует, поэтому первое чтение делает сервер.
  **Цифры, как в презентации:** сделок в журнале; win rate («55% · 21 из 38»); безубыточность =
  1 / (1 + средний payout) («53.2% при среднем payout 88%»); доля сделок по плану («82% · 31 из 38»,
  плюс «N без отметки»); win rate «План соблюдён» против «План нарушен» на шкалах 0–100% с отметкой
  безубыточности (выше отметки — зелёный, ниже — розовый; сторона меньше 5 сделок — без цвета и с
  подписью «Меньше 5 сделок — рано делать вывод», чтобы одна удачная сделка с нарушением не выглядела
  как «нарушать выгодно»); нарушения по правилам, чаще встречающиеся первыми. Меньше 50 сделок —
  «Выборка — N сделок, выводы предварительные». **Только количества и доли, никаких денег** —
  поправка владельца к DD-303 (win rate и проценты разрешены для этого инструмента), DD-304 в силе.
  Инструмент только читает: своей таблицы и миграции нет.
- **DD-320 (Locked, TOOLS-V2, 2026-09-21).** **News Calendar (L30) — слайс 6, и публичные новости.**
  **Новости** вручную вносит сотрудник с ролью **«Копирайтер»** в CRM (ответ владельца 11): страна (она
  задаёт валюту), важность ● / ●● / ●●●, дата и время выхода в выбранном поясе (хранится один момент
  UTC), прогноз / предыдущее / факт, название, лид (он же описание для поиска), текст абзацами, источник
  https. Новая новость — черновик; «Опубликовать» — только сохранённую версию; «Снять с публикации»
  убирает страницу и строку календаря, но не запись и не адрес; адрес (`/news/<slug>` латиницей из
  страны, названия и даты) закрепляется при первой публикации. Роль «Копирайтер» держит одно право
  `news_publish` (его же держит `crm_admin`) и **не видит учеников**: чтение списка, карточки и
  ответственного теперь требует `view_users`, выданного всем прежним ролям. **Каждая опубликованная
  новость — своя страница** `/news/<slug>` и строка в списке `/news` (ближайшие, затем прошедшие),
  в визуальной системе публичной главной; время на странице — UTC, браузер добавляет «у вас 14:30».
  **Индексация (решение владельца):** на PROD индексируются только публичная главная и новости,
  всё остальное — noindex; **на PREPROD не индексируется ничего**. Одна настройка окружения
  (`ACADEMY_SEARCH_INDEXING=on` + `ACADEMY_PUBLIC_ORIGIN`), по умолчанию выключена: каждая страница
  отвечает `X-Robots-Tag: noindex, nofollow`, sitemap пуст, robots.txt пускает краулеров, чтобы они
  видели noindex; на PROD — canonical, Open Graph, NewsArticle и sitemap. **Инструмент** — окно из
  презентации: часовой пояс («Всё время на странице показано в выбранном поясе»), строка «Вход закрыт
  по вашему плану до 14:45 — Через 12 мин: USD · … Первое движение после публикации — только
  наблюдение», шкала дня (полночь–полночь в поясе ученика, 23/25 ч в дни перевода часов) с
  заштрихованными окнами и «сейчас», события дня (время · валюта · название — ссылка на страницу
  новости · важность · прогноз / факт · «прошло / скоро», «вход закрыт 14:15–14:45» или «вне вашего
  плана»), дни −7…+14. **План по новостям — ученика** (L29): какие новости закрывают вход (только
  высокая или средняя и высокая), минуты до и после (5/10/15/30/60), валюты своих активов; до
  сохранения ничего не выбрано, кроме пояса браузера, и окон нет; окна считаются по сохранённому плану;
  план хранится версиями, как Risk Plan. Хранение — `NewsItem` и `ToolNewsPlan` (миграция 59).

- **DD-321 (Locked, PUBLIC-HOME-HIFI, 2026-09-22).** **Публичная главная: маршрут и окно
  продукта вместо вставок-макетов.** Владелец (22.09.2026): вставки — презентация функционала,
  а не снимки экрана; из трёх направлений гейта (Линза / Маршрут открытий / Окно в продукт)
  выбрано слияние B+C. Середина страницы — один маршрут уровней (`#product` — маршрут, `#path`
  и `#tools` — его сегменты, тот же порядок документа, те же якоря) с узлами Старт · L1 · L2 ·
  L3 · 01 · L5…L30; справа закреплённое окно продукта показывает состояние достигнутого узла
  (Главная на L3 с реальным next-action, Путь модуля 01, шесть инструментов их же словами).
  Шесть шагов инструментов берутся из каталога `TOOL_WINDOWS`; окно — презентационные копии
  объектов продукта в его материалах, не компоненты продукта и не растровые снимки; данные
  синтетические, один бейдж «Демонстрационный пример» в панели окна. Движение: линия
  дорисовывается до активного узла (420 мс), окно меняет состояние за 240 мс, у каждого
  состояния один момент ≤ 900 мс, один раз; reduced-motion — конечные состояния. На публичной
  странице по-прежнему нет брокера, депозитов, сумм, лиц; обучение бесплатно (FAQ). Слайс 0 той
  же даты: невидимая ссылка «Войти» на бумаге, квадратные уголки рамки на телефоне
  (`border-width` + preflight), компактная шапка, FAQ одним списком + FAQPage/Organization и
  og:image только на индексирующем хосте (`og/` исключён из auth-матчера). Ревью с реальными
  снимками: `design-memory/reviews/public-home-hifi-review.md` (87/100).
- **DD-322 (Locked, PUBLIC-HOME-HIFI, 2026-09-22).** **Движение на публичной главной — три
  последовательности, каждая один раз.** По правилам продукта (функциональное 140–240 мс,
  последовательности ≤ ~1 с, без бесконечных анимаций, reduced-motion → конечные состояния):
  `#decide` — «многое → одно»: чипы чужих ответов отступают к оси и гаснут, ось дорисовывается
  до точки, основание решения вписывается в рамку, затем утверждение (≈ 960 мс); `#mechanism` —
  Signal-линия рисуется поверх hairline слева направо, узлы 01–06 загораются по очереди, на
  телефоне линия идёт вниз по центрам узлов (≈ 950 мс); `#review` — при появлении V2
  исправленное место пульсирует один раз. Все три запускаются от `is-visible` reveal-наблюдателя
  и не повторяются при обратной прокрутке. Reveal теперь гейтится маркером JS
  (`.ph.has-js [data-reveal]`): без скрипта ничего не скрыто (0 из 32 элементов). На телефоне
  reveal включён облегчённым (12 px, 360 мс, без задержек) вместо статичного. Тесты-стражи
  переписаны: лёгкий reveal ниже 920, гейт на JS, ограничение длительностей и задержек, три
  триггера существуют, циклов нет.
- **DD-323 (Locked, PUBLIC-HOME-HIFI, 2026-09-22).** **«Проверка работы» — в окне продукта.**
  По слову владельца («этому блоку тоже нужен хай фай») четыре авторские карточки `#review`
  заменены окном продукта: рабочее пространство отчёта L3 «Первые пять demo-сделок» с
  настоящими записями и полем «Причина входа до сделки», настоящей панелью статуса и словами
  ученика («Отчёт отправлен и ожидает проверки наставника», «Наставник запросил доработку» ·
  «Причина: Требуется доработка» · критерий «Причина до сделки», «Работа принята», «Отчёт принят —
  уровень завершён»). Окно проходит те же четыре состояния V1 → Разбор → V2 → Принята; полоса
  под окном хранит их словами и управляет окном (кнопки с `aria-pressed`) — тесты читают полосу.
  Движение: последовательность играет один раз при появлении, 1,5 с на состояние, 4,5 с всего —
  единственный кинематографический момент страницы; клик останавливает; reduced-motion — без
  автопрокрутки; без скрипта — первое состояние и полоса. Строки решения вынесены в
  `review-data.ts` и общие для hero, `#decide` и окна. **Поправка DD-329 (01.10.2026):** плашки
  «V1 / Разбор / V2 / ✓» с карточек полосы сняты.
  **Поправка DD-333 (02.10.2026):** карточка полосы нажимается целиком (вместе с объектом внутри)
  и отвечает подсветкой; один раз полоса показывает это сама.
- **DD-324 (Locked, PUBLIC-HOME-HIFI, 2026-09-22).** **«Решение» — в окне продукта.** Рамка
  решения в `#decide` заменена окном продукта: Trade Card (L5) в момент записи причины — актив,
  направление, экспирация, payout, поле «Причина входа до сделки» с той же строкой, что в V2
  проверки, «Зафиксировано 17:20». Рамка в hero остаётся (для видео). Последовательность
  «многое → одно» сохранена и ведёт в окно. Окна всех трёх секций — один и тот же кадр продукта
  (`.pw`); его единственная колонка `minmax(0, 1fr)`, чтобы содержимое не расширяло кадр.
- **DD-325 (Locked, PUBLIC-HOME-HIFI, 2026-09-22).** **«Цикл» — шесть шагов в объектах продукта.**
  Каждый шаг `#mechanism` заканчивается объектом, в котором он происходит в продукте: урок L5 с
  прогрессом чтения; поле «Причина входа до сделки» с записанным основанием и «Зафиксировано»;
  следующее действие «Выполните практический шаг»; проверка знаний «Вопрос 3 из 5 · Для завершения —
  100 %»; возврат «Наставник запросил доработку»; «Уровень завершён» с путём L5 → L6 → L7. Шесть
  объектов шести форм в материалах и словах продукта; ни одной суммы, ни одного ученика. Объекты
  появляются вслед за узлами линии (240 мс, задержки 140…790 мс, один раз); reduced-motion —
  конечные состояния. Правила списка цикла адресуют только прямых детей (`.learning-loop > li`);
  телефонная колонка цикла (вертикальная линия, отступы шага) — с 680 px, как и её раскладка.
  **Поправка DD-329 (01.10.2026):** шаги и объекты — по центру, узлы 44 px с читаемой цифрой,
  разделительные линии сняты, шесть колонок переходят в три на 1340 px.
  **Поправка DD-333 (02.10.2026):** линия цикла рисуется под узлами.

- **DD-326 (Locked, NEWS, 2026-09-22).** **Новости — контент продукта, не публичная и не индексируемая
  поверхность; на PROD — приём по API с правкой копирайтером.** Владелец (22.09.2026): «в инструмент
  данные будут поступать по api со стороннего сервиса, это реализуем уже на проде, копирайтер должен
  иметь возможность их редактировать, и эти новости всё-таки не индексируем для поисковиков и убираем
  с публичной страницы». Отменяет публичную часть DD-320: (1) индексируется только публичная главная
  и только на PROD (`isIndexablePath` = «/»); страницы `/news` и `/news/<slug>` всегда `noindex`, без
  canonical, Open Graph, NewsArticle и sitemap; (2) `/news*` закрыты для анонимных, как остальной
  продукт (middleware + проверка сессии на самой странице), вход к ним — из навигации продукта и из
  строк News Calendar; ссылка «Новости» с публичной главной снята; (3) CRM-редактор копирайтера
  остаётся источником правды: роль `copywriter`, право `news_publish`, черновик → публикация, адрес
  закреплён при первой публикации. **Контракт приёма по API (реализуется на PROD, схема — миграцией
  тогда же):** у `NewsItem` появляются `source` (`manual` | `api`), `externalId` (уникален в паре с
  источником), `syncedAt` и `editedAt`; загрузчик создаёт записи из внешнего календаря черновиками
  или опубликованными по правилу, которое задаст владелец; при повторной синхронизации обновляются
  только поля, которых копирайтер не трогал (правка копирайтера всегда старше синхронизации по
  приоритету), статус публикации и текст с правкой не перезаписываются; удаление во внешнем источнике
  не удаляет запись — только помечает. Провайдер и ключи — только в переменных окружения PROD.

- **DD-327 (Locked, ACCOUNT-RECOVERY, 2026-10-01).** **Сброс пароля, подтверждение и смена почты —
  фундамент; почтовый канал подключается на PROD.** Владелец (01.10.2026): «сделаем функционал для
  пользователей: сброс пароля / восстановление пароля, подтверждение и смена почты»; канал почты —
  «подключать будем уже на прод, нужен фундамент»; подтверждение — мягкое; на PREPROD почту не
  проверяем; только ученики. Решения:
  (1) **Ничего не обещается там, где письмо не уйдёт.** Backend сообщает возможности
  (`/api/auth/capabilities`); Академия читает их на сервере и закрыто по умолчанию: без почты нет
  ссылки «Забыли пароль?», строка Email в профиле остаётся прежней («через поддержку»),
  `/forgot-password` говорит «Пока недоступно». PREPROD — именно такой.
  (2) **Новой композиции нет.** Четыре страницы по ссылке из письма (`/forgot-password`,
  `/reset-password`, `/verify-email`, `/confirm-email`) — состояния принятой сцены входа; блок почты
  в профиле — строки принятой грамматики профиля (значение · состояние тихим тоном · одно текстовое
  действие; редактор открывается на месте; один редактор за раз). Поэтому art-direction gate не
  проводился — это суждение, оно вынесено владельцу в отчёте.
  (3) **Ссылка.** Токен едет во фрагменте (`#token=`), читается в браузере, сразу убирается из
  адресной строки и уходит на сервер в теле запроса. Открытие страницы ничего не подтверждает —
  подтверждает кнопка: почтовые сканеры открывают ссылки сами. Сессия не нужна: письмо могут открыть
  на другом устройстве. Ссылка, вставленная в ту же вкладку, читается (`hashchange`).
  (4) **Сброс** отвечает одинаково для любого адреса, закрывает все сеансы и никого не впускает:
  человек входит с новым паролем. Проверка Turnstile у формы своя (`academy_password_reset`).
  (5) **Смена почты** требует текущий пароль, показывается как ОЖИДАЮЩАЯ и вступает в силу только
  после ответа нового ящика; прежний адрес получает два уведомления с замаскированным новым адресом.
  (6) **Одно изменение гасит ссылки, отправленные до него** (Backend `account/lifecycle.ts`): смена
  или сброс пароля отменяет ожидающую смену почты (профиль говорит об этом один раз) и ссылку
  сброса; смена почты гасит ссылку сброса и ссылку подтверждения прежнего адреса; ожидающий адрес
  удерживается, пока жива его ссылка (24 ч).
  (7) **Поле — не идентичность, и у поля есть граница.** В формах профиля (смена пароля — уже
  выпущенная, и новая смена почты) каждое поле получило линию `--p-locus-rule-edit`, ширину рабочей
  колонки и размер поля 18 px вместо размера имени 28 px: раньше поля были невидимы до фокуса, а
  адрес обрезался на 25-м символе. Подсказка под полем отодвинута от кольца фокуса.
  (8) **Уголки сцены входа.** На ширине ≤ 640 px оба уголка рисовались закрытыми квадратами
  (`border-width` включал все четыре стороны) и на коротком телефоне пересекали первую букву
  заголовка; в сжатых ярусах уголки заходили в контент. Исправлено: ширины задаются по сторонам, в
  сжатых ярусах уголки меньше и стоят в отступе рамки. Новых breakpoint нет. Это меняет вид
  `/login` и `/register` на телефоне и на PREPROD.
  **Решено владельцем 01.10.2026:** ссылку «вернуть адрес» для прежнего ящика после завершённой
  смены почты НЕ делаем (она защищает от чужого, кто успел подтвердить первым, но даёт ту же силу
  тому, кто читает прежний ящик); такой случай — через поддержку. **Не в этой версии:** обязательное
  подтверждение почты; польские тексты писем; сотрудники CRM и партнёры.
  **Почта на PROD:** инженер настраивает отправку по разделу «Почта» инструкции по развёртыванию и
  возвращает данные; после этого добавляется один адаптер транспорта (владелец: «как сделает — так
  продолжим»).
  Проверка: 42 сквозные проверки в браузере на стенде с почтой в папку; ревью —
  `design-memory/reviews/account-recovery-v1-review.md`. **Выкачено на PREPROD 01.10.2026**
  (academy `0fde7aa`, backend `eb30a65`, миграция 60): функции там выключены, видимы исправления
  уголков и полей формы пароля.

- **DD-328 (Locked, TOOLS-V2, 2026-10-01).** **Trading Journal: любая запись изменяется целиком и
  удаляется.** Владелец (01.10.2026): «функционал изменения записи полноценный», «кнопка и
  функционал удаления записи полноценный». Пересматривает DD-315 («без … удаления») и DD-316
  («сделку такой записи журнал не редактирует», «Ничего не удаляется»). Решения:
  (1) **Изменение.** «Изменить запись» есть у КАЖДОЙ записи — записанной вручную и пришедшей из
  Trade Card: та же форма со всеми полями сделки (дата, время входа, актив, направление, сумма,
  payout, экспирация, результат, план) и разбором. Карточка Trade Card при этом не меняется: форма
  говорит это словами («изменения останутся в журнале, сама карточка не изменится»), а запись,
  которая разошлась со своей карточкой, помечена в строке фактов — «Из Trade Card · изменена в
  журнале». Признак считает Backend сравнением записи с карточкой (дата не сравнивается: у карточки
  её нет); вернули прежние значения — пометка исчезает.
  (2) **Удаление.** «Удалить» — у каждой раскрытой записи, отдельно от двух действий изменения: в
  дальнем конце строки, на телефоне — рядом с «Изменить запись», шириной в своё слово. Сначала
  вопрос на месте записи: «Удалить эту запись?» — «Она исчезнет из журнала и из Personal Stats.
  Вернуть её будет нельзя.» (Personal Stats считается только по журналу, DD-319), для записи из
  карточки — «Карточка в Trade Card останется.» Удаление настоящее (строка и её отметки нарушений),
  корзины и отмены нет; карточка остаётся сохранённой и второй записи сама не создаёт.
  (3) **Вопрос безопасен для клавиатуры и пальца.** Фокус встаёт на «Отмена»; Escape — то же, что
  «Отмена»; второе нажатие той же клавиши или второе касание в том же месте ничего не удаляет; пока
  запрос в пути, обе кнопки выключены и уходит ровно один запрос; после отмены фокус возвращается на
  «Удалить», после удаления — на строку, занявшую место удалённой (нет строк — на «Записать сделку»).
  (4) **Счётчики после удаления — ответ Backend**, прочитанный в том же шаге, что и удаление;
  последняя запись удалена — «Журнал пока пуст».
  (5) **Курсор не переживает свою запись.** «Показать ещё» продолжает от записи, и Backend отвечает
  отказом на неизвестный курсор: если удалена запись-курсор, курсором становится последняя строка
  на экране; если на экране не осталось строк, а записи ещё есть, список читается заново. Запись,
  удалённая в другой вкладке: «Этой записи уже нет — показываю актуальный журнал»; исчезнувший курсор:
  «Журнал изменился — показываю актуальный».
  (6) **Цвет удаления — роза убытка и ошибки** (`--tw-negative`), новый вариант кнопки `danger`:
  контур там, где действие предлагается, заливка — только на шаге, который удаляет. Signal остаётся
  цветом «вперёд» и здесь не используется. «Изменить запись» и «Отмена» в вопросе — кнопки с
  контуром: раньше «Изменить запись» была текстом без границы и не читалась как действие.
  (7) **Граница не расширена.** Одна новая операция прокси — `journal-delete`: DELETE на путь одной
  записи, id проверяется, CSRF обязателен, тело запрещено (запрос с телом отклоняется, а не
  отбрасывается молча). Маршрута для сотрудников по-прежнему нет; экспорта нет; денежных итогов нет.
  (8) **Порядок выкладки:** сначала Backend — он принимает и прежнее имя операции (`manual`), и
  новое (`entry`), поэтому действующая Академия продолжает работать, — затем Академия. Миграции нет.
  Art-direction gate не проводился: композиция журнала не меняется, в принятую строку действий
  раскрытой записи добавлены два действия и один вопрос в принятом образце `tc-confirm` (Trade Card,
  «Сделку не открывал») — это суждение, оно вынесено владельцу в отчёте.
  **Раскладка действий.** На телефоне разбор — полоса во всю ширину, «Изменить запись» и «Удалить» —
  пара под ней (в одну строку с 360 px; на 320 px «Удалить» уходит на свою строку, оставаясь справа);
  с 600 px — три действия в одну линию, которая не переносится. Подписи кнопок не переносятся
  никогда (на 360 px «Изменить запись» ломалась в две строки — найдено измерением).
  Проверка: 13 сквозных проверок в браузере на стенде (клавиатура, две вкладки, удалённый курсор и
  «Показать ещё», Personal Stats после удаления, телефон), измерения на 13 ширинах от 320 до 1440 —
  без переполнения, все действия 46 px; ревью —
  `design-memory/reviews/owner-fixes-2026-10-01-review.md`. **Выкачено на PREPROD 02.10.2026**
  (backend `c5694d7`, затем academy `4e06ef3`; миграции нет, резервная копия базы снята до
  выкладки). Сам журнал под учеником на PREPROD не проверялся: вход закрыт капчей; на живом
  PREPROD проверены граница маршрута удаления и состав сборки.

- **DD-329 (Locked, PUBLIC-HOME-HIFI, 2026-10-01).** **Публичная главная: три правки владельца.**
  (1) **Полоса проверки без плашек.** С карточек `#review` сняты «V1», «Разбор», «V2», «✓»
  (владелец: «там и так расписано, что это есть»). Порядок теперь несёт сама полоса: линия 2 px по
  верхнему краю карточки — прозрачная у ещё не достигнутого состояния, приглушённый Signal у
  пройденного, полный Signal у показанного. Заголовок карточки остаётся кнопкой (`aria-pressed`).
  (2) **Линия маршрута — под узлами.** Нарисованная часть линии была последним потомком контейнера и
  рисовалась поверх «L1», «L2» и остальных меток; поднять узлы `z-index` нельзя — список
  раскрывается с `transform` и образует собственный слой. Теперь обе части линии — один первый
  псевдоэлемент (`::before`: слабая линия + нарисованная часть как фон с `background-size`), узлы
  непрозрачны и стоят над ней. Метки узлов крупнее: 30 px / 10 px у старта, 44 px / 12 px у шага
  (на телефоне 28 / 9,5 и 38 / 11).
  (3) **Цикл — по центру, без перекрытий.** Шаг `#mechanism` — центрированная колонка: узел 44 px
  стоит НА линии и закрывает её (цифра 13 px / 600 вместо 7 px), слово, пояснение (три строки
  зарезервированы, чтобы шесть объектов начинались на одной линии), объект продукта по центру.
  Вертикальные разделители, которые проходили через узлы и вдоль краёв объектов, сняты. Линия идёт
  от центра первого узла до центра последнего.
  (4) **Собственная ступень цикла — 1340 px** (внесена в реестр breakpoint как
  `CONTENT_DRIVEN_KEEP`): шесть объектов помещаются в ряд, только пока колонка шире ≈ 190 px; на
  1280 колонка 177 px, и самое длинное действие уходит в три строки. Ниже 1340 — два ряда по три, у
  каждого ряда свой отрезок линии; ниже 680 — одна колонка-цепочка, соединитель идёт через
  промежуток между шагами, а не вдоль левого края текста.
  Hero, тексты и слова продукта не менялись; сумм, персон и Pocket по-прежнему нет.
  **Цена правки:** там, где один ряд стал двумя (1280), блок цикла выше на 383 px; на телефоне — на
  225 px (узел на своей строке и соединитель между шагами); полоса проверки, наоборот, короче на
  30 px (на телефоне — на 121 px).
  Проверка: реальные кадры «до» и «после» одним способом на ширинах 1440 / 1280 / 1024 / 768 / 390 /
  360, без переполнения и ошибок консоли; ревью —
  `design-memory/reviews/owner-fixes-2026-10-01-review.md`. **Выкачено на PREPROD 02.10.2026**
  (academy `4e06ef3`); три блока пересняты на живом PREPROD на тех же шести ширинах.
  **Поправка DD-333 (02.10.2026):** пункт (3) был неверен для цикла там, где шесть шагов стоят в
  один ряд (от 1340 px): нарисованная часть линии цикла оставалась последним потомком списка и
  проходила поверх «01…06». Исправление маршрута из пункта (2) перенесено на цикл.

- **DD-330 (Locked, TOOLS-V2, 2026-10-02).** **Payout — только цифры, от 20 до 99.** Владелец
  (на скриншоте — «льдл» в поле Payout): «в этом поле должно быть можно писать только цифры и от
  20 до 99».
  (1) **Одно поле на все инструменты**, которые спрашивают payout: Trade Card, Trading Journal,
  Risk Calculator и «Мой минимум payout» в Entry Checklist (`components/payout-field.tsx`). Поле
  оставляет от набранного и вставленного только цифры — две; пустое показывает свой диапазон
  («20–99»); клавиатура на телефоне — цифровая.
  (2) **Число вне диапазона называется сразу**, если дописать его до верного уже нельзя («15»,
  первая «1»), и при уходе из поля — если можно («5» на пути к «55» не ошибка). Не при сохранении.
  Молча поле ничего не исправляет и не обрезает до границы: записанный payout — тот, что набрал
  ученик.
  (3) **Одна граница в трёх местах:** поле, проверка формы и Backend (`PAYOUT_PERCENT` в
  `reference.ts`, четыре валидатора). Проверки самой базы (1…100) не тронуты, миграции нет: это
  защита хранилища, а 20…99 — правило продукта; на PREPROD строк вне нового диапазона нет. Строка
  со старым значением вне диапазона остаётся читаемой и попросит payout в диапазоне при следующей
  правке.
  (4) **Сверх запроса:** «Сумма», «Торговый капитал» и «Дневной лимит потерь» тоже принимали любой
  текст — теперь сумма оставляет цифры и один десятичный знак (точка или запятая, до двух цифр
  после), лимит — цифры. Это суждение, вынесено владельцу в отчёте.
  Проверка: 12 сквозных проверок на стенде (четыре инструмента; Backend отказывает 19 и 100 по
  имени поля и принимает 20 и 99); ревью — `design-memory/reviews/owner-fixes-2026-10-02-review.md`.
  **Выкачено на PREPROD 02.10.2026** (backend `e70b6b1`, затем academy `8cb7c5b`; миграции нет,
  резервная копия базы снята до выкладки). Под учеником на PREPROD не проверялось: вход закрыт
  капчей.

- **DD-331 (Locked, TOOLS-V2, 2026-10-02).** **Дата и время сделки — собственные поля продукта.**
  Владелец (на скриншоте — системный список времени под «Время входа»): «выбор даты и времени в
  инструментах должен быть реализован удобно и красиво, подходить под наш стиль, оптимизируй,
  сделай по другому его выбор и доведи до хай фая». Браузерные `type="date"` и `type="time"`
  рисуют себя в локали браузера («10/02/2026», «02:32 PM» в русском интерфейсе) и открывают
  список операционной системы; в инструментах их больше нет.
  (1) **Время — поле, в которое печатают, и панель, в которую показывают.** Печать: четыре цифры —
  время, двоеточие ставит поле («1432» → «14:32», «9» → «09:», «25» → «02:5»); ↑ и ↓ крутят ту
  часть, где стоит курсор; указатель, принёсший фокус, выделяет всё время. Панель: «Сейчас», 24 часа
  в четыре ряда, минуты в два шага — десяток и минуты этого десятка в лотке под ним; любая минута —
  в два нажатия, выбор минуты закрывает панель.
  (2) **Дата — поле, которое говорит день словами** («Сегодня · 2 октября», «Вчера», «29 сентября ·
  вторник», «30 дек 2025») и открывает месяц: «Сегодня», «Вчера», «Позавчера» — по одному нажатию;
  недели целиком, с понедельника, по-русски при любой локали браузера; первая и последняя неделя
  месяца достроены днями соседних месяцев (на шаг тише, нажимаются как все) — в первые дни месяца
  дни, за которые пишут журнал, стоят в той же строке, а не на странице назад; день, который
  выбрать нельзя, нарисован и не нажимается (для журнала — всё после «сегодня» ученика).
  (3) **Панель — не модальное окно:** ничего не затемняет, закрывается нажатием или фокусом вне её
  и клавишей Escape с возвратом фокуса. Клавиатура: стрелки, PageUp/PageDown, Home/End, Enter. На
  телефоне панель занимает всю строку сетки полей, клетки 44 px; с 600 px — 332 px под своим полем
  (у поля в правой половине — влево). Материал — территория инструментов; Signal — только на
  выбранном.
  (4) **Значения не изменились:** дата — «ГГГГ-ММ-ДД» (календарный день ученика), время — «ЧЧ:ММ»;
  форма и Backend видят то же, что раньше. Миграции нет.
  Art-direction gate не проводился: владелец поручил способ выбора целиком («сделай по другому его
  выбор»); взвешены три устройства — шаги внутри поля, лента дней, печатное поле с панелью — и
  построено третье, потому что оставляет оба способа: четыре цифры с клавиатуры и три нажатия
  указателем. Это суждение, вынесено владельцу в отчёте.
  Проверка: 19 сквозных проверок на стенде, панели в пределах экрана на 1440 / 1024 / 768 / 390 /
  360 / 320; ревью — `design-memory/reviews/owner-fixes-2026-10-02-review.md`.
  **Выкачено на PREPROD 02.10.2026** (academy `8cb7c5b`). Под учеником на PREPROD не проверялось.

- **DD-332 (Locked, AUTH, 2026-10-02).** **Проверка безопасности — одна строка формы; окно
  Cloudflare — только когда оно о чём-то просит.** Владелец: «на логине и регистрации окно капчи
  слишком выделяется и не соответствует нам, сделай чтобы оно было на своём месте, вписывалось в
  дизайн». Окно Turnstile — чужой iframe: его фон, шрифт и логотип изменить нельзя. Изменено то,
  КОГДА оно рисуется, и что стоит на его месте — только документированными параметрами Cloudflare.
  (1) **`appearance: "interaction-only"`** — окно рисуется, только если посетителю нужно что-то
  нажать; сама проверка идёт как раньше. **`theme: "dark"`** — страница только тёмная, а окно
  следовало теме системы и было белым у всех, у кого система светлая. **`size: "flexible"`** — окно
  шириной с поля формы.
  (2) **Строка на месте окна**, над кнопкой (раньше пояснение стояло под кнопкой): «Загружается
  проверка безопасности…» → «Проверяем браузер…» → «Браузер проверен.»; знак перед ней — кольцо,
  которое вращается, и галочка. Без Signal: единственное действие страницы — кнопка. Если
  Cloudflare просит нажатие — «Нужно подтверждение: отметьте поле ниже.» и окно под строкой.
  Кнопка формы описана этой строкой.
  (3) **Неудачная проверка — не тупик:** «Проверка безопасности не выполнена.» и «Повторить
  проверку» (новая проверка; фокус переходит на строку). Раньше повторить можно было в самом окне,
  которого теперь нет на странице.
  (4) **Рамка вокруг iframe никогда не убирается из страницы.** Пока нажимать нечего, Turnstile сам
  держит свой iframe отрисованным — один пиксель, `position: fixed`, `opacity: 0.01`: так проверка
  идёт невидимо. `display: none` на нашей рамке вынул бы iframe из отрисовки, и на стенде с
  тестовыми ключами это не видно — тестовый ключ не запускает настоящую проверку. Поэтому рамка
  всегда в странице, нулевой высоты; правило закреплено тестом таблицы стилей. Проверено в браузере:
  iframe отрисован и не обрезан во всех состояниях.
  (5) **Окно, однажды открытое, остаётся до конца этой проверки** — с «Успешно» самого Cloudflare
  после нажатия: форма не прыгает из-под указателя, живой iframe не прячется.
  (6) **Не изменено:** токен, действие (`action`), проверка на Backend, все обратные вызовы, которые
  уничтожают токен; `auth.css` остаётся замороженным.
  **Высоты блока проверки** (их держит fold-gate `auth-threshold-layout.test.ts`): 20 px — работает
  и пройдена; 93 px — с окном; 81 px — не выполнена; 83 px — ключа нет. Было 71 px всегда и 142 px
  с ошибкой: форма регистрации короче на 78–96 px и больше не прокручивается на 1440×900.
  **Юридическое (OQ-6):** окно несёт ссылки на условия Cloudflare; когда оно не показано, Turnstile
  нужно назвать в собственной политике конфиденциальности продукта — юридических страниц пока нет.
  **Чего нельзя проверить до выкладки:** настоящий ключ отвечает только на своём домене — на стенде
  проверены опубликованные тестовые ключи Cloudflare (всегда проходит, требует нажатия, всегда
  отказывает; 22 сквозные проверки). Ревью —
  `design-memory/reviews/owner-fixes-2026-10-02-review.md`.
  **Выкачено на PREPROD 02.10.2026** (academy `8cb7c5b`). С настоящим ключом на живом PREPROD
  (наблюдение, без нажатия): строка проходит «Загружается…» → «Проверяем браузер…», автоматическому
  браузеру Cloudflare показывает окно — тёмное, шириной с поля (386×65; 312×65 на телефоне), строка
  просит отметить поле, кнопка удержана; iframe отрисован и не обрезан. Проход без нажатия — то,
  что видит человек, — проверяет владелец.

- **DD-333 (Locked, PUBLIC-HOME-HIFI, 2026-10-02).** **Публичная главная: линии — за тем, что они
  соединяют (цикл и путь в окне продукта); полоса проверки отвечает на нажатие.**
  (1) **Линия цикла — под узлами.** Владелец: «полоска всё равно перегораживает цифры, нужно чтобы
  она была за цифрами». Первая волна (DD-329) исправила это у маршрута и не перенесла на цикл:
  нарисованная часть линии цикла оставалась последним потомком списка, а каждый шаг раскрывается с
  `transform` и образует собственный слой — линия шла поверх «01…06» везде, где шесть шагов стоят в
  один ряд. Не было замечено, потому что линия и узел одного цвета: видно только 2 px поперёк тёмной
  цифры. Теперь обе части линии — один первый псевдоэлемент (`::before`), нарисованная часть — слой
  фона, растущий через `background-size` (без `transform`).
  **Метод:** «нарисовано ли что-то поверх» теперь спрашивается у браузера (`elementFromPoint` в
  центре каждого узла — псевдоэлемент отвечает за своего хозяина), а не читается с кадра, и
  спрашивается про ВСЕ узлы всех нарисованных линий страницы, а не про те, на которые указали.
  **Третье место — найдено этим обходом:** в состоянии «Путь» окна продукта пройденная часть линии
  модуля тоже была последним потомком и шла поверх галочек L1 и L2 и в текущий узел — на всех
  ширинах, с выкладки hi-fi. Исправлено тем же способом; тест таблицы стилей теперь запрещает
  `::after` у любого держателя узлов (маршрут, цикл, путь в окне, малый путь в объекте цикла).
  Живой PREPROD: закрыто 33 узла из 175 (шесть узлов цикла на 1440 и на 1360; три из пяти узлов
  пути в окне на всех семи ширинах). Эта сборка: 0 из 175 (25 узлов × 7 ширин).
  (2) **Карточки полосы говорят, что их можно нажать.** Владелец: «дать понять, что можно
  переключать блоки, небольшими подсвечиваниями». Один свет в четырёх силах: размыв Signal от
  верхней линии карточки и волосяной контур того же света. Он горит на показанной карточке;
  поднимается под указателем (только там, где указатель есть — на сенсорном экране «наведение»
  залипает) и под фокусом клавиатуры; полон в момент нажатия; и один раз — когда окно доиграло
  свою последовательность — проходит волной по трём карточкам, которые не показаны (420 мс каждая,
  через 120 мс). Карточки не двигаются, ничего не добавлено: та же линия, зажжённая сильнее.
  Нажимается вся карточка, включая объект внутри; заголовок остаётся кнопкой (`aria-pressed`) для
  клавиатуры и вспомогательных технологий. Reduced-motion — без волны, состояния мгновенные.
  Hero, тексты и слова продукта не менялись. Ревью —
  `design-memory/reviews/owner-fixes-2026-10-02-review.md`.
  **Выкачено на PREPROD 02.10.2026** (academy `8cb7c5b`); обход повторён на живом PREPROD: 175
  узлов из 175, ни один не закрыт; подсветка полосы и волна сняты там же.

- **DD-334 (Locked, NAVIGATION, 2026-10-02).** **«Назад» показывает тот экран, чей адрес в строке:
  переход по ссылке внутри страницы больше не оставляет запись истории без состояния роутера.**
  Владелец: на публичной главной нажать «Практика и обратная связь» (`/#review`), затем «Войти»
  (`/login`), затем «Назад» — адрес возвращается на `/#review`, а экран остаётся экраном входа; «такой
  же баг со всеми остальными категориями … выяви и пофикси». Воспроизведено на живом PREPROD.
  (1) **Причина.** Ссылку на место той же страницы (`<a href="#review">`) выполняет браузер, а не
  роутер: он добавляет запись истории без состояния (`history.state === null`). Роутер хранит то,
  по чему восстанавливает страницу, в состоянии записи, и событие `popstate` с пустым состоянием
  пропускает (в его исходнике так и сказано: «called outside of Next.js … return»). Адрес меняет
  браузер, экран не меняет никто.
  (2) **Где ещё.** Тот же дефект — у всех простых внутристраничных ссылок приложения: шапка и hero
  публичной главной, «Перейти к содержанию» на публичных страницах, **«Перейти к содержимому» на
  каждой странице продукта** и **оглавление материала урока** (раздел → «← Уровень» → «Назад»:
  адрес урока на странице уровня). Ссылки сводки ошибок отчёта не затронуты — они отменяют переход.
  (3) **Исправление — один компонент в корневом макете** (`history-entry-sync.tsx`), он ничего не
  рисует и ни одну ссылку не выполняет. Когда выполнена внутристраничная ссылка, запись передаётся
  роутеру документированным способом — один `history.replaceState` с тем же адресом; роутер
  принимает адрес и сам записывает в запись своё состояние: без запроса, без прокрутки, без
  перемонтирования. Если «Назад»/«Вперёд» пришли на запись, которую роутер так и не видел (сделана
  до того, как страница ожила), а на экране другая страница — роутер просят показать этот адрес
  (`router.replace`). Запись с состоянием — роутера или самой страницы (ссылка сброса пароля сама
  убирает токен из адреса) — не трогается; компонент ждёт один ход, чтобы такая страница успела
  первой.
  (4) **Ссылки остались простыми `<a href="#…">`** — они работают до оживления страницы и без
  скриптов, прокручивает к ним сам браузер. Меняется только учёт истории.
  (5) **Корневой макет больше не заморожен** в identity-guard: его содержимое теперь держит
  `root-layout.test.ts` (язык документа, классы body, единственная вещь рядом со страницей, импорты,
  метаданные), и четыре проверки там читают УСТАНОВЛЕННЫЙ фреймворк — что он по-прежнему пропускает
  запись без состояния, принимает `replaceState` в роутер и ставит своё состояние: модульный тест
  компонента половину фреймворка не видит, а обновление фреймворка может её сдвинуть.
  На экране ничего не изменилось: в разметку страницы добавлена одна пустая граница (два
  комментария), режим отрисовки всех 78 маршрутов прежний.
  Проверка в настоящем браузере одним сценарием без исправления и с ним: 1 из 21 → 21 из 21 (пять
  разделов × два выхода, логотип, hero, служебная ссылка, меню на телефоне, цепочка из двух разделов
  с тремя «Назад» и тремя «Вперёд», повторное нажатие той же ссылки, запись «до оживления»,
  оглавление урока, служебная ссылка продукта, ссылка сброса пароля, отсутствие запросов) — в режиме
  разработки и на production-сборке. Проверено только в Chromium. Ревью —
  `design-memory/reviews/back-after-anchor-review.md`.
  **Выкачено на PREPROD 02.10.2026** (academy `871d298`, только академия, миграций нет); шаги
  владельца и 18 проверок, не требующих сессии, повторены на живом PREPROD. Оглавление урока и
  служебная ссылка продукта под учеником на PREPROD не проверялись: вход закрыт капчей.

- **DD-335 (Locked, PROGRAM, 2026-10-02).** **Первые 30 уровней: страница уровня — это урок; тест
  объясняет ошибку и отправляет к секунде видео; отчёт уровня 9 принимается без наставника; плеер — в
  языке продукта.** Владелец: «следующий этап внедряем первые 30 настоящих уровней … плеер так же
  добавляй уже … стилизируй его если надо под наш дизайн» + документ «Содержание воронки обучения ·
  уровни 1–30». Программа — `ata-v2` версии 5 (бэкенд, `docs/PROGRAM_30_LEVELS.md`): 2 главы, 6
  модулей, 30 уровней, 1–14 открыты, 15–30 определены и готовятся.
  (1) **Страница уровня — урок.** Видео, затем «О чём урок» (короткий текст рядом с видео печатается
  на самой странице; длинный урок 100-уровневой программы остаётся на своей странице чтения — на копии
  PREPROD ни один из 78 уроков v4 не стал «коротким»), затем одна задача, затем инструмент, который
  уровень открывает. **Одна задача за раз:** до «Начать» нет ни теста, ни отчёта, ни отметки; слова у
  «Начать» говорят, что именно начнётся (тест, урок без теста, практика, отчёт с проверкой
  наставником или автоматической). Завершённый уровень говорит об этом один раз — моментом
  завершения, который называет следующий уровень.
  (2) **Тест.** Неудачная попытка остаётся на экране как была отвечена и закрыта для правки (раньше
  выбор после провала отправлялся в закрытую попытку). У каждого вопроса — слово «Верно» или
  «Неверно»; под неверным — разбор автора и «Пересмотреть с m:ss», который выводит плеер в поле
  зрения и включает видео с этой секунды; если видео на странице нет — та же секунда словами. Ключ
  ответа в браузер не приходит. До первого ответа сказано: «нужно ответить верно на все; попытки не
  ограничены».
  (3) **Отчёт уровня 9.** Записи, а не стена полей: пять сделок и отказ, у каждой «заполнено N из M»;
  дополнительный отказ — одна кнопка «Добавить запись отказа», следующий появляется после
  добавления предыдущего; «Убрать» стирает введённое в нём. Проверка автоматическая — ни одно
  предложение не говорит «наставник» или «ожидает проверки»; принятый отчёт сразу «Работа принята»,
  и «Ваш отчёт» остаётся доступным для чтения (урок 14 отправляет к этим записям). Сводка ошибок
  называет поля по записи («Сделка 4 · Дата и время») и после восьми считает остальные. Фокус
  переходит к результату только после отправки, не при открытии страницы.
  (4) **Плеер.** Ровная рамка Ink, угол 8px, линия-волосок, без тени и без светящегося кольца; Signal
  только на пройденной части шкалы, её точке, фокусе и шаге вперёд на экране окончания («Перейти к
  тесту»). Вид живёт в стилях самого плеера — страница его не перекрашивает. На телефоне в центре одна
  кнопка над панелью (панель пересекала три кнопки). Плеер читает состояние видео при оживлении
  страницы: метаданные, пришедшие до гидрации, раньше терялись — `0:00 / 0:00` навсегда. Синтетический
  «демо-постер» удалён. Видео отдаёт сама Академия по `/media/…` тому ученику, которому бэкенд отдал
  бы урок, с диапазонами байтов; конфигурация сервера не меняется.
  (5) **Регистрация — третий уровень.** «Проверить регистрацию» спрашивает собственную запись
  бэкенда (раньше только перечитывала страницу), и тот же вопрос задаётся при открытии уровня: если
  ученик зарегистрировался ещё на первом уровне, третий закрывается сам.
  (6) **Уровни, которые готовятся.** «Готовится», а не «Заблокирован»; на Пути — «Дальше: Уровень 15 …
  · готовится» и узел-ожидание; на Главной — «Открытые уровни пройдены — 14 из 30». Путь рисует главы
  из программы и пишет вид уровня так, как его называет автор (урок, задание, отчёт, практика, точка
  сборки); строка под фокусом называет уровень, о котором говорит. Закрытый инструмент описан от
  уровня из вердикта бэкенда («после уровня L9 «Первые пять demo-сделок и разбор»»).
  (7) **Чего здесь нет.** Перехода «пополнение реального счёта» после уровня 9 и других контрольных
  точек новой программы; формы уровней 13 и 14 (уровень закрывается отметкой ученика); образца отчёта
  уровня 9; видео (на стенде — тестовая запись с таймкодом). Оформление: художественный выбор из
  трёх вариантов не проводился — новой композиции нет, части добавлены в принятую.
  Ревью — `design-memory/reviews/levels-1-30-review.md` (85 и 81 по anti-generic).

- **DD-336 (Locked, LESSON HI-FI, 2026-10-02).** **Экран урока — сцена: видео как главный объект,
  под ним линия урока с точками вопросов теста; плеер закрепляется, когда ученик пересматривает
  ответ.** Владелец: «Теперь доведи экран урока и плеер до хай фая», затем, на три направления
  (A «Сцена», B «Рабочий стол», C «Маршрут урока»): «Проанализируй выбери лучшее и реализовывай».
  **Выбрано: A «Сцена» и закреплённый плеер из B.** B держит видео рядом с вопросом, но две колонки
  сжимают отчёт уровня 9 и тесноваты на 1024. C ясен по шагам, но прячет видео после просмотра, а
  урок — это цикл «смотрю → проверяю → пересматриваю». A сохраняет страницу одной колонкой для всех
  видов уровней, а слабое место A — уход к сцене при «Пересмотреть» — закрывает закреплённый плеер B.
  (1) **Композиция на одной оси.** Заголовок по центру; под ним одна строка фактов вместо таблицы
  «Параметры уровня»: состояние, длительность видео, как уровень завершается (словарь
  `COMPLETION_METHOD_FACT` рядом с прежними подписями), опыт. Строка состояния печатается только для
  уровня, который ждёт или закрыт. Сцена — шире колонки и такой ширины, чтобы заголовок, картинка и
  панель помещались в первый экран; на телефоне — от края до края. Под ней колонка чтения по центру:
  результат урока, «О чём урок», задача, инструмент, соседние уровни. На широком экране светящаяся
  линия выходит из-под сцены и спускается по колонке к задаче — точка на текущей задаче, сплошная на
  завершённом уровне.
  (2) **Плеер.** Картинку ничто не закрывает, пока урок идёт: панель — под ней, в материале сцены
  (только в полноэкранном режиме панель ложится на картинку и уходит при воспроизведении). На
  картинке одна кнопка «Воспроизвести» в паузе; сохранённое место — «Продолжить с 3:42» и «Смотреть с
  начала». Скорость 0,75–2× (запоминается в браузере ученика), клавиши J/K/L, ← →, M, F; громкость на
  телефоне — кнопками устройства.
  (3) **Линия урока.** Шкала плеера несёт точки, где в видео объясняют ответ на каждый вопрос теста
  (бэкенд отдаёт `questionMarkers` — только номер вопроса и секунду, без вопроса, вариантов и ключа).
  Нажатие на точку — видео с этой секунды. После попытки точка говорит «верно» (Signal) или
  «неверно» (розовый тон ошибки); номера стоят под линией и ни с чем не пересекаются; линия проходит
  под точками.
  (4) **Пересмотреть — там, где ученик.** «Пересмотреть с 1:55» больше не уводит к сцене: плеер
  закрепляется (в углу широкого экрана, вдоль верха на планшете и телефоне), играет с нужной секунды,
  а вопрос остаётся на виду; место сцены на странице сохраняет высоту. Крестик закрывает мини-плеер и
  ставит паузу. На ширинах 900–1683 px угловой плеер закрывает правый край текста ниже вопроса —
  открытый пункт для взгляда владельца.
  (5) **Место просмотра.** Плеер сообщает, где ученик остановился (каждые 15 с, на паузе, в конце, при
  скрытии страницы); страница сохраняет это той же командой, что и чтение
  (`UserLessonProgress.playbackPositionSeconds`) — только пока уровень в процессе, с ревизией, которую
  бэкенд принял последней; отказ останавливает сохранение, ничего не сливается. Прогресс уровня это не
  меняет.
  Ревью — `design-memory/reviews/lesson-hifi-review.md`.

- **DD-337 (Locked, HOME & PROFILE HI-FI, 2026-10-03).** **Главная наполнена вокруг одного
  приоритета, профиль стал обычным профилем платформы, поддержка — только из профиля.** Владелец:
  «Теперь наполни внутреннюю главную, после сделай ее хай фай, так же сделай с профилем, наполни как
  нормальный профиль на платорме, поддержку тоже сюда переноси, что бы написать в поддержку можно
  было только из профиле, не по ссылке из хеда, как наполнишь так же сделай хай фай»; на вопрос о
  направлении — «Выбери сам», о выкладке — «Да, по готовности».
  **Главная, три направления:** A «Пульт» — две колонки (приоритет и модуль слева, лента и
  инструменты справа); B «Линия программы» — одна ось: вся программа линией, приоритет подвешен к
  точке ученика, ниже модуль, инструменты, «Что нового»; C «Сводка» — текстовая сводка одной фразой и
  три колонки фактов. **Выбрано B.** A — сетка колонок одинакового веса (то, от чего отказались в D1A);
  у C нет фирменного объекта, страница читается как отчёт. B делает светящуюся линию референсов
  рабочей: урок рисует линию урока, Путь — модуль, Главная — всю программу; рамка решения та же, что
  на Пути.
  **Профиль, три направления:** A «Паспорт» — одна колонка, поддержка разделом внизу со ссылкой;
  B «Кабинет» — колонка паспорта и рабочая панель; C «Шапка и части» — паспорт поперёк колонки и две
  части. **Выбрано C с разделами A.** Поддержка видна сразу под паспортом и в один тап; рабочая
  панель B сжала бы двухколоночный стол обращений; в A поддержка уходит ниже первого экрана.
  (1) **Поддержка — часть профиля.** Из шапки и меню «Ещё» убрана; стол обращений (без изменений) —
  `/profile/support` под паспортом и частями «Аккаунт · Поддержка»; `/support` отвечает переходом туда.
  Ссылки профиля («через поддержку» у почты, экран сбоя) ведут туда же. Если за «Ещё» остаётся один
  пункт, он сам встаёт пятым слотом нижней панели — сейчас это «Профиль»; «Ещё» вернётся со вторым
  пунктом (проверено тестами с включённым Сообществом). Аватар в мобильной шапке уступает отметку
  «текущая страница» этому слоту.
  (2) **Главная.** Приветствие по имени («Здравствуйте, Вера» — без «доброго утра»: сервер не знает
  часы ученика), где он сейчас (глава, модуль), три счёта моноширинным — опыт, пройдено, инструменты.
  Линия программы: точка на уровень, разрывы между модулями, главы подписаны над линией; пройденное —
  светло-серым, текущая точка — Signal с ореолом, впереди — кольца, готовящееся — пунктиром; длинная
  программа (100 уровней) на узком экране — без точек, с одной текущей. От текущей точки тонкая линия
  спускается в рамку приоритета (уголки Signal, как на Пути); рядом с приоритетом — что даст шаг:
  опыт уровня, инструмент, который откроется, следующий уровень; когда все открытые уровни пройдены —
  «Пересмотреть уроки», «Открыть инструменты». Ниже — уровни текущего модуля (открытые — ссылки,
  текущий отмечен), «Дальше: модуль …», открытые инструменты и ближайший закрытый с уровнем, «Что
  нового» — три последних уведомления по правилам страницы уведомлений, время — по часам браузера.
  Приоритет остался прежним полем: один h1, одна кнопка действия, позы ожидания и неизвестности.
  (3) **Профиль.** Паспорт: инициалы внутри кольца (та же линия программы, замкнутая в круг: участок
  на модуль, пройденное подсвечено, текущий уровень — точка Signal), имя, адрес, «В Академии с 2
  октября 2026» (бэкенд добавил `memberSince` — дату создания аккаунта — в `GET /api/me/account`),
  четыре счёта и «Открыть путь». Часть «Аккаунт»: данные (имя, почта — адрес печатается и там, где
  почту меняет поддержка), безопасность, карточка поддержки (последние два обращения с состоянием) и
  «Сеанс» с «Выйти из аккаунта». Страница встала в общую колонку продукта (1008 px), как Путь и Уроки.
  (4) **Данные.** Новых запросов к бэкенду нет, кроме поля `memberSince`; уведомления Главной — тот же
  запрос, что и колокольчик (один на страницу). Ни баланса, ни депозита, ни сумм, ничего из Pocket —
  ни на Главной, ни в профиле (тесты держат это по исходникам).
  Ревью — `design-memory/reviews/home-profile-hifi-review.md`.

- **DD-338 (Locked, PRODUCT HI-FI, 2026-10-03).** **Вся платформа говорит языком публичной главной —
  на тёмной основе продукта.** Владелец после DD-337: «по наполнению лучше теперь нужен хай фай
  всего»; на вопросы — «Вся платформа», «Выбери сам», «Да, по готовности» (частями).
  **Три направления системы:** A «Светлая витрина» — светлое полотно публичной главной с тёмными
  поверхностями; B «Витрина на тёмном» — язык публичной главной на тёмной основе продукта; C «Пульт» —
  плотный приборный интерфейс. **Выбрано B.** A ломает правило «продукт только тёмный», утомляет в
  долгих сессиях и спорит со сценой урока; C — имитация торгового терминала и плитки показателей,
  обе запрещены. B переносит то, что делает публичную главную «хай фаем», а не её разметку.
  (1) **Шрифт высказываний.** Заголовки страниц и главные фразы — тем же шрифтом с засечками, что на
  публичной главной (Source Serif 4, 400, плотный трекинг): «Здравствуйте, Вера», «Путь», «Уроки»,
  «Уведомления», приоритет на главной, имя в паспорте, названия модулей. Никогда — основной текст,
  кнопки и числа: они остаются Manrope и моноширинным. Роль шрифта в `typography.ts` расширена.
  (2) **Поверхности и свет.** Главный объект страницы — скруглённая поверхность (24 px) со светом из
  угла, как тёмные блоки публичной главной; та же оливковая подсветка — на фоне всей зоны входа.
  Вторичное — тонкие линии. (3) **Управление.** Главные действия — «пилюли» со стрелкой и подъёмом при
  наведении, как «Начать путь»; «Выйти» — как «Войти» на публичной главной. (4) **Шапка парит:**
  скруглённая полоса в 10 px от краёв, остаётся видна при прокрутке; на телефоне нижняя панель —
  такая же парящая полоса над безопасной зоной. (5) **Маршрут светится.** Пройденная часть пути —
  в зелёном цвете маршрута (`--route-completed`) с мягким свечением, как светящаяся линия публичной
  главной; полный Signal — только у текущей точки, её стебля, уголков рамки и действия.
  Значения — одним набором токенов `--hf-*` в `tokens.css`; каждая страница накладывает свой слой
  (`*-hifi.css`) поверх принятой разметки, поэтому смысл, тексты и поведение страниц не меняются.
  **Часть 1:** шапка, Главная, Путь, Уроки, Уведомления, Профиль и поддержка. **Часть 2:**
  Инструменты (каталог и шесть окон), страница урока со всеми видами задания (тест, отчёт уровня 9,
  практика 13–14, регистрация в Pocket, «Уровень завершён»), материал урока, рабочее место отчёта,
  вход и регистрация, страницы ошибок и «не найдено».
  **Уточнения части 2.** (6) **Задание — окно.** Задание уровня — скруглённое окно (16 px) со светом
  из угла, его название — шрифтом высказываний; поля и варианты — радиус управления (12 px); кнопки —
  «пилюли». На рабочем месте отчёт — главная поверхность страницы (24 px), записи — внутренние окна.
  (7) **«Уровень завершён»** сохраняет смысл: поверхность успокаивается (без света из угла), одна тихая
  Signal-отметка «это позади» — точка у подписи вместо полосы слева (на скруглённом окне полоса
  изгибается), единственное яркое — путь дальше. (8) **Цель урока не повторяется.** В программе v5
  «Чему учит материал» и её продолжение заполнены одной фразой; продолжение показывается, только если
  добавляет что-то новое. (9) **Рабочее место** открывается только по прямому адресу (ссылок в
  интерфейсе нет); его вид доведён вместе со всем, его судьба — отдельный вопрос.
  Ревью — `design-memory/reviews/product-hifi-review.md`.
- **DD-339 (Locked, RESPONSIVE PASS, 2026-10-03).** **Всё, что видят ученики и гости, проверено на
  25 размерах экрана и исправлено там, где ломалось.** Владелец: «проверь все на адаптивность, где есть
  ошибки исправляй, адаптируй и про внешнюю главную не забудь»; на вопросы — «Да, по готовности», CRM
  не трогать. **Как проверено:** 33 страницы (внешняя главная с прокруткой всех сцен, вход, регистрация,
  восстановление, все страницы после входа, урок с тестом, отчётом, практикой и регистрацией, материал,
  рабочее место, инструменты, новости, профиль и поддержка, «не найдено») × 25 размеров (телефоны
  320–430, границы раскладок 599/600/899/900/1199/1200, планшеты, ноутбуки и мониторы до 2560, телефоны
  боком 667×375, 844×390, 932×430) — замер, а не взгляд: прокрутка вбок, выход за край, текст шире своего
  блока, содержимое, обрезанное контейнером, наложения, цели меньше 44 px, мелкий текст, нижняя панель
  поверх содержимого; отдельно — все открывающиеся элементы (меню, выбор даты и времени, оглавление,
  редактирование) и «пристыкованный» плеер с настоящим воспроизведением.
  **Принятые правила.** (1) **Плеер при прокрутке урока** не закрывает текст: от 1404 px — в углу внутри
  поля рядом с колонкой урока (ширина = поле − 32 px, до 380 px); 900–1403 px — полоса над колонкой под
  парящей шапкой (картинка 192 px и управление рядом); 600–899 px и телефон боком — такая же полоса вдоль
  верха; телефон вертикально — полоса во всю ширину, картинка до 30% высоты (открытый пункт DD-336
  закрыт). (2) **Цели 44 px везде**, включая «Выйти», кнопки и ячейки выбора даты и времени, «Структура»
  материала, строки новостей (вся строка — ссылка), шаги маршрута на главной. (3) **Выбор даты и времени**
  не выходит за экран: открывается над полем, когда снизу нет места, а сверху есть; выше экрана — листается
  внутри. (4) **Меню внешней главной** на телефоне боком листается внутри. (5) **Окна продукта на главной**
  подстраивают строку под ширину самого окна (контейнерные запросы), а не экрана. (6) **Длинные слова**
  в крупных заголовках помещаются в строку за счёт размера («самостоятельности», «Последовательная»,
  «потребительских»), а не переносом; заголовки новостей (их пишут редакторы) при крайней нужде
  переносятся. (7) **Полоса уровней «Пути»** на 600–899 px листается, как на телефоне. (8) **Текст,
  который несёт смысл** (ответ поддержки, вердикт чек-листа, критерии отчёта, подписи инструментов), на
  телефоне — 13,5–15 px. Ревью — `design-memory/reviews/responsive-pass-review.md`.
- **DD-340 (Locked, MOBILE OVERLAP, 2026-10-03).** **На телефоне ничто не прилипает поверх текста и
  ничего не просвечивает вокруг закреплённых панелей.** Владелец прислал два снимка с телефона внешней
  главной: «всё перекрывается и не понятно в блоках… похожие ситуации так же поищи и исправь».
  (1) **Маршрут главной до 920 px:** прилипающее окно продукта закрывало слова шагов при прокрутке; теперь
  у каждого шага своё окно прямо под его текстом, во всю высоту содержимого, и маршрут читается сверху
  вниз; общее прилипающее окно — только с 921 px (как было). (2) **Шапка главной до 1040 px:** после
  прокрутки промежутки вокруг плавающей «пилюли» заполняются фоном страницы — над шапкой и по её углам
  больше не видно прокручиваемого. Вверху страницы пилюля по-прежнему парит над первым экраном.
  (3) **Нижняя панель продукта до 899 px** стоит на полосе фона страницы — под ней и по углам ничего не
  просвечивает. (4) В узком окне новости строка события — в две строки. Широкие экраны не менялись:
  там плавающие панели — решение DD-333/DD-338. Ревью — `design-memory/reviews/responsive-pass-review.md`.
  **Дополнение 03.10 (раздел «Пройдено — ещё не значит освоено»).** Владелец с телефона: «не понятно что
  переключается и зачем переключатели занимают весь экран и то что переключается не видно и не связано с
  переключателями логикой». До 1040 px четыре карточки-этапа стояли столбиком или по две под окном выше
  экрана — нажатие меняло то, чего не видно. Теперь там над окном — лента этапов 01–04 («Отправлена»,
  «Разбор», «Исправлено», «Принята»): номера на линии, подсвеченной до этапа на экране, под ней — пояснение
  этапа, сразу под ней — окно, которое она переключает. На телефоне окно короче: статус (слово
  наставника, вердикт) идёт первым, видна только запись 3, о которой речь («заполнено 5 из 5 записей»
  говорит про остальные), — лента и окно в один экран. С 1041 px — как было: карточки одной строкой под
  окном.
- **DD-341 (Locked, THE NAME, 2026-10-03).** **Продукт называется Alpha Trade Academy — везде.** Владелец:
  «во всем проекте название должно быть alpha а не alfa». (1) **Тексты:** Академия (заголовки страниц,
  подписи логотипа для экранного диктора, внешняя главная, новости, письма), картинка превью ссылки
  (перерисована из своего источника `public/og/home.source.html`), CRM, кабинет партнёра, документация
  и правила проекта (бренд-скилл, `CLAUDE.md`, конституция дизайна). Тест (`fixture.test.ts`) запрещает
  «Alfa Trade» в пользовательских строках. (2) **Программа:** опубликованная версия неизменна, поэтому
  выпущена версия 6 — те же 30 уровней с теми же кодами, название «Alpha» в заголовке программы и
  уроке 2; ученики версии 5 переносятся на 6 с пройденными уровнями и XP. (3) **Не переименовано —
  и почему.** Домен `alfatrade.media` — это адрес, а не название (меняется вместе с DNS и почтой, отдельным
  решением). Служебные коды уровней (`…ustroystvo-alfa-trade-academy`) — по ним переносится прогресс;
  видны только в адресе урока 2. Имена пакетов и папок. Прежние версии программы и записи истории
  (этот журнал до DD-341, ревью, отчёты, исходный документ программы) — они фиксируют, что было.
  Ученики, оставшиеся на старых версиях программы, видят в тексте своей версии прежнее написание.
- **DD-342 (Locked, PUBLIC HOME ON A PHONE, 2026-10-03).** **На телефоне внешняя главная — одна лента:
  одна мысль, один предмет, ничего дважды.** Владелец: «мобильная версия внешней главной мне не нравится…
  такая не понятная получается» («Выбери сам», «по готовности»). Замер до: 21,5 экрана на 390 px,
  18 окон продукта по пути, 103 надписи мельче 11 px, четыре нумерации подряд, заголовки по 48 px на
  3–7 строк, инструменты — стена из шести окон почти в пять экранов. Из трёх направлений («Одна лента»,
  «Колоды», «Карта») выбрана «Одна лента» с колодой «Колод» в одном месте — у инструментов.
  (1) **Цикл до 680 px — «хребет»:** шесть шагов с номерами на одной линии и по фразе — весь цикл на
  одном экране; предметы шагов на телефоне не показываются — каждый из них дальше на странице целиком
  (причина — в Trade Card, проверка и возврат — в окне отчёта, следующее действие — в окне главной,
  уровни — в окне пути). (2) **Инструменты до 920 px — колода:** карточка на инструмент листается вбок,
  следующая видна у края; над ней — линейка уровней открытия L5…L30, подсвеченная до карточки на экране,
  и подпись «Trade Card — открывается на уровне 5 · 1 / 6»; нажатие на уровень приводит его карточку.
  Линия пути заканчивается над колодой. (3) **Заголовки на телефоне — 24–36 px** (две-три строки;
  самое длинное слово «самостоятельности.» помещается с 320 px); мелкий шрифт в окнах и надписи
  над заголовками — 11 px до 920 px; строка над первым заголовком и рамка первого экрана — как были.
  (4) **«Многое → одно» в столбик подписано:** «Чужие ответы» над чипами, «Ваше решение» над карточкой.
  (5) **Факты пути — название над значением**, слова «пройден» в окне пути не налезают друг на друга.
  (6) **Окно «Проверка работы» больше не двигает страницу:** последовательность идёт, только пока
  окно на экране хотя бы на 60%, и продолжается с того же этапа; блок не становится ниже, чем уже был
  (этапы отличаются по высоте до 250 px, Safari не удерживает прокрутку). Широкие экраны не менялись
  (снимки 1024–1920 совпадают с живыми попиксельно). Ревью —
  `design-memory/reviews/public-home-mobile-review.md`.
- **DD-343 (Locked, LAUNCH READINESS, 2026-10-04).** **Ни одного тупика: на каждый сбой — что
  случилось словами ученика и куда идти дальше; одно имя для каждой вещи.** Владелец: «сделай детальный
  анализ продукта со стороны пользователя… после этого таска продукт должен быть буквально готовым к
  запуску» («По готовности, частями», «Выбирай сам»). Анализ —
  https://claude.ai/artifact/JctjXTfVcoJ7RogV5gWS6A; три волны выкачены 04.10 (записи в
  `~/audits/ata-launch-wave{1,2,3}-2026-10-04/`). Решения: (1) **События брокера ученику не
  показываются** (постбэки Pocket, «биржевой аккаунт» — сырой текст и деньги); одно правило для списка,
  колокольчика и «Что нового» (`lib/notifications/learner-facing.ts`). (2) **Сбой сервера — не выход:**
  «Нет связи с Академией» + «Повторить»; на вход ведёт только ответ «сеанса нет». (3) **401 в любом
  запросе — «Сеанс завершён · Войти снова»** с возвратом на ту же страницу; рядом с замороженным
  `session-provider.tsx`, не в нём. (4) **Признак загрузки — линия вверху экрана**, а не граница
  загрузки: текущая страница и меню остаются (сохраняет решение `navigation-transition.test.ts`).
  (5) **Одно имя:** Pocket (не партнёр/провайдер/биржа), Академия (не «Academy ·»/«ATA» в
  предложениях), «проверка знаний» (не тест/проверка понимания), «уровень N» в предложениях (метки
  «L05» остаются метками). (6) **У обращения в поддержке есть адрес** `?case=`; «Ждём вашего ответа»
  — над формой. (7) **Текст вида «цена<EMA20, RSI>70» — текст:** бэкенд отклоняет только настоящие теги,
  обработчики и javascript:/data: ссылки (`backend/src/lib/text/unsafe-text.ts`). (8) **Гость по
  неизвестному адресу видит вход** — сознательно: защита входа закрыта по умолчанию, список закрытых
  разделов открыл бы забытый. Открыты для владельца: видео-заглушки, «разбор человеком» на главной,
  «нет скрытых условий», контакт поддержки для невошедших, срок ответа поддержки, ручное подтверждение
  уровня 3, названия инструментов, уведомления об обучении, одна сессия на ученика, SameSite cookie,
  срок уровней 15–30, юридические страницы.
- **DD-344 (Locked, PATH STRIP, 2026-10-04).** **Текущий уровень ветвится к своей панели одной
  линией; названия уровней — шрифтом заголовков; на ленте ничего не обрезано.** Владелец: «кружок,
  подсвечивающий актуальный уровень, обрезан… проверить на подобные ошибки», «названия уровней слишком
  просто показаны», «снизу слева полоска непонятная — задумка хорошая, но реализация ужасная». Из трёх
  направлений («Ветка», «Карточки уровней», «Подписи над линией») выбрана «Ветка»: (1) лента не
  обрезает на компьютере и даёт поле свечению там, где прокручивается; слова уровня, сдвинутого за
  край, скрыты на 600–899 px, как на телефоне; (2) одна линия от нижнего края текущего кружка до края
  панели, с узлом, на центре кружка (рисует `path-rail.tsx`); уголки панели не рисуются; слова текущего
  уровня правее линии, мягкий свет по его колонке; (3) название — шрифт заголовков (17/19 px), код —
  моно-метка, тип — тихое слово, состояние — капсула. Проверка всего продукта на ту же ошибку и ревью —
  `design-memory/reviews/path-strip-review.md`.
- **DD-345 (Locked, PUBLIC HOME FILM, 2026-10-04).** **Рамка первого экрана держит фильм о
  платформе; «чужие ответы» — реплики.** Владелец: «оставляли место для плеера — давай его туда
  поставим уже» (видео пока нет — «плеер с обложкой»), «тут нужен хай фай», «выбери сам», «по
  готовности». (1) Сцена 16:9 в видоискателе Decision Frame: без файла — обложка «Скоро» без единой
  кнопки; с файлом — та же обложка с кнопкой, нажатие ставит плеер уроков и запускает его; уголки снаружи
  сцены. (2) Файл живёт на хосте: `<ATA_MEDIA_ROOT>/public/film/hero.mp4|webm` (+ `hero.jpg|webp|png`,
  `hero.vtt`), проверяется при каждом показе — новый монтаж без выкатки; `/film/<имя>` отдаёт только эти
  имена с Range, гостю доступно. (3) Шесть видов чужого ответа — реплики с меткой и строкой ответа, стопка
  сходится к линии, края бледнеют; на узких экранах по две в ряд. Направления «Облако на тёмном» и
  «Вычёркивание» отклонены. Ревью — `design-memory/reviews/public-home-film-review.md`.
- **DD-346 (Locked, PATH STRIP POINTER, 2026-10-06).** **Полоса «Пути» — уровень позади, текущий и три
  впереди; палочка ходит за указателем по открытым уровням.** Владелец: «было видно не нынешний уровень и
  следующие 4, а 1 прошедший», «завершен и начать появляется в момент наведения, так же по наведению
  двигается палочка наша с подсветкой, но на уровни которые еще не открыты ее завести нельзя и они
  затемненные»; ответы: «Начать» — всегда, и на уровне, который ещё готовится (рекомендовал «Готовится» без
  ссылки — владелец выбрал иначе), выкатка «по готовности». (1) Окно из пяти уровней через границы модулей
  (`stripWindow`), у концов программы сдвигается внутрь; граница модуля — короткая вертикаль на оси,
  уровень чужого модуля подписан «· модуль NN» один раз. (2) Открытые уровни (пройденные и текущий) держат
  слова справа от линии и несут подсветку; при наведении мыши/пера или фокусе клавиатуры ветка плавно
  переходит на уровень (`point` в `path-rail.tsx`, `data-glide`), над закрытым остаётся на месте, уход
  указателя возвращает её к текущему; касание её не двигает. (3) «Завершён» у пройденного, «Начать →» у
  текущего (ссылка на урок); место под ними занято заранее, появляются при наведении; на устройствах без
  наведения видны сразу. Состояние уровня для экранного диктора — в скрытом тексте. (4) Закрытые уровни
  приглушены цветом (имя 0,5, код и тип 0,36). (5) Там, где пройденный и текущий помещаются рядом,
  полоса открывается на них. Направления «Подъём» (без скольжения) и «Магнит» (растягивание) отклонены.
  Ревью — `design-memory/reviews/path-strip-pointer-review.md`.
- **DD-347 (Locked, ENTRY BASIS, 2026-10-06).** **Поле сделки до входа называется «основание».** Владелец:
  «в Trading Journal в записи план нужно заменить на основание»; про Trade Card — «Там заменяем на Основание
  входа в сделку». (1) Trade Card: метка поля — «Основание входа в сделку», ошибки — «Запишите основание
  входа…», «Основание — не длиннее…». (2) Журнал: в записи «Основание · Исполнение · Вывод» (пусто —
  «Основание не записано»), в форме новой записи — «Основание входа в сделку», подзаголовок инструмента —
  «Ручной разбор отдельных сделок: основание, исполнение и вывод.». (3) Нарушение `no_reason` (подпись живёт
  в бэкенде, в записях хранится только код) — «Вход без записанного основания». (4) Публичная главная
  показывает то же поле теми же словами: окно Trade Card, шаг цикла, разбор (критерий «Основание до
  сделки»), описания инструментов. «План» остаётся там, где речь о соблюдении торгового плана: «По плану»,
  «План нарушен», «План соблюдён?», «Сумма больше плана», и в описании Trade Card «План сделки до входа».
  Снимки — `design-memory/screenshots/entry-basis/`.
- **DD-348 (Locked, HOME LIST + LESSON HEADER, 2026-10-06).** Владелец: «показываем 3 уровня которые пройдены
  ранее, 1 актуальный и 1 следующий, вместо готовиться кнопки открытия урока и подсветка по мере завершения»;
  «сделать выделение для название урока и отдельное выделение области [фактов] … и сделать подсвечивание +xp»;
  ответы: следующий уровень приглушён, без кнопки; выкатка по готовности. (1) Список на главной — пять строк
  через границы модулей (`homeListRows`): три пройденных («Открыть урок», вся строка — ссылка), уровень, на
  котором стоит ученик («Начать →», и на готовящемся — `ProgramPoint.pageHref`, как на «Пути»), следующий —
  приглушён, без ссылки, тихое слово («откроется следующим» / «готовится» / «впереди»). Линия светится через
  пройденные; строка другого модуля подписана «· модуль N» один раз, граница — волосяная линия. (2) Шапка
  урока — табличка с заголовком (приподнятая поверхность с угловым светом, шириной со сцену, но не уже 880 px)
  и отдельная полоса фактов в 10 px под ней; «+N XP» — единственный светящийся ярлык (Signal), что отменяет
  «never lit» из DD-336 по слову владельца. Бюджет первого экрана `--ld-stage-fit` 430 → 490 px. Направления
  «Карточки», «Лента как на Пути», «Рамка», «Полоса сцены» отклонены. Ревью —
  `design-memory/reviews/home-list-lesson-head-review.md`.

## Открытые вопросы (решаются позже)

- **OQ-1.** Точная палитра и финальные шрифты — после assets прелендинга.
- **OQ-2.** Содержимое «Секретного инструмента».
- **OQ-3.** Лимиты XP за последующие referrals — backend.
- **OQ-4.** Точные backend-контракты (checkpoint verification, balance-gate, mentor queue).
- **OQ-5.** Провайдер News Calendar (сейчас provider-agnostic). **Ответ владельца 2026-09-21:**
  новости вносит вручную сотрудник с ролью копирайтера в CRM; каждая новость — отдельная страница,
  индексируемая поисковиками (на PREPROD — noindex). Реализация — слайс News Calendar (DD-315).
  **Закрыт DD-320:** индексируются только главная и новости и только на PROD; на PREPROD — ничего.
  **Пересмотрено DD-326 (22.09.2026):** новости не индексируются нигде и не показываются на публичной
  главной — только ученикам после входа; на PROD данные будут приходить по API стороннего сервиса
  с правкой копирайтером (провайдер — открыт).
- **OQ-6.** Юридические/риск-тексты и дисклеймеры. **К учёту (DD-332, 02.10.2026):** окно Cloudflare Turnstile
  показывается только по требованию, поэтому политика конфиденциальности должна сама назвать
  Turnstile и сослаться на условия Cloudflare.
