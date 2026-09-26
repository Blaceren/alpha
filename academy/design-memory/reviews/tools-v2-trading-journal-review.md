# TOOLS-V2 · Slice 2 · Trading Journal: screenshot review

- **Date:** 2026-09-21
- **Scope:** the Trading Journal (L10) at `/tools/journal`, and what changed on the Trade Card with it: a card saved after L10 goes into the journal, and «Разобрать в журнале» opens its review.
- **Design source:** the owner's presentation «Окна инструментов ATA» (journal: counts, filters «Все / План нарушен / Нет вывода», a line per trade, ПЛАН · ИСПОЛНЕНИЕ · ВЫВОД) and the owner's answers of 2026-09-21 (DD-315, DD-316).
- **Carried over from the Trade Card review:** the product's own tones (Lessons DNA), the same tab with «Все инструменты», no previews, every width, the first read on the server.

## Visual thesis
The journal is the Trade Card's second half, so it keeps the Trade Card's language and adds only what a record of many trades needs:
- the same flat Ink field, one olive-black territory with its Signal edge, Manrope with a narrow Mono layer, radius 8, no shadows;
- days classified the way Lessons classifies modules (the index tick, the Mono date, the weekday in words), so the list reads as the product's own reference grammar and not as a data table;
- a ledger line per trade whose columns line up down the day from 900px;
- the review opening in place, under its own line, with the plan written before the trade kept in view;
- counts of entries only; money appears only as one trade's own stake and result (DD-303/DD-304).

## How the screenshots were made
- **Real browser:** Playwright Chromium (headless shell), `deviceScaleFactor` 1, locale ru-RU, time zone Europe/Warsaw, at 1440×900, 1024×768, 768×1024 and 390×844.
- **Stack:** scratch Academy dev (127.0.0.1:3059) → scratch Backend dev (127.0.0.1:3199) on a copy of the QA database with migration 56 applied. Nothing on PREPROD was touched.
- **Learners** (synthetic, scratch database only):
  - `qa-tools-journal`: L10 completed, 24 entries over five weeks, both sources, some reviewed, some with broken rules, two in December 2025;
  - `qa-tools-empty`: L10 completed, empty journal;
  - `qa-tools-l11`: L10 completed, saves a Trade Card into the journal;
  - `qa-tools-locked`: L2 completed.
- **Script:** `scratchpad/tools-qa/shots-journal.cjs`. It walks the real flows: open from the tools page, open an entry, review it, filter, load the next page, record a trade, edit it, keyboard focus, the empty and locked journal, and a card saved into the journal.

## Captures (before)
`scratchpad/tools-qa/journal1/<vp>/`. The evidence for each fixed finding is kept in `design-memory/screenshots/tools-v2-trading-journal/before/`.

## Findings

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | all | Changing the filter replaced the whole list with one loading line; the territory collapsed and sprang back when the page arrived. | major | fixed |
| 2 | all | «Разобрать в журнале» on a saved card landed on the list. The learner had to find the trade, open it and press «Разобрать сделку»: the button promised a review and delivered a list. | major | fixed |
| 3 | 390 (all) | «Сохранить запись» with a field missing left the focus on the button. On a phone the errors were above the fold, so nothing visibly happened. | major | fixed |
| 4 | 390 | «План нарушен» wrapped onto two lines in the filter. | minor | fixed |
| 5 | 390 | The asset list's empty option was cut to «Выберите акти…» in a half column. The Trade Card had the same cut. | minor | fixed |
| 6 | ≥600 | The two-way question «План соблюдён?» stretched across the whole review, up to 800px wide. | minor | fixed |
| 7 | ≥600 | A lone «Изменить разбор» stretched to 460px. | minor | fixed |
| 8 | ≥900 | Review text fields ran about 800px wide, a hard measure to write in. | minor | fixed |
| 9 | all | The headless shell shows date and time inputs in US format. A browser with a Russian locale shows 21.09.2026 and 18:27. | minor | environment only |
| 10 | all | The toast («Разбор сохранён», «Запись добавлена») can cover a line for 2.6s. | minor | accepted, as on the Trade Card (transient, no pointer events) |

## Fixes applied
1. **The list stays while a filter's page travels.** The lines on screen stay, quieted to 45% and not clickable. «Загружаю записи…» is said to assistive technology in a status region that exists before anything is said in it. A newer choice still wins over an older read.
2. **The card opens its own review.** «Разобрать в журнале» carries the card's id (`/tools/journal?card=<id>`). The page accepts only an id-shaped value; the id selects among the entries the Backend already sent and reaches no request. That entry opens straight into its review, focused on «По плану». The address is then cleaned, so a reload shows the journal and not the same review again. It works both with the server's first read and with the browser's.
3. **Focus goes to the first field in error**, in reading order: the control itself, or a toggle's first option. The same happens for a field the Backend refuses, in the form or in a review.
4. **Filter options are as wide as their words**, and do not wrap.
5. **The empty option says «Выберите»**, as the expiry's does. This changes both tools; the label above already names the field.
6. **The review keeps a 680px measure**, and the two-way question is a compact control of at most 360px.
7. **A lone action is as wide as its words** (at least 200px) from 600px. On a phone actions still take the full width.

## Captures (after)
- **Directory:** `design-memory/screenshots/tools-v2-trading-journal/final/<vp>-<state>.png` (from `journal2`), at all four viewports.
- **States:**
  - tools page with two tools open;
  - the list (first screen; full page at 1440 and 390);
  - an entry open;
  - the review form;
  - a filter's page on its way;
  - the next page down to December 2025, where the year appears;
  - «Новая запись»: empty, after a save with fields missing, filled, then saved;
  - keyboard focus on a line;
  - the empty journal;
  - the Trade Card saved into the journal;
  - the review opened from the card;
  - the locked journal.

## Before/after comparison
- **#1:** `before/1440x900-05-filter-collapsed-while-loading` shows the territory reduced to «Загружаю записи…». After, `final/1440x900-05a-filter-waiting-first-screen` (captured with the page held back for 1.5s) shows the same lines quieted, with «План нарушен 7» already pressed.
- **#2:** `before/1440x900-16-card-link-lands-on-list` shows the list with the new entry closed. After, `final/*-16-journal-review-from-card-first-screen` shows the entry open in its review. The script checked that the focus is on «По плану» and that the address has no query.
- **#3 and #5:** `before/390x844-09-asset-placeholder-cut-no-focus` shows the full-page errors with the asset cut. After, `final/390x844-09a-new-validation-first-screen` shows the phone viewport scrolled to «Актив», focused, reading «Выберите». The script checked `document.activeElement` is the asset select.
- **#4:** `before/390x844-01-filter-label-wraps` shows «План / нарушен». After, `final/390x844-01-journal-list-first-screen` shows one line.
- **#6 and #8:** `before/768x1024-10-two-way-control-full-width` shows the question across 670px. After, `final/768x1024-10-new-filled` shows it at 360px, and at 1440 `final/1440x900-16-*` shows the review at its 680px measure.
- **#7:** `before/1440x900-04-lone-button-stretched` against `final/1440x900-04-review-saved-first-screen`, where «Изменить разбор» is as wide as its words.

**Server-side first read.** The page was opened with JavaScript OFF in a real browser context. The HTML holds the counts, the days and the lines, and no loading line. The script's first version flagged this as missing because `innerText` applies `text-transform` («ЗАПИСЕЙ»); the check is case-insensitive now, and the page was right all along.

## Console result
- `pageerror` and `console.error` were listened to on every page at all four viewports: 0 errors, 0 hydration warnings.
- A `popup` listener saw no new tab or window.
- `scrollWidth` was checked after the list and after all flows: nothing scrolls sideways at any width.

## Anti-generic score (ata-anti-generic-ui-review)

**Interpretation.** As for the Trade Card, DNA is scored against the accepted foundation (Ink + Signal, UNIFIED-DESIGN-V1), which the owner asked for («как на других страницах продукта»). Two reference ties hold:
- **luminous line as structure:** the territory's Signal edge and the index tick that classifies each day;
- **chaos → system:** an impulsive trade becomes a reviewed record with named rules, and «План нарушен» turns the pattern into a filter.

| Criterion | Score |
|---|---|
| Connection to ATA DNA (accepted foundation) | 15/20 |
| Structural originality: a day-classified ledger with in-place disclosure, not a table and not a card grid; the review opens under its own line; the form splits the trade's facts from the learner's judgement | 12/15 |
| Product meaning: counts are entries, never money; the mark is the learner's own; the eight rules are the curriculum's discipline rules; the plan written before the trade stays in view while it is judged; the source says whether a plan existed | 14/15 |
| Typography: the Trade Card's scale; Mono only for the day, the counts' labels, the notes' terms and the mark | 8/10 |
| Signature object: the ledger line with its plan mark (● ПО ПЛАНУ · ● НАРУШЕН · ○ НЕ ОТМЕЧЕНО) and the ПЛАН · ИСПОЛНЕНИЕ · ВЫВОД triad | 7/10 |
| Progression clarity: unreviewed lines say «Не отмечено»; «Разобрать сделку» is the primary action only until a review exists; the card leads straight into its review; the empty journal names both ways in | 9/10 |
| Mobile transformation: the ledger line recomposes into two lines (what and how it ended; when, how much and the mark); the direction becomes its arrow; the rules become a one-column checklist of 44px targets; the notes stack; the form follows the Trade Card's grid | 8/10 |
| Usability / readability: contrast (text-3 #9AA396 on #131A0E ≈ 6.8:1); visible focus ring (`13-row-keyboard-focus`); 44px+ touch targets on phones; focus managed into forms, back to the line and to the first error; no overflow | 9/10 |
| **Total** | **82/100** |

Automatic-fail check:

| Condition | Result |
|---|---|
| Total ≥ 80 | PASS |
| Signature object exists | PASS |
| Not renameable to any SaaS (payout, expiry, OTC assets, plan compliance, rules of this curriculum, Pocket) | PASS |
| No sidebar + card grid | PASS |
| Three identical directions | n/a (the owner fixed the direction) |
| Mobile is not a stacked desktop (the ledger line and the rules are re-composed) | PASS |
| No landing-level low contrast | PASS |
| No first viewport with more than six identical cards (lines, not cards) | PASS |
| Not one shape everywhere | PASS |
| Identity not built on icons alone | PASS |
| Connection to at least two references | PASS |
| No decorative market elements (no charts, no tickers, no totals) | PASS |

Objective counts:

| Screen | Same-type cards | Surface geometries | Icon dependence | Branded objects | Hierarchy levels | Contrast problems | Unadapted landing-only |
|---|---|---|---|---|---|---|---|
| Journal list, desktop | 0 (ledger lines) | 6: field, territory, split counts well, filter control, line hover plate, buttons | ~4% (plus and chevron, both paired with text or `aria-expanded`) | 3: territory Signal edge, day index tick, plan mark | 5 | none | none |
| Journal list, mobile | 0 | 6 | ~8% (the direction arrow stands alone; its word stays for assistive technology) | 3 | 5 | none | none |
| Review and «Новая запись», desktop | 0 | 7: + input wells, rule checklist, outcome well | ~3% | 3 | 5 | none | none |
| Review and «Новая запись», mobile | 0 | 7 | ~3% | 3 | 5 | none | none |

**Verdict: PASS** (82/100, no automatic fail).

Top fixes for later slices, ranked:
1. Personal Stats (L25) should read the same marks and rules, so the journal's words become the stats' axes.
2. A pinned primary action on phones for the long «Новая запись» form.
3. On a very long day, a sticky day heading would keep the date in view while scrolling.

## Sign-off
- The critical and major findings are closed.
- The screenshots are real renders of the real routes, on a scratch stack with the real Backend code.
- The console is clean at every width.
- The anti-generic review passes.
- Ready for the owner's review before release to PREPROD. The release includes migration 56 and needs a database backup first.
