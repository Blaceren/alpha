# CRM Learner Owner — v1 (current owner + candidates + safe assignment)

Status: backend implemented. Scope: read the current owner, list eligible
candidates, and assign / replace / unassign under optimistic concurrency. No
assignment history table, no history API, no AuditLog write, no reason/comment,
no owner filter on the Users list, no search / workload / round-robin / bulk
assignment, and **no frontend** are part of this slice.

Ownership is **informational only**: it grants no authorization and changes no
Notes, email, financial or learner-visibility rule.

## Runtime compatibility warning

This slice adds backend routes and **migration 32** (`CrmUserOwner`) that the
currently deployed CRM frontend does not use yet. **Migration 32 and matching
CRM Owner frontend support must both ship before the backend is restarted
against a live CRM.** The isolated DEV runtime was deliberately left **stopped**
at the end of this phase, and the runtime database was **not** migrated. See
"Runtime upgrade" below.

## Model

One dedicated current-state model — a mutable singleton keyed by the learner. No
existing relationship (support/mentor dialog assignees, channel staffing,
content/report owners, `AuditLog`) can truthfully represent a learner's single
CRM owner, so none was repurposed.

```prisma
model CrmUserOwner {
  userId    Int      @id
  ownerId   String?
  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user  User          @relation("CrmUserOwnerLearner", fields: [userId],  references: [id], onDelete: Restrict, onUpdate: Cascade)
  owner StaffProfile? @relation("CrmUserOwnerStaff",   fields: [ownerId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([ownerId])
}
```

- `userId` is the **primary key**: a learner has at most one owner-state row.
- `ownerId` is **nullable** and its FK is `Restrict`: an assigned owner cannot be
  deleted out from under a learner, while an unassigned row keeps no dangling
  reference.
- Both FKs are `Restrict`: deleting a learner that has an owner-state row, or a
  StaffProfile that currently owns a learner, **fails loudly** rather than
  silently dropping operational state.
- The owner's display name is resolved **live** through `owner`, never
  snapshotted — a corrected staff name corrects every surface.

### State machine (the important part)

| State | Row | `owner` | `ownerVersion` |
| --- | --- | --- | --- |
| pristine, never mutated | **no row** | `null` | `0` |
| assigned | row, `ownerId` set | identity | `≥ 1` |
| previously mutated, now unassigned | row, `ownerId = null` | `null` | `> 0` |

- **Absence of a row is the pristine state** — owner `null`, version `0`.
- `version` starts at **1** on the first real assignment (when the row is
  created), is **monotonic**, and is **never reset**.
- Unassignment sets `ownerId = null` and **increments** version. **The row is
  never deleted** by Owner v1 — there is no delete path anywhere in the service.
- Exact lifecycle: pristine `null/0` → assign `A/1` → replace `B/2` →
  unassign `null/3` → reassign `A/4`.

## Concurrency

Optimistic, via an integer `ownerVersion`:

- `GET` returns the current `ownerVersion` (`0` when pristine).
- `PUT` sends `expectedVersion`; the backend applies the change only if it
  matches the current version (which is `0` when no row exists).
- A stale `expectedVersion` — including `expectedVersion = 0` after any prior
  assignment or unassignment — returns **409** and writes nothing.
- A successful real change increments the version by exactly 1.
- Setting the **same desired state** with a matching version is a **no-op**: no
  version bump, no `updatedAt` touch, and (for a same-owner no-op) no candidacy
  revalidation — so a current owner who later became blocked stays put.
- Racing writers are conflicts, never lost updates or 500s: the guarded
  `updateMany(where userId + version)` matches zero rows on a lost race
  (→ 409), a concurrent first-create loses the unique-PK race (Prisma `P2002`
  → 409), and a transaction write-conflict (`P2034`) → 409.

## Permissions

No new `CrmPermission`. The canonical set is still exactly ten, and
`assign_owner` is still held only by `crm_admin`, `crm_manager`,
`retention_manager`.

| Operation | Permission required |
| --- | --- |
| `GET` current owner | none beyond a valid StaffProfile (visible to **every** authenticated employee) |
| `GET` owner-candidates | `assign_owner` |
| `PUT` assign / unassign | `assign_owner` |

`assign_owner` is checked purely as a permission — no StaffRole name is branched
on for operation authorization, and `UserRole` grants nothing. Candidate
**eligibility** is a separate domain rule (below), deliberately independent of
`assign_owner`.

### Operation matrices (all nine StaffRoles)

| Role | View owner | List candidates | Assign/Unassign | Eligible as owner |
| --- | --- | --- | --- | --- |
| crm_admin | ✅ | ✅ | ✅ | ❌ |
| crm_manager | ✅ | ✅ | ✅ | ✅ |
| retention_manager | ✅ | ✅ | ✅ | ✅ |
| mentor | ✅ | ❌ | ❌ | ✅ |
| support | ✅ | ❌ | ❌ | ✅ |
| moderator | ✅ | ❌ | ❌ | ❌ |
| analyst | ✅ | ❌ | ❌ | ❌ |
| content_manager | ✅ | ❌ | ❌ | ❌ |
| read_only | ✅ | ❌ | ❌ | ❌ |

Note the deliberate asymmetry: **`crm_admin` may assign but is not an eligible
owner**, while **`mentor` and `support` are eligible owners but cannot assign**.
There is **no self-assignment bypass**: an actor without `assign_owner` cannot
assign anyone (including themselves), and an actor with `assign_owner` may assign
themselves only if their own StaffRole is eligible — so `crm_admin` cannot
self-assign.

## Eligible owner candidates

A candidate must have: a **StaffProfile**, an **active** related `User`, a
StaffRole in exactly `{ crm_manager, retention_manager, mentor, support }`, and a
**nonblank** `displayName`.

- Blocked accounts are excluded and **cannot be newly assigned** (identical 404).
- A previously assigned owner **remains visible** after becoming blocked, and a
  same-owner no-op is still permitted; only a *new* assignment to a blocked
  account is refused.
- A whitespace-only display name is **hidden** from the candidate list; a stored
  owner whose display name is blank **fails closed** (500) on read rather than
  fabricating a label.

## HTTP contract

Every response carries `Cache-Control: no-store` and `X-Request-Id` (echoed in
the error body's `requestId`).

### GET `/api/crm/v1/users/[userId]/owner`

```jsonc
{ "owner": { "employeeId": "…", "displayName": "…" } | null, "ownerVersion": 0 }
```

Learner-only: `role = "user"` is part of the WHERE, so a nonexistent id, a staff
account, an admin, a `news_editor` or any non-learner all return an **identical
404** — the response cannot be used to probe which ids are employees.

### GET `/api/crm/v1/owner-candidates`

Query: `limit` (default 50, 1–100), optional opaque `cursor` (max 512 chars). No
`search`, no `total`, no other keys; unknown or repeated keys are 400. Ordering
is `displayName ASC, employeeId ASC`.

```jsonc
{ "items": [ { "employeeId": "…", "displayName": "…" } ], "nextCursor": "…" | null }
```

The candidate DTO is exactly `employeeId` + `displayName` — never StaffRole,
email, `User.id`, status or permissions.

### PUT `/api/crm/v1/users/[userId]/owner`

```jsonc
// request — strict, exactly two keys, no query parameters
{ "ownerEmployeeId": "…" | null, "expectedVersion": 0 }
// 200 — same shape as GET
{ "owner": { "employeeId": "…", "displayName": "…" } | null, "ownerVersion": 1 }
```

`ownerEmployeeId: null` unassigns. The actor comes only from the session and is
**not** persisted in v1. The body rejects `actor`, `userId`, `role`, `email`,
`reason`, `comment`, `force` and any other field.

`PUT` (not `PATCH`) because the body describes the complete desired end state of
the owner singleton, which is idempotent-replaceable.

### Errors

Envelope: `{ code, messageKey, requestId }` with `code` one of
`invalid_input | unauthorized | not_found | conflict | internal`. Message keys
live under `crm.users.owner.*` and `crm.owner_candidates.*`.

| Status | When |
| --- | --- |
| 400 | malformed userId/employeeId, invalid body/limit/cursor/expectedVersion, unknown/repeated query key, query params on PUT, malformed JSON |
| 401 | missing / malformed / expired / blocked session |
| 403 | authenticated but no StaffProfile, or missing `assign_owner` on candidate list / PUT |
| 404 | learner missing or non-learner; candidate missing / ineligible / blocked (one identical envelope) |
| 409 | stale `expectedVersion`, lost conditional update, or concurrent first-create |
| 500 | safe internal error (no SQL, stack, path, StaffRole, permission or hidden-employee existence) |

## History / audit

Owner v1 stores **current state only**. No assignment-history table, no
`AuditLog` row, no event/notification/task. Writing weakly-typed owner events
into the best-effort `AuditLog` (which swallows failures and keys its actor to a
`User`, not a `StaffProfile`) would be dishonest audit, so it is not done. Proper
typed assignment history — actor, old owner, new owner, timestamp — is a
**deferred** future slice.

## Non-scope

Assignment history (table/API/UI); AuditLog write; new permissions; owner filter
on the Users list; owner search; workload / round-robin / bulk / automatic
assignment; a generic staff directory; per-employee owner routes; any frontend
change; PREPROD / PROD.

## Runtime upgrade (later)

1. Stop backend and CRM (already stopped at the end of this phase).
2. Transactionally safe SQLite backup of the runtime DB.
3. Apply migration 32 (`prisma/migrate.ts`). No reseed — existing StaffProfiles
   are the candidates; every current learner starts **unassigned** (no row).
4. Rebuild the CRM prod `.next` at api origin 3100, ship matching Owner
   frontend, restart.
5. Real smoke: GET pristine owner (`null/0`), list candidates, assign, replace,
   unassign, conflict; verify migration count 32 and zero `CrmUserOwner` rows
   initially.
