import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getServerViewer } from "@/server/auth/server-session";
import { NotificationsFidelity } from "@/features/notifications-fidelity/notifications-fidelity";

export const metadata: Metadata = {
  title: "Уведомления — Alfa Trade Academy",
  description: "События вашего обучения: проверки, подтверждения и ответы поддержки.",
};

export const dynamic = "force-dynamic";

/**
 * The navigation has advertised this destination while the route did not exist,
 * so the bell led nowhere. It leads to the learner's real register of
 * significant changes, rendered as the accepted NotationLedger design.
 */
export default async function NotificationsPage() {
  const viewer = await getServerViewer();
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="notifications" frozenSurface notificationPresence={<UnreadPresence />}>
      <NotificationsFidelity />
    </AppShell>
  );
}
