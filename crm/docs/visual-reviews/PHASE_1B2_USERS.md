# Visual review — Phase 1B2 Users workspace

## Статус визуального этапа: ✅ ВЫПОЛНЕН

Настоящие screenshots сгенерированы реальным браузерным рендером (headless **Chromium 149**, Playwright) через `tests-e2e/users-screenshots.spec.ts`. Все 5 PNG — точных размеров, с проверкой чистой консоли (no runtime / hydration / missing-key / failed-asset errors). Первый pass пройден, найденные major-проблемы исправлены, финальные screenshots пересняты (второй pass).

## Screenshots (screenshots/phase-1b2-users/)
| Файл | Размер | Сценарий |
|---|---|---|
| `users-admin-1440x900.png` | 1440×900 | admin, дефолтная сортировка, exact-финансы открыты через «Колонки», полный операционный контекст |
| `users-support-1440x900.png` | 1440×900 | support, permission-safe identity, **bucket-финансы** (`$50–99`, `$100–199`), exact-значение отсутствует |
| `users-filtered-1440x900.png` | 1440×900 | compound-фильтр (`Фондирован` + `Активен` = 16 результатов), active-chips |
| `users-tablet-1024x768.png` | 1024×768 | toolbar переносится, `Прогресс`/`Owner` скрыты, таблица читаема |
| `users-mobile-390x844.png` | 390×844 | mobile-карточки, фильтры в Sheet, полнотекстовое «Открыть профиль» |

Проверка консоли в каждом сценарии — ноль ошибок (assert `errors.toHaveLength(0)`).

### Как перегенерировать (host / CI)
```
cd ata-crm
npx playwright install chromium     # либо системный Chrome через channel
npm run test:e2e                     # tests-e2e/users-screenshots.spec.ts (+ smoke)
```

---

## Первый pass — найденные проблемы (≥5), severity

1. **[major] Горизонтальный overflow при 9 колонках на 1440.** Дефолтные 9 колонок + столбец действия не помещались в контентную область (~1166 px): `Owner` и действие обрезались справа. Замер: `scrollWidth − clientWidth = 131 px`.
2. **[major] 404 favicon → «failed asset» в консоли.** Браузер автоматически запрашивал `/favicon.ico` (иконки не было) → console-error, нарушал требование «no failed assets».
3. **[major] Явное текстовое действие «Открыть профиль» уводило таблицу в overflow.** Именно текстовый последний столбец давал основной вклад в переполнение на 1440.
4. **[major → исправлено ранее] Конфликт stale-флага «Последней активности».** Иконка stale ошибочно бралась из `balance.stale` (staleness баланса ≠ staleness активности).
5. **[minor] Truncate причины приоритета** (напр. «Критический suppo…») — по дизайну, полный текст в tooltip. Приемлемо.
6. **[minor] Перенос бейджа lifecycle** «В зоне риска» в узкой колонке на 2 строки — единообразно, приемлемо.
7. **[minor] Планшет 1024:** «Активные блокеры» слегка обрезаются (таблица в `overflow-x-auto`, скроллится); `Прогресс`/`Owner` корректно скрыты. Приемлемо.

Critical: нет. Major: 4.

## Исправления (после первого pass)
- **#1 / #3 (major):** перенос длинных заголовков на 2 строки (убран `whitespace-nowrap`, `align-bottom`); уплотнение паддингов ячеек `px-3 → px-2`; ограничение ширины «тяжёлых» ячеек (Пользователь `max-w-160px`, причина приоритета `max-w-8rem`, блокеры `max-w-9.5rem`); столбец действия на десктопе → компактная **доступная иконка** (`ArrowRight` + `aria-label` + `sr-only` «Открыть профиль» + tooltip). На мобильных карточках сохранена полнотекстовая кнопка «Открыть профиль». Итог замера: `scrollWidth − clientWidth = 0 px` — все 9 дефолтных колонок + действие помещаются на 1440 без горизонтального scroll. Опциональные колонки (напр. `Баланс`) при включении могут давать scroll — это допустимо по §13.
- **#2 (major):** добавлен `src/app/icon.svg` (App Router icon convention) → Next выдаёт корректный `<link rel="icon">`, браузер больше не запрашивает несуществующий `/favicon.ico`. Консоль чистая во всех 5 сценариях.
- **#4 (major):** ошибочный stale-флаг у последней активности убран (columns + mobile card); относительное время детерминировано через FixedMockClock.

Финальные screenshots пересняты после исправлений (второй pass, не сдаётся первый pass как финальный).

## Чек-лист визуальной оценки (§19)
- Кто требует внимания — понятно (приоритетная полоса + причина, критичные сверху). ✅
- Строка не перегружена: состояния разнесены по независимым колонкам. ✅
- Primary identity заметен (avatar + имя-ссылка + masked email). ✅
- Пять измерений читаются как независимые оси. ✅
- Lifecycle и Engagement не путаются (разные колонки/тон). ✅
- Blockers ясны (до 2 chips + `+N` c tooltip). ✅
- Owner заметен и помещается. ✅
- Permission masking корректен: admin — exact (`$90`), support — bucket (`$50–99`), identity всегда masked. ✅
- Raw enum codes отсутствуют. ✅
- Горизонтального overflow дефолтных колонок нет (замер 0 px). ✅
- Экран не выглядит как generic table dump (иерархия identity → причина → состояния). ✅
- Mobile адекватен (карточки, Sheet-фильтры). ✅
- Число badges умеренное. ✅
- Единый ритм колонок/spacing. ✅

## Роли — что показывается (по коду/проекциям, подтверждено скриншотами и тестами)
| Роль | Identity в списке | Balance projection | Exact в DOM |
|---|---|---|---|
| crm_admin | masked | exact (`$90`) | да (по праву) |
| retention_manager | masked | exact | да (по праву) |
| mentor | masked | bucket | нет |
| support | masked | bucket (`$50–99`) | нет |
| analyst | pseudonymous | aggregated (bucket-level) | нет |
| read_only | masked | hidden («Недоступно для роли») | нет |

Списочный контекст всегда masked (полный email не показывается ни одной роли). Покрыто тестами `users-permissions.test.tsx` (data-driven, проверяет отсутствие exact-значения в rendered HTML для support).

## Технический контекст генерации
Sandbox — Linux aarch64, Node 22. Playwright Chromium 149 (headless). Отсутствовавшая системная библиотека `libXdamage.so.1` добавлена локально (`apt-get download` + `LD_LIBRARY_PATH`, без изменения системы и без root). Версии npm-пакетов не менялись. На host/Mac достаточно `npx playwright install chromium` (или системный Chrome через channel).
