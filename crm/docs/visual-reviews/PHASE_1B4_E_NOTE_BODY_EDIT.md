# Visual review — Phase 1B4-E · User 360 note body edit

> Scope: inline editing of the body of an employee-authored note in the User 360
> «Заметки» section. One vertical slice — provider mutation `updateNoteBody`, a
> provider-owned `canEditBody` capability, and an inline editor. No fixture edits,
> no delete, no visibility changes. Decisions D-82…D-85.

Screenshots live in `screenshots/phase-1b4-e-note-body-edit/{first-pass,final}/`.
Previous phases' screenshots were **not** touched.

## Frames (final)

| # | File | What it shows |
|---|------|---------------|
| 1 | `note-edit-idle-desktop-1440x900.png` | An authored note with its «Изменить» (pencil) and pin controls; the fixture note below has only a pin. |
| 2 | `note-edit-editing-desktop-1440x900.png` | Inline editor: labelled textarea «Новый текст заметки», character count, «Отменить»/«Сохранить». The row's pin control is hidden while editing. |
| 3 | `note-edit-validation-desktop-1440x900.png` | Emptied body → Save disabled (no round-trip). |
| 4 | `note-edit-pending-desktop-1440x900.png` | In-flight write: Save reads «Сохраняем…», disabled, `aria-busy`. |
| 5 | `note-edit-success-desktop-1440x900.png` | After save: the new body, a calm «Заметка обновлена» status line. |
| 6 | `note-edit-conflict-desktop-1440x900.png` | A concurrent writer won: editor closed, the **actual stored** text shown, calm «Заметка уже изменена. Показан актуальный текст.» |
| 7 | `note-edit-forbidden-desktop-1440x900.png` | `read_only`: the note is visible, but there is no edit control at all (absent, not disabled). |
| 8 | `note-edit-mobile-390x844.png` | Editor fits inside the row; Save/Cancel are ≥44px; no horizontal overflow. |
| 9 | `note-edit-mobile-320x720.png` | Narrowest supported width still fits the editor. |
| 10 | `note-edit-zoom-200-720x450.png` | Real 200% reflow (720×450 viewport, not CSS zoom): single column, editor usable, no sideways scroll. |

## Review method

First-pass frames were captured with `PHASE_1B4E_PASS=first` and personally
inspected. Final frames were captured on the clean pass. Every frame was checked
for: control placement, the pencil appearing **only** on own authored notes, the
editor replacing (not duplicating) the body, calm feedback tone, 44px targets, and
zero horizontal overflow.

## Findings

### Critical
None.

### Major
None.

### Minor (accepted)

- **M-1 — the composer's «Заметка добавлена» line lingers above an open editor.**
  When a test adds a note and then immediately edits it, the composer's own success
  line is still on screen above the editor. This is the composer's existing,
  correct behaviour (it confirms the just-added note) and is unrelated to editing;
  it does not appear in a normal edit flow that starts from an already-listed note.
  Accepted — no change.
- **M-2 — Save is disabled (greyed) when the editor opens.** The editor prefills
  with the current body, which is «unchanged», so Save starts disabled until the
  text actually differs. This is intended (D-85): it states «nothing to save» without
  a round-trip. Accepted.

## Accessibility notes

- Textarea has a visible `<label htmlFor>` («Новый текст заметки», distinct from the
  composer's «Текст заметки»), an `aria-describedby` character count, and
  `aria-invalid` + `role="alert"` on an in-place error.
- Success is `role="status" aria-live="polite"`; the conflict line is announced too.
- «Изменить», «Сохранить», «Отменить» are real buttons with full-instruction names;
  pending is announced in words, never colour alone.
- Escape cancels; focus returns to the note's «Изменить» control after save, cancel
  and conflict — found by stable `note.id`, not DOM position.
- Touch targets are ≥44px on mobile; the layout reflows at 720×450 with no overflow.

## Console / hydration

The create→edit→reload and 200%-zoom E2E tests assert **zero** console errors and
**zero** hydration warnings across the flow.
