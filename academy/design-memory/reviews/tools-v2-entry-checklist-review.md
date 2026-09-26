# TOOLS-V2 · Slice 4 · Entry Checklist: screenshot review

- **Date:** 2026-09-21
- **Scope:** the Entry Checklist (L20) at `/tools/entry-checklist`: nine fixed items before an entry, a verdict, and the checks the learner keeps.
- **Design source:** the owner's presentation «Окна инструментов ATA». The checklist window has:
  - the header «EUR/USD OTC · ПЕРЕД ВХОДОМ» with a 9-segment progress bar;
  - three groups: Среда, Setup, Моё состояние;
  - four stop factors;
  - the three verdicts in the presentation's words.

  The owner's answers of 2026-09-21: nine fixed items, everything manual, data kept server-side, no delete (DD-315, DD-318).
- **Carried over from the earlier slices:** the product's own tones (Lessons DNA), the same tab with «Все инструменты», no previews, every width, the first read on the server.

## Visual thesis
The checklist is the moment of decision made legible:
- the same flat Ink field, one olive-black territory with its Signal edge, Manrope with a narrow Mono layer, radius 8, no shadows;
- the groups classified the way Lessons classifies modules (the index tick, the Mono name);
- every item a finger-sized row. A confirmed item takes the completed tone; a stop factor says «Стоп-фактор» in the negative tone;
- **one verdict**, in its outcome's tone, standing beside the items from 900px and staying in view while they are ticked. Before the first tick it asks for one instead of greeting the learner with «не входить»;
- the checks already kept, below, so a declined trade is visible as the full decision it is.

## How the screenshots were made
- **Real browser:** Playwright Chromium (headless shell), `deviceScaleFactor` 1, locale ru-RU, time zone Europe/Warsaw, at 1440×900, 1024×768, 768×1024 and 390×844.
- **Stack:** scratch Academy dev (127.0.0.1:3059) → scratch Backend dev (127.0.0.1:3199) on the QA database copy with migration 58 applied and the graph extended to L21. Nothing on PREPROD was touched.
- **Learners** (synthetic, scratch database only):
  - `qa-tools-check`: L20 completed, no checks;
  - `qa-tools-check-history`: L20 completed, six checks over two days;
  - `qa-tools-risk`: L15 completed, so the checklist is locked.
- **Script:** `scratchpad/tools-qa/shots-check.cjs`, with `seed-check.ts` resetting both learners' checks before every width. It walks: open from the tools page, the fresh checklist, a save without the asset, a stop factor open, a condition open, all nine confirmed, the kept check, keyboard focus, six kept checks, and the locked page.

## Captures (before)
`scratchpad/tools-qa/check1/<vp>/`. The evidence for the fixed finding is kept in `design-memory/screenshots/tools-v2-entry-checklist/before/`.

## Findings

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | all | Before any tick, the verdict already said «Не входить: стоп-фактор» in the negative tone. Right after a kept «Вход допустим», the reopened checklist greeted the learner with it again, contradicting what they had just recorded. | major | fixed |
| 2 | all (a11y) | A stop factor's accessible name ran two words together («Связь стабильнаСтоп-фактор»). A screen reader would read one word. Found by the component test. | minor | fixed |
| 3 | 390, 768 | On one column the verdict comes after the nine items, out of view while ticking. | minor | accepted: «7 / 9» and the segments give live progress at the top, and the verdict is the list's conclusion |
| 4 | all | A kept check lands at the foot of the page, out of view. | minor | accepted: the toast says «Проверка записана · вход допустим / не входить» |
| 5 | all | The toast can cover a line for 2.6s. | minor | accepted, as on the other tools |

## Fixes applied
1. **No «не входить» before the learner starts.** Until the first tick the panel reads «Отметьте, что выполнено — пока ничего не отмечено, входить нельзя; вердикт появится после первой отметки», in the neutral tone. That covers a fresh checklist and every reopened one after a kept check. A check saved with nothing ticked is still kept, with the Backend's own verdict.
2. **A space in the accessible name**, so a stop factor reads «Связь стабильна Стоп-фактор».

## Captures (after)
- **Directory:** `design-memory/screenshots/tools-v2-entry-checklist/final/<vp>-<state>.png` (from `check2`), at all four viewports.
- **States:**
  - tools page with four tools open;
  - the fresh checklist;
  - a save without the asset (the focus on «Актив»);
  - a stop factor open;
  - a condition open;
  - all nine confirmed;
  - the kept check with the checklist reopened;
  - keyboard focus on an item;
  - six kept checks;
  - the locked page.

## Before/after comparison
- **#1:** `before/768x1024-06-red-verdict-right-after-a-kept-entry` shows the red «Не входить» just under a kept «Вход допустим». After, `final/768x1024-06-kept` shows «Отметьте, что выполнено». `before/1440x900-08-red-verdict-before-any-tick` against `final/1440x900-01-fresh-first-screen` shows the same fix for a fresh checklist.
- **Verdicts checked against the presentation:**
  - «Не входить: стоп-фактор» wins over any other gap (`03-stop-factor-open`, «Нет желания отыграться» open while «Цена у зоны» is also open);
  - then «Не входить: условие не выполнено» names the first open condition (`04-condition-open`);
  - then «Вход по плану допустим. Все условия выполнены. Решение и сумму вы подтверждаете сами.» (`05-all-confirmed`).

**Server-side first read.** The page was opened with JavaScript OFF in a real browser context for the learner with six checks. The HTML holds the items and «Последние проверки», and no loading line.

## Console result
- `pageerror` and `console.error` were listened to on every page at all four viewports: 0 errors, 0 hydration warnings.
- A `popup` listener saw no new tab.
- `scrollWidth` was checked after the fresh checklist and after all flows: nothing scrolls sideways.
- The validation check confirmed the focus lands on «Актив».

## Anti-generic score (ata-anti-generic-ui-review)

**Interpretation.** DNA is scored against the accepted foundation, as for the other tools. Reference ties:
- **luminous line as structure:** the territory's Signal edge and the nine progress segments;
- **chaos → system:** an impulse to enter meets nine written conditions and one verdict; the declined trade is kept.

| Criterion | Score |
|---|---|
| Connection to ATA DNA (accepted foundation) | 15/20 |
| Structural originality: a decision surface, items ↔ verdict, with the verdict held in view; no card grid, rows with one job each | 12/15 |
| Product meaning: the items are the curriculum's own (L08, L09, L13, L16–L19); the stop factors rank above the rest exactly as the lessons rank them; a «не входить» is kept as a decision; nothing is ticked for the learner | 14/15 |
| Typography: 16/800 verdict title, 14/600 items, Mono only for the group names, the header line and the stop tag | 8/10 |
| Signature object: the verdict panel with its nine-segment gauge | 7/10 |
| Progression clarity: «N / 9» and the segments; the verdict names the one open item that matters most; the neutral start says what to do | 9/10 |
| Mobile transformation: the stop tag moves under the item; 48px rows; the verdict follows the list; full-width actions | 7/10 |
| Usability / readability: contrast (text-3 #9AA396 on #131A0E ≈ 6.8:1); visible focus (`07-keyboard-focus`); 44px+ rows; native checkboxes under the rows; focus to the asset on a missing asset | 9/10 |
| **Total** | **81/100** |

Automatic-fail check:

| Condition | Result |
|---|---|
| Total ≥ 80 | PASS |
| Signature object exists | PASS |
| Not renameable to any SaaS (payout minimum, ±15 min news window, daily limit, revenge trading) | PASS |
| No sidebar + card grid | PASS |
| Three identical directions | n/a (the owner fixed the direction) |
| Mobile is not a stacked desktop (the rows re-compose; the stop tag moves) | PASS |
| No landing-level low contrast | PASS |
| No first viewport with more than six identical cards (rows in groups of three, not cards) | PASS |
| Not one shape everywhere | PASS |
| Identity not built on icons alone | PASS |
| Connection to at least two references | PASS |
| No decorative market elements | PASS |

Objective counts:

| Screen | Same-type cards | Surface geometries | Icon dependence | Branded objects | Hierarchy levels | Contrast problems | Unadapted landing-only |
|---|---|---|---|---|---|---|---|
| Checklist, desktop | 0 (nine rows in three groups) | 6: field, territory, input wells, item rows, verdict panel, buttons | ~4% (verdict icons, each with its words) | 3: territory Signal edge, group ticks, the verdict with its segments | 5 | none | none |
| Checklist, mobile | 0 | 6 | ~4% | 3 | 5 | none | none |

**Verdict: PASS** (81/100, no automatic fail).

Top fixes for later slices, ranked:
1. Personal Stats (L25) could count kept checks by verdict («сколько раз я не вошёл»), if the owner wants the checklist in the stats.
2. On phones, a compact sticky verdict line at the bottom while the list is ticked.
3. A per-item «почему» from the lessons (L08/L09) on long-press, if the owner asks for in-tool teaching.

## Sign-off
- The critical and major findings are closed.
- The screenshots are real renders of the real routes, on a scratch stack with the real Backend code.
- The console is clean at every width.
- The anti-generic review passes.
- Ready for the owner's review before release to PREPROD. The release includes migration 58 and needs a database backup first.
