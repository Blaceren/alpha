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

- **DD-040 (Locked).** Desktop: сворачиваемый sidebar (Главная, Путь, Уроки, Инструменты, Community, Новости, Реферальная программа, Mentor, Support, Профиль) + top bar (rank, XP, notifications, profile, contextual actions).
- **DD-041 (Locked).** Mobile: bottom navigation из 5 (Главная, Путь, Уроки, Инструменты, Профиль); остальное — в доп. меню (Community, Новости, Рефералы, Mentor, Support, Настройки).
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

## Открытые вопросы (решаются позже)

- **OQ-1.** Точная палитра и финальные шрифты — после assets прелендинга.
- **OQ-2.** Содержимое «Секретного инструмента».
- **OQ-3.** Лимиты XP за последующие referrals — backend.
- **OQ-4.** Точные backend-контракты (checkpoint verification, balance-gate, mentor queue).
- **OQ-5.** Провайдер News Calendar (сейчас provider-agnostic).
- **OQ-6.** Юридические/риск-тексты и дисклеймеры.
