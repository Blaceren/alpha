# D4-C — Risk Calculator · Visual Review

Инструмент: `tool.risk_calculator` · маршрут `/tools/tool.risk_calculator` · unlock **L15**.
Решение — **DD-314**. Состояния — `STATE_MATRIX.md` §5c. Кадры —
`design-memory/screenshots/d4-risk-calculator/{first-pass,final}/` (реальные Chromium,
deviceScaleFactor = 1, dimensions точно по именам файлов).

## 1. Утверждённое направление (не переоткрывается)

**A + B, где Direction A доминирует.**

- **Direction A — Price Rail (signature object).** Desktop/tablet: входы слева · измеренный
  entry/stop Price Rail в центре · output-ledger справа. Rail — доминирующий объект: entry-node,
  stop-node, measured gap band, точная дистанция и процент, маркер направления Лонг/Шорт, дисциплинарная
  заметка «Стоп определяет риск на единицу позиции.».
- **Direction B — только компактная mobile result-strip.** На mobile Price Rail превращается в
  горизонтальный measured bar, входы остаются в обычном потоке документа, и **только valid-состояние**
  получает компактную sticky-полосу (направление + размер позиции + расчётный номинал). Это **не**
  ticket, не чек, не broker order confirmation. Submit/order-кнопки на mobile нет.

Это не 50/50 A+B гибрид: B добавляет исключительно mobile result-strip.

## 2. Signature object

**Один** доминирующий сигнатурный объект — **Price Rail**. На desktop/tablet — вертикальный
измеренный рельс с двумя узлами и luminous measured-band; на mobile — горизонтальный measured bar.
Пиксельная длина band'а **не** заявляется как live-график или точная внешняя ценовая шкала —
авторитетны числовая дистанция и процент (в rail-facts и в ledger).

## 3. Компактная mobile result-strip

- Появляется **только** в valid-состоянии; исчезает при переходе в invalid/incomplete.
- Содержит направление (Лонг/Шорт), размер позиции, расчётный номинал — компактно, без CTA.
- `position: sticky`, `bottom = nav-height + safe-area + 8px` — держится над bottom navigation и
  safe-area; не перекрывает активный input и не перекрывает обязательный дисклеймер (E2E геометрически
  проверяет `strip.bottom ≤ nav.top`).
- На desktop (≥900px) strip **не** отображается: ledger уже показывает всё.

## 4. First-pass — дефекты (5 кадров)

Кадры: `tools-hub-risk-available-desktop`, `risk-calculator-empty-desktop`,
`risk-calculator-long-desktop`, `risk-calculator-mobile-long`, `risk-calculator-locked-desktop`.

| # | severity | наблюдение | решение |
|---|----------|-----------|---------|
| 1 | minor | Desktop: правая ledger-колонка имеет много пустого пространства снизу | принято — rail доминирует; для калькулятора это спокойный, не перегруженный layout |
| 2 | minor | Mobile: sticky strip в состоянии покоя визуально перекрывает горизонтальный rail | принято — так работает sticky; ключевой результат несёт сама strip, rail открывается скроллом; input и дисклеймер не перекрываются |
| 3 | minor | Вертикальная band-линия идёт teal→rose; rose у стопа мог бы читаться как «убыток» | принято — направление всегда несётся текстом (Лонг teal / Шорт blue), rose — лишь акцент stop-node, не P/L |
| 4 | info | Пустые ledger-строки показывают выровненный по правому краю em-dash | ок — состояние читаемо и честно |

**Critical: 0 · Major: 0.** Правок, требуемых для соответствия acceptance, не понадобилось;
minor-пункты явно обоснованы выше.

## 5. Final — 15 кадров (проверены поимённо)

`tools-hub-risk-available-desktop-1440x900`, `risk-calculator-empty-desktop-1440x900`,
`risk-calculator-partial-desktop-1440x900`, `risk-calculator-invalid-desktop-1440x900`,
`risk-calculator-long-desktop-1440x900`, `risk-calculator-short-desktop-1440x900`,
`risk-calculator-tiny-distance-desktop-1440x900`, `risk-calculator-tablet-1024x768`,
`tools-hub-risk-available-mobile-390x844`, `risk-calculator-mobile-empty-390x844`,
`risk-calculator-mobile-long-390x844`, `risk-calculator-mobile-invalid-390x844`,
`risk-calculator-mobile-320x720`, `risk-calculator-zoom-200-720x450`,
`risk-calculator-locked-desktop-1440x900`.

## 6. Viewport-матрица

| Viewport | результат |
|----------|-----------|
| 1440×900 desktop | три зоны (входы · Price Rail · ledger), rail доминирует; overflow 0 |
| 1024×768 tablet | Price Rail остаётся primary, сбалансированные три зоны, без cramped-сжатия; overflow 0 |
| 390×844 mobile | горизонтальный measured bar, входы в потоке, valid → компактная strip над nav; **0 CSS-pixel page overflow** |
| 320×720 small | без клиппинга, strip компактна; **0 CSS-pixel page overflow** |
| 720×450 (200% zoom) | компактный reflow, входы стопкой, strip над nav; **0 CSS-pixel page overflow** |

## 7. Состояния empty / partial / invalid / long / short

- **empty:** rail present, но quiet; чисел/направления нет; strip нет; ledger-строки quiet (—).
- **partial:** введённые значения видны, остальное quiet; без fake-результата и NaN/Infinity; strip нет.
- **invalid (equal entry/stop):** точная ошибка «Цена входа и стоп-цена должны отличаться.»; без
  направления/результата; strip нет.
- **valid long:** stop ниже entry → Лонг; активный measured gap; полный ledger (20 · 4·4% · 5 · 500).
- **valid short:** stop выше entry → Шорт; полный ledger.
- **tiny distance:** дистанция 0,0001; размер 99999,99999668; номинал 9999999,99966803 — полными
  цифрами, **без научной нотации**; rail читаем.

## 8. Прочие проверки

| Проверка | результат |
|----------|-----------|
| Horizontal overflow | **0 CSS-pixel page overflow** на всех viewport'ах. D4-C acceptance closure: измерено точно — `documentElement.scrollWidth === clientWidth` и `body.scrollWidth === clientWidth` (ровно равны) на 390×844, 320×720 и 720×450@200% в состояниях hub/empty/valid-strip/invalid; `devicePixelRatio = 1`. Прежний «≤1px» был субпиксельным guard'ом, а не измеренным overflow'ом; E2E-ассерты ужесточены до точного целочисленного равенства (`toBe`). Ложные срабатывания фильтра offenders — `p.sr-only` (стандартный 1px screen-reader clip, не влияет на page scroll) и внутренняя плотность `.rc-strip-k` на 320 (right ≤ viewport, не page overflow). |
| Safe-area / bottom-nav | strip держится над nav+safe-area; последний контрол очищает nav |
| Reduced-motion | `prefers-reduced-motion: reduce` убирает transition band-линии и анимацию появления strip |
| Клавиатура / фокус | порядок вход → результат → дисклеймер; видимый focus-ring (токен); нет авто-фокуса, крадущего фокус |
| A11y полей | видимые label+id; per-field ошибка через `aria-describedby`; `aria-invalid` на невалидных; rail-графика `aria-hidden`; sr-only live-summary (polite); направление текстом |
| Финансовый язык / приватность | нет «Баланс/Доступно/Средства/Ордер/Исполнено/Куплено/Продано/Pocket»; нет валютного символа (₽/$/€/USDT); «Расчётный капитал» — временный вход, не баланс; дисклеймер всегда виден |
| Console | чисто на маршруте калькулятора (E2E: 0 error, 0 hydration) |
| Persist / side-effects | нет storage/fetch/XP/progression/journal/report write; refresh сбрасывает всё; ключа `ata.tools.risk-calculator` нет |

## 9. Anti-generic score

| Критерий | вес | оценка |
|----------|-----|--------|
| Один доминирующий signature object (Price Rail) | — | ✅ |
| Не переименовывается в любой SaaS-дашборд | — | ✅ (Price Rail специфичен) |
| Нет sidebar + card-grid | — | ✅ (ledger — спина строк, rail — центральный объект; карточек-сетки нет) |
| Mobile не просто «стопка desktop» | — | ✅ (rail → горизонтальный bar + sticky strip) |
| Контраст / AA | — | ✅ (токены D1B.1) |
| Нет перенесённых landing-only паттернов | — | ✅ |

**Итоговый anti-generic score: 86 / 100.** Hard-fail-условий нет.

## 10. Вердикт

- Approved-направление A+B соблюдено; A доминирует, B — только mobile result-strip.
- Один сигнатурный объект (Price Rail); карточной сетки нет.
- **Critical: 0 · Major: 0.** Оставшиеся minor-пункты явно обоснованы (§4).
- Anti-generic ≥ 80 (86). **Acceptance выполнен.**
