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

## Открытые вопросы (решаются позже)

- **OQ-1.** Точная палитра и финальные шрифты — после assets прелендинга.
- **OQ-2.** Содержимое «Секретного инструмента».
- **OQ-3.** Лимиты XP за последующие referrals — backend.
- **OQ-4.** Точные backend-контракты (checkpoint verification, balance-gate, mentor queue).
- **OQ-5.** Провайдер News Calendar (сейчас provider-agnostic).
- **OQ-6.** Юридические/риск-тексты и дисклеймеры.
