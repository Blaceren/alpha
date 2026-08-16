import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { ProfileScreen } from "@/features/academy-experience/profile-screen";
import "@/features/academy-experience/experience.css";

export const metadata: Metadata = {
  title: "Профиль — Alfa Trade Academy",
  description: "Данные вашей учётной записи в Академии.",
};

export const dynamic = "force-dynamic";

/**
 * Narrow by design. Identity and session, nothing else: no Pocket balance, no
 * Affiliate identity, no staff data. Those belong to other products and other
 * owners, and mixing them here is how a learner profile quietly becomes a
 * financial dashboard.
 */
export default async function ProfilePage() {
  const viewer = await getServerViewer();
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="profile">
      <div className="ax">
        <ProfileScreen viewer={viewer} />
      </div>
    </AppShell>
  );
}
