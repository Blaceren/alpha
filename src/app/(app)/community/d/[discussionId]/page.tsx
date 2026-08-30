import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { CommunityThread } from "@/features/community/components/community-thread";
import "@/features/community/community.css";
import { COMMUNITY_ENABLED } from "@/config/feature-visibility";

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
  /**
   * WITHHELD SECTION GUARD.
   *
   * `notFound()` is called BEFORE the session read and before any Community
   * request, so opening this address while the section is out of the product
   * fetches nothing: no overview, no space, no thread. A hidden section that
   * still talks to its Backend is hidden in appearance only.
   *
   * IT IS A 404, NOT A REDIRECT. Sending the learner to /home would make a
   * withheld address behave like a working link that goes somewhere unexpected.
   * "There is nothing here" is the honest answer, and it is the same answer the
   * address gave before the section existed.
   */
  if (!COMMUNITY_ENABLED) notFound();

  const [{ discussionId }, viewer] = await Promise.all([params, getServerViewer()]);
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="community">
      <CommunityThread discussionId={discussionId} />
    </AppShell>
  );
}
