import type { Metadata } from "next";
import { TradeQuestNewsV2 } from "@/components/design-lab/tradequest-v2/TradeQuestNewsV2";

export const metadata: Metadata = {
  title: "Market Orbit · Alpha Academy | Design Lab",
  robots: { index: false, follow: false },
};

export default function TradeQuestNewsV2Page() {
  return <TradeQuestNewsV2 />;
}
