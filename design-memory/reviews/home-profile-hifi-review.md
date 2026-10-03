# HOME & PROFILE HI-FI — screenshot review

- **Date:** 2026-10-03
- **Scope:** the signed-in Home (`/home`), the Profile (`/profile`) and its new support part
  (`/profile/support`), and the shell's navigation that no longer carries support.
- **Owner, 2026-10-03:** «Теперь наполни внутреннюю главную, после сделай ее хай фай, так же сделай с
  профилем, наполни как нормальный профиль на платорме, поддержку тоже сюда переноси, что бы написать
  в поддержку можно было только из профиле, не по ссылке из хеда, как наполнишь так же сделай хай
  фай». Asked first: direction — «Выбери сам»; PREPROD — «Да, по готовности».
- **Art-direction gate:** run internally; the owner delegated the choice explicitly. Home — **B
  «Линия программы»** (of A «Пульт», B, C «Сводка»); Profile — **C «Шапка и части» with A's
  sections** (of A «Паспорт», B «Кабинет», C). Reasons in DD-337 and below.
- **Decision:** DD-337. Backend: `memberSince` on `GET /api/me/account` (branch `home-profile/v1`).

## The three directions, briefly

| | Home | Profile |
|---|---|---|
| A | «Пульт»: two columns — the priority and the module left, a feed and tools right | «Паспорт»: one column, identity header, sections, support as a section with a link |
| B | «Линия программы»: one axis — the whole program as a line, the priority hanging from the learner's point, then the module, tools, news | «Кабинет»: a passport column beside a working pane; support in the pane |
| C | «Сводка»: one sentence of status, numbers in text, three equal columns | «Шапка и части»: the passport across the column, two parts — «Аккаунт», «Поддержка» |
| Chosen | **B** — the brand's luminous route made functional at the program's scale (the lesson page draws the lesson's line, Path the module's, Home the program's), and the Decision Frame Path already uses ties «where am I» to «what now». A is a grid of equal columns (the D1A failure); C has no signature object and reads as a report | **C with A's sections** — support is visibly a part of the profile and one tap away; B's narrow pane would squeeze the support desk's two columns; in A support falls below the first screen |

## Captures (before)

`design-memory/screenshots/home-profile-hifi/before/` — the stand on the released Academy code
(`1df2ff1`): `home-l04-d/m`, `home-l10-d/m` (one sentence and one button on a 1440 screen),
`profile-l04-d/m` (three rows against the left edge), `support-l04-d/m` (support in the bar),
`path-l04-d`, `notifications-l04-d` (the neighbours the new pages must sit beside).

## Findings

| # | where | problem | severity | status |
|---|---|---|---|---|
| 1 | Home | one sentence and one button; 60% of a 1440 screen empty; nothing about where the learner is, what they have, what changed | critical (the owner's ask) | fixed — greeting, the program line, the priority in its frame, the module, tools, «Что нового» |
| 2 | Profile | three rows against the left edge (x = 32 while every page beside it starts at 244); no identity, no record, no way out | major | fixed — the product's column, the passport, the parts, the session |
| 3 | shell | support in the desktop bar and in «Ещё»; the owner wants it only in the profile | major | fixed — out of both bars; `/profile/support`; `/support` redirects there |
| 4 | mobile bar (found in QA) | with support gone and Community withheld «Ещё» opened a sheet of one row, «Профиль» | major | fixed — one destination takes the fifth slot; «Ещё» returns with a second one (tested with Community shown) |
| 5 | Home, every open level done (found in QA) | the module in focus fell back to the LAST module (06), and the line under the greeting said «модуль 6 из 6» | major | fixed — the first module still ahead or being prepared, and «Дальше: глава 2 · … · модуль 4 из 6» |
| 6 | Home, the 100-level program at 390 (found in QA) | a hundred 6px points do not fit: the line ran past the gutter and twenty module numbers touched | major | fixed — below 900px a long program keeps the lit stretch, the module breaks and the current point; only the module in focus keeps its number |
| 7 | Profile ring (found in QA) | a stroke per level read as a loading spinner | major | fixed — redrawn as the program line closed into a ring: a stretch per module, lit as far as the learner has come, the current level a Signal point |
| 8 | both, < 900px (found in QA) | the last block could end under the fixed bottom bar | major | fixed — the bar's clearance formula the support desk already uses |
| 9 | «Что нового» (found in QA) | the server prints UTC: «Сегодня, 06:05» three hours off | major | fixed — the time is printed by the browser, on the learner's clock; the slot keeps its width until then |
| 10 | Profile ≥ 1200 (found in QA) | rows ended at two x positions (616 inside the grid, 720 after it); the support card was 176px wide | minor | fixed — one measure for every row, the card 280px |
| 11 | Profile 768 (found in QA) | two rules 40px apart between «Сеанс» and the support card | minor | fixed — spacing, one rule |
| 12 | Profile | «Это имя отображается в вашем профиле ATA.» stood at the foot of the page, after security | minor | fixed — under the name |
| 13 | Home 360×780, 320×640 | for a three-line basis the handoff falls just below the first screen (360: bottom 755, bar at 720) | minor | open — visible at 390×844 and larger; a short scroll on the smallest phones |

## Fixes applied

Home is one axis. The greeting by name, where the learner is (chapter, its title, the module) and three
counts. The program line — a point per level, broken into modules, chapters named above it; done light
grey, the current point Signal with its halo, ahead an open ring, being prepared dashed — and from the
current point a leader into the priority's frame (Signal corners, as on Path). Beside the priority, what
the step gives: the level's XP, the tool it opens, the level after it; with every open level done, where to
go meanwhile. Under it the module's levels (open ones are links, the current one marked), «Дальше: модуль …»,
the tools the learner has and the next one by its level, and «Что нового» — the register's last three, by
its own rules. The priority itself is the same field: one h1, one handoff, its postures; it gained the
level's number, which ties it to its point.

Profile is the product's column. The passport: initials inside the ring, the name, the address, «В Академии
с 2 октября 2026», four counts and «Открыть путь». Two parts as links — «Аккаунт», «Поддержка». The account:
the rows (the address now printed where support changes it), security, the support card (the latest two
requests with their state) and «Сеанс» with «Выйти из аккаунта». The support part: the same desk, laid into
the column under the passport.

## Captures (after)

`design-memory/screenshots/home-profile-hifi/final/` — the stand (Academy dev `127.0.0.1:3059` → Backend dev
`127.0.0.1:3199`, the throwaway database with the 30-level program; three notifications and support
requests made there for the review), at 1440×900, 1024×768, 768×1024 and 390×844:
`home-l04` (four sizes, «Что нового» filled), `home-l09` (a report level that opens a tool), `home-l15`
(every open level done), `home-v4-l2a` (a learner of the 100-level program, from a copy of the scratch
database the lesson review used), `profile-l04` (four sizes), `profile-support-l04` (four sizes),
`profile-support-thread-l04`, `profile-name-edit-l04`, `profile-l15`, `profile-v4-l3`, and first-screen
crops `home-l04-first`, `profile-l04-first` at 1440×900 and 390×844.

## Before/after

- **Home, 1440.** Before — «ГЛАВНАЯ / ТЕКУЩИЙ ПРИОРИТЕТ / ТРЕБУЕТСЯ ДЕЙСТВИЕ» in a left rail and «Продолжите
  проверку знаний» with «Продолжить», then 500px of nothing. After — «Здравствуйте, Вера», «Глава 1 · Основы
  и первые реальные сделки · модуль 1 из 6», 100 XP · 3 из 30 · 0 из 6; the line with three grey points, the
  Signal point at L04, chapter 2 dashed «готовится»; the leader into the frame «Уровень 4 · Как читать график…
  / Продолжите проверку знаний / Продолжить» with «+100 XP · Дальше: Уровень 5»; below, module 1's five
  levels, «Trade Card откроется после уровня 5», three changes from today and yesterday.
- **Profile, 1440.** Before — «ПРОФИЛЬ», a lead, three rows at x = 32. After — the passport in the centred
  column, the parts, the rows beside the support card.
- **Phone.** The bar is «Главная · Путь · Уроки · Инструменты · Профиль»; Home keeps the whole line at a finer
  grain, the handoff full width inside the first screen; the profile's parts are two halves of the width.

## Measured, not judged

- **Overflow:** none on `/home` (three learners), `/profile` (two), `/profile/support` at 1440, 1024, 768, 390,
  360 and 320; the 100-level line inside the column at every width.
- **Targets:** no link or button in the page or the bottom bar under 44px at any of the six widths.
- **The leader:** from the current point to the frame's top edge, gap 0px at every width, inside the frame.
- **First screen:** the handoff fully visible above the bar at 1440×900 (612), 1024×768 (590), 768×1024
  (643), 390×844 (707); not at 360×780 / 320×640 for a three-line basis (finding 13).
- **Overlaps:** none between chapter names, module numbers and the route's label and link; none in the head;
  none in the passport.
- **Contrast** (lowest per role): quiet labels and counts 5.1:1, the aside's labels and «В Академии с …»
  4.8:1, «где вы» 8.5:1, the basis 8.1:1, the address 8.1:1, the parts 8.5:1.
- **E2E on the stand:** 25 of 25 — the greeting, the line's sentence, one h1, the handoff into level 13, no
  support in the bar, the phone bar and its «Профиль», `/support` → `/profile/support`, a request opened
  from the profile and shown on the account part's card, a new name reaching the passport and the avatar
  (and back), «Что нового» newest first on the browser's clock, signing out from the profile.

## Console result

No page errors and no console errors on the captures, the measurements or the e2e walk.

## Anti-generic score (ata-anti-generic-ui-review)

**Home — learner on level 4** (emotional mode; `final/home-l04-d.png`, `final/home-l04-m.png`,
`final/home-l15-d.png`).

| Criterion | Score |
|---|---|
| Connection to ATA DNA: the luminous route trace (refs 01–03) as the program itself; the Decision Frame; Ink field; Signal only on the current point, its leader, the frame and the handoff; chaos → a legible system of 30 points | 17/20 |
| Structural originality: one axis, the line as the page's horizon, the priority hanging from the learner's point; not a card grid | 13/15 |
| Product meaning: points are levels, the leader is «now», the aside is what this step gives, tools by the Backend's verdict, changes by the register's rules | 14/15 |
| Typography: 36px greeting, 40px priority, mono counts and codes, quiet labels at 5:1 | 9/10 |
| Signature object: the program line with its leader into the frame | 9/10 |
| Progression clarity: where (the point, the module), what now (the frame), what next (the aside, «Дальше») | 9/10 |
| Mobile transformation: the line kept whole at a finer grain (no points for a long program), full-width handoff, the lower blocks in reading order | 8/10 |
| Usability / readability: 44px targets, contrast ≥ 4.8, no overflow from 320 | 9/10 |
| **Total** | **88/100** |

**Profile — account and support parts** (functional mode; `final/profile-l04-d.png`,
`final/profile-support-l04-d.png`, `final/profile-l04-m.png`).

| Criterion | Score |
|---|---|
| Connection to ATA DNA: the ring is the program line closed round the person; Ink, Signal on the current level and the active part; mono for the record | 16/20 |
| Structural originality: a passport across the column, parts as addresses, rows beside a support card | 12/15 |
| Product meaning: the record is the learner's real counts, «В Академии с» the account's own date, the card shows real request states | 14/15 |
| Typography: 28px name, mono record and date, rows at reading size | 9/10 |
| Signature object: the ring | 8/10 |
| Progression clarity: «уровень 4 из 30», the ring, «Открыть путь» | 8/10 |
| Mobile transformation: ring beside the name, record 2×2, the parts as two halves, desk under them | 8/10 |
| Usability / readability: 44px targets, contrast ≥ 4.8, the editors unchanged | 9/10 |
| **Total** | **84/100** |

Automatic-fail check (both): total ≥ 80 PASS · signature object PASS · not renameable (a program of
chapters and modules with «готовится», a priority that hangs from a level, «В Академии с») PASS · no sidebar +
card grid PASS · three directions structurally different (horizon / two columns / text report; one column /
two panes / band and parts) PASS · mobile is not a stacked desktop (the line at a finer grain, the bar's
«Профиль», parts as halves) PASS · no low-contrast body PASS · no six identical cards PASS · not one shape
everywhere (frame, points, ring, rows, underline) PASS · identity not on icons PASS · two references (01/03
the ascending luminous trace; 04 the line as structure) PASS · no decorative market elements PASS.

Objective counts — Home (desktop / phone): same-type cards 0 / 0 · surface geometries 5 / 5 (frame, row
highlight, points and rings, button, hairline blocks) · icon dependence 0% / 0% in the page · branded
objects 2 (the line, the frame) · hierarchy levels 5 · contrast problems none · unadapted landing-only none.
Profile: same-type cards 0 / 0 · surface geometries 4 / 4 (passport, ring, part underline, rows) · icon
dependence 0% · branded objects 1 (the ring) · hierarchy levels 5 · contrast problems none.

**Verdict: PASS (Home 88, Profile 84).**

## Sign-off

Critical and major findings fixed; one minor open (finding 13). Not checked under a learner on PREPROD:
sign-in there is CAPTCHA-gated and an agent cannot mint a session.
