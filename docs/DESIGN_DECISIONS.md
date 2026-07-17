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

## Открытые вопросы (решаются позже)

- **OQ-1.** Точная палитра и финальные шрифты — после assets прелендинга.
- **OQ-2.** Содержимое «Секретного инструмента».
- **OQ-3.** Лимиты XP за последующие referrals — backend.
- **OQ-4.** Точные backend-контракты (checkpoint verification, balance-gate, mentor queue).
- **OQ-5.** Провайдер News Calendar (сейчас provider-agnostic).
- **OQ-6.** Юридические/риск-тексты и дисклеймеры.
