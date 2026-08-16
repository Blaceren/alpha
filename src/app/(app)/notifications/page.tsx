import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { NotificationsScreen } from "@/features/academy-experience/notifications-screen";
import "@/features/academy-experience/experience.css";

export const metadata: Metadata = {
  title: "Уведомления — Alfa Trade Academy",
  description: "События вашего обучения: проверки, подтверждения и ответы поддержки.",
};

export const dynamic = "force-dynamic";

/**
 * The navigation has advertised this destination while the route did not exist,
 * so the bell led nowhere. It now leads to the learner's real notification list.
 */
export default async function NotificationsPage() {
  const viewer = await getServerViewer();
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="notifications">
      <div className="ax">
        <NotificationsScreen />
      </div>
    </AppShell>
  );
}
