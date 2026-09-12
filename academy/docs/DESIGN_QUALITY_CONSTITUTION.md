# DESIGN_QUALITY_CONSTITUTION

Обязательные, немутабельные правила визуального качества Alfa Trade Academy. Действуют для всех
будущих UI-фаз. При конфликте с generic-рекомендациями — эта конституция и project-specific ATA
skills имеют приоритет.

## 1. Бренд
- Официальное название — **Alfa Trade Academy**. Legacy «Alpha Trade» из прелендинг-кадров в UI не переносится.

## 2. Статус references
- Четыре прелендинг-кадра (`design-memory/references/ata-brand/`) — **provisional**: направление, не финальный брендбук и не layout-шаблон. Точные цвета/размеры/отступы/typography/blur/opacity/расположение **не финальны**.

## 3. Атмосфера ≠ копирование
- Из references извлекаются **принципы**, а не пиксели. Буквальное копирование прелендинга запрещено (см. `REFERENCE_MANIFEST.md` «продукт ≠ копия»).

## 4. Читаемость важнее атмосферы
- Функциональная читаемость приоритетнее landing-атмосферы. Основной текст читается без напряжения; functional-страницы не в постоянном тумане; формы/lesson-content не на perspective-grid фоне; контраст существенно выше лендинга.

## 5. Обязательный signature object
- Каждое направление обязано иметь **signature object с продуктовой функцией** (route/spine/artifact), а не набор иконок. Identity не может строиться только на icon library.

## 6. Обязательный art gate
- Перед любым React-кодом обязателен `ata-art-direction-gate`: 19-пунктовый бриф + ≥3 структурно разных low-fi композиции. Переход от анализа references сразу к React запрещён.

## 7. Mobile transformation
- Mobile — самостоятельная трансформация, **не** сложенный вертикально desktop.

## 8. Ограничения card-based layout
- Dashboard card-grid как **основа** запрещён. Запрещены: одинаковый radius у всех surfaces, рамка вокруг каждого блока, KPI tiles, glow на каждой карточке, black background + grey cards, >6 одинаковых карточек в первом viewport, «all surfaces one shape». Глубина — через несколько типов surfaces, не через blur каждой карточки.

## 9. Правила мотивов route / spine / artifact
- **Route** — функциональный persistent progression (соединяет уровни, current position, реакция на checkpoint), не декоративный фон-график.
- **Spine** — вертикальная ось модулей/checkpoints с осмысленной нумерацией.
- **Artifact** — rank/module/tool объект из линий/данных/слоёв; не casino-медаль, не гигантский логотип на каждом экране.
- Ни один мотив не утверждается «по умолчанию» — проверяется в интерфейсе; кандидат валиден при подтверждении на ≥2 references.

## 10. Screenshot QA
- UI не готов без реальных browser screenshots (`ata-visual-qa-loop` + `docs/SCREENSHOT_QA_PROTOCOL.md`). Synthetic/HTML-fetch/code-only review не считаются. Первый screenshot-pass не сдаётся.

## 11. Rejection criteria (automatic fail)
Направление/экран отклоняется, если выполняется любое из (см. `ata-anti-generic-ui-review`):
score < 80; нет signature object; переименовывается в любой SaaS; sidebar + card grid; три направления с одним skeleton; mobile = stacked desktop; landing-level низкий контраст body; >6 одинаковых карточек в первом viewport; все surfaces одной формы; identity только на иконках; нет связи с ≥2 references; декоративные market-элементы без функции.

## 12. Criteria for allowing React implementation
React-код разрешён **только** когда: art gate пройден (19 пунктов + ≥3 структурно разных композиции) **и** пользователь **явно выбрал** направление или **явно попросил объединить** конкретные элементы. Иначе — только ASCII-вайрфреймы и письменные брифы.

## 13. Финальные значения
- Финальные HEX/logo/роль Alex Curie **не фиксируются** без соответствующих assets (`MISSING_BRAND_ASSETS.md`). Случайного человека/логотип не выдумывать. Токены остаются provisional.
