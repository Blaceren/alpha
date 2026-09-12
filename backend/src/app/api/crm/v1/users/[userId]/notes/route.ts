import { NextResponse } from "next/server";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { crmUserNoteCreatedSchema, crmUserNotesResponseSchema } from "@/lib/crm/schemas";
import { CrmUserDetailInputError, parseCrmUserId } from "@/lib/crm/user-detail";
import {
  assertCanCreateNotes,
  assertCanListNotes,
  assertNoNotesQueryParams,
  createCrmUserNote,
  CrmUserNotesForbiddenError,
  CrmUserNotesInputError,
  CrmUserNotesNotFoundError,
  listCrmUserNotes,
  parseCrmUserNoteCreateBody,
  parseCrmUserNotesQuery,
} from "@/lib/crm/user-notes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Next 15 async route params — no synchronous compatibility path.
type RouteContext = {
  params: Promise<{ userId: string }>;
};

// This route exports exactly GET and POST. Notes v1 is append-only: there is no
// PUT, PATCH or DELETE, no /notes/[noteId], and no search, bulk, audit, owner,
// visibility or pin route. An unsupported method therefore gets Next's own 405
// without ever reaching this module.

/**
 * Shared error mapping. Every failure collapses to the safe
 * `{code, messageKey, requestId}` envelope — no Zod issue, Prisma error, SQL,
 * stack, filesystem path, role name or permission name ever escapes.
 */
function errorResponse(error: unknown, requestId: string, headers: Record<string, string>) {
  if (error instanceof CrmAuthError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: error.status, headers },
    );
  }

  if (error instanceof CrmUserNotesForbiddenError) {
    // 403 — authenticated CRM employee, but without this operation's exact
    // permission. The envelope never names the role or the permission.
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 403, headers },
    );
  }

  if (error instanceof CrmUserNotesInputError || error instanceof CrmUserDetailInputError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 400, headers },
    );
  }

  if (error instanceof CrmUserNotesNotFoundError) {
    // One envelope for every miss: nonexistent id, staff account, admin,
    // news_editor, any non-learner. The response must not tell a caller which.
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 404, headers },
    );
  }

  // CrmUserNotesAuthorError (a note whose author row is unusable) and anything
  // else — Prisma errors, Zod issues — collapse to one safe internal envelope.
  return NextResponse.json(
    { code: "internal", messageKey: "crm.users.notes.internal", requestId },
    { status: 500, headers },
  );
}

// GET /api/crm/v1/users/[userId]/notes
//
// Lists a learner's immutable staff notes, newest first, keyset-paginated.
// Requires `view_user_notes` — not `edit_user_notes`, which stays reserved for
// future mutating operations on an existing note.
//
// Contract: docs/CRM_USER_NOTES_V1.md
export async function GET(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    // Order is deliberate: session (401), StaffProfile (403), operation
    // permission (403), then input and target. A caller without permission
    // never learns whether the target learner exists.
    const session = await resolveCrmSession();
    assertCanListNotes(session.effectivePermissions);

    const query = parseCrmUserNotesQuery(new URL(request.url).searchParams);
    const { userId } = await context.params;
    const page = await listCrmUserNotes(parseCrmUserId(userId), query);

    // Validate the exact shape before it leaves the process.
    return NextResponse.json(crmUserNotesResponseSchema.parse(page), { headers });
  } catch (error) {
    return errorResponse(error, requestId, headers);
  }
}

// POST /api/crm/v1/users/[userId]/notes
//
// Appends one note and returns it with 201. Requires `create_user_notes`. The
// author is taken from the authenticated StaffProfile and can never be supplied
// by the caller. The created row is the only side effect — no AuditLog write.
export async function POST(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    const session = await resolveCrmSession();
    assertCanCreateNotes(session.effectivePermissions);

    // POST accepts no query parameters at all.
    assertNoNotesQueryParams(new URL(request.url).searchParams);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      // Malformed JSON is plain 400 input; the parser exception never escapes.
      throw new CrmUserNotesInputError("crm.users.notes.body_invalid");
    }

    const body = parseCrmUserNoteCreateBody(raw);
    const { userId } = await context.params;
    const created = await createCrmUserNote(
      parseCrmUserId(userId),
      session.employeeId,
      body,
    );

    return NextResponse.json(crmUserNoteCreatedSchema.parse(created), { status: 201, headers });
  } catch (error) {
    return errorResponse(error, requestId, headers);
  }
}
