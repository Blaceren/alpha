import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { CommunityHome } from "@/features/community/components/community-home";
import "@/features/community/community.css";

export const metadata: Metadata = {
  title: "Сообщество — Alfa Trade Academy",
  description: "Вопросы и разборы тех, кто идёт по той же программе.",
};

export const dynamic = "force-dynamic";

/**
 * Сообщество (/community).
 *
 * The navigation model has carried this destination since it was written and
 * nothing answered it. It answers now.
 */
export default async function CommunityPage() {
  const viewer = await getServerViewer();
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="community">
      <CommunityHome />
    </AppShell>
  );
}
