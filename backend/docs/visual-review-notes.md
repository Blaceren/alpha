# Visual Review Notes

Use one entry per issue. Keep the screenshot path exact so another reviewer can reproduce the finding quickly.

## Issue Template

- Page:
- Theme: light / dark
- Viewport: desktop / tablet / mobile
- Screenshot path: `visual-qa/screenshots/...`
- Severity: blocker / major / minor / polish
- Problem:
- Expected fix:
- Status: open / in progress / fixed / accepted

## Severity Guide

### Blocker

- Text is unreadable.
- The page has body-level horizontal scrolling.
- A required button or CTA is not visible.
- The page appears empty or failed to render.
- Mobile navigation breaks or blocks the screen.

### Major

- A table is difficult or impossible to use.
- Cards are severely misaligned or overlap.
- Dark-theme contrast makes content hard to read.
- A key workflow remains technically visible but is impractical to complete.

### Minor

- A local alignment, wrapping, or responsive issue is noticeable but does not block the workflow.
- Secondary text or controls have weak contrast.
- A component uses inconsistent spacing or sizing.

### Polish

- A card feels visually plain or unfinished.
- Spacing could be more consistent.
- A placeholder icon or temporary visual remains.

## Example

- Page: `/dashboard`
- Theme: dark
- Viewport: mobile
- Screenshot path: `visual-qa/screenshots/dark/mobile/dashboard.png`
- Severity: minor
- Problem: Secondary action labels wrap unevenly and make the action row look misaligned.
- Expected fix: Keep action labels readable with consistent control heights at the mobile viewport.
- Status: open
