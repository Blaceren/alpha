# INFORMATION_ARCHITECTURE

Информационная архитектура Alfa Trade Academy Web V2: навигация, sitemap, контекстное открытие разделов, разделение app / public.

Маршруты — `ROUTE_MAP.md` (канонический App Router синтаксис `[param]`). Пользовательская терминология — `CONTENT_AND_TONE.md`.

---

## 1. Верхнеуровневый sitemap

```
Alfa Trade Academy
├── Главная (/)                              — что делать сейчас
├── Путь (/path)                             — горизонтальный путь L1–100
│   └── Уровень (/path/level/[levelCode])
├── Уроки (/lessons)                         — библиотека открытых уроков
│   ├── Урок (/lessons/[levelCode])
│   └── Тест (/lessons/[levelCode]/test)
├── Отчёт (/reports/[reportCode])            — structured отчёт + feedback ментора
├── Инструменты (/tools)                     — 20 инструментов (19 curriculum + Секретный)
│   └── Инструмент (/tools/[toolCode])
├── Сообщество (/community)
│   └── Канал (/community/[channelCode])
│       └── Тред (/community/[channelCode]/[threadId])
├── Новости (/news)                          — in-product feed
│   └── Статья (/news/[slug])
├── Рефералы (/referrals)
├── Ментор (/mentor)
│   └── Диалог (/mentor/[conversationId])
├── Поддержка (/support)                     — Ticket Center
│   ├── Новый тикет (/support/new)
│   └── Тикет (/support/[ticketId])
├── Уведомления (/notifications)
├── Профиль (/profile)
└── Настройки (/settings)
    └── Настройки уведомлений (/settings/notifications)

Публичный SEO-контур (отдельная оболочка, см. §4, §7):
/blog · /blog/[slug] · /blog/category/[categorySlug] · /blog/author/[authorSlug]
```

Полный инвентарь страниц — `PAGE_INVENTORY.md`.

---

## 2. Навигация

### Desktop — сворачиваемый sidebar
Порядок пунктов:
1. Главная
2. Путь
3. Уроки
4. Инструменты
5. Сообщество
6. Новости
7. Реферальная программа
8. Ментор
9. Поддержка
10. Профиль

**Top bar:** текущий ранг · XP · уведомления · профиль (avatar) · contextual page actions.

Sidebar сворачивается в icon rail. Настройки доступны из Профиля / top bar (не отдельным пунктом основного sidebar).

### Mobile — bottom navigation (5)
1. Главная
2. Путь
3. Уроки
4. Инструменты
5. **Ещё**

**Профиль** на mobile доступен одним нажатием через **avatar в mobile top bar** (не входит в bottom nav).

Раздел **«Ещё»** содержит:
- Сообщество
- Новости
- Рефералы
- Ментор
- Поддержка
- Профиль
- Настройки

### Tablet — полноценное responsive-состояние
Не растянутый mobile. Compact sidebar или icon rail; portrait и landscape; touch controls; горизонтальный path; адаптивные two-pane tools.

Глобальный поиск в первой версии отсутствует.

---

## 3. Контекстное открытие (deep context)

При открытии раздела пользователь автоматически попадает в релевантное место:

| Раздел | Точка входа по умолчанию |
|--------|--------------------------|
| Путь | текущий уровень (автоцентрирование) |
| Уроки | активный урок |
| Инструменты | последний редактируемый инструмент (иначе список инструментов) |
| Поддержка | активный тикет (иначе список) |
| Сообщество | последний открытый / релевантный канал |
| Ментор | активный диалог / незакрытый review |
| Новости | вкладка «Подходит к текущему модулю», если релевантно |

---

## 4. Публичный vs in-product контур

- **Новости (in-product)** — `/news`, авторизованный контур: general feed, «Подходит к текущему модулю», bookmark, read later, related lessons, topic filters.
- **Публичный блог (SEO)** — `/blog`, indexable контур: статьи, категории, автор, дата, reading time, related, SEO-метаданные, social preview, PL-локализация позже, без комментариев. Живёт в отдельной оболочке `(public)` (см. §7).

Контуры не смешиваются: публичные статьи — `/blog`, in-product новости — `/news`.

---

## 5. Иерархия доступа (gating)

- **Progression gating:** уровни открываются строго по порядку; контрольную точку нельзя обойти.
- **Tool gating:** инструмент доступен с уровня unlock (`CURRICULUM_AND_UNLOCKS.md`); ранее — locked preview.
- **Community gating:** канал доступен с уровня unlock; ранее — locked preview канала.
- **Секретный инструмент:** по реферальному условию (qualification), **не** по уровню — это не curriculum tool unlock.
- Всегда доступны (авторизованному): Главная, Поддержка, Уведомления, Профиль, Настройки, in-product Новости; публичный блог доступен без входа.

---

## 6. Группировка инструментов (внутри «Инструментов»)

Логические группы для навигации; порядок открытия — по уровню:
- **Журнал и риск:** Trading Journal (L10), Risk Calculator (L15), Capital Plan (L50).
- **График и рынок:** Chart Markup (L20), Indicator Checklist (L25), Market Regime Board (L55), Watchlist (L70).
- **Новости и сессия:** News Calendar (L30), Session Planner (L60).
- **Дисциплина и психология:** Pause Mode (L35), Psychology Check-in (L75), Habit Calendar (L80).
- **Стратегия и анализ:** Strategy Builder (L45), Strategy Statistics (L65), Performance Dashboard (L90), Personal Playbook (L95).
- **Обзоры и кейсы:** Недельный обзор / Weekly Review (L40), Mentor Case Room (L85).
- **Итог:** Pro Workspace (L100).
- **Особый:** Секретный инструмент (referral-gated, вне curriculum).

Это 19 curriculum-инструментов (L10–L100) + Секретный = **20 инструментов** в интерфейсе. Группировка навигационная; unlock-логику из `CURRICULUM_AND_UNLOCKS.md` не меняет.

---

## 7. App / public boundary (оболочки)

- **Авторизованный продукт** — route group `(app)`: единая оболочка с sidebar / top bar / bottom nav / rail. Все `/`, `/path`, `/lessons`, `/tools`, `/community`, `/news`, `/referrals`, `/mentor`, `/support`, `/notifications`, `/profile`, `/settings`.
- **Публичный блог** — route group `(public)` для `/blog`: **отдельная оболочка без authenticated app sidebar**.
- Route groups не входят в URL.
- Прелендинг, login и registration **не создаются** в этом design-прототипе. Для неавторизованного пользователя продукт получает auth state от backend и перенаправляет в отдельный public/prelanding flow; собственная временная login-страница не показывается.
