---
name: ata-visual-qa-loop
description: >
  The mandatory screenshot QA process for any Alfa Trade Academy UI. Use this
  whenever ATA UI has been built or changed and needs to be verified, or when the
  user asks to screenshot, test, QA, or "check it works" on an ATA screen. It runs
  a real browser (Playwright, per the webapp-testing skill), captures exact
  viewports after fonts/assets load, compares against the visual thesis and the
  prelanding references, checks for transferred landing-only defects, finds ≥5
  issues, fixes critical/major, re-captures, compares before/after, checks the
  console, and only then runs anti-generic scoring and writes the report.
  Synthetic screenshots, HTML fetches, and code-only review are forbidden.
---

# ATA Visual QA Loop

Verify Alfa Trade Academy UI only with **real browser screenshots**. This wraps the `webapp-testing`
skill (native Playwright, `scripts/with_server.py`, `wait_for_load_state('networkidle')`, headless
chromium, console capture) with ATA-specific comparison and scoring.

Reference viewports: **desktop 1440×900, mobile 390×844** (deviceScaleFactor 1 so PNG pixels == CSS
pixels), plus tablet 1024×768 checked manually. Store under `design-memory/screenshots/<phase>/` and
reviews under `design-memory/reviews/<phase>-review.md` (see `docs/SCREENSHOT_QA_PROTOCOL.md`).

## The loop (do not skip steps; do not stop partway)

1. **Start the application** (dev server via `webapp-testing`'s `with_server.py`).
2. **Open a real browser** (Playwright, headless chromium).
3. **Wait for fonts and assets** — `wait_for_load_state('networkidle')` **and** `await document.fonts.ready`. No FOUT in captures.
4. **Capture exact viewport** — set viewport + deviceScaleFactor 1; clip to exact size so dimensions are precise.
5. **Open the screenshot** — actually view the PNG.
6. **Compare with the visual thesis** — does it deliver the art-direction brief (from `ata-art-direction-gate`)?
7. **Compare with ATA references** — `design-memory/references/ata-brand/*` (navy depth, luminous line, green/cyan signal, chaos→system, signature object).
8. **Check for transferred landing-only defects** — cite manifest §C (low contrast, tiny tracked labels, decorative numbers, global blur, empty hero).
9. **Find at least five potential problems.**
10. **Classify** each as critical / major / minor.
11. **Fix critical and major.**
12. **Take a second screenshot.**
13. **Compare before/after** — confirm a *visible* difference; "looks better" without comparison is not allowed.
14. **Check the browser console** — no hydration errors, no runtime errors, no missing keys, no failed local asset requests (dev-only HMR noise may be filtered, and must be stated).
15. **Run anti-generic scoring** — `ata-anti-generic-ui-review` (must PASS: no auto-fail, total ≥ 80).
16. **Only then write the report.**

## Forbidden

- Synthetic / reconstructed screenshots.
- HTML fetch instead of a real browser render.
- Review from code only.
- Shipping the first screenshot pass.
- Claiming "it got better" without a before/after visual comparison.
- Directions that are visually indistinguishable from each other.

## Report structure

```
# <phase> Visual QA — <screen>
## Captures (before)
desktop 1440×900: <path> | mobile 390×844: <path>
## Findings (≥5)
| # | viewport | problem | severity(critical/major/minor) | status |
## Fixes applied
## Captures (after)  + before/after comparison notes
## Console result
## Anti-generic score (from ata-anti-generic-ui-review): XX/100 PASS/FAIL
## Sign-off
```

Base usability/accessibility/responsive checks (focus rings, keyboard nav, 44px touch targets,
loading feedback, responsive overflow) come from `ui-ux-pro-max` (read-only). A phase is not done
until critical/major findings are closed and anti-generic scoring PASSes.
