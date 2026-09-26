# Pocket postbacks

The canonical Pocket provider callback contract, as the deployed source
implements it. Rewritten by `ATA-PREPROD-POCKET-REG-INGRESS-ENABLEMENT-AND-ACTIVATION-1`
(2026-08-14): the previous version of this document described the pre-PDP-1
header-only contract and a fingerprint fallback that were both removed by later
accepted waves. Source is authority; the files are named beside each rule.

## The endpoint

```text
GET /api/postbacks/pocket
```

One public callback path, GET only. On PREPROD it is reachable at:

```text
https://preprod.alfatrade.media/api/postbacks/pocket
```

This exact path — and only this exact path — is exempt from the PREPROD human
Basic Auth gate at the nginx edge; it answers with the Backend's own
fail-closed provider authentication instead. Every other path on the host stays
behind the gate. The nginx location keeps the sanitized access log
(`postback_noquery`, `$uri` never `$request`) and a `crit`-level error log so
the query-borne secret can never reach a log file.

## Required URLs (configure at Pocket)

Registration:

```text
https://preprod.alfatrade.media/api/postbacks/pocket?clickid={click_id}&goal=reg&playerid={trader_id}&ow=<POSTBACK_SECRET>
```

First Deposit (only once DEP is switched on):

```text
https://preprod.alfatrade.media/api/postbacks/pocket?clickid={click_id}&goal=dep&playerid={trader_id}&sum={sumdep}&ow=<POSTBACK_SECRET>
```

Re-deposit (only once RDEP is switched on):

```text
https://preprod.alfatrade.media/api/postbacks/pocket?clickid={click_id}&goal=redep&playerid={trader_id}&sum={sumdep}&ow=<POSTBACK_SECRET>
```

Never put the real secret in docs, code, issue trackers, or chat. If an `ow`
value was ever shared in screenshots or chats, rotate it and update only
`POSTBACK_SECRET` in env.

## Goals — exactly three, no synonyms

`reg`, `dep`, `redep` (`src/lib/growth/pocket/goal-allowlist.ts`). The literals
Pocket's own macro documentation uses; no case folding, no trimming, no alias
table. A duplicated `goal` parameter is refused. `registration`, `ftd`,
`first_deposit`, `redeposit`, `email_confirmed`, `commission`, `withdrawal` and
every other historical spelling name no Growth V1 event and are refused; no
Pocket receiver can reach commission or withdrawal processing at all.

## Switches — one per family, all AND-ed with the master

| key | meaning |
|---|---|
| `POCKET_POSTBACK_ENABLED` | master gate: "Pocket is integrated at all"; owns the secret |
| `POCKET_REG_INGEST_ENABLED` | the REG family |
| `POCKET_DEP_INGEST_ENABLED` + `POCKET_FIRST_DEPOSIT_ENABLED` | the DEP family (the second key owns the deposit currency contract) |
| `POCKET_RDEP_INGEST_ENABLED` | the RDEP family (evidence capture; canonical emission additionally requires `POCKET_RDEP_EVENT_ID_PARAM`) |

Turning the master on alone admits **nothing** — each family needs its own
switch (`src/lib/growth/ingress-config.ts`).

## Authentication — two channels, no third

1. `?ow=<POSTBACK_SECRET>` — Pocket's official direct contract
   (`authenticatePocketQuerySecret`). Accepted **only** for a Growth V1 goal
   whose own family switch is on. Exactly one `ow`; duplicated, empty or
   malformed values are refused; the comparison is timing-safe.
2. `X-Postback-Secret: <POSTBACK_SECRET>` header — the legacy ATA integration
   channel (`authenticatePocketRequest`), timing-safe, one header only.

`?secret=` and `?token=` are legacy aliases with no provider mandate and are
rejected outright, even beside a valid header. For any goal outside the enabled
Growth V1 set, `ow` joins them — a request carrying query auth material for
such a goal is refused with the one indistinguishable `403` so a legacy
integration fails loudly rather than continuing to leak.

The secret must satisfy 16–200 printable non-whitespace characters with no
comma; a value failing those bounds produces the same `503` as "disabled",
deliberately (`resolvePocketPostbackConfig`).

## Order of evaluation (the post-G4 refusal contract)

1. **Master gate.** Off or misconfigured → `503 POCKET_POSTBACK_UNAVAILABLE`,
   indistinguishable on purpose, before any database work.
2. **Per-IP rate limit** — 600/min accepted-traffic budget; authentication
   failures draw from their own 20/min budget (`rate-policy.ts`). Exceeded →
   `429 RATE_LIMITED`.
3. **Bounded query shape** — max 40 params, key ≤ 80, value ≤ 1000 → `400`.
4. **Supported goal, own family off, `ow` present** → `503`, **before
   authentication**. A disabled family is not an authentication failure; 503 is
   retry-safe, so a delivery during a rollout window is not lost
   (TEST-POCKET-REFUSAL-CONTRACT pins this in the regression suites).
5. **Forbidden query auth material** → one identical `403`.
6. **Authentication** (timing-safe) → failures are one identical `403`.
7. **Dispatch** on the goal allowlist: `reg` binds identity and reconciles L1
   and never touches money; `dep` records money and never touches identity or
   progression; `redep` records evidence and refuses to emit a canonical event
   it cannot identify.

## Registration (`goal=reg`, `ow` channel)

Strict single-spelling fields (`parsePocketRegistrationFields`): `clickid`
exactly once, matching `tq-<uuid v4 lowercase>` (minted by
`POST /api/exchange/referral-link`); `playerid` exactly once, matching
`^[1-9][0-9]{0,15}$` and safe-integer bounded. An unknown clickid returns the
**same** bounded `400 INVALID_REGISTRATION` a malformed field produces — a
caller cannot distinguish them.

Past validation: one durable `ProviderIngressEvent` per delivery (evidence,
written before the binding, settled after), then `bindPocketIdentityCanonical`
— the identity binding and the canonical `pocket_reg` GrowthEvent are **one
domain operation** (G4-H5), idempotent on `pocket:player:<id>`, with
`occurredAt = boundAt` so a retry never moves a registration between reporting
periods. Then `ExchangeAccount.registrationStatus = true` plus a durable
receipt (`PostbackEvent.externalEventId` is `null` for registrations: Pocket
documents no transaction id for one, and a fabricated id would be a lie about
provenance). Then the L1 reconciliation through the shipped start + completion
owners — zero XP, enforced by a throw that rolls the transaction back.

Replay: identical delivery → identity `already_bound` → L1 `already_completed`
→ `pocket_reg` duplicate → `200 {"ok":true}`, zero mutation beyond a new
evidence row (`accepted_duplicate`). Concurrent duplicates: the database
decides via the UNIQUE constraints; the loser re-reads and reports the stored
truth. A conflicting player is quarantined (`player_conflict`); the original
binding survives.

## Responses

| condition | response |
|---|---|
| integration disabled / secret misconfigured | `503 POCKET_POSTBACK_UNAVAILABLE` |
| family disabled (`reg`/`dep`/`redep` with `ow`) | `503 POCKET_POSTBACK_UNAVAILABLE`, pre-auth |
| bad/missing/ambiguous secret, or query-borne secret where forbidden | `403 FORBIDDEN` |
| rate limited | `429 RATE_LIMITED` |
| malformed field **or** unknown clickid | `400 INVALID_REGISTRATION` (reg) / `400 INVALID_DEPOSIT` (dep) / `400 INVALID_REDEPOSIT` (redep) |
| unsupported goal on the `ow` channel | `400 UNSUPPORTED_GOAL` |
| transient failure during L1 reconciliation | `503 {"ok":false}` + `POCKET_REGISTRATION_LEVEL_RECONCILE_DEFERRED` audit — Pocket's retry is the recovery path |
| success (every business outcome) | `200 {"ok":true}` — matched, duplicate and quarantined are deliberately indistinguishable to the caller; no enumeration oracle |

## The legacy header channel

A header-authenticated `goal=reg` continues down the legacy response shape
(`{"success":true,...}` / `404 UNKNOWN_CLICK_ID`) for existing ATA
integrations; it now projects through the same canonical domain operation, so
both receivers produce one binding and one event. The JSON intake
`POST /api/exchange/postbacks/receive` remains header-only, master-gated, and
cannot bind identities. Neither legacy channel is part of the Pocket provider
contract.

## What is deliberately absent

- No fingerprint fallback for a missing provider event id — that key
  (`clickId|traderId|type|amount|date_time`) is forbidden in both directions
  and was removed (DEVACT-1); a registration simply has no external event id.
- No `date_time` freshness or replay control — untrusted upstream data.
- No redeposit identity synthesis — canonical `rdep` requires an operator to
  name a provider-guaranteed unique parameter in `POCKET_RDEP_EVENT_ID_PARAM`;
  until then deliveries land as durable `identity_unresolved` evidence.
