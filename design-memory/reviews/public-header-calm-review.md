# Public Home, the header while the page scrolls (DD-357)

Owner, 2026-10-07, on two iPhone screenshots of PREPROD's Public Home (the top, and a little scrolled):
«шапка слишком резко меняется и привлекает внимание после, выделяется, сделай более органично и менее
привлекающей». Release: by readiness. Design: delegated.

## What it did

At 32px of scroll the header switched state at once: the pill got denser and darker (66 → 56px on a
desktop, alpha 0.91 → 0.96, a different shadow), and on a phone or a tablet it jumped from 8px to the top
edge inside a solid band of the page's LIGHT ground (`--mist-200`) — over the dark hero a pale stripe
appeared around the bar. That band was the responsive pass's own answer (2026-10-03) to text peeking around
the floating pill.

## Directions weighed

| | A «Матовое стекло» (chosen) | B «Плавная полоса» | C «Без подложки» |
|---|---|---|---|
| Behind the pill once scrolled | what passes is softly blurred, no colour of its own, fading at its lower edge | the same light band, faded in over the scroll | nothing: the page scrolls visibly around the pill |
| Why not | — | a light stripe over dark sections still stands out | text cut by the pill's edges reads as a fault, which is why the band existed |

## What changed

- The pill keeps its place and its size at every scroll, on every width (measured: 13,8 · 364×60 at 390;
  80,14 · 1280×66 at 1440, from 0 to 1 369px of scroll).
- Behind it, `.site-header::before`: a band from the viewport's top to just under the pill, `backdrop-filter:
  blur(14px)`, no fill, masked to fade at its lower edge; its opacity is `--ph-shade`, which the page's
  controller sets from the scroll over the first 80px (0 → 0.25 → 0.5 → 1), written once per frame. Over a
  dark section it is dark, over the Signal section it is lime — it takes the page's colour.
- The `.is-compact` rules are gone (the class toggle stays, as the frozen page's behaviour).

## Measured / captured

`design-memory/screenshots/public-header-calm/`: the owner's two; at 390 — y 0, 40, 400 and over the Signal
section; at 1440 — y 400. Tests: the shade follows the scroll (0.25 at 20px, 0.75 at 60px, 1 past 80px, 0
back at the top); no `.is-compact` rule; the band has no fill.
