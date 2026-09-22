# PUBLIC HOME HI-FI · slice 1 · the route and the window: screenshot review

- **Date:** 2026-09-22
- **Scope:** the middle of the public home — `#product`, `#path`, `#tools` — rebuilt as one route of levels with a pinned product window (direction B+C, the owner's choice of 2026-09-22), plus readiness slice 0 (the login link, the phone frame corners, the compact header, the FAQ list with the cost answer, the social preview and structured data on the indexing host).
- **Owner decisions this slice rests on (2026-09-22):** inserts are a presentation of the product, not screenshots; nothing about the broker, deposits or checkpoint amounts; tuition is free; no personality; the hero frame stays for the video.
- **Direction gate:** three structurally different directions were proposed (Линза / Маршрут открытий / Окно в продукт); the owner asked for the best of B and C. The route is B; the window is C.

## Visual thesis
- **The route is the argument, the window is the evidence.** A Signal line runs down the left of three segments — the learner's home, the path, the six tools — with nodes at Старт, L1, L2, L3, 01 and L5…L30. On the right a frame of the product pins under the header and shows the state of the node the visitor has reached: the Home's next action at L3, the module route, then each tool as the product presents it. Scrolling moves both; the titles are buttons for keyboard users.
- **The window is the product's own material** — the tools' field, surface and well, its Signal and mono labels, its real words («Подготовьте и отправьте отчёт», «Вход по плану допустим», «Вход закрыт по вашему плану до 14:45») — rebuilt for presentation at a scale that reads from a distance, with one moment of motion per state. It is not a screenshot and it is not the product's component tree: a presentation needs to leave things out, and the public page cannot import a signed-in surface.
- **Truth by construction:** the six tool steps come from the tools catalogue (`TOOL_WINDOWS`), so the page cannot name a tool the product lacks or a level it does not unlock at; the FAQ renders from the same list the structured data reads.

## How the screenshots were made
- Playwright Chromium, `deviceScaleFactor` 1, locale ru-RU, at 1440×900, 1024×768, 768×1024 and 390×844, against the scratch Academy dev server (127.0.0.1:3059) on the same code. Fonts awaited; `pageerror` and `console.error` listened to on every capture; sideways scroll measured.
- Every state was captured by scrolling its step into the observer's band and asserting the window's `data-state` before the shot.
- Nothing on PREPROD was touched.

## Captures (before)
`design-memory/screenshots/public-home-hifi/before/` — the live PREPROD page of 2026-09-22 at 1440 and 390: `#product` (the five-bar panel), `#path` (twenty empty squares), `#tools` (two prototype tables), the invisible login link and the square frame corners.

## Findings

| # | Round | Viewport | Problem | Severity | Status |
|---|---|---|---|---|---|
| 1 | 1 | all | The window never pinned: `.ph { overflow-x: hidden }` and `.surface { overflow: hidden }` made ancestors scroll containers, so `position: sticky` stuck to them, not the viewport. | critical | fixed — `overflow: clip` on both |
| 2 | 1 | all | The active step vanished: React rewrote the step's class list on every state change and dropped the `is-visible` the reveal observer had added. | critical | fixed — steps carry no `data-reveal` |
| 3 | 2 | ≤920 | On phones the window rendered after the route, at the bottom, instead of pinning on top. | major | fixed — `order: -1` |
| 4 | 2 | 1440 | At the last step the window outgrew its column and slid under the header. | major | fixed — one 600px height for every state, 120px of room under the last step |
| 5 | 2 | 1440 | «Демонстрационный пример» wrapped to two lines in the window's bar. | minor | fixed — nowrap, tighter gaps; hidden below 1180 where the bar cannot hold it |
| 6 | 2 | all | «Старт» did not fit its 26px node. | minor | fixed — the origin is a ring with a dot |
| 7 | 2 | 1440 | «модуль 1 из 20» and «→ стоп» wrapped mid-phrase. | minor | fixed — nowrap |
| 8 | 3 | 1024 | The stacked checklist overflowed the window; the verdict was cut. | major | fixed — denser rows, no note or button on tablets |
| 9 | 3 | 390 | Checklist, stats and news were cut at the window's bottom. | major | fixed — window 52vh, dense list, compact tiles, one event |
| 10 | 3 | 390 | «Уровень N» clipped at the bar's edge. | minor | fixed — «Уроки» dropped from the bar under 680, level label does not shrink |
| 11 | 4 | 390 | The verdict box rendered empty: the phone rule that hid the verdict's paragraphs hid its headline too. | minor | fixed — `p:not(.pw-check__ok)` |
| 12 | 4 | all | Step titles are buttons of a 30px line — under the 44px target. | minor | fixed — 8px padding with negative margin |

## Captures (after)
`design-memory/screenshots/public-home-hifi/final/<viewport>-<state>.png`: eight states at 1440, 1024 and 390, four at 768; the slice-0 fixes at 1440 and 390.

## Before/after
- **The three sections read as one route.** Before: three unrelated inserts — a five-bar mock, a grid of squares, two tables of «—». After: one line from Старт to L30, and beside it the product itself in eight states.
- **Height.** 1440: page 11 771 → 11 394 px; the three sections 3 811 → 3 466 px. 390: page 15 945 → 14 978 px; the three sections 5 033 → 3 994 px (−21 %).
- **The tools are true again:** six, at L5, L10, L15, L20, L25 and L30, from the catalogue.
- **Slice 0:** «Уже клиент? Войти» is legible (`before/1440x900-login-link.png` → `final/1440x900-slice0-login-link.png`); the phone frame has corners, not squares (`before/390x844-frame-corners-2x.png` → `final/390x844-slice0-frame-corners-2x.png`).

## Console result
- 0 page errors, 0 console errors at 1440, 1024, 768 and 390 across all eight states; no sideways scroll at any width.
- Every capture's `data-state` matched the step scrolled to.

## Anti-generic score (ata-anti-generic-ui-review)

References tied: **luminous line as structure** (the route; ref 04's spine with numbered nodes, refs 01–03's rising trace), **signal point as state** (the active node; ref 03), **constructed object** (the window, built from the product's data; ref 02).

| Criterion | Score |
|---|---|
| Connection to ATA DNA | 17/20 |
| Structural originality: a route with a pinned evidence window, no card grid; six tools on one surface with hairlines | 13/15 |
| Product meaning: every node a real level, every state the product's own object, unlock levels from the catalogue, the Home's real next action | 15/15 |
| Typography: serif benefits on the route, mono level labels, the product's Manrope/mono inside the window | 8/10 |
| Signature object: the route that draws to the node you reached, with the window that answers it | 9/10 |
| Progression clarity: the line, the reached and active nodes, «Уровень N» in the bar | 9/10 |
| Mobile transformation: window pinned on top with dense states, spine on the left, steps re-composed — not a shrunken desktop | 8/10 |
| Usability / readability: buttons with `aria-pressed`, 44px targets, visible focus, muted mono at ≥ 6:1 on ink, reduced-motion respected | 8/10 |
| **Total** | **87/100** |

Automatic-fail check:

| Condition | Result |
|---|---|
| Total ≥ 80 | PASS |
| Signature object exists | PASS |
| Not renameable to any SaaS (levels L3–L30, «Причина входа до сделки», «Вход закрыт по вашему плану») | PASS |
| No sidebar + card grid | PASS |
| Three identical directions | n/a — the owner merged two named directions |
| Mobile is not a stacked desktop | PASS |
| No landing-level low contrast | PASS |
| No first viewport with more than six identical cards | PASS |
| Not one shape everywhere (line, rings, frame, fields, bars, track) | PASS |
| Identity not built on icons alone (no icon library) | PASS |
| Connection to at least two references | PASS |
| No decorative market elements (the news track and the module route are the learner's own objects) | PASS |

Objective counts (1440, the tools segment with the checklist state): same-type cards 0 · surface geometries 6 (route line, node ring, window frame, window bar, product field, product well) · icon dependence 0 % · branded objects 3 (route, node, window) · hierarchy levels 4 · contrast problems none · unadapted landing-only none.

**Verdict: PASS** (87/100, no automatic fail).

Top fixes for later, ranked:
1. The motion plan's remaining items: «многое → одно» in `#decide`, the drawn line in `#mechanism`, the mobile reveal (currently pinned off by a guard test) — a slice of their own.
2. The window could replay a state's moment on hover, on desktop.
3. The video slot in the hero: poster, click-to-play, the 2–5 minute platform film — when the film exists.

## Motion slice (2026-09-22, the same day, after the release of slices 0–1)

Three sequences, each once, each bounded, all riding the reveal observer's `is-visible`:

| Where | Sequence | Length |
|---|---|---|
| `#decide` | six borrowed answers recede toward the axis and dim (45ms stagger, 420ms), the axis draws to its point (460ms from 180ms), the learner's own basis is written into the frame (540ms from 300ms), the statement follows (from 720ms) | ≈ 960ms |
| `#mechanism` | a Signal line is drawn over the hairline left to right (760ms from 80ms) and the six nodes light in order as it reaches them (from 60 to 710ms); on phones the line runs down the node centres | ≈ 950ms |
| `#review` | when V2 arrives, the corrected field pulses once (720ms from 660ms, after the card's own stagger) | ≈ 1.4s from the card's entry |

Also: the reveal is now gated on the JS marker (`.ph.has-js [data-reveal]`) — without a script every element was at `opacity: 0` and the page would have been blank; measured with JavaScript off: 0 of 32 reveal elements hidden. And a light reveal on phones (12px, 360ms, no stagger) replaces the static mobile.

Frames: `design-memory/screenshots/public-home-hifi/motion/<viewport>-<section>-<ms>.png` — 0, 300, 600 and 1500ms after each section entered, at 1440 and 390. Console: 0 errors. Final states measured: chips at opacity 0.55, nodes filled Signal, axis at scale 1.

Reduced-motion: the existing rule caps every animation at 0.01ms and every keyframe runs with `both`, so the final states apply at once — dimmed chips, lit nodes, the written basis.

Guards: the phone-reveal test now asserts the light lift; a new test asserts the three triggers exist, no animation loops, durations ≤ 900ms and delays ≤ 800ms; a new test asserts the JS gate.

## The evidence window (2026-09-22, the owner: «этому блоку тоже нужен хай фай»)

`#review` used to carry four authored cards. It now carries the product's own frame — the report workspace of L3, «Первые пять demo-сделок», with the real assignment's five entries and its real field «Причина входа до сделки» (`trade3-pre-trade-reason`), the real status panel and the learner's real words: «Отчёт отправлен и ожидает проверки наставника», «↩︎ Наставник запросил доработку» with «Причина: Требуется доработка» (the rubric's one rejection reason) and the criterion «Причина до сделки» (rubric `r2`), «Есть изменения после вердикта — можно отправить на проверку повторно», «✓ Работа принята», «✓ Отчёт принят — уровень завершён», the arc «Версия 1 отправлена → Получен разбор → Версия 2 отправлена → Работа принята». The window moves through the four states; the strip beneath keeps them as words and drives the window (buttons with `aria-pressed`).

Motion: when the window is reached the sequence plays once — 1.5s a state, 4.5s in all, the page's one cinematic moment — and any click on a state stops it. Reduced motion: no autoplay (measured: still `v1` after 3.5s). Without a script: the first state and the strip.

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | all | Two siblings in the status panel shared `key={stage}`, so React kept a stale line beside the new one («Отчёт отправлен…» above the feedback box). | major | fixed — distinct keys |
| 2 | 390 | The sequence never started: the observer watched the block with the strip, taller than a phone screen, so 45 % of it was never visible. | major | fixed — the window itself is observed, threshold 0.3 |
| 3 | 390 | The window inherited the route window's `52vh` cap and cut its status panel. | major | fixed — `height: auto` for the evidence window |
| 4 | all | «01 EUR/USD» read as an amount to the no-learner-data guard (`\d+\s?EUR`). | minor | fixed — «01 ·» with a 34px column |
| 5 | 1440 | The typing wipe of the corrected reason clips every line at once mid-animation. | minor | accepted — settles in 840ms; the same device as the Trade Card |

Frames: `design-memory/screenshots/public-home-hifi/review/<viewport>-<state>.png` at 1440, 1024 and 390, and `before-1440.png`. Console: 0 errors at all three widths; no sideways scroll; every capture's `data-stage` matched the expected state, the click held against the autoplay.

Anti-generic, this section: the object is the product's real report with its real field and verdict (product meaning 15/15); the strip and the window are one composition, not a card grid; the section's score holds with the page's 87.

### The card is the target (2026-09-22, the owner: «переключение работает лишь когда нажимаешь на текст названия»)

The strip's button in each title stays the control — focusable, `aria-pressed`, the keyboard's way in — but a pointer now lands anywhere on the card: the index, the note, the empty surface. The object inside the card (the field, the criterion, the accepted note) is content, not a control: a click on it changes nothing, and the reading pointer stays over it (`cursor: auto` inside `cursor: pointer`). A drag that selected text is not a click. Hovering the card lights the title the way hovering the button did; hovering the object does not (`li:hover:not(:has(.evidence__object:hover))`).

Measured in Chromium at 1440 and 390: note → `v2`, index → `feedback`, the empty corner and the left padding of the fourth card → `accepted`; the first card's object, its text and the second card's verdict → unchanged; the title area → `v1`; cursors `pointer` / `auto`; title colour on card hover rgb(221,255,160), on object hover and off the card rgb(243,244,239); console 0 errors. Frames: `review/1440-card-hover.png`, `review/390-card-clicks.png`. Guard: the new test clicks the note, the index, the card itself and the three objects and reads `data-stage` and `aria-pressed`.

## The decision window (2026-09-22, the owner: «вот этот блок теперь»)

`#decide` used to resolve the hero's frame as an authored card. It now resolves it in the product: the Trade Card (L5, «План сделки до входа») at the moment the reason is written — the four parameters, the field «Причина входа до сделки» with the same string the evidence's V2 carries, «● Зафиксировано 17:20», «После открытия условия сделки не меняются». The «many → one» sequence is unchanged: the chips recede, the axis draws to the window, the reason is written into the product's field, the statement follows.

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | 1440 | The window overflowed its column by 210px and was cut by the section: the frame's one grid track sized to the bar's no-wrap content. | major | fixed — `grid-template-columns: minmax(0, 1fr)` on every window, the reframe gives the window 1.5fr of its width, the decide bar keeps only the active item, the level and the badge |
| 2 | all | The last beat («Зафиксировано») started at 860ms, past the 800ms guard. | minor | fixed — 800ms |

Frames: `design-memory/screenshots/public-home-hifi/decide/` at 1440 (0/300/600/1500ms), 1024, 768 and 390; `before-1440.png`. Windows measured inside their columns at 1440 (478px), 1024 (672px) and 768 (684px); no sideways scroll; console clean; no-JS: 0 of 28 hidden.

## The cycle's objects (2026-09-22, the owner: «тут нужно сделай хай фай»)

`#mechanism` used to carry six titled steps with a sentence each. Each step now ends in the object where it happens in the product — six objects of six shapes, in the product's materials and words: the lesson of L5 «Жизненный цикл сделки» with its reading progress («Прочитано 2 из 4 разделов»); the field «Причина входа до сделки» with the basis written and «● Зафиксировано»; the Home's next action «Выполните практический шаг» with «Открыть уровень»; the assessment «Вопрос 3 из 5» with its options and «Для завершения — 100 %»; the returned report «↩︎ Наставник запросил доработку» with «Создать исправленную версию»; the completed level «✓ Уровень завершён» with the path L5 → L6 → L7 and «Открылся L6 · Экспирация и payout». Nothing captured from a learner, no sum of money.

Motion: each object appears as its node lights — 240ms, delays 140…790ms after the loop's `is-visible`, once, `both`; the lesson's progress fills once. Reduced motion: the final states (the global cap). Without a script: nothing hidden (0 of 28).

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | 1440 / 1024 / 768 | The sixth object's level path is a nested list, and the cycle's `li` rules (72px top padding, column borders) reached it: lines hung from the nodes. | major | fixed — every cycle rule addresses its direct children (`.learning-loop > li`, `> li > h3`, `> li > p`) |
| 2 | 768 | The cycle's vertical line and the phone step padding lived at 920px while the one-column layout starts at 680px: at 768 the line cut through the first column and the objects touched the dividers. Present since the motion slice. | major | fixed — both moved to the 680px breakpoint |
| 3 | all | `.cyc__sub` at 11.5px is the smallest running text on the page. | minor | accepted — the product's tertiary size inside a window, never body copy |

Frames: `design-memory/screenshots/public-home-hifi/cycle/` — 1440 at 0/300/600/1500ms, 390 (viewport and the whole section), 1024, 768, the sixth object alone, `before-1440.png` and the two findings (`found-*.png`). Measured on the same build: no sideways scroll at four widths; the six objects 184 / 210 / 199 / 320px wide and none overflowing; the nested list's padding and borders 0; console 0 errors at every width.

### The FAQ heading holds its place (2026-09-22, the owner: «когда открывается тут надпись съезжает вниз»)

Cause: `.surface { overflow: hidden }` made the FAQ section the scroll container of its `position: sticky` heading, so the heading was positioned against the section instead of the viewport — every opened answer pushed it down with the row (1440: +65px per answer, +120px after two), and at 1024 it rested 120px below the list before any click. Fix: the FAQ surface clips with `overflow: clip` (rounded corners kept, no scrollport). Measured in Chromium at 1440, 1512 and 1024 on the fixed build: the heading rests at the grid's top (140 = 140) and moves 0px when two answers open; on scroll it sticks at 120px for as long as the row allows. Guard: the CSS test pins `.faq__heading` sticky and `.faq.surface { overflow: clip }`.

## Sign-off
- Critical and major findings closed; the minor ones too.
- Real renders of the real route on the same code, at four widths, console clean.
- 2 627 tests pass, including the rewritten guards (six tools from the catalogue, four demonstration badges, keyframes outside the selector scan, the new files authorised in the viewer-identity guard).
- Ready for the owner's review before release to PREPROD, together with slice 0.
