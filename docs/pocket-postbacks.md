# Pocket postbacks

Pocket can send simple GET postback URLs to:

```text
http://57.128.213.204:8080/api/postbacks/pocket
```

Use a HTTPS domain instead of the raw IP/HTTP address before production.

## Required URLs

Registration:

```text
http://57.128.213.204:8080/api/postbacks/pocket?clickid={click_id}&goal=reg&playerid={trader_id}&ow=<POSTBACK_SECRET>
```

First Deposit:

```text
http://57.128.213.204:8080/api/postbacks/pocket?clickid={click_id}&goal=dep&playerid={trader_id}&ow=<POSTBACK_SECRET>&sum={sumdep}
```

Re-deposit:

```text
http://57.128.213.204:8080/api/postbacks/pocket?clickid={click_id}&goal=redep&playerid={trader_id}&ow=<POSTBACK_SECRET>&sum={sumdep}
```

Optional Email Confirmation:

```text
http://57.128.213.204:8080/api/postbacks/pocket?clickid={click_id}&goal=email_confirmed&playerid={trader_id}&ow=<POSTBACK_SECRET>
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
- `ow`, `secret`, `token`, or `x-postback-secret` header -> secret when secret mode is enabled

Goal mapping:

- `reg`, `registration` -> `Registration`
- `dep`, `ftd`, `first_deposit` -> `First Deposit`
- `redep`, `redeposit` -> `Re-deposit`
- `email`, `email_confirmed`, `email_confirmation` -> `Email Confirmation`
- `commission` -> `Commission`
- `withdrawal` -> `Withdrawal`
- `successful_withdrawal` -> `Successful Withdrawal`
- `canceled_withdrawal` -> `Canceled Withdrawal`

## Security modes

Default mode is `POCKET_POSTBACK_REQUIRE_SECRET=false`.

In default mode the adapter accepts no-secret Pocket GET postbacks only for known `clickid` values. Unknown `clickid` values are rejected and do not create users or grant progress.

When `POCKET_POSTBACK_REQUIRE_SECRET=true`, the adapter requires the shared `POSTBACK_SECRET` through `ow`, `secret`, `token`, or the `x-postback-secret` header.

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

Expected result:

- known `clickid` events return `{"success":true}`
- duplicate idempotency keys return `{"success":true,"duplicate":true}`
- unknown `clickid` returns `{"success":false,"error":"UNKNOWN_CLICK_ID"}`
- admin/CRM shows `click_id`, `trader_id`, event history, deposit totals, email confirmation, rejected events, and duplicate behavior
