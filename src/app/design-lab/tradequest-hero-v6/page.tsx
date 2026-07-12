import type { Metadata } from "next";
import { TradeQuestHeroV6 } from "@/components/design-lab/tradequest-hero-v6/TradeQuestHeroV6";

export const metadata: Metadata = {
  title: "TradeQuest | Hero V6 Design Lab",
  robots: { index: false, follow: false },
};

export default function TradeQuestHeroV6Page() {
  return <TradeQuestHeroV6 />;
}
