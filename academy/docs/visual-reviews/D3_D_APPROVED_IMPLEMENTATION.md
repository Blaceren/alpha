# D3-D-B — Approved Report State · Implementation Visual Review

Phase: **D3-D-B** (Approved Report State). Scope: the terminal `approved` verdict on
`/lessons/level.003`, its projection onto Lessons Library and Path, storage v3, and the
base-completed vs approval-induced distinction. No separate art-direction stage — the Evidence
Ledger / Revision Pass language is reused (per the decision log), and a full implementation visual
QA was run instead.

## Method

Two-pass screenshot cycle with a real browser (Playwright, per `webapp-testing` / the ATA visual QA
protocol). Frames seeded deterministically as the v3 record the verdict adapter would leave — no
synthetic reconstruction, no HTML fetch. The 200 % frame uses a REAL reflow (a 720×450 CSS
viewport), never `documentElement.style.zoom`.

- First pass: `npx playwright test e2e/report-approved-screenshots.spec.ts`
  → `design-memory/screenshots/d3-approved/first-pass/`
- Final pass: `APPROVED_SHOTS_STAGE=final npx playwright test e2e/report-approved-screenshots.spec.ts`
  → `design-memory/screenshots/d3-approved/final/`

Historical screenshots were not overwritten; `git status` after the runs shows only the new
`d3-approved/` directory added.

## Final inventory (`design-memory/screenshots/d3-approved/final/`)

| # | File | Viewport | What it shows |
|---|------|----------|---------------|
| 1 | `report-approved-desktop-1440x900.png` | 1440×900 | «Одобрено» chip, headline, provisional note, read-only ledger |
| 2 | `report-approved-with-history-desktop-1440x900.png` | 1440×900 | quiet «Комментарий последней проверки», next step, `/path` CTA |
| 3 | `lessons-library-approved-desktop-1440x900.png` | 1440×900 | L3 «Завершён · Пересмотреть», L4 checkpoint next, «пройдено 3 из 4» |
| 4 | `path-approved-desktop-1440x900.png` | 1440×900 | L3 «пройден», L4 current checkpoint detail, `$50` only |
| 5 | `report-approved-mobile-390x844.png` | 390×844 | Evidence Ledger preserved, chip + headline, bottom nav |
| 6 | `report-approved-mobile-320x720.png` | 320×720 | no horizontal overflow at the narrow width |
| 7 | `report-approved-zoom-200-720x450.png` | 720×450 | 200 % reflow, headline/note wrap cleanly |
| 8 | `report-approved-short-1440x650.png` | 1440×650 | short viewport, chrome intact |
| 9 | `report-approved-canonical-l18-desktop-1440x900.png` | 1440×900 | neutral archive, NO «Одобрено», NO approved CTA |
| 10 | `report-approved-storage-failure-desktop-1440x900.png` | 1440×900 | stays «На проверке» after a failed write — no fake success |

## First-pass self-review (every frame viewed)

- **1 — approved desktop.** Calm green «Одобрено» chip (success family, solid dot); headline «Отчёт
  принят. Уровень 3 завершён.»; provisional note keeps `dev/test · provisional` + «только в этом
  браузере» visible. Ledger read-only. The next-step/CTA sit below the fold on this tall ledger —
  captured fully in frame 2. No celebration hero, no confetti, no large green surface, no
  dashboard card.
- **2 — approved with history.** History block «Комментарий последней проверки» is quiet (no jump
  links, no attention edge, no pass counter). Next step «Уровень 4 · Контрольная точка / Требуется:
  Баланс Pocket от $50»; primary CTA «Посмотреть Путь» (green, calm), secondary «К списку уроков».
  Nothing financial beyond the checkpoint target.
- **3 — library.** Continue note «Следующий шаг — контрольная точка · Уровень 4.»; L3 «Завершён ·
  Пересмотреть» (never «Одобрено»); L4 «Граница модуля» with «Баланс Pocket от $50»; module «пройдено
  3 из 4». No `href="/lessons/level.004"`.
- **4 — path.** Header «Сейчас: Уровень 4 · Контрольная точка»; L3 «пройден» with no report label;
  L4 detail shows only the `$50` condition, no balance/progress/Pocket CTA.
- **5–8 — responsive.** Mobile 390 / 320 keep the Evidence Ledger; 200 % and short viewport reflow
  without horizontal overflow. Chip and headline wrap cleanly at 320.
- **9 — canonical L18.** Neutral archive: save band + «Уровень 3 уже пройден в текущем профиле…».
  NO «Одобрено», NO headline, NO approved CTA — the base-completed rule holds.
- **10 — storage failure.** After `?verdict=approved` with a throwing `setItem`, the report stays
  «На проверке» and shows the pending blocked note. No fabricated approval.

## Findings

- **Critical:** none.
- **Major:** none.
- **Minor:** on the tall desktop ledger (frame 1) the next-step/CTA are below the fold; this is
  inherent to a 5-entry Evidence Ledger and is the same behaviour as the D3-C pending/revision
  screens — captured in frame 2 and reachable by an ordinary scroll. Left as-is (not a defect).

No critical or major issues → the final pass is identical in content to the first pass.

## Geometry / accessibility checks (locked as smoke tests)

`e2e/report-approved-smoke.spec.ts` asserts, in a real browser:

- horizontal overflow = 0 at 390 / 320 / 720×450;
- the `/path` CTA clears the bottom navigation by ≥ 12 px and is ≥ 44 px tall (touch target);
- exactly one `h1`; status carried in words («Одобрено»), not colour alone;
- the ledger is genuinely `readOnly`; no submit/resubmit/«Одобрить» control exists;
- a plain reload of an approved archive raises no `aria-live` announcement;
- console is clean (0 errors, 0 hydration warnings) across the behavioural suite.
