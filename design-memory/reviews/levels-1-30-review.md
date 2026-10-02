# LEVELS 1–30 — screenshot review

- **Date:** 2026-10-02
- **Scope:** the first thirty real levels on the learner's side, and the lesson player:
  - the level page (`/lessons/<code>`) — a video lesson with a test, a lesson without a test, the
    registration level, the formal report, a practical level, a level still in production;
  - the test's разбор and «пересмотреть с m:ss»;
  - the lesson player (`components/media/academy-video-player`) and the lesson media route
    (`/media/lessons/<level>/<file>`);
  - Path, Home and the tools' locked page for the new program; the CRM's correction dialog (one
    sentence).
- **Owner, 2026-10-02:** «следующий этап внедряем первые 30 настоящих уровней, вот описание того
  какой должна быть структура уровней, плеер так же добавляй уже, он по идее есть уже в проекте
  готовый и стилизируй его если надо под наш дизайн» + the document «Содержание воронки обучения ·
  уровни 1–30».
- **Decision:** DD-335.
- **Art-direction gate: not run.** No new composition was made: the level page, Path and Home keep
  their accepted compositions and gain the parts the program needs, in the material they already
  use; the player was asked to be brought under the existing design, not redesigned. The owner is
  told this in the report.

## Captures (before)

`design-memory/screenshots/levels-1-30/before/` — the released Academy (`871d298`) reading the new
program on the stand, at 1440:

- `level1-1440.png`, `home-level1-1440.png` — a lesson without a test: «Способ завершения: Не
  определён», no control to finish it, and Home said «Уровень пока недоступен — этот тип уровня не
  поддерживается».
- `level4-1440.png` — the test rendered beside «Начать», before the level was started; the player
  showed `0:00 / 0:00` with a disabled timeline although the file was loaded.
- `level9-report-1440.png` — the report as 67 fields in a column (10 118px tall); the switches of the
  optional refusals rendered as «Да / Нет» questions; «Отправить на проверку».
- `level15-closed-1440.png`, `path-all-open-done-1440.png`, `home-all-open-done-1440.png` — a level
  not open yet called «Заблокирован: Уровень недоступен», and the learner who had finished every
  open level was told «Следующий уровень пока закрыт».
- `tools-1440.png` — the hub already read the verdict (L05, L09, L13, L13, L24, L28).

## Findings

| # | where | problem | severity | status |
|---|---|---|---|---|
| 1 | level page, all | a lesson without a test (`lesson:lesson`) and a report nobody reviews (`report:formal_check`) had no surface: «Не определён», nothing to press | critical | fixed |
| 2 | Home | the same two methods resolved to «тип уровня не поддерживается» | critical | fixed |
| 3 | player | metadata loaded before hydration was never read: `0:00 / 0:00`, timeline disabled, skip buttons dead | critical | fixed |
| 4 | test | a failed attempt showed «Верно 2 из 4» and nothing else; the owner's rules ask for the разбор and the second of the video | critical | fixed |
| 5 | test | after a fail the answers stayed editable against a graded attempt; the next submit went to a closed attempt | major | fixed |
| 6 | level page | the test, the report and the completion control rendered beside «Начать», before the level was started | major | fixed |
| 7 | report | 67 fields in one column; the optional refusals' switches asked «Да / Нет»; an empty submit listed 55 links | major | fixed — records with a fill count, one «Добавить запись отказа» at a time, eight named errors and a count |
| 8 | report | a formal report said «на проверку», «ожидает проверки наставника» | major | fixed |
| 9 | report | after acceptance the page took focus into the middle of itself on every visit | major | fixed — focus follows a submission only |
| 10 | level 15, Path, Home | a level in production said «Заблокирован», «Следующий уровень пока закрыт» | major | fixed — «Готовится», «Открытые уровни пройдены» |
| 11 | registration level | «Проверить регистрацию» re-read the page and asked nothing; a registration made on level 1 was never settled on level 3 | major | fixed — the Backend's own record is asked on arrival and on the button |
| 12 | tools | the locked journal said «после контрольной точки L10» — the catalogue's memory of the 100-level program | major | fixed — the verdict's level and what that level is |
| 13 | Path | the line under the focus, «Сначала нужно завершить предыдущие уровни», read as being about the level in focus | major | fixed — it names the level it is about |
| 14 | player, 390 | the control bar ran through the three centre buttons | major | fixed — one centre button, above the bar |
| 15 | completion moment | «Вы уже начали этот уровень» stood under the finished level's title | minor | fixed — «Дальше · уровень 5 · …» above it |
| 16 | level 15, 390 | the state sentence wrapped below a dot left alone on its line | minor | fixed |
| 17 | registration level, completed | two buttons to the next level (the completion moment's and the confirmation's) | minor | fixed |
| 18 | report, 390 | the form is 8 900px tall — five records of ten fields is the assignment | minor | open — for the owner's review |
| 19 | lesson 9 | the lesson printed the document's notes to its producers («в образце обязательно…») | major | fixed in the package |

## Fixes applied

The level page is a lesson page: video, then what the lesson is about (printed on the page when it
is a short text beside a video — the 100-level program's 78 reading lessons keep their own surface,
checked against a copy of PREPROD), then one task, then the tool the level opens. The test keeps a
failed attempt on the screen as answered, marks each question «Верно / Неверно» in words, prints the
author's разбор under a wrong one, and «Пересмотреть с 1:55» brings the player into view and plays
from that second. The report is records. The player is the product's: flat Ink, the 8px corner, a
hairline, Signal only on the played timeline, its thumb, focus and the ended screen's way onward;
its look lives in its own sheet and no page restyles it.

## Captures (after)

`design-memory/screenshots/levels-1-30/final/` — the stand (Academy dev `127.0.0.1:3059` → Backend dev
`127.0.0.1:3199`, a throwaway SQLite with 61 migrations, the package imported and published,
synthetic learners walked to their levels through the shipped owners), at 1440, 1024, 768 and 390;
a 500-second VP8 clip with a running timecode registered as the video of the video lessons (drawn on
the stand, labelled «Тестовая запись стенда — не учебный материал»).

## Before/after comparison

- **Level 1.** Before — «Не определён» and nothing to press. After — «Начните урок · В этом уроке
  нет теста…», then «Урок без теста · Отметить урок пройденным», +50 XP.
- **Level 4.** Before — the test beside «Начать», the player at `0:00 / 0:00`. After — the player
  reads `0:00 / 8:20` on arrival; the test appears once the level is started; a failed attempt is a
  разбор, and «Пересмотреть с 1:55» plays from 1:56 with the player in view.
- **Level 9.** Before — a 67-field column, «Да / Нет» switches, «Отправить на проверку». After —
  five trade records and one refusal, each with «заполнено N из 10», one «Добавить запись отказа»,
  «Проверка автоматическая…», «Сдать отчёт»; accepted at once, then «Работа принята» with «Ваш
  отчёт» kept readable.
- **Level 15, Path, Home.** Before — «Заблокирован», «Следующий уровень пока закрыт». After — «Готовится»,
  «Дальше: Уровень 15 … · готовится», «Открытые уровни пройдены — 14 из 30».
- **The 100-level program after the activation** (`v4-*`): a learner pinned to it sees the pages it
  saw, with the start control worded for its test and no task rendered before the start.

## Measured, not judged

- **Overflow:** none on nine pages at 1440, 1024, 768, 390, 360 and 320.
- **Targets:** no control under 44px on those pages, nor in the failed-test state (the rewatch
  control 192×44, the retry 198×46); the verdict chip (65×23) is text, not a control.
- **Contrast** (text against the composited background behind it): lesson text 8.5:1, the разбор
  17.0:1 / 14.1:1, the verdict 16.1:1, labels 8.1:1, the formal-check line 8.1:1, the state line
  8.5:1, Path's count 11.4:1, Home's sentence 5.5:1, the lowest the record counter and the criteria
  line, 4.8:1 (muted text, still above 4.5:1).
- **The media route:** a learner gets the file of a level the Backend would give them the lesson of
  (200, 16 287 548 bytes identical to the source), a byte range (206 `bytes 1000-1999`, and a suffix
  range), 416 past the end, and 404 for: another learner's locked level, a path with `../`, an
  unknown file, a type that is not lesson media, another directory, a directory; an anonymous
  request is sent to sign in.

## The chain, end to end (on the stand)

35 checks, all passing, in the dev server and again in a production build of the same tree: the
start control's words; the clock on arrival; the test after the start; the разбор, its second and
the locked attempt; the rewatch playing from 1:55 with the player in view; a clean retry; four right
answers completing the level (+100 XP) and naming the next; a lesson without a test (+50 XP); the
registration level unregistered («пока не подтверждена») and registered earlier (settled on arrival,
completed); the report — records, the fill count, the named errors, one refusal on offer, add and
remove, accepted at once (+500 XP), no «наставник», kept readable without the removed record, the
journal opened from the level. No console errors on any of these pages.

## Console result

No page errors, no console errors and no failed local requests on the 21 captured screens at four
widths (84 captures) and on the walk.

## Anti-generic score (ata-anti-generic-ui-review)

**Level page — a video lesson with its test, failed attempt** (functional mode; frames
`final/level4-failed-review-1440.png`, `final/level4-failed-review-390.png`).

| Criterion | Score |
|---|---|
| Connection to ATA DNA: Ink field, hairlines, the one Signal on the action; the player is in the same material; the route coordinate «Глава · Модуль · Уровень» on top | 16/20 |
| Structural originality: a lesson read top to bottom — video, its text, one task — with the разбор pointing back up into the video; no cards | 12/15 |
| Product meaning: every wrong answer carries the author's разбор and the second of the lesson; a right one says «Верно» and steps back; attempts unlimited is said before the first answer | 14/15 |
| Typography: Manrope for the author's words, mono for the system's labels; the разбор at reading size | 9/10 |
| Signature object: the player as the lesson's centre, answering «пересмотреть с …» | 8/10 |
| Progression clarity: «Начните урок» → the test → the completion moment naming the next level | 9/10 |
| Mobile transformation: one centre button above the bar; the page a single column with 44px targets | 8/10 |
| Usability / readability: keyboard throughout, the rewatch control focuses the player, contrast as above, no overflow from 320 | 9/10 |
| **Total** | **85/100** |

**Level 9 — the formal report** (frames `final/level9-report-draft-1440.png`,
`final/level9-report-draft-390.png`, `final/level9-report-accepted-1440.png`).

| Criterion | Score |
|---|---|
| Connection to ATA DNA: the same field, hairline-separated records, choices as chips with the Signal edge only on the chosen one | 15/20 |
| Structural originality: records with a fill count, an optional record as one control | 11/15 |
| Product meaning: «Сделка 4 · Дата и время», «Проверка автоматическая», a refusal is a record of its own | 14/15 |
| Typography: labels 13px at 8.1:1, values 15px, counters in mono | 9/10 |
| Signature object: the record with its count | 7/10 |
| Progression clarity: «Сдать отчёт» → accepted at once → the completion moment | 9/10 |
| Mobile transformation: one column, chips that wrap, the toggles full-width | 7/10 |
| Usability / readability: the summary names eight and counts the rest; focus follows a submission only | 9/10 |
| **Total** | **81/100** |

Automatic-fail check (both): total ≥ 80 PASS · signature object PASS · not renameable (разбор,
«пересмотреть с 1:55», payout, expiry, «отказ») PASS · no sidebar + card grid PASS · three directions
n/a · mobile is not a stacked desktop — the report on a phone is a single column because a form is
one, and the player is rethought PASS · no low-contrast body PASS · no six identical cards PASS ·
not one shape everywhere PASS · identity not on icons PASS · two references PASS · no decorative
market elements PASS.

Objective counts (level 4 failed / level 9 draft, desktop): same-type cards 0 / 0 · surface
geometries 6 / 6 · icon dependence ≈ 4% / 0% · branded objects 3 / 2 · hierarchy levels 5 / 5 ·
contrast problems none · unadapted landing-only none.

**Verdict: PASS** (85 and 81).

## Sign-off

Critical and major findings fixed; one minor (the report's length on a phone) left for the owner.
Not checked under a learner on PREPROD: sign-in there is CAPTCHA-gated and an agent cannot mint a
session — the owner checks it after the release.
