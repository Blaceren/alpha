# COMPONENT_INVENTORY

Инвентарь компонентов Alfa Trade Academy Web V2. Provisional — уточняется при реализации (D1+). Компоненты используют semantic tokens (`DESIGN_SYSTEM.md`), выдерживают длинные польские строки и покрывают состояния из `STATE_MATRIX.md`.

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
| BottomNav | 5 пунктов (Главная/Путь/Уроки/Инструменты/Профиль) |
| MoreMenu | Community/Новости/Рефералы/Mentor/Support/Настройки |
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
