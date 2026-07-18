# Visual review — Phase 1B5-B · Global Audit Workspace

> Scope: the global Audit Workspace on `/audit`, replacing the SectionPlaceholder
> with a read-only, browser-local ledger of the mutation-overlay audit records. One
> new provider read (`getAuditRecords`), a provider-owned safe `AuditRecordView`, a
> canonical sorter/projector, and a ledger UI with restricted/empty/loading/error
> states and pagination. No new mutations, no filters, no User 360 audit-preview.
> Decisions D-86…D-90.

Screenshots live in `screenshots/phase-1b5-b-audit-workspace/{first-pass,final}/`.
Previous phases' screenshots were **not** touched (restored to HEAD before commit).

## Frames (final)

| # | File | What it shows |
|---|------|---------------|
| 1 | `audit-populated-desktop-1440x900.png` | All four actions, newest-first ledger, «Всего записей», the calm browser-local demo caption. Names resolved (Demo Operator / Nina Chmiel / Denis Frankowski); pin vs unpin as **words**; owner before→after line. |
| 2 | `audit-empty-desktop-1440x900.png` | Admin, empty overlay → «Действий ещё не было» + explanation. |
| 3 | `audit-restricted-desktop-1440x900.png` | `support` (section-visible, no data gate) → «Глобальный журнал недоступен». No subtitle, no demo caption, no records. |
| 4 | `audit-storage-error-desktop-1440x900.png` | Error mode → «Не удалось загрузить журнал» + «Повторить». No raw diagnostics. |
| 5 | `audit-mobile-390x844.png` | Single column; action + target lead, time on the secondary line; owner transition wraps cleanly. |
| 6 | `audit-mobile-320x720.png` | Narrowest supported width still fits; no horizontal scroll. |
| 7 | `audit-tablet-1024x768.png` | Sidebar present, ledger comfortable, no overflow. |
| 8 | `audit-zoom-200-720x450.png` | Real 200% reflow (720×450 viewport, not CSS zoom): sidebar collapses, single column, ledger readable. |
| 9 | `audit-pagination-desktop-1440x900.png` | 25 records → 20 per page, prev/next controls scrolled into frame. |

## Review method

First-pass frames were captured with `PHASE_1B5B_PASS=first` and **personally
inspected** (each PNG opened). Final frames were captured on the clean pass. Every
frame was checked against the phase's explicit visual checklist below.

## Checklist

- **Not a generic dashboard / no KPI cards** — ✅ one dense chronological ledger, no tiles, no charts.
- **No heavy card per event** — ✅ single bordered list, divided rows; owner-change rows carry one extra detail line only.
- **Chronology reads** — ✅ newest-first, relative time in a fixed left column (secondary line on mobile), absolute time in the tooltip.
- **Empty ≠ restricted** — ✅ different icon (inbox vs lock), different heading, different copy; restricted shows no subtitle/demo caption and no records.
- **DEMO warning does not dominate** — ✅ the page reuses the topbar DEMO MODE badge and adds only a small muted «Локальный demo-журнал…» caption; no second big badge.
- **No raw IDs** — ✅ E2E asserts the visible text matches none of `emp_*`, `note_mock_*`, `audit_mock_*`, `usr_mock_*`; actor/owner via `ownerLabel`, target via dataset display name.
- **Owner before→after does not break mobile** — ✅ 320px and 390px wrap the transition line without horizontal scroll.
- **Pin vs unpin differ in words** — ✅ «закрепил заметку» / «открепил заметку», never colour-only.
- **200% is a real reflow** — ✅ 720×450 viewport, sidebar collapses to the hamburger, single column.
- **Overflow = 0** — ✅ asserted on desktop, tablet, both mobiles and the reflow.
- **Historical screenshots unchanged** — ✅ only the new phase folder is added; all other PNGs restored to the source HEAD before commit.

## Findings

### Critical
None.

### Major
None.

### Minor

- **M-1 (fixed) — pagination screenshot did not show the control.** On the first
  pass the 20 rows pushed the prev/next control below the 900px fold, so
  `audit-pagination-desktop-1440x900.png` framed only the rows. Fixed for the final
  pass: the spec scrolls the «Следующая страница» control into view before the shot.

### Minor (accepted)

- **M-2 — relative time only, no absolute time inline.** The absolute timestamp is
  in the `<time>` element's tooltip (the pattern the notes list already uses), not
  printed on the row. Accepted — it keeps the ledger dense and matches the existing
  convention; no countdown is shown (per scope).
