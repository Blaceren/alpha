# Public Home: one sheet over another (DD-360), 2026-10-07

Owner: «Теперь на внешней главной нужно избавиться от эффекта блоков на белом фоне, возможно заменить на наш
салатовый, вообщем нужен финальный хай фай в этой области» (with a swatch of the Signal green). Asked once:
«Сплошная страница» chosen over green gaps and dark gaps; release by readiness.

## What was wrong

Every section was a rounded block (`.surface`: margin 10px, radius 34px; on a phone 5px and 22px) and the page's
ground was `--mist-200` (#e9ebe5): the near-white showed between every two blocks and in their corners — a dark
showcase cut into tiles on white. The FAQ and the first step were one near-white «paper» block near the end.

## Three directions weighed

1. **«Листы» — one sheet over another (chosen).** Ground Ink; sections edge to edge; each lays over the one
   before it with a rounded top lip (the page's own radius). The lip is seen where the colour changes and
   invisible where it does not. Keeps the product's soft geometry, removes the tiles.
2. **«Зазоры салатовые».** Blocks stay, the ground becomes Signal: a neon frame around every block. Branded,
   but still blocks, and loud around the hero.
3. **«Зазоры тёмные».** Ground Ink, blocks stay: the dark ones merge, the green and light ones remain rounded
   blocks on dark — the «Витрина на тёмном» look, but the end of the page still a white block.

The owner's own words put the white first («избавиться от эффекта блоков на белом фоне») and the green as a
maybe; direction 1 removes the effect itself rather than recolouring it.

## What changed

- `.ph[data-ph-root]`: ground Ink, `--sheet-lip: var(--radius-xl)` (22px ≤680). Every `.surface` has margin 0,
  no radius and a transparent bottom border as deep as the lip (its own background paints it); every following
  surface and the footer rise by the lip and round their top corners. No content is ever covered; the corners
  reveal the sheet below. `html.ph-smooth-scroll` is Ink too (the literal — the tokens live on `.ph`).
- Scoped to the Public Home root: the news pages share this stylesheet and are paper on purpose; `.ph .surface`
  keeps its margin for them.
- FAQ: `surface--ink`; hairlines `--line-dark`, the «+» and the answers in the dark surface's text.
- First step: its own `section#first-step.surface--signal` (the owner's green), `padding: var(--section-pad) 0`;
  the `.final-step` lost its hairline and offsets; support text and «Уже учитесь? Войти» in Ink on Signal. The
  `#start` alias moved with it. The architecture test now names eleven sections.

## Measured (stand, production build, 320/390/768/1440)

Ground rgb(11,13,10) at the root and the document; every seam an overlap of exactly the lip (34px; 22px on
390 and 320), sheets 0–width, no horizontal overflow; no light pixel anywhere between sections. FAQ on Ink:
question and answer rgb(243,244,239), hairline rgba(243,244,239,.12); the first step rgb(199,247,109) with the
dark button and Ink text. Tests 3333/3333, lint, types.

Captures: `design-memory/screenshots/public-home-sheets/` (before: the white seams and the paper FAQ; after:
the seams at every colour change, the open FAQ, the end of the page on a phone and a computer).
