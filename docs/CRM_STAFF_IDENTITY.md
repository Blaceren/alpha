# CRM Staff Identity — Foundation Slice 1

Status: implemented. Scope: identity + permission foundation only. No CRM users
list, User 360, notes, owner assignment, audit projector, idempotency,
concurrency, teams, or scopes are part of this slice.

## User vs StaffProfile

`User` stays the single auth account and the learner/admin identity. It is not
modified by this slice. CRM employee identity lives in a separate `StaffProfile`
row linked 1:1 to a `User` (`StaffProfile.userId` is unique, `onDelete: Cascade`).

- `StaffProfile.id` is the production **employeeId** (an opaque `cuid`). It is
  deliberately **not** `User.id`, so CRM identity never leaks the learner id.
- A `User` without a `StaffProfile` is not a CRM employee.
- `effectivePermissions` are **never stored**; the server computes them from
  `staffRole` on every request.

## UserRole vs StaffRole (two separate axes)

`UserRole` (unchanged): `user, admin, support, mentor, moderator, news_editor`.
It continues to drive existing learner/admin routes.

`StaffRole` (new, separate enum — never derived from `UserRole`), exactly nine:

`crm_admin, crm_manager, retention_manager, mentor, support, moderator, analyst, content_manager, read_only`

CRM authorization uses **StaffRole only**. A user's `UserRole` never grants CRM
permissions — e.g. a `UserRole.admin` with `StaffRole.read_only` gets zero CRM
permissions, and a `UserRole.support` with `StaffRole.crm_manager` gets the full
crm_manager matrix. StaffProfile is the CRM source of truth.

## Permissions (exactly ten, canonical order)

`view_exact_financials, view_identity_full_email, reveal_pii, assign_owner, export, view_audit, manage_settings, edit_user_notes, view_user_notes, create_user_notes`

`effectivePermissions` are always returned in this canonical order.

The first eight are the Slice 1 contract and keep their exact relative order.
`view_user_notes` and `create_user_notes` were appended by CRM User Notes v1
(see `docs/CRM_USER_NOTES_V1.md`). `edit_user_notes` is **not** used for reading
or creating a note — it stays reserved for future mutating operations on an
existing note (edit, delete, pin/unpin, visibility).

## Locked role → permission matrix

| Role | Permissions |
|------|-------------|
| crm_admin | all ten |
| crm_manager | all except `manage_settings` (nine) |
| retention_manager | `view_exact_financials, view_identity_full_email, reveal_pii, assign_owner, export, edit_user_notes, view_user_notes, create_user_notes` (no `view_audit`, no `manage_settings`) |
| mentor | none — an explicit Notes v1 decision, see `docs/CRM_USER_NOTES_V1.md` |
| support | `edit_user_notes, view_user_notes, create_user_notes` |
| moderator | none |
| analyst | none |
| content_manager | none |
| read_only | none |

This matrix is a fixed product contract. It is duplicated in a regression test
and is not widened by intuition. Source of truth: `src/lib/crm/roles.ts`
(`STAFF_ROLE_PERMISSIONS`, `resolveEffectivePermissions`). The Prisma enum, the
canonical TypeScript `CRM_STAFF_ROLES`, and the Zod `staffRoleSchema` are kept
in lockstep by a drift-check regression; unknown roles fail closed (no
permissions).

## permissionVersion

Integer, default `1`, always `> 0`. The session returns the current stored DB
value. It is not derived from time and is not `User.updatedAt`. It is intended
to increase when a staff role or explicit grants change in a future slice. There
is no mutation/update API in Slice 1 (no explicit-grant table, no overrides).

CRM User Notes v1 deliberately did **not** increment it. That slice changed the
role -> permission table for every employee rather than one employee's grants,
which no client can act on per-employee, so all stored values remain `1` and no
migration touches `StaffProfile` rows.

## CRM session contract

`GET /api/crm/v1/session` — reuses the existing signed auth cookie (no second
cookie or token). Success `200` body:

```
{
  employeeId: string,            // StaffProfile.id
  displayName: string,           // StaffProfile.displayName
  role: StaffRole,               // from StaffProfile.staffRole
  effectivePermissions: CrmPermission[],  // server-computed, canonical order
  permissionVersion: number,     // > 0
  expiresAt: string              // ISO, from the real session expiry
}
```

`Cache-Control: no-store`. The response never includes `User.id`, email,
`UserRole`, level, xp, status, password/token/cookie, avatar, or DB internals.

The frontend uses `effectivePermissions` for UI affordances only. The backend
remains the sole source of authorization; every future CRM endpoint must
re-check permissions and resource rules server-side.

## 401 vs 403

- **401** — no session, invalid signature, expired session, or a
  blocked/revoked/missing account (existing auth semantics).
- **403** — authenticated, but the account has no usable `StaffProfile` (not a
  CRM employee).

Both use the client-facing code `unauthorized` but distinct `messageKey`s. The
error envelope is `{ code, messageKey, requestId }`. Raw exceptions are never
returned, and the response never reveals whether another user's StaffProfile
exists.

## Host-only cookie limitation

The existing auth cookie is host-only; `sameSite`/`secure`/domain policy is
unchanged in this slice. `GET /api/crm/v1/session` therefore works only where
the current auth cookie is available (same origin). A dedicated `crm.*`
subdomain would require a separate cookie-domain decision later. This does not
block same-origin DEV route testing, and cross-subdomain auth is **not**
presented as ready.

## Deferred / out of scope

- Resource/ownership rules (private note author-only visibility and edit/delete,
  admin does not bypass private-note privacy, pin/unpin requires
  `edit_user_notes` + note visibility, owner-eligibility checks). Role
  permissions do **not** replace these identity/resource checks.
- `own/team/all` scope and any team/department model.
- `role_restricted` note visibility.
- User 360, audit projector, global idempotency, CRM mutation receipts. (CRM
  users v1, immutable append-only learner notes, and the CRM learner owner
  foundation — current owner, eligible candidates, safe assignment with
  per-row `ownerVersion` concurrency — have since shipped. See
  `docs/CRM_USERS_V1.md`, `docs/CRM_USER_DETAIL_V1.md`,
  `docs/CRM_USER_NOTES_V1.md` and `docs/CRM_USER_OWNER_V1.md`. `assign_owner` is
  now enforced by the owner endpoints.)
- Role management API/UI, permission-override grants.
- OpenAPI generation and generated frontend client.
- Cross-subdomain cookie, PostgreSQL migration, deployed-database migration.
