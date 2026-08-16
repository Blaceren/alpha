import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { CommunityThread } from "@/features/community/components/community-thread";
import "@/features/community/community.css";

export const metadata: Metadata = {
  title: "Обсуждение — Alfa Trade Academy",
  description: "Вопрос и ответы участников программы.",
};

export const dynamic = "force-dynamic";

export default async function CommunityThreadPage({
  params,
}: {
  params: Promise<{ discussionId: string }>;
}) {
  const [{ discussionId }, viewer] = await Promise.all([params, getServerViewer()]);
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="community">
      <CommunityThread discussionId={discussionId} />
    </AppShell>
  );
}
