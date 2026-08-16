import type { Metadata } from "next";
import { CommunitySpace } from "@/features/community/components/community-space";
import "@/features/community/community.css";

export const metadata: Metadata = { title: "Сообщество · Alfa Trade Academy" };
export const dynamic = "force-dynamic";

export default async function CommunitySpacePage({
  params,
}: {
  params: Promise<{ spaceCode: string }>;
}) {
  const { spaceCode } = await params;
  return <CommunitySpace spaceCode={spaceCode} />;
}
