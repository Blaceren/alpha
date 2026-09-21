import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "@/features/tool-windows/tool-windows.css";
import { getAcademyConfig } from "@/config/academy-config";
import { getServerViewer } from "@/server/auth/server-session";
import { SessionProvider } from "@/features/auth/session-provider";
import { sanitizeReturnTo, DEFAULT_RETURN_TO } from "@/lib/auth/return-to";
import { PATHNAME_HEADER } from "@/lib/auth/constants";
import { FIXTURE_VIEWER } from "@/lib/api/viewer";
import type { SessionState } from "@/features/auth/session-machine";

// A tool is personal and guarded per request; never statically prerender it.
export const dynamic = "force-dynamic";

/**
 * (tool) route group — a tool opened in a tab of its own (TOOLS-V2).
 *
 * The same guard as `(app)`, repeated on purpose: a route group inherits no
 * layout from its sibling, so without this a tool tab would render with no
 * session check at all. An anonymous request goes to /login and comes back to
 * the tool after sign-in.
 *
 * What it does NOT carry is the Academy shell. A tool tab is a narrow column
 * the learner keeps next to the chart; the navigation lives in the tab they
 * came from.
 */
export default async function ToolLayout({ children }: { children: ReactNode }) {
  const config = getAcademyConfig();

  let initialState: SessionState;

  if (config.mode === "api") {
    const viewer = await getServerViewer();
    if (!viewer) {
      const requestHeaders = await headers();
      const returnTo = sanitizeReturnTo(requestHeaders.get(PATHNAME_HEADER));
      redirect(returnTo === DEFAULT_RETURN_TO ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`);
    }
    initialState = { status: "AUTHENTICATED", viewer };
  } else {
    initialState = { status: "AUTHENTICATED", viewer: FIXTURE_VIEWER };
  }

  return <SessionProvider initialState={initialState}>{children}</SessionProvider>;
}
