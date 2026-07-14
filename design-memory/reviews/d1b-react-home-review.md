# D1B — Route Field Home · Visual QA & Evidence Matrix Review

**Phase:** D1B — React App Shell and Route Field Home
**Reviewed build HEAD (base):** `159857931d00adccafc594d7336f618f742744f7`
**Screenshots (source of truth):** `design-memory/screenshots/d1b-react-home/final/`
**Method:** real Next.js dev server rendered in Chromium via Playwright (not synthetic / not HTML inspection).

Captured states (8):

| File | State |
|------|-------|
| `home-active-desktop-1440x900.png` | Active lesson · desktop |
| `home-active-tablet-1024x768.png` | Active lesson · tablet |
| `home-active-mobile-390x844.png` | Active lesson · mobile |
| `home-active-mobile-320.png` | Active lesson · 320px (min width) |
| `home-active-zoom-200.png` | Active lesson · 200% zoom |
| `home-checkpoint-desktop-1440x900.png` | Checkpoint · desktop |
| `home-checkpoint-tablet-1024x768.png` | Checkpoint · tablet |
| `home-checkpoint-mobile-390x844.png` | Checkpoint · mobile |

---

## 1. Visual-QA findings log (this pass)

Findings discovered by viewing the real screenshots, ranked by severity. All blocking
findings were fixed and re-captured; the table shows the final disposition.

| # | Sev | Finding | Evidence | Resolution |
|---|-----|---------|----------|------------|
| 1 | Critical | `r-wide`/`r-narrow` route toggle inverted — the wide diagonal route rendered on mobile and crossed the lesson title / CTA / Alex. | mobile active (pass-1) | Base rule now hides `.r-wide`; the wide route shows only ≥1200px. Mobile shows the top-zone `r-narrow` route. |
| 2 | Critical | Bottom navigation was `display:none` in every breakpoint — it never appeared on mobile. | mobile active/checkpoint (pass-1) | Base `.bottomnav { display:block }`; hidden ≥900px where the app bar takes over. |
| 3 | Critical | Tablet active grid was malformed: 2-column `grid-template-columns` with a 3-column `grid-template-areas`, squishing the middle column (mentor text collapsed to a ribbon, instrumentation stacked, future-checkpoint aperture collided with the heading). | tablet active (pass-1) | Route-field grid moved to ≥1200px. Tablet (900–1199) now uses the stacked composition with roomier padding. |
| 4 | Major | On active desktop the SVG `rc-edge` lines (drawn from the node) did not coincide with the lesson plane's real CSS top/left borders — a duplicate, mismatched green line cut through the module-progress / CTA area. | desktop active (pass-1) | Removed the `rc-edge` paths; the plane's own borders are the route-derived edges. |
| 5 | Major | Active route did not visually reach the current node (route ended short of the DOM node). | desktop active (pass-1) | Retuned completed/upcoming route to meet the node at ~(27%, 32%). |
| 6 | Major | On checkpoint mobile the bright completed route dipped down-left through the heading ("Подтверди условие"). | checkpoint mobile (pass-1) | Retuned the `r-narrow` checkpoint route to arrive at the gate horizontally through the top band, clearing the heading. |
| 7 | Minor | Mobile content height was tight against the (now-visible) bottom nav. | mobile active | Reduced `node-narrow` height and content gaps; `home-main` bottom padding clears the 60px bar + safe area. |
| 8 | Minor | `home-main { overflow:hidden }` prevented scrolling under 200% zoom. | zoom | Changed to `overflow-x:hidden; overflow-y:auto`. |
| 9 | Minor | Tablet mentor block wrapped its quote into a narrow ribbon (side-effect of #3). | tablet active (pass-1) | Resolved by the stacked tablet layout + `max-width` on `.mentor`. |
| 10 | Minor | Tablet future-checkpoint aperture overlapped the heading (side-effect of #3). | tablet active (pass-1) | Resolved by the stacked tablet layout. |

All Critical/Major findings fixed and re-verified in the `final/` screenshots.

---

## 2. Evidence matrix (20 criteria — any Fail blocks D1B)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Authenticated app shell present (brand, nav, notifications, avatar) | **Pass** | app bar in every desktop/tablet shot; mobile top bar + bottom bar on mobile shots. |
| 2 | Home renders the Active Lesson state | **Pass** | `home-active-*`; current level 18, module 4, "Продолжить урок". |
| 3 | Home renders the Current Checkpoint state | **Pass** | `home-checkpoint-*`; gate + "Проверить выполнение". |
| 4 | Route Field is the composition object (not sidebar+cards) | **Pass** | luminous route in all shots; no card grid; `ata-anti-generic` §3. |
| 5 | Two scenarios switch deterministically via `?scenario=` | **Pass** | `resolveScenario` unit tests; both scenario shots produced from the same build. |
| 6 | Unknown scenario falls back to active | **Pass** | `home.test.ts` `resolveScenario` `.each` cases. |
| 7 | CTA labels exact (`Продолжить урок` / `Проверить выполнение`) | **Pass** | component tests + screenshots. |
| 8 | CTA is a control, not the brightest object; no fake success/404 | **Pass** | `PrimaryRouteAction` is a no-op button; smoke asserts CTA visible; §31 documents temporary no-op. |
| 9 | **No user balance / deposits / withdrawals / "remaining $X"** | **Pass** | `home-screen.test.tsx` privacy suite: forbidden patterns absent; active has zero `$`. |
| 10 | **No Pocket CTA / deposit button** | **Pass** | privacy suite; CTA is "Проверить выполнение", not a Pocket link. |
| 11 | Only allowed money string is `баланс Pocket от $200` + demo note | **Pass** | checkpoint has exactly one `$`; note asserted. |
| 12 | Requirement amount never the largest text | **Pass** | test asserts `$200` not in `<h1>`; heading is the instruction. |
| 13 | Single `<h1>` per scenario (heading order) | **Pass** | accessibility test (count === 1) both scenarios; smoke `toHaveCount(1)`. |
| 14 | Screen-reader route alternative to the decorative SVG | **Pass** | `RouteField` `sr-only` nav; component test asserts "Текущий уровень: 18". |
| 15 | No horizontal page overflow (incl. 320px) | **Pass** | smoke overflow check ≤1px on all 6 states; `home-active-mobile-320.png`. |
| 16 | Responsive: genuine desktop / tablet / mobile compositions | **Pass** | desktop route grid; tablet stacked; mobile top-zone route + bottom bar. |
| 17 | Usable at 200% zoom | **Pass** | `home-active-zoom-200.png` — text scales, layout coherent, scrollable. |
| 18 | Keyboard: skip link first, focus visible, CTA reachable | **Pass** | smoke keyboard tests (skip link → `#main`, CTA focusable). |
| 19 | Bottom nav does not overlap the primary CTA (mobile) | **Pass** | smoke bounding-box assertion; `home-active-mobile-390x844.png`. |
| 20 | Provisional rank mark only (NOT a final rank system / Route Knot chain) | **Pass** | `ProvisionalRankMark` single node/trace; no 20-rank assets; see `docs/RANK_IDENTITY_FUTURE_PHASE.md`. |

**No Fail. D1B evidence matrix passes.**

---

## 3. Anti-generic scoring (per `ata-anti-generic-ui-review`)

Computed from the real `final/` screenshots.

**Desktop (active + checkpoint):**

- Connection to ATA DNA: 18/20 — deep navy field, luminous line-as-structure, cold blue + green/cyan signal, chaos→system reading (route rising toward a gate).
- Structural originality: 14/15 — route-field spatial system with an empty left "run-up" column; not sidebar+grid.
- Product meaning: 14/15 — route = curriculum; node = current level; gate = checkpoint; beyond-gate = rank + tool unlock.
- Typography: 9/10 — clear display/body hierarchy, readable body, no landing low-contrast.
- Signature object: 9/10 — the luminous route + gate aperture.
- Progression clarity: 9/10 — one obvious next step (single CTA) + module mini-spine.
- Mobile transformation: 9/10 — a real rethink (top-zone route, node above an open plane, bottom bar), not a stacked desktop.
- Usability/readability: 9/10 — contrast, focus, targets, no overflow (Playwright-verified).
- **TOTAL: 91/100.**

**Automatic-fail check:** below 80 → PASS (91). No signature object → PASS. Renameable to any SaaS → PASS (route-field identity). Sidebar+card grid → PASS. Identical skeletons → N/A (single direction, two states). Mobile stacked desktop → PASS. Landing low-contrast body → PASS. >6 identical first-view cards → PASS (0). One shape everywhere → PASS (route, plane, gate aperture, node all distinct). Icon-only identity → PASS. No link to ≥2 references → PASS (deep navy field + luminous line). Decorative market elements w/o function → PASS.

**Objective counts (desktop active):** same-type cards 0 · surface geometries: open plane, gate aperture, node, mini-spine dots (4) · icon dependence ~10% (nav + notification only; meaning is textual) · branded objects 2 (route, gate) · hierarchy levels 4 (eyebrow / title / meta / CTA) · contrast problems: none observed · unadapted landing-only patterns: none.

**Verdict: PASS.**

---

## 4. Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass (0 problems) |
| `npm run typecheck` | Pass |
| `npm run test:run` | Pass — 4 files, 32 tests |
| `npm run build` | Pass — `/` static, no type errors |
| `npm run test:e2e` (smoke) | Pass — 9/9 |
| `npm run screenshots` | Pass — 8 states captured |
| `npm audit` | 2 moderate, transitive only (see note) |

**Audit note:** the 2 moderate advisories are in Next.js's **bundled internal** `postcss` (`next/node_modules/postcss`), a build-time CSS-stringify XSS that does not apply to our usage (we do not stringify untrusted CSS). Our direct `postcss` devDependency is `8.5.18` (already patched). The only offered remediation is `npm audit fix --force`, which downgrades `next` to `9.3.3` — an unacceptable breaking change. Not applied; to be resolved by a future Next.js patch release.

---

## 5. Scope conformance

- Built only: app shell, Home active, Home checkpoint, responsive Route Field, reusable components, screenshots, QA. No `/path`, lesson/test/report/tools/community/news/referrals/mentor/support/profile/settings pages; no full rank system or 20 rank assets; no real auth/backend/CRM/Pocket/Prisma/DB; no deploy; D2 not started.
- Provisional rank identity only (`ProvisionalRankMark`); real rank identity deferred (`docs/RANK_IDENTITY_FUTURE_PHASE.md`).
- Mentor rendered via `MentorMediaPlaceholder` (backlit silhouette, no face, asset boundary); real Alex Curie asset deferred.
