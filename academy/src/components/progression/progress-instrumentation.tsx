import type { Instrumentation } from "@/domain/home";
import { ProvisionalRankMark } from "@/components/rank/provisional-rank-mark";

/** Rank + XP + streak read out as instrumentation clipped to the route (not KPI cards). */
export function ProgressInstrumentation({ data }: { data: Instrumentation }) {
  return (
    <div className="instr-line">
      <span className="instr">
        <ProvisionalRankMark size={26} />
        <b>{data.rankLabel}</b>
      </span>
      <span className="sep" aria-hidden="true" />
      <span className="instr mono">
        {data.xpLabel.replace(" XP", " ")}
        <b>XP</b>
      </span>
      <span className="sep" aria-hidden="true" />
      <span className="instr">
        Серия обучения <b>{data.streakCurrent}</b>
      </span>
    </div>
  );
}
