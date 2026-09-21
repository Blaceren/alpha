# TOOLS-V2 · Slice 3 · Risk Calculator: screenshot review

- **Date:** 2026-09-21
- **Scope:** the Risk Calculator (L15) at `/tools/risk-calculator`: the learner's Risk Plan for binary options, kept in versions.
- **Design source:** the owner's presentation «Окна инструментов ATA» (the Risk Calculator window: four inputs, the trade amount, both outcomes, the daily limit in losing trades, the break-even win rate, a streak of five losses at a fixed amount and doubling, the scenario and the cancel condition written in advance, «Сохранить Risk Plan»). The owner's answers of 2026-09-21: rebuilt for binary options (no stop), server-side storage, no delete (DD-315, DD-317).
- **Carried over from the earlier slices:** the product's own tones (Lessons DNA), the same tab with «Все инструменты», no previews, every width, the first read on the server.

## Visual thesis
The calculator is the plan's arithmetic made visible while the learner types it:
- the same flat Ink field, one olive-black territory with its Signal edge, Manrope with a narrow Mono layer, radius 8, no shadows;
- **one figure leads:** the amount of one trade, the number the whole plan turns on, large, with its basis in words («2% от $400»);
- the Trade Card's own outcome pair, so the two tools read as one system;
- **the signature object is the streak:** two bars, each the learner's capital, filled by what five losses take of it, bounded (quiet tone) against doubling (negative tone). The bars only repeat the words; every value is written;
- the plan's status in the section head, as «Зафиксировано» is on the Trade Card; Signal lime only while the form shows the plan in force.

## How the screenshots were made
- **Real browser:** Playwright Chromium (headless shell), `deviceScaleFactor` 1, locale ru-RU, time zone Europe/Warsaw, at 1440×900, 1024×768, 768×1024 and 390×844.
- **Stack:** scratch Academy dev (127.0.0.1:3059) → scratch Backend dev (127.0.0.1:3199) on the QA database copy with migration 57 applied and the graph extended to L16. Nothing on PREPROD was touched.
- **Learners** (synthetic, scratch database only):
  - `qa-tools-risk`: L15 completed, no plan;
  - `qa-tools-risk-plan`: L15 completed, three versions, the presentation's plan in force;
  - `qa-tools-journal`: L10 completed, so the calculator is locked.
- **Script:** `scratchpad/tools-qa/shots-risk.cjs`, with `seed-risk.ts` resetting both learners' plans before every width. It walks: open from the tools page, the empty form, the presentation's numbers, a save with the rules missing, the save, a riskier unsaved change and putting the plan back, keyboard focus, the plan in force with its versions, and the locked page.

## Captures (before)
`scratchpad/tools-qa/risk1/<vp>/`. The evidence for each fixed finding is kept in `design-memory/screenshots/tools-v2-risk-calculator/before/`.

## Findings

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | 390 (all) | A learner coming back could not tell from the first screen that the numbers were their saved plan. «В силе · версия N» sat at the very end, after the rules. | major | fixed |
| 2 | all | After a change was typed but not saved, the status still said «● В силе · версия N» in Signal lime, over figures that were no longer the plan in force. | major | fixed |
| 3 | all | The note «ATA не видит ваш счёт в Pocket» sat under the share control, where it read as being about the shares, not the capital. | minor | fixed |
| 4 | all | Before the four numbers are valid, the streak's «—» took the loss colour and read as a value. | minor | fixed |
| 5 | ≥600 | A long doubling result («−$620.00 · больше капитала») wraps under its name. | minor | accepted (it wraps whole and reads correctly) |
| 6 | all | The toast («Risk Plan сохранён · версия 1») can cover a line for 2.6s. | minor | accepted, as on the other tools |
| 7 | scratch stack | The scratch graph ended at L15, so learners standing on L16 got «invalid_level_sequence» from the curriculum resolver and saw every tool locked. | QA setup | fixed in the seed (graph to L16); not a product defect |

## Fixes applied
1. **The status leads the form.** It now sits in the «Параметры» head, as «Зафиксировано» does on the Trade Card, so it is the first thing on every width.
2. **Lime only when true.** «В силе · версия N · с …» is Signal while the form shows the plan in force. After a change it becomes the quiet «Версия N · изменения не сохранены», and «Вернуть план в силе» puts the plan back.
3. **The capital note sits under the capital.** On a tablet the capital spans two columns beside the payout, and the limit stands beside the shares. The note fits there, and the four inputs make two even rows.
4. **An empty figure is quiet.** The streak's «—» uses the text tone until there is a figure.

## Captures (after)
- **Directory:** `design-memory/screenshots/tools-v2-risk-calculator/final/<vp>-<state>.png` (from `risk2`), at all four viewports.
- **States:**
  - tools page with three tools open;
  - the empty form;
  - the presentation's numbers ($400, 90%, 2%, 6%);
  - a save with the rules missing (the focus on «Сценарий»);
  - version 1 saved;
  - a riskier unsaved change (5% against a 3% limit: the limit is under one trade, doubling outruns the capital);
  - keyboard focus on the shares;
  - the plan in force with two earlier versions;
  - the locked page.

## Before/after comparison
- **#1:** `before/390x844-07-status-only-at-the-end` shows the first screen with no status. After, `final/390x844-07-plan-in-force-first-screen` shows «● В силе · версия 3 · с 21 сентября, 18:48» under «Параметры».
- **#2:** `before/1024x768-05-lime-status-on-unsaved-numbers` shows lime «В силе · версия 1» over the 5% figures. After, `final/1024x768-05-changed-risky` shows «Версия 1 · изменения не сохранены», quiet.
- **#3:** `before/1440x900-02-capital-note-under-the-shares` shows the note under the shares. After, `final/1440x900-02-numbers` shows it under the capital, and `final/768x1024-01-empty-first-screen` shows the two even rows of the tablet grid.
- **#4:** `before/1440x900-01-empty-dashes-in-loss-colour` shows rose dashes. After, `final/1440x900-01-empty-first-screen` shows quiet ones.

**Figures checked against the presentation:**
- «$8.00 · 2% от $400», «+$7.20 / −$8.00»;
- «$24.00 · 3 убыточные сделки → стоп», «52.6%»;
- «−$40.00 · 10%» and «−$248.00 · 62%», with «8 + 16 + 32 + 64 + 128».

The same figures are pinned by the unit tests on both sides.

**Server-side first read.** The page was opened with JavaScript OFF in a real browser context for the learner with a plan. The HTML holds «В силе · версия 3» and no loading line.

## Console result
- `pageerror` and `console.error` were listened to on every page at all four viewports: 0 errors, 0 hydration warnings.
- A `popup` listener saw no new tab.
- `scrollWidth` was checked after the empty form and after all flows: nothing scrolls sideways.
- The validation check confirmed the focus lands on «Сценарий».

## Anti-generic score (ata-anti-generic-ui-review)

**Interpretation.** DNA is scored against the accepted foundation, as for the other tools. Reference ties:
- **luminous line as structure:** the territory's Signal edge, and the Signal status of the plan in force;
- **chaos → system:** the doubling bar shows the chaos a martingale brings, against the bounded bar of a fixed amount; the plan's rules are written before trading.

| Criterion | Score |
|---|---|
| Connection to ATA DNA (accepted foundation) | 15/20 |
| Structural originality: an inputs ↔ consequences split that re-orders on a phone into the order a plan is made (numbers → arithmetic → streak → rules → save); no card grid | 12/15 |
| Product meaning: every figure is the curriculum's own (L11–L14); the capital is labelled as the learner's number, not a balance; the streak compares the two betting rules the lessons contrast; versions keep the plan's history | 14/15 |
| Typography: one 32/800 lead figure, the Trade Card's outcome scale, Mono only for the status | 8/10 |
| Signature object: the two capital bars of the losing streak | 8/10 |
| Progression clarity: the empty state says what to fill; the status says whether the plan is in force; the save is disabled when there is nothing new | 9/10 |
| Mobile transformation: the two columns dissolve and re-order; the inputs make a phone grid of their own; 48px controls; full-width actions | 8/10 |
| Usability / readability: contrast (text-3 #9AA396 on #131A0E ≈ 6.8:1); visible focus (`06-keyboard-focus`); 44px+ touch targets on phones; focus to the first field in error; no overflow | 9/10 |
| **Total** | **83/100** |

Automatic-fail check:

| Condition | Result |
|---|---|
| Total ≥ 80 | PASS |
| Signature object exists | PASS |
| Not renameable to any SaaS (payout, binary-options risk, martingale, the curriculum's Risk Plan) | PASS |
| No sidebar + card grid | PASS |
| Three identical directions | n/a (the owner fixed the direction) |
| Mobile is not a stacked desktop (the sections re-order) | PASS |
| No landing-level low contrast | PASS |
| No first viewport with more than six identical cards | PASS |
| Not one shape everywhere | PASS |
| Identity not built on icons alone | PASS |
| Connection to at least two references | PASS |
| No decorative market elements (the bars encode the share of capital) | PASS |

Objective counts:

| Screen | Same-type cards | Surface geometries | Icon dependence | Branded objects | Hierarchy levels | Contrast problems | Unadapted landing-only |
|---|---|---|---|---|---|---|---|
| Calculator, desktop | 0 | 7: field, territory, input wells, share control, split outcome well, capital bars, buttons | ~3% (two info marks, both with text) | 3: territory Signal edge, plan status, streak bars | 5 | none | none |
| Calculator, mobile | 0 | 7 | ~3% | 3 | 5 | none | none |

**Verdict: PASS** (83/100, no automatic fail).

Top fixes for later slices, ranked:
1. The Entry Checklist (L20) could name the plan in force («по Risk Plan, версия 3») where its items speak of the daily limit, once the owner allows cross-tool reading.
2. A pinned save on phones for long rule texts.
3. A compare view between two versions of the plan.

## Sign-off
- The critical and major findings are closed.
- The screenshots are real renders of the real routes, on a scratch stack with the real Backend code.
- The console is clean at every width.
- The anti-generic review passes.
- Ready for the owner's review before release to PREPROD. The release includes migration 57 and needs a database backup first.
