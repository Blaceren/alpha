# CRM Users v1 — cursor users list

Status: implemented. Scope: one read-only endpoint. No User 360, notes, owner
assignment, owner candidates, audit adapter, mutations, idempotency, team scopes
or export are part of this slice.

The list carries a minimal current-owner projection and an `owner` state filter
(`all` / `mine` / `unassigned`) — see [Owner projection](#owner-projection) and
[Owner filter](#owner-filter). That extension added **no** Prisma schema change
and **no** migration: it reads the existing `CrmUserOwner` model shipped by
migration 32, so the migration count stays **32**. There is no new route and no
new Next rewrite; the owner filter is a query parameter on the existing
`/api/crm/v1/users` path.

> **Runtime compatibility.** The matching CRM frontend does not yet understand
> the expanded strict item DTO (it will reject the extra `owner` key as a
> malformed response). The isolated DEV runtime must remain **stopped** and the
> runtime database **un-migrated/unmutated** until the CRM Owner-column frontend
> slice ships.

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
| `owner` | enum | optional, one of `all` \| `mine` \| `unassigned`. Omission means `all`; explicit `all` is equivalent. Matched exactly — no trim, no case-folding. See [Owner filter](#owner-filter). |

Filters and sort parameters from the CRM mock (`status`, `sort`, `segmentId`,
`ownerId`, `page`, `offset`, …) are deliberately **not** implemented and are
rejected. In particular a raw `ownerId`/`ownerEmployeeId` is an **unknown key**
(`400 crm.users.unknown_query_key`): the list never accepts a client-supplied
employee id.

### Repeated query keys

Every known key (`limit`, `cursor`, `search`, `owner`) may appear **at most
once**. A repeated key — identical values, differing values or repeated empty
values alike — is `400 invalid_input` with `messageKey`
`crm.users.repeated_query_key`, rejected **before** any duplicate value is read.
This is not first-wins, last-wins or value-joining: `URLSearchParams.get()`
would silently take only the first value, letting a client believe a second
`owner=`/`search=` applied when it was dropped, so the request is refused
instead. Unknown keys keep their existing `crm.users.unknown_query_key`
behaviour.

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
      "createdAt": "2026-01-04T09:15:00.000Z",
      "owner": { "displayName": "Мария Куратор" }   // or null
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

## Owner projection

Each item carries the learner's **current** CRM owner as `owner`, or `null`:

```jsonc
"owner": { "displayName": "…" } | null
```

- The object is **strict** and contains **exactly** `displayName` — the live
  `StaffProfile.displayName`, resolved through the relation and **never**
  snapshotted, so a corrected staff name corrects every list row.
- `owner` is `null` for **both** the pristine state (no `CrmUserOwner` row) and a
  persisted row whose `ownerId` is `null` (previously assigned, then unassigned).
  The list **does not distinguish** these — both are simply "no current owner".
- A **blocked** or **role-ineligible** current owner **remains visible**: the
  projection is not filtered by owner status or eligible role.
- A blank/unusable live `displayName` **fails closed** with the endpoint's safe
  `500 crm.users.internal`. It is never rendered as `null` and never fabricated
  into a placeholder (there is no «Неизвестный сотрудник»); the Russian
  «Не назначен» label for a `null` owner belongs to the frontend, not this DTO.

The owner object deliberately carries **no** owner `employeeId`, internal
`ownerId`, `ownerVersion`, `StaffRole`, email, status, assignment timestamp,
history or permission. Visibility requires only a valid `StaffProfile`; there is
no `assign_owner` (or any other) permission gate on **seeing** the owner — it
matches the Owner-detail read, which every authenticated employee may perform.

## Owner filter

`owner` filters the list by current-ownership state. All nine StaffRoles may use
every value; `assign_owner` grants **no** additional list-filter capability, and
no StaffRole name is ever branched on for list authorization.

| Value | Meaning | Predicate |
| --- | --- | --- |
| `all` (default / omitted) | no owner constraint | — |
| `mine` | learners whose current owner is the **authenticated** StaffProfile | `crmOwnerState.is.ownerId = session StaffProfile.id` |
| `unassigned` | learners with **no owner** | `crmOwnerState.is = null` **OR** `crmOwnerState.is.ownerId = null` |

- **`mine`** resolves the actor from the **session** (`StaffProfile.id`) only.
  The client cannot supply an employee id anywhere — `owner=<id>` is a `400
  invalid_input`, and `ownerId`/`ownerEmployeeId` are unknown keys. A valid
  StaffProfile owning zero learners gets `items: []`; a blocked session is still
  `401` at authentication, before the query runs; an actor without a
  StaffProfile is still `403`. `mine` is **not** filtered by the owner's own
  status/role, so a staff member keeps seeing their book even if their profile
  later becomes role-ineligible.
- **`unassigned`** is deliberately the union of the rowless and persisted-null
  states — matching only "no row" would silently drop every learner unassigned
  *after* a prior assignment.
- **`assigned`** and **specific-owner** filtering are **not** supported in this
  slice.
- Any other value — empty, mixed case (`All`, `MINE`), an alias (`me`,
  `assigned`), a boolean (`true`), a comma list (`mine,all`), JSON, or an
  employee id — is `400 invalid_input` with `messageKey`
  `crm.users.owner_filter_invalid`. No accepted owner value ever produces a
  `403` for an actor with a valid StaffProfile.

The owner filter is applied in the `WHERE` **before** keyset pagination and
composes with `search` by `AND`; it never affects the email projection. It is a
single `prisma.user.findMany` with the owner relation projected inline — no N+1,
no second owner query.

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

The cursor is **not** bound to `search` or `owner` — it carries only the position
tuple, and the backend accepts a structurally valid cursor regardless of the
current search or owner value. Keeping it position-only is deliberate: the
ordering key `(createdAt, id)` is filter-independent, so no fingerprint is
needed. The **client** is responsible for resetting its pagination (clearing the
cursor / returning to the first page) whenever `search` or `owner` changes;
reusing a stale cursor across a filter change is a client bug, not a backend
guarantee.

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
| `400` | invalid query, malformed/tampered cursor, unknown query key, **repeated known key** (`crm.users.repeated_query_key`), **unsupported `owner` value** (`crm.users.owner_filter_invalid`), unauthorized email search |
| `401` | no session, invalid signature, expired session, blocked or missing account |
| `403` | authenticated but no usable `StaffProfile` (no accepted `owner` value ever causes a `403`) |
| `500` | safe internal error, incl. a blank/unusable current-owner display name (`crm.users.internal`) |

`401` and `403` share `code: "unauthorized"` with distinct `messageKey`s, matching
the session endpoint, so the response never discloses whether some other
account's `StaffProfile` exists. No Prisma error, SQL, stack trace, cursor
decoder detail, raw Zod issue, filesystem path or database URL is ever exposed.

## Which roles may read this

All nine staff roles may read the basic list. There is no `view_users`
permission and none was invented. Roles differ only in the **email projection**,
not in access. The same holds for the owner projection and every `owner` filter
value (`all`/`mine`/`unassigned`): all nine roles may see the owner and use every
filter, and `assign_owner` grants no extra list capability.

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
| `ownerId` / owner `employeeId` | The current owner IS projected now, but as `owner.displayName` only — the internal `ownerId`/`employeeId`, `ownerVersion`, StaffRole, email and status are never exposed. See [Owner projection](#owner-projection). |
| note counts, unread counts | Not projected on the list (a `CrmUserNote` model exists, but list-level counts are out of this slice's scope). |
| `valueSegments`, `blockers`, `priority`, `topRecommendationCode`, task/case/signal counts | No backing models. |
| `xp` | Available on `User` but not needed by the list; excluded to keep v1 minimal. |

## Frontend adapter notes

- The production Users v1 DTO is **smaller** than the mock `UserSummary`. The CRM
  API adapter must map what exists — now including `owner` (`displayName` only,
  or `null`) — and leave the rest genuinely unpopulated: it must not synthesize
  note counts, buckets or lifecycle stages to fill mock-shaped columns, and must
  not invent an owner `employeeId` the DTO does not carry.
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

npm run test:regression:crm-users             # 90 checks
npm run test:regression:crm-session           # 20 checks
npm run test:regression:crm-staff-identity    # 21 checks

npm run build
npm run test:regression:curriculum-phase5     # cumulative gate
```

The CRM users regression runs a real `next dev` server against a throwaway
`/tmp` SQLite database created from the 32 committed migrations. It touches no
deployed, production or preprod database, and starts no persistent service.
