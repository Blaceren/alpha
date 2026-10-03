# Public Home on a phone — review (DD-342)

Owner, 2026-10-03, after DD-340: «лучше, но мобильная версия внешней главной мне не нравится. ее нужно
сделать намного лучше, такая не понятная получается». Answers: direction — «Выбери сам», release — «Да,
по готовности». Scope: the phone composition (≤680px; the tools deck ≤920px). Wide screens unchanged.

## 1. What a phone shows today (live `f8682d7`/`1c47cc0`, 390×844, measured)

| | |
|---|---|
| Page height | **18 158 px — 21.5 screens** |
| Product windows on the way down | **18** (hero frame, Trade Card, 6 cycle objects, review window, 8 route/tool windows, …) |
| Text under 11 px / 11–13 px | **103 / 121** elements — 71 / 66 of them inside the route's eight windows |
| Numbered sequences one after another | **4**: cycle 01–06, review 01–04, route Старт·L1·L2·L3, tools L5…L30 |
| Section headings | 48 px serif, 3–7 lines each (the final call: 7 lines) |
| Tools segment | 4 022 px — six windows stacked, ≈ 4.8 screens |
| Cycle | 2 553 px — every step ends in a mini window with a button that does nothing |

Read as a visitor: the page has no single line to follow. Every idea gets a full-screen headline, then a
miniature interface whose words are too small to read and whose buttons look tappable. The same objects
come back several times (the Trade Card's reason: cycle 02, #decide, the tools; the next action: cycle 03
and the home window; the levels: cycle 06 and the path window). The six tools are a wall.

## 2. Art-direction gate — three structurally different phone compositions

Shared for all three: product thesis — ATA is a free, sequential learning environment where a learner
forms and checks their own trading decisions, one clear next step at a time. User moment — someone on a
phone who followed a link, does not trade professionally, and has about a minute to decide whether to
sign up. References: manifest §A1 deep field, §A2 luminous line as structure, §A4 one dominant object
per scene, §A5 chaos → system; frames `prelanding-desktop-02.png` (route becomes structure) and
`prelanding-desktop-04.png` (numbered vertical spine). Not transferred (§C): tiny tracked labels for
important information, low-contrast body, decorative numbers, scroll-driven scenes. No mentor persona
(owner 2026-09-22), so «Alex Curie strategy» = none in all three: the product, not a person.

### Direction A — «Одна лента» (one reading line)

1. Thesis: as above.
2. Moment: the visitor scrolls once, top to bottom, and must leave knowing what ATA is, how a level works and what they get.
3. Visual thesis: on a phone the page is ONE argument read downwards; a luminous line appears only where something really is a sequence.
4. DNA: §A2 line as structure, §A4 one object per idea, §A5 the «many → one» of #decide.
5. Provisional idea tested: §B «Vertical light ray → Learning Spine» — the cycle as a numbered spine that fits one screen.
6. Signature object: the six-step spine (01 Понять … 06 Продвинуться) — the product's loop, readable at a glance.
7. Composition: single column, every section = eyebrow, heading ≤3 lines, one sentence, ONE object; objects that repeat further down are not shown twice.
8. Typography: display face for headings only (34 px on phones, not 48), body 15–16 px, mono labels ≥11 px, nothing important in tracked capitals.
9. Materials: the existing ink / signal / paper surfaces; one product window per idea, no window inside a list of steps.
10. Navigation: unchanged header and menu (all anchors kept); «Посмотреть, как работает ATA» lands on the spine.
11. Progression: the spine shows the loop of one level; the route (Старт → L1 → L2 → L3) and the path window show levels; nothing else is numbered.
12. Persona: none.
13. Motion: the existing one-shot reveals; the spine draws once.
14. Mobile transformation: removes ~6 duplicate objects, re-scales type, the cycle collapses from 2.5 screens to one.
15. Wireframe (phone):
```
+----------------------+
| ATA      Войти  Меню |
| eyebrow              |
| Возможности не       |
| приходят с готовыми  |
| ответами.            |
| text                 |
| [Посмотреть, как …]  |
| [ Начать путь ]      |
| [ frame: video slot ]|
| 20 мод. | 100 ур.    |
|----------------------|
| ЧУЖИЕ ОТВЕТЫ  chips  |
|        |             |
| ВАШЕ РЕШЕНИЕ [card]  |
|----------------------|
| Цикл …               |
| (01)─ Понять   text  |
|  |                   |
| (02)─ Решить   text  |
|  …                   |
| (06)─ Продвинуться   |
|----------------------|
| review: 01-02-03-04  |
| [window]             |
| route · home · path  |
| tools: 6 rows (text) |
| fit · boundaries     |
| FAQ · Начать путь    |
+----------------------+
```
16. vs D1A: no card grid, no KPI tiles; one column of argument, not a dashboard.
17. Not renameable: the spine is ATA's own loop (decide, check, correct, advance) and the objects are ATA's report and Trade Card.
18. Refs: 02 (route → structure), 04 (numbered spine).
19. Not transferred: §C tiny labels, low contrast, decorative numbers, scroll scenes.

### Direction B — «Колоды» (decks)

1–2. As A.
3. Visual thesis: every block of several parallel items becomes a horizontal deck under a numbered rail — a presentation the visitor flips with a thumb; the page shrinks to ~9 screens.
4. DNA: §A2 line as structure (the rail), §A4 one object at a time.
5. Provisional idea: §B «Signal point / current-position marker» — the lit node on each rail.
6. Signature object: the rail-deck: a line of numbered nodes, lit up to the card on show, above a card that slides.
7. Composition: vertical chapters, each holding one deck (cycle 6, review 4, route 3, tools 6, fit 2).
8. Typography: as A; card headings 22–24 px.
9. Materials: each card is one surface; the rail is the only line.
10. Navigation: header unchanged; inside a chapter, swipe or tap a node.
11. Progression: every rail is a progression (01–06, 01–04, L5…L30).
12. Persona: none.
13. Motion: card slide (native scroll snap), node light; nothing automatic.
14. Mobile transformation: maximal — every list becomes a deck.
15. Wireframe (phone):
```
+----------------------+
| hero (as A)          |
|----------------------|
| Цикл …               |
| (01)-(02)-(03)-…(06) |
| +-----------------+--|
| | 02 Решить       | n|
| | [object]        | e|
| +-----------------+--|
|----------------------|
| review rail + window |
| tools rail L5…L30    |
| [card ← → ]          |
| fit: [card][card]    |
| FAQ · CTA            |
+----------------------+
```
16. vs D1A: decks are sequences, not a grid.
17. Not renameable: the rails are ATA's levels and stages.
18. Refs: 03 (signal point), 04 (numbered spine turned sideways).
19. Not transferred: as A.

### Direction C — «Карта» (map first)

1–2. As A.
3. Visual thesis: right after the hero, the whole journey on one screen — Старт → L1 → L2 → L3 → L5 … L30 with the review loop and the six tool unlocks marked — and every later section is one node of it, opened.
4. DNA: §A2 the route as the structure of the page, §A8 a constructed object (the map) made of the line and its nodes.
5. Provisional idea: §B «Текущий график» → the route itself as the page's table of contents.
6. Signature object: the journey map — a vertical route of ~10 nodes, each a link to its section.
7. Composition: hero → map → sections in the map's order → fit → FAQ.
8. Typography: as A; node labels 13 px.
9. Materials: the map on ink, sections as now.
10. Navigation: the map is the page's contents; nodes are anchors.
11. Progression: the map is the progression; sections repeat its numbering.
12. Persona: none.
13. Motion: the map draws once.
14. Mobile transformation: a new overview object first, sections after.
15. Wireframe (phone):
```
+----------------------+
| hero                 |
|----------------------|
| Весь путь            |
| o Старт  аккаунт     |
| o L1     среда       |
| o L2     урок + тест |
| o L3     практика ↺  |
| o L5     Trade Card  |
| o L10    Journal     |
|  …       …           |
| o L30    News        |
|----------------------|
| sections in that     |
| order                |
+----------------------+
```
16. vs D1A: an object of the product's own geometry.
17. Not renameable: the levels and unlocks are ATA's.
18. Refs: 01–03 (route), 04 (spine).
19. Not transferred: as A.

### Comparison

| | A «Одна лента» | B «Колоды» | C «Карта» |
|---|---|---|---|
| Overview of how a level works | one screen, whole loop | one step at a time | the map, but levels, not the loop |
| Product shown | once per idea, legible | all of it, one card at a time | the map + sections |
| Hidden behind a gesture | nothing | most of the page | nothing |
| Phone length (estimate) | ≈ 12 screens | ≈ 9 | ≈ 14 |
| Small text risk | low | low | **high**: ~10 node labels on 360 px |
| New numbering systems | none (one removed) | one rail per chapter | one more (the map) |
| Owner's past remarks | «один экран — элемент и то, что он меняет» ✓ | a switcher was «не понятно» once | — |

## 3. Choice — A, with B's rail-deck in exactly one place: the six tools

A is the structure: one reading line, one object per idea, the cycle as a spine on one screen, the
duplicates gone. The six tools are the one place where items are parallel and equally weighted and
where stacking costs 4 000 px; there B's rail-deck is the right object — and its rail is not decoration:
it is the real unlock levels L5…L30, so the control is also the information (when each tool opens), and
the control and the card it changes share one screen (the DD-340 lesson). B everywhere was rejected
because a loop is understood whole, not card by card, and decks for two items (fit) or for the review
(already a stepper) add gestures without adding sense. C was rejected because ten labelled nodes on a
360 px screen means small labels for important information (§C) and a fifth numbering system.

**DD-342** records the decision.

## 4. What was built

| Phone (≤680; the deck ≤920) | Before | After |
|---|---|---|
| Page at 390 / 320 / 768 | 18 158 / 19 922 / 15 160 px | **12 147 / 13 258 / 12 481 px** (−33 / −33 / −18 %) |
| Cycle (#mechanism) at 390 | 2 553 px, six mini windows with buttons that do nothing | **993 px**: a spine of six numbered steps on one line, one sentence each |
| Tools at 390 | 4 022 px, six windows stacked | **978 px**: one deck under the rail L5…L30 |
| Section headings | 48 px, 3–7 lines | 24–36 px (`clamp(24px, 7.8vw, 36px)`), 2–4 lines |
| Small print in the windows / eyebrows | 9–10 px | 11 px up to 920px (the hero's line and frame unchanged by decision) |
| #decide stacked | chips, a dot, a card — no words | «Чужие ответы» over the chips, «Ваше решение» over the card |
| Path facts | name and value side by side, «Последовательность» past its column at 320 | the name over its value, body size |
| Review window | its sequence went on off screen; the page jumped 170–250px under the visitor | plays only while 60 % of it is on screen; the block never gets shorter at one width |

Markup: `product-route.tsx` (the rail and the deck's scroll sync; the vertical observer leaves the deck
alone; a tool title in the deck brings its card sideways instead of scrolling the page),
`product-route-data.ts` (`name` per step), `public-home-screen.tsx` (two aria-hidden captions),
`review-window.tsx` (in-sight sequence, kept height). Styles: one layer at the end of
`public-home.css`, «THE PHONE COMPOSITION». Tests: `public-home.test.tsx` (+8: the rail from the
catalogue, its controls, press → card/rail/note, title in the deck, deck only ≤920, the captions, the
spine, the heading scale; `trail` joins the line-behind-nodes holders), `review-window.test.tsx`
(+3: in sight only, a third is not enough, resumes from the same state).

## 5. Visual QA (real browser, production build on the stand, then live)

Findings, before → after:

| # | Width | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | phones | 21.5 screens; the tools a 4 000px wall | critical | fixed — deck, 978px |
| 2 | phones | the cycle 2.5 screens of mini windows with dead buttons | major | fixed — spine, one screen |
| 3 | phones | the review sequence changed height off screen → page jumped 170–250px | major | fixed — in sight only, never shrinks |
| 4 | 320–414 | «самостоятельности.» ran 5–9px past its box (the earlier 12.3vw − 6px fix did not hold) | major | fixed — page phone scale |
| 5 | 320 | path facts: «Последовательность» past its column at body size | major | fixed — name over value |
| 6 | 320 | path window: «пройден»«пройден» ran into one word; «уровни 1–5» cut at 11px | minor | fixed — the ticks say it; the head wraps |
| 7 | ≤920 | 8.5–10.5px small print in every product window (times, statuses, counters, levels, the path's nodes), eyebrows | minor | fixed — 11px, the page's floor |
| 8 | ≤920 | «многое → одно» stacked without words | minor | fixed — two captions |
| 9 | phones | screen-high gaps in «Что такое ATA», FAQ, the first step | minor | fixed — 36–48px |
| 10 | phones | the hero's line and the frame's demo badge stay 10px | minor | kept — the hero frame is the owner's (video slot) |

Measured on the production build (`rsp/` kit): 15 phone/tablet/landscape sizes — no sideways scroll, no
text cut, no overlap, nothing past the edge except the next deck card at the deck's own edge (by design);
the only «wider» left is the boundaries heading at 932×430 (landscape, from the earlier pass). Hit test of
every node of every drawn line, 7 widths: **169 of 169**, nothing painted over a node (the rail
included). Gaps around the floating header: **26 of 26** positions clean. The menu open: **6 of 6**.
Deck: a press on L15 brings Risk Calculator (scroll 664px at 390), L30 → News Calendar, a swipe of one
card moves the rail with it, a title in the deck moves the deck and not the page. Desktop unchanged:
the stand and live captured in one tall viewport at 1024, 1280, 1440 and 1920 — **0 pixels differ**.
Console: no errors.

## 6. Anti-generic review — phone, 390×844

Screenshots: `design-memory/screenshots/public-home-mobile/after/`.

| Criterion | Score |
|---|---|
| Connection to ATA DNA | 18/20 — ink field, the luminous line as the cycle's spine, the route and the rail; one Signal accent; «многое → одно» spelled out |
| Structural originality | 13/15 — one reading line with a spine and a rail-deck, not a card grid |
| Product meaning | 14/15 — every number is the product's: the loop's steps, the levels L1–L3, the unlock levels L5…L30, the review's stages |
| Typography | 8/10 — headings 24–36px, body 15–16px, small print 11px; the hero line stays 10px by decision |
| Signature object | 8/10 — the spine (cycle) and the rail over the deck |
| Progression clarity | 9/10 — the loop in one screen, then the levels, then what opens when |
| Mobile transformation | 9/10 — a rethink: objects not repeated, a deck where items are parallel, heights that hold |
| Usability / readability | 9/10 — 44px targets, no overlap, no jumps, nothing hidden behind a gesture except the five other tools |
| **Total** | **88/100 — PASS** |

Auto-fail check: no signature object — PASS; renameable to any SaaS — PASS (ATA's loop and levels);
sidebar + card grid — PASS; three directions one skeleton — PASS (§2); mobile = stacked desktop — PASS;
landing-level low contrast body — PASS; >6 identical cards in the first viewport — PASS (0); one shape
everywhere — PASS; identity by icon library — PASS; <2 references — PASS (02, 04); decorative market
elements — PASS. Objective counts (390): same-type cards 6 (the deck, one on screen); surface
geometries 4 (section, window, pill, node); icon dependence ~0 %; branded objects 4 (spine, route, rail,
decision frame); hierarchy levels 4; contrast notes: the receding chips (by design, captioned); landing-only
patterns transferred: none.
