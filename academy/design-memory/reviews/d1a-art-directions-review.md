# D1A — Art Directions Visual Review

Phase D1A. Self-review of three Главная art directions from **real browser screenshots**
(Playwright + Chromium, exact dimensions, fonts loaded, dev overlay disabled).
No winner is selected here — this is an evaluation for the product team.

## Scope

- Directions: Product Portal (A), Market Atlas (B), Editorial Academy (C).
- Shared synthetic state: level 18 «Поддержка и сопротивление», Module 4 «Чтение графика»,
  rank Наблюдатель III (from L15), next checkpoint L20 / target $200 → Наблюдатель IV,
  tools available: Trading Journal + Risk Calculator, nearest reward: Chart Markup Tool.
- Viewports captured: desktop 1440×900, mobile 390×844. Tablet 1024×768 checked manually.

## Screenshots

`design-memory/screenshots/d1a-art-directions/`
- `product-portal-desktop.png` (1440×900), `product-portal-mobile.png` (390×844)
- `market-atlas-desktop.png` (1440×900), `market-atlas-mobile.png` (390×844)
- `editorial-academy-desktop.png` (1440×900), `editorial-academy-mobile.png` (390×844)
- `concepts-board-desktop.png` (1440×900)

## Rating (провизорно, 1–5; выше = сильнее по критерию)

| Критерий | A · Product Portal | B · Market Atlas | C · Editorial Academy |
|---|:--:|:--:|:--:|
| Связь с прелендингом (cinematic dark, glow) | 5 | 3 | 3 |
| Премиальность | 5 | 4 | 4 |
| Ясность следующего шага | 4 | 4 | 5 |
| Горизонтальный путь | 4 | 5 | 3 |
| Читаемость | 4 | 4 | 5 |
| Плотность (информативность) | 3 | 5 | 3 |
| Mobile | 4 | 4 | 4 |
| Масштабируемость на 100 levels | 4 | 5 | 3 |
| Масштабируемость на tools | 4 | 5 | 4 |
| Роль Alex Curie | 3 | 2 | 5 |
| Риск generic dashboard (выше = меньше риск) | 4 | 2 | 5 |
| Риск LMS (выше = меньше риск) | 5 | 4 | 3 |
| Риск game/casino (выше = меньше риск) | 4 | 5 | 5 |
| Performance risk (выше = меньше риск) | 3 | 4 | 5 |

## Direction A — Product Portal

**Сильные стороны:** самый близкий к кинематографичности прелендинга; controlled glow и глубина;
текущий шаг — центральный объект; путь читается как «портал» с крупными узлами; ранг как
премиальный артефакт; низкая карточная дробность; сильный, но не тяжёлый первый viewport.

**Слабые стороны:** ниже информационная плотность (меньше видно за один экран); glow требует
дисциплины, чтобы не соскользнуть в «sci-fi»; на слабых устройствах градиенты/тени — потенциальный
performance-риск (сейчас статичны, эффекты лёгкие).

**Риски:** избыточное свечение; декоративный hero без пользы — сейчас удержано (в hero есть rank,
XP, streak, module progress и primary CTA).

## Direction B — Market Atlas

**Сильные стороны:** горизонтальный путь — главный структурный объект; чёткая сетка и точные
mono-подписи; метрик-тайлы дают высокую плотность; инструменты как «рабочие capabilities»;
premium terminal feeling без имитации терминала; лучшая масштабируемость на 100 levels/tools.

**Слабые стороны:** самый высокий риск «generic analytics dashboard»; при росте числа метрик легко
перегрузить; Alex Curie наименее заметен (роль эксперта проседает).

**Риски:** перегрузка мелким текстом; уход в terminal — сейчас удержано (нет fake charts, только
manual-инструменты и путь).

## Direction C — Editorial Academy

**Сильные стороны:** самая высокая читаемость и «воздух»; сильная типографика; урок и эксперт
доминируют; Alex Curie максимально заметен; самый низкий риск casino и generic dashboard; лучший
performance (мало эффектов).

**Слабые стороны:** ощущение progression слабее (путь — компактная strip, менее «энергичный»);
ближе всего к риску «обычной LMS»; меньше преемственности с cinematic-прелендингом; на 100 levels
strip придётся продумать отдельно.

**Риски:** слишком журнальная/LMS-подача — частично проявляется; энергия прелендинга ниже, чем в A.

## Комбинируемые элементы (для будущего синтеза, без выбора победителя)

- Hero-«портал» и rank-как-артефакт из **A** + плотные метрик-тайлы и капабилити-инструменты из **B**.
- Editorial-заметность Alex Curie и типографическая иерархия из **C** поверх энергии пути из **A**.
- Технический «Карта маршрута» скролл-трек из **B** как модальный вид полной страницы «Путь».

## Findings (screenshot pass) и исправления

| # | Direction | Проблема | Severity | Статус |
|---|-----------|----------|----------|--------|
| 1 | все | Мobile: горизонтальный overflow страницы (путь min-w-max растягивал колонку) | blocker | ✅ исправлено — `overflow-x-clip` на main |
| 2 | все | Tablet/desktop 1024–1440: overflow на ~15–140px (grid 1fr не сжимался) | blocker | ✅ исправлено — `min-w-0` на главной колонке grid |
| 3 | B (Market Atlas) | Mobile: 4 метрик-тайла в один столбец опускали primary CTA | major | ✅ исправлено — 2 колонки на mobile |
| 4 | B (Market Atlas) | Desktop: дублирование заголовка («Карта маршрута» + «Твой путь») | minor | ✅ исправлено — `heading` prop у PathPreview |
| 5 | C (Editorial) | Path-strip визуально не намного компактнее прочих | minor | принято как есть (strip = sm-узлы) |

После исправлений сделаны финальные screenshots; overflow на 390/1024/1440 = 0; console без
ошибок приложения (dev HMR websocket-шум отфильтрован).

## Financial-privacy / invariants (проверено на скриншотах и в e2e)

- Показан только checkpoint target «требуется баланс Pocket от $200»; нет баланса пользователя,
  нет «осталось $X», нет Pocket-CTA.
- Навигация полностью на русском (Сообщество, Ментор, Поддержка…); mobile bottom-nav = 5 (…, Ещё);
  профиль через avatar.
- Raw internal codes (level.018, tool.*, rank.*) пользователю не показываются.
- Один очевидный primary CTA «Продолжить урок» во всех трёх.

## Sign-off

Все обязательные размеры сняты (6 концепт-PNG + board). Blocker/major findings закрыты.
Победитель не выбран — решение за продуктовой командой.
