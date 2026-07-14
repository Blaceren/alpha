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
| D1 | Foundation завершение (все routes, mock provider, полная UI-библиотека) | ◻️ Частично (foundation заложен в D1A) |
| D2 | Главная и Путь | ⛔ Не начата |
| D3 | Урок, тест, report, mentor feedback | ⛔ Не начата |
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
