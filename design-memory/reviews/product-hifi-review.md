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
