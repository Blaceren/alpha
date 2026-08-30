import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { deriveNextAction } from "@/lib/curriculum/next-action";
import { AuthHomeField } from "@/features/auth-home-fidelity/auth-home-field";
import {
  FIELD_NOT_ENROLLED,
  FIELD_NO_CURRICULUM,
  fieldForAction,
  fieldForError,
} from "@/features/auth-home-fidelity/auth-home-state";

/**
 * AUTHENTICATED HOME — the data boundary.
 *
 * Home answers exactly one question: what is the learner's current priority. So
 * this reads the canonical curriculum once and turns the answer into one field.
 * `deriveNextAction` is the same decision Path renders, which is what keeps the
 * two surfaces from ever disagreeing about which level matters.
 *
 * AN UNREADABLE PRIORITY IS NOT AN ERROR SCREEN. Home has its own UNKNOWN
 * posture for it — the surface still speaks, and what it says is that it will
 * not guess. The product's generic curriculum error screens are deliberately not
 * used here; they would replace Home's answer with a different surface's.
 */
export async function AuthHomeScreen() {
  const [viewer, result] = await Promise.all([getServerViewer(), getCurriculumView()]);
  const name = viewer?.name ?? "Ученик";

  const field = !result.ok
    ? fieldForError(result.error)
    : result.view.state === "unavailable"
      ? FIELD_NO_CURRICULUM
      : result.view.state === "candidate"
        ? FIELD_NOT_ENROLLED
        : fieldForAction(deriveNextAction(result.view));

  return (
    <AppShell userName={name} activeId="home" frozenSurface notificationPresence={<UnreadPresence />}>
      <AuthHomeField field={field} />
    </AppShell>
  );
}
