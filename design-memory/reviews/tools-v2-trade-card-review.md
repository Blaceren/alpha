# TOOLS-V2 · Slice 1 · Trade Card: screenshot review

- **Date:** 2026-09-21
- **Scope:** the new «Инструменты» page and the Trade Card tool (L5), which opens in a new tab.
- **Design source:** the owner's presentation «Окна инструментов ATA» and the owner's answers of 2026-09-21 (DD-315).

## How the screenshots were made
- **Real browser:** Playwright Chromium (headless shell 149).
- **Stack under test:** Academy `next dev` on 127.0.0.1:3059, then Backend `next dev` on 127.0.0.1:3199, then a scratch SQLite database.
- **Data:** the database was seeded with the first 12 ATA levels (real titles) and three synthetic learners:
  - completed through L5, so the Trade Card is open;
  - completed through L2, so it is locked;
  - completed through L10, so the Journal is earned but not built.
- **Real paths:** every screenshot is a real render of the real routes, fed by the real BFF proxy and the real Backend API. No PREPROD data was involved.
- **Viewports:** 1440×900, 1024×768 and 390×844 (390 with touch and mobile emulation).
- **Full-page images:** these lay the tool window's sticky header and footer out in flow, because a full-page capture cannot show them where a reader sees them. The `*-first-screen` image keeps the real sticky rendering.
- **Time input:** the headless shell shows `<input type="time">` in 12-hour format («02:32 PM»). Browsers with a Russian locale show 24-hour time. The value is `14:32` either way.

Files: `design-memory/screenshots/tools-v2-trade-card/final/<viewport>-<state>.png`

| State | File suffix |
|---|---|
| Tools page, learner past L5 | `01-hub-open-learner` |
| Trade Card, empty plan (first screen) | `02-card-empty-first-screen` |
| Empty plan submitted: every missing field named | `03-card-validation` |
| Plan fixed (badge «Зафиксировано», steps by clock, fields read-only) | `05-card-fixed` |
| Result picked, observation written | `06-card-result` |
| Card saved | `07-card-saved` |
| «Сделку не открывал» confirmation | `08-card-cancel-confirm` |
| Tools page, learner at L3 | `09-hub-locked-learner` |
| Trade Card locked | `10-card-locked` |
| Locked, example shown | `11-card-locked-preview` |
| Journal earned but not built («Скоро») | `14-journal-soon` |

## What the first pass found, and what changed

| # | Finding | Fix |
|---|---|---|
| 1 | Server error on the locked page: the example card rendered the form on the server and handed `<select>`/`<button>` event handlers across the server/client boundary. The unit suite (jsdom) cannot see this; the live stack did. | `trade-card-parts.tsx` is a client module; the server passes plain values only. |
| 2 | The tools page had no gutter from 900px up: the shell's main area carries no padding there, and the title sat at x=0. | Support's measure and centring (1080px, auto margins) plus its own padding from 900px. |
| 3 | The placeholders «8» and «90» in Сумма/Payout read like values already entered. | Removed; the fields start empty. |
| 4 | At 390px the step labels were cut («Подготов…», «Экспирац…»). | The labels scale with the viewport (10–12px) with a slightly tighter gap; all five fit at 390. |

- **Re-shoot after fix 4:** the 390 set was re-shot. At 1440 and 1024 the label size is unchanged (it caps at 12px); only a −0.01em letter-spacing applies there. The 1440 card states were re-shot after the change. The remaining desktop images predate it by that letter-spacing alone: the Backend's login rate limit (5 per 10 minutes) stopped the second re-shoot, which is intended behaviour.

## Checked and accepted
- **Hub (1440/1024):**
  - Six rows in unlock order, each with its level mark, name and one line from the presentation.
  - One action per row: «Открыть ↗» opens a new tab, locked rows show «🔒 Откроется на уровне N», an earned but unbuilt tool shows «Скоро».
  - For a locked built tool, a quiet «Как будет выглядеть» link.
  - The footer line: «не торговые сигналы».
- **Hub (390):** the action drops under the text and the bottom navigation is clear.
- **Tool tab:**
  - A narrow column (max 480px) centred on wide screens, with side rules on a darker ground: the column the learner will dock next to Pocket.
  - Header «ATA · Trade Card · L05 · ×».
  - Footer «Инструмент обучения, не торговый сигнал».
- **Card:**
  - Mono labels, serif for the learner's own text and for the two amounts, and the lime primary button.
  - The five steps follow the learner's clock. Example: entry 16:27, expiry 1 min, so «Экспирация» is current and the hint reads «Экспирация в 16:28:00».
  - Outcome arithmetic is correct: $12.50 at 82% gives +$10.25 / −$12.50, and $8 at 90% gives +$7.20 / −$8.00.
  - Save stays disabled until a result is picked, and says why.
- **Locked page:** «Закрыто · сейчас L3», «Откроется на уровне 5», the lesson named by its title, and the example labelled «Пример данных».
- **Console and page errors:** none reported across all three viewports, after fix 1.

## Not covered here
- **PREPROD:** the owner reviews on PREPROD with their own learner. This review is the pre-release pass.
- **Lesson links:** links from lesson content to a tool still open in the same tab and are redirected to the new address. Opening them in a new tab is a later change.
