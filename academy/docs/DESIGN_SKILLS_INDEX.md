# DESIGN_SKILLS_INDEX

Индекс дизайн-скиллов Alfa Trade Academy: базовые (general) + project-specific (ATA).
**При конфликте project-specific ATA skills имеют приоритет** над generic-рекомендациями.

Все ATA-скиллы установлены в `/.claude/skills/`. Базовые доступны через плагин `anthropic-skills`
(`anthropic-skills:frontend-design`, `:webapp-testing`, `:skill-creator`) и вендор-копии в
`.claude/skills/`; `ui-ux-pro-max` — в `.claude/skills/ui-ux-pro-max/` (read-only CSV + скрипты).

## Порядок исполнения (mandatory UI workflow)

1. `frontend-design` → 2. `ata-brand-language` → 3. analysis of provisional references
(`REFERENCE_MANIFEST.md`) → 4. `ata-art-direction-gate` → 5. low-fidelity structural proposals →
6. **user approval** → 7. React implementation → 8. `webapp-testing` → 9. `ata-visual-qa-loop` →
10. `ata-anti-generic-ui-review` → 11. `ui-ux-pro-max` heuristic audit → 12. final screenshot report.

Переход от анализа references сразу к React запрещён (шаги 4–6 обязательны).

---

## Базовые скиллы

### frontend-design (general)
- **Purpose:** отличная, нешаблонная визуальная дизайн-мысль (thesis, типографика, signature).
- **Trigger:** старт любой визуальной концепции ATA.
- **Inputs:** бриф, references, brand-language.
- **Outputs:** visual thesis, palette/type/layout идеи, signature.
- **When to use:** шаг 1 — до art-gate.
- **When not to use:** как замена ATA brand rules; как источник финальных HEX.
- **Conflicts:** его общие «AI-default» образы отсекаются `ata-brand-language`.
- **Priority:** general < ATA-specific.

### skill-creator (general)
- **Purpose:** создавать/улучшать/валидировать skills.
- **Trigger:** нужно создать/изменить ATA-скилл.
- **Inputs:** намерение скилла, примеры.
- **Outputs:** SKILL.md, валидация, (опц.) eval-loop.
- **When to use:** авторинг ATA-скиллов.
- **When not to use:** для UI-дизайна.
- **Conflicts:** —. **Priority:** n/a (мета).

### webapp-testing (general)
- **Purpose:** реальное browser-тестирование (Playwright) — скриншоты, консоль, поведение.
- **Trigger:** проверка/скриншот собранного ATA UI.
- **Inputs:** запущенное приложение, viewport.
- **Outputs:** реальные screenshots, console-логи.
- **When to use:** шаг 8; встроен в `ata-visual-qa-loop`.
- **When not to use:** review по коду/synthetic.
- **Conflicts:** —. **Priority:** general (обёрнут ATA QA-loop).

### ui-ux-pro-max (general, read-only)
- **Purpose:** usability / accessibility / responsive / interaction / component-state эвристики.
- **Trigger:** heuristic audit UI.
- **Inputs:** экран/паттерн + read-only CSV-поиск.
- **Outputs:** чек-листы (focus, keyboard, 44px, loading, overflow…).
- **When to use:** шаг 11 — **только** для usability/a11y/responsive/interaction/component-state.
- **When not to use:** как генератор visual style. Игнорировать его generic-советы: fintech dashboard, dark SaaS, blue admin, KPI cards, glassmorphism, card-grid.
- **Conflicts:** его visual-рекомендации проигрывают ATA skills.
- **Priority:** general < ATA-specific (строго).

---

## Project-specific ATA скиллы (приоритетные)

### ata-brand-language
- **Purpose:** визуальный язык ATA из provisional references (essence, narrative, motifs, anti-patterns).
- **Trigger:** любой ATA UI/дизайн/ревью; до art-direction и React.
- **Inputs:** 4 references + `REFERENCE_MANIFEST.md` + `MISSING_BRAND_ASSETS.md`.
- **Outputs:** brand-принципы, motif-кандидаты, запреты.
- **When to use:** шаг 2, и как контекст для gate/review/QA.
- **When not to use:** для финальных HEX/logo (нет assets).
- **Conflicts:** переопределяет generic визуальные советы. **Priority:** высший (визуальный канон).

### ata-art-direction-gate
- **Purpose:** гейт до React — 19-пунктовый бриф + ≥3 структурно разных low-fi композиции.
- **Trigger:** просьба «собрать/начать/redesign» ATA-экран.
- **Inputs:** brand-language, references, product context.
- **Outputs:** брифы направлений + ASCII-вайрфреймы; блок на React до выбора пользователя.
- **When to use:** шаг 4 (обязателен перед кодом).
- **When not to use:** после явного выбора направления (тогда — реализация).
- **Conflicts:** —. **Priority:** высший (процессный гейт).

### ata-anti-generic-ui-review
- **Purpose:** scoring 0–100 + automatic-fail + объективные счётчики; «generic или нет».
- **Trigger:** ревью/оценка/«достаточно ли хорошо/не generic ли».
- **Inputs:** реальные screenshots (из QA-loop), references, D1A anti-examples.
- **Outputs:** score, PASS/FAIL, counts, top fixes.
- **When to use:** шаг 10 (после QA-loop).
- **When not to use:** по коду/synthetic без скриншота.
- **Conflicts:** использует usability-факты ui-ux-pro-max, но игнорирует его visual-советы. **Priority:** высший (gate качества).

### ata-visual-qa-loop
- **Purpose:** обязательный screenshot-QA (реальный браузер, exact viewport, ≥5 findings, fix, before/after, console, scoring).
- **Trigger:** ATA UI собран/изменён; «скриншоть/проверь/QA».
- **Inputs:** запущенное приложение, references, visual thesis.
- **Outputs:** реальные PNG + review markdown + before/after + результат scoring.
- **When to use:** шаг 9 (оборачивает webapp-testing; питает шаг 10).
- **When not to use:** synthetic/HTML-fetch/code-only.
- **Conflicts:** —. **Priority:** высший (QA-процесс).

---

## Правило приоритета
Если generic-скилл (frontend-design/ui-ux-pro-max) советует одно, а ATA-скилл — другое, **выигрывает
ATA-скилл**. `docs/DESIGN_QUALITY_CONSTITUTION.md` — над всеми.
