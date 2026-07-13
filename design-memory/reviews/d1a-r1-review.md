# D1A-R1 Review — structural low-fi directions

Applied skills: `/frontend-design`, `/ata-brand-language`, `/ata-art-direction-gate`,
`/ata-anti-generic-ui-review`, `/ui-ux-pro-max` (heuristics only), `/webapp-testing` (render only).
Real browser screenshots: `design-memory/screenshots/d1a-r1-low-fi/` (1440×900 & 390×844, console clean).
**No winner selected — the user chooses.** Scores are provisional (low-fi; polish not required, but
automatic-fail conditions apply fully).

## Screenshot-review findings

| # | Direction | Finding | Severity | Status |
|---|-----------|---------|----------|--------|
| 1 | all | Node labels (L15–L19) collapsed to top-left (`.label.mono` lacked `position:absolute`) | critical | ✅ fixed in `lowfi.css`, re-captured |
| 2 | C desktop | «→ система» exit label partly behind lesson plane | minor | deferred to high-fi (low-fi acceptable) |
| 3 | A desktop | Top command strip has 9 items — may crowd on narrow widths | minor | needs priority/overflow nav in implementation |
| 4 | B desktop | Active node lacks explicit numeric «L18» on the axis (only in plane eyebrow) | minor | add axis label in high-fi |
| 5 | B, C | Navigation discoverability (spine-as-nav / radial) — users must find sections | major (UX risk) | affordance required at implementation; noted in sheets |
| 6 | C | Right exit route could read as another lesson connector | minor | differentiate in high-fi |

Critical fixed and re-captured; before/after visible (labels moved from top-left to under nodes).
Majors are design-level UX risks recorded for implementation (no React allowed at this phase).

## Anti-generic scoring (provisional)

| Criterion (max) | A · Route Field | B · Learning Spine | C · Constructed Artifact |
|-----------------|:---:|:---:|:---:|
| ATA visual DNA (20) | 17 | 17 | 18 |
| Structural originality (15) | 14 | 14 | 14 |
| Product meaning (15) | 14 | 14 | 14 |
| Typography (10) | 8 | 8 | 8 |
| Signature object (10) | 9 | 9 | 9 |
| Progression clarity (10) | 9 | 9 | 8 |
| Mobile transformation (10) | 9 | 8 | 8 |
| Usability/readability (10) | 8 | 8 | 7 |
| **TOTAL** | **88** | **87** | **86** |

### Automatic-fail check (all three)
- score < 80 → **PASS** (88 / 87 / 86).
- no signature object → **PASS** (each has a functional one: route trace / spine / artifact).
- renameable to any SaaS → **PASS** (each tied to ATA level→checkpoint→unlock progression).
- sidebar + card grid → **PASS** (none; no persistent sidebar, no card grid).
- three share one skeleton → **PASS** (three different spatial systems — see comparison doc).
- mobile = stacked desktop → **PASS** (swipe / segment-focus / focused-object+orbit).
- landing-level low contrast body → **PASS** (high-contrast text).
- >6 identical cards in first viewport → **PASS** (0–1 working surfaces, not a card grid).
- all surfaces one shape → **PASS** (field + line/axis/object + one plane = distinct geometries).
- identity only on icon library → **PASS** (no icon library; identity from signature object).
- no connection to ≥2 references → **PASS** (A/B: route 01–03 + spine 04; C: constructed object 02–03 + line).
- decorative market elements without function → **PASS** (route/spine/artifact/metadata all functional).

**Verdict: all three PASS** (no automatic fail; all ≥ 80). None is inflated — scores capped at 8/10 on
typography/usability precisely because this is low-fi, not polished.

### Objective counts (per direction, desktop first viewport)

| Count | A | B | C |
|-------|---|---|---|
| same-type cards | 0 | 0 | 0 |
| distinct surface geometries | 3 (field · line · plane) | 3 (field · axis · plane) | 4 (field · object-layers · route · plane) |
| icon dependence | ~0% (text labels; no icon library) | ~0% | ~0% |
| branded objects | 1 (route trace) | 1 (spine) | 1 (artifact) |
| real hierarchy levels | 4 | 4 | 4 |
| contrast problems | none | none | none |
| landing-only transferred w/o adaptation | none | none | none |

## UX heuristic findings (ui-ux-pro-max — structural only, no style advice)

- **Hierarchy:** single H1 (current lesson) + one primary CTA per screen — clear.
- **CTA visibility:** «Продолжить урок» prominent; on mobile it is inside the first viewport in all three.
- **Mobile reachability:** CTA sits mid-screen (thumb zone); bottom nav present and not overlapping content.
- **Touch targets:** `.cta` min-height 44px; bottom-nav items ~58px — meet the 44×44 guideline.
- **Navigation clarity:** A (top strip) is explicit; **B (spine-as-nav) and C (radial) need an explicit
  section affordance** so discovery isn't implicit — recorded as a UX risk for implementation.
- **Cognitive load:** low (few elements). C's assembly metaphor is the highest load → keep fragment
  labels and CTA dominant.
- **Accessibility:** contrast good; meaning not color-only (labels + text). Implementation must add
  keyboard/focus order and a screen-reader list alternative for route/spine/artifact (per a11y baseline).
- **Text size / tracking:** body readable; eyebrows are small but never the sole carrier of key info
  (avoided landing tiny-tracked-label pattern).
- **Overflow:** low-fi canvases have none; a real 100-node route/spine needs virtualization + horizontal/
  vertical scroll containers (no page overflow) — carried from D1A learnings.
- **Focus order:** to be defined at implementation.

## Note
Low-fi wireframes are monochrome + one cold accent + one green/cyan signal; no final gradients,
shadows, detailed icons, photos, or decorative animation — structure was tested, not polish.
