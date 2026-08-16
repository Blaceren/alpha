import type { Metadata } from "next";
import { CommunityThread } from "@/features/community/components/community-thread";
import "@/features/community/community.css";

export const metadata: Metadata = { title: "Обсуждение · Alfa Trade Academy" };
export const dynamic = "force-dynamic";

export default async function CommunityThreadPage({
  params,
}: {
  params: Promise<{ discussionId: string }>;
}) {
  const { discussionId } = await params;
  return <CommunityThread discussionId={discussionId} />;
}
