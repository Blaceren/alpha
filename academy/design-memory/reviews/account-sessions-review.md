# Two sessions per account, listed in the profile (DD-354)

Owner, 2026-10-07: «Сделай что бы можно было иметь 2 активных сеанса в 1 аккаунте и в профиле снизу есть
сеансы они должны быть там показана и возможность закрыть сеанс с другого сеанса».

Answers (2026-10-07): a third sign-in while two are live — «Закрывать самый давний» (the session unused
the longest is closed automatically; I recommended it over refusing the third sign-in, which could lock a
learner out until a lost device's session expired); release by readiness. Design: delegated.

## What it replaces

H-7 (2026-08-31) made the session server-side with ONE live session per account, by product decision,
enforced by the partial unique index `UserSession_userId_active_key`: every sign-in revoked the previous
session. The profile's bottom section «Сеанс» had one row: this browser and «Выйти из аккаунта».

## Directions weighed (the profile section)

| | A «Строки профиля» (chosen) | B «Карточки устройств» | C «Таблица» |
|---|---|---|---|
| Form | one row per session, in the account part's own row language | a card per device with a glyph | columns: device, signed in, last used, action |
| Why not | — | a card grid, the pattern the brand rejects | an admin table; breaks on a phone |

## What changed

1. **Backend** (`20261007120000_two_live_sessions`, migration 63): `UserSession.slot` (0 or 1, CHECK),
   `userAgent` and `lastSeenAt` (nullable); the one-session index is replaced by
   `UserSession_userId_slot_active_key` (userId, slot) WHERE revokedAt IS NULL — two live sessions at most,
   enforced by the database. Rollback-safe: an older Backend revokes every live row and inserts slot 0.
   - Sign-in (`issueSession`): a free slot is taken; with both taken the session unused the longest is
     revoked and its slot taken, in one transaction (retries on a lost race); the eviction is audited
     (`AUTH_SESSION_EVICTED`).
   - A password change still rotates (every other session ends); a reset still revokes all.
   - `lastSeenAt` is written at most every 5 minutes, by requests only (`getSession`), never by the
     affiliate click classifier.
   - `GET /api/auth/sessions` — the caller's live sessions: id, current, signed in, last used, and the
     device as browser / system / kind (`describeUserAgent`); never the raw description, a token or a
     hash; no address is kept at all.
   - `DELETE /api/auth/sessions/{id}` — CSRF; only the caller's own sessions (anyone else's is «not
     found»); the current one answers 409 (signing out closes it); audited (`AUTH_SESSION_REVOKED`).
2. **Academy**: sign-in operations (login, register, change password) forward the browser's own
   description; a named proxy pair (`sessions-proxy.ts`, one validated id); Profile → «Сеансы»
   (`profile-sessions.tsx`, replacing `profile-exit.tsx`):
   - a line on the rule: two devices at once, a third closes the one unused the longest;
   - this browser first: its kind, «Chrome на Windows», «● Этот браузер · вход 7 окт., 07:36»,
     «Выйти из аккаунта» — drawn even while the list loads or if it cannot be read;
   - the other: «Safari на iPhone», «был активен 2 ч назад · вход …», «Завершить сеанс» → «Завершить сеанс
     на этом устройстве?» «Отмена» (focused) / «Завершить» → the row goes, «Сеанс завершён. На том
     устройстве нужно будет войти снова.» in a polite status line;
   - the password-change message now says other devices will have to sign in again.

## Measured (stand: backend dev with migration 63 + academy production build, synthetic learner)

`two.cjs`: a «computer» (Chrome/Windows, 1440) and a «phone» (Safari/iPhone, 390) sign in as one learner —
both stay signed in; each lists both, itself first, named; every button hit at its centre and ≥44px; no
sideways scroll. The computer closes the phone's session → the phone's next page is /login; the computer
stays. A third and a fourth sign-in: the fourth closes the session unused the longest (the computer), the
other two work. Console 0 errors. Backend: store regression 43/43, HTTP regression 16/16 (two browsers,
list, close, CSRF, another account cannot close, signed-out refused), unit tests 550 + 14 (device names).
Academy: profile, proxy and full suite.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | the proxy forwarded no user-agent, so every session would be «unknown device» | major | sign-in operations forward it (and only they) |
| 2 | a real browser's accessible name put a space before «:» from the visually-hidden text | minor | `aria-label` on the close button |
| 3 | the confirm question wrapped to the row's start, under the label | minor | placed in the value column |
| 4 | setting state synchronously in the loading effect (lint) | minor | the list is set when the answer arrives |
| 5 | changing the password now also ends the other device's session — the message did not say so | minor | «На других устройствах нужно будет войти снова» |
| 6 | the CRM's login does not forward a user-agent: staff sessions are «unknown device» | minor | accepted: no staff surface lists sessions |

## Anti-generic score

DNA 17/20 (the account part's own rows; the Signal marks this browser) · structure 13/15 · meaning 15/15 ·
type 9/10 · signature object 7/10 (a utility, not a brand object) · progression n/a → 9/10 (where the account
is open, at a glance) · mobile 9/10 · usability 10/10 (signing out never waits for the list; one more
question before closing). **TOTAL 89/100 — PASS.**
