# Visual Review — D4-B Tools Hub + Trading Journal

**Phase:** D4-B (production vertical slice)
**Direction:** «Structured Operational Spine» — Hub from Direction A «Operational
Ledger», Journal from Direction C «Structured Field Notebook» (DD-308).
**Method:** real Chromium (Playwright, `e2e/tools-screenshots.spec.ts`), fonts
awaited, viewport-clipped so PNG dimensions match filenames exactly (Desktop
Chrome deviceScaleFactor = 1). Synthetic reconstruction / HTML inspection was NOT
used — every image is a real browser capture.

Screenshots live in `design-memory/screenshots/d4-trading-journal/{first-pass,final}/`.

---

## Visual thesis check

- **Hub is an operational ledger, not a marketplace / card grid.** One luminous
  vertical spine threads the whole tool progression; each tool is a node marked
  by its unlock level. Current tool = the live head with one CTA; unlocked-but-
  coming-soon and locked tools are calm rows. No cards, no tiles, no KPI, no
  balance.
- **Journal keeps the spine.** Numbered nodes (01…N), new-entry node at the head,
  saved entries newest-first. Expanded entry = the triptych ПЛАН → ИСПОЛНЕНИЕ →
  УРОК, УРОК column dominant (larger, cyan key, primary text). Money result is a
  quiet margin note, never the headline; a negative value gets only a small rose
  dot, never whole-row colour.
- **Form is embedded in the flow, not an admin record form.** It hangs off the
  spine's "+" node with a cyan left edge; identity row + fieldset direction +
  triptych textareas + optional result.
- **Mobile is a real transformation.** The triptych becomes a vertical sequence
  (not a horizontal table); the spine stays readable; the bottom nav never covers
  content; 320 px shows no clipping; the 720×450 (200 % zoom) reflow drops to the
  compact layout with no horizontal overflow.

Money is never aggregated: no sum, average, win rate, %, equity curve, running
P/L, balance, or Pocket link on any surface.

---

## First-pass findings (14 screenshots, all opened personally)

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | **major** | `trading-journal-storage-error` captured a **validation** error (empty «Когда»), not the storage-error state — the date field was never filled before submit, so validation blocked the write. | Fixed: fill «Когда» in the storage-error capture so validation passes and the storage write is what fails. Final shot shows the retained draft + honest error banner + save-line error dot. |
| 2 | **major** | `trading-journal-locked` showed **Chart Markup Tool** locked, but the filename denotes the Trading Journal locked. | Fixed: capture `/tools/tool.trading_journal?scenario=early` (L2 user, L10 not reached). Final shot shows «Trading Journal · Откроется на уровне 10», no form. |
| 3 | minor | `trading-journal-create` form had an empty «Когда» (mm/dd/yyyy). | Fixed: fill the date for a complete-looking form. |
| 4 | minor | Edit form УРОК textarea clipped its 3rd line at `rows=2`. | Fixed: triptych textareas bumped to `rows=3` (create + edit + storage-error). |

All **critical** = none. All **major** (2) and **minor** (2) resolved before the
final set.

## Remaining minor notes (accepted, not blocking)

- Textareas are user-resizable; very long lesson text still scrolls inside the
  field rather than growing the card unbounded — intentional.
- The hub lists all 19 curriculum tools on one spine (dense by design — Direction
  A's stated strength and known risk); locked rows are single-line and calm.

---

## Anti-generic self-check

- **Signature object present:** the luminous spine (hub ledger + journal
  notebook). ✓
- **Not renameable to a generic SaaS:** the ПЛАН → ИСПОЛНЕНИЕ → УРОК decision
  triptych with money deliberately secondary is ATA's review methodology, not an
  inbox / CRM / task list. ✓
- **No sidebar + card grid; no identical skeletons** (hub rows ≠ journal nodes);
  **no stacked-card mobile** (real triptych→sequence transform). ✓
- **Contrast:** raised secondary/muted tokens, AA on the navy fields; state is
  always carried in words, never colour alone. ✓

---

## Final screenshot inventory (14, dimensions match filenames)

| File | Dimensions | Bytes |
|------|-----------:|------:|
| tools-hub-desktop-1440x900.png | 1440×900 | 630372 |
| tools-hub-locked-desktop-1440x900.png | 1440×900 | 591333 |
| trading-journal-empty-desktop-1440x900.png | 1440×900 | 434351 |
| trading-journal-populated-desktop-1440x900.png | 1440×900 | 491927 |
| trading-journal-create-desktop-1440x900.png | 1440×900 | 357981 |
| trading-journal-edit-desktop-1440x900.png | 1440×900 | 447946 |
| trading-journal-storage-error-desktop-1440x900.png | 1440×900 | 378214 |
| trading-journal-corrupt-storage-desktop-1440x900.png | 1440×900 | 392202 |
| trading-journal-locked-desktop-1440x900.png | 1440×900 | 349413 |
| tools-hub-mobile-390x844.png | 390×844 | 237921 |
| trading-journal-mobile-390x844.png | 390×844 | 238161 |
| trading-journal-mobile-320x720.png | 320×720 | 167914 |
| trading-journal-tablet-1024x768.png | 1024×768 | 397573 |
| trading-journal-zoom-200-720x450.png | 720×450 | 181120 |

_(Byte sizes captured at final generation; regenerating the set will change bytes
but not dimensions.)_

## Historical screenshot integrity

No screenshot outside `design-memory/screenshots/d4-trading-journal/` was created,
modified, or deleted. Prior phase screenshot directories are untouched.

---

## D4-B1 — Acceptance corrections (follow-up)

Three targeted visual-acceptance fixes on top of the accepted D4-B slice. No
domain model, storage key/version, resolver, unlock rule, manual-result boundary,
CRUD scope, route or dependency changed.

1. **Mobile Tools Hub current-tool layout (DD-312).** The active Trading Journal
   CTA no longer shares a line with the description (which had been squeezed to a
   sliver). In the compact regime (< 900px, incl. the 720px 200% reflow) the row
   is `[node | body]` and the CTA drops to its own line under the text —
   content-width, ≥44px touch target, inside the viewport, spine preserved, still
   a ledger row (not a marketing card).

2. **Bottom-nav scroll clearance (DD-313).** Page-owned bottom padding
   (`nav height + safe-area + 44px`) guarantees the last interactive control — an
   entry's «Редактировать», a form's submit/cancel, a storage-error retry — scrolls
   fully above the fixed bottom nav with a visible gap. New E2E asserts
   `control.bottom ≤ nav.top − 8` at 390/320/720; horizontal overflow stays 0.

3. **Locale-independent RU date/time (DD-311).** The native `datetime-local`
   (which Chromium rendered as US `MM/DD/YYYY, hh:mm AM/PM`) is replaced by two
   explicit fields — «Дата» `ДД.ММ.ГГГГ` and «Время» 24-hour `ЧЧ:ММ`. A pure
   adapter maps visible date+time ↔ canonical ISO `occurredAt`; impossible dates /
   out-of-range times fail closed; no AM/PM renders; the persisted schema and v1
   storage are unchanged and existing entries stay readable. Wall-clock is treated
   literally (UTC), so input and display round-trip exactly.

**Screenshots updated (7).** The six named in the correction brief — plus
`trading-journal-storage-error-desktop-1440x900.png`, because that state renders
the create form and would otherwise still show the old US `AM/PM` datetime field
(directly contradicting fix 3). Dimensions unchanged and correct:

| File | Dimensions |
|------|-----------:|
| tools-hub-mobile-390x844.png | 390×844 |
| trading-journal-create-desktop-1440x900.png | 1440×900 |
| trading-journal-edit-desktop-1440x900.png | 1440×900 |
| trading-journal-storage-error-desktop-1440x900.png | 1440×900 |
| trading-journal-mobile-390x844.png | 390×844 |
| trading-journal-mobile-320x720.png | 320×720 |
| trading-journal-zoom-200-720x450.png | 720×450 |

The other **7** D4-B final PNGs are byte-identical (verified by md5 before/after):
tools-hub-desktop, tools-hub-locked-desktop, trading-journal-empty-desktop,
trading-journal-populated-desktop, trading-journal-corrupt-storage-desktop,
trading-journal-locked-desktop, trading-journal-tablet. No prior-phase screenshot
was touched.

**Personal review (real Chromium).** Verified: mobile Hub text at normal width
with the CTA below it and the spine intact; date shown `ДД.ММ.ГГГГ`, time 24-hour,
no AM/PM in create/edit/storage-error; Edit and all trailing controls clear the
bottom nav after scrolling; 320px unclipped; horizontal overflow 0 everywhere.
