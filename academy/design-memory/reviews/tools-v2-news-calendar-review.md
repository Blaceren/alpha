# TOOLS-V2 · Slice 6 · News Calendar and the public news: screenshot review

- **Date:** 2026-09-21
- **Scope:**
  - News Calendar (L30) at `/tools/news`: the learner's day and the windows their plan closes;
  - the public news pages `/news` and `/news/<slug>`;
  - the CRM «Новости» section where the copywriter writes them.
- **Design source:** the owner's presentation «Окна инструментов ATA». The News Calendar window shows:
  - «Часовой пояс» with «Все время ниже показано в выбранном поясе»;
  - the line «Вход закрыт по вашему плану до 14:45 — Через 12 мин: USD · Базовый индекс потребительских цен, м/м. Первое движение после публикации — только наблюдение.»;
  - a timeline 08:00–20:00+ with «сейчас 14:18» and hatched windows «вход закрыт ±15 мин»;
  - «События сегодня»: time · currency · name · ПРОШЛО/СКОРО · ●●● · прогноз / факт.
- **Owner decisions, 2026-09-21 in chat:**
  - news are entered by hand in the CRM by a copywriter role, and each news item is its own page indexed by search engines (answer 11);
  - indexing on PROD: only the news and the public home page; everything else noindex;
  - «на пред проде мы ничего не индексируем».
- **Carried over from the earlier slices:**
  - the product's own tones (Lessons DNA for the tool; Public Home's system for the public pages);
  - the same tab and «Все инструменты»;
  - no previews;
  - every width;
  - the first read on the server;
  - manual first: the plan is the learner's and nothing is chosen for them.

## Visual thesis
- **The tool answers one question before every entry: may I enter now, by my own plan?**
  - The same flat Ink field and one olive territory with its Signal edge.
  - **The signature object is the learner's day on one track:** every window the saved plan closes is hatched in the negative tone, releases are marks sized by importance and bright when the plan covers them, and «сейчас» is in Signal (Signal's own role: the current moment).
  - The status line reads the track in words and tone: rose «Вход закрыт … до 14:45», green «Вход открыт. По плану закроется в 14:20».
  - The plan stands beside the day from 900 px and under it below.
- **The public pages are Public Home's reading surface:**
  - paper with the serif display;
  - Ink kept for the header, the one invitation and the footer;
  - a ledger of releases by day (the time, a currency chip, the name and lead, importance, the numbers);
  - one article with its three figures in one well;
  - no card grid except «Другие новости».
- **The CRM section is the CRM's own language** (Tailwind tokens, table/cards, labelled fields), like Affiliates.

## How the screenshots were made
- **Real browser:** Playwright Chromium (headless shell), `deviceScaleFactor` 1, locale ru-RU, time zone Europe/Warsaw, at 1440×900, 1024×768, 768×1024 and 390×844.
- **Browser clock:** fixed at 14:18 Warsaw on the seeded day (`context.clock.setFixedTime`), the presentation's moment.
- **Stack:**
  - scratch Academy dev (127.0.0.1:3059) and scratch CRM dev in api mode (127.0.0.1:3019), both on scratch Backend dev (127.0.0.1:3199);
  - the QA database copy with migration 59 applied, graph extended to L31;
  - nothing on PREPROD was touched.
- **Data** (synthetic, scratch database only):
  - `qa-tools-news`: L30 completed, with the presentation's plan (USD, EUR · high · ±15 · Warsaw);
  - `qa-tools-news-noplan`: L30 completed, no plan (reset before every viewport);
  - `qa-tools-news-locked`: L29 completed;
  - `qa-crm-copywriter`: `news_editor` + StaffRole `copywriter`;
  - ten news items around the seeded day (GBP 08:00, EUR 11:00, USD 14:30, 16:00, 20:00, three tomorrow, one yesterday, one draft).
- **Scripts:** `scratchpad/tools-qa/seed-news.ts` and `shots-news.cjs`.

## Captures (before)
`scratchpad/tools-qa/news1/<vp>/`. The evidence for the fixed findings is kept in `design-memory/screenshots/tools-v2-news-calendar/before/`.

## Findings

| # | Viewport | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | all | The plan's importance choice read «Только высокая ●●●» / «Средняя и высокая ●●+»: the UI face has no ● glyph, so the fallback drew three large filled discs inside a Signal button. | major | fixed |
| 2 | all | On a 24-hour track a 30-minute window is 2% wide, a hairline at 1440 and invisible at 390: the signature object hid the thing it exists to show. | major | fixed |
| 3 | all | «Скоро» stood on every later release of the day (16:00 and 20:00 at 14:18); the presentation marks only the next one. | minor | fixed |
| 4 | all | The public list's note said «ваше время страница покажет рядом», but the list rows show UTC only. | minor | fixed |
| 5 | all | On a news page the UTC release time was set in the small mono list face beside 15 px text. | minor | fixed |
| 6 | all | CRM date and time fields show the browser's own format (09/21/2026, 02:30 PM in headless Chrome). | minor | accepted: native controls follow the staff member's browser, and the zone and «Сохранится как … UTC» are stated beside them |
| 7 | 390 | The CRM importance choice wraps to two lines. | minor | accepted (every option stays a full-size target) |
| 8 | all | The «N» badge on CRM captures. | — | not a finding: Next's dev-only indicator, absent from builds |

## Fixes applied
1. **Words only in the plan's importance choice:** «Только высокая» / «Средняя и высокая». The dots stay where they are data: on each release and in the CRM.
2. **The track draws the stretch of the day that holds the releases, windows and «сейчас».** It adds an hour's margin, sits on whole hours and is at least eight hours long. That is 07:00–21:00 for the presentation's day. A day without releases is drawn whole.
3. **«Скоро» only within the next hour.**
4. **The list's note is now «Время — по UTC; на странице новости — и по вашим часам».**
5. **The page's release line is in the page's own face.**

## Captures (after)
- **Directory:** `design-memory/screenshots/tools-v2-news-calendar/final/<vp>-<state>.png` (from `news2`), 15 states at each of the four viewports.
- **States:**
  - the tools page with all six open;
  - 14:18 with the plan, closed until 14:45;
  - tomorrow;
  - the zone switched to Moscow, unsaved;
  - keyboard focus;
  - no plan;
  - the form asking for every choice;
  - the saved plan;
  - locked at L29;
  - the public list;
  - a news page;
  - the public home with «Новости» in its menu;
  - the copywriter landing on «Новости»;
  - a published item in the editor;
  - «Новая новость» with its checks.

## Before/after comparison
- **#1:** `before/1440x900-01-news-closed-now` shows three discs in the selected option. `final/1440x900-01-news-closed-now` shows «Только высокая».
- **#2:** the before track is 00–24 with two hairline windows. The final track is 07–21: the windows 14:15–14:45 and 19:45–20:15 are hatched blocks, and «сейчас 14:18» sits between the 14:30 mark and its window.
- **#3:** before, 14:30, 16:00 and 20:00 all read «СКОРО»; after, only 14:30.
- **The presentation's moment, checked on screen** (`final/1440x900-01`):
  - «Вход закрыт по вашему плану до 14:45»;
  - «Через 12 мин: USD · Базовый индекс потребительских цен, м/м.»;
  - «Первое движение после публикации — только наблюдение.»;
  - 08:00 GBP and 11:00 EUR «Прошло · Вне вашего плана»;
  - 14:30 USD «Скоро · Вход закрыт 14:15–14:45».
- **The saved plan** (`final/768x1024-07`): medium and high, USD + GBP, 10 before / 30 after. It shows «Вход открыт. По плану закроется в 14:20» and four windows.

**Server-side first read.** Pages were opened with JavaScript OFF:
- the tool holds the plan, «План в силе» and the day's releases;
- the public list holds its releases with UTC times.

**Indexing on PREPROD (the switch off):**
- `/news` answers `X-Robots-Tag: noindex, nofollow` and carries the robots noindex meta;
- robots.txt allows crawling;
- the sitemap is empty.

## Console result
- `pageerror` and `console.error` were listened to on every page at all four viewports, including the CRM: 0 errors, 0 hydration warnings.
- A `popup` listener saw no new tab. The news source link opens a new tab by design and was not clicked.
- `scrollWidth` was checked on the tool (today, zone switched, saved plan), both public pages and the CRM list and editor: nothing scrolls sideways.

## Anti-generic score (ata-anti-generic-ui-review)

**Interpretation.** DNA is scored against the accepted foundations:
- the tool against Lessons, as for the other tools;
- the public pages against Public Home, which they are built on.

Reference ties:
- **luminous line as structure:** the Signal edge, «сейчас» on the track, and Public Home's Ink/Signal header;
- **chaos → system:** a noisy calendar becomes the few minutes the learner's own plan closes.

| Criterion | Score |
|---|---|
| Connection to ATA DNA (accepted foundations) | 15/20 |
| Structural originality: not a dashboard; one day on one track, a ledger of releases by day, one article with one well of figures | 12/15 |
| Product meaning: the windows are the learner's saved plan (L29); «первое движение — только наблюдение» is L27; a release outside the plan says so; the public page leads to the module that teaches it; nothing about money | 14/15 |
| Typography: tool 16/800 status, Mono for clocks and chips; public serif display with Manrope reading text | 8/10 |
| Signature object: the day's track with hatched windows and «сейчас» | 9/10 |
| Progression clarity: no plan → «Составьте его ниже»; locked → level 30; public → «Модуль «Новости» · уровни 26–30» | 8/10 |
| Mobile transformation: the plan moves under the day, the track keeps its windows with half the hour labels, release rows re-stack; the public header folds its menu under the logo | 7/10 |
| Usability / readability: the words carry every window («Вход закрыт по плану: 14:15–14:45, 19:45–20:15»); focus visible (`04-keyboard-focus`); 44 px targets on phones; rose and green are backed by words | 9/10 |
| **Total** | **82/100** |

Automatic-fail check:

| Condition | Result |
|---|---|
| Total ≥ 80 | PASS |
| Signature object exists | PASS |
| Not renameable to any SaaS (a binary-options learner's news plan, L26–L29) | PASS |
| No sidebar + card grid | PASS |
| Three identical directions | n/a (the owner fixed the direction) |
| Mobile is not a stacked desktop (the track and the rows re-compose) | PASS |
| No landing-level low contrast | PASS |
| No first viewport with more than six identical cards | PASS |
| Not one shape everywhere | PASS |
| Identity not built on icons alone | PASS |
| Connection to at least two references | PASS |
| No decorative market elements (no price chart; the track is the learner's plan) | PASS |

Objective counts:

| Screen | Same-type cards | Surface geometries | Icon dependence | Branded objects | Hierarchy levels | Contrast problems | Unadapted landing-only |
|---|---|---|---|---|---|---|---|
| Tool, desktop | 0 | 6: field, territory, status well, track, rows, chips | ~2% (the day arrows carry names) | 3: territory Signal edge, the track, the status line | 4 | none | none |
| Tool, mobile | 0 | 6 | ~2% | 3 | 4 | none | none |
| Public list, desktop | 0 | 5: header pill, paper hero, ledger, invitation, footer | 0% | 3: header pill, currency chips, invitation | 4 | none | none (hero adapted to a reading page) |
| Public article, mobile | 6 small «Другие новости» links | 6 | 0% | 3 | 4 | none | none |

**Verdict: PASS** (82/100, no automatic fail).

Top fixes for later, ranked:
1. If the owner wants it, the Entry Checklist's «Рядом нет важной новости (±15 мин)» could name the next window from this plan. That is cross-tool, so it needs the owner's word (answer 8).
2. An in-app «Новости» menu item for signed-in learners below L30.
3. On PROD: `ACADEMY_SEARCH_INDEXING=on` with the production origin, and redirects from the PREPROD addresses if any were ever indexed.

## Sign-off
- Critical and major findings are closed.
- The screenshots are real renders of the real routes, on a scratch stack with the real Backend and CRM code.
- The console is clean at every width.
- The anti-generic review passes.
- Ready for the owner's review before release to PREPROD. The release carries migration 59 (two new tables) and the CRM role change.
