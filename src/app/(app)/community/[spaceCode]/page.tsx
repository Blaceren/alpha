import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { CommunitySpace } from "@/features/community/components/community-space";
import "@/features/community/community.css";

export const metadata: Metadata = {
  title: "Сообщество — Alfa Trade Academy",
  description: "Обсуждения пространства сообщества.",
};

export const dynamic = "force-dynamic";

export default async function CommunitySpacePage({
  params,
}: {
  params: Promise<{ spaceCode: string }>;
}) {
  const [{ spaceCode }, viewer] = await Promise.all([params, getServerViewer()]);
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="community">
      <CommunitySpace spaceCode={spaceCode} />
    </AppShell>
  );
}
