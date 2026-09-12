import type { Metadata } from "next";
import { TradeQuestHeroV3 } from "@/components/design-lab/tradequest-hero-v3/TradeQuestHeroV3";

export const metadata: Metadata = {
  title: "Alpha Academy | Hero v3 Design Lab",
  robots: { index: false, follow: false },
};

export default function TradeQuestHeroV3Page() {
  return <TradeQuestHeroV3 />;
}
