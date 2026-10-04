import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { deriveNextAction } from "@/lib/curriculum/next-action";
import { programPosition } from "@/lib/curriculum/program-points";
import { readNotificationItems } from "@/server/notifications/unread-presence";
import { resolveToolWindows } from "@/features/tool-windows/model/access";
import { AuthHomeField } from "@/features/auth-home-fidelity/auth-home-field";
import { HomeOverview } from "@/features/auth-home-fidelity/home-overview";
import { greetingName, homeNewsRows } from "@/features/auth-home-fidelity/home-overview-model";
import {
  FIELD_NOT_ENROLLED,
  FIELD_NO_CURRICULUM,
  fieldForAction,
  fieldForError,
} from "@/features/auth-home-fidelity/auth-home-state";

/**
 * AUTHENTICATED HOME — the data boundary.
 *
 * The page's one question is still the learner's current priority. So this
 * reads the canonical curriculum once and turns the answer into one field.
 * `deriveNextAction` is the same decision Path renders, which is what keeps the
 * two surfaces from ever disagreeing about which level matters.
 *
 * AROUND THE PRIORITY, SINCE 2026-10-03 (owner: «наполни внутреннюю главную,
 * после сделай ее хай фай»), the same read also gives the greeting, the program
 * line, the module the learner is in and their tools, and the notification rows
 * the bell already reads give «Что нового» — the same single GET, cached per
 * request. No new endpoint, no new read.
 *
 * AN UNREADABLE PRIORITY IS NOT AN ERROR SCREEN. Home has its own UNKNOWN
 * posture for it — the surface still speaks, and what it says is that it will
 * not guess. The product's generic curriculum error screens are deliberately not
 * used here; they would replace Home's answer with a different surface's. And
 * with no curriculum to read, nothing around the priority is drawn either.
 */
export async function AuthHomeScreen() {
  const [viewer, result, rows] = await Promise.all([
    getServerViewer(),
    getCurriculumView(),
    readNotificationItems(),
  ]);
  const name = viewer?.name ?? "Ученик";

  const enrolled =
    result.ok && (result.view.state === "enrolled" || result.view.state === "completed") ? result.view : null;

  const field = !result.ok
    ? fieldForError(result.error)
    : result.view.state === "unavailable"
      ? FIELD_NO_CURRICULUM
      : result.view.state === "candidate"
        ? FIELD_NOT_ENROLLED
        : fieldForAction(deriveNextAction(result.view));

  return (
    <AppShell userName={name} activeId="home" frozenSurface notificationPresence={<UnreadPresence />}>
      <HomeOverview
        name={greetingName(viewer?.name)}
        position={enrolled ? programPosition(enrolled) : null}
        tools={enrolled ? resolveToolWindows(enrolled.toolAccess) : null}
        news={homeNewsRows(rows)}
        priority={<AuthHomeField field={field} />}
      />
    </AppShell>
  );
}
