# COMPONENT_INVENTORY

Инвентарь компонентов Alfa Trade Academy Web V2. Provisional — уточняется при реализации (D1+). Компоненты используют semantic tokens (`DESIGN_SYSTEM.md`), выдерживают длинные польские строки и покрывают состояния из `STATE_MATRIX.md`.

> **D1A реализовано (foundation-подмножество).** Построены в `src/components/`:
> ui — Button, IconButton, Badge, Tooltip (Radix), Surface, Avatar, VisuallyHidden, Icon (lucide-реестр);
> shell — AppShell, TopBar, LogoPlaceholder (provisional), NotificationButton;
> navigation — AppNavigation (desktop), MobileNavigation (bottom, 5 пунктов + «Ещё»);
> progression — RankBadge (+locked silhouette), XPIndicator, LearningStreak, ModuleProgress, PathPreview (варианты portal/atlas/strip), PathNode, CheckpointPreview, ToolUnlockPreview;
> dashboard — PrimaryAction, AlexMessage (provisional media), homes/{ProductPortalHome, MarketAtlasHome, EditorialAcademyHome}.
> Это минимальный набор для трёх концептов Главной, не полная UI-библиотека.

Легенда фазы: где компонент впервые нужен (D1 foundation … D9).

---

## 1. Primitives (D1)

| Компонент | Варианты / состояния | Заметки |
|-----------|----------------------|---------|
| Button | primary, secondary, ghost, danger; default/hover/active/focus/disabled/loading | touch ≥44px; один primary на экран |
| IconButton | те же состояния | aria-label обязателен |
| Input / Textarea | default/focus/error/disabled; helper/error text | labels обязательны, helpful errors |
| Select / Combobox | open/closed/disabled | клавиатурная навигация |
| Checkbox / Radio / Switch | on/off/indeterminate/disabled | не color-only |
| Slider / Stepper | — | для risk %, лимитов |
| Chip / Tag | selectable, removable, status | topic filters, tags |
| Badge | count, dot, status | notifications |
| Avatar | user, fallback initials | mentor avatar НЕ показывается |
| Tooltip | hover/focus | не единственный носитель смысла |
| Skeleton | text/box/node | загрузка |
| Spinner / ProgressBar | determinate/indeterminate | video/test/report progress |
| Divider | subtle/default | — |

## 2. Layout & shell (D1)

| Компонент | Заметки |
|-----------|---------|
| AppShell | sidebar + top bar (desktop) / bottom nav (mobile) / rail (tablet) |
| Sidebar | collapsible, icon rail |
| TopBar | rank, XP, notifications, profile, contextual actions |
| BottomNav | 5 пунктов (Главная/Путь/Уроки/Инструменты/**Ещё**); профиль — через avatar в mobile top bar, не в bottom nav |
| MoreMenu | раздел «Ещё»: Сообщество/Новости/Рефералы/Ментор/Поддержка/Профиль/Настройки |
| PageHeader | заголовок + contextual actions |
| TabBar | функциональные табы |
| Breadcrumbs (light) | контекст внутри tool/community |

## 3. Overlays (D1)

| Компонент | Заметки |
|-----------|---------|
| Dialog / Modal | focus trap, esc, visible focus |
| Sheet (bottom/side) | mobile-friendly, safe-area |
| Popover / Dropdown | keyboard nav |
| Toast | статусные, недлинные |
| ConfirmDialog | для необратимых действий |

## 4. Progression & emotional (D2)

| Компонент | Состояния | Заметки |
|-----------|-----------|---------|
| PathTrack | горизонтальный, автоцентр, виртуализация | линия ~ мотив рынка, не ценовой график |
| PathNode | hidden/locked/xp-eligible/active/in-progress/pending-review/completed/checkpoint/grace/suspended | награда важнее номера, иконка типа активности |
| BackToCurrentButton | появляется после ручной прокрутки | «К текущему уровню» |
| ModuleGroup | сворачиваемый завершённый модуль | — |
| LockedLevelExplainer | что/почему/что нужно/что откроется | без перепрыгивания |
| RankBadge | 5 families × I–IV; compact/large | без суммы; скрываем в community опционально |
| RankUpScene | 2–4 c, skippable | после — practical unlock |
| CheckpointCard | upcoming/current/checking/completed/data-unavailable/grace/suspended | только целевая сумма, без баланса юзера |
| XPIndicator | — | не за trade/deposit/loss |
| StreakIndicator | active/at-risk/reset | «Серия обучения», без красного наказания |
| MilestoneOverlay | module/tool/community/referral/L100 | skippable, reduced-motion fallback |
| ProgressRing / ModuleProgress | — | прогресс текущего модуля |

## 5. Learning (D3)

| Компонент | Заметки |
|-----------|---------|
| LessonHeader | module+level, название, короткая цель, возврат |
| LessonPlayer | subtitles обязательны, сохранение позиции, focus/full-screen; без chapters/transcript/speed в v1; без PiP |
| VideoProgress | разблокирует тест на 50% |
| RelatedToolLink | связанный инструмент урока |
| TestLauncher | доступен после 50% |
| TestQuestion | single question, chart image, scenario; ответ меняется до завершения |
| TestProgressBar | — |
| TestResult | explanation; при fail — правильный ответ; повтор; после серии неудач — mentor |
| CompletionState | завершение уровня (просмотр 50% не завершает) |

## 6. Reports & mentor (D3)

| Компонент | Заметки |
|-----------|---------|
| ReportForm | autosave, draft, секции, rubric, пример хорошего ответа |
| ReportAttachment | images + video attachments |
| ReportStatusBadge | pending/approved/rejected/resubmitted |
| SectionComment | комментарии к конкретным секциям |
| VersionHistory | версии report/tool |
| MentorThread | feedback/review/revision; без mentor avatar |
| MentorReviewPanel | strategy/risk/case review |
| CaseDefensePanel | Mentor Case Room (L85) |

## 7. Tools (D4–D6)

| Компонент | Инструменты |
|-----------|-------------|
| ToolShell | общая оболочка (заголовок, состояния locked/empty/draft/saved/versioned) |
| LockedToolPreview | что даёт + когда откроется |
| EntryList / CalendarView | Journal, News Calendar, Habit Calendar |
| EntryForm | before/after trade, risk, reason, result… |
| RiskCalcForm | «сумма для расчёта» (не «баланс»), risk %, лимиты, сценарии, формула |
| ChartMarkupCanvas | upload/crop/line/zone/rect/arrow/text/S-R/trend/invalidation, undo/redo, layers, versions, export |
| ChecklistTemplate | Indicator Checklist, checklist входа |
| StrategyCard | Strategy Builder / Playbook |
| RegimeBoard | Market Regime Board |
| SessionPlanCard | Session Planner |
| StatsPanel | Strategy Statistics (win rate, expectancy, small-sample warnings) |
| WatchlistTable | Watchlist |
| PsychCheckin | private by default |
| PauseModePanel | trigger/duration/return checklist, no shame |
| WeeklyReviewForm | — |
| CapitalPlanForm | working capital/reserve/warning levels |
| PerformanceCharts | equity-like curve, drawdown, variance — на manual journal data (не broker) |
| PlaybookBuilder | Personal Playbook |
| WorkspaceGrid | Pro Workspace (виджеты из открытых инструментов; не терминал) |
| SecretToolPlaceholder | silhouette, прозрачные условия, no countdown |

## 8. Community & news & referral (D7)

| Компонент | Заметки |
|-----------|---------|
| ChannelList | + locked channel preview |
| CommunityMessage | message/reply/reaction/image |
| MemberCard | rank badge, скрытие ранга опционально |
| ModerationAction | report/flag |
| ArticleCard | in-product feed / public |
| ArticleView | автор, дата, reading time, related; public: SEO meta, social preview, без комментариев |
| TopicFilter | topic filters, bookmark, read later |
| RelatedLessons | связь статья ↔ урок |
| ReferralPanel | ссылка, статусы приглашённых (сокр. имя/avatar/progress/reward) |
| SecretRewardTeaser | silhouette + условия |

## 9. Comms & account (D8)

| Компонент | Заметки |
|-----------|---------|
| NotificationCenter | категории: Обучение/Mentor/Community/Система/Новости/Награды |
| NotificationItem | read/unread |
| NotificationPrefs | отключаемые/неотключаемые каналы (security нельзя) |
| TicketList / TicketThread | Support: waiting-support/waiting-user/resolved/reopen |
| CreateTicketForm | category, attachments |
| ProfileHeader | rank, XP, серия обучения |
| UnlockedMaterials | доступ к открытым урокам/инструментам |
| SettingsPanel | язык, приватность ранга, уведомления |

## 10. Utility / states (сквозные)

| Компонент | Заметки |
|-----------|---------|
| EmptyState | с примером/подсказкой (tools, lists) |
| ErrorState | helpful errors, recovery |
| LoadingState | skeleton/spinner |
| GraceBanner / SuspendedBanner | спокойный тон, без countdown |
| DataUnavailableState | «Данные обновляются…» |
| AlexCurieMessage | contextual, не на каждой странице |
| A11yPathList | screen-reader list-альтернатива для пути |
| ChartTextAlternative | text-альтернатива для chart/canvas |

---

## 11. Инварианты компонентов

- Semantic tokens только; никаких хардкод-HEX.
- Не color-only: статусы с иконкой/текстом.
- Touch ≥ 44px, safe-area, no hover-only actions.
- Длинные PL-строки не ломают компонент.
- Milestone-компоненты skippable и имеют reduced-motion fallback.
- Никакой компонент не показывает Pocket balance / broker wallet / «осталось $X».

---

## 12. D1B — компоненты Route Field Home (реализованы)

Оболочка: `AppShell`, `BrandMark`, `NotificationButton`, `UserAvatar`,
`DesktopRouteNavigation`, `MobileBottomNavigation`.

Прогрессия/маршрут: `RouteField`, `RouteNode`, `ModuleBoundary`, `RouteContinuation`,
`LessonPlane`, `ModuleProgress`, `ProgressInstrumentation`, `PrimaryRouteAction`,
`CheckpointGate`, `CheckpointRequirement`, `CheckpointOutcome`, `FutureCheckpointPreview`.

Ранг/наставник: `ProvisionalRankMark` (не финальная система рангов — `RANK_IDENTITY_FUTURE_PHASE.md`),
`MentorMediaPlaceholder`, `MentorContext`.

Инварианты D1B: ровно один `<h1>` на состояние; маршрут декоративен (`aria-hidden`) и продублирован
`sr-only`-текстом; CTA — не самый яркий объект; ни один компонент не показывает баланс/депозиты/выводы/
«осталось $X»/Pocket-CTA (закреплено тестами).

---

## 13. D2A — компоненты Пути (реализованы)

`PathWorkspace` (client-оркестратор) · `PathHeader` (h1 + контекст + return-to-current) ·
`ModuleNavigator` (лента 20 модулей + meta) · `PathViewport` (canvas: SVG-слой соединений,
границы, ворота, ветка инструмента + footer соседних модулей) · `PathNode` (кнопка уровня,
5 геометрий состояний, aria-current="step") · `PathDetailLayer` (side plane / mobile sheet,
locked-explainer, dev-safe действия) · `PathAccessibleOutline` (sr-only семантическая структура) ·
hook `usePathKeyboard` (← → Enter Space Escape Home).

Model: `path-state.ts` (scenario adapter, состояния/traits/причины блокировки),
`layout-engine.ts` (детерминированные якоря/сегменты), `visible-window.ts` (окно модуля).
Данные: `domain/curriculum.ts` + `data/curriculum/fixture.ts` (канон, 16 consistency-тестов).

Инварианты: состояние = геометрия + текст (не только цвет); критический текст вне SVG;
узлы ≥44px; ни один компонент не показывает баланс/«осталось»/Pocket CTA.


## Реализовано в D2B — Урок (`src/features/lesson/components/`)

`LessonWorkspace` (композиция Learning Spine + live region) · `LessonHeader` (единственный h1, back,
уровень/модуль, цель, состояние словом) · `LessonVideoStage` (главный объект; simulated media) ·
`LessonSchematic` (абстрактная учебная схема: зоны-полосы и точки реакции; `aria-hidden`, 3:1, `meet`) ·
`LessonMediaControls` (нативные button + `input[type=range]`; слова вместо emoji; visible label = a11y name) ·
`LessonWatchProgress` (progressbar подтверждённой границы + порог как место на шкале) ·
`LessonContext` (тонкий rail: структура, длительность, требования, контрольная точка впереди — без сумм) ·
`LessonOutline` (главы с таймкодами; read-only, не seek-ярлыки) · `LessonAssessment` (locked/ready/вопрос/
completed) · `LessonAssessmentLocked` (видимая и объяснённая закрытая проверка, содержание не раскрыто) ·
`LessonQuestion` (form/fieldset/legend, один вопрос в DOM, управление focus) · `LessonAnswerOption`
(нативный radio; вердикт глифом и словами) · `LessonFeedback` (объяснение, принимает focus) ·
`LessonCompletion` (сдержанное завершение, честно про сессию) · `LessonNavigation` (Путь всегда;
следующий уровень — только после completion) · `LessonLockedScreen` / `LessonUnknown` (честные тупики,
не 404 и не fake unlock) · `LessonAccessibleOutline` (sr-only сводка).

Hooks: `useLessonExperience` (reducer → модель), `useLessonMedia` (единственный таймер, fixed delta).

Инварианты: видео перед тестом в DOM на всех viewport; один вопрос за раз; состояние = слово + глиф,
не цвет; правильный ответ не раскрывается до submit и при ошибке; таргеты ≥44px; ни один компонент не
показывает XP, баланс, сумму контрольной точки или Pocket CTA.
