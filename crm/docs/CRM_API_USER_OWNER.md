# CRM API — Learner Owner v1 (production)

Status: frontend implemented. Scope: read the current owner, list eligible
candidates, and assign / replace / unassign under optimistic concurrency, inside
the production learner detail at `/users/[userId]`. No history, no AuditLog, no
reason/comment, no owner filter — and no mock fallback.

Ownership is **informational only**: it grants no authorization and changes no
Notes, email, financial or learner-visibility rule in the CRM.

## Backend dependency

This surface requires backend **migration 32**
(`20260721000000_crm_user_owner_foundation`) and the owner routes it introduced.
Until that migration is applied to a given backend database, the owner endpoints
do not exist there.

The isolated DEV runtime is deliberately **left stopped** and un-migrated. Do
not start the real runtime against this CRM build until migration 32 has been
applied there and this CRM slice is deployed together with it.

## Rewrite topology

API mode proxies exactly **six** paths, each listed explicitly in
`next.config.mjs` — never `/api/:path*` and never `/api/crm/v1/:path*`:

1. `/api/crm/v1/session`
2. `/api/crm/v1/users`
3. `/api/crm/v1/users/:userId`
4. `/api/crm/v1/users/:userId/notes`
5. `/api/crm/v1/owner-candidates`
6. `/api/crm/v1/users/:userId/owner`

`:userId` matches exactly one segment and `/owner` is terminal, so
`/api/crm/v1/users/123/owner/history` and `/api/crm/v1/users/123/owner/emp_1`
are **not** proxied and fall through to the CRM app. `owner-candidates` is a
flat static path with no child. GET and PUT share the one owner definition:
Next rewrites are method-agnostic. Mock mode proxies nothing.

The backend origin is server-only (`CRM_BACKEND_ORIGIN`, no `NEXT_PUBLIC_`
prefix). The browser only ever sees relative paths, so the session cookie stays
host-only and no CORS is involved.

## DTOs

The CRM validates every response independently with strict Zod schemas. It does
**not** reuse the mock owner types (`expectedOwnerId`, audit records, idempotency
keys, employee-directory metadata) — those model a richer product with no
backend source.

```
GET /api/crm/v1/users/{userId}/owner            -> { owner: {employeeId, displayName} | null, ownerVersion }
GET /api/crm/v1/owner-candidates?limit=&cursor= -> { items: {employeeId, displayName}[], nextCursor }
PUT /api/crm/v1/users/{userId}/owner            body { ownerEmployeeId: string | null, expectedVersion } -> 200 owner state | 409 conflict
```

An owner and a candidate are **exactly two fields** — `employeeId` and
`displayName`. Any `email`, `userId`, `ownerId`, `StaffRole`, `UserRole`,
`status`, `permissions`, `permissionVersion`, `createdAt`, `updatedAt`,
`history`, `audit` or `reason` fails strict validation and is treated as a
malformed response (nothing renders). `ownerVersion` is a non-negative integer,
never shown to the user.

## Version semantics

- Pristine, never-mutated state: `owner: null`, `ownerVersion: 0`.
- First assignment: version 1. Replacement and unassignment each increment.
- Unassignment keeps a backend row and a **non-zero** version — the frontend
  never resets `ownerVersion` to 0 on unassign.
- `ownerVersion` is never derived locally — only the exact value a validated
  server response carried is retained and sent back as `expectedVersion`.
- Setting the same desired state is a local no-op (Save disabled, no request).
- A stale `expectedVersion` returns **409**; the frontend refetches the current
  owner and requires a fresh explicit selection. It never auto-retries.

## Permissions and visibility

- The current owner GET runs for **every** authenticated StaffProfile — it is
  not gated by `assign_owner`. Visibility is never inferred from a role name.
- The candidate list and the PUT require `effectivePermissions` to contain
  `assign_owner`; the candidate list is not even requested without it.
- Candidate **eligibility** (which staff may be an owner) is a backend rule. The
  frontend never computes it and never filters candidates by role. Per the
  backend contract the eligible roles are `crm_manager`, `retention_manager`,
  `mentor`, `support`; `crm_admin` may assign but is not itself a candidate, and
  `mentor`/`support` are candidates but cannot assign. The frontend renders
  whatever candidates the backend returns.
- No new CRM permission is introduced by this slice.

## UI

`/users/[userId]` renders, in order: identity, progress, the **«Ответственный»**
section, then notes. The owner section shows the current owner's display name or
«Не назначен» — never the employeeId, version, StaffRole, email or status.

With `assign_owner`, an «Изменить ответственного» button opens a native
`<select>` (label «Ответственный», first option «Без ответственного», then each
candidate by display name; the option value stays the exact `employeeId`
string). A state-changing save opens an accessible confirmation dialog (never
`window.confirm`) with distinct assign/unassign copy. There is **no optimistic
update**: the owner is re-rendered only from the validated server response.

## Errors

The HTTP status is authoritative. `403` (candidate or mutation) withdraws the
controls and keeps the current owner visible. A current-owner `404` or a
mutation learner-`404` replaces the whole detail with «Пользователь не найден»;
a mutation candidate-`404` (distinguished by the stable messageKey, never
rendered) keeps the detail and reports «Сотрудник недоступен для назначения». A
`401` redirects to `/login?reason=session_required`. A `500`/network/malformed
owner read keeps identity/progress/notes and shows an owner-only retry. `409`
follows the refetch flow above. `messageKey` is never rendered as user copy.

## Not in this slice

Owner history (table/API/UI), AuditLog, reason/comment, owner filter on the
Users list, a searchable combobox, a generic staff directory, and any change to
the mock owner UI. No authorization is inherited from ownership.

Full backend contract: `alfa-trade-academy-v2/docs/CRM_USER_OWNER_V1.md`.
Requires backend migration 32.
