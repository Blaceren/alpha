import type { Metadata } from "next";
import { TradeQuestHomeV2 } from "@/components/design-lab/tradequest-v2/TradeQuestHomeV2";

export const metadata: Metadata = {
  title: "Alpha Academy · Signal System | Design Lab",
  robots: { index: false, follow: false },
};

export default function TradeQuestHomeV2Page() {
  return <TradeQuestHomeV2 />;
}
