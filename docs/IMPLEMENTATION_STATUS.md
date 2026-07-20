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
| D4 | Tools L10–L30 | ◻️ D4-A ✅ (scope + art direction, 3 направления) · **D4-B ✅ (Tools Hub + Trading Journal)** · **D4-C ✅ (Risk Calculator L15, Price Rail)** · остальные tool internals (Chart Markup L20+) не начаты |
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


## D3-B.1 — Report Mobile Safe Area Acceptance Fix (завершена)

Корректирующий этап поверх принятого D3-B. Evidence Ledger, desktop-композиция, lifecycle, readiness,
storage и progression **не пересматривались**.

**Что оказалось причиной.** Визуальная приёмка увидела mobile-блокер, но `padding-bottom` был на
месте, а замер показал: **overlap'а нет** — каждый контрол уже прокручивался выше панели. Настоящих
дефектов было два, и оба измеряемые:

1. **`flex-basis` как подсказка ширины в column-контейнере (DD-279).** `.rl-end-txt` нёс
   `flex: 1 1 280px` для desktop-строки; на mobile `.rl-end` переключается в `column`, и 280px стали
   **высотой**: элемент рендерился 280px при содержимом 79px → **201px** дыры между объяснением и его
   же CTA. Именно это читалось как «кнопка брошена внизу».
2. **Дублированная компенсация навигации (DD-278).** `.home-main` уже несёт канонические
   `nav + env(safe-area-inset-bottom) + 24px`; `.rl-page` добавляла свою — 84px поверх 84px — и при
   этом **пропускала safe-area inset**. Под последним контролом оставалось **108px** мёртвого поля.

**Исправлено:** компенсация оставлена одному владельцу (`home.css`), `flex-basis` нейтрализован на
mobile. Замер после: последний контрол — **24px** над панелью на 390, 320 и 200% zoom, во всех трёх
состояниях.

**Pending read-only (DD-280):** пустые необязательные поля больше не выглядят редактируемыми —
спокойное «Не заполнено» вместо пустой интерактивной рамки, без роли `textbox` и без красного.
Заполненные значения читаемы, обязательное поле не сворачивается, draft/ready не изменились.

**Проверки:** unit/component **441** (435 прежних сохранены + 6); E2E gate **120** в 7 файлах (116
прежних сохранены + 4); полный discovery **184** в 16 файлах; lint/typecheck/build чисто;
`npm audit` — 2 moderate, pre-existing, fix не запускался; horizontal overflow 0px.

Safe area проверяется **реальными bounding boxes** с порогом ≥12px, а не наличием CSS-правила
(DD-281) — именно наличие правила и усыпило приёмку D3-B.

**Границы:** изменены только `report-level.css` (presentation) и `report-entry.tsx` (presentation) +
тесты. Модель, storage, hooks, Path, Library, `home.css`, токены и curriculum — **не тронуты**.
13 исторических кадров D3-B не перезаписаны. **D3-C не начинался.**

**Кадры:** `design-memory/screenshots/d3-report/mobile-acceptance-fix/` — 5 PNG, сняты в нижней части
страницы, чтобы последний контрол, верхняя граница навигации и реальный зазор были видны в одном кадре.

**Документы:** DD-278…DD-281.


## D3-C-A — Revision Requested & Resubmit Art Direction (завершена)

Documentation + art-direction этап поверх принятого D3-B. **Production-код не изменялся**
(`git status --porcelain src package.json package-lock.json` — пусто); Evidence Ledger, lifecycle,
storage v1 и progression не пересматривались; DD-271 остаётся базой.

**Продуктовые решения (DD-282…DD-288):** report-kind сам по себе review-gated, `mentorReview` —
флаг дополнительной practical-механики (fixture не менялся); канонический термин **«Нужна
доработка»** (`revision-requested`), без «Отклонён»/«Провален», без красного и без изобретённого
warm-оттенка; хранилище будущей реализации — **`ata.report-workspace.v2`** с односторонней
миграцией валидных v1-данных (v1 не удаляется, битое — fail closed, код миграции не писался);
единственный источник вердикта — explicit dev/test adapter; `approved` остаётся D3-D; mentor
system не вводится (feedback = один комментарий + section IDs, raw ID не показываются).
Контракты — `docs/D3_REVISION_SCOPE.md`, включая acceptance criteria D3-C-B.

**Три направления внутри Evidence Ledger** (`docs/D3_REVISION_ART_DIRECTION.md`, 19-пунктовые
брифы + ASCII): **A «Margin Review»** — feedback как слой (полоса комментария + margin rail с
полыми узлами; ледгер не перестроен), **B «Revision Pass»** — feedback как порядок
(инвертированное раскрытие: отмеченные места раскрыты, остальное приглушено, «Доработка 1 из 2»
словами), **C «Review Contract»** — feedback как объект (блок DD-271 вырастает в контракт
closing zone: без пометок · требует внимания · после повторной отправки; Λ-излом кромки).
Один сценарий во всех: L3, все данные сохранены, два места требуют внимания
(`report.003.entry.3.noticed`, `report.003.summary` — raw ID не рендерятся), feedback помечен
dev/test provisional, resubmit возвращает в «На проверке», уровень 4 закрыт.

**Прототипы** — `design-memory/proposals/d3-revision/` (линкуют продуктовые токены, shell и
**реальный** `report-level.css`; состояния revision/editing/ready через `?state=` — capture-only
условность). **Кадры** — `design-memory/screenshots/d3-revision/concepts/`: 13 PNG (по 4 на
направление + доска 1920×1080), размеры точные, horizontal overflow 0px; зазор CTA↔bottom-nav
24–25px на 390×844, 320×720 и 720×450 (200% zoom) — bounding boxes, прецедент DD-281.

**Self-review** (`docs/visual-reviews/D3_C_REVISION_ART_DIRECTION.md`): 1 critical (state-переключатель
показывал «изменений нет» и «есть изменения» одновременно — `[hidden]` перебивался
`display:block`), 2 major (нечитаемый rail; пустая половина доски) — исправлены и пересняты;
5 minor зафиксированы. Historical evidence `design-memory/screenshots/d3-report/**` не изменялся.

**Победитель не выбран — выбор за пользователем. D3-C-B не начат.**


## D3-C-B — Report Revision Pass (завершена)

Production-реализация выбранного направления **B «Revision Pass»** (DD-289): feedback — порядок
работы. Из A взяты ровно два элемента (полоса «Комментарий проверки» + человекочитаемые
ссылки-переходы); margin rail A и Review Contract C отклонены. Blue — review, green — только
сохранение/готовность/действие; красного нет; обычные записи спокойны и доступны, без «без пометок».

**Storage v2 (DD-290):** `ata.report-workspace.v2` — status-союз + `revision-requested`, объект
`review {comment, sections, receivedAt, atRevision}`, счётчик `meaningfulRevision` (whitespace-правка
сохраняется, изменением не считается). Односторонняя миграция при чтении: валидный v2 авторитетен,
битый v2 fail closed без отката к v1, v1 никогда не удаляется/не перезаписывается; битый review
стоит вердикта, не работы. Raw section ID не рендерятся — только «Запись 03 · Что заметил после
сделки» / «Итоговое наблюдение».

**Verdict adapter (DD-291):** `?verdict=revision-requested` только вместе с `?scenario=report`,
fail closed (approved/rejected невозможны по типу), один вердикт на итерацию, пишет только
report-workspace; фиксированный provisional feedback с пометкой `dev/test · provisional`.

**Revision Pass:** чип «Нужна доработка» (полая точка), kept-строка, browser-local правда;
первая отмеченная секция открыта; pass словами «Доработка 1 из 2 · дальше — Итоговое наблюдение» →
«Доработка 2 из 2 · просмотрены — работа снова целиком ваша»; отмеченные места — словесное
состояние + холодная кромка. **Resubmit (DD-292):** готовность ∧ изменение после `review.atRevision`
(любое поле — пометки не валидатор) → диалог «Отправить отчёт на проверку повторно?» («Продолжить
доработку» / «Отправить повторно», focus trap/Escape/возврат фокуса) → ровно `pending-review`,
review сохранён как «Комментарий последней проверки» (тихий контекст), «Исправления отмечены как
отправленные только в этом браузере.» Library: «Нужна доработка» / «Готов к повторной отправке»;
Path: «Отчёт: …»; CTA всегда чистый `/lessons/level.003`. Канонический Артём (L18) не понижен;
`ata.lesson-progress.v1` не пишется; уровень 4 закрыт только настоящим резолвером.

**Проверки:** unit/component **518** (441 прежних сохранены + 77); E2E gate **146** в 8 файлах
(120 прежних сохранены + 26); полный discovery **224** в 18 файлах; lint/typecheck/build чисто;
`npm audit` — 2 moderate, pre-existing, fix не запускался; horizontal overflow 0px; зазоры
CTA/полей над bottom nav ≥12px реальными bounding boxes (DD-281) на 390×844, 320×720, 720×450;
console errors и hydration warnings — 0.

**Visual QA:** first-pass 14 кадров → ревью глазами: 0 critical, 0 major, 5 minor
(зафиксированы) → final 14 кадров (`design-memory/screenshots/d3-revision/{first-pass,final}/`,
`docs/visual-reviews/D3_C_REVISION_IMPLEMENTATION.md`). Historical evidence не перезаписан.

**Границы:** approved / автоодобрение / mentor thread / identity / avatar / countdown /
attachments / version history / section threads / rubric / score / practical / уровни 14, 19 /
tools / backend / Pocket / XP — не реализованы. Curriculum fixture, thresholds, lesson progression
schema, Home и D2B-урок не изменялись. Зависимости не менялись. **D3-D не начат.**

**Документы:** `D3_REVISION_EXPERIENCE.md`, обновлены `D3_REVISION_SCOPE.md`,
`D3_REVISION_ART_DIRECTION.md` (баннер выбора), `D3_REPORT_EXPERIENCE.md`,
`REPORT_STATE_MACHINE.md`, `REPORT_STORAGE.md`, `STATE_MATRIX.md`, `ROUTE_MAP.md`, README;
DD-289…DD-292.

## D3-D-B — Approved Report State (реализовано)

Терминальный вердикт `approved` для отчёта уровня 3 и его проекция на прогрессию.

**Storage v3** (`ata.report-workspace.v3`, version 3): `approved` + `approvedAt`; односторонняя
read-time миграция v1 → v2 → v3 (валидный v3 авторитетен, битый v3 fail closed без отката; v2/v1
поднимаются с `approvedAt = null`; v1/v2-парсеры не тронуты, ключи не удаляются, `clear()` только v3).
Нормализация approved fail closed, но сохраняет работу (DD-296).

**Approved lifecycle** (DD-297): `pending-review → approved`, терминальный (read-only по конструкции,
не resubmit-абелен, повторно не аппрувится, review сохранён, XP не меняется). Completion L3 выведена
из workspace чистым слоем `report-progression.ts` (`approvedReportLevelNumbers`,
`sessionWithApprovedReports` через канонический `withCompletedLevel`); `ata.lesson-progress.v1` **не**
пишется; следующий уровень открывает существующий резолвер. **Base-completed vs approval-induced**
distinction (DD-300): approved-презентация — не по итоговому `completed`, а по base ≠ completed ∧
approved.

**Adapter** (DD-298): `ReportVerdictAdapter = "revision-requested" | "approved"`, exact-match; работает
только на pending-review под `scenario=report`; при storage failure остаётся pending; повторный
verdict — no-op; ни href/кнопки/автоодобрения.

**UI:** чип «Одобрено», «Отчёт принят. Уровень 3 завершён.», browser-local/provisional пояснение,
ledger read-only, тихий «Комментарий последней проверки», следующий шаг «Уровень 4 · Контрольная
точка / Требуется: Баланс Pocket от $50», primary CTA «Посмотреть Путь» → `/path`. Library/Path
показывают L3 «Завершён» (не «Одобрено»), L4 — контрольная точка (DD-293). Home не тронут (DD-295).

**Гейты:** lint ✓ · typecheck ✓ · vitest 571 → +73 новых (report-workspace-v3, report-progression,
report-experience approved, report-approved component/integration) ✓ · build ✓ · e2e smoke 151 → +18
(`report-approved-smoke.spec.ts`) ✓. **Visual QA** двухпроходная: 10 final кадров
(`design-memory/screenshots/d3-approved/{first-pass,final}/`,
`docs/visual-reviews/D3_D_APPROVED_IMPLEMENTATION.md`); historical evidence не перезаписан.

**Границы:** rejected / mentor thread / identity / avatar / countdown / attachments / section comments
/ rubric / score / audit-history / XP reward / checkpoint page / Pocket CTA / backend — не создавались.
Curriculum fixture, thresholds, XP-правила, Home, lesson video/test, practical (L14/L19), Pocket,
`package.json`/lock, зависимости — не изменялись. **D3-E / D3-F / D4 не начаты.**

**Документы:** `D3_APPROVED_EXPERIENCE.md` (новый); обновлены `D3_REPORT_EXPERIENCE.md`,
`D3_REVISION_EXPERIENCE.md`, `REPORT_STATE_MACHINE.md`, `REPORT_STORAGE.md`, `STATE_MATRIX.md`,
`ROUTE_MAP.md`, `DESIGN_DECISIONS.md` (DD-293…DD-300), `IMPLEMENTATION_PLAN.md`, README.


## D4-A — Tools Scope & Trading Journal Art Direction (завершена)

**D4 впервые открыта.** Первый Tools vertical slice определён: hub `/tools` + первый инструмент
**Trading Journal** (unlock target L10). Зафиксированы честный scope, states, privacy boundary,
no-financial-aggregate rule, минимальный `JournalEntry` и manual per-trade value boundary
(`docs/D4_TOOLS_SCOPE.md`, DD-301…DD-306). Unlock — через существующий progression resolver, без
новой логики; для канонического Артёма (L18) открыты Trading Journal (L10) и Risk Calculator (L15),
дальше — locked previews (Chart Markup Tool L20, Indicator Checklist L25). Risk Calculator в D4-A
не реализуется.

**Manual per-trade value:** результат отдельной сделки может храниться как простое число, но никогда
не является балансом/балансом Pocket, не агрегируется в P/L, не даёт доходность/проценты/прогресс,
не влияет на XP/уровни/checkpoint, не синхронизируется и не импортируется; всегда визуально вторичен
к решению и выводу; отсутствие результата — нормальное состояние записи (DD-303). Обязательная честная
подпись «Записи вводятся вручную и не синхронизируются с брокером.» (DD-306).

**Три структурно разных направления** (`docs/D4_TOOLS_ART_DIRECTION.md`, 19-пунктовый бриф + ASCII на
каждое): **A «Operational Ledger»** (одна лента-нить времени с узлами; форма новой записи в голове
ленты), **B «Trade Debrief Workspace»** (доминирующая рабочая плоскость + подчинённая рейка архива;
неравные колонки), **C «Structured Field Notebook»** (вертикальный Learning Spine с нумерованными
узлами; открытая заметка — триптих ПЛАН → ИСПОЛНЕНИЕ → УРОК). Пространственные системы, signature-
объекты и геометрия навигации/прогресса различны (DD-307).

**Проверки:** реальные Chromium-кадры в точном вьюпорте 1440×900; **ровно 6 PNG**
(`design-memory/screenshots/d4-tools-art-direction/proposals/`, 2 поверхности × 3 направления);
horizontal overflow **0px** во всех шести. Personal visual review: 0 critical, 1 major (default-
подчёркивание на pill-CTA — исправлено до финальных кадров), minor зафиксированы. Fixture (hub-
инструменты, три записи: +18 / −7 / без результата, урок важнее цифры) одинаков во всех направлениях.

**Границы:** production React **не написан**; `src/`, `package.json`, `package-lock.json`, `e2e/` не
изменялись; production-тесты не запускались (production-код не менялся); screenshot-спеки прошлых фаз
не запускались, historical evidence не перезаписан (DD-257). Прототипы линкуют реальные токены/shell/
шрифты, лежат вне `src/`, не пишут `localStorage`, не попадают в navigation / `BUILT_ROUTES`
(`design-memory/proposals/d4-tools/`, DD-260, DD-307). BUILT_ROUTES и production-маршруты не менялись.

**Победитель не выбран — выбор за пользователем. D4-B не начинается без явного выбора направления.**

**Документы:** `D4_TOOLS_SCOPE.md` (новый), `D4_TOOLS_ART_DIRECTION.md` (новый),
`DESIGN_DECISIONS.md` (DD-301…DD-307), этот файл.

---

## D4-B — Tools Hub + Trading Journal (реализовано)

**Первый production Tools vertical slice.** Выбранное направление — **«Structured Operational
Spine»** (гибрид: hub из Direction A «Operational Ledger» + journal из Direction C «Structured Field
Notebook», DD-308). Добавлены production-маршруты `/tools` и `/tools/[toolCode]`; «Инструменты»
включены в `BUILT_ROUTES` (desktop + mobile nav) — теперь реальная ссылка, а не disabled-заглушка.

**Домен и резолвер (DD-309):** bounded tool-модель `TOOL_DEFINITIONS` строится из канонических
curriculum-unlock'ов (`TOOL_UNLOCKS`) — unlock-уровни не дублируются в React; проектор `projectTools`
вычисляет доступ **только** через канонический `levelProgressState` (тот же, что у Главной/Пути/
Уроков). Инструмент открыт, когда его checkpoint-уровень **пройден**. Для Артёма (L18): Trading
Journal — unlocked+available (current, один CTA «Открыть журнал»), Risk Calculator — unlocked но
`coming-soon` («Открыт по прогрессу · инструмент готовится», без CTA), Chart Markup (L20) / Indicator
Checklist (L25) и дальше — locked («Откроется на уровне N»). Никакого ручного сравнения `currentLevel`,
хардкода уровней или URL-query bypass в React.

**Trading Journal (DD-310):** browser-local store `ata.tools.trading-journal.v1` (v1;
`{ version, sequence, entries }`) по модели report-store. Fail-closed parser (unknown version → пусто;
битый root → пусто + `corrupt`; malformed/duplicate/invalid-ISO/unknown-direction/non-finite-result
запись отбрасывается целиком). Реализованы create / read-list / edit (без delete/import/tags/filter/
search/stats/charts); create — explicit, one-per-submit, double-submit guard, canonical reread; edit —
inline, Cancel/Escape без сохранения, `updatedAt` только после landed write; failed write не меняет
in-memory state и показывает честный `storage-error` (draft сохраняется, retry). `manualResult` —
необязательное число отдельной записи, вторичное к уроку, без агрегатов; журнал не пишет в progression/
report-ключи и не влияет на XP/уровни/checkpoint. Полная модель — `docs/TOOLS_STORAGE.md`.

**Композиция:** hub — широкий operational ledger (одна светящаяся нить, узлы подписаны уровнем
открытия; current-строка подсвечена, locked/coming-soon — спокойные строки; не card grid/marketplace).
Journal — нумерованный spine; новая запись в голове потока; триптих **ПЛАН → ИСПОЛНЕНИЕ → УРОК** с
доминирующим уроком; сохранённая запись раскрывается/сворачивается; на mobile триптих становится
вертикальной последовательностью (не таблицей), bottom nav ничего не перекрывает. Обязательная подпись
«Записи вводятся вручную и не синхронизируются с брокером.»

**Тесты:** Vitest **649 / 33 файла** (было 571 / 27; +78, +6 файлов: tool-catalog, tools-projection,
journal-entry, journal-store, tools-hub, trading-journal). Mandatory `npm run test:e2e` — **177 / 10
файлов** (было 164 / 9): добавлен `e2e/tools-smoke.spec.ts` (20 проверок в 13 тестах). Full discovery
— **280 / 22 файла** (было 252 / 20): + tools-smoke (13) + `e2e/tools-screenshots.spec.ts` (15,
artifact-only, не входит в mandatory gate). Обновлены два nav-теста (Инструменты теперь built link). Home/Path/Lessons/report — без
регрессий; Артём остаётся L18.

**Visual QA (двухпроходный):** 14 реальных Chromium-кадров, dimensions точно по именам, в
`design-memory/screenshots/d4-trading-journal/{first-pass,final}/`. Personal review: 0 critical, 2 major
(storage-error кадр показывал validation-ошибку из-за незаполненной даты; locked-кадр показывал Chart
Markup вместо Trading Journal — оба исправлены до final), 2 minor (пустая дата в create-кадре; клиппинг
textarea — исправлены). Отчёт — `docs/visual-reviews/D4_B_TRADING_JOURNAL.md`. Historical screenshots
не перезаписаны.

**Границы:** Risk Calculator и прочие tool internals не реализованы; delete/import/attachments/tags/
filter/search/analytics/totals/charts/broker sync/backend/auth/XP — вне scope. Зависимости и
`package.json`/`package-lock.json` не менялись; новых пакетов нет.

**Документы:** `TOOLS_STORAGE.md` (новый), `visual-reviews/D4_B_TRADING_JOURNAL.md` (новый),
`DESIGN_DECISIONS.md` (DD-308…DD-310), `ROUTE_MAP.md`, `STATE_MATRIX.md`, `IMPLEMENTATION_PLAN.md`,
`D4_TOOLS_SCOPE.md`, `D4_TOOLS_ART_DIRECTION.md`, `README.md`, этот файл.

## D4-C — Risk Calculator (реализовано)

Реализован **второй рабочий инструмент** `tool.risk_calculator` (unlock **L15** через тот же
канонический resolver): для Артёма (L18) открыт, Tools Hub показывает рабочий CTA «Открыть
калькулятор», маршрут `/tools/tool.risk_calculator` открывает калькулятор; ниже L15 — locked без
формы. Утверждённое направление **A+B**: доминирует Price Rail (входы слева · измеренный entry/stop
Price Rail в центре · output-ledger справа); Direction B добавляет только компактную sticky
result-strip на mobile в valid-состоянии. Не ticket/чек/broker order; на mobile нет submit-кнопки.

**Чистая модель (DD-314):** `risk-calculation.ts` (без React/DOM/storage/fetch) — контролируемый
парсинг строк (`inputMode="decimal"`, `.`/`,`, отвергаются знак/экспонента/пробелы/разрядные/
множественные/смешанные разделители/non-finite), дискриминированный `incomplete | invalid | valid`,
per-field валидация, long/short только для valid, fail-closed при overflow; `risk-format.ts` —
детерминированный RU-формат без научной нотации, без `-0`, без валютного символа. **Без persist/fetch/
XP/progression/journal/report write**; refresh сбрасывает все поля; ключа `ata.tools.risk-calculator`
нет. Обязательный дисклеймер всегда виден; направление всегда текстом. Tools Hub CTA стал per-tool
(`ctaLabel`); featured «рабочий инструмент» = highest available (Risk L15 > Journal L10); поведение
самого журнала не менялось.

**Тесты:** Vitest **728 / 35 файлов** (было 661 / 33; +67, +2 файла: `risk-calculation.test.ts`,
`risk-calculator.test.tsx`; существующие tool-catalog/tools-projection/tools-hub-тесты обновлены под
доступность Risk Calculator без потери покрытия). Mandatory `npm run test:e2e` — **193 / 11 файлов**
(было 180 / 10): добавлен `e2e/risk-calculator-smoke.spec.ts` (13 тестов). Full discovery — **311 / 24
файла** (было 283 / 22): + risk-smoke (13) + `e2e/risk-calculator-screenshots.spec.ts` (15,
artifact-only, вне mandatory gate). Home/Path/Lessons/report/Trading Journal — без регрессий; Артём
остаётся L18. lint / typecheck / build — зелёные; `package.json`/`package-lock.json` не менялись.

**Visual QA (двухпроходный):** 15 реальных Chromium-кадров в
`design-memory/screenshots/d4-risk-calculator/{first-pass,final}/`, dimensions точно по именам.
First-pass (5 кадров): 0 critical, 0 major (лишь minor polish — whitespace ledger на desktop, sticky
strip перекрывает rail в покое на mobile, разрешается скроллом и не закрывает input/дисклеймер).
Отчёт — `docs/visual-reviews/D4_C_RISK_CALCULATOR.md`. Historical 315 PNG не перезаписаны/не удалены.

**Границы:** история/persist калькулятора, другие tool internals (Chart Markup L20+), mentor,
practical, backend — вне scope. Зависимостей не добавлено.

**Документы:** `visual-reviews/D4_C_RISK_CALCULATOR.md` (новый), `DESIGN_DECISIONS.md` (DD-314),
`ROUTE_MAP.md`, `STATE_MATRIX.md`, `D4_TOOLS_SCOPE.md`, `IMPLEMENTATION_PLAN.md`, этот файл.
