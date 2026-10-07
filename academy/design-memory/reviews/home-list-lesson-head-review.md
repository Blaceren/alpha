# Home list and the lesson header (DD-348)

Owner, 2026-10-06, on two screenshots:

1. Home's module list — «в этом разделе мы показываем 3 уровня которые пройдены ранее, 1 актуальный и
   1 следующий, вместо готовиться кнопки открытия урока и подсветка по мере завершения».
2. The lesson page — «нужно сделать выделение для название урока и отдельное выделение области [фактов]
   что бы она тоже немного отделялась от области с названием и сделать подсвечивание +xp».

Answers (2026-10-06): the next level is dimmed, without a button; release «по готовности». Design:
delegated (standing practice).

## Directions weighed

**Home list**

| | A «Линия с кнопками» (chosen) | B «Карточки уровней» | C «Лента как на Пути» |
|---|---|---|---|
| Form | the existing spine list; a button at the row's end | a card per level, each with a button | DD-346's horizontal strip on Home |
| Progress | the spine lit through walked rows | per-card ticks | the walked line |
| Why not | — | five identical cards: the card wall the brand rules forbid | repeats Path one click away; Home's list is vertical by design (DD-337) |

**Lesson header**

| | A «Табличка и строка» (chosen) | B «Рамка» | C «Полоса сцены» |
|---|---|---|---|
| Title | on a raised plate with the corner light | inside the Decision Frame's viewfinder corners | on a full-bleed band of light |
| Facts | their own rail, 10px under the plate | a ruled ledger line | inside the same band |
| Why not | — | the corners belong to the Decision Frame (DD-344 hid them on Path) | one area, where the owner asked for two |

## What changed

**Home list** (`home-overview.tsx`, `home-overview-model.ts`, `home-hifi.css`)

- `homeListRows()`: five rows — three walked levels behind the level the learner stands on, that
  level, the next — across module edges; at the ends of the program the five shift. The level the
  learner stands on is the current one, or with every open level done the first not done (Path's
  «Дальше»).
- Walked row: the whole row opens its lesson, «Открыть урок» at its end. The learner's row: «Начать →»
  (Signal), also while the level is being prepared — via `ProgramPoint.pageHref`, the page says it is
  prepared and has two ways out (verified). Next/further: dim (name 0.5, code/kind 0.36), no link, a
  quiet word: «откроется следующим», «готовится», «впереди».
- The spine stays lit through walked rows (the walked green, not Signal); the learner's row keeps its
  light; a level being prepared is drawn as Path's waiting mark (ring + point).
- A row of another module than the block's is named once («Урок · модуль 3»); a hairline marks the edge.
- Phone: the button goes under the row's words.

**Lesson header** (`level-detail-screen.tsx`, `level-hifi.css`)

- `.ld-plate`: coordinate and title on a raised surface (`--hf-surface-raised`, the corner light, 24px
  radius), as wide as the stage but never narrower than 880px (a narrow stage would wrap the title more).
- The facts rail: its own pill on the ground surface, 10px under the plate.
- `+N XP` — the one lit chip (`.ld-fact--xp`: Signal text, border, faint fill, soft glow); the other
  facts stay quiet. This reverses DD-336's «never lit» on the owner's word; the guard in
  `completion-truth.test.tsx` now holds both halves.
- The first screen: `--ld-stage-fit` budget 430 → 490px and height-aware plate padding. At 1920×1080,
  1600×900, 1536×864, 1440×900 the title, the picture and its bar fit (bar bottom 838–885 of 864–900).
  On 768–800px-tall screens the stage is at its 640px minimum and the bar ends 5–48px below the fold
  (1366×768 was already over before); 1024×768 fits for a one-line title.

## Captures (stand: production build, synthetic learners)

`design-memory/screenshots/home-list-lesson-head/`: `before-owner-*` (the owner's screenshots),
`after-home-*` (qa-l15 — the owner's case, qa-l10, qa-l14, qa-l04; 1440/1024/768/390; hover),
`after-lesson-*` (L1 at 1920/1440/768/390, L4 at 1024, L15 being prepared).

## Findings and fixes

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Home list started at the module's first level: nothing walked in view, «готовится» on every row | major | fixed (window, buttons) |
| 2 | the plate as wide as a short screen's narrowed stage wrapped L1's title to three lines | major | fixed (≥ 880px) |
| 3 | with the plate the player bar left the first screen at 1440×900 (+56–64px) | major | fixed (budget 490, tighter plate) |
| 4 | still 5–48px below the fold at 768–800px heights (stage at its minimum) | minor | accepted, as before at 1366×768 |
| 5 | «Начать» on a level being prepared must land on its page | major | verified: 200, the page with «Готовится» and two ways out |
| 6 | XP chip's separator dot sat inside the chip | minor | fixed (the chip is its own separator) |

## Measured

Home list (scratch `strip/homemeasure.cjs`): 4 learners × 14 widths (1920–320) — no sideways scroll,
every button inside its row and hit at its centre, closed rows without a link, no broken word: 0
problems. Glow probe on Home and lessons: nothing new (the known ambient panel shadows at the edge).
Console: 0 errors.

## Anti-generic score

DNA 18/20 · structure 13/15 · meaning 14/15 · type 9/10 · signature object 9/10 (the lit spine; the
plate as the lesson's title card) · progression 10/10 · mobile 9/10 · usability 9/10 (finding 4).
**TOTAL 91/100 — PASS.**
