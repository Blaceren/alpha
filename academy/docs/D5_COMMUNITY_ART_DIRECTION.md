# D5_COMMUNITY_ART_DIRECTION — three directions for Academy Community

**Phase:** ATA-PREPROD-COMMUNITY-END-TO-END-1, art-direction gate.

> **SELECTED (explicit user decision): B + A, a named merge.**
>
> - **Community Home = Direction B «Порог».** Five unequal space plates whose MATERIAL
>   communicates open / readable / locked, with a hierarchy that answers immediately where the
>   learner may participate.
> - **Space and thread = Direction A «Открытый вопрос».** One strong learner question with its
>   current answer or reply context as the dominant content object.
> - **Direction C is NOT used.** Its 20-module axis is rejected as the Community Home structure.
>   Progression may inform relevance and access, and Community must not look like analytics or a
>   second Path.
> - **Binding constraint on the open plate:** it must carry enough real discussion preview and
>   context to feel alive even with sparse PREPROD data. No generic channel list, no card grid, no
>   Discord/Reddit composition, no empty hero.
>
> React implementation proceeds on exactly this. The original three briefs are kept below as
> written.

Why this gate ran at all, given that Support, Notifications and Profile shipped in the previous
phase without one: those are narrow surfaces reading an existing owner through a proxy, and they
inherited a composition that already existed. Community is a new screen FAMILY with its own spatial
question — three routes, a signature object of its own, and no precedent in the app. That is the
case `ata-art-direction-gate` names, and `DESIGN_QUALITY_CONSTITUTION` §6 and §12 are marked
immutable. Everything that does not depend on this decision is already built: the data model,
migration 53 (rehearsed), the access authority, the seven learner routes, the moderation permission
and the CRM moderation surface.

**What is already fixed and is NOT being reopened:** the deep navy field, the two ink levels, the
single controlled cyan signal, restrained surfaces, no card wall, no crypto neon, RU labels and the
canonical nav order. Home's Action Field and Path's Spine remain as they are — Community extends
the DNA, it does not restart the direction.

**The product, in one sentence:** a place where a learner on the ATA path can ask, answer and
reflect *alongside people at a known point on the same path*.

**The data the composition must carry, and it is thin on purpose:** five spaces, four of them locked
for every learner in PREPROD today; discussions with a title, an author, a module number and a reply
count; flat replies; a locked-space reason expressed as a module. There are no reactions, no scores,
no member counts and no trending. A direction that needs those to look good is the wrong direction.

---

# Direction A — «Открытый вопрос» (The Open Question)

1. **Product thesis.** ATA turns a learner's confusion into a question someone at the same point on
   the path has already answered.
2. **Concrete user moment.** Артём, level 18, mid-module 4, stuck on where to place a stop. He opens
   Community not to browse rooms but to find out whether this has been asked.
3. **Visual thesis.** The screen's dominant object is **one question and its answer**, at reading
   size. Community is a page of resolved thinking, not a directory of rooms.
4. **Stable visual DNA used** (manifest §A). Deep navy field with layered depth; low-density
   cinematic composition; fine metadata around a dominant object.
5. **Provisional idea tested** (manifest §B). *Fine market metadata as annotation* — the module
   number, the space and the time hang off the question as thin coordinates, exactly as the price
   nodes annotate the artifact in frames 02/03.
6. **Signature object.** **The answer block** — a question in display type with its first answer
   set immediately beneath it in a lighter material, joined by a short cyan tick. Its product
   function: it is the unit a learner came for, and it renders identically on Home, in a space and
   at the top of a thread, so the product has one atom.
7. **Spatial composition.** One wide reading column, left-weighted, ~640px measure. The current
   question occupies the first viewport alone. Beneath it, a quiet stack of further questions at
   half weight. Spaces are a thin horizontal row of text filters ABOVE the column — never plates,
   never a sidebar.
8. **Typography strategy.** Display for the question (Manrope, 28–32px, tight). Body for the answer
   (Inter, 16–17px, 1.6). Utility for coordinates (JetBrains Mono, 12px, tracked) — module, space,
   time. The question is the largest thing on the screen; the space name is among the smallest.
9. **Materials strategy.** Three surfaces only: the field (navy), the raised answer (one step
   lighter, no border), and a hairline for separation. No card has a border AND a shadow AND a
   radius. Locked spaces are a text state in the filter row, not a plate.
10. **Navigation strategy.** Canonical labels and order unchanged; `community` joins the built
    routes. Within Community: filter row → column → thread. Back is always to the column.
11. **Progression strategy.** The module number is a coordinate on every question, in mono, beside
    the author. Your own module is the one filter pre-selected. Progression is context, never rank.
12. **Alex Curie strategy.** Absent from Community. A mentor appears only as a role label on a real
    reply they wrote — the mentor is a participant here, not a host, and inventing a host would be
    inventing a person.
13. **Motion strategy.** Functional only: the composer expands in place (150ms), a submitted reply
    settles into position (200ms). No entrance animation on a list of questions.
14. **Mobile transformation.** The filter row becomes a single-select chip line that scrolls
    horizontally within its own track; the column becomes the whole screen; the composer docks to
    the bottom above the nav. Not a stacked desktop — the desktop's two-tier hierarchy collapses to
    one because on mobile the question IS the screen.
15. **ASCII wireframe.**

```
DESKTOP 1440
┌──────────────────────────────────────────────────────────────────────┐
│ [nav]  Сообщество                                                    │
│                                                                      │
│   МОЙ МОДУЛЬ 4 · Старт и вопросы · Разбор графиков · +3 закрыто      │  ← text filters
│   ────────────────────────────────────────────────────────────────  │
│                                                                      │
│   Где ставить стоп, если структура                                   │  ← 30px display
│   сломалась внутри дня?                                              │
│   ─ Артём · МОДУЛЬ 4 · 2 ч назад                                     │  ← 12px mono
│                                                                      │
│    │ Я держу стоп за последним экстремумом, который                  │  ← raised surface
│    │ структуру и создал. Если он сломан — сделки нет.                │
│    │ ─ Наставник · 1 ч назад                          ещё 4 ответа → │
│                                                                      │
│   ────────────────────────────────────────────────────────────────  │
│   Как понять, что я переторговываю?          Марина · МОДУЛЬ 7 · 6   │  ← half weight
│   Дневник: что писать в графе «урок»?        Илья  · МОДУЛЬ 8  · 2   │
│                                                                      │
│                                        [ Задать вопрос ]             │
└──────────────────────────────────────────────────────────────────────┘

MOBILE 390
┌──────────────────────┐
│ Сообщество           │
│ ‹ МОЙ МОДУЛЬ 4 · Ст… │ ← one scrolling track
│──────────────────────│
│ Где ставить стоп,    │
│ если структура       │
│ сломалась внутри дня?│
│ Артём · МОДУЛЬ 4     │
│ ┌──────────────────┐ │
│ │ Я держу стоп за  │ │
│ │ последним экстр… │ │
│ │ Наставник        │ │
│ └──────────────────┘ │
│ ещё 4 ответа →       │
│──────────────────────│
│ Как понять, что я …  │
│ Дневник: что писать… │
│ [nav]      [Задать]  │
└──────────────────────┘
```

16. **How it differs from D1A.** `product-portal-desktop.png` was a grid of rounded node tiles;
    this has no tile and no grid. `market-atlas-desktop.png` led with KPI plates; the first
    viewport here contains no number except a reply count in mono.
17. **Why it cannot be renamed to another SaaS.** A generic forum leads with rooms and counts. This
    leads with one question at display size and the answer already visible, annotated by curriculum
    coordinates. Remove the module coordinate and it stops working, which is the ATA-specific test.
18. **References used.** 02 (metadata annotating a dominant object) and 03 (one dominant object,
    single signal point — here the cyan tick joining question to answer).
19. **Landing-only decisions NOT transferred** (manifest §C). No blur-heavy legibility, no
    low-contrast body, no decorative prices, no oversized empty right zone, no floating tracked
    labels as decor.

**Weakness, stated plainly:** with four of five spaces locked in PREPROD and few questions, the
first viewport can look sparse. It is honest, but it is the direction most exposed to an empty
database.

---

# Direction B — «Порог» (The Threshold)

1. **Product thesis.** ATA opens rooms as you earn them, and Community makes the next room visible
   before you can enter it.
2. **Concrete user moment.** Марина, level 3, has just finished her first lessons. She opens
   Community and needs to understand in three seconds where she may speak, where she may only read,
   and what opens next.
3. **Visual thesis.** Five **plates in a vertical column, whose MATERIAL carries their state** —
   lit and open, cold and readable, unlit and closed. The screen is a threshold you are standing
   at, and it is legible without reading a word.
4. **Stable visual DNA used** (§A). Monumental object; controlled luminous line; material-carried
   state — the same logic Home's Action Field already uses for lit / cold / unlit.
5. **Provisional idea tested** (§B). *Route becomes structure* — a single cyan line runs down the
   left edge, bright through the plates you hold and dimming at the first one you do not.
6. **Signature object.** **The threshold plate** — a full-width band carrying a space's name, its
   purpose in one line, and its state in its surface. Product function: it is simultaneously the
   entrance and the honest statement of what is not yet yours.
7. **Spatial composition.** A vertical stack of five bands filling the first viewport, unequal by
   state: the current space is tall and detailed (three live discussions inside it), the readable
   one is medium, the closed ones compress to a single line each carrying the module that opens
   them. No sidebar, no grid.
8. **Typography strategy.** Space title in display 22px; purpose in body 15px at reduced ink; the
   unlock requirement in mono 12px. Inside the open plate, discussion titles at 17px — deliberately
   larger than the space names below, so content outranks architecture.
9. **Materials strategy.** Exactly three plate materials — open (raised, faint inner light along the
   cyan edge), readable (flat, no light, full ink text), closed (recessed, reduced ink, no edge).
   The difference is the SURFACE, never a badge on identical grey.
10. **Navigation strategy.** Canonical labels and order unchanged. The plate is the navigation: click
    an open plate to enter its space. A closed plate is not a link and does not pretend to be.
11. **Progression strategy.** The cyan edge line is the progression instrument — continuous through
    what you hold, broken at what you do not. Each closed plate states «Откроется после завершения
    модуля N» from the server's own reason.
12. **Alex Curie strategy.** Absent, as in A.
13. **Motion strategy.** Milestone only: when a space opens for the first time, its plate raises and
    the cyan edge extends through it once (~2s, skippable). Nothing moves on an ordinary visit.
14. **Mobile transformation.** The plates become the whole scroll, and the open plate's three
    discussions become the first screen — a learner on mobile lands *inside* their space rather
    than above it. The closed plates fall below the fold as one compressed group. Genuinely
    different information order, not a narrower desktop.
15. **ASCII wireframe.**

```
DESKTOP 1440
┌──────────────────────────────────────────────────────────────────────┐
│ [nav]  Сообщество                          вы на модуле 4            │
│ ╻                                                                    │
│ ┃ ┌────────────────────────────────────────────────────────────────┐ │
│ ┃ │ СТАРТ И ВОПРОСЫ                                    открыто     │ │ ← raised, lit edge
│ ┃ │ Вопросы первых модулей: с чего начать, что непонятно.          │ │
│ ┃ │                                                                │ │
│ ┃ │   Где ставить стоп, если структура сломалась?   Артём · 6     │ │ ← 17px
│ ┃ │   Как понять, что я переторговываю?             Марина · 2    │ │
│ ┃ │   Дневник: что писать в графе «урок»?           Илья · 0      │ │
│ ┃ │                                          [ Задать вопрос ]     │ │
│ ┃ └────────────────────────────────────────────────────────────────┘ │
│ ┃ ┌────────────────────────────────────────────────────────────────┐ │
│ ╹ │ РАЗБОР ГРАФИКОВ            Откроется после завершения модуля 4 │ │ ← flat / recessed
│   └────────────────────────────────────────────────────────────────┘ │
│   ─ ДИСЦИПЛИНА И ДНЕВНИК       после модуля 7                        │ ← compressed
│   ─ СТРАТЕГИИ                  после модуля 9                        │
│   ─ ПРОДВИНУТЫЙ КРУГ           после модуля 17                       │
└──────────────────────────────────────────────────────────────────────┘

MOBILE 390
┌──────────────────────┐
│ Сообщество           │
│ ┃ СТАРТ И ВОПРОСЫ    │
│ ┃ открыто            │
│ ┃                    │
│ ┃ Где ставить стоп,  │
│ ┃ если структура…    │
│ ┃ Артём · 6          │
│ ┃                    │
│ ┃ Как понять, что я  │
│ ┃ переторговываю?    │
│ ┃ Марина · 2         │
│ ┃ [ Задать вопрос ]  │
│──────────────────────│
│ ЕЩЁ 4 ПРОСТРАНСТВА ▾ │ ← closed group, one line
│ [nav]                │
└──────────────────────┘
```

16. **How it differs from D1A.** `product-portal` used equal rounded tiles; these bands are
    deliberately UNEQUAL and differ by material, not by label. No block is bordered "because it is a
    block".
17. **Why it cannot be renamed to another SaaS.** Discord and Telegram show every channel at equal
    weight and grey out the ones you lack. Here the closed rooms are compressed to near-nothing and
    say which MODULE opens them — the geometry only makes sense against a 20-module curriculum.
18. **References used.** 04 (the vertical spine of numbered stages as load-bearing structure) and 03
    (material-carried state on a monumental object).
19. **Landing-only NOT transferred.** No blur, no decorative prices, no perspective grid behind
    text, no oversized empty zones, no tiny tracked decorative labels.

**Weakness, stated plainly:** it is the direction closest to a channel list, and if the plates are
executed carelessly it becomes the "Discord but navy" the anti-generic review rejects. Its defence
is that the plates are unequal, material-stated, and lead with content inside the open one.

---

# Direction C — «Кто рядом» (Who Is Alongside)

1. **Product thesis.** ATA is a path many people are walking at different points, and Community is
   where you see who is just ahead of you and what they are working through.
2. **Concrete user moment.** Артём, level 18, has just failed a checkpoint twice. What he needs is
   not a room — it is evidence that people two modules ahead had the same problem.
3. **Visual thesis.** A **horizontal axis of the twenty modules** runs across the screen with your
   own position marked, and the discussions hang from the positions they came from. The composition
   answers "who is alongside me" before it answers "where do I post".
4. **Stable visual DNA used** (§A). The luminous line as load-bearing structure; the single signal
   point marking a current position; fine coordinate metadata.
5. **Provisional idea tested** (§B). *Transition from chaos to system* read as a POPULATED path —
   the same ascending line, but carrying other people's questions as nodes rather than being empty.
6. **Signature object.** **The cohort axis** — a thin horizontal progression rail, 1→20, with your
   position as a bright cyan point and question-nodes clustered above it at the modules they were
   asked from. Product function: it is a discovery instrument. Click a module region, get its
   questions.
7. **Spatial composition.** Upper third: the axis, full width, low and quiet. Lower two thirds: the
   questions for the currently selected region, in a reading column. Selection defaults to your own
   module ± 2. No sidebar, no grid, no plates.
8. **Typography strategy.** Module numbers on the axis in mono 11px. Question titles 18px body.
   The axis is visually the QUIETEST element despite being structurally the most important — it is
   an instrument, not a headline.
9. **Materials strategy.** The axis is a hairline with node ticks; the reading column is bare field
   with hairline separators. Exactly one raised surface exists on the page: the composer. Fewer
   materials than either other direction.
10. **Navigation strategy.** Canonical labels and order unchanged. The axis is a control: dragging
    or clicking moves the region. Spaces still exist as the write destinations and appear as a small
    label on each question; access rules are unchanged, and a region containing only locked spaces
    says so.
11. **Progression strategy.** Your position is the one bright point on the axis. Everything else is
    relative to it. Locked regions render as a dimmed rail segment with the module that opens them.
12. **Alex Curie strategy.** Absent, as in A and B.
13. **Motion strategy.** Functional: moving the region cross-fades the column (120ms). The axis
    itself never animates on load.
14. **Mobile transformation.** The axis becomes a compact horizontal strip pinned under the header
    with your position centred and swipeable; the column is the screen. The desktop's spatial
    two-thirds relationship becomes a pinned-instrument + content relationship — a genuine rethink.
15. **ASCII wireframe.**

```
DESKTOP 1440
┌──────────────────────────────────────────────────────────────────────┐
│ [nav]  Сообщество                                                    │
│                                                                      │
│   1    3    5    7    9   11   13   15   17   19                     │
│   ·    ·    ○    ·    ○    ●    ○    ·    ·    ·   ← nodes = вопросы │
│   ────────────────────────────────────╌╌╌╌╌╌╌╌╌╌╌╌  ← dimmed = закрыто│
│                            ▲ вы                                      │
│                                                                      │
│   МОДУЛИ 3–5 · 7 обсуждений                                          │
│   ────────────────────────────────────────────────────────────────  │
│   Где ставить стоп, если структура сломалась?                        │
│   Артём · модуль 4 · Старт и вопросы · 6 ответов                     │
│                                                                      │
│   Как понять, что я переторговываю?                                  │
│   Марина · модуль 5 · Старт и вопросы · 2 ответа                     │
│                                                                      │
│   Дневник: что писать в графе «урок»?                                │
│   Илья · модуль 3 · Старт и вопросы · нет ответов                    │
│                                        [ Задать вопрос ]             │
└──────────────────────────────────────────────────────────────────────┘

MOBILE 390
┌──────────────────────┐
│ Сообщество           │
│ ╌╌·──○──●──○──╌╌╌╌   │ ← pinned, swipeable
│      3  4▲ 5         │
│──────────────────────│
│ МОДУЛИ 3–5 · 7       │
│                      │
│ Где ставить стоп,    │
│ если структура…      │
│ Артём · м.4 · 6      │
│                      │
│ Как понять, что я    │
│ переторговываю?      │
│ Марина · м.5 · 2     │
│ [nav]      [Задать]  │
└──────────────────────┘
```

16. **How it differs from D1A.** None of the three rejected D1A screens had a functional instrument;
    `market-atlas`'s "map" was a dashboard row on a dotted line. This axis is not decoration — it is
    the only way to change what the page shows.
17. **Why it cannot be renamed to another SaaS.** The axis is the 100-level/20-module curriculum.
    There is no generic product whose primary control is "how far along the programme was this
    asked", and a forum without a curriculum cannot borrow it.
18. **References used.** 04 (numbered progression as the load-bearing structure, here rotated to
    horizontal) and 01 (the ascending route with a signal point marking position).
19. **Landing-only NOT transferred.** No decorative price labels, no blur, no low-contrast body, no
    empty hero zone; the axis carries real records only and renders nothing where there is no data.

**Weakness, stated plainly:** it is the most ambitious and the most exposed to an empty database —
an axis with two nodes on it looks like a broken chart. It also risks reading as analytics, which
the constitution rejects, and needs the axis kept quiet and typographic rather than chart-like.

---

## What is identical in all three, and therefore not part of the choice

Thread and reply composition (title, author with module, body, flat replies, tombstones for removed
content), the create flow, the report dialog with four reasons, the access-denied copy naming the
module, empty/loading/error states, notification linkage, the 390px mobile contract, and every
accessibility requirement. Those are specified by the product contract and do not vary by direction.

## The decision required

Pick **A**, **B**, or **C** — or name specific elements from named directions to merge (for example
"B's threshold plates for Home, A's answer block as the discussion atom"). React implementation
begins immediately on the answer and nothing before it.
