# OWNER FIXES 2026-10-01 — screenshot review

- **Date:** 2026-10-01
- **Scope:** five fixes the owner asked for, on two surfaces:
  - the public home — the strip under the review window (`#review`), the route's line and nodes,
    the cycle (`#mechanism`);
  - the Trading Journal (`/tools/journal`) — an entry changed whole, an entry deleted.
- **Owner, 2026-10-01** (with five screenshots):
  1. «тут в блоках убрать V1, Разбор, V2, галочку — это не нужное, там и так расписано, что это есть;
     улучши, доведи до хай-фая»;
  2. «тут и дальше по анимации цифры за полосой, она их перекрывает и это не красиво; отсмотри и
     улучши до хай-фая»;
  3. «центрировать карточки и их содержимое по центру, сделать цифры более видимыми, убрать
     перекрытие; улучши, доведи до хай-фая»;
  4. «функционал изменения записи полноценный»;
  5. «кнопка и функционал удаления записи полноценный».
- **Decisions:** DD-328 (journal), DD-329 (public home).
- **Design source: no new composition.** The three home blocks keep their accepted structure
  (DD-321…DD-325); the journal keeps its ledger and its form (DD-316). What changed is inside them:
  a badge removed, a line put under its nodes, a column centred, two actions and one question added
  to an entry's own row of actions. The question follows the product's own inline confirmation
  (`tc-confirm`, the Trade Card's «Сделку не открывал»). Because nothing structural was invented,
  the art-direction gate (three low-fi compositions and a choice) was not run. That is a judgement,
  and it is stated to the owner in the report.

## Visual thesis

**Home.** The line is the structure, and a node stands ON it: a number is never behind the line and
never smaller than the words around it. The order of the four states of a review is carried by the
strip itself, not by a code on every card. A step of the cycle is one centred column — node, word,
meaning, the product object it happens in — and nothing else crosses it.

**Journal.** The record is the learner's own. Changing it and deleting it are real controls, the
same for every entry, and they read in the order of their weight: the review first, the edit beside
it, the delete apart and in the tone of a loss. Deleting is asked about where the entry is, in
words that say what goes with it and what stays; the question's default is the way out.

## How the screenshots were made

- **Real browser:** Playwright Chromium (headless), `deviceScaleFactor` 1 (close-ups marked `@2x`
  at 2), locale ru-RU, fonts awaited.
- **Stand:** Academy dev `127.0.0.1:3059` → Backend dev `127.0.0.1:3199`, a throwaway SQLite copy
  with all 60 migrations. Synthetic learners of the scratch database only
  (`qa-tools-journal@…`, `qa-tools-stats@…` on `example.invalid`); nothing from PREPROD.
- **Home blocks** are photographed as one clip in a viewport tall enough to hold the whole block at
  the given WIDTH (1440, 1280, 1024, 768, 390, 360): an element screenshot taller than the viewport
  is stitched while the page scrolls and drops finished reveals. The «before» frames were re-taken
  the same way from the released files, so each pair differs only in the code.
- **Journal** frames are full pages at 1440×900, 1024×768, 768×1024 and 390×844; the close-ups are
  clips of one open entry, also at 600, 360 and 320 wide.
- **Dev-only artefacts:** the Next.js dev indicator is hidden by an injected rule; the fixed bottom
  navigation is made static for full-page frames so it is not photographed mid-page. In a headless
  browser the native date and time fields render in the browser's own (en-US) format — the
  learner's browser shows its own locale.

## Captures (before)

`design-memory/screenshots/owner-fixes-2026-10-01/before/`

- `home-1-review-strip-w{1440,768,390}.png` — the strip with «V1 · Разбор · V2 · ✓».
- `home-2-route-w{1440,390}.png`, `home-2-route-start-{1440x900,390x844}.png`,
  `home-2-route-nodes-zoom.png` — the drawn line through «L1» and «L2».
- `home-3-cycle-w{1440,1280,1024,768,390}.png`, `home-3-cycle-nodes-zoom.png` — the cycle: 23px
  nodes with 7px numbers at the left edge of fenced columns; on a phone, the line down the left
  edge through the first letters of every paragraph.
- `journal-entry-open-{1440x900,1024x768,768x1024,390x844}.png` — a hand-recorded entry: «Изменить
  запись» as bare text, no delete.
- `journal-card-entry-open-{1440x900,390x844}.png` — an entry from a card: review only.

## Findings

| # | Surface · viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | Home strip · all | Every card opened with a code («V1», «Разбор», «V2», «✓») for what its title already says | major (owner) | fixed |
| 2 | Home strip · all | With the badges gone nothing showed which state the window is on, or which are behind it | major | fixed — a 2px rail on the card's top edge: reached, active |
| 3 | Home route · all | The drawn part of the line was painted over «L1», «L2» and every node label | major (owner) | fixed |
| 4 | Home route · all | Raising the nodes with `z-index` did not help: the list is revealed with a transform, so it is a stacking context of its own and the line (the container's last child) still painted above it | major | fixed — both parts of the line are ONE first-child pseudo-element |
| 5 | Home route · all | A passed node's label was 8px in a 26px ring (24px on phones); a step's 11px in 42px (10px in 34px on phones) | major | fixed — 10px in 30px and 12px in 44px; on phones 9.5px in 28px and 11px in 38px; nodes opaque |
| 6 | Home cycle · ≥1180 | Content pushed to the left edge of each column; numbers 7px in 23px nodes; column rules running through the nodes and along the objects' edges | major (owner) | fixed — centred columns, 44px nodes with 13px numbers, no rules |
| 7 | Home cycle · 1280 | Six objects in 177px columns: the longest action broke to three lines, the mono labels to two | major | fixed — the cycle's own step at 1340px: two rows of three |
| 8 | Home cycle · ≤680 | The vertical line ran down the left edge, through the first letters of every paragraph and across the objects' labels | major (owner) | fixed — a chain of centred steps, the connector in the gap between them |
| 9 | Home cycle · 1024/768 | Three columns fenced by rules, a stray Signal line under the first row only | major | fixed — each row carries its own piece of the line, node to node |
| 10 | Journal entry · all | «Изменить запись» was bare text beside a button — it did not read as a control (the owner's screenshot) | major | fixed — an outline button |
| 11 | Journal entry · all | An entry from a Trade Card could not be changed at all; nothing could be deleted | major (owner) | fixed — DD-328 |
| 12 | Journal entry · 390 (first pass) | Three stacked full-width bars: a stacked desktop, and a 326px-wide destructive target | major | fixed — the review is a bar, the edit and the delete share the row under it, the delete as wide as its word |
| 13 | Journal entry · 600–650 (first pass) | The delete wrapped to a row of its own | major | fixed — from 600px the row never breaks: the two that change give way |
| 14 | Journal question · all (first pass) | «Отмена» was bare text adrift in a 168px box — the default answer did not look like one | minor | fixed — an outline button |
| 15 | Journal question · all (first pass) | The question's edge read as a neutral line | minor | fixed — rose at 46% |
| 16 | Journal question · 390 | «Personal / Stats» broke across two lines | minor | fixed — the tools' names do not wrap |
| 17 | Journal · «Показать ещё» | The cursor is an entry: after deleting it the next page was refused by the Backend, forever | critical (found in design, never shipped) | fixed — the last line on screen takes over; an empty screen re-reads the list |
| 18 | Journal · two tabs | A review or a delete of an entry deleted elsewhere said «Запись изменилась» | minor | fixed — «Этой записи уже нет — показываю актуальный журнал» |
| 19 | Journal entry · 360 (found by measuring, not in the 390 frame) | «Изменить запись» broke to two lines and both buttons of the pair grew to 68px | major | fixed — the pair is set 6px tighter a side and no label wraps: one row from 360px, three rows at 320px |

## Fixes applied

**Home** (`public-home.css`, `review-window.tsx`, `review-data.ts`)
- The strip: badges and their data removed; a rail on each card's top edge (transparent → Signal at
  42% for a reached state → full Signal for the state on show); titles 17px; the note sits at the
  card's bottom so four notes share a line.
- The route: one `::before` carries the faint line and, as a background sized by `--route-drawn`,
  the drawn part. Nodes are opaque and above it; a passed node is tinted (`#222916`).
- The cycle: `--loop-node: 44px`; node on the line with a 13px / 600 number; the line from the
  centre of the first node to the centre of the last; three lines reserved for the meaning so six
  objects start on one line; objects centred, at most 216px wide (260px in three columns, 320px in
  one). `@media (max-width: 1340px)`: two rows of three, each cell carrying its piece of the row's
  line. `@media (max-width: 680px)`: one column, a 36px connector in the gap between steps.
- The new breakpoint value 1340 is declared in the responsive registry
  (`breakpoint-authority.test.ts`, `CONTENT_DRIVEN_KEEP`, with the measurement that justifies it).

**Journal** (Backend `journal.ts`, `journal-service.ts`, the entry route; Academy `tools-proxy.ts`,
the BFF route, `tools-client-core.ts`, `journal-client.ts`, `journal-model.ts`, `journal-parts.tsx`,
`journal-workspace.tsx`, `tool-windows.css`)
- «Изменить запись» for every entry: the same form, every field. For an entry from a card the form
  says «изменения останутся в журнале, сама карточка не изменится», and the entry's facts say
  «Из Trade Card · изменена в журнале» while the two disagree (the Backend compares them).
- «Удалить» for every entry → «Удалить эту запись?» in place → «Удалить запись» / «Отмена».
- A new button variant `danger` (the rose of a loss and of an error): outlined where the action is
  offered, filled only on the step that deletes.
- The counts after a delete are the Backend's own; the cursor never outlives its entry.

## Captures (after)

`design-memory/screenshots/owner-fixes-2026-10-01/final/`

- `home-1-review-strip-w{1440,1024,768,390}.png`
- `home-2-route-w{1440,390}.png`, `home-2-route-start-{1440x900,390x844}.png`,
  `home-2-route-nodes-zoom-{1440,390}.png`
- `home-3-cycle-w{1440,1280,1024,768,390,360}.png`
- `journal-1-entries-open-<viewport>.png` — a hand-recorded entry and one from a card, both open
- `journal-2-delete-question-<viewport>.png` — the question, on the entry from a card
- `journal-3-card-entry-form-<viewport>.png` — «Изменить запись» over an entry from a card
- `journal-4-card-entry-corrected-1440x900.png` — after saving: «Из Trade Card · изменена в журнале»
- `journal-5-after-delete-1440x900.png` — after a delete: the counts, the list, «Запись удалена»
- `journal-closeup-actions-{1440x900,600x900,390x844,360x740,320x640}@2x.png`,
  `journal-closeup-question-{1440x900,390x844}@2x.png`

## Before/after comparison

- **Strip, 1440 and 390:** before — a pill above every title, the fourth a Signal tick; after — the
  title is the first thing on the card and a thin line along the strip's top shows three states
  passed and the fourth on show. The strip is 30px shorter at 1440 and 121px shorter on a phone.
- **Route, close-up:** before — the Signal line is drawn across «L1» and «L2», splitting each label;
  after — the line stops at the ring of each node and continues under it, and «L1», «L2», «L3» are
  whole and larger.
- **Cycle, 1440:** before — six left-aligned columns between vertical rules, a dot with an unreadable
  number at each rule; after — six centred columns under one line, «01…06» readable in their nodes.
- **Cycle, 1280:** before — six columns with broken buttons; after — two rows of three. The block
  is 383px taller there: that is the price of objects that fit their columns.
- **Cycle, 390:** before — the line crosses «Изучить…», «Сформулировать…», the objects' labels;
  after — nothing crosses the text; a short connector joins one step to the next. The block is
  225px taller (a 44px node on its own line and a connector between steps, six times).
- **Journal entry, 1440:** before — a button and a text; after — two buttons and, at the far end,
  the delete. **390:** before — a bar and a text under it; after — a bar, and a pair under it.
- **Entry from a card:** before — one action; after — the same three as any entry.

## The chain, end to end (13 checks on the stand, all passing)

Personal Stats follows the journal (a delete takes one trade out of «all time»: 36 → 35) → the last
line on screen deleted, then «Показать ещё» continues with no refused request → the same entry
deleted in two tabs: the second says the entry is gone and shows the journal as it is → a review
saved over an entry deleted elsewhere is answered the same way → keyboard only: Tab reaches
«Удалить», Enter asks, the focus waits on «Отмена» with a visible ring, a second Enter cancels and
returns to «Удалить», Shift+Tab and Enter delete, the focus lands on the next line → on a phone both
answers are 46px targets, a second tap where «Удалить» was lands on the question's text, the count
and the filter's number both drop in «План нарушен», no horizontal overflow.
In the database: the row and its marked rules are gone (the cascade), the Trade Card is untouched and
still `saved`, an entry corrected back to its card's values loses the «изменена» mark.

## Console result

No page errors and no console errors at any width on either surface. The only console lines in the
whole run are the two expected 404s of the stale-tab checks (the Backend's «not found», which the
screen turns into its message). No horizontal overflow at 1440, 1024, 768, 390 on the home.

## Automated

- Academy: `tsc` clean, ESLint clean, Vitest 177 files / 2742 tests. New and changed: the proxy
  (39), the journal's four files (82 — 17 of the workspace's 40 are new: the delete and the
  whole-entry edit; 8 read the stylesheet's declarations for the actions row and the colour of a
  delete), the public home (60), the breakpoint registry (30). Seven mutations of the workspace and
  four of the stylesheet are each caught by a test.
- Measured in the browser at 13 widths from 320 to 1440, with an entry open and with the question
  asked: no horizontal overflow, every action 46px tall, no label on two lines.
- Backend: Vitest 37 files / 537 tests; the journal regression 17/17 on a real database.

## Anti-generic score (ata-anti-generic-ui-review)

**Trading Journal — the open entry, the question, the form** (functional mode). The slice adds
actions inside the composition scored in `tools-v2-trading-journal-review.md`; the references tied
there hold (the territory's Signal edge and the day's index tick; an impulsive trade turned into a
reviewed record).

| Criterion | Score |
|---|---|
| Connection to ATA DNA (accepted foundation): Signal stays the one «go»; the delete takes the product's existing rose, not a new red | 15/20 |
| Structural originality: unchanged — a day-classified ledger with in-place disclosure; the question opens inside its entry, not in a modal | 12/15 |
| Product meaning: the entry says whether it still agrees with its card; the question says what a delete takes out of Personal Stats and what stays in Trade Card; the counts are the Backend's | 14/15 |
| Typography: unchanged scale; the question's title 15/700, its note 13.5 | 8/10 |
| Signature object: the ledger line with its plan mark and the ПЛАН · ИСПОЛНЕНИЕ · ВЫВОД triad | 7/10 |
| Progression clarity: «Разобрать сделку» is still the one Signal action of an unreviewed entry; edit and delete never compete with it | 9/10 |
| Mobile transformation: the actions recompose — a bar and a pair — instead of stacking; the question's two answers stack as 46px bars | 8/10 |
| Usability / readability: rose on the territory 8.2:1, ink on the filled rose 9.0:1, the note 11.1:1; every control looks like one; focus goes to the safe answer and back; 46px targets; no overflow from 320px | 9/10 |
| **Total** | **82/100** |

Automatic-fail check: total ≥ 80 PASS · signature object PASS · not renameable (payout, expiry,
Trade Card, Personal Stats, the plan mark) PASS · no sidebar + card grid PASS · three identical
directions n/a (the composition is the accepted one) · mobile is not a stacked desktop PASS · no
low-contrast body PASS · no six identical cards PASS · not one shape everywhere PASS · identity not
on icons (one icon, the trash, beside its word) PASS · two references PASS · no decorative market
elements PASS.

Objective counts (open entry, desktop / mobile): same-type cards 0 / 0 · surface geometries 7
(field, territory, counts well, filter, line plate, buttons, the question's well) · icon dependence
≈ 4% / ≈ 8% · branded objects 3 · hierarchy levels 5 · contrast problems none · unadapted
landing-only none.

**Verdict: PASS** (82/100 — unchanged, as the composition is).

**Public home — the three blocks** (emotional mode), against `public-home-hifi-review.md` (87).

| Criterion | Score |
|---|---|
| Connection to ATA DNA: the luminous line is now literally the structure — nodes stand on it in the route and in the cycle | 17/20 |
| Structural originality: unchanged | 13/15 |
| Product meaning: unchanged; the strip's rail encodes the state of the window above it | 15/15 |
| Typography: node labels 10–13px where they were 7–11px; the strip's title leads its card | 9/10 |
| Signature object: the route that draws to the node you reached | 9/10 |
| Progression clarity: reached and active are read on the strip's rail and on the route's nodes | 9/10 |
| Mobile transformation: the cycle is a chain with its own connector, not a column with a line through the text | 8/10 |
| Usability / readability: nothing crosses a label; no horizontal overflow; reduced motion keeps the end states | 9/10 |
| **Total** | **89/100** |

Automatic-fail check: all PASS (as in the hi-fi review; the cycle's six steps are six different
product objects, not six identical cards).

**Verdict: PASS** (89/100).

## Sign-off

- The critical and major findings are closed.
- The screenshots are real renders of the real routes, on a scratch stack with the real Backend code.
- The console is clean at every width.
- The anti-generic review passes on both surfaces.
- Ready for the owner's review before release to PREPROD. Order: Backend first (it reads both the
  old and the new name of the whole-entry change), then Academy. No migration.

## Released to PREPROD — 2026-10-02

Owner: «на пред прод то, что сделали, выкатывай». Backend `c5694d7` (BUILD_ID
`Uu3_jYtj6n5mbnYZEqirJ`) at 05:28Z, then Academy `4e06ef3` (BUILD_ID `TEMRp9HPHXj-M6gLbESJO`) at
05:30Z, after a database backup. Between the two cutovers the released Academy ran against the new
Backend without a fault.

On the live host: the three home blocks re-photographed at the same six widths — no badges, the
line under the nodes, the cycle centred, no console errors, no overflow, still `noindex`. The delete
route answers 401 without a session, 400 to a body, a query or a hostile id, 405 to any other
method. The served build carries the new journal screen and no longer carries the rule that kept a
card's entry from being changed. Service and nginx logs are clean.

**Not verified on PREPROD:** the journal itself under a learner — sign-in is CAPTCHA-gated and an
agent cannot mint a session. The same commits passed the 13 end-to-end checks on the stand.

## Correction — 2026-10-02

This review said the cycle's nodes stand on its line (finding 6, the cycle's fixes, and «nodes stand
on it in the route and in the cycle» in the score). That was true of the route and NOT of the cycle
wherever six steps stand in one row (1340px and wider): the cycle's drawn line was still the list's
last child and was painted over «01…06» — a 2px Signal cut through 13px digits, missed in frames
judged at full size. The owner reported it the next day. It is fixed in the second wave (DD-333),
and the question is now asked of the browser's paint order rather than read off a screenshot:
`design-memory/reviews/owner-fixes-2026-10-02-review.md`.
