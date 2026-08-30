import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { CommunitySpace } from "@/features/community/components/community-space";
import "@/features/community/community.css";
import { COMMUNITY_ENABLED } from "@/config/feature-visibility";
import { NOT_FOUND_METADATA } from "@/config/not-found-metadata";

/**
 * METADATA IS RESOLVED WHETHER OR NOT THE COMPONENT RENDERS.
 *
 * `notFound()` in the component below stops the page being drawn; it does not
 * retract what this segment already said about itself. While the section is
 * withheld the route must therefore describe itself as what it is — a page that
 * is not there — and the section's own title is returned only when the section
 * is part of the product again.
 *
 * NOTHING IS READ TO DECIDE THIS. The branch is taken on a build-time constant,
 * above every await: no session, no params, no Community request. Metadata runs
 * before the component, so a data call here would be a Community fetch on a
 * hidden address — the exact thing the guard below exists to prevent.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!COMMUNITY_ENABLED) return NOT_FOUND_METADATA;
  return {
    title: "Сообщество — Alfa Trade Academy",
    description: "Обсуждения пространства сообщества.",
  };
}

export const dynamic = "force-dynamic";

export default async function CommunitySpacePage({
  params,
}: {
  params: Promise<{ spaceCode: string }>;
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

  const [{ spaceCode }, viewer] = await Promise.all([params, getServerViewer()]);
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="community">
      <CommunitySpace spaceCode={spaceCode} />
    </AppShell>
  );
}
