import type { Metadata } from "next";
import { CommunityHome } from "@/features/community/components/community-home";
import "@/features/community/community.css";

export const metadata: Metadata = { title: "Сообщество · Alfa Trade Academy" };
export const dynamic = "force-dynamic";

export default function CommunityPage() {
  return <CommunityHome />;
}
