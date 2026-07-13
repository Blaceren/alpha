# CLAUDE.md — Alfa Trade Academy Web V2

Guidance for Claude Code (and any agent) working in this repository.

## Что это за проект

**Alfa Trade Academy (ATA)** — последовательная образовательная платформа по трейдингу. Пользователь проходит фиксированный путь из **100 уровней / 20 модулей**, смотрит уроки Alex Curie, проходит тесты, выполняет reports и practical-задания, получает mentor review и XP, проходит финансовые checkpoints, открывает инструменты и community-каналы и вручную строит собственную торговую систему.

**Pocket** — торговая платформа (брокер). Пользователь торгует и видит деньги только в Pocket.
**Alfa Trade Academy** — система обучения, progression, planning, analysis, discipline и сопровождения. **ATA не является торговым терминалом и не имитирует его.**

## Текущая фаза: D0 (Documentation & decision lock)

Сейчас в репозитории **только документация**. Это source of truth перед любой реализацией.

### Жёсткие ограничения D0 — НЕ делать

На этом этапе **запрещено**:
- создавать `package.json`;
- создавать `src/`;
- создавать React / Next.js приложение;
- устанавливать зависимости;
- писать UI-код;
- подключать backend, CRM, Prisma / database, Pocket;
- использовать реальные пользовательские данные;
- создавать production API;
- делать deploy;
- начинать визуальную реализацию.

Работать **только** внутри `/Users/mm/Desktop/atadesign`. Не открывать другие папки/проекты.

## Канонические источники

| Файл | Роль |
|------|------|
| `les-prog.txt` | Канонический curriculum (20 модулей, 100 уровней, hooks, checkpoints, tool unlocks). Не переписывать смысл, не менять thresholds. |
| `docs/CURRICULUM_AND_UNLOCKS.md` | Структурированный mapping curriculum → codes, checkpoints, tools, ranks, community. |
| `ATA_PRODUCT_DESIGN_BRIEF_V1.md` | Полный design brief (product, principles, pages, states, phases, acceptance). |
| `docs/DESIGN_DECISIONS.md` | Зафиксированные продуктовые/дизайн-решения (единый ADR-лог). |

## Терминология и правила

- **Название продукта:** только **Alfa Trade Academy**. «TradeQuest» — legacy, встречается лишь в `les-prog.txt`, в пользовательских текстах запрещено.
- **Язык:** интерфейс сначала на русском, позднее польская локализация. RTL не нужен. Компоненты сразу проектируются под более длинные польские строки.
- **Тема:** dark-only. Тёмные поверхности, холодные акценты, controlled glow, premium lighting.
- **Финансовая приватность (критично):** ATA **никогда** не показывает баланс/депозиты/выводы пользователя. Показывается только цель checkpoint («Для открытия следующего модуля требуется баланс Pocket от $300»). Не рассчитывать «осталось $X». Checkpoint CTA **не** открывает Pocket.
- **Главное UX-правило:** в каждый момент существует **один очевидный следующий шаг**.

## Два визуальных режима

- **Emotional / premium** — Главная, Путь, rank-up, checkpoint/module/tool/community completion, referral reward, level 100. Controlled glow, depth, короткие cinematic transitions (2–4 c, skippable).
- **Functional** — уроки, тесты, reports, tools, community, news, support, mentor, profile, settings. Читаемость, скорость, спокойные поверхности, минимум фонового движения.

Не переносить scroll-driven сцены прелендинга во все страницы продукта.

## Provisional токены

Точная палитра и шрифты прелендинга пока неизвестны. Использовать **provisional semantic tokens** (см. `docs/DESIGN_SYSTEM.md`) — они будут заменены значениями из прелендинга. Не придумывать окончательную палитру. Финальные visual tokens остаются provisional до получения assets.

Provisional шрифты: Manrope Variable (заголовки/ranks), Inter Variable (UI/тексты), JetBrains Mono Variable (формулы/значения). Все open-source, Cyrillic+Latin, готовы к Polish. Body ≥ 16px на mobile, без ultra-light, usable при zoom 200%.

## Screenshot QA (для будущих UI-фаз)

UI **нельзя** считать готовым без реальных browser screenshots приложения. Для каждой UI-фазы: запустить app → сделать настоящие screenshots (1440×900, 1024×768, 390×844) → визуально проверить → review markdown → исправить → финальные screenshots → завершить. Synthetic reconstruction / HTML inspection / нарисованная картинка **не считаются** screenshot. Хранить в `design-memory/screenshots/<phase>/` и `design-memory/reviews/<phase>-review.md`.

## Структура репозитория

```
atadesign/
├── CLAUDE.md                          # этот файл
├── les-prog.txt                       # канонический curriculum (не менять)
├── ATA_PRODUCT_DESIGN_BRIEF_V1.md     # главный design brief
├── docs/                              # source-of-truth документация
│   ├── PRODUCT_CONTEXT.md
│   ├── INFORMATION_ARCHITECTURE.md
│   ├── DESIGN_SYSTEM.md
│   ├── PAGE_INVENTORY.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── DESIGN_DECISIONS.md
│   ├── IMPLEMENTATION_STATUS.md
│   ├── CURRICULUM_AND_UNLOCKS.md
│   ├── USER_FLOWS.md
│   ├── COMPONENT_INVENTORY.md
│   ├── RESEARCH_SYNTHESIS.md
│   ├── ROUTE_MAP.md
│   ├── STATE_MATRIX.md
│   ├── MOTION_AND_PERFORMANCE.md
│   ├── CONTENT_AND_TONE.md
│   └── SCREENSHOT_QA_PROTOCOL.md
└── design-memory/
    ├── screenshots/                   # реальные screenshots по фазам (позже)
    ├── reviews/                       # review markdown по фазам (позже)
    └── references/                    # референсы, прелендинг-ассеты (позже)
```

## Порядок реализации (обзор)

D0 (текущая) → D1 foundation → D2 Главная+Путь → D3 Урок/Тест/Report/Mentor → D4 Tools L10–L30 → D5 Tools L35–L60 → D6 Tools L65–L100 → D7 Community/News/Referral → D8 Mentor/Support/Notifications/Profile/Settings → D9 Responsive/motion/a11y/perf/visual QA. Детали — `docs/IMPLEMENTATION_PLAN.md`. **Не начинать D1 без явного запроса.**

## Обязательный workflow любого будущего UI

D1A (generic dashboard) отклонён (`docs/ART_DIRECTION_RESET.md`). Для любого нового/переработанного
UI Alfa Trade Academy соблюдать порядок (детали — `docs/DESIGN_SKILLS_INDEX.md`,
`docs/DESIGN_QUALITY_CONSTITUTION.md`):

1. `frontend-design`
2. `ata-brand-language`
3. анализ provisional references (`design-memory/references/ata-brand/REFERENCE_MANIFEST.md`)
4. `ata-art-direction-gate` (19-пунктовый бриф + ≥3 структурно разных low-fi композиции)
5. low-fidelity structural proposals (ASCII-вайрфреймы)
6. **явный выбор пользователя**
7. React implementation
8. `webapp-testing`
9. `ata-visual-qa-loop`
10. `ata-anti-generic-ui-review`
11. `ui-ux-pro-max` heuristic audit (только usability/a11y/responsive/interaction/component-state)
12. final screenshot report

**Запрещено** переходить от анализа references сразу к React (шаги 4–6 обязательны). Project-specific
ATA skills имеют приоритет над generic-рекомендациями. References — provisional; финальные HEX/logo/
роль Alex Curie не фиксируются без assets (`design-memory/references/ata-brand/MISSING_BRAND_ASSETS.md`).
