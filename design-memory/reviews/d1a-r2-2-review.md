# D1A-R2.2 Review — final production-readiness correction

Applied skills: `/frontend-design`, `/ata-brand-language`, `/ata-visual-qa-loop`,
`/ata-anti-generic-ui-review`, `/ui-ux-pro-max` (usability only), `/webapp-testing` (real render).
Art-direction gate not reopened — Route Field is the approved base. Real browser screenshots
(Playwright, exact viewports, dSF 1, fonts ready). **first-pass**:
`design-memory/screenshots/d1a-r2-2/first-pass/` · **final**: `design-memory/screenshots/d1a-r2-2/final/`.
R2/R2.1 not overwritten. React not approved.

## Visual QA loop (two passes)

### Pass 1 — findings (≥8), classified
1. [minor] Active desktop: instrumentation Route Knot at 34px is small (reads; acceptable).
2. [minor] Checkpoint desktop: faint far-route dotted line ran near the split-result text.
3. [minor] Checkpoint desktop: tool glyph read slightly like an ascending chart.
4. [minor] Active desktop: «18» label sits close to the node (fine).
5. [minor] Knot tiers I/II differ subtly at 22px (clear at 44px+; acceptable).
6. [minor] Active mobile: future-checkpoint boundary fragment is small (reads).
7. [minor] Checkpoint mobile: split-result row is tight but fits and reads in <3s.
8. [minor] Alex asset-corner marker is subtle (intended — provisional boundary hint).

No **critical** and no **major** (the two prior criticals — mobile title/route overlap and route
crossing Alex — were resolved by design in this build; verified in the captures).

### Fixes applied (worthwhile minors → gives before/after)
- **#2** Moved the far continuing route below the split results (clear of the text).
- **#3** Reworked the tool glyph to read as *markup* (frame + marked level + point + markup stroke),
  not an ascending market chart.
- Minors #1/#4/#5/#6/#7/#8 kept intentionally (legible; provisional).

### Pass 2 — verification
Re-captured to `final/`. Before/after: far-route no longer near the result text; tool glyph no longer
chart-like. **Browser console clean on all five**; **no horizontal overflow** (390/1440); touch ≥44px;
bottom nav does not cover content.

## Evidence matrix (no self-assigned aggregate score)

| Criterion | Pass/Fail | Evidence | Screenshot (final) |
|-----------|:---------:|----------|-----------|
| Route Field remains primary | **Pass** | route is the main diagonal, forms the lesson-plane edges; gate is a route compression | home-active-desktop.png |
| lesson plane grows from node | **Pass** | field top-left corner = current node; top+left edges = route traces | home-active-desktop.png |
| mobile title has no route overlap | **Pass** | node has a safe gap above the plane; «17»/route clear of the title; heading fully readable | home-active-mobile.png |
| level 19 and module boundary readable | **Pass** | labelled 19 node on the upcoming route + module seam & label | home-active-desktop.png |
| future checkpoint is structural | **Pass** | distant boundary graphic + level 20 + rank/tool preview (desktop); compact ≤110px structural preview (mobile) | home-active-desktop.png / -mobile.png |
| checkpoint gate readable | **Pass** | two offset vertical planes + deep light aperture; route physically stops before it | home-checkpoint-desktop.png |
| amount does not dominate | **Pass** | «$200» normal ink in a merged calm line; no glow/deposit styling | home-checkpoint-desktop.png |
| rank and tool separated | **Pass** | two split results (rank / tool) with a shared column + minimal divider, not pills/cards | home-checkpoint-desktop.png / -mobile.png |
| Route Knot unique | **Pass** | asymmetric folded knot; not nested-square/wallet/camera/scanner/QR/chart/target/shield/medal/A/pyramid/arrow/currency | route-knot-study.png |
| Route Knot readable at 22 px | **Pass** | 22px tiers legible; raster/blur checks hold | route-knot-study.png |
| monochrome silhouette works | **Pass** | white silhouettes (22/48) + blur preserve form | route-knot-study.png |
| Alex integrated | **Pass** | cinematic media frame (directional light, backlit silhouette, no face) + voice tied to node; no stock person | home-active-desktop.png |
| no debug labels | **Pass** | phase labels / «design-only» / «Route Field · State A» / permanent «маршрут можно двигать» removed | all |
| desktop density balanced | **Pass** | route + markers + boundary + plane + instrumentation + Alex fill the space; not empty, not a dense diagram | home-active-desktop.png |
| mobile not stacked | **Pass** | route-first; open plane from node; one instrumentation line; structural preview | home-active-mobile.png |
| CTA clear | **Pass** | one route action-marker CTA per state; first viewport on mobile | home-active-mobile.png |
| text readable | **Pass** | primary #eef2f8; service ink-2 ≥12px; nav secondary contrast raised | all |
| no raw codes | **Pass** | RU labels only; internal codes not shown | all |
| no backend/Pocket CTA | **Pass** | no user balance; no «осталось $X»; no Pocket CTA | home-checkpoint-desktop.png |
| cannot be renamed to generic SaaS | **Pass** | level→checkpoint-gate→unlock route progression + route-built rank; no sidebar/card-grid | all |

**No Fail.** Per the phase rule, any Fail would block React. Absence of Fail does **not** replace user
approval — React is allowed only after a manual review of R2.2 and an explicit decision.

## UX audit (ui-ux-pro-max — usability only; style advice ignored)
- **Next-action clarity:** one obvious CTA per state; route + «Следующий шаг» make the next step unambiguous.
- **Contrast:** primary/secondary high-contrast; nav secondary raised to #9aa6ba.
- **Mobile reachability:** primary CTA in first viewport, thumb zone; bottom nav clear of content.
- **Touch targets:** CTA ≥46px; bottom-nav items ≥52px.
- **Navigation clarity:** 5-item band; active section = short route segment (not colour-only); «Ещё» last.
- **Cognitive load:** low; single glow focus (node in A / aperture in B).
- **Text size:** service labels ≥12px; no tiny tracked uppercase for critical info.
- **Checkpoint comprehension:** near/boundary/far + split rank/tool results understood in <3s.
- **Financial-pressure risk:** mitigated — amount calm, no glow/deposit/urgency/«осталось»/Pocket CTA.
- **Focus order:** to be defined at implementation (design-only prototype).
- **Swipe discoverability:** route crop + partial neighbours + «граница 20 ›» (structural, not an instruction line).
