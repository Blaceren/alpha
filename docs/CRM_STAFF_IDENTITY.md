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

## Permissions (exactly eight, canonical order)

`view_exact_financials, view_identity_full_email, reveal_pii, assign_owner, export, view_audit, manage_settings, edit_user_notes`

`effectivePermissions` are always returned in this canonical order.

## Locked role → permission matrix

| Role | Permissions |
|------|-------------|
| crm_admin | all eight |
| crm_manager | all except `manage_settings` (seven) |
| retention_manager | `view_exact_financials, view_identity_full_email, reveal_pii, assign_owner, export, edit_user_notes` (no `view_audit`, no `manage_settings`) |
| mentor | none |
| support | `edit_user_notes` only |
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
- CRM users v1, User 360, notes, owner assignment, owner candidates, audit
  projector, global idempotency, CRM mutation receipts, CRM row-versioning.
- Role management API/UI, permission-override grants.
- OpenAPI generation and generated frontend client.
- Cross-subdomain cookie, PostgreSQL migration, deployed-database migration.
