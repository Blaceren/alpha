import type { Metadata } from "next";
import { TradeQuestHeroV7 } from "@/components/design-lab/tradequest-hero-v7/TradeQuestHeroV7";

export const metadata: Metadata = {
  title: "TradeQuest | Hero V7 Live Product Stage",
  robots: { index: false, follow: false },
};

export default function TradeQuestHeroV7Page() {
  return <TradeQuestHeroV7 />;
}
