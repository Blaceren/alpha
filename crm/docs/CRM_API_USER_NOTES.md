# CRM API — User Notes v1 (production)

Status: implemented. Scope: an immutable, append-only Notes surface inside the
production learner detail. List and create only.

## Backend dependency

This surface requires backend **migration 31**
(`20260720000000_crm_user_note_foundation`) and the two permissions it
introduced. Until that migration is applied to a given backend database, the
Notes endpoints do not exist there.

The isolated DEV runtime is deliberately **left stopped** and its database is
still at the 30-migration state. Do not start the runtime against this CRM build
until migration 31 has been applied there.

## Rewrite topology

API mode proxies exactly four paths, each listed explicitly in
`next.config.mjs` — never `/api/:path*` and never `/api/crm/v1/:path*`:

1. `/api/crm/v1/session`
2. `/api/crm/v1/users`
3. `/api/crm/v1/users/:userId`
4. `/api/crm/v1/users/:userId/notes`

`:userId` matches exactly one segment and `/notes` is terminal, so
`/api/crm/v1/users/123/notes/abc` and `/api/crm/v1/users/123/notes/extra` are
**not** proxied and fall through to the CRM app. GET and POST share the one
definition: Next rewrites are method-agnostic, and a method-specific variant
would only create two things to keep in sync. Mock mode proxies nothing.

The backend origin is server-only (`CRM_BACKEND_ORIGIN`, no `NEXT_PUBLIC_`
prefix). The browser only ever sees relative paths, so the session cookie stays
host-only and no CORS is involved.

## DTOs

The CRM validates every response independently with strict Zod schemas. It does
**not** reuse the mock `CrmNote` type — that models a richer product
(visibility, pinning, editing, overlay markers) with no backend source.

```
GET /api/crm/v1/users/{userId}/notes?limit=25&cursor=…

200 {
  items: [
    { noteId: string, body: string, authorDisplayName: string, createdAt: string }
  ],
  nextCursor: string | null
}
```

```
POST /api/crm/v1/users/{userId}/notes
     { body: string }

201 { noteId: string, body: string, authorDisplayName: string, createdAt: string }
```

Every object is `.strict()`. A payload carrying `employeeId`, `authorId`, any
email, `role`/`StaffRole`, permissions, `userId`, `updatedAt`, `deletedAt`,
`visibility`, `pinned`, `caseId`, `capabilities` or audit metadata is **rejected**,
not ignored — so an accidental backend leak fails loudly here instead of
reaching the client.

Error envelope: `{ code, messageKey, requestId }` with
`code ∈ { invalid_input, unauthorized, not_found, internal }`. The HTTP status
is authoritative — the backend answers 403 with the code `unauthorized`, so
trusting the body code would collapse "not a CRM employee" into "session
expired". `messageKey` is parsed but **never rendered as user copy**; only
`requestId` may surface, as a small support reference.

## Permissions

The session permission schema went from eight values to **ten**. The accepted
first eight keep their exact relative order; the two new ones are appended:

`… manage_settings, edit_user_notes, view_user_notes, create_user_notes`

| Capability | Requires |
|---|---|
| List notes | `view_user_notes` |
| Create note | `create_user_notes` |

The two are checked **independently** — neither implies the other in code. The
production matrix happens to grant both to the same four roles, but view-only
and create-only are separately reachable and separately tested.

`edit_user_notes` grants **neither**. It stays reserved for future mutation of
an existing note (edit, delete, pin/unpin, visibility). `reveal_pii`,
`view_identity_full_email` and `view_audit` grant neither either.

Production role matrix (decided by the backend, never recomputed here):
`crm_admin`, `crm_manager`, `retention_manager`, `support` → view + create.
`mentor`, `moderator`, `analyst`, `content_manager`, `read_only` → neither.
**mentor deliberately has no Notes access**: it holds no CRM permission today,
so granting note access would be a new product expansion rather than a port.

Frontend visibility reads `session.effectivePermissions` **only**. A role name
is never consulted, so a backend that says `role=crm_admin,
effectivePermissions=[]` grants nothing.

## Composition

Inside the production `/users/[userId]` detail, below the accepted identity and
progress sections:

- both permissions → list + composer;
- `view_user_notes` only → list, no composer;
- `create_user_notes` only → composer, and **no list request is made**;
- neither (and `edit_user_notes`-only) → the section is **not mounted at all**,
  so no Notes request is ever issued.

Mock mode is untouched: `/users/[id]` continues to render the existing rich mock
User 360 Notes feature, unchanged.

## Application model

The production note carries exactly four fields: `noteId`, `body`,
`authorDisplayName`, `createdAt`. Nothing unavailable is filled with `null` or a
constant — absent data is absent.

## Rendering

- Body is plain text, rendered through normal React escaping. There is **no**
  `dangerouslySetInnerHTML`, no Markdown renderer and no HTML interpretation
  anywhere in the feature.
- `white-space: pre-wrap` preserves the author's line breaks; `break-words`
  keeps a long word or URL from causing horizontal overflow.
- Timestamps are deterministic **UTC** with an explicit label —
  `20.07.2026, 18:42 UTC`. The contract carries no staff timezone, so inventing
  a local one would silently show two employees different times for one note.
- The list preserves the server's order exactly. There is no client re-sort,
  which could otherwise disagree with the cursor order.
- Never shown: `noteId`, `employeeId`, `authorId`, visibility badge, pin badge,
  edit/delete menu, capability menu, case reference or audit data.

## Body normalization

A pure frontend validator mirrors the backend's public rules; the backend
remains authoritative. It exists so an invalid draft never costs a request, and
so the counter and the submitted value agree.

1. string only;
2. CRLF and lone CR normalize to LF;
3. surrounding Unicode whitespace trimmed;
4. internal spaces, tabs and newlines preserved;
5. blank rejected;
6. maximum **2000 Unicode code points**, counted by code point (an astral emoji
   counts as one, so `String.length` is never used for the bound);
7. NUL and all other control characters rejected except `\n` and `\t`;
8. nothing truncated, nothing silently stripped — invalid input is rejected.

The composer shows a live `N / 2000` counter using the same code-point count. No
HTML `maxlength` is set, because it would count UTF-16 units and disagree with
both the counter and the server.

## Pagination

`nextCursor` is used exactly as received and never decoded. No offset, no page
number, no total. Previously loaded rows stay visible while the next page loads;
a duplicate `noteId` is dropped defensively without reordering anything; a
failed load-more keeps the existing rows and offers a bounded retry rather than
resetting the list. Nothing is persisted — no localStorage, no sessionStorage.

## Error mapping

| Case | Behaviour |
|---|---|
| 401 (list or create) | `router.replace("/login?reason=session_required")`; learner and Notes data cleared |
| 404 (list or create) | whole detail transitions to «Пользователь не найден» |
| 403 list | identity/progress stay visible; Notes shows «Нет доступа к заметкам»; no stale rows |
| 403 create | identity/progress and list stay; draft kept; composer withdrawn for the rest of this session state |
| 400 list | «Некорректный запрос заметок» |
| 400 create | safe validation message; draft kept |
| 500 / network / timeout | Notes-only unavailable state with retry; identity/progress unaffected |
| malformed 200/201 | fail closed; no partial row; **draft not cleared** |

A 200 is **not** accepted as a successful create — the contract documents 201,
so anything else is a contract violation and must not clear the draft as though
the note were stored.

## Create behaviour

One request at a time; the submit button is disabled while pending. Plain Enter
inserts a newline (multiline textarea) and does not submit. The note row is
inserted only after a validated 201 — never optimistically. When the employee
cannot list notes, no row is rendered and success is announced through a polite
status region instead. The draft is cleared only on a validated 201.

The author is never supplied by the client: the request body carries exactly
`{ body }`, and the backend takes the author from the session cookie.

## Session and stale data

Requests are aborted on unmount, on learner change and on session change. Old
notes and the draft are cleared immediately when the learner changes, so text
written about one learner can never be submitted against another, and one
learner's notes are never visible under another's heading — including the single
frame where the route has changed but the previous detail is still in state.

## Accessibility

Section heading; visible textarea label; counter and error connected via
`aria-describedby`; `aria-invalid` on an invalid draft; a real `<button>` for
submit; keyboard-reachable load-more and retry; pending state communicated in
text («Добавляем…»); success announced politely; no colour-only error or
permission communication; long text creates no horizontal overflow; usable at
200% zoom.

## Verification

- Unit/component: permission schema, rewrites, DTO schemas, body validator,
  code-point counter, GET client, POST client, provider surface, and the full
  UI matrix.
- API-mode E2E (`tests-e2e-session/user-notes-api.spec.ts`, 43 tests) against
  the deterministic Node-standard-library stub on `127.0.0.1:3110`.
- The stub implements exactly the five reviewed routes and rejects a nested
  `/notes/{noteId}` and PUT/PATCH/DELETE. State is selected by test-only cookies
  (`ata_test_crm_notes_state`, `ata_test_crm_notes_session`); production code has
  no test headers or query parameters and no knowledge of the stub.
- The Notes E2E spec creates no committed screenshots.

## Not in this slice

Note edit, delete, pin/unpin and visibility; individual-note route; search;
bulk; attachments; mentions; rich text; categories; owner assignment; Audit API;
finance; activity; and any change to the mock User 360 Notes feature.
