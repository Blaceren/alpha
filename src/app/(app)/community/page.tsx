import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { CommunityHome } from "@/features/community/components/community-home";
import "@/features/community/community.css";
import { COMMUNITY_ENABLED } from "@/config/feature-visibility";

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

  const viewer = await getServerViewer();
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="community">
      <CommunityHome />
    </AppShell>
  );
}
