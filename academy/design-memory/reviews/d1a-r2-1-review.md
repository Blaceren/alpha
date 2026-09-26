# D1A-R2.1 Review — Route Field visual correction

Applied skills: `/frontend-design`, `/ata-brand-language`, `/ata-art-direction-gate`,
`/ata-visual-qa-loop`, `/ata-anti-generic-ui-review`, `/ui-ux-pro-max` (usability only),
`/webapp-testing` (real render). Real browser screenshots (Playwright, exact viewports, dSF 1,
fonts ready). **First-pass** preserved: `design-memory/screenshots/d1a-r2-1/first-pass/`. **Final**:
`design-memory/screenshots/d1a-r2-1/`. Route Field remains the approved base; React not approved.

## R2 → R2.1: what changed (concrete visual proof, not «стало премиальнее»)

| R2 problem | R2.1 change | Visual evidence | Screenshot |
|-----------|-------------|-----------------|-----------|
| Central rounded card was the interface | Lesson = **open field carved from the node** (top+left edges only, open bottom-right) | No full-perimeter card; field top edge is the route L-bracket at the node | home-active-desktop.png |
| Route lived behind the card | Route **spans the canvas** as the dominant diagonal and forms the field's top edge | Bold trace lower-left → node → checkpoint boundary; field hangs off it | home-active-desktop.png |
| Too much dead whitespace | Filled with **functional route elements**: markers 15–19, module boundary+label, completed path, instrumentation, Alex, checkpoint boundary | Route diagonal + 4 markers + boundary + instrumentation + Alex occupy the composition | home-active-desktop.png |
| Gate looked like a coordinate axis | Gate = **near / boundary / far**: two offset vertical planes + light aperture + depth change; route physically stops before it | Aperture ellipse between two offset planes; darker far field; route stop-cap | home-checkpoint-desktop.png |
| $200 + green CTA = financial pressure | Amount is **calm ink** inside a hierarchy; primary is the title; CTA subdued | «$200» plain ink, no glow; heading «Подтверди условие…» dominates | home-checkpoint-desktop.png |
| Rank = generic sparkline | Replaced with **Route Sigil** (folded coil + family contour + anchor) | Coil-in-contour glyph; monochrome silhouette holds; 22px legible | rank-sigil-study.png |
| Alex too weak | Reserved **74px media frame + who + 2-line quote** embedded in the route | Portrait frame «ALEX CURIE» + editorial quote beside the route | home-active-desktop.png |
| Nav = generic SaaS header | 5 items, current section rendered as a **route segment** (signal underline) | «Главная» underlined by a route-signal segment; only 5 links | home-active-desktop.png |
| Mobile = card stack | **Route-first**: node upper-middle, open field from node, instrumentation line, compact Alex, swipe hint | Route enters bottom-left, node, open field, one-row instrumentation | home-active-mobile.png |
| CTA brighter than route | CTA = **route action marker** (subtle signal fill + small arrow node), not the brightest object | Route trace is as bright as the CTA; CTA sits within the route system | home-active-desktop.png |
| Reward/checkpoint as pills | Reward + rank placed **behind the boundary** (far zone, dimmer) | «За границей» zone right of the gate with Sigil IV + tool | home-checkpoint-desktop.png |
| Tiny/low-contrast service text | Service text ≥12.5px at ink-2 contrast | Level labels, meta, far-zone text readable at 1:1 | all |

## Visual QA loop (two passes)

### Pass 1 — findings (≥10)
1. **[critical]** Active desktop: instrumentation line + CTA + Alex strip collided (~y690–720).
2. **[major]** Checkpoint desktop: completed route crossed through the Alex quote.
3–4. [minor] «17» marker peeks behind the field left edge (desktop/mobile).
5. [minor] Checkpoint «Пройдено 16–20» sat near the route.
6. [minor] Checkpoint mobile far-zone line wraps.
7–11. [minor] label proximities / subtle far-depth gradient (acceptable — cinematic depth).
12. [observation] CTA arrow-node is the brightest small accent (small; kept — belongs to route signal).

### Fixes (critical + major + one cheap minor)
- **#1** Raised the node (450,408); lesson field → instrumentation → Alex now stack with clear gaps (no overlap).
- **#2** Reshaped the completed route to hug the bottom and rise only near the boundary → no longer crosses Alex.
- **#5** Moved «Пройдено 16–20» above the route.
- Minors #3/#4/#6/#7–#11 kept intentionally (cinematic depth / documentation page).

### Pass 2 — verification
Re-captured final. Before/after: Active desktop collision gone (field/instr/Alex clean); Checkpoint route
clears the Alex quote. **Browser console clean on all five.** No page horizontal overflow; touch targets ≥44px;
bottom nav does not cover content.

## Evidence matrix (no self-assigned aggregate score)

| Criterion | Pass/Fail | Visual evidence | Screenshot |
|-----------|:---------:|-----------------|-----------|
| route — главный объект | **Pass** | bold diagonal spans canvas; forms the field's top edge | home-active-desktop.png |
| lesson рождается из node | **Pass** | field top-left corner = current node; top edge = route | home-active-desktop.png |
| no generic central card | **Pass** | bounded top+left only, open bottom-right; no uniform perimeter | home-active-desktop.png |
| checkpoint читается как gate | **Pass** | two offset planes + aperture + depth change; route stops before it | home-checkpoint-desktop.png |
| amount не доминирует | **Pass** | «$200» calm ink; heading dominates; no glow/green giant | home-checkpoint-desktop.png |
| reward находится за gate | **Pass** | Sigil IV + Chart Markup Tool in the far zone, dimmer, not pills | home-checkpoint-desktop.png |
| rank не похож на chart/icon | **Pass** | folded-coil Route Sigil; monochrome holds; 22px legible | rank-sigil-study.png |
| Alex заметен | **Pass** | 74px reserved media frame + who + 2-line quote (desktop); compact fragment (mobile) | home-active-desktop.png / -mobile.png |
| desktop не пустой | **Pass** | route + markers + boundary + field + instrumentation + Alex fill it | home-active-desktop.png |
| mobile не stacked | **Pass** | route-first; node upper-middle; open field; instrumentation line; swipe hint | home-active-mobile.png |
| CTA понятен | **Pass** | one route action-marker CTA per state; first viewport on mobile | home-active-mobile.png |
| текст читаем | **Pass** | primary #eef2f8, service ink-2 ≥12.5px; no tiny tracked critical text | all |
| связь с ATA references | **Pass** | navy field + luminous route (01–03) + aperture boundary + route-built rank (02–03) | all |
| нельзя переименовать в generic SaaS | **Pass** | level→checkpoint-gate→unlock progression around a route; route-derived rank; no sidebar/card-grid | all |

**No Fail.** (Per the phase rule, any Fail would block React; here none — but React remains gated on an explicit user decision.)

## UX audit (ui-ux-pro-max — usability only, style advice ignored)
- **Next-action clarity:** one obvious CTA per state; route + «Следующий шаг» make the next step unambiguous.
- **Contrast:** primary/secondary text high-contrast on navy.
- **Touch:** CTA ≥46px; bottom-nav items ≥52px.
- **Mobile reachability:** CTA in first viewport, thumb zone; bottom nav clear of content.
- **Navigation:** 5-item top band (current = route segment) + mobile bottom nav 5; not a generic 9-link header.
- **Cognitive load:** low; single glow focus (node in A / aperture in B).
- **Financial-pressure risk:** mitigated — amount calm, no glow/deposit/urgency/«осталось»/Pocket CTA.
- **Readable typography:** service labels ≥12.5px at ink-2.
- **Swipe discoverability:** «↔ маршрут можно двигать» + route continues off-screen + partial neighbours.
- **Focus order:** to be defined at implementation (design-only prototype).

## Materials note
Deep navy field; cold blue boundary; cyan/green active trace (slightly less neon than R2); one glow focus;
fine functional metadata; open surfaces (not a card wall); no floating pills. Values provisional — not final HEX.
