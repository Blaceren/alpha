# Visual review — Phase 1B2.1 Users workspace hardening

## Статус: ✅ ВЫПОЛНЕН

Настоящие screenshots — реальный браузерный рендер (headless **Chromium 149**, Playwright),
`tests-e2e/users-screenshots.spec.ts`, все точных размеров, консоль чистая (0 runtime /
hydration / asset ошибок).

## Screenshots (screenshots/phase-1b2-1-users-hardening/)
| Файл | Размер | Сценарий |
|---|---|---|
| `users-admin-1440x900.png` | 1440×900 | admin, дефолт (merged «Состояния») |
| `users-admin-columns-1440x900.png` | 1440×900 | admin + опциональные колонки (Ценностные сегменты, Регистрация Pocket, Баланс) |
| `users-support-1440x900.png` | 1440×900 | support, **bucket-финансы** (`$50–99 диапазон`), exact отсутствует |
| `users-filtered-1440x900.png` | 1440×900 | compound-фильтр (Фондирован + Активность=Активен) |
| `users-tablet-1024x768.png` | 1024×768 | намеренно компактный tablet |
| `users-mobile-390x844.png` | 390×844 | карточки + Sheet-фильтры |
| `users-mobile-filtered-390x844.png` | 390×844 | «Фильтры (1)» + chips + «Сбросить всё» |

## Замеры overflow (реальный браузер)
| Ширина | table overflow | page overflow |
|---|---|---|
| 1024 (tablet) | 0 | 0 |
| 1280 (xl) | ~11 (внутр., незаметно) | 0 |
| 1440 (desktop) | 0 | 0 |
| 1536 (2xl, индивидуальные колонки) | ~9 | 0 |

Горизонтального **page overflow нет** ни на одной ширине; правый край (действие в строке)
виден без скролла на 1024 и 1440.

## Первый pass — найденные проблемы (≥5), severity
1. **[critical] Tablet 1024 — обрезанный правый край + page overflow.** 7 колонок (~955px) не
   помещались в ~750px рядом с 240px-сайдбаром: блокеры/активность/действие уходили за край,
   страница скроллилась горизонтально (page overflow 40px).
2. **[critical] Desktop 1440 — page overflow.** Индивидуальные Этап/Финансовый/Активность
   колонки (после локализации «Ответственный» и nowrap-бейджей) давали 1440 overflow 286px.
3. **[major] Смешение языков.** Заголовки `Lifecycle`, `Engagement`, `Owner`, `LIFECYCLE`,
   `ENGAGEMENT` в user-facing UI; `Value-сегменты`, `Net deposits`, `Статус регистрации` в меню.
4. **[major] Раздувание строк / owner-перенос.** `Support`/`1` переносились на 2 строки; blocker
   overflow не сворачивался предсказуемо; priority reason уводил высоту строки.
5. **[major] Toolbar непредсказуемый перенос.** `Колонки` и chips оказывались в случайных рядах,
   смешанные с кнопками фильтров.
6. **[minor] Blocker-бейдж вплотную к «Ответственный» на 1440** (напр. «Заблокирован поддержкой»
   рядом с «Support 1») — тесно, но между ячейками есть padding, не наложение.
7. **[minor] Tablet: длинные blocker-лейблы усечены** («Заблокиров…») — по дизайну компактного
   планшета; полный текст во всплывающей подсказке.

## Исправлено (critical + major)
- **#1/#2 (critical):** введена responsive-стратегия колонок. Merged колонка **«Состояния»**
  (Этап + Финансовый статус + Активность в один компактный стек) на планшете **и** стандартном
  десктопе (md..2xl); индивидуальные колонки — только на очень широких экранах (2xl+).
  `Ответственный` — с xl+. Плюс компактный планшет: у пользователя скрыт email/локаль (xl+
  показывает), priority reason скрыт (tooltip), одиночный blocker усечён, паддинг ячеек `px-1.5`.
  Итог: table/page overflow = 0 на 1024 и 1440.
- **#3 (major):** вся user-facing терминология переведена и вынесена в central config
  (`USERS_COLUMN_LABEL`): **Этап / Активность / Ответственный / Ценностные сегменты /
  Регистрация Pocket / Чистые депозиты**. TS enum-имена не менялись.
- **#4 (major):** owner `whitespace-nowrap` («Support 1» одной строкой); blockers — desktop 2 + `+N`,
  tablet 1 + `+N`, полный список в tooltip; priority reason — одна строка (desktop) / полностью
  читаема без hover (mobile-карточка); progress compact nowrap.
- **#5 (major):** toolbar перекомпонован в предсказуемые ряды: (1) поиск + `Колонки`/`Фильтры`,
  (2) группа фильтров (desktop, xl+), (3) active-chips + `Сбросить всё` — отдельным рядом.
- **#6/#7 (minor):** оставлены как приемлемые (padding-зазор есть; усечение планшета — намеренная
  плотность с tooltip). Переснятия не требуют.

Финальные screenshots пересняты после исправлений (второй pass).

## Чек-лист (§7)
- Смешение RU/EN — устранено в user-facing (домменные термины `Pocket`, `Grace-период`, `XP`,
  `FTD` сохранены намеренно). ✅
- Toolbar rhythm — предсказуемые ряды. ✅
- Tablet hierarchy — намеренная компактная композиция (merged «Состояния»). ✅
- Правый край — действие в строке видно на 1024/1440. ✅
- Row action — иконка (desktop/tablet, aria «Открыть профиль <имя>») / текстовая кнопка (mobile). ✅
- Стабильность высоты строк — reason 1 строка, blockers ограничены, owner nowrap. ✅
- Blockers — 2/1 + `+N`, tooltip. ✅  · Owner — одна логическая строка. ✅
- Priority reason — доступна (tooltip + полн. на mobile). ✅
- Mobile filter count — «Фильтры (N)» + chips. ✅
- Permission masking — admin exact (`$90`), support bucket (`$50–99`), email всегда masked. ✅
- Horizontal overflow — нет page overflow. ✅

## Роли (по коду/проекциям + скриншотам, подтверждено `users-permissions.test.tsx`)
| Роль | Identity в списке | Balance | Exact в DOM |
|---|---|---|---|
| crm_admin | masked | exact (`$90`) | да (по праву) |
| retention_manager | masked | exact | да (по праву) |
| mentor | masked | bucket | нет |
| support | masked | bucket (`$50–99`) | нет |
| analyst | pseudonymous | aggregated | нет |
| read_only | masked | hidden | нет |
