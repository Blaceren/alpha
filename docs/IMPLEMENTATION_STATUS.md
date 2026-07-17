# IMPLEMENTATION_STATUS

Актуальный статус реализации Alfa Trade Academy Web V2.

**Дата:** 2026-07-13
**Текущая фаза:** D0 / D0.1 завершены → **D1A — Application Foundation & Art-Direction Board** (выполнен)
**Состояние приложения:** Next.js foundation + дизайн-токены + shell + три концепта Главной. Backend/CRM/Pocket/database не подключены; данные synthetic. Реальный продукт не реализован.

---

## 1. Статус по фазам

| Фаза | Название | Статус |
|------|----------|--------|
| D0 | Documentation & decision lock | ✅ Завершена (документация) |
| D0.1 | Documentation Consistency Patch | ✅ Применён |
| D1A | Application Foundation & Art-Direction Board | ⛔ Отклонён (generic dashboard) — сохранён как anti-example |
| D1A-R0 | Provisional Brand Intelligence & Art-Direction Reset | ✅ Применён (4 base + 4 ATA skills, references) |
| D1A-R1 | Structural Art-Direction Gate | ✅ Выполнен (3 структурно разных low-fi модели, 6 screenshots, comparison, scoring; победитель не выбран) |
| D1A-R2 | Consolidated High-Fidelity Home Direction | ✅ Концептуально принят / ⚠️ визуально не принят (см. R2.1) |
| D1A-R2.1 | Route Field Visual Correction | ✅ Выполнен (no central card, gate near/boundary/far, Route Sigil, финансовое давление снижено; evidence matrix — все Pass; 5 final + first-pass screenshots; React не разрешён) |
| D1A-R2.2 | Final Production-Readiness Correction | ✅ Выполнен (mobile overlap устранён, route density, структурный checkpoint preview, rank/tool разделены, debug убран, **Route Knot** заменил Route Sigil; evidence matrix — все Pass; final+first-pass; React только после ручного review) |
| D1 | Foundation завершение (все routes, mock provider, полная UI-библиотека) | ◻️ Частично (foundation заложен в D1A) |
| D2 | Главная и Путь | ⛔ Не начата |
| D3 | ~~Урок, тест, report, mentor feedback~~ → **Report, Practical & Mentor Review** (переопределена в D3-A, DD-270) | ◻️ D3-A ✅ (scope + art direction) · D3-B ✅ (первый report-уровень) · D3-C…D3-F не начаты |
| D4 | Tools L10–L30 | ⛔ Не начата |
| D5 | Tools L35–L60 | ⛔ Не начата |
| D6 | Tools L65–L100 | ⛔ Не начата |
| D7 | Community, News, Referral | ⛔ Не начата |
| D8 | Mentor, Support, Notifications, Profile, Settings | ⛔ Не начата |
| D9 | Responsive, motion, a11y, performance, visual QA | ⛔ Не начата |

---

## 2. Артефакты D0

### Создано
- `ATA_PRODUCT_DESIGN_BRIEF_V1.md`
- `docs/CURRICULUM_AND_UNLOCKS.md`
- `docs/USER_FLOWS.md`
- `docs/COMPONENT_INVENTORY.md`
- `docs/RESEARCH_SYNTHESIS.md`
- `docs/ROUTE_MAP.md`
- `docs/STATE_MATRIX.md`
- `docs/MOTION_AND_PERFORMANCE.md`
- `docs/CONTENT_AND_TONE.md`
- `docs/SCREENSHOT_QA_PROTOCOL.md`
- `.gitignore`
- `.gitkeep` в пустых папках `design-memory/`

### Заполнено
- `CLAUDE.md`
- `docs/PRODUCT_CONTEXT.md`
- `docs/INFORMATION_ARCHITECTURE.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/PAGE_INVENTORY.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DESIGN_DECISIONS.md`
- `docs/IMPLEMENTATION_STATUS.md` (этот файл)

---

## 2a. D0.1 — Documentation Consistency Patch

Устранены противоречия; зафиксированы решения DD-170…DD-177 (`docs/DESIGN_DECISIONS.md`).

Изменённые документы: `ATA_PRODUCT_DESIGN_BRIEF_V1.md`, `CLAUDE.md`, `docs/INFORMATION_ARCHITECTURE.md`, `docs/ROUTE_MAP.md`, `docs/PAGE_INVENTORY.md`, `docs/COMPONENT_INVENTORY.md`, `docs/USER_FLOWS.md`, `docs/CONTENT_AND_TONE.md`, `docs/DESIGN_DECISIONS.md`, `docs/CURRICULUM_AND_UNLOCKS.md`, `docs/DESIGN_SYSTEM.md`, `docs/IMPLEMENTATION_STATUS.md`.

Ключевые правки:
1. **Инструменты:** 19 curriculum (L10–L100) + 1 referral-gated «Секретный» = 20 в интерфейсе. Убраны «20 curriculum tools / 20 tool unlocks / 20 инструментов + secret».
2. **Mobile nav:** Главная, Путь, Уроки, Инструменты, **Ещё**; профиль — через avatar в top bar; «Ещё» = Сообщество/Новости/Рефералы/Ментор/Поддержка/Профиль/Настройки. Формулировка «доп. меню из Ещё/Профиля» удалена.
3. **Терминология:** русские пользовательские названия (Сообщество, Ментор, Отчёт, Контрольная точка, Ранг, Поддержка, Рефералы, Инструменты, Недельный обзор); английский — только code/domain; словарь в `CONTENT_AND_TONE.md`.
4. **Маршруты:** канонический App Router `[param]`; `/blog` (public) vs `/news` (in-product); `/referrals`; `/mentor/[conversationId]`; route groups `(app)`/`(public)`.
5. **Pocket:** регистрация, не подключение/привязка; отдельный instruction flow «У меня уже есть аккаунт»; нет прямой Pocket-кнопки после registration flow; backend verification не выдумывается.
6. **App/public boundary:** прелендинг/login/registration вне прототипа; auth state от backend; `/blog` — отдельная оболочка без app sidebar.

---

## 2b. D1A — Application Foundation & Art-Direction Board

**Создано:** Next.js 16 App Router приложение (TypeScript strict, Tailwind, CSS-variable токены,
Radix Tooltip, lucide, self-hosted variable fonts), application shell, foundation-компоненты,
synthetic dashboard state, три концепта Главной (`/concepts/*`) и доска `/concepts`; Vitest/Playwright.

**Новые документы:** `README.md`, `docs/ART_DIRECTION_BOARD.md`, `docs/FRONTEND_ARCHITECTURE.md`.
**Screenshots:** `design-memory/screenshots/d1a-art-directions/` (6 концепт-PNG + board).
**Review:** `design-memory/reviews/d1a-art-directions-review.md` (без выбора победителя).

**Проверки (все зелёные):**

| Проверка | Результат |
|----------|-----------|
| `npm run typecheck` | ✅ чисто |
| `npm run lint` | ✅ чисто |
| `npm run build` | ✅ статические маршруты |
| `npm run test:run` (Vitest) | ✅ 27 тестов |
| `npm run test:e2e` (Playwright smoke) | ✅ 7 тестов |
| `npm run screenshots` | ✅ 7 PNG, точные размеры |
| npm audit | 2 moderate (транзитивный postcss внутри Next; fix ломает Next — не применяем) |
| Overflow 390/1024/1440 | ✅ 0px |
| Console (app) | ✅ без ошибок (dev HMR websocket-шум отфильтрован) |
| Финансовая приватность | ✅ target есть, баланса/«осталось $X»/Pocket-CTA нет |

**Ограничения соблюдены:** нет backend/CRM/Pocket/database/deploy/production auth; реализованы только
концепт-маршруты (не все routes/инструменты); реальная Главная и Путь не финализированы; данные synthetic.

## 3. Consistency validation (D0)

| Проверка | Результат |
|----------|-----------|
| Ровно 100 уровней | ✅ level.001–level.100 |
| Ровно 20 модулей | ✅ module.01–module.20 |
| 20 checkpoints, thresholds = `les-prog.txt` | ✅ |
| Tool unlocks = `les-prog.txt` | ✅ 19 curriculum-инструментов (L10–L100) + 1 referral = 20 в интерфейсе |
| Rank mapping (20 ranks, 5 families) | ✅ |
| Community unlocks (L4/20/35/45/85) | ✅ |
| Reports/practical не пропущены | ✅ |
| Обязательные mentor reviews не пропущены | ✅ L14/29/44/59/74/84/94 |
| Нет выдуманных thresholds | ✅ |
| Legacy «TradeQuest» вне пользовательских текстов | ✅ только в `les-prog.txt` |
| Финансовая приватность (нет баланса/«осталось $X») | ✅ во всех документах |
| Mentor ≠ Support | ✅ |
| Public news ≠ in-product news | ✅ |
| Manual tools (нет автоподгрузки Pocket) | ✅ |
| Mobile nav ≠ desktop nav согласованы | ✅ |
| Design system ↔ прелендинг continuity | ✅ provisional tokens |

Подробный контроль противоречий — раздел 39 брифа и `DESIGN_DECISIONS.md`.

---

## 4. Ограничения соблюдены (D0)

- ❌ package.json — не создан.
- ❌ src/ — не создан.
- ❌ React/Next.js приложение — не создано.
- ❌ Зависимости — не установлены.
- ❌ UI-код — не написан.
- ❌ backend / CRM / Prisma / database / Pocket — не подключены.
- ❌ production API / deploy — нет.
- ❌ Реальные пользовательские данные — не использованы.

---

## 5. Blockers

Реальных блокеров для документации нет. Открытые вопросы (не блокируют D0, влияют на визуальную финализацию позже) — см. `DESIGN_DECISIONS.md` → «Открытые вопросы» и `IMPLEMENTATION_PLAN.md` → «Missing assets».

---

## 6. Следующий шаг

**D1 — Foundation.** Не начинать без явного запроса пользователя.

---

## 7. D1B — React App Shell & Route Field Home (выполнено)

| Пункт | Статус |
|-------|--------|
| Аутентифицированная оболочка (app bar / mobile top / bottom nav) | ✅ |
| Главная — Active Lesson (`/?scenario=active`) | ✅ |
| Главная — Current Checkpoint (`/?scenario=checkpoint`) | ✅ |
| Responsive Route Field (mobile / tablet / desktop) | ✅ |
| Минимальные переиспользуемые компоненты | ✅ |
| Реальные screenshots (desktop/tablet/mobile + 320px + zoom 200%) | ✅ 8 кадров |
| Visual QA после браузерного рендера | ✅ 10 findings, все Critical/Major исправлены |
| Финансовая приватность (нет баланса/депозитов/выводов/«осталось»/Pocket-CTA) | ✅ закреплено тестами |
| `ProvisionalRankMark` (не финальная система рангов) | ✅ |
| Unit/component tests | ✅ 32 |
| E2E smoke (Playwright) | ✅ 9 |
| lint / typecheck / build | ✅ чисто |
| npm audit | ⚠️ 2 moderate (транзитивный postcss в Next; форс-даунгрейд отклонён) |

**Границы соблюдены:** нет `/path`, страниц урока/теста/report/tools/community/news/referrals/mentor/
support/profile/settings; нет полной системы рангов и 20 rank-ассетов; нет реальной auth/backend/CRM/
Pocket/Prisma/БД; нет deploy; D2 не начат.

Детали — `docs/D1B_REACT_HOME_IMPLEMENTATION.md`, `design-memory/reviews/d1b-react-home-review.md`.

**Следующий шаг после D1B:** по явному запросу — фаза Rank Identity или D2 (Главная + Путь).
Не начинать без запроса пользователя.

---

## 8. D1B.1 — Responsive / Zoom / Safe-Area Correction (выполнено)

Корректирующий этап поверх принятого D1B; Route Field не пересматривался.

| Пункт | Статус |
|-------|--------|
| 200% browser zoom reflow'ит в compact (без обрезки, без h-overflow) | ✅ |
| Tablet Active — отдельная 2-региональная композиция (не scaled desktop) | ✅ |
| Bottom nav не перекрывает контент (safe-area, scroll-padding) | ✅ |
| Checkpoint mobile outcomes полностью доступны | ✅ |
| 320px usable | ✅ |
| Контраст вторичного/muted поднят (3 уровня сохранены) | ✅ |
| Desktop regression-free | ✅ |
| Financial privacy сохранена | ✅ |
| Unit 32 / E2E smoke 15 / lint / typecheck / build | ✅ |
| npm audit | ⚠️ 2 moderate (без изменений; `--force` не выполнялся) |

Границы: без нового art-direction, `/path`, lesson page, tools, community, rank identity,
backend/CRM/Pocket/DB, dependency upgrade, deploy. Детали — `docs/D1B_1_RESPONSIVE_CORRECTION.md`,
`design-memory/reviews/d1b-1-responsive-fix-review.md`.

**Следующий этап после принятия D1B.1 — полноценный `/path`** (не начинать без запроса).

---

## 9. D1B.2 — Short Viewport & Bottom Navigation Final Fix (выполнено)

Финальный корректирующий этап Главной; Route Field/desktop/tablet не переделывались.

| Пункт | Статус |
|-------|--------|
| 200% zoom — CTA полностью выше bottom nav | ✅ (−98px) |
| Landscape — CTA выше bottom nav | ✅ (−38px, после focus −96px) |
| 320px — Alex полностью прокручивается выше nav | ✅ |
| 320px — checkpoint preview выше nav | ✅ |
| Canonical `--mobile-bottom-nav-height` + единый scroller | ✅ |
| Short-height mode (`max-height:560px`) | ✅ |
| Focus/keyboard не под nav | ✅ |
| Checkpoint mobile regression-free | ✅ |
| Desktop/tablet regression-free | ✅ |
| Unit 32 / E2E smoke 21 / lint / typecheck / build | ✅ |
| npm audit | ⚠️ 2 moderate (без изменений; `--force` не выполнялся) |

**Home завершена после D1B.2.** Детали — `docs/D1B_2_SHORT_VIEWPORT_FIX.md`,
`design-memory/reviews/d1b-2-short-viewport-fix-review.md`.

**Следующий этап — полноценный `/path`** (не начинать без явного запроса).

---

## 10. D2A — Learning Path (выполнено)

| Пункт | Статус |
|-------|--------|
| Typed curriculum: 20 модулей / 100 уровней / 20 checkpoints (пороги канона) | ✅ + 16 consistency-тестов |
| `/path` — module navigator, focused Route Field, состояния, detail, return-to-current | ✅ |
| Сценарии active/checkpoint/early/advanced/completed (fallback → active) | ✅ |
| Desktop 1440 / tablet 1024 / mobile 390 / 320 / landscape / zoom-200 | ✅ |
| Keyboard (←→ Enter Escape Home) + roving tabindex + visible focus | ✅ |
| Semantic outline (sr-only, 20 модулей + уровни, aria-current="step") | ✅ |
| Financial privacy (только target; без баланса/«осталось»/Pocket CTA) | ✅ тестами |
| Performance: ≤8 узлов, ≤30 SVG-элементов, без random/rAF | ✅ e2e |
| Тесты: 65 unit/component; e2e 15 path + 21 home (регрессия Home) | ✅ |
| Visual QA: 14 findings first-pass, Major исправлены, final переснят | ✅ |
| Screenshots: 13 final (точные размеры в review) | ✅ |
| lint / typecheck / build | ✅ |
| npm audit | ⚠️ 2 moderate (транзитивный postcss в Next; без изменений) |

**Границы:** прогресс остаётся mock; backend/API/CRM/Pocket/Prisma/auth не подключены;
lesson/test/report/tools/community страницы не реализованы; rank identity — provisional;
Главная не переделана. Детали — `docs/D2A_PATH_ARCHITECTURE.md`, `docs/PATH_LAYOUT_ENGINE.md`,
`docs/PATH_ACCESSIBILITY.md`, review — `design-memory/reviews/d2a-path-review.md`.

**D2B не начинается автоматически.**

---

## 11. D2A-R1 — Path Visual Hierarchy & Responsive Correction (выполнено)

Корректирующий этап: **только presentation layer**. Данные, layout engine, scenarios и a11y-архитектура
D2A не менялись.

| Пункт | Статус |
|-------|--------|
| Mobile detail непрозрачен (alpha = 1), scrim без blur, bottom nav остаётся рабочим | ✅ |
| Desktop detail привязан к выбранному узлу leader-линией; не карточка/modal/sidebar | ✅ |
| 200% zoom: узел + сводка КТ (порог, ранг, инструмент) целиком в первом экране | ✅ |
| Landscape: маршрут и текущий узел ≥16px над bottom nav (факт 20px) | ✅ |
| Pan discoverable (edge-fade + одноразовая метка), vertical scroll не блокируется | ✅ |
| Навигатор: scale `N / 20`, главы по 5, current/viewed различимы геометрией, ≥44px | ✅ |
| Path сильнее отличается от Home (viewport-рамка, scale, сводка, detail-стена) | ✅ |
| Desktop/tablet/mobile/320 без регрессий; Home не тронута | ✅ |
| Financial privacy сохранена (только target, без баланса/Pocket CTA) | ✅ |
| Tests: 67 unit + 86 e2e; lint / typecheck / build | ✅ |
| npm audit | ⚠️ 2 moderate (транзитивный postcss в Next; без изменений) |

Детали — `design-memory/reviews/d2a-r1-path-correction-review.md`, `docs/D2A_PATH_ARCHITECTURE.md` §12.

**D2A закрыт (D2A + R1). D2B не начат.**


## D2B — Core Lesson Experience (завершена)

**Реализовано:** канонический маршрут `/lessons/[levelCode]`; `/lessons` → текущий урок (раньше 404);
typed lesson content + assessment model; lesson state machine; deterministic simulated media adapter;
video stage; watch progress; 50% unlock; locked test preview; один вопрос за раз; submit; correct/incorrect
feedback; retry; progression; completion; next-lesson gate; возврат в Путь; интеграция Home и Path CTA;
desktop/tablet/mobile/320/landscape/200% zoom; keyboard/a11y/reduced motion; tests; screenshots; visual QA.

**Основная fixture:** уровень 18 «Поддержка и сопротивление» (модуль 4). Уровень 19 — только stub
(practical-уровень, его опыт вне scope). Остальные 98 уровней намеренно не авторились.

**Контент provisional:** утверждённого редакционного сценария нет; каноничны продуктовые правила и UX,
а не формулировки (DD-243). Production lesson authoring не реализован.

**Правила:** тест открывается ровно на 50% verified watch; полный просмотр не требуется; один вопрос за раз;
ошибка ничего не отнимает; completion = 50% + все обязательные вопросы (provisional frontend rule, не
backend-контракт, DD-245); следующий урок закрыт до completion.

**Границы:** mock state не является backend persistence; XP не придуман (2 480 не меняются);
report/mentor/tool фазы **не начинались**; backend/Pocket/database отсутствуют; **D2C автоматически
не начинается**.

**Проверки:** unit/component **203** (67 прежних сохранены + 136); E2E **116** (86 прежних сохранены + 30);
lint/typecheck/build чисто; `npm audit` — 2 moderate, pre-existing (`next → postcss`), fix не запускался.

**Документы:** `D2B_LESSON_EXPERIENCE.md`, `LESSON_STATE_MACHINE.md`, `LESSON_ACCESSIBILITY.md`,
`design-memory/reviews/d2b-lesson-review.md`, DD-242…DD-254.


## D2B.1 — Lesson Acceptance Gate Fix (завершена)

Техническая приёмка D2B выявила два несоответствия; D2B.1 чинит **только** их. Визуальный D2B принят и
не переделывался.

**Fix A — стандартный E2E gate был неполным.** `test:e2e` запускал один файл (21 из 116 тестов): Path и
Lesson behavioral suites не проверялись вообще. Теперь `test:e2e` = **78** behavioral в 5 файлах,
`test:e2e:all` = полный discovery (**121**). Специи разделены по naming convention: `*smoke.spec.ts` —
behavioral (в gate), `*screenshots.spec.ts` — artifact capture (не в gate, пишет PNG). Причина не
косметическая: screenshot-спека прошлой фазы **переписывает historical evidence** (DD-257). После
стандартного gate дерево чисто.

**Fix B — progression зависел от dev scenario.** CTA вёл на `/lessons/level.019?scenario=unlocked` —
development-адаптер был единственным механизмом разблокировки. Теперь completion пишется в
**session-scoped store** (`sessionStorage`, `ata.lesson-progress.v1`), CTA — чистый
`/lessons/level.019`. Ownership разделён: state machine → завершённость урока; session adapter →
хранение между navigation/reload; availability resolver → sequence + dev override + session (DD-255/256).

**Поведение:** до completion CTA нет; без marker уровень 19 locked; после completion — unlocked practical
placeholder по чистой ссылке; hard reload сохраняет; новый context locked; corrupt marker безопасен.

**Границы:** это **не** backend persistence — закрытие сессии может потерять прогресс, и UI говорит
ровно это. `scenario` остался development/test adapter; пользовательские ссылки его не содержат.
Уровень 19 — по-прежнему честный practical placeholder, фальшивой реализации задания нет.

**Проверки:** unit/component **252** (203 сохранены + 49); E2E **121** (116 сохранены + 5); стандартный
gate **78**; lint/typecheck/build чисто; `npm audit` — 2 moderate, pre-existing (`next → postcss`), fix
не запускался; `package-lock` не менялся, в `package.json` изменены только `scripts`.

**Документы:** `D2B_1_ACCEPTANCE_FIX.md`, DD-255…DD-257.


## D2C-A — Lessons Library Art Direction (завершена)

**D2C впервые определена.** До этой фазы «D2C» существовал в документации только как отрицание
(«D2C автоматически не начинается») — ни scope, ни acceptance у него не было. Теперь:
**D2C = Lessons Library & Module Overview**, production-маршрут `/lessons`
(`docs/D2C_LESSONS_LIBRARY_SCOPE.md`, DD-258).

**Различие зафиксировано:** Путь отвечает на «где я в последовательности» (**допуск**), Уроки — на
«чему посвящён материал» (**содержание**). Если «Уроки» начинают отвечать на вопросы Пути, страница не
нужна (DD-259).

**Предъявлено три структурно разных направления** (`docs/D2C_ART_DIRECTION.md`, 19-пунктовый бриф на
каждое): **A — Module Desk** (рейка + рабочая поверхность; текущая строка разворачивается в плоскость),
**B — Curriculum Index** (curriculum как содержание книги; ноль карточек; все 20 модулей выше сгиба),
**C — Learning Brief** (страница-аргумент; цепь ролей «изучаю → применю → откроет»).

**Проверки:** реальные Chromium-кадры в точных вьюпортах (1440×900, 390×844, board 1920×1080);
horizontal overflow **0px** во всех шести кадрах; 11 findings (1 critical, 6 major, 4 minor), все
critical/major исправлены до финальных кадров, minor перечислены открыто
(`design-memory/reviews/d2c-a-concepts-review.md`).

**Границы:** production React **не написан**; `src/`, `package.json`, `package-lock.json`, `e2e/` не
изменялись; production-тесты не запускались (production-код не менялся); screenshot-спеки прошлых фаз
не запускались, historical evidence не перезаписан (DD-257). Прототипы линкуют **настоящие** токены,
shell и шрифты продукта и лежат вне `src/`
(`design-memory/proposals/d2c-lessons-library/`, DD-260).

**Найдено попутно (не исправлено — production-код заморожен):** пункт навигации «Уроки» помечен
`BUILT_ROUTES = {home, path}` как непостроенный и рендерится с подсказкой «Скоро», хотя `/lessons`
работает с D2B — противоречие DD-254. Первый пункт работ фазы реализации
(`D2C_LESSONS_LIBRARY_SCOPE.md` §7).

**Документы:** `D2C_LESSONS_LIBRARY_SCOPE.md`, `D2C_ART_DIRECTION.md`, DD-258…DD-260.


## D2C-B — Lessons Library (завершена)

**Пользователь выбрал Concept B «Curriculum Index»** (DD-261). `/lessons` перестал быть redirect'ом и
стал полноценной библиотекой; контекстный дефолт «перейти к текущему уроку» повышен до доминирующего
«Продолжить обучение». Навигация «Уроки» стала настоящим built route (`BUILT_ROUTES` + `aria-current`,
подсказка «Скоро» убрана) — противоречие DD-254, найденное в D2C-A, устранено.

**Композиция:** desktop — двухуровневый индекс (20 модулей слева, содержание выбранного модуля справа,
уровни строками, ноль карточек); из Concept A перенесён **только mobile-переключатель модуля** +
sheet со всеми 20; **Concept C отклонён** (дублировал бы Главную).

**Архитектура:** один presentation projector (`lessons-library-model.ts`) объединяет curriculum fixture
+ общий marker + session resolver; React получает готовую модель и не считает progression сам (DD-262).
Второго набора названий/thresholds/rewards/типов/статусов нет. Введён единственный владелец подписей
типов — `kindLabel`. Module selection — обычное URL-состояние `?module=module.NN` (DD-263), не dev
scenario; `/lessons` `?scenario` не читает.

**Session progression (D2B.1):** после реального завершения уровня 18 в той же сессии библиотека
показывает 18 завершённым, 19 — текущим practical, «3 из 5», CTA → `/lessons/level.019` по чистой
ссылке; hard reload сохраняет; новый context — исходное состояние; битый marker безопасен. Ни один href
не содержит `scenario`.

**Проверки:** unit/component **308** (252 прежних сохранены + 56); E2E gate **88** в 6 файлах (78
прежних сохранены + 10); полный discovery **134** в 13 файлах; lint/typecheck/build чисто; `npm audit`
— 2 moderate, pre-existing (`next → postcss`), fix не запускался; после стандартного gate historical
evidence не изменилось. Visual QA: 2 прохода, 7 findings (0 critical, 2 major, 5 minor), оба major
исправлены до финальных кадров.

**Границы:** Home / Path / Lesson визуально не менялись; curriculum fixtures, thresholds, XP-правила,
completion rule и session progress schema — без изменений; зависимости не менялись (sheet без новой
зависимости); backend/API/database/Pocket отсутствуют. **D3, отчёты, mentor feedback и инструменты не
начаты.**

**Документы:** `D2C_LESSONS_LIBRARY.md`, `design-memory/reviews/d2c-b-lessons-library-review.md`,
DD-261…DD-263.


## D3-A — Report Level Scope & Art Direction (завершена)

**D3 переопределена (DD-270).** Прежнее определение — «Урок, тест, report и mentor feedback» — писалось
в D0, до появления D2B и D2C. **Урок и тест реализованы в D2B и в новый D3 не входят**; два из четырёх
прежних acceptance-критериев («тест открывается на 50%», «просмотр 50% не завершает уровень») уже
закрыты и покрыты тестами (DD-245, DD-249). Актуально:
**D3 = Report, Practical & Mentor Review Experience** (`docs/D3_REPORT_SCOPE.md`), разбитая на этапы:
**D3-A** (scope + art direction, эта фаза) → **D3-B** (только уровень 3: draft · browser-local autosave ·
submit · pending-review, без вердикта) → отдельные будущие этапы (revision/resubmit, approved, mentor
feedback, practical, practical ↔ Tools).

**Шесть продуктовых решений зафиксированы (DD-264…DD-269):**

| # | Решение |
|---|---------|
| 1 | Отчёт — **сам curriculum-level**: `/lessons/level.003`; `/reports/[reportCode]` **не используется**, код `report.NNN` не вводится |
| 2 | **`pending-review` останавливает progression**: уровень 4 закрыт до вердикта; без countdown; фальшивый вердикт запрещён; dev-adapter — только для screenshots |
| 3 | **Browser-local `localStorage`**, ключ `ata.report-workspace.v1` (не `sessionStorage`): потеря черновика — потеря работы пользователя |
| 4 | **Practical ≠ report-форма**; гипотеза «practical = ручной прототип будущего инструмента» зафиксирована, но не утверждена; уровень 19 остаётся placeholder |
| 5 | **Rubric — структурная и prototype-only** (completeness · evidence · reflection); торговая методология не выдумывается |
| 6 | **`/lessons/[levelCode]/test`** остаётся зарезервированным; inline-тест D2B — канон; судьба маршрута — отдельным DD |

**Сценарий:** уровень 3 «Первые пять demo-сделок» — единственный `kind: "report"` в curriculum.
Данные (артефакт «Отчёт по 5 demo-сделкам», модуль 01, следующий уровень 4 «Контрольная точка $50»)
взяты из fixture **дословно**. Текста задания в fixture нет — canonical instructions не выдуманы,
используется пометка «Структура задания уточняется редакцией».

**Предъявлено три структурно разных направления** (`docs/D3_REPORT_ART_DIRECTION.md`, 19-пунктовый бриф
на каждое): **A — Report Desk** (один непрерывный учебный документ + Learning-Spine ось разделов),
**B — Evidence Ledger** (артефакт раскрыт собственной структурой: пять записей, одна открыта),
**C — Submission Contract** (две встречные плоскости: работа и плита-соглашение с apertura-кромкой).
Пространственные системы различны: документ · перечислимый артефакт · соглашение.

**Проверки:** реальные Chromium-кадры в точных вьюпортах (1440×900, 390×844, две доски 1920×1080);
horizontal overflow **0px** во всех шести кадрах концептов; **15 findings** (2 critical, 7 major,
6 minor) — все critical и major исправлены до финальных кадров, minor перечислены открыто
(`design-memory/reviews/d3-a-report-concepts-review.md`). Critical: рабочая поверхность обрезала текст
пользователя на mobile; у Concept B на mobile отсутствовала рабочая поверхность целиком.

**Границы:** production React **не написан**; `src/`, `package.json`, `package-lock.json`, `e2e/` не
изменялись; production-тесты не запускались (production-код не менялся); screenshot-спеки прошлых фаз
не запускались, historical evidence не перезаписан (DD-257); зависимости не добавлялись; curriculum
fixture не менялся. Прототипы линкуют настоящие токены, shell и шрифты и лежат вне `src/` (DD-260):
`design-memory/proposals/d3-report/`.

**Победитель не выбран — выбор за пользователем. D3-B не начинается без явного выбора направления.**

**Документы:** `D3_REPORT_SCOPE.md`, `D3_REPORT_ART_DIRECTION.md`,
`design-memory/reviews/d3-a-report-concepts-review.md`, DD-264…DD-270.


## D3-B — First Report Level (завершена)

**Пользователь выбрал Concept B «Evidence Ledger»** + компактный блок «Перед отправкой» из Concept C
(DD-271). Concept A и полная правая плита Concept C отклонены. Реализован **только уровень 3** —
единственный curriculum-уровень с `kind: "report"`.

**Маршрут:** `/lessons/level.003` — отчёт является самим уровнем; `/reports/report.003` не создан
(DD-264). Report-уровни перехватываются на существующем маршруте до логики урока; уровни 18 и 19 не
затронуты.

**Канон не тронут.** Артём остаётся на уровне 18. Поскольку единственный report-уровень — 3, история
«submit → pending → уровень 4 закрыт» связна только для стоящего на уровне 3, поэтому введён
**explicit dev/test сценарий `report`** (`currentLevel: 3`) рядом с early/advanced/checkpoint
(DD-272). Полный flow живёт только под ним; он не включается автоматически и не появляется ни в одной
пользовательской ссылке. Без сценария уровень 3 для канонического Артёма — завершённый (`archive`).

**Резолвер доступности не менялся:** уровень 4 остаётся закрытым потому, что уровень 3 никогда не
завершается (`pending-review` не пишет `ata.lesson-progress.v1`), а не потому, что отчёт его «запер».
Фраза о закрытом уровне 4 **выводится** из резолвера и отсутствует, когда уровень действительно
открыт. Последовательность побеждает локальную запись, поэтому pending не загрязняет канонический
профиль (DD-272).

**Реализовано:** ледгер из пяти записей (число диктует артефакт курса) · итоговое наблюдение ·
browser-local черновик (`localStorage`, `ata.report-workspace.v1`) · autosave с четырьмя честными
состояниями · readiness словами · submit с подтверждением · `pending-review` read-only · интеграции в
Библиотеку и Путь · responsive desktop/tablet/mobile/320/zoom · тесты · screenshots · visual QA.

**Prototype-only структура полей** (DD-274): «Когда» · «Что решил» · «Что заметил после сделки»
(единственное обязательное) + «Итоговое наблюдение». Ни asset, ни amount, ни P/L, ни цен, ни объёма,
ни плеча, ни финансовой оценки — закреплено тестами.

**Попутно исправлено:** деталь Пути инлайнила собственные подписи типов, включая английское
«Structured report» в пользовательском тексте (нарушение DD-172) — теперь единственный владелец
`kindLabel` (DD-262). `/lessons` начал читать `?scenario=` как dev-адаптер — явная поправка к DD-263
(DD-273). `src/test/setup.ts` получил рабочий `localStorage`: в связке jsdom/Node он был объектом без
методов, из-за чего store никогда не проходил бы реальный путь в тестах.

**Проверки:** unit/component **435** (308 прежних сохранены + 127); E2E gate **116** в 7 файлах (88
прежних сохранены + 28); полный discovery **175** в 15 файлах; lint/typecheck/build чисто;
`npm audit` — 2 moderate, pre-existing (`next → postcss`), fix не запускался; horizontal overflow 0px
на 1440/1024/390/320/720; console errors и hydration warnings — 0.

**Visual QA:** 2 прохода, 8 findings (2 critical, 3 major, 3 minor). Critical: блок «Перед отправкой»
**лгал** о сохранении при отказе записи; pending-отчёт **загрязнял канонический профиль**. Major: блок
доминировал над ледгером (641px против 429px); единственный CTA уходил на 450px под сгиб; кадры
обрезали shell. Все исправлены — `design-memory/reviews/d3-b-report-review.md`.

**Границы:** approved / rejected / revision / resubmit / mentor comments / section comments / version
history / attachments / mentor thread / avatar / countdown / practical / уровень 19 / инструменты /
backend / Pocket / XP / отдельный test-route — **не реализованы**. Curriculum fixtures, thresholds и
XP-правила не изменялись. Урок 18 и Главная визуально не менялись. Зависимости не менялись.

**D3-C, D3-D, D3-E и practical не начаты.**

**Документы:** `D3_REPORT_EXPERIENCE.md`, `REPORT_STATE_MACHINE.md`, `REPORT_STORAGE.md`,
`design-memory/reviews/d3-b-report-review.md`, DD-271…DD-277.
