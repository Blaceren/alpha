# D1A-R2 High-Fidelity Review — consolidated Home direction

Applied skills: `/frontend-design`, `/ata-brand-language`, `/ata-art-direction-gate`,
`/ata-visual-qa-loop`, `/ata-anti-generic-ui-review`, `/ui-ux-pro-max` (usability only),
`/webapp-testing` (real render). Real browser screenshots (Playwright, exact viewports,
deviceScaleFactor 1, fonts ready): `design-memory/screenshots/d1a-r2-high-fi/`.
**No winner-of-alternatives — this is the one consolidated direction.** Design-only; React not approved.

## Visual QA loop (two passes)

### Pass 1 — findings (≥8), classified
| # | Screen | Finding | Severity |
|---|--------|---------|----------|
| 1 | checkpoint desktop | Green route line crossed through the Alex quote → readability | **major** |
| 2 | checkpoint desktop | Gate axis mostly hidden behind plane; route→gate connection read weakly | **major** |
| 3 | active desktop | «17» node label close to the route line | minor |
| 4 | checkpoint mobile | «Пройдено 16–20» label overlapped the route | minor |
| 5 | active desktop | Upper-left quadrant fairly empty | minor (cinematic depth — kept) |
| 6 | active mobile | «19·◇20›» top-right slightly crowds the dashed route | minor |
| 7 | checkpoint desktop | Empty top band region above the gate | minor (gate rising into space — kept) |
| 8 | rank study | Lower half empty | minor (documentation page — acceptable) |

Extra checks (all confirmed): card grid did NOT return · screen not too empty (route/plane/gate fill it) ·
route IS the main object · lesson is tied to the node (route enters the plane) · checkpoint is a
structural gate (not a pill) · rank artifact is not a logo (constructed ascending-route) · CTA readable
in <5s · contrast sufficient · mobile is not stacked desktop · no floating pills without a role · no
decorative market data without function.

### Fixes applied (critical + major)
- **#1** Alex moved to the right column (below reward/rank), clear of the route → quote readable.
- **#2** Route reshaped to arrive at an explicit **route→gate junction node** at the bottom of the gate
  axis (no longer hidden behind the plane); gate now reads as the route compressing into a structural gate.
- **#4** «Пройдено 16–20» label moved to the lower-left, off the route.
- Minors #3/#6/#7/#8 deferred/kept intentionally (cinematic depth / documentation page).

### Pass 2 — verification
Re-captured all five. Before/after: on checkpoint desktop the route no longer crosses Alex and the
gate junction is now explicit; Alex quote is fully legible in the right column. **Browser console clean
on all five** (no errors, no pageerror, no failed local asset requests).

## Anti-generic scoring (the consolidated system; applies to both states)

| Criterion (max) | Score |
|-----------------|:-----:|
| ATA visual DNA (20) | 18 |
| Structural originality (15) | 14 |
| Product meaning (15) | 14 |
| Typography (10) | 8 |
| Signature object (10) | 9 |
| Progression clarity (10) | 9 |
| Mobile transformation (10) | 9 |
| Usability/readability (10) | 8 |
| **TOTAL** | **89 / 100** |

### Automatic-fail check (D1A-R2 threshold = 85)
- total < 85 → **PASS** (89).
- обычный sidebar + cards → **PASS** (top command band, no cards-as-layout).
- >4 однотипных cards в первом viewport → **PASS** (1 working plane).
- route вторичен → **PASS** (route is the main object in A; the gate — a compression of the route — is centre in B).
- checkpoint = badge/pill → **PASS** (structural vertical gate the route compresses into).
- rank = generic hexagon → **PASS** (constructed ascending-route artifact; tier = lit segments).
- mobile = stacked desktop → **PASS** (distinct mobile compositions).
- переименовывается в другой SaaS → **PASS** (level→checkpoint→unlock progression, route-built rank).
- низкий контраст основного текста → **PASS** (#eef2f8 primary / #b3bccd secondary on navy).
- буквально копирует прелендинг → **PASS** (principles only; landing-only patterns excluded).

**Verdict: PASS (89, no automatic fail).** Score not inflated — typography/usability capped at 8/10
because this is a design-only high-fi prototype (system fonts, not final type; focus order to be defined
in implementation).

### Objective counts (desktop first viewport)
same-type cards: 1 (working plane) · distinct surface geometries: field + route + plane + gate = 4 ·
icon dependence: ~0% (route/gate/artifact carry identity; only tiny nav glyphs) · branded objects: 2
(route trace + rank artifact) · real hierarchy levels: 5–6 · contrast problems: none · unadapted
landing-only patterns: none.

## UX audit (ui-ux-pro-max — usability only, style advice ignored)
- **CTA visibility:** exactly one primary CTA per state, prominent; on mobile inside the first viewport.
- **Hierarchy:** next step → lesson/checkpoint → route position → rank/progress → Alex → secondary. Clear.
- **Touch:** CTA ≥48px; bottom-nav items ≥52px — meet 44×44.
- **Navigation:** top command band (5) + mobile bottom nav (5); profile via avatar. Clear, non-dominant.
- **Cognitive load:** low; single glow focus; route metaphor intuitive.
- **Contrast:** primary/secondary text high-contrast on navy; not color-only (labels + text).
- **Text size:** body 14–15px, display 30–42px; no tiny primary info; restrained tracking.
- **Focus order:** to be defined at implementation (design-only prototype).
- **Mobile reachability:** primary CTA in thumb zone; bottom nav doesn't cover content.
- **Overflow:** fixed canvases have none; a real 100-node route needs virtualization + no page horizontal scroll (carried forward).

## Materials note
Deep navy field; cold blue structure; restrained cyan/green signal; thin light borders; one meaningful
glow focus (current node in A / gate in B); rare data markers. No grey card wall, no bright SaaS button,
no glow-on-every-element, no glassmorphism-everywhere. Values are **provisional** — not final brand HEX.
