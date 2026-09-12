# CURRICULUM_AND_UNLOCKS

Канонический источник: `les-prog.txt`.
Этот документ не переписывает смысл программы. Он структурирует её в стабильные коды и фиксирует mapping уровней, checkpoints, tool unlocks, community unlocks, reports и mentor reviews.

> Legacy note: в `les-prog.txt` встречается старое название **TradeQuest**. Во всех пользовательских текстах используется только **Alfa Trade Academy**. Смысл уроков сохранён без изменений.

> Legacy note (D0.1): в `les-prog.txt` урок L1 назван «Подключение Pocket». По утверждённой продуктовой логике пользователь **не подключает и не связывает** аккаунт — это **регистрация**. Пользовательское название уровня — «Регистрация Pocket»; смысл урока не изменён. См. DD-175/DD-176.

[^l1]: Источник (`les-prog.txt`) — «Подключение Pocket» (legacy). Пользовательское название — «Регистрация Pocket» (регистрация, не подключение).

---

## 1. Общая структура

- Модулей: **20**
- Уровней: **100**
- Checkpoints: **20** (по одному на каждый пятый уровень: L4, затем L10, L15, … L100)
- Ranks: **20** (по одному на checkpoint)
- Tool unlocks: **19** curriculum-инструментов (на checkpoints L10–L100) + **1** referral-gated «Секретный инструмент» = **20** инструментов в интерфейсе. Секретный инструмент не является curriculum tool unlock и не имеет level unlock (см. §4).
- Community unlocks: **5** (L4, L20, L35, L45, L85)
- Обязательные reports / practical tasks: см. колонку «Артефакт»
- Mentor reviews: см. колонку «Mentor»

Каждый уровень принадлежит ровно одному модулю. Каждый модуль завершается checkpoint.

### Правила кодирования (stable codes)

Human-readable названия из `les-prog.txt` **не меняются**. Коды добавляются как технические идентификаторы:

- Модуль: `module.01` … `module.20`
- Уровень: `level.001` … `level.100`
- Урок: `lesson.001` … `lesson.100` (в текущей программе 1 урок = 1 уровень)
- Checkpoint: `checkpoint.004`, `checkpoint.010`, … (номер = уровень checkpoint)
- Rank: `rank.observer_1` … `rank.architect_4`
- Tool: `tool.trading_journal`, `tool.risk_calculator`, …
- Community channel: `channel.start_questions`, `channel.chart_review`, …

Коды стабильны и не зависят от локализации. Названия локализуются, коды — нет.

---

## 2. Полный mapping уровней

Легенда типов активности:
- **video+test** — урок с видео и тестом
- **report** — обязательный structured report
- **practical** — практическое задание / артефакт инструмента
- **checkpoint** — финансовая контрольная точка
- **mentor** — требуется mentor review

| Level | Code | Модуль | Название урока (canonical) | Тип | Артефакт | Mentor | Checkpoint $ | Unlock |
|------:|------|--------|----------------------------|-----|----------|:------:|:-----------:|--------|
| 1 | level.001 | module.01 Первое знакомство | Регистрация Pocket [^l1] | task | Pocket registration | — | — | — |
| 2 | level.002 | module.01 | Как устроен Alfa Trade Academy | video+test | course mechanics test | — | — | — |
| 3 | level.003 | module.01 | Первые пять demo-сделок | report | отчёт по 5 demo-сделкам | — | — | — |
| 4 | level.004 | module.01 | Контрольная точка $50 | checkpoint | — | — | **$50** | rank.observer_1 · channel.start_questions |
| 5 | level.005 | module.02 Как работает сделка | Жизненный цикл сделки | video+test | — | — | — | — |
| 6 | level.006 | module.02 | Экспирация и payout | video+test | — | — | — | — |
| 7 | level.007 | module.02 | Активы, время и OTC | video+test | — | — | — | — |
| 8 | level.008 | module.02 | Войти или отказаться | video+test | сценарии «войти/ждать/отказаться» | — | — | — |
| 9 | level.009 | module.02 | Checklist перед входом | practical | собственный checklist | — | — | — |
| 10 | level.010 | module.02 | Контрольная точка $100 | checkpoint | — | — | **$100** | rank.observer_2 · **tool.trading_journal** |
| 11 | level.011 | module.03 Управление риском | Торговый капитал | video+test | — | — | — | — |
| 12 | level.012 | module.03 | Размер позиции и серии убытков | video+test | — | — | — | — |
| 13 | level.013 | module.03 | Дневной лимит потерь | video+test | — | — | — | — |
| 14 | level.014 | module.03 | Личный Risk Plan | practical | Risk Plan | ✔ | — | — |
| 15 | level.015 | module.03 | Контрольная точка $150 | checkpoint | — | — | **$150** | rank.observer_3 · **tool.risk_calculator** |
| 16 | level.016 | module.04 Чтение графика | Свечи | video+test | — | — | — | — |
| 17 | level.017 | module.04 | Тренд и диапазон | video+test | — | — | — | — |
| 18 | level.018 | module.04 | Поддержка и сопротивление | video+test | — | — | — | — |
| 19 | level.019 | module.04 | Разметка графика | practical | разметка 3 графиков | — | — | — |
| 20 | level.020 | module.04 | Контрольная точка $200 | checkpoint | — | — | **$200** | rank.observer_4 · **tool.chart_markup** · channel.chart_review |
| 21 | level.021 | module.05 Индикаторы | Stochastic | video+test | — | — | — | — |
| 22 | level.022 | module.05 | Bollinger Bands | video+test | — | — | — | — |
| 23 | level.023 | module.05 | Объединение сигналов | video+test | — | — | — | — |
| 24 | level.024 | module.05 | Ложные сигналы | practical | разбор сценариев, red flag | — | — | — |
| 25 | level.025 | module.05 | Контрольная точка $300 | checkpoint | — | — | **$300** | rank.analyst_1 · **tool.indicator_checklist** |
| 26 | level.026 | module.06 Новости | Экономический календарь | video+test | — | — | — | — |
| 27 | level.027 | module.06 | Реакция цены на новости | video+test | — | — | — | — |
| 28 | level.028 | module.06 | Когда не стоит торговать | video+test | — | — | — | — |
| 29 | level.029 | module.06 | План работы вокруг новостей | practical | план вокруг новостей | ✔ | — | — |
| 30 | level.030 | module.06 | Контрольная точка $400 | checkpoint | — | — | **$400** | rank.analyst_2 · **tool.news_calendar** |
| 31 | level.031 | module.07 Психология новичка | Страх потери | video+test | — | — | — | — |
| 32 | level.032 | module.07 | Revenge trading | video+test | — | — | — | — |
| 33 | level.033 | module.07 | FOMO | video+test | — | — | — | — |
| 34 | level.034 | module.07 | Pause Protocol | practical | триггеры/длительность/возврат | — | — | — |
| 35 | level.035 | module.07 | Контрольная точка $500 | checkpoint | — | — | **$500** | rank.analyst_3 · **tool.pause_mode** · channel.discipline_journal |
| 36 | level.036 | module.08 Торговый дневник | Почему память обманывает | video+test | — | — | — | — |
| 37 | level.037 | module.08 | Запись до сделки | video+test | — | — | — | — |
| 38 | level.038 | module.08 | Запись после сделки | video+test | — | — | — | — |
| 39 | level.039 | module.08 | Недельный обзор | practical | weekly review | — | — | — |
| 40 | level.040 | module.08 | Контрольная точка $750 | checkpoint | — | — | **$750** | rank.analyst_4 · **tool.weekly_review** |
| 41 | level.041 | module.09 Первая стратегия | Что такое setup | video+test | — | — | — | — |
| 42 | level.042 | module.09 | Чёткие правила входа | video+test | — | — | — | — |
| 43 | level.043 | module.09 | Таймфрейм и экспирация | video+test | — | — | — | — |
| 44 | level.044 | module.09 | Карточка стратегии | practical | Strategy Card | ✔ | — | — |
| 45 | level.045 | module.09 | Контрольная точка $1,000 | checkpoint | — | — | **$1,000** | rank.tactician_1 · **tool.strategy_builder** · channel.strategies |
| 46 | level.046 | module.10 Капитал и просадка | Просадка | video+test | — | — | — | — |
| 47 | level.047 | module.10 | Восстановление после просадки | video+test | — | — | — | — |
| 48 | level.048 | module.10 | Распределение капитала | video+test | — | — | — | — |
| 49 | level.049 | module.10 | Capital Protection Plan | practical | уровни предупреждения/паузы/восстановления | — | — | — |
| 50 | level.050 | module.10 | Контрольная точка $1,500 | checkpoint | — | — | **$1,500** | rank.tactician_2 · **tool.capital_plan** |
| 51 | level.051 | module.11 Рыночные режимы | Несколько таймфреймов | video+test | — | — | — | — |
| 52 | level.052 | module.11 | Тренд и боковик | video+test | — | — | — | — |
| 53 | level.053 | module.11 | Волатильность | video+test | — | — | — | — |
| 54 | level.054 | module.11 | Выбор setup под режим | practical | сценарии выбора/отказа | — | — | — |
| 55 | level.055 | module.11 | Контрольная точка $2,000 | checkpoint | — | — | **$2,000** | rank.tactician_3 · **tool.market_regime_board** |
| 56 | level.056 | module.12 Исполнение | Подготовка к сессии | video+test | — | — | — | — |
| 57 | level.057 | module.12 | Качество входа | video+test | — | — | — | — |
| 58 | level.058 | module.12 | Overtrading | video+test | — | — | — | — |
| 59 | level.059 | module.12 | Аудит сессии | practical | сравнение плана и действий | ✔ | — | — |
| 60 | level.060 | module.12 | Контрольная точка $2,500 | checkpoint | — | — | **$2,500** | rank.tactician_4 · **tool.session_planner** |
| 61 | level.061 | module.13 Статистика | Win rate | video+test | — | — | — | — |
| 62 | level.062 | module.13 | Математическое ожидание | video+test | — | — | — | — |
| 63 | level.063 | module.13 | Размер выборки | video+test | — | — | — | — |
| 64 | level.064 | module.13 | Анализ статистики | practical | разбивка по setup/времени/активу/режиму | — | — | — |
| 65 | level.065 | module.13 | Контрольная точка $3,000 | checkpoint | — | — | **$3,000** | rank.strategist_1 · **tool.strategy_statistics** |
| 66 | level.066 | module.14 Активы | Специализация | video+test | — | — | — | — |
| 67 | level.067 | module.14 | Корреляция | video+test | — | — | — | — |
| 68 | level.068 | module.14 | Ограничение внимания | video+test | — | — | — | — |
| 69 | level.069 | module.14 | Недельный Watchlist | practical | watchlist с причинами | — | — | — |
| 70 | level.070 | module.14 | Контрольная точка $4,000 | checkpoint | — | — | **$4,000** | rank.strategist_2 · **tool.watchlist** |
| 71 | level.071 | module.15 Продвинутая психология | Tilt | video+test | — | — | — | — |
| 72 | level.072 | module.15 | Усталость | video+test | — | — | — | — |
| 73 | level.073 | module.15 | Уверенность против данных | video+test | — | — | — | — |
| 74 | level.074 | module.15 | Психологический аудит | practical | триггеры и правила | ✔ | — | — |
| 75 | level.075 | module.15 | Контрольная точка $5,000 | checkpoint | — | — | **$5,000** | rank.strategist_3 · **tool.psychology_checkin** |
| 76 | level.076 | module.16 Привычка | Устойчивый режим | video+test | — | — | — | — |
| 77 | level.077 | module.16 | Дневной и недельный ритуал | video+test | — | — | — | — |
| 78 | level.078 | module.16 | Возвращение после перерыва | video+test | — | — | — | — |
| 79 | level.079 | module.16 | План дисциплины на 30 дней | practical | персональный график | — | — | — |
| 80 | level.080 | module.16 | Контрольная точка $6,000 | checkpoint | — | — | **$6,000** | rank.strategist_4 · **tool.habit_calendar** |
| 81 | level.081 | module.17 Кейсы | Полный торговый кейс | video+test | — | — | — | — |
| 82 | level.082 | module.17 | Неполная информация | video+test | — | — | — | — |
| 83 | level.083 | module.17 | Библиотека ошибок | practical | 5 карточек ошибок | — | — | — |
| 84 | level.084 | module.17 | Защита решения | practical | защита кейса | ✔ | — | — |
| 85 | level.085 | module.17 | Контрольная точка $7,000 | checkpoint | — | — | **$7,000** | rank.architect_1 · **tool.mentor_case_room** · channel.advanced_circle |
| 86 | level.086 | module.18 Аналитика результатов | Equity curve | video+test | — | — | — | — |
| 87 | level.087 | module.18 | Серии и variance | video+test | — | — | — | — |
| 88 | level.088 | module.18 | Устойчивость стратегии | video+test | — | — | — | — |
| 89 | level.089 | module.18 | План улучшения | practical | одна проблема / одно изменение | — | — | — |
| 90 | level.090 | module.18 | Контрольная точка $8,000 | checkpoint | — | — | **$8,000** | rank.architect_2 · **tool.performance_dashboard** |
| 91 | level.091 | module.19 Личный Playbook | Структура Playbook | video+test | — | — | — | — |
| 92 | level.092 | module.19 | Правила входа и отказа | video+test | — | — | — | — |
| 93 | level.093 | module.19 | Личные Red Flags | video+test | — | — | — | — |
| 94 | level.094 | module.19 | Mentor Review Playbook | practical | playbook на проверку | ✔ | — | — |
| 95 | level.095 | module.19 | Контрольная точка $9,000 | checkpoint | — | — | **$9,000** | rank.architect_3 · **tool.personal_playbook** |
| 96 | level.096 | module.20 Самостоятельная система | Teach-back | video+test | — | — | — | — |
| 97 | level.097 | module.20 | План на 90 дней | video+test | — | — | — | — |
| 98 | level.098 | module.20 | План действий при просадке | video+test | — | — | — | — |
| 99 | level.099 | module.20 | Финальный экзамен | practical | финальный экзамен | — | — | — |
| 100 | level.100 | module.20 | Контрольная точка $10,000 | checkpoint | — | — | **$10,000** | rank.architect_4 · **tool.pro_workspace** · levels 101+ preview |

---

## 3. Checkpoint → Rank → Threshold → Tool

20 checkpoints, каждый связан с одним rank и (кроме L4) одним tool unlock.

| Checkpoint | Level | Min real balance | Rank | Family | Tool unlock |
|------------|:-----:|:----------------:|------|--------|-------------|
| checkpoint.004 | 4 | $50 | Наблюдатель I | Наблюдатель | — |
| checkpoint.010 | 10 | $100 | Наблюдатель II | Наблюдатель | Trading Journal |
| checkpoint.015 | 15 | $150 | Наблюдатель III | Наблюдатель | Risk Calculator |
| checkpoint.020 | 20 | $200 | Наблюдатель IV | Наблюдатель | Chart Markup Tool |
| checkpoint.025 | 25 | $300 | Аналитик I | Аналитик | Indicator Checklist |
| checkpoint.030 | 30 | $400 | Аналитик II | Аналитик | News Calendar |
| checkpoint.035 | 35 | $500 | Аналитик III | Аналитик | Pause Mode |
| checkpoint.040 | 40 | $750 | Аналитик IV | Аналитик | Weekly Review |
| checkpoint.045 | 45 | $1,000 | Тактик I | Тактик | Strategy Builder |
| checkpoint.050 | 50 | $1,500 | Тактик II | Тактик | Capital Plan |
| checkpoint.055 | 55 | $2,000 | Тактик III | Тактик | Market Regime Board |
| checkpoint.060 | 60 | $2,500 | Тактик IV | Тактик | Session Planner |
| checkpoint.065 | 65 | $3,000 | Стратег I | Стратег | Strategy Statistics |
| checkpoint.070 | 70 | $4,000 | Стратег II | Стратег | Watchlist |
| checkpoint.075 | 75 | $5,000 | Стратег III | Стратег | Psychology Check-in |
| checkpoint.080 | 80 | $6,000 | Стратег IV | Стратег | Habit Calendar |
| checkpoint.085 | 85 | $7,000 | Архитектор рынка I | Архитектор | Mentor Case Room |
| checkpoint.090 | 90 | $8,000 | Архитектор рынка II | Архитектор | Performance Dashboard |
| checkpoint.095 | 95 | $9,000 | Архитектор рынка III | Архитектор | Personal Playbook |
| checkpoint.100 | 100 | $10,000 | Архитектор рынка IV | Архитектор | Pro Workspace + levels 101+ |

> Threshold — это **минимальный real balance в Pocket**. Demo не учитывается. Продукт показывает только целевое значение checkpoint и **никогда** не показывает собственный баланс пользователя (см. `docs/DESIGN_DECISIONS.md`, финансовая приватность).

---

## 4. Tool unlock map (по коду)

| Tool code | Название | Unlock level | Тип данных |
|-----------|----------|:-----------:|-----------|
| tool.trading_journal | Trading Journal | L10 | manual |
| tool.risk_calculator | Risk Calculator | L15 | manual input (не «баланс Pocket») |
| tool.chart_markup | Chart Markup Tool | L20 | uploaded screenshot (не live chart) |
| tool.indicator_checklist | Indicator Checklist | L25 | manual |
| tool.news_calendar | News Calendar | L30 | provider-agnostic manual |
| tool.pause_mode | Pause Mode | L35 | manual |
| tool.weekly_review | Weekly Review | L40 | manual |
| tool.strategy_builder | Strategy Builder | L45 | manual + mentor review |
| tool.capital_plan | Capital Plan | L50 | manual values |
| tool.market_regime_board | Market Regime Board | L55 | manual |
| tool.strategy_statistics | Strategy Statistics | L65 | manual / journal data |
| tool.session_planner | Session Planner | L60 | manual |
| tool.watchlist | Watchlist | L70 | manual |
| tool.psychology_checkin | Psychology Check-in | L75 | manual, private by default |
| tool.habit_calendar | Habit Calendar | L80 | manual |
| tool.mentor_case_room | Mentor Case Room | L85 | manual + mentor |
| tool.performance_dashboard | Performance Dashboard | L90 | manual journal data (не broker wallet) |
| tool.personal_playbook | Personal Playbook | L95 | manual + mentor review |
| tool.pro_workspace | Pro Workspace | L100 | aggregate of unlocked tools |
| tool.secret | Секретный инструмент | referral-gated (1-й qualified referral) | TBD |

> Порядок по уровню: L10, L15, L20, L25, L30, L35, L40, L45, L50, L55, **L60 Session Planner**, **L65 Strategy Statistics**, L70, L75, L80, L85, L90, L95, L100. Строки таблицы сгруппированы логически; unlock level — источник истины.

**Secret Tool** не привязан к уровню. Открывается по реферальному условию (первый qualified referral), содержимое определяется позднее.

---

## 5. Community unlock map

| Channel code | Название | Unlock level |
|--------------|----------|:-----------:|
| channel.start_questions | Старт и вопросы | L4 |
| channel.chart_review | Разбор графиков | L20 |
| channel.discipline_journal | Дисциплина и дневник | L35 |
| channel.strategies | Стратегии | L45 |
| channel.advanced_circle | Продвинутый круг | L85 |

---

## 6. Reports и mentor reviews

**Обязательные structured reports / practical артефакты** (заполняются пользователем, не тест):
L1 (Pocket registration), L3 (5 demo-сделок), L9 (checklist), L14 (Risk Plan), L19 (разметка 3 графиков), L24 (red flag разбор), L29 (план новостей), L34 (Pause Protocol), L39 (weekly review), L44 (Strategy Card), L49 (Capital Protection Plan), L54 (выбор setup), L59 (аудит сессии), L64 (анализ статистики), L69 (watchlist), L74 (психологический аудит), L79 (30-day discipline), L83 (5 карточек ошибок), L84 (защита кейса), L89 (план улучшения), L94 (Mentor Review Playbook), L99 (финальный экзамен).

**Mentor review обязателен** (`✔` в таблице): L14, L29, L44, L59, L74, L84, L94.
Дополнительно mentor опционален в Weekly Review (L40) и других инструментах, где это указано в самом инструменте.

---

## 7. Consistency checklist (D0)

- [x] Ровно 100 уровней (level.001–level.100).
- [x] Ровно 20 модулей (module.01–module.20).
- [x] 20 checkpoints, thresholds совпадают с `les-prog.txt` и rank mapping брифа.
- [x] Tool unlocks совпадают с `les-prog.txt` (открытие инструмента указано в тексте checkpoint соответствующего уровня).
- [x] Ни один threshold не выдуман.
- [x] Ни один report не пропущен.
- [x] Ни один обязательный mentor review не пропущен.
- [x] Legacy «TradeQuest» заменён на «Alfa Trade Academy» во всех пользовательских формулировках; смысл уроков не изменён.
- [x] Community unlocks: L4, L20, L35, L45, L85.
