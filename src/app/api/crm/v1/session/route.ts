import { NextResponse } from "next/server";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };

// GET /api/crm/v1/session
// Returns the CRM staff identity for the current signed-in employee. UI reads
// effectivePermissions only for affordances; every future CRM endpoint must
// still re-check permissions and resource rules server-side.
export async function GET() {
  const requestId = crmRequestId();

  try {
    const session = await resolveCrmSession();
    return NextResponse.json(session, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CrmAuthError) {
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: error.status, headers: NO_STORE },
      );
    }

    // Never surface raw exceptions.
    return NextResponse.json(
      { code: "internal", messageKey: "crm.session.internal", requestId },
      { status: 500, headers: NO_STORE },
    );
  }
}
