# Visual review — Phase 1B5-C · User 360 note visibility change

> Scope: a note's author (with `edit_user_notes`) changes the visibility of their own
> overlay note between `team` and `private`, inline in the User 360 «Заметки»
> section. One vertical slice — provider mutation `setNoteVisibility`, a
> provider-owned `canChangeVisibility` capability, a fifth audit-union member
> `note_visibility_changed`, and an inline visibility editor. No `role_restricted`
> creation, no delete, no User 360 audit-preview. Decisions D-91…D-95.

Screenshots live in `screenshots/phase-1b5-c-note-visibility/{first-pass,final}/`.
Previous phases' screenshots were **not** touched (restored to HEAD before commit).

## Frames (final)

| # | File | What it shows |
|---|------|---------------|
| 1 | `note-visibility-team-desktop-1440x900.png` | An authored `team` note with its edit (pencil), visibility (shield) and pin controls. |
| 2 | `note-visibility-editing-desktop-1440x900.png` | Inline editor: labelled native select «Доступ к заметке» (Командная/Приватная), «Отменить»/«Сохранить». Row's other controls hidden while editing. |
| 3 | `note-visibility-private-success-desktop-1440x900.png` | After → private: calm «Приватная заметка» badge, «Доступ к заметке обновлён» status. |
| 4 | `note-visibility-team-success-desktop-1440x900.png` | After private → team: the «Командная заметка» badge is back. |
| 5 | `note-visibility-conflict-desktop-1440x900.png` | A concurrent writer won: editor closed, the actually-stored state shown, calm «Доступ к заметке уже изменён. Показаны актуальные данные.» |
| 6 | `note-visibility-storage-error-desktop-1440x900.png` | Storage write failed: editor stays open, draft «Приватная» preserved, safe «Локальное сохранение недоступно…», no diagnostics. |
| 7 | `note-visibility-forbidden-desktop-1440x900.png` | `read_only` (same actorId): the author's own `private` note is still visible with its body, but there is NO visibility control — identity-based, not role-based. |
| 8 | `audit-note-visibility-desktop-1440x900.png` | Global `/audit`: «Demo Operator изменил доступ к заметке у Nina Chmiel» — fact only, no team/private, no body, no ids. |
| 9 | `note-visibility-mobile-390x844.png` | Editor fits inside the row; the control is ≥44px; no horizontal overflow. |
| 10 | `note-visibility-mobile-320x720.png` | Narrowest supported width still fits the editor. |
| 11 | `note-visibility-tablet-1024x768.png` | The editor stays inside the main column. |
| 12 | `note-visibility-zoom-200-720x450.png` | Real 200% reflow (720×450 viewport, not CSS zoom): single column, editor usable, no sideways scroll. |

## Review method

First-pass frames were captured with `PHASE_1B5C_PASS=first` and **personally
inspected** (each PNG opened). Final frames were captured on the clean pass. Every
frame was checked for: control placement (three distinct glyphs — pencil, shield,
pin — never alike), the shield appearing only on own authored notes, one editor per
row, calm feedback tone, the `private` badge in a neutral (never red) tone,
visibility expressed in words, 44px targets, and zero horizontal overflow.

## Findings

### Critical
None.

### Major
None.

### Minor

- **M-1 (fixed) — zoom-200 frame caught a transient badge.** On the first pass the
  200% shot was taken the instant the «Доступ к заметке обновлён» line appeared, a
  moment before the re-read refreshed the badge, so it still read «Командная». The
  data was correct (a reload showed `private`); only the screenshot was mid-flight.
  Fixed for the final pass: the spec waits for the settled «Приватная заметка» badge
  before shooting.

### Minor (accepted)

- **M-2 — Save is disabled (greyed) when the editor opens.** The select prefills the
  note's current visibility, so «Сохранить» is disabled until a different value is
  chosen. Intentional (mirrors the body editor's unchanged-guard): a no-op save is a
  round-trip the provider would reject anyway. Accepted — no change.
