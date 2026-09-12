import type { Metadata } from "next";
import { TradeQuestNewsArticleV2 } from "@/components/design-lab/tradequest-v2/TradeQuestNewsArticleV2";

export const metadata: Metadata = {
  title: "Статья · Market Orbit | Design Lab",
  robots: { index: false, follow: false },
};

export default async function TradeQuestNewsArticleV2Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <TradeQuestNewsArticleV2 slug={slug} />;
}
