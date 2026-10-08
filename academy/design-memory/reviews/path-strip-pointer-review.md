# Path strip — one level behind, and a branch that follows the pointer (DD-346)

Owner, 2026-10-06, on a screenshot of /path at level 15: «давай сделаем эту секцию так что бы было
видно не нынешний уровень и следующие 4, а 1 прошедший, на таких там где сейчас написано готовиться
завершен надпись, на актуальном вместо готовиться начать которое ведет на урок / завершен и начать
появляется в момент наведения, так же по наведению двигается палочка наша с подсветкой эта, но на
уровни которые еще не открыты ее завести нельзя и они затемненные».

Answers (2026-10-06): «Начать» on the current level ALWAYS — also on a level that is still being
prepared (recommended «Готовится» without a link; the owner chose otherwise; that level's page says it
is being prepared and has two ways out). Release «по готовности». Design details: delegated
(standing practice, [owner-delegates-design-choice]).

## Directions weighed

| | A «Скольжение» (chosen) | B «Подъём» | C «Магнит» |
|---|---|---|---|
| Branch on hover | the one line glides to the pointed level; the light crossfades with it | no motion: the pointed level's own line fades in, the current one's out | the line stretches from the current level to the pointed one, a band over both |
| Reads as | «наша палочка двигается» — one object, one place | two lines blinking | a selected range (L14–L15 as a pair) |
| Cost | leader `left` transition + per-level light | CSS only | geometry for a band, busy at five levels |

A is the owner's sentence taken literally; B loses the motion they asked for; C says something false
(that two levels are chosen together).

## What changed

1. **Window.** `stripWindow()` — five levels: one behind the level in focus, it, three ahead,
   across module edges; at the ends of the program the five shift inward (L1 → 1–5, L30 → 26–30).
   An edge is a 1×18px upright on the axis (`level-node--edge`); a level of another module than the
   page's says so once: «L14 · МОДУЛЬ 03».
2. **Opened levels hold the branch.** Walked and current levels (`data-open`) carry the light
   (`::after`, lit only on `level-node--pointed`). The level the branch rests on (`level-node--rest`,
   the level in focus) always keeps its words right of the line; walked levels do so only where a
   pointer can bring the line (`@media (hover: hover)`), so on touch the room is not taken.
3. **Pointer.** `path-rail.tsx` `point()`: mouse/pen `pointerover` on an opened level moves the
   branch there (`data-glide` → `left` transition 320ms), over a closed level it stays at rest,
   `pointerleave` of the strip returns it, keyboard `focusin`/`focusout` do the same; touch never
   moves it; reduced motion never glides. A walked level holding it lights its mark in the walked
   green and its name in the primary text colour.
4. **Words under the pointer.** «Завершён» (walked) and «Начать →» (current, a link to the level —
   `level.href`) keep their room while hidden and fade in on `:hover`/`:focus-within`; without hover
   they are always shown (also on phones, where the frozen layer hid the done word). The level's
   state («текущий · на проверке», «готовится») stays for a screen reader in `.level-node__status`.
5. **Closed levels dim** by colour (name 0.5, code/type 0.36, pill border 0.1) — 4.7:1 for names.
6. **Landing.** Where the walked level and the current one fit side by side (600–899 on touch,
   any panning width on a pointer device), the strip opens on both; on a phone the frozen landing
   (current at 42%) stays, the walked level one swipe to the left.
7. **900–1199.** Names are sized by their own column (`container-type: inline-size`, `cqi` clamps):
   at 900 the columns are 105px and «остановиться», «конкретном», «таймфрейм,» broke mid-word —
   already before this change; now ≤3px smaller at 900, unchanged from ~1000px.

## Captures (real browser, stand: academy production build + backend dev, synthetic learners)

`design-memory/screenshots/path-strip-pointer/`: `before-*` / `after-*` for qa-l15 (current level
being prepared — the owner's case), qa-l04 (module's 4th, the window runs into module 02), qa-l10
(module's first, open) at 1440/1024/768/390; hover states (`after-*-hover-L*`), keyboard focus
(`after-qa-l15-1440-keyboard.png`), sheets `sheet-l15-1440.png`, `sheet-l04-1440.png`,
`sheet-touch.png`. Touch sizes are VIEWPORT captures: an element capture taller than the viewport
makes Playwright re-emulate the device and the page becomes a hover device mid-shot (measured: the
action pill faded to 0 inside the capture) — an artefact of the tool, not of the page.

## Findings and fixes

| # | Where | Finding | Severity | Status |
|---|---|---|---|---|
| 1 | all | the strip began at the current level when it was a module's first — nothing behind | major | fixed (window) |
| 2 | hover | a walked level under the line would have had its words crossed | major | fixed (room on opened levels) |
| 3 | 600–899 touch | giving walked levels the room pushed the pair out of the window (496 > 454px) | major | fixed (room only with hover) |
| 4 | 768 | the walked level landed off-screen (42% landing) | major | fixed (pair landing) |
| 5 | 900 | names broke mid-word (pre-existing) | major | fixed (column-sized names) |
| 6 | 390 | «Завершён» hidden by the frozen phone layer | minor | fixed (shown without hover) |
| 7 | keyboard | the hidden «Начать» must show on focus | minor | holds (`:focus-within`), measured |
| 8 | hover | the panel still describes the current level while the line is on a walked one | minor | accepted: the owner asked for the line to move; the panel is the next step, not a preview |

## Measured (scratch `strip/measure.cjs`, 5 learners × 24 widths: 11 pointer 1920–900, 13 touch 899–320)

0 problems: the line stands on the pointed mark's centre (±1.5px) at rest and over every level; over
a closed level it stays on the current one; leaving returns it; pills 0 at rest / 1 under the pointer
(pointer devices), 1 on touch; «Начать» is the element hit at its centre; no word broken across
lines; no sideways page scroll. Glow probe (`glow/sweep.cjs path`): no strip glow cut, no text cut
(only the workspace's ambient shadow at the page bottom, as before). Console: 0 errors.

## Anti-generic score

Connection to ATA DNA 19/20 (the lit route as the object that moves) · structural originality 13/15 ·
product meaning 14/15 (every mark is a real state; the moving line names the level under the
pointer) · typography 9/10 · signature object 10/10 (the branch) · progression clarity 10/10 (behind
/ here / ahead, edges named) · mobile 9/10 (no hover → words shown, line still) · usability 9/10
(the panel does not follow the line, finding 8). **TOTAL 93/100 — PASS**, no auto-fail.
