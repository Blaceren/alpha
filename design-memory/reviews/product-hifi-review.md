# PRODUCT HI-FI — screenshot review

- **Date:** 2026-10-03
- **Owner, after DD-337:** «по наполнению лучше теперь нужен хай фай всего». Asked first: scope —
  «Вся платформа»; direction — «Выбери сам»; PREPROD — «Да, по готовности» (in parts).
- **Art-direction gate:** run internally; the owner delegated the choice. Three structurally different
  systems: A «Светлая витрина» (Public Home's light paper canvas with ink surfaces, sections as
  alternating panels), B «Витрина на тёмном» (one ink canvas, one lit rounded surface per page, floating
  chrome, statements in the display face), C «Пульт» (dense instrument panels and grid lines). **Chosen B**
  — reasons in DD-338.
- **Decision:** DD-338. Academy only; the Backend does not change.
- **Part 1 (this release):** the shell, Home, Path, Lessons, Notifications, Profile and its support part.
  **Part 2:** Tools (the hub and six windows), the lesson page, sign-in and registration, error pages.

## What makes Public Home «hi-fi», and what crossed over

| Public Home | In the product |
|---|---|
| Statements in Source Serif 4 at 50–86px, weight 400, tight tracking | Page titles and the page's statement in the same face (`--hf-display`), 36–64px; never body text, controls or numbers |
| Ink surfaces with a corner light, radius 34px | The page's one surface, radius 24px, the same olive corner light; the shell's ground takes it too |
| Pill controls with an arrow, a 2px lift on hover | The page's action as a Signal pill with the arrow; «Выйти» as Public Home's «Войти» pill |
| A floating, rounded, blurred header | The shell's bar floats 10px in, stays in view; the phone's bottom bar floats above the safe area |
| The luminous green line through the route | The walked route glows in the route's own green; full Signal only on the current point and the action |
| Mono eyebrows, 10px, .17em | Kickers, counts and coordinates as the same eyebrows |
| Light paper sections | **Not crossed over** — the product is dark-only (CLAUDE.md), sessions are long, the lesson stage is ink |
| Scroll-driven scenes | **Not crossed over** — functional pages do not animate their content (manifest §C) |

## Captures (before)

`design-memory/screenshots/product-hifi/before/` — every signed-in page and the two auth pages at 1440 and
390 on the stand, on the released Academy (`8c9abfd`): home, path, lessons, the lesson page, tools and its
six windows (four open, two locked), notifications, profile, support, login, register.

## Findings (part 1)

| # | where | problem | severity | status |
|---|---|---|---|---|
| 1 | every signed-in page | a different product from Public Home: 22–24px Manrope titles, square panels, 8px buttons, a flat bar | critical (the owner's ask) | fixed — the product hi-fi system |
| 2 | Home | the priority read as an app card, not a statement | major | fixed — the statement in the display face on a lit surface, the pill with its arrow |
| 3 | Path, Lessons | the title was a label; the module field a flat tile | major | fixed — display titles, rounded lit surfaces, module names in the display face |
| 4 | Notifications | the page sat against the left edge (x = 34) while its neighbours start at 244 | major | fixed — the product's column, the register on one surface |
| 5 | Path, phone (found in QA) | the strip's edge fades painted a flat patch of the old ground over the lit surface | major | fixed — the strip fades its own content by mask |
| 6 | Path, Profile (found in QA) | frozen roots painted their own ground: a seam where the column ended and the shell's light began | major | fixed — the roots let the shell's ground through |
| 7 | Path, Lessons, Notifications, phone (found in QA) | the last block could end under the fixed bottom bar | major | fixed — the bar's clearance on every layer below 900px |
| 8 | shell (found in QA) | a sticky bar would cover what an in-page link or focus scrolls to | minor | fixed — `scroll-padding-top: 86px` from 900px |
| 9 | Path ribbon (found in QA) | the current segment's halo drew a lit rectangle | minor | fixed — a soft glow only |
| 10 | Home, phone | the greeting and the priority were set too small for the display face | minor | fixed — 38px and 32px |

## Measured, not judged (part 1)

- **Overflow:** none on `/home` (two learners), `/path` (two), `/lessons`, `/notifications`, `/profile`,
  `/profile/support` at 1440, 1024, 768, 390, 360 and 320.
- **Targets:** no link or button under 44px in the page or the bottom bar at any of the six widths.
- **Overlaps:** none between the line's labels, the head's blocks or the passport's parts.
- **The leader** from the current point still meets the frame's edge exactly (0px) at every width.
- **Contrast** (lowest per role): titles 5.1:1 (the profile's mono coordinate), eyebrows 4.8–11.4:1, body
  8.1:1 and up.
- **The lesson stage** still fits the first screen under the floating bar: bar bottom 894 of 900 (1440),
  706 of 768 (1024), 727 of 1024 (768), 570 of 844 (390).
- **E2E:** Home, Profile and support — 25 of 25; the lesson walk on a fresh stand database — 35 of 35.

## Console result

No page errors and no console errors on the captures, the measurements or the two walks.

## Anti-generic score — the system on Home, Path and Lessons (part 1)

Frames: `part1/home-d.png`, `part1/home-m.png`, `part1/path-d.png`, `part1/lessons-d.png`.

| Criterion | Score |
|---|---|
| Connection to ATA DNA: Public Home's own statements, surfaces and pills on Ink; the luminous route made the program's line; Signal only on the current and the action | 18/20 |
| Structural originality: one lit surface per page under a floating bar; the line as the page's horizon | 13/15 |
| Product meaning: every element still a fact from the read; nothing decorative added | 14/15 |
| Typography: a real display/text/mono system — the serif for statements only | 10/10 |
| Signature object: the glowing program line with its leader into the frame | 9/10 |
| Progression clarity: where (the lit route), now (the frame), next (the aside) | 9/10 |
| Mobile transformation: the floating bar, the line at a finer grain, full-width pills | 8/10 |
| Usability / readability: 44px targets, contrast ≥ 4.8, no overflow from 320 | 9/10 |
| **Total** | **90/100** |

Automatic-fail check: ≥ 80 PASS · signature object PASS · not renameable (a program of chapters and
modules, «готовится», a priority hanging from a level) PASS · no sidebar + card grid PASS · three
directions structurally different (sections of paper and ink / one lit surface under floating chrome /
dense panels) PASS · mobile not a stacked desktop PASS · no low-contrast body PASS · no six identical
cards PASS · not one shape everywhere (pill, 24px surface, 16px window, points) PASS · identity not on
icons PASS · two references (01/03 the luminous ascending trace; 04 the line as structure) PASS · no
decorative market elements PASS.

**Verdict: PASS (90).**

## Sign-off (part 1)

Critical and major findings of part 1 fixed. Part 2 — Tools, the lesson page, sign-in and registration,
error pages — follows in the next release. Not checked under a learner on PREPROD: sign-in there is
CAPTCHA-gated.

---

# PART 2 — Tools, the lesson page and its tasks, the material, the workspace, auth, states

- **Released Academy before part 2:** `c85513b` (part 1). Same system, same tokens (`--hf-*`), one new
  layer per surface: `tools-hifi.css`, `reader-hifi.css`, `workspace-hifi.css`, `states-hifi.css`, plus
  additions to `level-hifi.css` and `auth-stage.css`. The Backend does not change.
- **Captures before:** `before/tools-*.png`, `before/tool-*.png`, `before/lesson-l04-*.png`,
  `before/login-*.png`, `before/register-*.png`. **After:** `part2/` (1440, 1024, 768, 390).

## Findings (part 2)

| # | where | problem | severity | status |
|---|---|---|---|---|
| 1 | Tools — the hub and six windows | still the old product: 32px Manrope titles, a square territory, 8px controls | critical (the owner's ask) | fixed — display titles, the lit 24px territory, pills, 12px fields, the way back as Public Home's quiet pill |
| 2 | the lesson page | the title, the test, the report, the practice and the registration in the old geometry: Manrope headings, 8px cards and buttons | major | fixed — the title and every task's name in the display face, each task a lit 16px window, every action a pill, fields and choices at 12px |
| 3 | the workspace, level 9 (pre-existing, found in this pass) | the report kept its panel colour after the adaptation layer took its inset: the heading and the criteria ran into the panel's edges | major | fixed — the report is the page's lit surface (24px), inset 36/40 |
| 4 | the workspace (pre-existing) | «Сделка 1заполнено 0 из 10»: the floated legend lost the head's row | major | fixed — the row restored, the count as a mono eyebrow at the far end |
| 5 | the material, 13 levels, live on PREPROD (pre-existing) | «Чему учит материал» printed the same sentence twice: v5 fills the objective and its extension with one text | major | fixed — the extension is shown only when it adds something (test added) |
| 6 | error and «not found» states | the retired navy and teal of the first prototype | major | fixed — one lit surface, the statement in the display face, Signal and quiet pills |
| 7 | measured, not judged | targets under 44px: «Все инструменты» 40, segmented choices 36, the time toggle 41, reader links 28/35/42, workspace exits 21, «Перейти к следующему уровню» 22, «Ваш отчёт» 24 | major | fixed — 44–48px |
| 8 | the lesson page, 1440 (found in QA) | with the display title the stage's control bar ended at 902 of 900 | major | fixed — the stage fit reserves 430px; the bar ends at 882 |
| 9 | «Уровень завершён» | its quiet 2px Signal edge would bend on a rounded window (the accent-rail cliché) | minor | fixed — the same quiet mark as the kicker's dot; the window settles (no corner light) |
| 10 | sign-in, registration | the frame and the submit in their own radii; the ground without the corner light | minor | fixed — the surface radius, a 52px pill submit, the shell's lit ground |
| 11 | the lesson page | the released tool's «Открыть» a square outline | minor | fixed — a quiet pill |

## Measured, not judged (part 2)

- **Signed-in pages:** the tools hub and all six windows (four open, two locked), the lesson page with
  a test (level 5), the report (level 9, open and accepted), the practice (level 13), the registration
  (level 3), the material, the workspace (the report open, accepted, and a level that needs none), a
  level that does not exist — 16 pages at 1440, 1024, 768, 390, 360 and 320: **96 of 96** with no
  sideways scroll, no link, button or disclosure under 44px (the frozen workspace links reach 44px by
  their own `::after` hit area, counted as such), no overlaps, no page or console errors.
- **Without a session:** `/login`, `/register`, `/forgot-password` and an unknown address at the same six
  widths — no overflow, no small targets.
- **Contrast** (lowest per role): the hub's row descriptions 6.8:1, the state message 8.1:1, the lesson
  facts 8.5:1, eyebrows 11.4:1, titles 16.1:1 and up.
- **The lesson stage** still fits the first screen under the floating bar and the display title: control
  bar bottom 882 of 900 (1440), 706 of 768 (1024), 729 of 1024 (768), 566 of 844 (390).
- **E2E on a fresh stand database:** the lesson walk (a test, the report with its refusal records, the
  tool it releases) 35 of 35; Home, Profile and support 25 of 25; the tools (a choice, the time picker,
  a journal entry, the risk sum, checklist ticks; no console errors) 12 of 12 at 1440 and 390.

## Anti-generic score — part 2 (tools, the lesson page, the workspace)

Frames: `part2/tools-d.png`, `part2/tool-trade-card-d.png`, `part2/lesson-l09-d.png`,
`part2/ws-l09-form-d.png`, `part2/tools-m.png`, `part2/lesson-m.png`.

| Criterion | Score |
|---|---|
| Connection to ATA DNA: Public Home's statements, lit surfaces and pills now on every working page; Signal kept for the one way forward and the current state | 18/20 |
| Structural originality: one lit object per page — the territory, the stage, the task — under the floating bar; inner windows only where a record needs one | 13/15 |
| Product meaning: nothing decorative added; two defects of meaning fixed (the doubled objective, the run-together record head) | 14/15 |
| Typography: the display face names pages, tools and tasks; body, fields, numbers stay Manrope and mono | 10/10 |
| Signature object: the lesson stage and the lit task window; the program line stays on Home and Path | 8/10 |
| Progression clarity: every task ends in one Signal pill; «Уровень завершён» keeps «behind you» and the one way on | 9/10 |
| Mobile transformation: full-width pills, records re-inset for the phone, the stage edge to edge | 8/10 |
| Usability / readability: 44px targets everywhere, no overflow from 320, contrast ≥ 6.8 on the measured roles | 9/10 |
| **Total** | **89/100** |

Automatic-fail check: ≥ 80 PASS · signature object PASS · not renameable (levels, a report of demo trades
with refusals, Pocket registration, tools released by level) PASS · no sidebar + card grid PASS · mobile
not a stacked desktop PASS · no low-contrast body PASS · no six identical cards PASS · not one shape
everywhere (24px surface, 16px window, 12px control, pill) PASS · identity not on icons PASS · two
references (01/03 the lit trace through the program; 04 the line as structure) PASS · no decorative
market elements PASS.

**Verdict: PASS (89).**

## Sign-off (part 2)

Critical and major findings fixed; the whole signed-in platform, sign-in and the error pages now speak
one language. The workspace route has no link in the interface (it opens only by its address); it was
brought along with everything and its future is a separate question for the owner.
