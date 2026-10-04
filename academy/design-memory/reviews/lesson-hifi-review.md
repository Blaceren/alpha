# LESSON HI-FI — screenshot review

- **Date:** 2026-10-02
- **Scope:** the level page (`/lessons/<code>`) for every kind of level, and the lesson player
  (`components/media/academy-video-player`): the stage, the lesson line with the test's points, the
  resume offer, speed, the docked player, the reading position.
- **Owner, 2026-10-02:** «Теперь доведи экран урока и плеер до хай фая». Directions page:
  https://claude.ai/artifact/B62Kxtm4WcyG5fGWuG6hnG (A «Сцена», B «Рабочий стол», C «Маршрут урока»,
  19 points each, wireframes 1440/390). Then: «Проанализируй выбери лучшее и реализовывай, на предпрод
  по готовности можешь выкатывать без моего разрешения дополнительного».
- **Art-direction gate:** run. The owner delegated the choice explicitly; chosen **A «Сцена» with B's
  docked player** — reasons in DD-336.
- **Decision:** DD-336. Backend: `questionMarkers` on the lesson content (branch `lesson/hifi-v1`).

## Captures (before)

`design-memory/screenshots/lesson-hifi/before/` — the released Academy (`d2bba56`), from the levels
1–30 review: `level4-failed-review-1440/390`, `level1-available-1440/390`, `level15-in-production-1440`,
`level9-report-draft-1440`, `level4-rewatch-playing-1440x900`.

## Findings

| # | where | problem | severity | status |
|---|---|---|---|---|
| 1 | level page, wide screens | a document column held to the left; a third of the screen empty; the lesson was not the page's subject | critical | fixed — one axis: title, stage, reading column |
| 2 | player | a box in a box (a frame round the video and another round the bar), three round buttons over the picture: any player | major | fixed — the stage: bar under the picture, one control on it in pause |
| 3 | player + test | nothing on the timeline said where the answers are taught; the test and the video met only in one button | major | fixed — the lesson line: the test's points, then their verdicts |
| 4 | player | no «продолжить с места», no speed — the Backend already kept the position | major | fixed — «Продолжить с 3:42», 0,75–2× |
| 5 | phone | «Пересмотреть» took the learner up to the video and away from the question | major | fixed — the player docks along the top and the question is kept under it |
| 6 | header | the state said three times; how the level completes and its XP in a parameter table at the bottom | major | fixed — one line of facts under the title; the state sentence only for a waiting or closed level |
| 7 | docked player (found in QA) | the stage's place collapsed when the player docked: the page jumped 650px under the reader | major | fixed — the stage keeps its last height while the player is away |
| 8 | 1440×900 (found in QA) | the player's bar fell below the first screen | major | fixed — the stage is as wide as the first screen allows |
| 9 | 390 (found in QA) | the stage stopped 32px short of the right edge | minor | fixed — edge to edge |
| 10 | 390 (found in QA) | wrapped facts started a line with a separator | minor | fixed — no separators on a phone |
| 11 | level 15 (found in QA) | three left edges: the state chip, the description and the links | minor | fixed — the same column |
| 12 | failed attempt | «Не пройдено. Верно 2 из 4» printed twice (status and result) | minor | fixed — the status stays for a screen reader only |
| 13 | docked player, 900–1683px | the corner player covers the right edge of the text below the question being rewatched; that question stays clear; closable | minor | open — for the owner's look |

## Fixes applied

The page reads as one route on one axis: the title and its facts, the stage, and the column with the
result, what the lesson is about, the task and the tool. The player is the stage — the deepest surface
of the product, the bar under the picture, Signal only on the played line, the playhead, a right
answer's point, the chosen speed and focus. The lesson line carries the points of the test; after an
attempt they say right or wrong, and a press plays from there. «Пересмотреть» docks the player where
the learner is. The position is kept through the lesson-progress command the reader uses.

## Captures (after)

`design-memory/screenshots/lesson-hifi/final/` — the stand (Academy dev `127.0.0.1:3059` → Backend dev
`127.0.0.1:3199`, a throwaway SQLite with 61 migrations and the program published; the 500-second
stand clip on the video lessons, a black 10-minute file on 9, 13 and 14 as on PREPROD), at 1440×900,
1024×768, 768×1024 and 390×844: level 1 before start (four sizes), level 4 before start, its test and
a failed attempt (1440, 390), the docked rewatch (four sizes), level 9's report and level 13's
practice with their videos, level 3, level 15, and a learner of the 100-level program on its level 2
(`v4-level2-started-1440`, from a scratch copy of PREPROD).

## Before/after

- **Level 4, 1440.** Before — the column at x=216, the player boxed, the test boxed in boxes, a
  parameter table at the bottom. After — the title centred with «доступен · видео 8:20 · тест после
  урока · +100 XP», the stage 874px wide with its bar inside the first screen, the line with points
  1–4, the test as a sheet; after a failed attempt points 1 and 4 turn rose and 2, 3 Signal.
- **Rewatch.** Before — the page scrolled up to the player; the question left the screen. After — the
  player docks (corner at 1440/1024, the top at 768/390) and plays from 1:56; the question measured
  clear of the player at every size.
- **Phone.** The stage runs edge to edge; the bar keeps play, ±10, the clock, speed and full screen.
- **The 100-level program.** Its text lessons keep «Материал» and «Открыть материал урока»; the facts
  line reads «тест после урока · +100 XP» and «отчёт · проверяет наставник · +500 XP».

## Measured, not judged

- **Overflow:** none on seven pages at 1440, 1024, 768, 390, 360 and 320.
- **Targets:** no control under 44px — player buttons, the points of the line (44×44 hit areas around
  a 12px point), speed, resume, «Пересмотреть», the test's options (48px).
- **Nothing crosses a number:** the line's numbers against each other, the track, the points and the
  playhead, and the facts against each other — no intersection on any page at any width.
- **First screen:** the whole stage (picture and bar) inside the viewport at all four sizes
  (1440×900: 286–884; 1024×768: 228–696; 768×1024: 210–727; 390×844: 247–570).
- **Contrast:** facts 8.5:1, the coordinate 5.1:1, the result 17.0:1, lesson text 8.5:1, the line's
  numbers 8.5:1, the clock 5.1:1, speed 17.0:1.
- **Rewatch (e2e):** plays from 1:55, docked, the question clear of the player — 35 of 35 stand
  checks.

## Console result

No page errors and no console errors on the 20 captures and on the e2e walk.

## Anti-generic score (ata-anti-generic-ui-review)

**Level page with its lesson — level 4, before start and after a failed attempt** (functional mode;
frames `final/level4-available-1440.png`, `final/level4-failed-1440.png`, `final/level4-failed-390.png`,
`final/level4-rewatch-docked-390.png`).

| Criterion | Score |
|---|---|
| Connection to ATA DNA: the line as structure (lit on the stage, then down the column); one dominant object; Ink field; Signal only where current or right; fine metadata in mono (coordinate, facts, timecodes) | 17/20 |
| Structural originality: a stage and a reading column on one axis, the line joining them; the player that docks to keep a question in view | 13/15 |
| Product meaning: the points are where the answers are taught; their verdicts; rewatch beside the question; resume from the Backend's own position; facts instead of a parameter table | 14/15 |
| Typography: a balanced 42px title, mono facts and timecodes, the test at reading size | 9/10 |
| Signature object: the lesson line with the test's points | 9/10 |
| Progression clarity: watch → the test (the point on the line down the page) → the completion moment | 9/10 |
| Mobile transformation: the stage edge to edge, the docked player along the top with the question under it, a thumb-sized bar | 9/10 |
| Usability / readability: 44px targets, keyboard, speed menu, contrast as above, no overflow from 320 | 9/10 |
| **Total** | **89/100** |

Automatic-fail check: total ≥ 80 PASS · signature object PASS · not renameable (the test's points on
the lesson's own line; «пересмотреть с 1:55») PASS · no sidebar + card grid PASS · three directions
structurally different (stage / two panes / stations) PASS · mobile is not a stacked desktop (edge-to-
edge stage, docked top player) PASS · no low-contrast body PASS · no six identical cards PASS · not one
shape everywhere (stage, sheet, pills, points) PASS · identity not on icons PASS · two references
(prelanding 01/03 route and signal point; 04 the line as structure) PASS · no decorative market
elements PASS.

Objective counts (level 4, desktop / phone): same-type cards 0 / 0 · surface geometries 5 / 5 (stage,
sheet, option rows, pills, points) · icon dependence ≈ 6% / 6% (transport only) · branded objects 2
(the stage, the lesson line) · hierarchy levels 5 · contrast problems none · unadapted landing-only none.

**Verdict: PASS (89).**

## Sign-off

Critical and major findings fixed; one minor left open for the owner (the corner player over the
right edge of the text at 900–1683px). Not checked under a learner on PREPROD: sign-in there is
CAPTCHA-gated and an agent cannot mint a session.
