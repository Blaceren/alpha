# OWNER FIXES 2026-10-02 — screenshot review (second wave)

- **Date:** 2026-10-02
- **Scope:** five fixes the owner asked for, on three surfaces:
  - the tools (`/tools/trade-card`, `/tools/journal`, `/tools/risk-calculator`,
    `/tools/entry-checklist`) — the Payout field, the date and the time of a trade;
  - sign-in, registration and the reset request (`/login`, `/register`, `/forgot-password`) — the
    security check;
  - the public home — the cycle's line (`#mechanism`) and the strip under the review window
    (`#review`).
- **Owner, 2026-10-02** (with five screenshots):
  1. «в этом поле должно быть можно писать только цифры и от 20 до 99» — the Payout field, with
     «льдл» typed into it;
  2. «выбор даты и времени в инструментах должен быть реализован удобно и красиво, подходить под
     наш стиль, оптимизируй, сделай по другому его выбор и доведи до хай фая» — the browser's own
     time list under «Время входа»;
  3. «на логине и регистрации окно капчи слишком выделяется и не соответствует нам, сделай чтобы
     оно было на своём месте, вписывалось в дизайн и доведи до хай фая» — Cloudflare's box;
  4. «полоска всё равно перегораживает цифры, нужно чтобы она была за цифрами» — the cycle's
     «01…06»;
  5. «дать понять, что можно переключать блоки, небольшими подсвечиваниями, сделай хай фай» — the
     four cards under the review window.
- **Decisions:** DD-330 (payout), DD-331 (date and time), DD-332 (the check), DD-333 (home).

## What the first wave got wrong

Fix 4 is a repeat. The first wave (DD-329, released 2026-10-02) said the cycle's nodes «stand on the
line». They did not, wherever six steps stand in one row (1340px and wider): the cycle's drawn line
was still the list's LAST child, and every step of the list is revealed with a transform — a
stacking context of its own — so the line was painted over all six nodes. It went unnoticed because
the line and the nodes are the same Signal: the line shows only where it crosses the dark digits,
as a 2px cut through «01», and the frames were judged at a size where that cut is two pixels of a
13px number. The route's line had the same defect and WAS fixed in the first wave; the same fix
was not carried to the cycle.

What changed in the method, not only in the code: «is anything painted over this?» is now asked of
the browser (`document.elementFromPoint` at each node — a pseudo-element answers as its host)
instead of being read off a screenshot. Live PREPROD: 12 of 119 nodes covered (the cycle's six, at
1440 and at 1360). This build: 0 of 119.

## Visual thesis

**A field says what it takes.** Payout keeps digits and shows its range; a time is four digits and
the colon is ours; a date is said the way the learner would say it — «Сегодня», «Вчера», «29
сентября». Where the hand would rather point, a panel in the form's own material opens under the
field: the well a shade lighter than the field, one line, the Signal only on what is chosen.

**The check is one line of the form.** Cloudflare's box is a third party's frame and cannot be
restyled. So it is not drawn unless it has something to ask; a quiet line in the page's own hand
stands where it stood. No Signal: the page's one action is the button below.

**The line is behind what it connects.** The cycle's line is drawn first and the nodes stand on it.

**A card that can be pressed answers.** The strip's cards light — once by themselves, a wave across
the cards the window is not on, and then under the pointer, the focus and the finger.

## How the screenshots were made

- **Real browser:** Playwright Chromium (headless), `deviceScaleFactor` 1 so PNG pixels are CSS
  pixels (close-ups marked `@2x` at 2), locale ru-RU, fonts awaited, the system theme set to LIGHT
  (the default of most desktops — it is what made the old box white on a dark page).
- **Before:** the public frames are live PREPROD (`https://preprod.alfatrade.media`, the first
  wave's release), taken by the same script as the «after» frames. The tools' fields cannot be
  photographed there — sign-in is CAPTCHA-gated and an agent cannot mint a session — so their
  «before» is the first wave's own final frames of the same form
  (`owner-fixes-2026-10-01/final/journal-3-card-entry-form-*.png`) and the owner's screenshots.
  The browser's native date and time lists are drawn by the operating system and do not appear in
  a page screenshot at all; the owner's screenshot 2 is the record of them.
- **After:** Academy dev `127.0.0.1:3059` → Backend dev `127.0.0.1:3199`, a throwaway SQLite copy
  with all 60 migrations, synthetic learners of the scratch database only. The check runs against
  Cloudflare's PUBLISHED TEST SITE KEYS — always passes, forces an interaction, always blocks —
  and with no key at all. A test key draws a pink «Только для тестирования» band across the box;
  a real key does not.
- **Dev-only artefacts:** the Next.js dev indicator is hidden by an injected rule.

## Captures (before)

`design-memory/screenshots/owner-fixes-2026-10-02/before/`

- `auth-login-<viewport>.png`, `auth-register-<viewport>.png` — Cloudflare's box, white on the dark
  form, 300px wide in a 386px form; under the button «Пройдите проверку безопасности, чтобы
  продолжить».
- `home-cycle-1440x900.png`, `home-cycle-nodes-zoom-w{1440,1360}.png` — the line through «01», «02».
- `home-strip-rest-w{1440,1024,768,390}.png`, `home-strip-hover-card-2-w{1440,1024,768}.png` — the
  strip; under the pointer nothing changes.
- Tools: `../owner-fixes-2026-10-01/final/journal-3-card-entry-form-<viewport>.png` — the browser's
  own date and time fields in the journal's form.

## Findings

| # | Surface · viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | Tools · all | Payout took any text — «льдл» stayed in the field until a save refused it (owner) | major | fixed — digits only, two of them |
| 2 | Tools · all | The range was 1…100 and was said only on save | major (owner) | fixed — 20…99 in the field, in the form and in the Backend; said in the empty field («20–99») and under it |
| 3 | Tools · all | Four tools ask for a payout; each had its own check | major | fixed — one field component, one range, one Backend constant |
| 4 | Tools · all | Amount, capital and the daily limit took any text as well | minor | fixed — digits and one decimal mark; digits |
| 5 | Tools · all | Date and time were the browser's own fields: «10/02/2026» and «02:32 PM» in a Russian interface, the operating system's grey lists on the product's form (owner) | major | fixed — DD-331 |
| 6 | Time field (first pass) | Escape did not close the panel when the focus stood on its button | major | fixed — Escape is read on the field's root; the focus goes back to where it was |
| 7 | Time field (first pass) | Retyping the hour in place («14» selected, «0», «9») broke the time: after the first key the text is «0:32» | major | fixed — an hour of one digit stands in front of its minutes until the learner goes on; settled on leaving |
| 8 | Payout, time (first pass) | `maxLength` cut a pasted «payout 92 %» to two characters before its digits were read | minor | fixed — the field keeps its own length |
| 9 | Date panel · first week of a month | On 2 October the month offered two days and a wall of 29 that have not come; the days a journal is written for were a page away | minor | fixed — the first and the last week are completed with the neighbours' days, a shade back, pressed like any other |
| 10 | Payout (final pass) | «15» was named only after leaving the field, although no further key can mend it | minor | fixed — named at once when typing on cannot make it a payout («15», a first «1»); «5» on the way to «55» is still left alone |
| 11 | Auth · all | Cloudflare's box stood in the form on every visit, 300px wide and left-aligned in a wider form, in Cloudflare's own type (owner) | major | fixed — drawn only when it has something to ask |
| 12 | Auth · light-theme systems | The box followed the visitor's OS theme: white on a page that is dark-only | major | fixed — `theme: "dark"` |
| 13 | Auth · all | The line that explains the held button was UNDER the button | minor | fixed — the check's line stands where the box stood, above the button, and the button is described by it |
| 14 | Auth · failed check (first pass) | With the box gone a failed check was a dead end: «Попробуйте ещё раз» with nothing to press | critical (found in design, never shipped) | fixed — «Повторить проверку» issues a new check |
| 15 | Auth · failed check (first pass) | After «Повторить проверку» the keyboard's focus fell to the top of the page: the line it should go to was still empty, and an empty line takes no room | major | fixed — the focus is given after the render that fills the line |
| 16 | Auth · failed check (first pass) | The retry link's focus ring overlapped the sentence above it | minor | fixed — a shorter sentence, 3px of air |
| 17 | Auth · every state (final pass) | **Our frame around Cloudflare's iframe was `display: none` while closed.** Turnstile keeps its iframe RENDERED while it has nothing to ask — one fixed pixel, `opacity: 0.01` — and that is how the check runs unseen. Hiding the frame took the iframe out of rendering altogether. Nothing on the stand showed it: a test key runs no real challenge | critical (never shipped) | fixed — the frame stays in the page, zero high; the browser reports the iframe rendered and unclipped in every state |
| 18 | Auth · after a press (final pass) | The box was closed the moment the press succeeded: the form jumped up 73px under the visitor's pointer, and a live iframe was hidden | major | fixed — once up, the box stays for that check, Cloudflare's own «Успешно» in it |
| 19 | Home cycle · ≥1340 | The line was painted over «01…06» (owner — and the first wave's miss, above) | major | fixed — one first-child pseudo-element, the drawn part a background layer |
| 20 | Home strip · all | Nothing said the four cards can be pressed: only the title was a control, and nothing answered the pointer (owner) | major | fixed — DD-333 |
| 21 | Home strip (first pass) | The first highlights were too faint to be seen at arm's length | major | fixed — a deeper wash, a hairline, the rail lit |
| 22 | Home strip · all | The product object inside a card did not switch the window; only the rest of the card did | minor | fixed — the whole card is one target |
| 23 | Stand scripts (final pass) | The hit test reported route nodes «covered» on narrow screens — by the pinned product window they pass under by design; the theme check read an iframe it could not see and passed on nothing | — (test) | fixed — each node is tested clear of the window; the theme is read from Cloudflare's frame address |

## Fixes applied

**Payout** (`model/numeric-input.ts`, `components/payout-field.tsx`; Backend `reference.ts` and the
four validators). One field for Trade Card, Trading Journal, Risk Calculator and the Entry
Checklist's «Мой минимум payout». It keeps the digits of what is typed or pasted, two of them; shows
«20–99» while empty; names a number outside the range at once when no further key can mend it and
otherwise on leaving. The form's validation and the Backend hold the same 20…99. The tables' own
checks (1…100) are untouched: no migration, and PREPROD holds no row outside the new range.

**Time** (`model/time-input.ts`, `components/time-field.tsx`). A text field with the number keypad:
«1432» is «14:32», «9» is «09:», «25» is «02:5», a typed mark closes the hour; ↑ and ↓ turn the part
the caret stands in; a pointer that brings the focus selects the whole time. Its button opens a
panel: «Сейчас», twenty-four hours in four rows, then the minute in two steps — the ten, and the
ten's minutes in a tray under it. Any minute is two presses away; choosing it closes the panel.

**Date** (`model/calendar.ts`, `components/date-field.tsx`). A field that says the day in words and
opens a month: «Сегодня», «Вчера», «Позавчера» one press each; the month in whole weeks, Monday
first, in Russian whatever the browser's locale; days that cannot be chosen are drawn and cannot be
pressed; arrows, PageUp/PageDown, Home/End, Enter, Escape. The value is unchanged — «YYYY-MM-DD» —
so the form and the Backend see what they always saw.

**Both panels** (`components/picker-panel.ts`, `tool-windows.css`). Not modal, nothing dimmed: a
press or a focus outside closes them, Escape returns the focus. On a phone the panel takes the whole
row of the fields grid and every cell is 44px; from 600px it is 332px wide and hangs from its own
field, leftwards for a field in the right half. Opened near the foot of the screen it scrolls clear
of the bottom navigation.

**The check** (`turnstile-widget.tsx`, `auth-stage.css`, the three forms). `appearance:
"interaction-only"`, `theme: "dark"`, `size: "flexible"` — all options Cloudflare documents. One
line stands where the box stood: «Загружается проверка безопасности…» → «Проверяем браузер…» →
«Браузер проверен.», a ring that turns and becomes a tick. If Cloudflare asks for a press the line
says «Нужно подтверждение: отметьте поле ниже.» and the box opens under it, as wide as the fields,
cut to their corner. A failed check is the boxed sentence and «Повторить проверку». The token, the
action, the verification and every callback that destroys a token are unchanged.

**The cycle's line** (`public-home.css`). The faint line and its drawn part are one `::before`,
painted before the steps; the drawn part is a background layer grown by `background-size` (no
transform, so nothing new is stacked).

**The strip** (`review-window.tsx`, `public-home.css`). The whole card is the target. A card lights
with a wash from its top edge, a hairline and its rail: at rest only the card on show; once, when
the window's own sequence has finished, a wave across the other three (420ms each, 120ms apart);
then under the pointer (where there is one), under the keyboard's focus, and under a press. Reduced
motion: no wave, the states are instant.

## Captures (after)

`design-memory/screenshots/owner-fixes-2026-10-02/final/`

- `tools-1-journal-form-<viewport>.png` — the form at rest: «Сегодня · 2 октября», «07:57»,
  Payout «20–99»
- `tools-2-date-panel-<viewport>.png`, `tools-3-date-panel-month-before-{1440x900,390x844}.png`,
  `tools-closeup-date-panel-*@2x.png`
- `tools-4-time-panel-<viewport>.png`, `tools-6-trade-card-time-panel-<viewport>.png`
- `tools-5-payout-out-of-range-<viewport>.png` — «льдл15» typed: «15», named at once
- `tools-7-risk-payout-*.png`, `tools-8-checklist-min-payout-*.png`
- `auth-login-passed-<viewport>.png`, `auth-register-passed-<viewport>.png` — the page a visitor
  meets
- `auth-login-press-asked-<viewport>.png`, `auth-register-press-asked-*.png` — Cloudflare asks
- `auth-login-failed-<viewport>.png`, `auth-register-no-key-*.png`
- `auth-closeup-{1-loading,2-checking,3-passed,4-interactive,4b-after-the-press,5-failed,5b-failed-retry-focused}-*@2x.png`
- `home-cycle-1440x900.png`, `home-cycle-nodes-zoom-w{1440,1360}.png`
- `home-strip-rest-w*.png`, `home-strip-hover-card-2-w*.png`, `home-strip-hint-*.png`,
  `home-strip-focus-1440.png`, `home-strip-after-press-on-object-1440.png`,
  `home-strip-after-tap-390@2x.png`

## Before/after comparison

- **Payout.** Before — the owner's screenshot: «льдл» in the field. After — the same keys leave the
  field empty; «15» is named under the field while the caret is still in it.
- **Date and time, 1440 and 390.** Before — «10/02/2026» and «--:-- --» with the browser's own
  icons, and the operating system's list on a press. After — «Сегодня · 2 октября» and «07:57» in
  the form's own field; the panels are the form's material, the chosen cell the one Signal.
- **Sign-in and registration.** Before — a white 300×65 box left-aligned in a 386px form, then the
  button, then a line under it. After — one muted line and a tick, then the button. The check's
  own block is 20px where it was 71px, and the line under the button is gone: the registration
  form is 87px shorter at 1440 and 768 (688 → 601), 78px at 1024 (613 → 535), 96px at 390 and 360
  (619 → 523). The registration page no longer scrolls at 1440×900 (986 → 900), at 1024×768
  (825 → 768) or at 360×800 (847 → 800). The box, when it is asked for, is dark and as wide as the
  fields. (The sign-in frames differ in one more thing that is not this wave's: the stand shows
  «Забыли пароль?» because its mail channel is on; PREPROD's is off and the link is not drawn.)
- **Cycle, close-up.** Before — a Signal cut through the middle of «01» and «02». After — whole
  digits; the line stops at the node's edge and continues behind it.
- **Strip, 1440, pointer on the second card.** Before — identical to the frame at rest. After — the
  card is washed from its top edge, its rail is lit, its title turns Signal.

## Measured, not judged

- **Paint order:** `elementFromPoint` at three points of each of 17 nodes × 7 widths. Live: 12 of
  119 covered. This build: 0 of 119.
- **Cloudflare's iframe while our frame is closed:** an `IntersectionObserver` on the iframe —
  intersecting, ratio 1, in every state, at 1280 and at 390. Its own inline style while it has
  nothing to ask: `width: 1px; height: 1px; position: fixed; opacity: 0.01`.
- **The check's heights:** 20px passed and checking, 93px with the box (also after the press), 81px
  failed, 83px with no key — the same four the fold gate (`auth-threshold-layout.test.ts`) holds.
  The box is 386×65 in a 386px form, 312×65 on a 390px screen.
- **Panels:** inside the screen at 1440, 1024, 768, 390, 360 and 320; cells 38px high from 600px
  and 44px below; no horizontal overflow on any page at any width.
- **Contrast** (text against the pixel actually behind it): a day and an hour 16.6:1; a neighbour's
  day 10.8:1; labels and weekdays 7.1:1; the range message 8.2:1; ink on the chosen cell 15.8:1; a
  day that cannot be chosen 2.4:1 — dim on purpose, it is not offered; the
  check's line 4.5:1 while it only reports (the page's helper-text tone) and 7.6:1 when it asks for
  a press; a failed check's sentence 15.2:1; a strip title under the pointer 15.3:1.

## The chain, end to end (on the stand)

- **Payout, date, time — 31 checks, all passing.** Letters do not reach Payout in any of the four
  tools; the Backend refuses 19 and 100 by name and takes 20 and 99; «Вчера» is one press; the
  arrows and PageUp move the day, Enter chooses, the focus returns; four digits make a time; an hour
  alone settles sharp on leaving; hour, ten, minute are three presses; the entry is saved with the
  day and time chosen and reads back; the Trade Card starts on the learner's minute; on a phone the
  field asks for the number keypad and a tap selects the whole time.
- **The check — 22 checks, all passing** (7 with the passing key, 8 with the one that forces a
  press, 7 with the one that blocks): the frame Cloudflare was asked for is the dark, flexible one
  on a system set to light; our frame is in the page and the iframe is rendered; a pass takes one
  line and frees the button; a press is asked for in words, the box is as wide as the form, and
  after the press the button is free and has not moved; a failure is said in words with a way back,
  and the retry puts the focus on the check's line.

## Console result

No page errors, no console errors, no failed local requests and no 4xx/5xx on any tool page or on
the home, at 1440, 1024, 768 and 390. One dev-only line is stated rather than filtered: the dev
server's «preloaded but not used» warning for a stylesheet chunk, which a production build does not
emit. On the live sign-in page the only console lines are Cloudflare's own, from inside its frame.

## Automated

- Academy: `tsc` clean, ESLint clean, Vitest 184 files / 2837 tests. New: the three models
  (`numeric-input`, `time-input`, `calendar`), the three field components, the review window; the
  check's widget (39), the sign-in and registration forms, the auth stylesheet's rules — among them
  that nothing around Cloudflare's frame may be `display: none`.
- Backend: `tsc` clean, ESLint clean, Vitest 37 files / 537 tests; the five tool regressions on a
  real database (Trade Card 10, Journal 17, Risk Plan 10, Entry Checklist 11, Personal Stats 7).

## Anti-generic score (ata-anti-generic-ui-review)

**Trading Journal — the form with its date and time panels** (functional mode; frames
`final/tools-2-date-panel-1440x900.png`, `final/tools-4-time-panel-390x844.png`). The slice changes
three fields inside the composition scored in `tools-v2-trading-journal-review.md` and
`owner-fixes-2026-10-01-review.md` (82).

| Criterion | Score |
|---|---|
| Connection to ATA DNA: the panels are the tools' own territory material; the Signal stands on the chosen cell and nowhere else in a panel | 15/20 |
| Structural originality: unchanged ledger and form; the minute is chosen in two steps — the ten, and its tray — not from a list of sixty or a clock face | 12/15 |
| Product meaning: «Сегодня / Вчера / Позавчера» are the days a journal is written for; a day that has not come cannot be pressed; the payout's range is the product's rule, said before it is broken | 14/15 |
| Typography: tabular figures in every cell; mono labels at the tools' 10.5px; the date in words | 9/10 |
| Signature object: unchanged — the ledger line with its plan mark | 7/10 |
| Progression clarity: unchanged — one Signal action per state of the form | 9/10 |
| Mobile transformation: the panel takes the whole row of the grid instead of hanging off a 150px field; 44px cells; the number keypad | 9/10 |
| Usability / readability: keyboard throughout, focus returned, nothing trapped; contrast as measured above; no overflow from 320px | 9/10 |
| **Total** | **84/100** |

Automatic-fail check: total ≥ 80 PASS · signature object PASS · not renameable (payout, expiry,
«План до входа», the plan mark) PASS · no sidebar + card grid PASS · three identical directions n/a
· mobile is not a stacked desktop PASS · no low-contrast body PASS · no six identical cards (a
month's days and a day's hours are cells of one control, not cards) PASS · not one shape everywhere
PASS · identity not on icons (four small ones — a calendar, a clock, two chevrons — each on a
labelled control) PASS
· two references PASS · no decorative market elements PASS.

Objective counts (form with a panel open, desktop / mobile): same-type cards 0 / 0 · surface
geometries 8 (field, territory, panel, tray, cell, chip, segmented control, button) · icon
dependence ≈ 3% / ≈ 3% · branded objects 3 · hierarchy levels 5 · contrast problems none ·
unadapted landing-only none.

**Verdict: PASS** (84/100).

**Sign-in and registration** (functional mode; frames `final/auth-login-passed-1440x900.png`,
`final/auth-register-passed-390x844.png`, `final/auth-login-press-asked-390x844.png`).

| Criterion | Score |
|---|---|
| Connection to ATA DNA: the threshold frame and its two Signal corners are no longer interrupted by a foreign white box; the page's one Signal is its action | 16/20 |
| Structural originality: unchanged threshold composition | 12/15 |
| Product meaning: the line says what is happening to the button below it, in the product's words | 13/15 |
| Typography: one voice in the form; Cloudflare's type appears only when Cloudflare speaks | 9/10 |
| Signature object: the threshold frame | 8/10 |
| Progression clarity: fields → the check's line → the one action; the reason a button is held stands above it | 9/10 |
| Mobile transformation: the box, when asked for, is the fields' width; the registration form is 96px shorter on a phone | 8/10 |
| Usability / readability: a status line, a real alert, a retry with a 44px target and a returned focus; 4.5:1 for the reporting line is the floor, 7.6:1 where it asks | 8/10 |
| **Total** | **83/100** |

Automatic-fail check: all PASS (the composition is the accepted threshold; no cards, one geometry
family per role, no icon-borne identity).

Objective counts (desktop / mobile): same-type cards 0 / 0 · surface geometries 4 · icon dependence
0% · branded objects 2 (the mark, the threshold frame) · hierarchy levels 4 · contrast problems
none below AA (the reporting line is exactly at it) · unadapted landing-only none.

**Verdict: PASS** (83/100).

**Public home — the cycle and the strip** (emotional mode), against the first wave's 89.

| Criterion | Score |
|---|---|
| Connection to ATA DNA: the luminous line is behind every node — now true in the cycle as well as in the route | 18/20 |
| Structural originality: unchanged | 13/15 |
| Product meaning: a card's light is the state of the window above it; pressing a card shows that state | 15/15 |
| Typography: unchanged; the digits of the cycle are whole | 9/10 |
| Signature object: the route that draws to the node you reached | 9/10 |
| Progression clarity: reached, on show, and «can be pressed» are three readable things on the strip | 9/10 |
| Mobile transformation: the wave and the press state exist without a pointer; the tap highlight is the product's, not the browser's grey | 8/10 |
| Usability / readability: the whole card is the target; focus is visible; reduced motion keeps the states | 9/10 |
| **Total** | **90/100** |

Automatic-fail check: all PASS.

**Verdict: PASS** (90/100).

## Judgements made without asking, for the owner

1. **No art-direction gate for the pickers.** The owner delegated the «how» («сделай по-другому его
   выбор»); three structures were weighed — steppers inside the field, a ribbon of days, a typed
   field with a panel — and the third was built because it keeps both hands: the keyboard's four
   digits and the pointer's three presses.
2. **Amount, capital and the daily limit** filter what is typed as well. Not asked for; the same
   defect.
3. **The whole card of the strip is pressable**, the product object inside it included.
4. **The check's box is not drawn unless Cloudflare asks**, is always dark, and stays after a press.
5. **A neighbouring month's days are offered** in the first and the last week of a month.

## What cannot be verified before release

- **The check with the REAL site key.** A real key answers only on its own hostname, so it cannot
  run on the stand. After release it is checked on PREPROD itself: a headless browser is asked for
  a press there today, so the «press asked» state will be seen with the real key; a pass without a
  press is what a person's browser gets, and that one frame needs the owner's own eyes.
- **The tools under a learner on PREPROD** — an agent cannot mint a session.
- **Legal:** with the box drawn only on demand, the links to Cloudflare's privacy terms that the box
  carries are not on screen for most visitors. Cloudflare asks sites that hide the widget to name
  Turnstile in their own privacy policy; the product has no legal pages yet (OQ-6). Recorded there.

## Sign-off

- The critical and major findings are closed; two of them (17, 18) were found in the last pass,
  by measuring rather than looking.
- The screenshots are real renders of the real routes.
- The console is clean.
- The anti-generic review passes on all three surfaces.
- Ready for the owner's review before release to PREPROD. Backend first, then Academy; no
  migration.
