# RESPONSIVE PASS — measured review

- **Date:** 2026-10-03
- **Owner:** «проверь все на адаптивность, где есть ошибки исправляй, адаптируй и про внешнюю главную не
  забудь». Asked first: PREPROD — «Да, по готовности»; CRM — not in scope (learners and guests only).
- **Decision:** DD-339. Academy only; the Backend does not change.
- **Released Academy before the pass:** `ec6072f` (the product hi-fi, part 2).

## How it was checked — measured, not judged

**33 surfaces** with the stand learner that shows each in a real state: Public Home (walked to the end so
every scroll-revealed section is shown), sign-in, registration, password reset, the three token pages,
Home and Path for two learners, Lessons, the lesson page with a test (L5), the report open and accepted
(L9), the practice (L13), the Pocket registration (L3), a locked level, the material, the workspace,
Tools and five windows, Notifications, Profile, support, the news list and an article, «не найдено» and
a level that does not exist.

**25 sizes:** phones 320×568, 360×740, 375×667, 390×844, 414×896, 430×932; the layout edges 599/600,
899/900, 1199/1200 (at 900 tall); tablets 768×1024, 820×1180, 1024×768, 1180×820; laptops and monitors
1280×800, 1366×768, 1440×900, 1536×864, 1920×1080, 2560×1440; phones held sideways 667×375, 844×390,
932×430. 825 page loads per sweep, in a real Chromium, at device scale 1.

**What the probe measures on every load** (`scratchpad/rsp/probe.js`): sideways scroll; anything past the
screen's edge that is not inside a scroller of its own; text wider than its own box; text cut by a
container that clips; text over text; targets under 44px (a frozen link's own `::after` hit area counts;
inline links in running text are exempt); type under 10.5px and running text under 14px on a phone;
content left under the phone's fixed bottom bar at the end of the page; how much of the screen fixed
bars take. Then, separately: **every open state** (the Public Home menu, the time and date pickers, the
material's contents, the profile's name editor) at 7 sizes including the sideways phones, and **the
docked lesson player** with real playback at 19 sizes.

## Findings

| # | where | sizes | problem | severity | status |
|---|---|---|---|---|---|
| 1 | Public Home «Что такое ATA» | 320–430 | one long word («самостоятельности») widened the grid track: the heading, the lead and the «ATA — это не» card ran off the right edge | critical | fixed — `minmax(0, 1fr)` tracks; the heading's phone size follows the shell so the word fits |
| 2 | Public Home decision window | 360–390 | the phone's fixed product-window height cut the Trade Card: «Зафиксировано 17:20» and the note were lost | major | fixed — this window takes its content's height |
| 3 | Public Home route title | 320 | «Последовательная» ran 26px past its column | major | fixed — the title steps down below 360 |
| 4 | Public Home path facts | 320–360 | «Последовательность обязательна» cut by its section | major | fixed — the 40px user-agent indent goes on a phone |
| 5 | Public Home menu | phones sideways | the menu hangs from the fixed header: its last links and «Начать путь» fell below the screen and could not be scrolled to | critical | fixed — on a short screen the links take two columns and the whole menu fits (found after the first release: scrolling inside alone hid «Начать путь» under the menu's edge); it also stops above the screen's edge and scrolls inside |
| 6 | Public Home product windows | 320; 1199–1340 | «Уровень 30» and the demo badge ran past the window's bar | minor | fixed — the bar answers to the window's own width (container queries) |
| 7 | Public Home route window, News Calendar | 360×740, 375×667 | the first release was sliced by the window's edge | minor | fixed — on a short phone the timeline alone says it |
| 8 | the lesson page, docked player | 900–1683 (open item of DD-336) | the corner player covered the ends of the column's lines; on tablets and phones held sideways the top band took 48–67% of the screen | major | fixed — corner inside the gutter from 1404px; a strip under the floating bar below that; the band only for an upright phone, the picture ≤30% |
| 9 | Tools: time and date pickers | phones sideways; 1024–1440 | a 428px picker cannot fit a 375px screen and did not scroll; near a page's end it ran past the screen's bottom | major | fixed — it stops above the edge and scrolls inside; with no room below and room above it opens upward (`picker-panel.ts`) |
| 10 | Tools: pickers | all | «Сейчас», «Сегодня», «Вчера», «Готово» 34–40px; hour and minute cells 38px; month arrows 36px | major | fixed — 44px |
| 11 | Path | 600–899 | five levels shared ~66–90px each: names broke mid-word («таймфре\|йм», «бинарны\|е») | major | fixed — the strip pans as on a phone |
| 12 | Workspace | 320–375 | «Вернуться к уровню» / «к пути» ended under the phone's bottom bar | major | fixed — the bar's clearance |
| 13 | the shell | all | «Выйти» 40px | major | fixed — 44px |
| 14 | News | all | a release row's title was a 23px link | major | fixed — the link covers the row |
| 15 | News article | 320 | «потребительских» past its column; «ожидается» broke into «ожида / ется» in three figure columns | major | fixed — the title steps down; on a phone the figures read as rows |
| 16 | the material | phones sideways, tablets | «Структура» 30px | minor | fixed — 44px |
| 17 | the phone top bar | 320 | the section label cut to «ИНСТР…» | minor | fixed — below 360 it is not shown (the page title and the bottom bar name the section) |
| 18 | a tool's three-way choice | 320 | «Прибыль» ran out of its 55px choice | minor | fixed — the type steps down below 360 |
| 19 | Public Home route steps | phones, tablets | step titles were 42px targets | minor | fixed — 44px |
| 20 | Public Home | phones | «Войти» 10px beside a 12px «Меню»; the footer's legal lines 10px | minor | fixed — 12px |
| 21 | content text on a phone | < 600 | a support reply, the checklist's verdict, the report's rules, a tool's empty state at 13.5px; captions at 12–12.5px | minor | fixed — 14.5–15px; captions 13.5px |

**Measured and left as they are** (no defect on the screen): two display headings on Public Home
(«делегировать.» from 1199px, «самостоятельности.» at 932–1040px) are 3–66px wider than their own box and
run into the empty gap beside it, never into the next column and never cut. The product windows' own
12.5–13.5px type on Public Home is the product's secondary scale shown at the window's size.

**Seen on the stand only, not responsive:** with 3–4 parallel browsers on the stand's development Backend
a page occasionally failed to read the Backend (a 500 on `/news`, a 502 once on support) and Next logged
«Controller is already closed» for streams the test browsers closed early. The live PREPROD journal has
none of these; recorded, not changed here.

## Captures

`design-memory/screenshots/responsive-pass/before/` and `after/`: Public Home «Что такое ATA» at 390 and the
decision window at 360 (before from live PREPROD), the menu on a phone held sideways, the docked player at
1440, 1024 and 844×390, the Path strip at 600, a news article at 320, the time picker opening upward at
1440 and scrolling inside at 844×390.

## Measured after (the final sweep)

On the production build of this change, on a fresh stand database:

- **825 of 825** page × size pairs measured (32 re-measured one at a time after the stand's development
  Backend fell behind under load — see above): **0** sideways scroll, **0** elements past the screen's
  edge, **0** text cut by a container, **0** text over text, **0** targets under 44px, **0** content left
  under the phone's bottom bar. 7 «text wider than its box» — the two Public Home headings listed as left
  as they are.
- **Open states:** 30 of 30 clean — the Public Home menu, the time and date pickers, the material's
  contents and the profile's name editor at 320×568, 390×844, 667×375, 844×390, 768×1024, 1024×768 and
  1440×900.
- **The docked player:** 19 of 19 sizes clean — from 1404px it covers no line of the column (0 of the
  measured lines; before, 3–4 at 900–1536px); 900–1403px a strip of 12–14% of the screen under the
  floating bar; tablets 10–11%; phones held sideways 26–27% (before 66–67%); an upright phone 36–41%;
  on 1920×1080 and 2560×1440 the stage stays on screen, so nothing docks.
- **E2E:** the lesson walk (a test, the report with its refusal records, the tool it releases) 35 of 35;
  Home, Profile and support 25 of 25; the tools 12 of 12.
- **Tests:** 3181 (new: the picker opens upward with no room below; the docked player's place is pinned).

## Sign-off

Every critical and major finding is fixed and re-measured. Not checked under a learner on PREPROD (sign-in
there is CAPTCHA-gated); every signed-in page was measured on the stand with the build that ships.

---

# ROUND 2 — the owner's phone screenshots (DD-340)

The owner sent two screenshots of Public Home from a phone: in the route the pinned product window
covered the steps' words as they scrolled under it, and above and around the floating header the page
showed through. «Похожие ситуации так же поищи и исправь».

| # | where | problem | status |
|---|---|---|---|
| 1 | Public Home route, ≤920px | the pinned window covered the words of every step passing under it | fixed — each step carries its own window under its words; the pinned window serves 921px and up only |
| 2 | Public Home header, ≤1040px | the page showed above the floating pill and at its corners | fixed — once scrolled, the gutter around the pill is the page's own ground |
| 3 | the product's bottom bar, ≤899px (the similar case) | the page showed below the floating bar and at its corners | fixed — the bar sits on a band of the page's ground |
| 4 | the News Calendar window at 320 | a release's title column narrower than «потребительских» | fixed — the row reads in two lines in a narrow window |
| 5 | the News Calendar window | «м/м» broke after its slash | fixed — kept on one line |

Measured: the gaps around the bars pixel-sampled at 38 scroll positions (Public Home at 320–1024 and the
sideways phone; Path, Trade Card and the report lesson on phones) — 38 of 38 show only the band (the live
site before: 1 of 28); the route at ≤920 shows 8 of 8 step windows and no pinned window, at ≥921 the
pinned window as before; the Public Home sweep at 25 sizes clean of overflow, cuts, overlaps and small
targets.
