# TOOLS-V2 · Slice 5 · Personal Stats: screenshot review

- **Date:** 2026-09-21
- **Scope:** Personal Stats (L25) at `/tools/stats`: what the learner's own Trading Journal says, split by plan compliance.
- **Design source:** the owner's presentation «Окна инструментов ATA». The Personal Stats window shows:
  - periods 7 дней / 30 дней / Всё время;
  - «Выборка N сделок — выводы предварительные» under 50 trades;
  - figures СДЕЛОК · WIN RATE · БЕЗУБЫТОЧНОСТЬ · ПО ПЛАНУ;
  - the win rate on plan against a broken plan, with break-even marked;
  - НАРУШЕНИЯ.
- **Owner decision, 2026-09-21 in chat («разрешаю»):** win rate and percentages are allowed for this tool. This lifts DD-303's ban for Personal Stats only. Counts and shares only, never money: DD-304 holds (DD-319).
- **Carried over from the earlier slices:** the product's own tones (Lessons DNA), the same tab with «Все инструменты», no previews, every width, the first read on the server.

## Visual thesis
The window answers one question the lessons keep asking: does following the plan pay?
- the same flat Ink field, one olive-black territory with its Signal edge, Manrope with a narrow Mono layer, radius 8, no shadows;
- **four figures in one well**, as the journal's counts are: trades, win rate, break-even, on plan. Each figure says what it is made of («21 из 38», «при среднем payout 88%»);
- **the signature is the split:**
  - each side of the plan gets a 0–100% track with its win rate;
  - break-even is marked across both tracks;
  - the completed tone above the mark, the negative tone below it;
  - no tone at all for a side too small to say anything;
- the rules broken, most frequent first, each with a bar against the most frequent;
- no money anywhere.

## How the screenshots were made
- **Real browser:** Playwright Chromium (headless shell), `deviceScaleFactor` 1, locale ru-RU, time zone Europe/Warsaw, at 1440×900, 1024×768, 768×1024 and 390×844.
- **Stack:** scratch Academy dev (127.0.0.1:3059) → scratch Backend dev (127.0.0.1:3199) on the QA database copy, graph extended to L26. Nothing on PREPROD was touched. No migration: the tool only reads the journal.
- **Learners** (synthetic, scratch database only):
  - `qa-tools-stats`: L25 completed, the presentation's 38 trades over 40 days, interleaved so every window holds a mix;
  - `qa-tools-stats-empty`: L25 completed, empty journal;
  - `qa-tools-check`: L20 completed, so the tool is locked.
- **Script:** `scratchpad/tools-qa/shots-stats.cjs`. It walks: open from the tools page, all time, 30 days (held back 1.5s to see the waiting state), 7 days, keyboard focus, the empty journal, and the locked page.

## Captures (before)
`scratchpad/tools-qa/stats1/<vp>/`. The evidence for the fixed finding is kept in `design-memory/screenshots/tools-v2-personal-stats/before/`.

## Findings

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | all | Over 7 days the broken-plan side held one winning trade and showed «100% · 1 из 1» in the completed tone, above break-even. It read as «нарушать план выгодно», the opposite of the lesson, on one lucky trade. | major | fixed |
| 2 | all | While another period loads, the range label still names the period on screen («Все записи журнала» while «30 дней» is pressed). | minor | accepted: the label belongs to the figures shown, which are quieted until the new ones arrive |
| 3 | 390 | «при среднем payout 88%» wraps inside its quarter of the well. | minor | accepted (reads correctly) |
| 4 | all | Rates are whole percents, as in the presentation, so a win rate within a point of break-even can round across it. | minor | accepted: the colour follows the exact figures, not the rounded words |

## Fixes applied
1. **No verdict for a side with fewer than five trades.** That side is drawn without a tone and says «Меньше 5 сделок — рано делать вывод.» The presentation's own example keeps its colours: seven broken trades is enough.

## Captures (after)
- **Directory:** `design-memory/screenshots/tools-v2-personal-stats/final/<vp>-<state>.png` (from `stats2`), at all four viewports.
- **States:**
  - tools page with five tools open;
  - all time;
  - 30 days on its way;
  - 30 days;
  - 7 days;
  - keyboard focus;
  - the empty journal;
  - the locked page.

## Before/after comparison
- **#1:** `before/1024x768-03-one-lucky-trade-in-green` shows «План нарушен 100% · 1 из 1» in green. After, `final/1024x768-03-7d` shows the same figure with no tone and «Меньше 5 сделок — рано делать вывод.»
- **Figures checked against the presentation** (all time, `final/1440x900-01-all-time`):
  - 38 trades;
  - 55% (21 из 38);
  - 53.2% at payout 88%;
  - 82% (31 из 38);
  - 61% · 19 из 31 above the mark and 29% · 2 из 7 below it;
  - rules 3 + 2 + 2 = 7.

  The same figures are pinned by the unit tests on both sides.

**Server-side first read.** The page was opened with JavaScript OFF in a real browser context. The HTML holds all time's figures and no loading line.

## Console result
- `pageerror` and `console.error` were listened to on every page at all four viewports: 0 errors, 0 hydration warnings.
- A `popup` listener saw no new tab.
- `scrollWidth` was checked after all time and after the period switches: nothing scrolls sideways.

## Anti-generic score (ata-anti-generic-ui-review)

**Interpretation.** DNA is scored against the accepted foundation, as for the other tools. Reference ties:
- **luminous line as structure:** the territory's Signal edge, and the break-even mark across both tracks;
- **chaos → system:** the learner's own marks turn a pile of trades into two numbers that answer whether the plan pays.

| Criterion | Score |
|---|---|
| Connection to ATA DNA (accepted foundation) | 15/20 |
| Structural originality: not a KPI dashboard of cards; one well of four figures and one comparison drawn against one line | 12/15 |
| Product meaning: every figure comes from the learner's own marks; break-even is the curriculum's own formula; the split is the lesson's question; a tiny side refuses to conclude; nothing about money | 14/15 |
| Typography: 26/800 figures with their bases in words, Mono only for the labels and the range | 8/10 |
| Signature object: the split tracks with the break-even mark | 8/10 |
| Progression clarity: the sample warning, «без отметки» counts pointing back to the journal, the empty state leading to it | 8/10 |
| Mobile transformation: the well goes two by two, the split and the rules stack, the tracks keep their mark | 7/10 |
| Usability / readability: contrast (text-3 #9AA396 on #131A0E ≈ 6.8:1); visible focus (`04-keyboard-focus`); 44px period options on phones; the values are words, the bars only repeat them | 9/10 |
| **Total** | **81/100** |

Automatic-fail check:

| Condition | Result |
|---|---|
| Total ≥ 80 | PASS |
| Signature object exists | PASS |
| Not renameable to any SaaS (break-even of a binary-options payout, plan compliance, the curriculum's rules) | PASS |
| No sidebar + card grid (four figures share one well; no card grid) | PASS |
| Three identical directions | n/a (the owner fixed the direction) |
| Mobile is not a stacked desktop (the well re-composes two by two) | PASS |
| No landing-level low contrast | PASS |
| No first viewport with more than six identical cards | PASS |
| Not one shape everywhere | PASS |
| Identity not built on icons alone | PASS |
| Connection to at least two references | PASS |
| No decorative market elements (no charts of price, no money) | PASS |

Objective counts:

| Screen | Same-type cards | Surface geometries | Icon dependence | Branded objects | Hierarchy levels | Contrast problems | Unadapted landing-only |
|---|---|---|---|---|---|---|---|
| Stats, desktop | 0 (four cells of one well) | 5: field, territory, split well, tracks, rule bars | ~2% (one info mark with its words) | 3: territory Signal edge, break-even mark, split tracks | 4 | none | none |
| Stats, mobile | 0 | 5 | ~2% | 3 | 4 | none | none |

**Verdict: PASS** (81/100, no automatic fail).

Top fixes for later slices, ranked:
1. If the owner wants it, kept Entry Checklist verdicts could join the stats («сколько раз я не вошёл по стоп-фактору»).
2. A per-rule win rate (trades with that rule broken) once samples are large enough.
3. The News Calendar (L30) is the last tool of the block.

## Sign-off
- The critical and major findings are closed.
- The screenshots are real renders of the real routes, on a scratch stack with the real Backend code.
- The console is clean at every width.
- The anti-generic review passes.
- Ready for the owner's review before release to PREPROD. There is no migration in this release.
