# Phase 1B4-D — Note Pin / Unpin — Visual review

Third CRM mutation: pinning and unpinning a note on User 360. Companion to
`PHASE_1B4_B_ADD_NOTE.md` and `PHASE_1B4_C_ASSIGN_OWNER.md`. Decisions D-75…D-82.

Screenshots: `screenshots/phase-1b4-d-note-pin/{first-pass,final}/`. Driver:
`tests-e2e/note-pin.spec.ts` (14 behavioural + screenshot cases). Set
`PHASE_1B4D_PASS=first` to write the first-pass folder.

## Method

first-pass captured first, reviewed frame by frame, findings recorded and the
critical/major ones fixed, then final captured and personally re-reviewed. Real
viewport sizes are set with `page.setViewportSize`; 200% zoom is modelled as a
genuine reflow at 720×450 (never `documentElement.style.zoom`, per 1B4-C.1).
Horizontal overflow is measured as `documentElement.scrollWidth − clientWidth` and
asserted `≤ 1` on every frame.

## first-pass findings

Reviewed all nine frames. No critical or major issues.

- **[minor, accepted]** The pin control sits at the far right of the note's meta
  row (`ml-auto`), so on a very narrow note it can land close to the timestamp.
  At 320px the meta row still lays out on one line without collision or overflow
  (`note-pin-mobile-320x720`), so no change was made.
- **[minor, accepted]** The unpinned glyph is an outline pushpin in
  `text-text-muted`; the pinned glyph is filled and tinted. The state is ALSO
  carried by the "Закреплено" badge and `aria-pressed`, so the glyph fill is
  redundant reinforcement, not the only signal — kept.
- **[minor, accepted]** The success line ("Заметка закреплена" / "Заметка
  откреплена") renders directly under the body with no divider. It is transient,
  low-emphasis `text-2xs text-success`, consistent with the composer's own
  confirmation — kept.

No critical/major findings, so nothing required a fix before final.

## Remaining minor items

The three above, all accepted. None blocks the phase; none is hidden.

## Personal review of the final frames

All nine final frames opened and inspected individually.

| Frame | Viewport | Overflow | Notes |
| --- | --- | --- | --- |
| `note-pin-default-desktop-1440x900` | 1440×900 | 0 | Unpinned note, outline glyph, no badge, control present for admin. |
| `note-pin-fixture-success-desktop-1440x900` | 1440×900 | 0 | Fixture note pinned: "Закреплено" badge, filled glyph, green "Заметка закреплена". |
| `note-pin-authored-success-desktop-1440x900` | 1440×900 | 0 | Older fixture note pinned above a newer authored note — reorder is real. |
| `note-unpin-success-desktop-1440x900` | 1440×900 | 0 | Unpinned back to newest-first order, "Заметка откреплена". |
| `note-pin-forbidden-desktop-1440x900` | 1440×900 | 0 | read_only: note visible, NO pin control (absent, not disabled). |
| `note-pin-storage-error-desktop-1440x900` | 1440×900 | 0 | Red "Локальное сохранение недоступно…"; no badge, no raw diagnostics. |
| `note-pin-mobile-390x844` | 390×844 | 0 | Control ≥44×44, text not clipped. |
| `note-pin-mobile-320x720` | 320×720 | 0 | Narrowest width: control and list both reachable. |
| `note-pin-zoom-200-720x450` | 720×450 | 0 | Real reflow — single column, sidebar collapsed, control reachable and works. |

## Focus / keyboard observations

- **Keyboard**: the pin control is a native `<button>`; Enter and Space both
  toggle it (`pin and unpin work from the keyboard`).
- **Focus across reorder**: pinning the older note moves it to the top of the
  re-read list; focus returns to that same control (now "Открепить заметку"),
  confirmed by reading `document.activeElement`'s `aria-label` after the re-read
  settles (`focus returns to the acted note's control after it reorders`). The
  control is found by note id, not DOM position, so the move does not strand focus.
- **aria-pressed** flips false→true on pin and true→false on unpin; the accessible
  name is the full instruction, never the glyph.
- **Disabled scope**: only the acted note's control is disabled while its own write
  is in flight; other notes' controls stay interactive.

## Overflow measurements

`documentElement.scrollWidth − clientWidth ≤ 1` on 1440×900, 390×844, 320×720 and
720×450. The 44×44 minimum target is asserted from the control's bounding box at
390×844 and 720×450.
