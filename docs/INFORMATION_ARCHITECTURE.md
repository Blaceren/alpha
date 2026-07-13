# INFORMATION_ARCHITECTURE

Информационная архитектура Alfa Trade Academy Web V2: навигация, sitemap, контекстное открытие разделов.

---

## 1. Верхнеуровневый sitemap

```
Alfa Trade Academy
├── Главная (/)                         — что делать сейчас
├── Путь (/path)                        — горизонтальный путь L1–100
│   └── Level detail (/path/level/:code)
├── Уроки (/lessons)                    — библиотека открытых уроков
│   ├── Урок (/lessons/:code)
│   └── Тест (/lessons/:code/test)
├── Report (/reports/:code)             — structured report + mentor feedback
├── Инструменты (/tools)                — Tools Hub
│   └── Tool (/tools/:toolCode)         — 20 инструментов + secret
├── Community (/community)
│   └── Channel (/community/:channelCode)
├── Новости (/news)                     — in-product feed
│   └── (публичный SEO-контур отдельно, см. §4)
├── Реферальная программа (/referral)
├── Mentor (/mentor)
├── Support (/support)                  — Ticket Center
│   └── Ticket (/support/:ticketId)
├── Notifications (/notifications)
├── Профиль (/profile)
└── Настройки (/settings)
```

Полные маршруты и параметры — `ROUTE_MAP.md`. Инвентарь страниц — `PAGE_INVENTORY.md`.

---

## 2. Навигация

### Desktop — сворачиваемый sidebar
Порядок пунктов:
1. Главная
2. Путь
3. Уроки
4. Инструменты
5. Community
6. Новости
7. Реферальная программа
8. Mentor
9. Support
10. Профиль

**Top bar:** текущий rank · XP · notifications · profile · contextual page actions.

Sidebar сворачивается в icon rail. Настройки доступны из Профиля/top bar (не отдельным пунктом основного sidebar).

### Mobile — bottom navigation (5)
1. Главная
2. Путь
3. Уроки
4. Инструменты
5. Профиль

**Доп. меню** (из «Ещё»/Профиля): Community, Новости, Рефералы, Mentor, Support, Настройки.

### Tablet — полноценное responsive-состояние
Не растянутый mobile. Compact sidebar или icon rail; portrait и landscape; touch controls; горизонтальный path; адаптивные two-pane tools.

Глобальный поиск в первой версии отсутствует (DD-013).

---

## 3. Контекстное открытие (deep context)

При открытии раздела пользователь автоматически попадает в релевантное место (DD-012):

| Раздел | Точка входа по умолчанию |
|--------|--------------------------|
| Путь | текущий уровень (автоцентрирование) |
| Уроки | активный урок |
| Инструменты | последний редактируемый инструмент (иначе Tools Hub) |
| Support | активный ticket (иначе список) |
| Community | последний открытый / релевантный канал |
| Mentor | активный тред / незакрытый review |
| News | вкладка «Подходит к текущему модулю», если релевантно |

---

## 4. Публичный vs in-product контур

- **In-product News** (`/news`) — авторизованный контур: general feed, «Подходит к текущему модулю», bookmark, read later, related lessons, topic filters.
- **Публичный SEO News** — отдельный indexable контур (статьи, категории, автор, дата, reading time, related, SEO-метаданные, social preview, PL-локализация позже, без комментариев). Маршруты — `ROUTE_MAP.md` (public segment). Не смешивается с авторизованной оболочкой приложения.

---

## 5. Иерархия доступа (gating)

- **Progression gating:** уровни открываются строго по порядку; checkpoint нельзя обойти (DD-030).
- **Tool gating:** инструмент доступен с уровня unlock (`CURRICULUM_AND_UNLOCKS.md`); ранее — locked preview.
- **Community gating:** канал доступен с уровня unlock; ранее — locked channel preview.
- **Secret Tool gating:** по реферальному условию, не по уровню.
- Всегда доступны (после регистрации): Главная, Support, Notifications, Профиль, Настройки, публичные News.

---

## 6. Группировка инструментов в Tools Hub

Логические группы (для навигации внутри Hub; порядок открытия — по уровню):
- **Журнал и риск:** Trading Journal (L10), Risk Calculator (L15), Capital Plan (L50).
- **График и рынок:** Chart Markup (L20), Indicator Checklist (L25), Market Regime Board (L55), Watchlist (L70).
- **Новости и сессия:** News Calendar (L30), Session Planner (L60).
- **Дисциплина и психология:** Pause Mode (L35), Psychology Check-in (L75), Habit Calendar (L80).
- **Стратегия и анализ:** Strategy Builder (L45), Strategy Statistics (L65), Performance Dashboard (L90), Personal Playbook (L95).
- **Обзоры и кейсы:** Weekly Review (L40), Mentor Case Room (L85).
- **Итог:** Pro Workspace (L100).
- **Особый:** Секретный инструмент (referral).

Группировка — навигационная; она не меняет unlock-логику из `CURRICULUM_AND_UNLOCKS.md`.
