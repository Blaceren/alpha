# Pocket postbacks

Pocket can send simple GET postback URLs to:

```text
http://57.128.213.204:8080/api/postbacks/pocket
```

Use a HTTPS domain instead of the raw IP/HTTP address before production.

## Required URLs

Registration:

```text
http://57.128.213.204:8080/api/postbacks/pocket?clickid={click_id}&goal=reg&playerid={trader_id}
```

First Deposit:

```text
http://57.128.213.204:8080/api/postbacks/pocket?clickid={click_id}&goal=dep&playerid={trader_id}&sum={sumdep}
```

Re-deposit:

```text
http://57.128.213.204:8080/api/postbacks/pocket?clickid={click_id}&goal=redep&playerid={trader_id}&sum={sumdep}
```

Optional Email Confirmation:

```text
http://57.128.213.204:8080/api/postbacks/pocket?clickid={click_id}&goal=email_confirmed&playerid={trader_id}
```

Never put the real secret in docs, code, issue trackers, or chat.
If the old CRM `ow` value was shared in screenshots or chats, rotate it before production and update only `POSTBACK_SECRET` in env.

## Accepted macros

- `clickid` or `click_id` -> `click_id`
- `goal`, `event`, or `type` -> Pocket event
- `playerid`, `trader_id`, `traderId`, or `user_id` -> `trader_id`
- `sum`, `sumdep`, `amount`, or `deposit_amount` -> `amount`
- `externalEventId`, `event_id`, `transaction_id`, or `conversion_id` -> idempotency key
- `currency` -> currency, default `USD`
- `x-postback-secret` header -> the shared `POSTBACK_SECRET` (the **only** accepted authentication channel)
- `ow`, `secret`, `token` in the query string -> **rejected**; a request carrying any of them is refused with `403`

Goal mapping:

- `reg`, `registration` -> `Registration`
- `dep`, `ftd`, `first_deposit` -> `First Deposit`
- `redep`, `redeposit` -> `Re-deposit`
- `email`, `email_confirmed`, `email_confirmation` -> `Email Confirmation`
- `commission` -> `Commission`
- `withdrawal` -> `Withdrawal`
- `successful_withdrawal` -> `Successful Withdrawal`
- `canceled_withdrawal` -> `Canceled Withdrawal`

## Security

The endpoint **fails closed**. There is no unauthenticated mode.

`POCKET_POSTBACK_ENABLED` must be exactly `true` for the route to accept anything.
Absent, `false`, or a `POSTBACK_SECRET` that fails the strength bounds (16-200
printable non-whitespace characters, no comma) all produce the same `503`
`POCKET_POSTBACK_UNAVAILABLE`. Disabled and misconfigured are deliberately
indistinguishable, so the response never reveals whether a secret is configured.

When enabled, every request must carry the secret in the request header:

```text
X-Postback-Secret: <POSTBACK_SECRET>
```

Authentication is **header-only**. Secrets in URLs are captured by access logs,
proxies, browser history and `Referer` headers, so `?ow=`, `?secret=` and
`?token=` are no longer accepted — a request carrying any of them is rejected
even if a valid header is also present, so a legacy integration fails loudly
instead of silently continuing to leak its secret.

The comparison is timing-safe. Missing, empty, malformed, ambiguous (the header
sent more than once) and simply wrong secrets all return one identical `403`
`FORBIDDEN` body, and authentication happens before any database lookup, so a
rejected postback changes zero rows.

Requests are rate-limited per IP before any database work. Exceeding the budget
returns `429` `RATE_LIMITED`. Authentication failures consume the same budget, so
the secret cannot be probed at unbounded rates.

> The previous `POCKET_POSTBACK_REQUIRE_SECRET` flag failed **open**: when it was
> absent or not `"true"` the secret check was skipped entirely and the endpoint
> accepted any unauthenticated request. It has been removed and must not return.

### Replay and idempotency

`PostbackEvent.externalEventId` carries a database `UNIQUE` constraint, which is
the durable replay control — not process memory. Pocket supplies the identifier
through `externalEventId`, `event_id`, `transaction_id` or `conversion_id`; when
none is present a deterministic fingerprint of
`clickId|traderId|type|amount|date_time` is used instead.

- A replayed identifier returns `{"success":true,"duplicate":true}` and applies
  no mutation.
- Concurrent duplicates lose the unique-constraint race; the losing request's
  whole transaction, including the account update, rolls back.
- A replayed identifier describing *different* business facts (event type, amount
  or currency) is a conflict, not a duplicate: it returns `409`
  `POSTBACK_CONFLICT` and never overwrites the original receipt.

Pocket's `date_time` is an untrusted upstream value and is **not** used as a
freshness or replay control; durable event-id idempotency is the sole guarantee.

The existing JSON endpoint remains available:

```text
POST /api/exchange/postbacks/receive
```

It still requires the `x-postback-secret` header and accepts JSON.

## Manual checks

Use a real known `click_id` from admin/CRM before testing accepted events.

Registration:

```text
GET /api/postbacks/pocket?clickid=REAL_CLICK_ID&goal=reg&playerid=TEST_PLAYER_ID
```

First Deposit:

```text
GET /api/postbacks/pocket?clickid=REAL_CLICK_ID&goal=dep&playerid=TEST_PLAYER_ID&sum=94.18
```

Re-deposit:

```text
GET /api/postbacks/pocket?clickid=REAL_CLICK_ID&goal=redep&playerid=TEST_PLAYER_ID&sum=205.10
```

Unknown click id:

```text
GET /api/postbacks/pocket?clickid=FAKE_CLICK_ID&goal=reg&playerid=TEST_PLAYER_ID
```

Send the secret as a header, for example:

```bash
curl -H "X-Postback-Secret: $POSTBACK_SECRET" "<url>"
```

Expected result:

- known `clickid` events return `{"success":true,"duplicate":false}`
- duplicate idempotency keys return `{"success":true,"duplicate":true}`
- a reused idempotency key with different facts returns `409` `POSTBACK_CONFLICT`
- unknown `clickid` returns `{"success":false,"error":"UNKNOWN_CLICK_ID"}`
- no/wrong/query-supplied secret returns `403` `FORBIDDEN`
- integration disabled or misconfigured returns `503` `POCKET_POSTBACK_UNAVAILABLE`
- admin/CRM shows `click_id`, `trader_id`, event history, deposit totals, email confirmation, rejected events, and duplicate behavior
