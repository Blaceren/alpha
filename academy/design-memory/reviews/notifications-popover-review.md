# The bell's window, and the Account tab without its support card (DD-349)

Owner, 2026-10-06: «уведомления открываются отдельным экраном, сделай небольшое окно с уведомлениями
которое открывается по нажатию»; another product's dropdown as the example — «нам разумеется нужно в
наших цветах и языке»; and on Profile → Аккаунт «убрать» the «ПОДДЕРЖКА» card beside the rows.

Answers (2026-10-06): the window's buttons «как в примере, с «Очистить всё»» (I recommended
«Прочитать все» + «Все уведомления» without a clear; clearing needed a Backend change); release by
readiness. Design: delegated.

## Directions weighed

| | A «Окно под колоколом» (chosen) | B «Шторка справа» | C «Строка в шапке» |
|---|---|---|---|
| Form | a window hanging from the bell, right edges aligned; edge to edge under the top bar on a phone | a full-height drawer from the right | one notification at a time in a strip under the bar |
| Fits | the example; a handful of events | a long inbox | one event |
| Why not | — | heavy for 3–5 events, covers the page | no room for two actions or a list |

## What changed

- **Backend** (`0b3ef88`): migration 62 `Notification.clearedAt` (+ index), `src/lib/notification-list.ts`,
  `PATCH /api/notifications/clear-all` (read + cleared, audit log), the list and read-all see the
  learner's list only. Clearing never deletes: the rows stay for the staff's learner view and the audit.
- **Academy**: the bell is a button (`notifications-bell.tsx`, one per bar: `nt-pop-desktop` /
  `nt-pop-mobile`) opening `notifications-popover.tsx`:
  - the same register as `/notifications`, through `toRecord` — learner-facing only (the broker's
    events never), the product's own words, no amount;
  - each event: a glyph in a chip (support, path, report, star, shield, community, bell), its
    statement, its line (two at most), the time and its way in («Открыть обращение →»); new ones in
    the Signal — a faint wash and a point on the glyph;
  - «Все» → the full page; «Прочитать все»; «Очистить всё» asks once more («Очистить все
    уведомления?» · «Отмена» · «Очистить», in the rose of a loss), then empties the list;
  - opening the window reads nothing; opening one event reads it and closes the window; after
    reading or clearing everything the bell drops its mark at once;
  - a disclosure: `aria-expanded`/`aria-controls`, focus to the title on open, Escape closes and
    returns focus to the bell, a press outside closes; results said in a polite status line.
  - proxy: `clear-all` is a named operation (POST → Backend PATCH), constant path, no caller input.
- **Profile → Аккаунт**: `ProfileSupportCard` removed (component, styles, tests); the rows take the
  page's measure (720px) in one column. Support stays one press away — the «Поддержка» tab, and the
  email row's own «Написать в поддержку».

## Captures (stand: production build, synthetic learners)

`design-memory/screenshots/notifications-popover/`: `before-owner-notifications-page.webp`;
`after-bell-*` at 1440/1024/768/390/320, the confirm step and the cleared window at 1440;
`after-profile-account-1440.png`. (The owner's profile screenshot shows a real address and is not
kept in the repository.)

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | the migration runner splits files on «;», comments included — the first draft's comment broke the run | major | fixed (no «;» in comments, noted in the file) |
| 2 | backend tsc runs out of the default 2GB heap | minor | run with 6GB, as the build does |
| 3 | on a phone the window must hang from the top bar, not from the bell | major | fixed (`.mtop .ntb` static: the bar's backdrop filter is the containing block) |
| 4 | the phone bar is not positioned: page content could paint over the window | major | fixed (`.mtop:has(.ntp)` raised while open) |
| 5 | a measured «covered» link at 390/360 is an item scrolled below the list's edge | — | not a defect (the list scrolls inside the window) |

## Measured

8 sizes (1440–320): the window inside the viewport, its buttons hit at their centres, Escape closes
and returns focus, the broker's event absent, no sideways scroll; console 0 errors. The whole flow on
the stand: mark → read all (0 unread, mark gone, announced) → clear with confirm (empty, announced) →
reload (no mark) → reopen (empty); the database keeps all 6 rows, cleared and read. Tests: academy
popover/bell/proxy/shell/profile suites, backend 550 + regression `notifications-clear` 7/7 + every
regression that counts migrations (four failures predate this change).

## Anti-generic score

DNA 18/20 · structure 13/15 · meaning 15/15 · type 9/10 · signature object 8/10 (the window takes the
Decision Frame's surface and the Signal point; it is a utility, not a brand object) · progression n/a →
9/10 (the way in on each event) · mobile 9/10 · usability 10/10. **TOTAL 91/100 — PASS.**
