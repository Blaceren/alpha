# TOOLS-V2 · Slice 1 · Trade Card: screenshot review

> **Round 0** (below the round-1 section) reviewed the first release, the presentation's window look opening in a new tab. The owner reviewed it and asked for changes; **round 1** is the current state.

- **Date:** 2026-09-21
- **Scope:** the new «Инструменты» page and the Trade Card tool (L5). Since round 1 the tool opens in the same tab; round 0 opened it in a new one.
- **Design source:** the owner's presentation «Окна инструментов ATA» and the owner's answers of 2026-09-21 (DD-315).

---

# Round 1 — after the owner's review (2026-09-21)

## What the owner asked for
1. **Tones.** The design used outdated tones, not the ones on the product's other pages.
2. **Previews.** No «Как будет выглядеть» buttons and no demo preview.
3. **All screens.** The tool must be adapted to every screen size.
4. **Same tab.** A tool opens in the same tab, and the tool has a button back to all the other tools.

## Visual thesis for this round
The owner's direction is «как на других страницах продукта». The thesis is therefore the Lessons DNA, the most recent authenticated high-fi (reference captures of Главная, Уроки, Поддержка and Профиль were taken on the same stack before the redesign):
- flat Ink field, from the frozen shell;
- one olive-black territory with a short Signal segment on its top edge;
- Manrope-first type with a narrow Mono precision layer;
- lines with jobs, radius 8, no shadows;
- Signal reserved for the primary action, the current step and focus;
- results in the product's existing pair: route-completed for gain, the Support/old-tools rose for loss.

## Captures (before)
Directory: `scratchpad/tools-qa/screens2/<vp>/`, the first pass of the redesign at 1440×900, 1024×768, 768×1024 and 390×844.

## Findings

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | all | Every open of the Trade Card showed «Загружаю карточку…» first, then the territory jumped to its real height (client-only first read). | major | fixed |
| 2 | all | The locked tool page had no next step; the product rule is «один очевидный следующий шаг». | major | fixed |
| 3 | 390 | The step labels were truncated again («Подготов…», «Экспирац…») because the territory adds its own padding. | major | fixed |
| 4 | 390 | Some touch targets were under 44px: segmented options 36px, «Сделку не открывал» ~32px, «Все инструменты» 40px. | major | fixed |
| 5 | 390 | Action buttons wrapped at uneven widths. | minor | fixed |
| 6 | 390 | The toast covers part of the form above the bottom navigation for 2.6s. | minor | accepted (transient, no pointer events) |
| 7 | all | The headless shell shows `<input type="time">` in 12-hour format. A browser with a Russian locale shows 24-hour time. | minor | environment only |
| 8 | all | «Открыто 1 из 6» and «Уровень 5» are 11px tracked Mono. This is the Lessons count pattern («6 МАТЕРИАЛОВ»), used for meta only. | minor | accepted (product pattern) |

## Fixes applied
1. **Server-side first read** (`src/server/tools/trade-card-read.ts`).
   - The page arrives with the card or the empty plan already drawn.
   - Anything that depends on the learner's clock or time zone waits for the browser (`useSyncExternalStore`). That covers the default entry time, the steps that follow it, and «Зафиксировано HH:MM». Without the wait, hydration would mismatch, because the server runs in UTC.
2. **Next step on the locked page:** «Продолжить путь» → /path.
3. **Phone stepper:** bars plus one line, «Шаг N из 5 · …». The labels stay in the list for assistive technology and are shown from 600px.
4. **Phone controls:**
   - fields and segmented controls are 48px and aligned, with 44px options;
   - «Сделку не открывал» and «Все инструменты» are 44px;
   - pointer sizes return from 600px.
5. **Action buttons** stand side by side where they fit and take the full width where they do not.

## Captures (after)
- **Directory:** `design-memory/screenshots/tools-v2-trade-card/final/<vp>-<state>.png` (from `screens4`), at 1440×900, 1024×768, 768×1024 and 390×844.
- **States:**
  - tools page for a learner past L5, and its keyboard focus;
  - empty plan, validation, fixed, result, saved and cancel-confirm;
  - tools page for a learner at L3;
  - locked tool;
  - earned-but-unbuilt tool.

Before/after comparison:
- **#1:** checked with JavaScript OFF in a real browser context. The server HTML of /tools/trade-card holds «Параметры до входа» and no loading line, on every viewport. The first attempt at this check read the page through Node's request client. That client does not send the Secure session cookie over plain http, so it was reading /login and passed vacuously. It was replaced by the browser-context check before any result was trusted.
- **#2:** `390x844-10-card-locked`. Before, the panel ended at the reason. After, it ends at «Продолжить путь».
- **#3:** `390x844-06-card-result`. Before, «Подготов… Экспирац…». After, bars plus «Шаг 5 из 5 · Разбор».
- **#4 and #5:** `390x844-06-card-result`. The select and the segmented control share one 48px row, and «Сохранить карточку» / «Изменить план» take the full width.
- **Unchanged since the first pass of this round:** the desktop layout (plan on the left; outcomes and actions in a sticky right column from 900px) and the same-tab navigation. A popup listener recorded no new tab on any viewport, and «Все инструменты» returns to /tools in the same tab.

## Console result
- `pageerror` and `console.error` listeners were attached on every page, at all four viewports: 0 errors, 0 hydration warnings.
- No dev-only HMR noise was captured as an error.
- **Rate limit during the re-shoot.** The Backend's per-learner write limit (40 per 10 minutes) answered 429 to one cancel. That is the limiter working as designed. The scratch Backend was restarted to clear its in-memory limiter, and the pass was re-run clean.

## Anti-generic score (ata-anti-generic-ui-review)

**Interpretation.** The rubric's DNA row names the provisional prelanding palette (navy, cold blue, cyan). `src/styles/tokens.css` records that this palette was a placeholder, since replaced by the accepted UNIFIED-DESIGN-V1 foundation (Ink + Signal). The owner asked to match the product's current pages, so DNA is scored against the accepted foundation. Two reference ties still hold:
- **luminous line as structure:** the lifecycle rail and the territory's Signal edge;
- **chaos → system:** the card turns an impulse into a written plan before the button is pressed.

| Criterion | Score |
|---|---|
| Connection to ATA DNA (accepted foundation) | 15/20 |
| Structural originality: not sidebar/card grid; a plan ↔ consequence split with a sticky outcome column and a lifecycle rail; the index reuses Lessons grammar by owner request | 11/15 |
| Product meaning: level marks = unlock level, lock line = when it opens, rail = the trade's own clock, outcome pair = one trade's two consequences (no aggregates), commitment stamp, «ATA сделки не открывает» | 14/15 |
| Typography: 22/800 titles, 15/700 sections, 12.5/600 labels, 22/800 amounts, Mono only for precision tags | 8/10 |
| Signature object: the lifecycle rail tied to the learner's clock + commitment stamp + two-outcome well | 7/10 |
| Progression clarity: unlock-order index with «Открыто 1 из 6» and lock levels; steps + hint; locked page → «Продолжить путь» | 9/10 |
| Mobile transformation: rail becomes bars + one step line; 48px controls; full-width actions; index state moves under the description; plan → outcome → act order kept | 7/10 |
| Usability / readability: contrast (text-3 #9AA396 on #131A0E ≈ 6.8:1), visible focus ring (`01b-hub-keyboard-focus`), 44px+ touch targets, no overflow at 390 | 9/10 |
| **Total** | **80/100** |

Automatic-fail check:

| Condition | Result |
|---|---|
| Total ≥ 80 | PASS |
| Signature object exists | PASS |
| Not renameable to any SaaS (Pocket, payout, expiry, level gating, the lifecycle rail) | PASS |
| No sidebar + card grid | PASS |
| Three identical directions | n/a (the owner fixed the direction) |
| Mobile is not a stacked desktop (the rail, control and action layers are re-composed; content order kept on purpose) | PASS |
| No landing-level low contrast | PASS |
| No first viewport with more than six identical cards (six rows in one territory) | PASS |
| Not one shape everywhere (see geometries below) | PASS |
| Identity not built on icons alone | PASS |
| Connection to at least two references | PASS |
| No decorative market elements | PASS |

Objective counts:

| Screen | Same-type cards | Surface geometries | Icon dependence | Branded objects | Hierarchy levels | Contrast problems | Unadapted landing-only |
|---|---|---|---|---|---|---|---|
| Tools page, desktop | 0 (rows, not cards) | 3: field, territory, row hover plate | 0% (every icon paired with text) | 2: territory Signal edge, level index marks | 4 | none | none (Mono meta is the Lessons pattern) |
| Tools page, mobile | 0 | 3 | 0% | 2 | 4 | none | none |
| Tool page (plan/fixed), desktop | 0 | 7: field, territory, input well, segmented control, split outcome well, lifecycle rail, buttons | ~5% (info, arrows, check, all paired with text) | 3: lifecycle rail, commitment stamp, outcome pair | 5 | none | none |
| Tool page, mobile | 0 | 7 | ~5% | 3 | 5 | none | none |

**Verdict: PASS** (80/100, no automatic fail).

Top fixes for later slices, ranked:
1. Give the lifecycle rail more presence while the trade runs, for example the expiry countdown in the rail. This would strengthen the signature.
2. On phones, a pinned primary action («Зафиксировать план» / «Сохранить карточку») would keep the next step reachable during long plans.
3. Lesson links to tools could say, in context, which tool the lesson unlocks.

## Sign-off
- The critical and major findings are closed.
- The screenshots are real renders of the real routes.
- The console is clean.
- The anti-generic review passes.
- Ready for the owner's second review on PREPROD.

---

# Round 0 — the first release (superseded)

## How the screenshots were made
- **Real browser:** Playwright Chromium (headless shell 149).
- **Stack under test:** Academy `next dev` on 127.0.0.1:3059, then Backend `next dev` on 127.0.0.1:3199, then a scratch SQLite database.
- **Data:** the database was seeded with the first 12 ATA levels (real titles) and three synthetic learners:
  - completed through L5, so the Trade Card is open;
  - completed through L2, so it is locked;
  - completed through L10, so the Journal is earned but not built.
- **Real paths:** every screenshot is a real render of the real routes, fed by the real BFF proxy and the real Backend API. No PREPROD data was involved.
- **Viewports:** 1440×900, 1024×768 and 390×844 (390 with touch and mobile emulation).
- **Full-page images:** these lay the tool window's sticky header and footer out in flow, because a full-page capture cannot show them where a reader sees them. The `*-first-screen` image keeps the real sticky rendering.
- **Time input:** the headless shell shows `<input type="time">` in 12-hour format («02:32 PM»). Browsers with a Russian locale show 24-hour time. The value is `14:32` either way.

Files: `design-memory/screenshots/tools-v2-trade-card/final/<viewport>-<state>.png`

| State | File suffix |
|---|---|
| Tools page, learner past L5 | `01-hub-open-learner` |
| Trade Card, empty plan (first screen) | `02-card-empty-first-screen` |
| Empty plan submitted: every missing field named | `03-card-validation` |
| Plan fixed (badge «Зафиксировано», steps by clock, fields read-only) | `05-card-fixed` |
| Result picked, observation written | `06-card-result` |
| Card saved | `07-card-saved` |
| «Сделку не открывал» confirmation | `08-card-cancel-confirm` |
| Tools page, learner at L3 | `09-hub-locked-learner` |
| Trade Card locked | `10-card-locked` |
| Locked, example shown | `11-card-locked-preview` |
| Journal earned but not built («Скоро») | `14-journal-soon` |

## What the first pass found, and what changed

| # | Finding | Fix |
|---|---|---|
| 1 | Server error on the locked page: the example card rendered the form on the server and handed `<select>`/`<button>` event handlers across the server/client boundary. The unit suite (jsdom) cannot see this; the live stack did. | `trade-card-parts.tsx` is a client module; the server passes plain values only. |
| 2 | The tools page had no gutter from 900px up: the shell's main area carries no padding there, and the title sat at x=0. | Support's measure and centring (1080px, auto margins) plus its own padding from 900px. |
| 3 | The placeholders «8» and «90» in Сумма/Payout read like values already entered. | Removed; the fields start empty. |
| 4 | At 390px the step labels were cut («Подготов…», «Экспирац…»). | The labels scale with the viewport (10–12px) with a slightly tighter gap; all five fit at 390. |

- **Re-shoot after fix 4:** the 390 set was re-shot. At 1440 and 1024 the label size is unchanged (it caps at 12px); only a −0.01em letter-spacing applies there. The 1440 card states were re-shot after the change. The remaining desktop images predate it by that letter-spacing alone: the Backend's login rate limit (5 per 10 minutes) stopped the second re-shoot, which is intended behaviour.

## Checked and accepted
- **Hub (1440/1024):**
  - Six rows in unlock order, each with its level mark, name and one line from the presentation.
  - One action per row: «Открыть ↗» opens a new tab, locked rows show «🔒 Откроется на уровне N», an earned but unbuilt tool shows «Скоро».
  - For a locked built tool, a quiet «Как будет выглядеть» link.
  - The footer line: «не торговые сигналы».
- **Hub (390):** the action drops under the text and the bottom navigation is clear.
- **Tool tab:**
  - A narrow column (max 480px) centred on wide screens, with side rules on a darker ground: the column the learner will dock next to Pocket.
  - Header «ATA · Trade Card · L05 · ×».
  - Footer «Инструмент обучения, не торговый сигнал».
- **Card:**
  - Mono labels, serif for the learner's own text and for the two amounts, and the lime primary button.
  - The five steps follow the learner's clock. Example: entry 16:27, expiry 1 min, so «Экспирация» is current and the hint reads «Экспирация в 16:28:00».
  - Outcome arithmetic is correct: $12.50 at 82% gives +$10.25 / −$12.50, and $8 at 90% gives +$7.20 / −$8.00.
  - Save stays disabled until a result is picked, and says why.
- **Locked page:** «Закрыто · сейчас L3», «Откроется на уровне 5», the lesson named by its title, and the example labelled «Пример данных».
- **Console and page errors:** none reported across all three viewports, after fix 1.

## Not covered here
- **PREPROD:** the owner reviews on PREPROD with their own learner. This review is the pre-release pass.
- **Lesson links:** links from lesson content to a tool still open in the same tab and are redirected to the new address. Opening them in a new tab is a later change.
