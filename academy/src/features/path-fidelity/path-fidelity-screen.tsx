import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import { PathFidelityView } from "@/features/path-fidelity/path-fidelity-view";

/**
 * PATH — the data boundary.
 *
 * This is the only part of the surface that can fail, so it is the only part
 * that is asynchronous: read the session, read the curriculum through the BFF,
 * and hand a settled view to the composition. The bounded failure screens are
 * the product's existing ones — the same categories, the same retry rule, the
 * same support reference — because a restored surface must not invent a second
 * way of saying "the service is down".
 *
 * A CANDIDATE HAS NO PATH TO SHOW, AND IS NOT AN ERROR. `unavailable` and
 * `candidate` are ordinary answers from the Backend, so they get the informational
 * screen and not the failure one.
 */
export async function PathFidelityScreen() {
  const viewer = await getServerViewer();
  const userName = viewer?.name ?? "Ученик";
  const result = await getCurriculumView();

  if (!result.ok) {
    return (
      <AppShell userName={userName} activeId="path" notificationPresence={<UnreadPresence />}>
        <div className="ax">
          <CurriculumErrorState error={result.error} />
        </div>
      </AppShell>
    );
  }

  const view = result.view;

  if (view.state === "unavailable" || view.state === "candidate") {
    return (
      <AppShell userName={userName} activeId="path" notificationPresence={<UnreadPresence />}>
        <div className="ax">
          <CurriculumInfoState
            title="Путь пока не начат"
            message="Программа обучения станет доступна после зачисления."
          />
        </div>
      </AppShell>
    );
  }

  return <PathFidelityView view={view} userName={userName} />;
}
