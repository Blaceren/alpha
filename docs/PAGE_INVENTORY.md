# PAGE_INVENTORY

Инвентарь страниц Alfa Trade Academy Web V2. Для каждой страницы: route · user goal · primary action · secondary actions · hierarchy · components · states · desktop · tablet · mobile · mock data · future backend data · analytics events · edge cases · acceptance criteria.

Коды/маршруты — `ROUTE_MAP.md` (канонический App Router синтаксис `[param]`). Состояния — `STATE_MATRIX.md`. Компоненты — `COMPONENT_INVENTORY.md`. Тексты и терминология — `CONTENT_AND_TONE.md`.

Терминология: пользовательские названия страниц/разделов — русские (Сообщество, Ментор, Отчёт, Контрольная точка, Ранг, Поддержка, Рефералы, Инструменты, Недельный обзор). Английские термины сохраняются только как code/domain language: имена компонентов (`CommunityMessage`), route codes (`tool.trading_journal`), analytics-события (`community_view`), enum-токены состояний (`draft/pending`). Названия конкретных инструментов пока могут быть английскими с русским описанием рядом.

Инварианты для всех страниц: dark-only; один очевидный следующий шаг; никакого баланса пользователя / «осталось $X»; длинные PL-строки не ломают верстку; touch ≥44px; visible focus; no horizontal overflow.

---

## 1. Главная — `/`

- **User goal:** понять «что делать сейчас».
- **Primary action:** единственный primary CTA по приоритету: (1) текущая контрольная точка, если она уже обязательный шаг; (2) активный урок; (3) обязательное задание; (4) исправление отклонённого отчёта; (5) feedback ментора; (6) возвращение после паузы; (7) Недельный обзор.
- **Secondary actions:** открыть Путь; открыть недавний инструмент; прочитать статью; заглянуть в Сообщество.
- **Hierarchy (первый viewport):** приветствие · текущий ранг · текущий уровень · один primary CTA · XP · прогресс текущего модуля · горизонтальный участок пути · серия обучения. Ниже: недавно открытый инструмент · сообщение Alex Curie · релевантная статья · лента Сообщества · статус ментора/поддержки (если реально активен). Не более 5–6 конкурирующих блоков в первом viewport.
- **Components:** PageHeader, RankBadge, XPIndicator, ModuleProgress, PathTrack (участок), StreakIndicator, PrimaryCTA, AlexCurieMessage, ArticleCard, community activity, status card.
- **States:** обычный; возврат после паузы; контрольная точка активна; ждёт отклонённый отчёт; есть feedback ментора; пустое Сообщество.
- **Desktop:** sidebar + top bar; путь-участок горизонтально; блоки в 1–2 колонки.
- **Tablet:** compact rail; путь горизонтально; блоки в 1–2 колонки по ориентации.
- **Mobile:** bottom nav (Главная/Путь/Уроки/Инструменты/Ещё), профиль через avatar в top bar; вертикальный стек; путь-участок горизонтально скроллится; primary CTA закреплён логически вверху.
- **Mock data:** rank, level, XP, streak, module progress, next-step объект, 1 статья, community-снапшот.
- **Future backend data:** progression state, checkpoint state, mentor/report статусы, рекомендованный next step, персональная статья.
- **Analytics:** `home_view`, `home_primary_cta_click`, `home_secondary_click`.
- **Edge cases:** несколько кандидатов на primary (разрешает приоритет); нет активного урока (fallback на Путь); первый визит (onboarding).
- **Acceptance:** за секунды видно где/уровень/rank/что дальше; ровно один primary CTA; нет баланса; ≤6 блоков в первом экране; снят QA в 3 размерах.

## 2. Путь — `/path`

> **Статус (D2A):** реализована первая полноценная версия — окно одного модуля на Route Field
> (вместо длинной ленты из 100 узлов), сегментная лента 20 модулей, contextual detail (side
> plane/sheet), «К текущему уровню», keyboard/a11y, сценарии через `?scenario=`. Смысловые
> acceptance-пункты ниже сохранены; форма «длинная горизонтальная лента» уточнена решением
> DD-230 (visible window). Детали — `D2A_PATH_ARCHITECTURE.md`.

- **User goal:** видеть весь маршрут и текущую позицию.
- **Primary action:** продолжить с активного уровня.
- **Secondary actions:** открыть пройденный урок; развернуть/свернуть модуль; открыть checkpoint; «К текущему уровню».
- **Hierarchy:** горизонтальная лента L1–100, текущий центр; ~5–7 nodes видно; награда важнее номера; иконка типа активности.
- **Components:** PathTrack, PathNode (10 состояний), ModuleGroup, BackToCurrentButton, CheckpointCard (inline), LockedLevelExplainer, A11yPathList.
- **States:** node — hidden/locked/xp-eligible/active/in-progress/pending-review/completed/checkpoint/grace/suspended.
- **Desktop:** длинная горизонтальная лента; hover-детали; клавиатурная навигация.
- **Tablet:** горизонтальный path; touch-скролл; сворачивание модулей.
- **Mobile:** горизонтальный скролл, крупные nodes, кнопка «К текущему уровню».
- **Mock data:** 100 nodes с состояниями, модули, checkpoints, награды.
- **Future backend data:** реальное состояние прогресса/уровней/checkpoints.
- **Analytics:** `path_view`, `path_node_click`, `path_back_to_current`, `locked_level_explainer_view`.
- **Edge cases:** быстрый scroll не ломает центрирование; локед-клик даёт explainer; suspended — приглушение будущего.
- **Acceptance:** автоцентр текущего; сохранение scroll; explainer без перепрыгивания; screen-reader list-альтернатива; QA 3 размера.

## 3. Уровень (деталь) — `/path/level/[levelCode]`

- **User goal:** понять конкретный уровень.
- **Primary action:** начать/продолжить (если доступен) либо прочитать explainer (если locked).
- **Secondary actions:** к связанному tool/уроку; назад к пути.
- **Hierarchy:** module+level · название · короткая цель/хук · статус · действие.
- **Components:** LockedLevelExplainer, CheckpointCard (если checkpoint), CTA.
- **States:** locked/active/in-progress/completed/checkpoint/grace/suspended.
- **Analytics:** `level_detail_view`, `level_start_click`.
- **Edge cases:** checkpoint-уровень показывает checkpoint-состояния; locked — explainer.
- **Acceptance:** объясняет что/почему/что нужно/что откроется; без перепрыгивания.

## 4. Уроки (библиотека) — `/lessons`

- **User goal:** вернуться к открытым урокам.
- **Primary action:** открыть активный урок.
- **Secondary actions:** открыть пройденный; фильтр по модулю.
- **Hierarchy:** активный урок выделен; список открытых по модулям.
- **Components:** список, LessonHeader-preview, фильтры по модулю.
- **States:** есть активный; только пройденные; пусто (ранний прогресс).
- **Desktop/Tablet/Mobile:** список/сетка → адаптивная колоночность.
- **Mock data:** открытые уроки, активный.
- **Future backend data:** доступные уроки по прогрессу.
- **Analytics:** `lessons_view`, `lesson_open_from_library`.
- **Edge cases:** пусто до L2; заблокированные не показываются как открытые.
- **Acceptance:** дефолт — подсвечен активный урок; только открытые доступны.

## 5. Урок — `/lessons/[levelCode]`

> **Реализован в D2B.** Проверка понимания живёт **на этой же странице под видео** (правило «видео перед
> тестом»), а не на отдельном маршруте. Уточнения D2B: позиция видео **не** сохраняется (нет persistence);
> при неверном ответе правильный вариант **не** раскрывается — вопрос остаётся открытым для повтора
> (DD-247); subtitles присутствуют как affordance над simulated media. Детали — `D2B_LESSON_EXPERIENCE.md`.

- **User goal:** пройти урок.
- **Primary action:** смотреть видео → (на 50%) начать тест.
- **Secondary actions:** открыть связанный tool; focus/full-screen; назад.
- **Hierarchy:** возврат · module+level · название · короткая цель · video · video progress · related tool · test launcher · completion.
- **Components:** LessonHeader, LessonPlayer, VideoProgress, RelatedToolLink, TestLauncher, CompletionState, AlexCurieMessage (preview).
- **States:** тест locked (<50%) → available; in progress; completed.
- **Desktop:** видео крупно, sidebar виден.
- **Tablet:** видео адаптивно, landscape видео.
- **Mobile:** видео вверху, subtitles, безопасные отступы.
- **Mock data:** video src, subtitles, related tool code.
- **Future backend data:** позиция видео, completion, привязка теста.
- **Analytics:** `lesson_opened`, `video_progress_50`, `related_tool_open`, `lesson_completed`.
- **Edge cases:** видео не грузится (fallback); просмотр 50% не завершает уровень; следующий урок скрыт до completion.
- **Acceptance:** subtitles обязательны; позиция сохраняется; тест открывается на 50%; QA 3 размера + landscape.

## 6. Тест — `/lessons/[levelCode]/test`

> **В D2B не реализуется как отдельный маршрут** (DD-242): проверка встроена в страницу урока. Раздел ниже
> описывает исходный замысел и пересматривается в D3. Расхождения, закреплённые D2B: один вопрос за раз
> с немедленным feedback после submit; верный ответ обязателен для перехода к следующему вопросу;
> при неверном ответе правильный вариант **не** показывается; passed/failed не вводятся — все вопросы
> обязательны, проходного процента нет (DD-245).

- **User goal:** проверить понимание.
- **Primary action:** ответить и завершить.
- **Secondary actions:** изменить ответ; вернуться к материалу.
- **Hierarchy:** progress bar · один вопрос · варианты/chart · навигация.
- **Components:** TestQuestion, TestProgressBar, TestResult.
- **States:** available/in-progress/answered/passed/failed.
- **Mobile:** крупные варианты, chart image масштабируется.
- **Mock data:** вопросы (в т.ч. scenario и chart), правильные ответы, explanations.
- **Future backend data:** банк вопросов, попытки.
- **Analytics:** `test_started`, `test_submitted`, `test_passed`, `test_failed`, `test_retry`, `mentor_offer_shown`.
- **Edge cases:** no timer; «отказаться от сделки» как правильный ответ; после серии неудач — mentor offer.
- **Acceptance:** по одному вопросу; ответ меняется до завершения; explanation после; при fail показан правильный ответ.

## 7. Отчёт — `/reports/[reportCode]`

- **User goal:** сдать structured отчёт и получить feedback ментора.
- **Primary action:** submit (или сохранить draft).
- **Secondary actions:** добавить images/video; смотреть rubric/пример; version history.
- **Hierarchy:** заголовок задания · rubric/пример · секции формы · вложения · статус.
- **Components:** ReportForm, ReportAttachment, ReportStatusBadge, SectionComment, VersionHistory.
- **States:** draft/pending/approved/rejected/resubmitted.
- **Desktop:** форма + rubric сбоку.
- **Tablet/Mobile:** rubric сворачивается; клавиатура не перекрывает поле.
- **Mock data:** секции, rubric, пример, статусы, комментарии.
- **Future backend data:** очередь mentor, версии, вердикты.
- **Analytics:** `report_draft_saved`, `report_submitted`, `report_approved`, `report_rejected`, `report_resubmitted`.
- **Edge cases:** autosave при обрыве; rejected → комментарии к секциям → исправление в том же report; без countdown; без mentor avatar.
- **Acceptance:** autosave работает; статусы корректны; «Обычно проверка занимает до одного дня»; QA 3 размера.

## 8. Инструменты (hub) — `/tools`

- **User goal:** попасть в нужный инструмент / вернуться к последнему.
- **Primary action:** открыть последний редактируемый инструмент.
- **Secondary actions:** выбрать инструмент по группе; посмотреть locked preview.
- **Hierarchy:** группы инструментов (см. IA §6); открытые vs locked.
- **Components:** ToolShell-навигация, LockedToolPreview, карточки инструментов.
- **States:** есть открытые; много locked; secret placeholder.
- **Mock data:** список инструментов с unlock-уровнями, состояние доступа.
- **Future backend data:** реальные unlock-статусы, последний открытый.
- **Analytics:** `tools_hub_view`, `tool_card_click`, `locked_tool_preview_view`.
- **Edge cases:** ранний прогресс — почти всё locked; дефолт на Hub без истории.
- **Acceptance:** дефолт — последний редактируемый; locked показывает «что/когда»; QA 3 размера.

## 9. Инструмент (каждый) — `/tools/[toolCode]`

Всего 20 инструментов в интерфейсе: **19 curriculum-инструментов** (открываются на L10–L100) + **Секретный инструмент** (referral-gated, не имеет level unlock). Общие инварианты всех инструментов: только manual data; никакой автоподгрузки Pocket balance/broker wallet; ToolShell со состояниями locked/empty/draft/saved/versioned; EmptyState с примером. Общие analytics: `tool_open`, `tool_entry_created`, `tool_entry_saved`, `tool_versioned` (+ специфичные ниже). Общие acceptance: заполняется вручную; empty state с примером; данные приватны; QA 3 размера.

| Tool | Route code | Unlock | User goal | Primary action | Ключевые компоненты/поля | Специфика / edge cases |
|------|-----------|:------:|-----------|----------------|--------------------------|------------------------|
| Trading Journal | tool.trading_journal | L10 | вести дневник сделок | добавить запись | before/after entry, asset, setup, direction, expiration, manual risk, reason, result, plan followed, error, good action, screenshot, tags; list/calendar, drafts, filters | результат не завершает оценку; фильтры; календарь |
| Risk Calculator | tool.risk_calculator | L15 | рассчитать риск | рассчитать | «сумма для расчёта» (не баланс), risk %, risk amount, session limit, daily stop, scenarios, formula explanation, saved plan | значение НЕ называется «баланс Pocket» |
| Chart Markup | tool.chart_markup | L20 | размечать график | загрузить скрин и разметить | upload, crop, line, zone, rect, arrow, text, S/R, trend, invalidation, undo/redo, layers, versions, attach to journal/report, export | по uploaded screenshot, НЕ live chart; landscape |
| Indicator Checklist | tool.indicator_checklist | L25 | проверить сигналы | заполнить checklist | context, observations, contradictions, red flags, no-trade result, templates, history | «no-trade» как валидный итог |
| News Calendar | tool.news_calendar | L30 | планировать вокруг новостей | добавить событие | date, time, timezone, country, currency, importance, forecast, actual, notes, watch, avoid window | provider-agnostic; timezone-корректность |
| Pause Mode | tool.pause_mode | L35 | взять контролируемую паузу | начать паузу | trigger, duration, reason, safe actions, return checklist | no shame, no recovery pressure |
| Weekly Review (Недельный обзор) | tool.weekly_review | L40 | недельный обзор | создать обзор | summary, discipline, plan followed, mistakes, good decisions, no-trade decisions, next focus, mentor optional | mentor опционален |
| Strategy Builder | tool.strategy_builder | L45 | собрать стратегию | создать strategy card + отправить на review | context, setup, entry rules, confirmation, disqualifiers, timeframe, expiration, risk, examples, versions, mentor review | pending mentor review |
| Capital Plan | tool.capital_plan | L50 | план капитала | сохранить план | working capital, reserve, risk boundaries, warning levels, pause, recovery protocol, manual values | только manual values |
| Market Regime Board | tool.market_regime_board | L55 | оценить режим рынка | зафиксировать режим | trend/range/volatile/unclear, HTF/LTF, evidence, compatible/prohibited setups, screenshots | согласование setup ↔ режим |
| Session Planner | tool.session_planner | L60 | спланировать сессию | создать план сессии | date/time, assets, news, payout note, connection check, state check, limits, allowed setups, stop conditions, session audit | audit план vs факт |
| Strategy Statistics | tool.strategy_statistics | L65 | анализ статистики | посчитать по journal data | win rate, payout, expectancy, sample size, splits (setup/asset/regime/time), small-sample warnings | предупреждения о малой выборке |
| Watchlist | tool.watchlist | L70 | ограниченный watchlist | добавить актив | limited assets, reason, session/time, setup, news, weekly archive | ограничение числа активов |
| Psychology Check-in | tool.psychology_checkin | L75 | оценить состояние | пройти check-in | confidence, fear, fatigue, FOMO, revenge impulse, tilt, recommended pause, history | private by default |
| Habit Calendar | tool.habit_calendar | L80 | ритм привычки | отметить активности | learning, journal, review, preparation, rest, 30-day plan, weekly rhythm | нет обязательной ежедневной торговли |
| Mentor Case Room | tool.mentor_case_room | L85 | разобрать кейс с mentor | отправить кейс | full case, chart, context, risk, decision, outcome, review, defense, mentor comments, revisions | защита кейса; revisions |
| Performance Dashboard | tool.performance_dashboard | L90 | видеть процессные метрики | смотреть дашборд | equity-like curve, drawdown, variance, strategy stability, execution quality, learning consistency, process metrics | на manual journal data; НЕ broker wallet |
| Personal Playbook | tool.personal_playbook | L95 | собрать личный playbook | создать playbook + review | setups, entry/refusal rules, risk plan, pause, red flags, session process, weekly review, versions, mentor review | mentor review; versions |
| Pro Workspace | tool.pro_workspace | L100 | собрать рабочее пространство | настроить виджеты | widgets: plan/journal/calendar/watchlist/strategy/risk/psychology/performance/playbook, levels 101+ preview | НЕ trading terminal |
| Секретный инструмент | tool.secret | referral | получить reward | (до открытия — teaser) | silhouette, transparent qualification, progress | no countdown, no fake scarcity; содержимое позже |

## 10. Сообщество — `/community`

- **User goal:** участвовать в открытых каналах.
- **Primary action:** открыть релевантный канал / написать сообщение.
- **Secondary actions:** reply, reaction, image, report; смотреть member card; locked preview.
- **Hierarchy:** список каналов (открытые + locked preview) · тред.
- **Components:** ChannelList, CommunityMessage, MemberCard, RankBadge, ModerationAction, locked preview.
- **States:** locked preview/unlocked/moderation flagged.
- **Analytics:** `community_view`, `channel_open`, `message_sent`, `message_reaction`, `message_reported`.
- **Edge cases:** ранний прогресс — только L4-канал; скрытие ранга опционально; никаких leaderboards.
- **Acceptance:** каналы по unlock (L4/20/35/45/85); rank badges; QA 3 размера.

## 11. Новости (в продукте) — `/news`, статья `/news/[slug]`

- **User goal:** читать релевантный контент.
- **Primary action:** открыть статью «Подходит к текущему модулю».
- **Secondary actions:** bookmark, read later, topic filters, related lessons.
- **Hierarchy:** general feed + «Подходит к текущему модулю» · карточки · статья с related lessons.
- **Components:** ArticleCard, ArticleView, TopicFilter, RelatedLessons.
- **States:** feed/empty/bookmarked.
- **Analytics:** `news_view`, `article_open`, `article_bookmark`, `related_lesson_click`.
- **Edge cases:** нет релевантной статьи (fallback на general).
- **Acceptance:** in-product feed отделён от публичного контура; related lessons связаны.

## 12. Публичная статья — `/blog/[slug]` (SEO), категории `/blog/category/[categorySlug]`, авторы `/blog/author/[authorSlug]`

- **User goal (public):** прочитать статью из поиска/соцсетей.
- **Primary action:** прочитать; перейти к продукту (CTA бренда).
- **Secondary actions:** related articles; категория.
- **Hierarchy:** заголовок · автор · дата · reading time · тело · related.
- **Components:** ArticleView (public), ArticleCard (related), category nav.
- **States:** опубликовано; черновик (не индексируется).
- **Mock data:** статьи, категории, авторы, метаданные.
- **Future backend data:** CMS-контент, SEO-метаданные, PL-локали.
- **Analytics:** `public_article_view`, `public_cta_click` (без персональных данных в URL).
- **Edge cases:** без комментариев; social preview; PL-локализация позже.
- **Acceptance:** indexable; SEO-метаданные и social preview; отделено от авторизованной оболочки.

## 13. Рефералы — `/referrals`

- **User goal:** пригласить друга и получить reward.
- **Primary action:** поделиться реферальной ссылкой.
- **Secondary actions:** смотреть статусы приглашённых; teaser Секретного инструмента.
- **Hierarchy:** ссылка · условия · статусы приглашённых · reward-state.
- **Components:** ReferralPanel, SecretRewardTeaser, статус-карточки.
- **States:** not shared/invited/pocket-in-progress/qualifying/qualified/reward-unlocked.
- **Mock data:** ссылка, список приглашённых (сокр. имя, avatar, progress), reward-статус.
- **Future backend data:** реальные статусы qualification, XP-лимиты.
- **Analytics:** `referral_view`, `referral_link_shared`, `referral_reward_unlocked`.
- **Edge cases:** приглашающий не видит email/Pocket ID/balance/deposit/trading; прозрачные условия; no fake scarcity.
- **Acceptance:** flow до L4 отражён; приватность приглашённого соблюдена.

## 14. Ментор — `/mentor`, диалог `/mentor/[conversationId]`

- **User goal:** получить образовательный feedback.
- **Primary action:** открыть активный review / отправить сообщение.
- **Secondary actions:** прикрепить отчёт/стратегию/кейс; смотреть revisions.
- **Hierarchy:** активный диалог · история · вложения.
- **Components:** MentorThread, MentorReviewPanel, CaseDefensePanel.
- **States:** no active/awaiting/feedback/revision/resolved.
- **Analytics:** `mentor_view`, `mentor_message_sent`, `mentor_feedback_received`, `mentor_revision_requested`.
- **Edge cases:** без конкретного avatar; отдельно от Поддержки.
- **Acceptance:** дефолт — активный диалог/review; не смешан с Поддержкой.

## 15. Поддержка — `/support`, `/support/new`, `/support/[ticketId]`

- **User goal:** решить проблему через тикет.
- **Primary action:** открыть активный тикет / создать новый.
- **Secondary actions:** category, attachments, reopen.
- **Hierarchy:** список тикетов · тред · статус.
- **Components:** TicketList, TicketThread, CreateTicketForm.
- **States:** open/waiting-support/waiting-user/resolved/reopened.
- **Analytics:** `support_view`, `ticket_created`, `ticket_replied`, `ticket_resolved`, `ticket_reopened`.
- **Edge cases:** дефолт — активный тикет; reopen resolved; отдельно от Ментора.
- **Acceptance:** Ticket Center отделён от Ментора; статусы корректны.

## 16. Уведомления — `/notifications`

- **User goal:** видеть и управлять уведомлениями.
- **Primary action:** открыть уведомление / перейти к источнику.
- **Secondary actions:** отметить прочитанным; настроить каналы (в Settings).
- **Hierarchy:** категории: Обучение/Ментор/Сообщество/Система/Новости/Награды.
- **Components:** NotificationCenter, NotificationItem.
- **States:** read/unread; по категориям.
- **Analytics:** `notifications_view`, `notification_click`, `notification_read`.
- **Edge cases:** нельзя отключить security/critical/статус обязательного задания.
- **Acceptance:** категории присутствуют; неотключаемые каналы защищены.

## 17. Профиль — `/profile`

- **User goal:** видеть свой статус и открытые материалы.
- **Primary action:** вернуться к обучению (к текущему шагу).
- **Secondary actions:** открыть материалы; настройки; приватность ранга.
- **Hierarchy:** ранг · XP · серия обучения · открытые уроки/инструменты · достижения.
- **Components:** ProfileHeader, RankBadge, XPIndicator, StreakIndicator, UnlockedMaterials.
- **States:** обычный; ранний прогресс.
- **Mock data:** ранг, XP, streak, открытые материалы.
- **Future backend data:** реальный прогресс, история.
- **Analytics:** `profile_view`, `profile_material_open`.
- **Edge cases:** нет баланса/финансов; серия отражает reset без наказания.
- **Acceptance:** нет финансовых данных; ранг без суммы; QA 3 размера.

## 18. Настройки — `/settings`, `/settings/notifications`

- **User goal:** настроить продукт под себя.
- **Primary action:** сохранить настройки.
- **Secondary actions:** язык; приватность ранга в Сообществе; каналы уведомлений.
- **Hierarchy:** notifications prefs · язык · приватность · аккаунт.
- **Components:** SettingsPanel, NotificationPrefs.
- **States:** default/changed/saved.
- **Analytics:** `settings_view`, `settings_saved`, `notification_pref_changed`, `rank_privacy_toggled`, `language_changed`.
- **Edge cases:** нельзя отключить security/critical/обязательные задания; смена языка RU↔PL (позже); изменение настроек = требует явного действия пользователя.
- **Acceptance:** неотключаемые уведомления защищены; PL-готовность; QA 3 размера.

---

## Покрытие

Покрыты все требуемые страницы: Главная, Путь (+ Уровень), Уроки, Урок, Тест, Отчёт, Инструменты (hub), каждый инструмент (20 = 19 curriculum + Секретный), Сообщество, Новости, Публичная статья, Рефералы, Ментор, Поддержка, Уведомления, Профиль, Настройки.
