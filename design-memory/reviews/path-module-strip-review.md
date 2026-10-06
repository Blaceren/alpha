# Path — the strip is the module; the branch flows into the panel (DD-352)

Owner, 2026-10-06, on three screenshots of /path at level 15: «в этом разделе делаем видимый прогресс
по модулям и каждое заполнение один модуль расписанный в этих блоках, общее кол-во модулей видно тоже
небольшое оно, линия должна втекать не вниз а в блок и расходиться по нему в обе стороны на моменте
наведения, в момент убора курсора свечение пропадает постепенно (1 скрин) нужно убрать серую палку
(2 скрин) эти фигурки должны быть одинаковыми (3 скрин)».

Answers (2026-10-06): the strip — «Лента = один модуль» (only the module's levels; its line fills as
the module progresses; a small scale of every module beside it, the walked ones full, the current one
partly; the walked level of the previous module is no longer on the strip — said in the option);
release «по готовности». Design details: delegated (standing practice).

## Directions weighed

The strip and the scale:

| | A «Лента = модуль» (chosen) | B «Две ленты» | C «Шкала в оси» |
|---|---|---|---|
| Strip | the module's levels only | the module's levels | the module's levels |
| Modules | a small scale in the module's head; the page-wide ribbon goes | the page-wide ribbon stays, thinner | the count drawn at the axis's ends |
| Why not | — | the program's progress twice on one screen, the owner asked for it small | the axis would carry two scales; the line must mean one thing |

The branch meeting the panel:

| | A «Втекает в кромку» (chosen) | B «Разлив внутри» | C «Обнимает панель» |
|---|---|---|---|
| Rest | the line runs into the panel's border and spills a little along it | as A | as A |
| Hover | the border lights from that point both ways and down the sides, thinning with distance | a wash of light inside the panel from the top | the whole border lights at once, all round |
| Why not | — | light over the text lowers its contrast; a glow on a card | no «from where» — the line's identity is lost; too loud for a working surface |

## What changed

1. **The strip is the module.** `focusModule.levels` (DD-346's `stripWindow`, its edge upright
   `level-node--edge` and its «· модуль NN» are removed). The line fills: each level draws the way
   from its mark to the next one — walked in the route's green up to the level in focus, then one even
   dashed promise to the module's end (the frozen strip drew the stretch after the current level solid
   and restarted its dashes at every level; the dashes are now rounded to fit each stretch). The line
   ends at the module's last level; the next module starts a new, empty strip.
2. **The scale of modules** (`nav.mod-nav`, its markup and hooks kept) moved from the page's width into
   the module's head, top right: «Модуль 4 из 6» and one 28×4px bar per module — walked in the route's
   green, the module in focus a lit 6px track filled by its walked levels (`--seg-fill` from
   `moduleFill()`: the module's own counters, 0–100), the rest faint; a wider gap where a chapter ends.
   For a screen reader each bar says its module and state, the current one «пройдено N из M уровней».
   Below 900px the scale takes the head's first row and its bars give way before its words.
   The kicker keeps the chapter and «уровни 15–19»; the module's number is the scale's to say.
3. **One closed mark** (owner: «эти фигурки должны быть одинаковыми»): every level that is not open —
   the next one and those after it — is a 2px dashed ring at 0.3 on the surface (the next level was a
   solid ring, the rest dashed).
4. **The branch flows into the panel** (owner: «втекать не вниз а в блок»): no joint dot; the line runs
   through the border and the border itself carries the light — two rings over the panel's own 1px
   border (`.focus__flow`), so neither can leave its shape:
   - at rest (`::after`) a short spill along the edge both ways from where the branch lands;
   - lit (`::before`, `data-lit`) the light runs out from that point along the edge both ways and down
     the sides, brightest at the branch, thinning with distance (`--flow-reach` 0 → 110%, 900ms);
   - on leave it lingers and fades evenly (`--flow-fade` 900ms, `cubic-bezier(0.4, 0, 0.6, 1)`:
     0.83 at 260ms, 0 by 1160ms), then gathers back; the walked mark's glow and the column light under
     the pointed level go out the same way;
   - it glides with the branch (`--flow-x`, registered, transitioned with `data-glide`); a hidden
     branch darkens it; reduced motion: on and off at once, no glide.
   The rail controller (`path-rail.tsx`) sets `data-lit` while an opened level holds the pointer or the
   keyboard, or the pointer rests on the panel; touch never lights it; a closed level puts it out.
5. **One column grammar** (finding 1): every level's mark at its column's left edge, the line through
   the mark's centre, the words 28px in; columns share the strip evenly and none is narrower than its
   longest word (`min-width: min-content`); where the words cannot all fit (a six-level module at
   900px) the strip pans — with its edge fades and hidden words of a cut level, now at every width —
   instead of breaking a word. DD-346's per-state room (52px beside the line on opened levels, 248px
   panning columns on hover devices) and the 900–1199 column-sized names are gone with it.

## Captures (real browser; stand: academy production build + backend dev; synthetic learners)

`design-memory/screenshots/path-module-strip/`: the owner's three (`before-owner-*`); `before-qa-l15-1440`,
`before-qa-l04-1440`; after: qa-l15 (module 4, its first level being prepared — the owner's case) and
qa-l04 (module 1, three walked) at 1440, hover on a walked level and on the current one, on the panel,
the fade at 260ms; qa-l09 (a module of four); qa-l04 at 900; qa-l15 at 768 and 320; qa-l04 at 390; the
junction at 3× at rest, lit and fading, and at the panel's corner; round 1's spill past the corner
(`round1-*`); a simulated six-level module (module 6's titles) at 1440 and 900 (pans).

## Findings and fixes

| # | Where | Finding | Severity | Status |
|---|---|---|---|---|
| 1 | 1440/1280/900 | with the whole module on the strip up to five levels are open, each took 52px beside the line, and words broke: «остановиться», «Регистрация», «таймфрейм» | major | fixed (one column grammar, min-content columns, pan as the fallback) |
| 2 | six-level module | module 6 («Экономический» 136px at 17px) cannot fit six equal columns at any desktop width | major | fixed (columns never below the longest word; fits from 960px, pans at 900) |
| 3 | junction, L15 at the left | the rest spill (a 72px line on the leader) ran past the panel's rounded corner | major | fixed (the spill is part of the border ring) |
| 4 | hover | the lit border looked evenly green — no «from where» | major | fixed (brightest at the branch, thinning with distance) |
| 5 | leave | an ease-out fade lost 80% in the first quarter — not «постепенно» | major | fixed (900ms ease-in-out) |
| 6 | resize | a level marked cut while the strip panned kept its hidden words after the window grew | minor | fixed (the controller clears it when nothing pans) |
| 7 | 768 | the header's «готовится» wraps alone | minor | pre-existing, out of scope |

## Measured (scratch `strip/pm.cjs`, `six.cjs`, `zoom.cjs`, `reduced.cjs`)

5 learners (qa-l15, l04, l09, l10, l14) × 8 widths (1440–900 pointer, 768–320 touch): **0 problems** —
the strip is the module's levels, no edge mark, one closed mark, the scale in the module's head and
inside it, the branch ending on the panel's edge (±1px), no word broken, no sideways scroll. Hover
(pointer widths): lit 1.0 after 1.1s; leave 0.83 at 260ms, 0 at 1160ms; a closed level puts it out; the
panel lights it. Six-level simulation: no word broken at 1440–390; fits without panning from 960px.
Reduced motion: lit/unlit at once, no glide. Console: 0 errors.

## Anti-generic score

Connection to ATA DNA 19/20 (the route's light now flows from the strip into the decision) · structural
originality 13/15 · product meaning 15/15 (the strip is exactly a module; the scale is the program; every
mark a real state) · typography 9/10 · signature object 10/10 (the branch and its light) · progression
clarity 10/10 (module N of M, its share, where in it) · mobile 9/10 (no hover: the spill only, the scale
first) · usability 9/10 (a six-level module pans at 900px). **TOTAL 94/100 — PASS**, no auto-fail.
