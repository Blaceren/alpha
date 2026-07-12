# Visual QA

Last updated: 2026-06-30

## Goal

Design Pass 4.2 runs real local browser screenshot QA for the MVP. Design Pass 4.3 adds a local gallery and a manual review workflow. Design Pass 5 uses that automated coverage as the acceptance gate for premium UI polish without a manual subjective PNG review.

Screenshots are local artifacts only. Do not commit `visual-qa/`.

## Design Pass 5 Workflow

Design Pass 5 covers public landing, dashboard, tasks, levels, rewards, daily streak, leaderboard, chat, mentor chat, exchange, shared chrome, and admin/staff readability. It does not change product behavior, backend/API contracts, permissions, Prisma, or business logic.

Acceptance sequence:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run visual:qa
npm.cmd run visual:qa:gallery
npm.cmd run verify:rc
```

A clean automated screenshot run confirms route coverage and screenshot capture across light/dark desktop/tablet/mobile states. It does not replace subjective design judgment. Review `visual-qa/index.html` and record findings in `docs/visual-review-notes.md` before public launch.

Functional Completion Pass 6 adds `/achievements`, `/admin/promocodes`, and `/admin/achievements` to the automated route matrix. The expected matrix is now 34 routes across two themes and three viewports, or 204 screenshots. Manual subjective review remains recommended.

## Playwright

Playwright is installed as a dev dependency and Chromium binaries were installed locally:

```powershell
npm.cmd install --save-dev playwright
npx.cmd playwright install chromium
```

## Commands

Build and start a local server:

```powershell
npm.cmd run build
npm.cmd run start -- --port 3009
```

Verify runtime:

```powershell
curl.exe -i http://127.0.0.1:3009/api/health
curl.exe -i http://127.0.0.1:3009/api/readiness
```

Run screenshot QA:

```powershell
$env:VISUAL_QA_BASE_URL="http://127.0.0.1:3009"
$env:SESSION_SECRET="<same secret as the running server>"
npm.cmd run visual:qa
```

The script uses `VISUAL_QA_BASE_URL` when set, otherwise `http://localhost:3009`.

Build the local screenshot gallery:

```powershell
npm.cmd run visual:qa:gallery
```

Open this file in a browser:

```text
visual-qa/index.html
```

The gallery is a standalone static HTML file. It does not require a server or external CDN.

## Output

Screenshots are written to:

```text
visual-qa/screenshots/{theme}/{viewport}/{route-name}.png
```

The script also writes:

```text
visual-qa/summary.json
```

The gallery builder writes:

```text
visual-qa/index.html
```

Both generated files and screenshots remain ignored through `visual-qa/`.

## Gallery

The gallery provides:

- total and visible screenshot counts;
- counts by theme and viewport;
- light/dark theme filters;
- desktop/tablet/mobile viewport filters;
- route and file-path search;
- quick links for critical public, user, admin, and staff pages;
- navigation by theme/viewport group;
- the screenshot route, local file path, and automated result when `summary.json` is available;
- a manual checklist stored in browser localStorage.

## Coverage

Themes:

- `light`
- `dark`

Viewports:

- `desktop`: 1440x900
- `tablet`: 768x1024
- `mobile`: 390x844

Routes:

- Public: `/`, `/login`, `/register`, `/privacy`, `/cookies`, `/security`
- User: `/dashboard`, `/tasks`, `/levels`, `/rewards`, `/rewards/daily`, `/leaderboard`, `/achievements`, `/chat`, `/mentor-chat`, `/notifications`, `/exchange`, `/exchange/existing-account`, `/feedback`
- Admin/staff: `/admin`, `/admin/users`, `/admin/tasks`, `/admin/rewards`, `/admin/promocodes`, `/admin/achievements`, `/admin/news`, `/admin/task-reports`, `/admin/exchange`, `/admin/feedback`, `/admin/chat-moderation`, `/admin/audit-logs`, `/support`, `/crm`, `/open-questions`

## Auth

The runner creates QA session cookies for seed accounts directly from the local SQLite database, then verifies the session through `/api/auth/me`.

Seed accounts:

- `user@test.com`
- `admin@test.com`
- `support@test.com`
- `mentor@test.com`
- `moderator@test.com`
- `news@test.com`

This avoids exhausting the login API rate limit during the 186-screenshot matrix. The `SESSION_SECRET` used by `visual:qa` must match the running server.

## Automated Checks

For each rendered page the script checks:

- page response is not HTTP 500+;
- main content exists;
- page is not empty;
- body/html do not horizontally overflow;
- no obvious application error text;
- no visible mojibake patterns.

Cookie consent is pre-seeded in localStorage so screenshots focus on the page UI instead of repeating the first-visit cookie banner.

## 2026-06-30 Result

Real browser screenshots were captured with Playwright Chromium:

- base URL used for the final screenshot run: `http://127.0.0.1:3011`
- screenshots created: `186`
- automated clean result: `186/186`
- summary: `visual-qa/summary.json`

Findings fixed in Design Pass 4.2:

- production CSP blocked Next inline bootstrap/RSC scripts, causing blank pages in Chromium;
- screenshot auth exhausted the login rate limit;
- cookie banner covered page content in screenshots;
- error-text check falsely flagged normal numeric values such as XP thresholds.

Remaining manual review:

- inspect saved PNGs for subjective polish items through `visual-qa/index.html`;
- decide separately whether to replace production `unsafe-inline` CSP with nonces or hashes in a security-hardening pass.

## Manual Review

Automated clean results only cover the checks listed above. They do not replace subjective review of hierarchy, spacing, legibility, visual consistency, or workflow clarity.

Use the checklist in the gallery while reviewing each route/theme/viewport group. Record findings in:

```text
docs/visual-review-notes.md
```

Copy the issue template once per finding and include the exact screenshot path.

Severity:

- `blocker`: unreadable text, body horizontal scrolling, missing required CTA, blank rendering, or broken mobile navigation;
- `major`: unusable tables, severely broken cards/layout, poor dark-theme contrast, or a key workflow that is impractical to complete;
- `minor`: visible local responsive, wrapping, alignment, contrast, or consistency issue that does not block the workflow;
- `polish`: spacing, visual refinement, plain presentation, or placeholder assets.

After fixes, run screenshot QA again, rebuild the gallery, and update each note status.
