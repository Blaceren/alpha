# CRM Users v1 — cursor users list

Status: implemented. Scope: one read-only endpoint. No User 360, notes, owner
assignment, owner candidates, audit adapter, mutations, idempotency, team scopes
or export are part of this slice. No Prisma schema change and no migration were
required — the migration count stays 30.

## Endpoint

```
GET /api/crm/v1/users
```

Authentication reuses the accepted CRM session resolver (`src/lib/crm/session.ts`)
and therefore the existing signed auth cookie. There is no second cookie, token
parser or auth path. Field projection uses the session's server-computed
`effectivePermissions`, derived from `StaffProfile.staffRole` — never `UserRole`,
never a cookie claim, never anything the request supplied.

Every response — success and error — carries:

```
Cache-Control: no-store
X-Request-Id: <uuid>
```

## Query parameters

Validation is strict. Any key other than the three below is a `400 invalid_input`
rather than being silently ignored, so a client cannot believe a filter applied
when it did not.

| Key | Type | Rules |
| --- | --- | --- |
| `limit` | integer | optional, default `25`, min `1`, max `100`. Rejects `0`, negatives, fractions, `1e2`, `0x10` and non-numerics. |
| `cursor` | opaque string | optional, max 512 chars. Malformed, tampered or wrong-version values are `400 invalid_input`. Never interpreted as an offset. |
| `search` | string | optional, trimmed, max 100 chars after trim. Empty-after-trim is treated exactly as absent. |

Filters and sort parameters from the CRM mock (`status`, `sort`, `segmentId`,
`ownerId`, `page`, `offset`, …) are deliberately **not** implemented and are
rejected.

## Success DTO

```jsonc
{
  "items": [
    {
      "userId": "1042",                       // opaque; see below
      "displayName": "Lee Learner",
      "email": { "value": "l***@e***.test", "visibility": "masked" },
      "status": "active",                     // "active" | "blocked"
      "level": 7,
      "emailConfirmed": true,
      "createdAt": "2026-01-04T09:15:00.000Z"
    }
  ],
  "nextCursor": "eyJ2IjoxLCJ0IjoiMjAyNi0wMS0wNFQwOToxNTowMC4wMDBaIiwiaSI6MTA0Mn0"
}
```

All example values are synthetic. The response is validated against a strict Zod
schema (`crmUsersResponseSchema`) before serialization, so an extra key fails
here rather than reaching a client.

### `userId` opacity

`userId` is `User.id` serialized as a decimal string. Clients **must treat it as
opaque**: do not parse it, do not do arithmetic on it, do not assume it stays
numeric. It is deliberately not named `employeeId` — that is `StaffProfile.id`
(a cuid) and belongs to the staff axis, not the learner axis. The request cannot
supply or override it.

### `displayName`

`User.name` when non-blank after trim, otherwise the honest fallback
`Пользователь`. The email is **never** used as a display-name fallback, because
that would disclose identity to a role that may only see a masked address.

## Email projection

Controlled by `view_identity_full_email` (held by `crm_admin`, `crm_manager`,
`retention_manager`).

| Permission | Result |
| --- | --- |
| present | `{ "value": "lee@example.test", "visibility": "full" }` |
| absent | `{ "value": "l***@e***.test", "visibility": "masked" }` |

There is no second field carrying the unmasked value, and the full address
appears nowhere in an unauthorized response body. Masking is deterministic —
the same input always masks identically, so it never becomes a partial oracle:

```
nina.chmiel@example.test -> n***@e***.test
a@b.co                   -> a***@b***.co
x@nodot                  -> x***@***
no-at-sign               -> ***
```

`reveal_pii` does **not** grant full email. The projection keys off
`view_identity_full_email` specifically. A regression asserts that no role holds
`reveal_pii` without also holding `view_identity_full_email`; if the matrix ever
changes, that test fails and the rule must be re-reviewed rather than silently
inherited. This endpoint returns no phone, address or other PII regardless.

## Search semantics

- Display-name search is available to **all** nine staff roles.
- Email search requires `view_identity_full_email`.
- Without that permission an **email-shaped query (containing `@`) is rejected**
  with `400 invalid_input`, rather than being silently downgraded to a name
  search. Silent downgrade would still let an employee probe which addresses
  exist through result presence; refusing is the honest behaviour and the
  refusal never confirms or denies that the address exists.

Defined behaviour:

| Aspect | Behaviour |
| --- | --- |
| Case | Case-insensitive for ASCII (SQLite `LIKE` semantics via Prisma `contains`). Non-ASCII (e.g. Cyrillic) is case-sensitive — a SQLite limitation, documented rather than papered over. |
| Whitespace | Trimmed. Empty-after-trim behaves exactly as absent. |
| Unicode | Passed through unchanged; matched as a substring. |
| Max length | 100 characters after trim; longer is `400 invalid_input`. Exactly 100 is accepted. |
| No match | `200` with `items: []` and `nextCursor: null`. |

No fuzzy matching, ranking, or external search service.

## Cursor pagination

Stable keyset pagination — never `OFFSET`.

Ordering is fixed:

```
createdAt DESC, id DESC
```

Both columns are stable for a given row, so a page boundary cannot drift the way
an offset would, and `id` breaks ties when two accounts share a `createdAt`.

The cursor payload is versioned, base64url-encoded, and contains **only** the
pagination tuple:

```jsonc
{ "v": 1, "t": "2026-01-04T09:15:00.000Z", "i": 1042 }
```

No email, name, role, permission or session material. It is not cryptographically
signed and does not need to be: it grants no authorization, so tampering can only
produce a different position or a `400`.

Paging uses `take: limit + 1`. At most `limit` items are returned; if an extra
row existed, `nextCursor` is built from the last returned item, otherwise it is
`null`. A cursor can never increase the requested `limit`.

## Error envelope

```jsonc
{ "code": "invalid_input" | "unauthorized" | "internal",
  "messageKey": "crm.users.cursor_invalid",
  "requestId": "…" }
```

| Status | When |
| --- | --- |
| `400` | invalid query, malformed/tampered cursor, unknown query key, unauthorized email search |
| `401` | no session, invalid signature, expired session, blocked or missing account |
| `403` | authenticated but no usable `StaffProfile` |
| `500` | safe internal error |

`401` and `403` share `code: "unauthorized"` with distinct `messageKey`s, matching
the session endpoint, so the response never discloses whether some other
account's `StaffProfile` exists. No Prisma error, SQL, stack trace, cursor
decoder detail, raw Zod issue, filesystem path or database URL is ever exposed.

## Which roles may read this

All nine staff roles may read the basic list. There is no `view_users`
permission and none was invented. Roles differ only in the **email projection**,
not in access.

## Which accounts are listed

Only learner accounts (`User.role = "user"`). This mirrors the existing accepted
CRM users surface (`/api/crm/users`), which already scopes the CRM to that set.
`UserRole` is used here purely as a listing filter — it is never read as a
`StaffRole` and never grants anything.

## Deliberately omitted fields

These are absent because the backend has **no truthful source** for them. They
are not stubbed, defaulted or null-filled to imitate the mock shape:

| CRM mock field | Why omitted |
| --- | --- |
| `lastMeaningfulActionAt` | No canonical activity field. `User.updatedAt` is a row-mutation timestamp, not a meaningful user action — returning it would be a lie. |
| `lifecycleStage`, `fundingStatus`, `engagementStatus` | Mock-side derivation layer with no server-side equivalent. |
| `registrationStatus` | Lives in `ExchangeAccount` (Pocket affiliate / broker sync), out of scope. |
| `balance`, `netDeposits`, `redepositCount`, any bucket | Broker-sourced financial data. No canonical list-level financial summary exists. |
| `ownerId` / primary owner | **No CRM owner model exists.** |
| note counts, unread counts | **No CRM notes model exists.** |
| `valueSegments`, `blockers`, `priority`, `topRecommendationCode`, task/case/signal counts | No backing models. |
| `xp` | Available on `User` but not needed by the list; excluded to keep v1 minimal. |

## Frontend adapter notes

- The production Users v1 DTO is **smaller** than the mock `UserSummary`. The CRM
  API adapter must map what exists and leave the rest genuinely unpopulated —
  it must not synthesize placeholder owners, note counts, buckets or lifecycle
  stages to fill mock-shaped columns.
- In particular the mock financial column must **not** be rendered in API mode:
  there is no production financial projection in this slice, and the mock
  `$50–99` style buckets are fixture values that must never reach a production
  screen.
- `nextCursor` maps to the CRM `PageParams.cursor`; `null` means the end.
- `email.visibility` tells the UI whether it received a real address. The UI
  should render `email.value` as-is and must not attempt to unmask.

## Verification

```bash
export PATH="/home/ubuntu/workspaces/.tooling/node/bin:$PATH"

DATABASE_URL="file:/tmp/validate.db" npx prisma validate
npx tsc --noEmit
npm run lint

npm run test:regression:crm-users             # 50 checks
npm run test:regression:crm-session           # 20 checks
npm run test:regression:crm-staff-identity    # 21 checks

npm run build
npm run test:regression:curriculum-phase5     # cumulative gate
```

The CRM users regression runs a real `next dev` server against a throwaway
`/tmp` SQLite database created from the 30 committed migrations. It touches no
deployed, production or preprod database, and starts no persistent service.
