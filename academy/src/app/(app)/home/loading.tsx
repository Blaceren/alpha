import { AppShell } from "@/components/shell/app-shell";
import { AuthHomeLoadingField } from "@/features/auth-home-fidelity/auth-home-loading";

/**
 * The LOADING posture, as the route's own suspense fallback.
 *
 * This is what makes LOADING a REAL state rather than a contract nobody can
 * reach: the page reads the curriculum on the server, and this is what stands
 * on the surface while that read is in flight. The shell is already there, so
 * the learner's navigation never disappears — only the field is undetermined.
 */
export default function HomeLoading() {
  return (
    <AppShell userName="Ученик" activeId="home" frozenSurface>
      <AuthHomeLoadingField />
    </AppShell>
  );
}
