# Path — each level's branch ends in its own block, which wakes as the pointer nears (DD-353)

Owner, 2026-10-07, on two screenshots of /path at level 15 after DD-352: «линия должна идти не так, она
не должна входить в следующую область (скрин 1) она должна в момент того как водишь и приближаешься к
блоку становиться ярче и начинать свечение обводки постепенно блоки пройденные (скрин 2)».

What it corrects: DD-352 read «линия должна втекать не вниз а в блок» as «into the detail panel below»
and lit the panel's edge. The owner's «блок» is the LEVEL's block — the lit card around the level's
words (screenshot 2) — and the panel is «следующая область», which the line must not enter. Release:
by readiness, as the rest of this task (DD-352). Design: delegated.

## Directions weighed

| | A «Ветка в блок уровня» (chosen) | B «Одна ветка за указателем» | C «Обводка без ветки» |
|---|---|---|---|
| Line | every opened level has its own short branch from its mark into its block's top edge | DD-346's single branch, gliding to the pointed level, now ending in its block | no line: blocks glow on hover |
| Approach | the nearer the pointer, the brighter the branch and the further the outline's light runs both ways | lights only once the pointer is ON a level — nothing to see on the way | the outline wakes, nothing flows into it |
| Why not | — | the owner describes approaching blocks («приближаешься к блоку») and the walked ones too | the owner speaks of the line becoming brighter and flowing in |

## What changed

1. **Nothing reaches the panel.** The frozen leader (current mark → panel) and DD-352's light along the
   panel's edge are removed (markup, controller, styles); the panel is the level's detail, 30px under
   the strip.
2. **Each opened level — walked, or the one in focus — has a branch and a block.** One column grammar
   for every level: the mark 12px into the column; 40px down, the block (as wide as the column less an
   8px gap, radius 14px); the words inside the block, 16px in. The branch runs from the mark's foot
   (23px) down into the block's top edge (40px) at the mark's centre, so it never crosses the words.
   The axis runs from mark centre to mark centre, as before (DD-352's fill and dashes kept).
3. **The block wakes as the pointer nears** (`path-rail.tsx`): over the module's field every opened
   level gets `--near` — 1 inside its block, eased down to 0 at 110px (`nearnessAt`, smoothstep). It
   drives the branch (opacity, glow), the outline (a 1px ring lit from where the branch enters,
   22px in on the top edge, its reach growing with nearness — along the top and down the sides, both
   ways, brightest at the branch), a soft halo, the block's own faint light, and a walked mark's glow.
   While the pointer moves it follows at 140ms; when it leaves the field everything goes out over
   900ms (DD-352's «пропадает постепенно»). Keyboard focus on a level's way in holds that level at 1.
   Touch never wakes it.
4. **At rest** the level in focus keeps its branch (0.7) and its block's light — where the learner is;
   a walked level's appear only as the pointer nears. Walked levels speak in the route's green, the one
   in focus in the Signal.
5. DD-346's «Завершён»/«Начать» under the pointer, closed-level dimming and one dashed closed mark
   (DD-352) are unchanged; a walked level's name still comes up under the pointer.

## Captures (real browser; stand: academy production build + backend dev; synthetic learners)

`design-memory/screenshots/path-block-branch/`: the owner's two (`before-owner-*`); qa-l15 and qa-l04 at
rest at 1440; qa-l04 with the pointer 55px above L02's block (on the way), inside it, 260ms after
leaving; inside at 900; rest at 768, 390, 320; the strip at 3× on the way, inside and 300ms after.

## Findings

| # | Where | Finding | Severity | Status |
|---|---|---|---|---|
| 1 | all | DD-352 sent the line into the panel («следующая область») and lit the panel's edge | critical | fixed (each branch ends in its own block; panel untouched) |
| 2 | approach | the light came on only once the pointer was on a level; the owner wants it to grow on the way | major | fixed (nearness, 110px reach, eased) |
| 3 | walked levels | only the pointed level could carry light | major | fixed (every opened level has its block and branch) |
| 4 | layout | with the branch above the words, DD-352's 28px room beside the line was no longer needed | minor | words inside the block, 16px in |
| 5 | between blocks | in the 8px gap both neighbours are nearly fully lit | minor | accepted: it is what nearness means; one block is lit at a time once the pointer is inside it |

## Measured (scratch `strip/near.cjs`, `nzoom.cjs`)

5 learners × 8 widths (1440–900 pointer, 768–320 touch): **0 problems** — no line reaches the panel;
every branch on its mark's centre (±1px) and ending on its block's top edge (±1px); words at least 8px
inside the block; no word broken; no sideways scroll. Approach (pointer widths): L02 at 0.5 with the
pointer 55px above its block, 1.0 inside; leaving: 0.71–0.74 at 260ms, 0 at 1260ms; the level in focus
keeps its branch (0.7) and light at rest. Console: 0 errors. Tests: academy suite after `git add`.

## Anti-generic score

Connection to ATA DNA 19/20 (the route's light, now from each walked step into its own block) ·
structural originality 13/15 · product meaning 15/15 (only opened levels wake; the level in focus is lit
at rest) · typography 9/10 · signature object 10/10 (the branch and its block) · progression clarity
10/10 · mobile 9/10 (no hover: the level in focus lit, nothing wakes) · usability 9/10 (neighbours share
the light in the gap). **TOTAL 94/100 — PASS**, no auto-fail (blocks are not a card grid: only opened
levels have one, and only the one in focus shows at rest).
