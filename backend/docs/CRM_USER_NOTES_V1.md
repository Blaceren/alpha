# CRM User Notes — v1 (immutable append-only)

Status: implemented. Scope: learner notes list + create only. No edit, delete,
pin, visibility, category, attachments, mentions, owner, team, search, bulk,
audit API or frontend Notes UI is part of this slice.

## Runtime compatibility warning

This slice adds two new `effectivePermissions` values that the currently
deployed CRM frontend does not recognize. **The CRM frontend must be upgraded
to the matching permission schema before the backend is restarted against a
live CRM.** The isolated DEV runtime was deliberately left stopped at the end of
this phase for exactly this reason, and the runtime database was **not**
migrated. See "Runtime upgrade" below.

## Model

One dedicated model. No existing model was repurposed: learner reports, mentor
feedback, support messages, curriculum comments and `AuditLog` all carry
different semantics, and several are learner-visible.

```prisma
model CrmUserNote {
  id        String   @id @default(cuid())
  userId    Int
  authorId  String
  body      String
  createdAt DateTime @default(now())

  user   User         @relation("CrmUserNoteTarget", fields: [userId],   references: [id], onDelete: Restrict, onUpdate: Cascade)
  author StaffProfile @relation("CrmUserNoteAuthor", fields: [authorId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([userId, createdAt, id])
  @@index([authorId])
}
```

Back-relations: `User.crmUserNotes` and `StaffProfile.authoredCrmUserNotes`.

There is deliberately **no** `updatedAt`, `deletedAt`, `editedAt`, `deletedBy`,
`version`, `visibility`, `pinned`, category, `caseId`, owner, team, external
reference, author display-name snapshot or `AuditLog` relation.

`@@index([userId, createdAt, id])` is exactly the keyset the list query walks.

## Migration 31

`prisma/migrations/20260720000000_crm_user_note_foundation/migration.sql`

Purely additive: one `CREATE TABLE`, two foreign keys, two `CREATE INDEX`. No
existing-table rebuild, no data backfill, no enum mutation, no existing row
modified. Committed migration count is now **31**.

## Permissions

The canonical permission list is now **ten**. The accepted first eight keep
their exact previous relative order; Notes v1 appends two:

`view_exact_financials, view_identity_full_email, reveal_pii, assign_owner, export, view_audit, manage_settings, edit_user_notes, view_user_notes, create_user_notes`

### `create_user_notes` vs `edit_user_notes`

`edit_user_notes` predates Notes v1 and is **not** reused for creation. It stays
reserved for future mutating operations on an *existing* note — edit, delete,
pin/unpin and visibility changes. Notes v1 is append-only, so it needs a read
permission and a create permission that are independent of it.

`edit_user_notes` alone grants **neither** GET nor POST.

### Role matrix

| Role | List notes | Create notes | Reason |
|---|---|---|---|
| crm_admin | yes | yes | Full CRM authority. |
| crm_manager | yes | yes | Operational owner of learner accounts. |
| retention_manager | yes | yes | Notes are core to retention work. |
| support | yes | yes | Notes are precisely the support remit. |
| mentor | no | no | **Explicit decision:** mentor holds no CRM permission today. Granting note access would be a new product expansion, not a port of an existing grant, so v1 grants nothing and it can be added later on evidence. |
| moderator | no | no | Moderation acts on content, not learner CRM commentary. |
| analyst | no | no | Free-text notes are not an analytics source. |
| content_manager | no | no | No learner-account remit. |
| read_only | no | no | Deliberately zero; granting read would widen the most restrictive role. |

No existing assignment changed except adding the two new permissions to those
four roles. `edit_user_notes` assignments are unchanged.

### Independence

GET checks `view_user_notes`. POST checks `create_user_notes`. Neither implies
the other in code. The production matrix happens to grant both to the same four
roles, but the two checks are semantically independent and separately tested, so
either can be granted alone in a future slice.

### permissionVersion

**Not incremented.** `StaffProfile.permissionVersion` is a per-employee stored
column that signals a change to *that employee's* grants. This slice changed the
role→permission table for everyone, which no client can act on per-employee.
No migration updates `StaffProfile` rows and no DEV reseed is required —
`effectivePermissions` are computed per request and never stored.

## Routes

Exactly two operations on one route. The route file exports **only** `GET` and
`POST`; there is no `PUT`, `PATCH`, `DELETE`, no `/notes/[noteId]`, and no
search, bulk, audit, owner, visibility or pin route.

### `GET /api/crm/v1/users/[userId]/notes`

Requires `view_user_notes`.

Query — exactly two optional keys; anything else (including `offset`, `page`,
`total`, `include`, `expand`, `fields`) is a 400, as is a repeated key:

- `limit` — integer, default 25, min 1, max 100.
- `cursor` — opaque, max 512 encoded characters.

Success `200`:

```
{
  items: [
    {
      noteId: string,
      body: string,
      authorDisplayName: string,
      createdAt: string   // ISO
    }
  ],
  nextCursor: string | null
}
```

No total or count is returned.

### `POST /api/crm/v1/users/[userId]/notes`

Requires `create_user_notes`. Accepts **no** query parameters at all.

Request — strict, exactly one key:

```
{ body: string }
```

An `authorId`, `employeeId`, `authorDisplayName`, `createdAt`, `visibility` or
`pinned` key is rejected, not ignored. The author is always taken from the
authenticated `StaffProfile` and can never be supplied by body, query or header.

Success `201` — the created note directly, the same four-key shape as a GET
item (no envelope, no `Location` header, no idempotency key).

## Body normalization

Pure function, applied before validation and storage:

1. Input must be a string.
2. `\r\n` and lone `\r` normalize to `\n`.
3. Surrounding Unicode whitespace is trimmed.
4. Internal spaces, tabs and newlines are preserved exactly.
5. Empty-after-trim is rejected.
6. Maximum **2000 Unicode code points**, counted by code point — not UTF-16
   code unit — so an astral emoji counts as one.
7. NUL and all other control characters are rejected, except `\n` and `\t`.
8. Plain text only. Never parsed or rendered as HTML or Markdown.

Nothing is truncated and nothing is silently deleted: a too-long or
control-bearing body is rejected, never repaired into something that looks
valid. A rejected body is never echoed back in the error response.

## Pagination

Deterministic ordering: `createdAt DESC, id DESC`. Notes are immutable, so both
columns are stable and a page boundary cannot drift the way an `OFFSET` would;
the cuid id breaks ties at an identical `createdAt`.

Keyset cursor, opaque base64url JSON `{ v: 1, t: ISO createdAt, i: noteId }`.
`limit + 1` rows are read to decide `nextCursor`. A cursor from another version
is rejected rather than reinterpreted, a malformed date or blank id is a 400,
and a cursor can never widen the requested limit. The cursor carries a position
only — no learner, author, permission or session data — so it is unsigned: it
grants nothing, and tampering yields a different position or a 400, never more
access.

## Author representation

Stored: `authorId` = the authenticated `StaffProfile.id`.
Returned: `authorDisplayName` **only**.

The name is resolved live through the `author` relation in the same query as the
notes page (one nested `select`, no N+1, no `include`). No
`authorDisplayNameSnapshot`, author email, StaffRole snapshot or permission
snapshot is stored. No `employeeId`, `authorId`, author email, StaffRole or
`effectivePermissions` is returned.

**Accepted v1 behaviour:** because the name resolves live, renaming a
`StaffProfile` changes the `authorDisplayName` shown on that employee's existing
notes. This is the deliberate trade — a corrected staff name corrects every
historical note, and no staff PII is duplicated into an immutable table that
could never be rectified. The immutable `authorId` remains the forensic anchor.

If an author's display name is blank, the request fails closed with a safe
internal error. It never fabricates a placeholder name and never falls back to
exposing the author id.

## Learner-only boundary

Both operations resolve the target with `where: { id, role: "user" }` — the
learner predicate is part of the WHERE, not a post-filter. A staff account, an
admin, a `news_editor`, any other non-learner and a nonexistent id therefore all
produce the **identical** 404 envelope, so the endpoint cannot be used to probe
which ids belong to employees. A hidden target never returns a fabricated empty
list.

A target learner needs no `StaffProfile`. Notes never turn a staff account into
a CRM learner.

The `UserRole` axis is used purely as a target predicate; it is never read as a
`StaffRole` and never grants anything.

## Errors

Order of resolution: session (401) → StaffProfile (403) → operation permission
(403) → query/path/body (400) → target (404). A caller without permission never
learns whether the target learner exists.

| Status | code | Cases |
|---|---|---|
| 400 | `invalid_input` | malformed userId; unknown or repeated query key; invalid limit; invalid cursor; invalid JSON; wrong body shape; body not a string; blank body; body too long; forbidden control character |
| 401 | `unauthorized` | missing, malformed, expired or blocked session |
| 403 | `unauthorized` | no StaffProfile; missing the operation's exact permission |
| 404 | `not_found` | target absent or not a learner |
| 500 | `internal` | safe internal failure |

`messageKey`s live under `crm.users.notes.*`; session failures reuse the
accepted `crm.session.*` keys.

Every response — success and error — carries `Cache-Control: no-store` and
`X-Request-Id`, and the body `requestId` matches the header. Errors use exactly
`{ code, messageKey, requestId }`.

No response exposes Zod issues, Prisma errors, SQL, stack traces, filesystem or
database paths, role names, permission names, or the raw request body. A 403
never names the role or the permission that was missing.

## Privacy

The notes payload contains no learner email, no author email, no `UserRole`, no
`StaffRole`, no permissions list, no `permissionVersion`, no IP or user-agent,
no session data and no password/token values. Both queries use explicit
`select`; a Prisma row is never spread into a response. Bodies are plain text
and never interpreted as markup.

## Audit and immutability

**Notes v1 writes no `AuditLog` record.** The `CrmUserNote` row is itself
sufficient append-only evidence for the only event that exists (note created):
it is immutable, and carries author, target and timestamp. Writing into the
generic `AuditLog` — untyped `Json` metadata, `userId onDelete: SetNull`, no CRM
audit projector — would be a fabricated audit record on an unrelated model, and
`SetNull` would let the actor evaporate. A real audit event becomes mandatory
the moment edit or delete lands; that is the trigger to design the Audit domain.

The Notes module contains no Prisma `update`, `delete`, `updateMany`,
`deleteMany` or `upsert` call, and creating a note is the only side effect.

- A note stays readable after its author is blocked (a block is a status, not a
  delete).
- A blocked author cannot create a note — the request is 401 and nothing
  persists.
- Notes are never physically deleted in v1; there is no soft delete either.

## Retention

Both relations are `onDelete: Restrict`. Deleting a learner that has notes, or a
`StaffProfile` that authored notes, fails loudly rather than silently orphaning
or erasing operational history. Note that `StaffProfile.userId` cascades from
`User`, so deleting a staff `User` who authored notes is blocked by the note's
`Restrict` — the correct, loud outcome. Erasure therefore remains a deliberate
future decision rather than an accidental cascade.

## Runtime upgrade (not performed in this phase)

The isolated DEV runtime database was **not** migrated and the services were
left stopped. To upgrade later:

1. Confirm backend and CRM are stopped (`bin/status`; ports 3100/3010 free).
2. Copy the runtime database to a timestamped backup.
3. Apply migration 31 with the repository runner (`npm run prisma:migrate`).
4. No seed change is required — permissions are computed, not stored, and no
   `StaffProfile` row changes.
5. Restart both services **only after** the CRM frontend ships the matching
   permission schema and Notes UI.
6. Verify: migration count 31, `PRAGMA foreign_key_check` empty, and a session
   response carrying `view_user_notes` and `create_user_notes`.

## Deferred / out of scope

- Edit, delete, pin/unpin and visibility (`edit_user_notes` stays reserved).
- `private` / `role_restricted` visibility and per-note author-only rules.
- Individual-note route, search, bulk, attachments, mentions, rich text.
- Note categories, `caseId`, owner/team scope, row-versioning.
- Audit API and any CRM audit projector.
- Idempotency keys, conflict and rate-limit errors (no evidence requires them).
- Frontend Notes UI — a separate phase.
