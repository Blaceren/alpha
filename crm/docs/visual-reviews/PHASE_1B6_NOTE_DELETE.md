# Phase 1B6 — User 360 Note Delete · Visual Review

Two-pass visual QA of the note-deletion surface on `/users/[id]` → «Заметки».
Screenshots are produced by `tests-e2e/note-delete.spec.ts` (real Chromium):

- `PHASE_1B6_PASS=first npm run test:e2e -- note-delete` → `screenshots/phase-1b6-note-delete/first-pass/`
- `npm run test:e2e -- note-delete` → `screenshots/phase-1b6-note-delete/final/`

The suite only writes under `screenshots/phase-1b6-note-delete/`; no historical PNG
from an earlier phase is touched.

## Final set (1440×900 unless noted)

| File | What it shows |
| --- | --- |
| `note-delete-control-desktop-1440x900.png` | Idle authored rows carrying four calm, neutral controls (pencil / shield / pin / trash); the fixture note carries only the pin. |
| `note-delete-confirm-desktop-1440x900.png` | Inline confirm open on one row: heading «Удалить заметку?», the permanence + Audit note, «Отменить» + red «Удалить». The note body stays visible. |
| `note-delete-success-desktop-1440x900.png` | After delete: the row is gone, the count dropped, a calm green «Заметка удалена» line, focus on the composer. |
| `note-delete-conflict-desktop-1440x900.png` | A stale-precondition conflict: the confirm closed, the note is still shown, «Заметка уже изменена. Показаны актуальные данные.» |
| `note-delete-storage-error-desktop-1440x900.png` | A storage failure: the confirm stays open with the safe «Локальное сохранение недоступно…», the note intact, retriable under the same key. |
| `note-delete-forbidden-desktop-1440x900.png` | `read_only` sees the note but gets no delete control. |
| `audit-note-deleted-desktop-1440x900.png` | Global `/audit` renders «… удалил заметку у …» — a neutral fact, no body, no id. |
| `note-delete-mobile-390x844.png` | Confirm on mobile — fits, no overflow. |
| `note-delete-mobile-320x720.png` | Narrowest supported width — confirm fits, no clipping, buttons intact. |
| `note-delete-tablet-1024x768.png` | Confirm inside the column at tablet width. |
| `note-delete-zoom-200-720x450.png` | Real 200% reflow (720×450): one column, no horizontal overflow, confirm usable through to success. |

## First-pass findings

Every first-pass screenshot was opened and inspected.

- **critical:** none.
- **major:** none.
- **minor (accepted, not fixed):**
  1. On the success shot the composer's own «Заметка добавлена» line (from the
     earlier add in the same flow) sits just above the delete section's «Заметка
     удалена». Two truthful, distinct outcome lines for two distinct actions; they do
     not overlap or mislead, and each retires on the next interaction. Left as is.
  2. An authored row carries four 44×44 controls. At 320 px they wrap onto a second
     line via `flex-wrap` rather than overflowing (E2E asserts `scrollWidth ==
     clientWidth`). Acceptable; no icon is clipped and horizontal overflow is 0.

No critical/major issues were found, so first-pass and final are visually identical.

## Checklist (verified against the final set)

- Delete is **not** a permanent red dominance — the idle trash glyph is the same calm
  `text-muted` as the pencil/shield/pin; the destructive tone (red commit button +
  danger-tinted panel) appears **only** in the confirm state.
- The confirm is unambiguously destructive: danger-tinted border/background and a red
  «Удалить», distinct from the neutral «Отменить».
- The four controls never read alike — pencil (edit), shield (visibility), pin, trash
  (delete) — and the confirm's buttons do not collide with any of them.
- Mobile is not overloaded: the confirm replaces the controls, so a row is never
  five icons wide; 320 px shows no clipping.
- 720×450 is a genuine responsive reflow (single column), not a CSS-zoom fake.
- Horizontal overflow is 0 at 1440 / 1024 / 390 / 320 / 720 (asserted in E2E).
- Historical screenshots from earlier phases are byte-unchanged.
