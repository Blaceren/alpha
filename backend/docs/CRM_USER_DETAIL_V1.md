# CRM User Detail v1 — learner account detail foundation

Status: implemented. **This is not a complete User 360.** It is a learner
account detail *foundation* carrying only canonical `User` columns. No CRM
notes, owner assignment, owner candidates, audit, tasks, cases, signals,
recommendations, communications, broker data, financials, lifecycle/funding/
engagement derivations, last activity, employee assignment, team scope or
mutations are part of this slice. No Prisma schema change and no migration were
required — the migration count stays 30.

## Endpoint

```
GET /api/crm/v1/users/[userId]
```

Authentication reuses the accepted CRM session resolver (`src/lib/crm/session.ts`)
and therefore the existing signed auth cookie. There is no second cookie, token
parser or auth path. Field projection uses that session's server-computed
`effectivePermissions`, derived from `StaffProfile.staffRole` — never `UserRole`,
never a cookie claim, never anything the request supplied.

Every response — success and error — carries:

```
Cache-Control: no-store
X-Request-Id: <uuid>
```

For errors the `requestId` in the body and the `X-Request-Id` header are the
same value.

## Path parameter

`userId` comes **only** from the route path. The endpoint accepts **no query
parameters at all** — any query key is `400 invalid_input`, so a caller can
never believe an `include`, `expand`, `fields` or `select` applied.

Accepted form: a canonical positive decimal integer.

```
^[1-9][0-9]{0,9}$      then   1 <= value <= 2147483647   (Prisma/SQLite Int)
```

Rejected with `400 invalid_input`: empty, `0`, `-1`, `+1`, `01`, `007`, `1.5`,
`1e3`, `NaN`, `Infinity`, whitespace, `mock_user_1`, `emp_backend_001`,
`usr_mock_017`, `0x10`, `1n`, `1,2`, and any value above the Int range. The
digit bound stops a hostile segment before `Number()`; the range check then
rejects anything the `Int` column could never hold.

An `employeeId` (a cuid) and a users-list cursor are both rejected by the same
pattern — neither is a learner id.

## Success DTO

```jsonc
{
  "userId": "1042",                       // opaque; see below
  "displayName": "Target Learner",
  "email": { "value": "l***@e***.test", "visibility": "masked" },
  "status": "active",                     // "active" | "blocked"
  "level": 7,
  "xp": 4242,
  "emailConfirmed": true,
  "createdAt": "2026-01-01T12:00:00.000Z"
}
```

All example values are synthetic. The response is validated against a strict Zod
schema (`crmUserDetailResponseSchema`, `.strict()` at every level) before
serialization, so an extra key fails here rather than reaching a client.

### `userId` opacity

`userId` is `User.id` serialized as a decimal string, exactly as in Users v1.
Clients **must treat it as opaque**: do not parse it, do not do arithmetic on
it, do not assume it stays numeric. It is not `employeeId` — that is
`StaffProfile.id` (a cuid) on the staff axis.

### `displayName`

`User.name` when non-blank after trim, otherwise the honest fallback
`Пользователь`. The email is **never** used as a display-name fallback, because
that would disclose identity to a role that may only see a masked address.

### `xp` semantics

`xp` is `User.xp`, the learner's cumulative experience total. It is declared
nonnegative in the schema because that is a **proven backend invariant**, not an
assumption:

| Path | Guarantee |
| --- | --- |
| Column | `User.xp Int @default(0)` — starts at 0 |
| Decrements | **No code path decrements `xp`.** The only `decrement` in the codebase is `ExchangeAccount.balance`. |
| Task completion | `nextXp = user.xp + task.xpReward`, and `Task.xpReward Int @default(0)` is validated `min(0)` / `nonNegativeInt` on every write path → monotonically nondecreasing |
| Promocode award | `xpReward()` hard-fails `PROMOCODE_STATE_CORRUPT` unless `1 <= value.xp <= MAX_XP_REWARD` |
| Referral award | `ReferralBonusConfig.inviterXp @default(100)`, `invitedXp @default(50)`; no write path exists |
| Admin update | `adminUserUpdateSchema` validates `xp: z.number().int().min(0)` |

`level` keeps the same plain-integer shape as the accepted Users v1 contract so
the two endpoints stay adapter-compatible.

## Learner-only boundary and 404 semantics

The query is a single `findFirst` with `role: "user"` **in the WHERE clause**,
preserving the accepted Users v1 learner boundary.

| Case | Result |
| --- | --- |
| existing learner | `200` |
| unknown id | `404` |
| existing staff account | `404` |
| existing system/non-learner account (`admin`, `support`, `news_editor`, …) | `404` |

All four misses return **one identical envelope**:

```jsonc
{ "code": "not_found",
  "messageKey": "crm.users.detail.not_found",
  "requestId": "…" }
```

Because the role predicate is part of the query rather than a post-filter, a
staff or system id produces exactly the same empty result as a nonexistent id.
The 404 therefore cannot be used to probe which ids belong to employees, and the
body carries no account type, role, email or existence hint.

## Authorization

| Status | When |
| --- | --- |
| `401` | no session, invalid signature, expired session, blocked or missing authenticated account |
| `403` | authenticated but no usable `StaffProfile` |
| `200`/`404` | authenticated staff with a valid `StaffProfile` |

All nine StaffRoles may read the detail foundation. There is no `view_user_detail`
permission and none was invented. Roles differ only in the **email projection**,
not in access. `UserRole` is never interpreted as a `StaffRole`.

## Email projection

Reuses the accepted Users v1 `maskEmail` implementation — there is exactly one
masking algorithm in the CRM surface, not two.

| Permission | Result |
| --- | --- |
| `view_identity_full_email` present | `{ "value": "lena@example.test", "visibility": "full" }` |
| absent | `{ "value": "l***@e***.test", "visibility": "masked" }` |

There is no second field carrying the unmasked value, and the full address
appears nowhere in an unauthorized response. This endpoint has no cursor, so no
email can enter one. No email appears in error bodies, in `requestId`, or in the
route parameter. `reveal_pii` does **not** alter the projection; a regression
fails if the matrix ever grants `reveal_pii` without `view_identity_full_email`.

## Explicit Prisma select

One query, eight columns:

```
id, name, email, status, level, xp, emailVerifiedAt, createdAt
```

`role` is deliberately **not** selected — the learner predicate lives in `where`,
so the internal `UserRole` is never even loaded, let alone serialized. Not
selected and therefore unreachable: `passwordHash`, `pendingEmail`,
`referralCode`, tokens, `updatedAt`, `currentTask`, `leaderboardExcluded`,
`selectedAchievementId`, `ExchangeAccount`, `StaffProfile`, reports, progress
relations, achievements and every other relation. No `include:` is used, so
there is no N+1.

The row is mapped through an explicit projector; a Prisma record is never spread
into the response.

## Error envelope

```jsonc
{ "code": "invalid_input" | "unauthorized" | "not_found" | "internal",
  "messageKey": "crm.users.detail.not_found",
  "requestId": "…" }
```

| Status | When |
| --- | --- |
| `400` | malformed `userId`, unknown query key |
| `401` | unauthenticated / invalid / expired / blocked |
| `403` | authenticated but not CRM staff |
| `404` | learner not found — and every non-learner account behind the same result |
| `500` | safe internal error |

No Prisma error, SQL, stack trace, raw Zod issue, filesystem path, database URL
or internal `UserRole` is ever exposed.

## Deliberately omitted

These are absent because the backend has **no truthful source** for them, or
because they are internal. They are not stubbed, defaulted or null-filled to
preserve the mock User 360 layout:

| Concept | Why omitted |
| --- | --- |
| last activity | **No canonical field exists.** `User.updatedAt` is a row-mutation timestamp, not user activity — presenting it as activity would be a lie, so it is not even selected. |
| `currentTask` | Free-text progression breadcrumb, not a stable contract; not needed by the detail foundation. |
| `selectedAchievementId`, achievements | Cosmetic learner-facing display choice; no CRM need. |
| `leaderboardExcluded` | Internal moderation/leaderboard control — not exposed merely because it exists. |
| `ExchangeAccount` (balance, deposits, withdrawals, P/L, traderId) | Broker-sourced financial data, out of scope. |
| owner / primary owner | Owner is a **separate** endpoint, not part of the detail DTO. See `docs/CRM_USER_OWNER_V1.md` (`GET/PUT /api/crm/v1/users/[userId]/owner`). |
| notes, note counts | **No CRM notes model exists.** |
| lifecycle / funding / engagement, priority, recommendations, timeline, tasks, cases, signals | Mock-side derivations and aggregates with no backend source. |
| `employeeId`, `UserRole`, `StaffRole`, permissions | Staff axis; never mixed into learner data. |
| `passwordHash`, `pendingEmail`, `referralCode`, tokens | Security fields. |

## Frontend adapter notes

- The CRM already defers `/users/[id]` in api mode. This endpoint is the future
  data source for that route; **the frontend was not changed in this slice.**
- The DTO is much smaller than the mock `User360` aggregate. The adapter must
  map what exists and leave the rest genuinely unpopulated — it must not
  synthesize placeholder owners, note counts, buckets, lifecycle stages or a
  last-activity timestamp to fill mock-shaped panels.
- `email.visibility` tells the UI whether it received a real address. Render
  `email.value` as-is; never attempt to unmask.
- A `404` must render as "learner not found" and must **not** be interpreted as
  "this is a staff account" — the API deliberately cannot distinguish them.

## Verification

```bash
export PATH="/home/ubuntu/workspaces/.tooling/node/bin:$PATH"

DATABASE_URL="file:/tmp/validate.db" npx prisma validate
npx tsc --noEmit
npm run lint

npm run test:regression:crm-user-detail       # 44 checks
npm run test:regression:crm-users             # 50 checks
npm run test:regression:crm-session           # 20 checks
npm run test:regression:crm-staff-identity    # 21 checks

npm run build
npm run test:regression:curriculum-phase5     # cumulative gate
```

The regression runs a real `next dev` server against a throwaway `/tmp` SQLite
database created from the 30 committed migrations, and removes it afterwards. It
touches no deployed, production or preprod database and starts no persistent
service.

## Rollback

- Before commit — targeted `git restore` of the phase-owned paths.
- After commit — `git revert` of the single reviewed commit.
- Backups: `/home/ubuntu/backups/ata-backend/2026-07-20-7a62cbf/` (current
  accepted HEAD), earlier `2026-07-20-a9625f4/`.

No dependency changed and `package-lock.json` is byte-identical, so `npm ci` is
not required for rollback. Destructive operations (`git reset --hard`,
`git clean`) are not used.
