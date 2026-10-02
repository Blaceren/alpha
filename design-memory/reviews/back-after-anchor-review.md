# BACK AFTER AN IN-PAGE LINK — browser review

- **Date:** 2026-10-02
- **Owner, 2026-10-02:** «если на публичной главной нажать, например, по „Практика и обратная
  связь“, нас перемещает на `/#review`; после мы жмём „Войти“, попадаем на `/login`, и дальше, когда
  мы жмём назад, линка меняется на `/#review`, но остаётся экран логина; такой же баг со всеми
  остальными категориями публичной главной и возвратом на них — выяви и пофикси».
- **Decision:** DD-334.
- **Nothing on screen changes.** This is a fix of behaviour: no markup a visitor sees, no style, no
  copy. There are therefore no screenshots here — a screenshot has no address bar, and the address
  bar is the other half of the bug. What stands in their place is the browser's own account of each
  step: the address, the page on screen, what the history entry carries, where the page is scrolled.

## Reproduced first, on live PREPROD

Real browser (Playwright Chromium), `https://preprod.alfatrade.media`, academy `8cb7c5b`:

| Step | Address | Screen | The history entry's state |
|---|---|---|---|
| 1. open the public home | `/` | public home | the router's |
| 2. press «Практика и обратная связь» | `/#review` | public home | **null** |
| 3. press «Войти» | `/login` | sign-in | the router's |
| 4. browser Back | `/#review` | **sign-in** | null |
| 5. browser Forward | `/login` | sign-in | the router's |

## Why

`<a href="#review">` is a link to a place on the same page. The BROWSER follows it, not the router:
it adds an entry to the history, and that entry has no state. The router keeps what it needs to
restore a page in the entry's state — and for an entry without one its `popstate` handler returns at
once (`next/dist/client/components/app-router.js`: «this case only happens when
pushState/replaceState was called outside of Next.js. It should probably reload the page in this
case. `return;`»). The browser has already changed the address; nothing changes the screen.

The framework's restore reducer names the case itself: «…if the user navigated to a hash using a
regular anchor link, the history state will not contain the `FlightRouterState`».

## Where else — the owner asked to find it

Every plain in-page link in the application leaves such an entry. Found by reading the source for
`href="#…"`:

| Where | Links | Affected |
|---|---|---|
| Public home, header | «Как это работает», «Практика и обратная связь», «Путь», «Инструменты», «Вопросы», the wordmark (`#top`) | yes — the owner's report |
| Public home, hero | «Как это работает» call (`#mechanism`) | yes |
| Public home, public news | «Перейти к содержанию» (`#main`) | yes |
| **Product shell — every page of the product** | «Перейти к содержимому» (`#main`) | **yes** |
| **Lesson material** | the table of contents (two places) and «Вернуться к разделу» | **yes** |
| Report, validation summary | links to the fields | no — they prevent the navigation and move the focus themselves |

The lesson is the one a learner would meet: a section in the contents, then «← Уровень», then Back
— the address said the lesson, the screen stayed on the level.

## The fix

`src/components/navigation/history-entry-sync.tsx`, mounted once in the root layout. It renders
nothing and follows no link. It makes sure no entry of the document stays without the router's
state:

- **An in-page link was followed** (same page, another fragment, the entry's state is null): the
  entry is handed to the router the way the framework documents — one `history.replaceState` with
  the same address. The router takes the address and writes its own state into the entry. No
  request, no scroll, nothing re-mounted.
- **Back or Forward arrived at an entry nobody handed over, and another page is on screen**: the
  router is asked to show that address (`router.replace`). This is the net under the first case —
  an entry made before the page came alive.
- **An entry that has a state is left alone** — the router's own, or one a page wrote for itself.
  The reset link's page takes its token out of the address on `hashchange`; the sync waits one turn
  so that such a page goes first.

The links themselves stay plain `<a href="#…">`: they work before the page comes alive and without
scripts, and the browser scrolls to them in its own way.

## The same script, without the fix and with it

Stand: Academy `127.0.0.1:3059` → Backend `127.0.0.1:3199`, a throwaway SQLite copy with synthetic
learners; one lesson material with four sections was seeded into that copy so that a table of
contents exists to press. «Without» is the same tree with the sync taken out of the root layout.
Before every measurement the script waits until the page has stopped scrolling.

| # | What is pressed | Without | With |
|---|---|---|---|
| 1–10 | each of the five section links → «Войти» → Back → Forward; the same → «Начать путь» | Back: the section's address on the SIGN-IN screen | Back: the public home, the section where it was (96px from the top before and after); Forward: the form |
| 11 | the wordmark (`#top`) → «Войти» → Back | sign-in screen | public home |
| 12 | the hero's «Как это работает» → «Войти» → Back | sign-in screen | public home |
| 13 | «Перейти к содержанию» (keyboard) → «Войти» → Back | sign-in screen | public home |
| 14 | phone 390: menu → «Вопросы» → «Войти» → Back | sign-in screen, scrolled to 0 | public home, «Вопросы» where it was (269px before and after — the last section, the page ends there); the menu closed as before |
| 15 | two sections one after another → «Войти» → Back ×3 → Forward ×3 | the first two Backs keep the sign-in screen | `/#review` → `/#mechanism` → `/` → `/#mechanism` → `/#review` → `/login`, each with its own screen |
| 16 | the same link twice (the browser replaces the entry and reports only `popstate`) → «Войти» → Back | sign-in screen | public home |
| 17 | an entry made behind the router's back, as before the page comes alive → «Войти» → Back → Forward | sign-in screen | public home, «Вопросы» in view, the entry now the router's; Forward: the form |
| 18 | lesson: a section in the contents → «← Уровень» → Back → Forward | the lesson's address on the LEVEL page | the lesson, the section where it was (68px before and after); Forward: the level |
| 19 | product: «Перейти к содержимому» on «Инструменты» → «Уроки» → Back | `/tools#main` with «Уроки» on screen | «Инструменты» |
| 20 | the reset link: its token leaves the address, and again when a second link arrives in the same tab | passes | passes — unchanged |
| 21 | handing an entry over: requests to the server, reload, re-mount | — (nothing is handed over) | none, no, no |
| | **Total** | **1 of 21** | **21 of 21** |

No page errors and no console errors in the runs with the fix (the dev server and the production
build).

## Against a production build

The same tree built for production with the stand's environment and served with `next start`:

- the 21 checks above: 21 of 21;
- the earlier waves' checks, as a regression of everything the root layout now stands beside: the
  tools' fields 31 of 31, the security check 7 of 7, the lines behind their nodes 175 of 175;
- **every route's rendering mode is what it was**: 78 routes, the same list and the same mode as the
  released build — the one prerendered route stays prerendered (the sync reads the query string
  inside a boundary);
- **what the layout adds to a served page**: one empty boundary — two comment nodes — before the
  page. Nothing else differs in the opening of `<body>` from the live build.

## Automated

- `history-entry-sync.test.tsx` — 13 tests: what the sync asks of the History API and of the router
  for each event, in each order, and what it leaves alone.
- `root-layout.test.ts` — 9 tests: the root layout's contract (it was frozen until now; the identity
  guard hands it to this file), and four lines that read the INSTALLED framework: that it still
  ignores an entry without a state, still takes a `replaceState` into its router, still stamps the
  entry, still keeps the page on screen when there was nothing to restore from. A unit test of the
  sync cannot see the framework's half; these say so the day an upgrade moves it.
- Academy: `tsc` clean, ESLint clean, Vitest 186 files / 2861 tests.

## What was not verified

- **Other browsers.** Only Chromium is installed on this host. The fix rests on what every browser
  does for an in-page link — a new entry with a null state, and `hashchange` — and on no
  Chromium-only API; but it was not run in Firefox or Safari.
- **The lesson's contents on PREPROD under a learner** — sign-in is CAPTCHA-gated and an agent
  cannot mint a session. On the stand it is check 18.

## Sign-off

- The bug is reproduced, its cause is read in the framework's own source, and the fix is checked by
  the same script that reproduces it.
- Nothing a visitor sees has changed.
- Ready for PREPROD by the owner's word of 2026-10-02 («как закончишь — публикуй предпрод»).
  Academy only; no Backend change, no migration.

## Released to PREPROD — 2026-10-02

Owner: «продолжай, как закончишь — публикуй предпрод». Academy `871d298` (BUILD_ID
`dEPQRhnCua6oa-Y1FuJKB`) at 10:37:47Z; the rollback point is `8cb7c5b` (BUILD_ID
`06v4VxI6YMt3OQU7zrevE`). Academy only: the Backend stays `e70b6b1`, no migration, the database is
not touched. Not pushed to GitHub.

On the live host, in a real browser:

- **the owner's own steps** — home → «Практика и обратная связь» → «Войти» → Back: the address is
  `/#review` and the screen is the public home, the section where it was; Forward: the sign-in form;
- **the 18 checks that need no session** — the five section links × two ways out, the wordmark, the
  hero's call, the skip link, the phone menu, the chain of two sections, the same link twice, the
  entry made behind the router's back, and that handing an entry over asks the server for nothing:
  18 of 18;
- nothing else moved: the lines are behind their nodes (175 of 175), the security check goes
  through the same states as before the release, the console has the one warning it had, the
  service and nginx logs since the cutover are clean, the host is still `noindex`.

**Not verified on PREPROD:** the lesson's contents and the product's «Перейти к содержимому» under a
learner (no session can be minted) — checks 18 and 19 on the stand; and any browser other than
Chromium.
